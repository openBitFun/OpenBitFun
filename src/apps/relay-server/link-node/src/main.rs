//! OpenBitFun Link relay node.
//!
//! Runs the EasyTier fork as the shared node of every account network
//! (`obf-*`): it relays and coordinates (hole punching, route exchange) for
//! devices that cannot reach each other directly, without holding any
//! network's secret. A device is admitted only when its handshake carries a
//! join token the account issuer signed for that network (Ed25519; this node
//! holds only the public key).
//!
//! Production listens on loopback only: the server is reachable only through
//! its domain over HTTPS; the provider's front end and nginx terminate TLS
//! and forward `wss://<domain>/mesh/et/` here
//! (`deploy/easytier/README.md`).

#[path = "../../shared_issuer.rs"]
mod shared_issuer;

use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::Context;
use clap::Parser;
use openbitfun_link::config::RelayNodeConfig;
use openbitfun_relay_service::link_token::JoinTokenVerifier;

#[derive(Parser, Debug)]
#[command(name = "openbitfun-link-node", version, about)]
struct Cli {
    #[command(subcommand)]
    command: Option<Command>,
    #[command(flatten)]
    relay: Args,
}

#[derive(clap::Subcommand, Debug)]
enum Command {
    /// Writes the credentials document (network, secret, join token) the
    /// issuer would hand `--device` of `--account`, for operator self-tests
    /// and server-side members. Holds secrets: write it to a 0600 file.
    Issue {
        /// The issuer key file (64 hex characters).
        #[arg(long, env = "MESH_ISSUER_KEY_FILE")]
        issuer_key_file: String,
        #[arg(long)]
        account: String,
        #[arg(long)]
        device: String,
        /// Relay URL the document names.
        #[arg(long, default_value = "wss://super.openbitfun.com:443/mesh/et/")]
        peer: String,
        /// Output file (created 0600).
        #[arg(long)]
        out: String,
    },
    /// Self-test of the server-side gateway (the browser path): joins
    /// `--account`'s network through the local relay as a gateway member,
    /// opens a stream to `--device`'s OBP port, writes bytes and prints what
    /// came back and the timings.
    GatewayProbe {
        #[arg(long, env = "MESH_ISSUER_KEY_FILE")]
        issuer_key_file: String,
        #[arg(long)]
        account: String,
        #[arg(long)]
        device: String,
        /// The relay node as the gateway reaches it on this host.
        #[arg(long, default_value = "ws://127.0.0.1:11011/")]
        relay: String,
        #[arg(long, default_value = "gateway-selftest")]
        member: String,
    },
}

async fn gateway_probe(
    key_file: &str,
    account: &str,
    device: &str,
    relay: &str,
    member: &str,
) -> anyhow::Result<()> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let gateway = openbitfun_link::gateway::LinkGateway::new(
        Arc::new(shared_issuer::IssuerKeyNetworks::new(
            shared_issuer::read_issuer_key(Path::new(key_file))?,
            relay.to_string(),
        )),
        member,
        openbitfun_link::gateway::GatewayLimits::default(),
    )
    .map_err(anyhow::Error::msg)?;
    let started = std::time::Instant::now();
    let mut stream = gateway
        .open(account, device, None)
        .await
        .map_err(|error| anyhow::anyhow!("{error}"))?;
    let opened = started.elapsed();
    let mut rtts = Vec::new();
    let mut buf = [0u8; 32];
    for _ in 0..10 {
        let at = std::time::Instant::now();
        stream.write_all(&[5u8; 32]).await?;
        stream.read_exact(&mut buf).await?;
        rtts.push(at.elapsed().as_secs_f64() * 1000.0);
    }
    rtts.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    println!(
        "gateway stream to {device}: joined+opened in {:.0} ms; echo rtt min={:.1} ms p50={:.1} ms max={:.1} ms",
        opened.as_secs_f64() * 1000.0,
        rtts[0],
        rtts[5],
        rtts[9]
    );
    drop(stream);
    gateway.shutdown().await;
    Ok(())
}

#[derive(clap::Args, Debug)]
struct Args {
    /// EasyTier listener URLs (comma separated). Keep them on loopback
    /// behind the edge, e.g. `ws://127.0.0.1:11011/`.
    #[arg(
        long,
        env = "LINK_NODE_LISTENERS",
        value_delimiter = ',',
        default_value = "ws://127.0.0.1:11011/"
    )]
    listeners: Vec<String>,
    /// This node's name as devices see it.
    #[arg(
        long,
        env = "LINK_NODE_HOSTNAME",
        default_value = "openbitfun-link-relay"
    )]
    hostname: String,
    /// File holding the issuer's join-token public key (64 hex characters,
    /// `joinTokenPublicKey` of `/mesh/v1/info`).
    #[arg(long, env = "LINK_NODE_JOIN_PUBLIC_KEY_FILE")]
    join_public_key_file: Option<String>,
    /// Relay bandwidth per account network, bytes per second.
    #[arg(long, env = "LINK_NODE_BPS_LIMIT", default_value_t = 2 * 1024 * 1024)]
    bps_limit: u64,
}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs() as i64)
        .unwrap_or_default()
}

fn random_hex(len: usize) -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    (0..len)
        .map(|_| format!("{:x}", rng.gen_range(0..16u8)))
        .collect()
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| {
                tracing_subscriber::EnvFilter::new("info,easytier=warn,easytier_core=warn")
            }),
        )
        .init();
    let cli = Cli::parse();
    match cli.command {
        Some(Command::Issue {
            issuer_key_file,
            account,
            device,
            peer,
            out,
        }) => return issue(&issuer_key_file, &account, &device, &peer, &out),
        Some(Command::GatewayProbe {
            issuer_key_file,
            account,
            device,
            relay,
            member,
        }) => return gateway_probe(&issuer_key_file, &account, &device, &relay, &member).await,
        None => {}
    }
    let args = cli.relay;
    let join_public_key_file = args
        .join_public_key_file
        .clone()
        .context("--join-public-key-file (LINK_NODE_JOIN_PUBLIC_KEY_FILE) is required")?;
    for listener in &args.listeners {
        if !(listener.contains("://127.0.0.1:") || listener.contains("://[::1]:")) {
            log::warn!(
                "Link node listener {} is not on loopback; production traffic must enter through the edge",
                listener
            );
        }
    }
    let public_key = std::fs::read_to_string(&join_public_key_file)
        .with_context(|| format!("cannot read the join public key file {join_public_key_file}"))?;
    let verifier =
        JoinTokenVerifier::from_public_key_hex(&public_key).map_err(anyhow::Error::msg)?;

    openbitfun_link::relay::install_join_gate(Arc::new(move |network: &str, token: &str| {
        verifier
            .verify(token, network, now_secs())
            .map(|claims| format!("{}:{}", claims.dev, claims.jti))
            .map_err(|error| error.to_string())
    }));

    let config = RelayNodeConfig {
        hostname: args.hostname.clone(),
        listeners: args.listeners.clone(),
        // The node's own network: nobody joins it, so a fresh secret per
        // start is fine and none is kept on disk.
        network_name: format!("openbitfun-link-relay-{}", random_hex(8)),
        network_secret: random_hex(48),
        foreign_relay_bps_limit: args.bps_limit,
    };
    let node = openbitfun_link::relay::start_relay(&config)
        .await
        .map_err(anyhow::Error::msg)?;
    log::info!(
        "OpenBitFun Link relay node v{} (EasyTier {}) listening on {:?}",
        env!("CARGO_PKG_VERSION"),
        openbitfun_link::EASYTIER_VERSION,
        args.listeners
    );

    shared_issuer::shutdown_signal().await;
    log::info!("Link relay node stopping");
    tokio::time::timeout(Duration::from_secs(10), node.stop())
        .await
        .ok();
    Ok(())
}

fn issue(key_file: &str, account: &str, device: &str, peer: &str, out: &str) -> anyhow::Result<()> {
    use openbitfun_relay_service::link_token::JoinTokenSigner;
    use openbitfun_relay_service::mesh_issuer::{derive_account_network, valid_link_device_id};
    anyhow::ensure!(valid_link_device_id(device), "invalid device id");
    let key = shared_issuer::read_issuer_key(Path::new(key_file))?;
    let network = derive_account_network(&key, account);
    let now = now_secs();
    let (token, claims) =
        JoinTokenSigner::from_issuer_key(&key).mint(&network.network_name, account, device, now);
    let document = openbitfun_link::MeshCredentials {
        version: 1,
        network_name: network.network_name.clone(),
        network_secret: network.network_secret,
        peers: vec![peer.to_string()],
        easytier_version: Some(openbitfun_link::EASYTIER_VERSION.to_string()),
        issued_at: Some(now),
        join_token: Some(token),
        join_token_expires_at: Some(claims.exp),
    };
    document.validate().map_err(anyhow::Error::msg)?;
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    use std::io::Write;
    options
        .open(out)
        .with_context(|| format!("cannot create {out}"))?
        .write_all(&serde_json::to_vec(&document)?)?;
    println!(
        "network={} device={} expires_at={}",
        network.network_name, device, claims.exp
    );
    Ok(())
}

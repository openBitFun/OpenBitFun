//! `openbitfun-superagent`: the OpenBitFun cloud agent service.
//!
//! Listens on loopback only; nginx exposes `https://<domain>/agent/`
//! (`deploy/superagent`). It mints its own membership of each account
//! network from the issuer key (like the browser gateway), so it runs where
//! the issuer key is, as the issuer's user.

use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::Context;
use clap::Parser;
use openbitfun_superagent::api::Service;
use openbitfun_superagent::crypto;
use openbitfun_superagent::directory::{HttpDirectory, HttpIdentity};
use openbitfun_superagent::engine::{Engine, EngineConfig, SystemClock};
use openbitfun_superagent::link_rpc::LinkRpc;
use openbitfun_superagent::model::RelayModel;
use openbitfun_superagent::obp_server::Frontends;
use openbitfun_superagent::slots::{SlotLimits, Slots};
use openbitfun_superagent::store::Store;

#[derive(Parser, Debug)]
#[command(name = "openbitfun-superagent", version, about)]
struct Args {
    /// Loopback address to listen on.
    #[arg(long, env = "SUPERAGENT_LISTEN", default_value = "127.0.0.1:19740")]
    listen: std::net::SocketAddr,
    /// Where the encrypted account records live.
    #[arg(
        long,
        env = "SUPERAGENT_DATA_DIR",
        default_value = "/var/lib/openbitfun-superagent"
    )]
    data_dir: std::path::PathBuf,
    /// The master key file (64 hex characters, mode 0600) that wraps every
    /// account's data key.
    #[arg(long, env = "SUPERAGENT_MASTER_KEY_FILE")]
    master_key_file: std::path::PathBuf,
    /// The issuer key file (64 hex characters, mode 0600).
    #[arg(long, env = "MESH_ISSUER_KEY_FILE")]
    issuer_key_file: std::path::PathBuf,
    /// The Link relay node as this host reaches it.
    #[arg(
        long,
        env = "SUPERAGENT_RELAY_NODE",
        default_value = "ws://127.0.0.1:11011/"
    )]
    relay_node: String,
    /// The account device directory: OpenBitFun 2.0's own directory
    /// instance (`openbitfun-directory`), never the 1.0 relay.
    #[arg(
        long,
        env = "SUPERAGENT_DIRECTORY_URL",
        default_value = "http://127.0.0.1:19750"
    )]
    directory_url: String,
    /// The credential of the directory's server-only cloud agent route
    /// (file, mode 0600). Without it accounts cannot be provisioned.
    #[arg(long, env = "SUPERAGENT_DIRECTORY_KEY_FILE")]
    directory_key_file: Option<std::path::PathBuf>,
    /// The identity authority's API root.
    #[arg(
        long,
        env = "SUPERAGENT_AUTH_URL",
        default_value = "https://auth.openbitfun.com/api/v1"
    )]
    auth_url: String,
    /// The agent's member name in every account network.
    #[arg(long, env = "SUPERAGENT_MEMBER", default_value = "obf-agent")]
    member: String,
    /// Serve frontends (`/agent/obp`, `/agent/api/v1/ensure`). Off until the
    /// fleet wiring ships; `/agent/health` answers either way.
    #[arg(long, env = "SUPERAGENT_FRONTENDS", default_value_t = false)]
    frontends: bool,
    /// Account networks joined at the same time.
    #[arg(long, env = "SUPERAGENT_MAX_ACCOUNTS", default_value_t = 256)]
    max_accounts: usize,
    /// Resident account slots.
    #[arg(long, env = "SUPERAGENT_MAX_RESIDENT", default_value_t = 512)]
    max_resident: usize,
    /// Concurrent model rounds in the process.
    #[arg(long, env = "SUPERAGENT_MODEL_ROUNDS", default_value_t = 64)]
    model_rounds: usize,
    /// Seconds between watcher passes.
    #[arg(long, env = "SUPERAGENT_WATCH_SECONDS", default_value_t = 5)]
    watch_seconds: u64,
}

struct IssuerKeyNetworks {
    key: [u8; 32],
    relay: String,
}

impl openbitfun_link::gateway::GatewayNetworks for IssuerKeyNetworks {
    fn member(
        &self,
        account_id: &str,
        member_id: &str,
    ) -> Result<openbitfun_link::MeshCredentials, String> {
        use openbitfun_relay_service::link_token::JoinTokenSigner;
        use openbitfun_relay_service::mesh_issuer::derive_account_network;
        let network = derive_account_network(&self.key, account_id);
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|elapsed| elapsed.as_secs() as i64)
            .unwrap_or_default();
        let (token, claims) = JoinTokenSigner::from_issuer_key(&self.key).mint(
            &network.network_name,
            account_id,
            member_id,
            now,
        );
        Ok(openbitfun_link::MeshCredentials {
            version: 1,
            network_name: network.network_name,
            network_secret: network.network_secret,
            peers: vec![self.relay.clone()],
            easytier_version: None,
            issued_at: Some(now),
            join_token: Some(token),
            join_token_expires_at: Some(claims.exp),
        })
    }
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
    let args = Args::parse();
    if !args.listen.ip().is_loopback() {
        log::warn!(
            "The agent listens on {}, not loopback; traffic must enter through nginx",
            args.listen
        );
    }
    let master = crypto::read_key_file(&args.master_key_file)?;
    let issuer = crypto::read_key_file(&args.issuer_key_file)?;
    let directory_key = match &args.directory_key_file {
        Some(path) => {
            let key = crypto::read_key_file(path)?;
            Some(crypto::hex(&key))
        }
        None => None,
    };
    let store = Arc::new(
        Store::open(&args.data_dir, master)
            .map_err(|e| anyhow::anyhow!(e.to_string()))
            .with_context(|| {
                format!("cannot open the data directory {}", args.data_dir.display())
            })?,
    );
    let slots = Arc::new(Slots::new(
        store,
        SlotLimits {
            max_resident: args.max_resident,
            ..SlotLimits::default()
        },
    ));
    let gateway = openbitfun_link::gateway::LinkGateway::new(
        Arc::new(IssuerKeyNetworks {
            key: issuer,
            relay: args.relay_node.clone(),
        }),
        &args.member,
        openbitfun_link::gateway::GatewayLimits {
            max_accounts: args.max_accounts,
            max_streams_per_account: 16,
            idle_timeout: Duration::from_secs(10 * 60),
            open_timeout: Duration::from_secs(20),
        },
    )
    .map_err(anyhow::Error::msg)?;
    let directory = Arc::new(HttpDirectory::new(&args.directory_url, directory_key)?);
    let rpc = LinkRpc::new(Arc::clone(&gateway), directory.clone(), Arc::clone(&slots));
    let engine = Engine::new(
        slots,
        rpc.clone(),
        Arc::new(RelayModel::new(rpc)),
        Arc::new(SystemClock),
        EngineConfig {
            model_rounds_global: args.model_rounds,
            ..EngineConfig::default()
        },
    );
    let service = Service::new(Arc::clone(&engine), directory);
    let frontends = Frontends::new(
        service,
        Arc::new(HttpIdentity::new(&args.auth_url)?),
        args.frontends,
    );

    engine.recover().await;
    let watcher = {
        let engine = Arc::clone(&engine);
        let every = Duration::from_secs(args.watch_seconds.max(1));
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(every);
            loop {
                interval.tick().await;
                engine.tick_all().await;
            }
        })
    };
    let listener = tokio::net::TcpListener::bind(args.listen)
        .await
        .with_context(|| format!("cannot listen on {}", args.listen))?;
    log::info!(
        "OpenBitFun agent v{} listening on {} (member={}, frontends={}, watched={})",
        env!("CARGO_PKG_VERSION"),
        args.listen,
        args.member,
        args.frontends,
        engine.watched_accounts().len()
    );
    axum::serve(listener, frontends.router())
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    log::info!("OpenBitFun agent stopping");
    watcher.abort();
    tokio::time::timeout(Duration::from_secs(10), gateway.shutdown())
        .await
        .ok();
    Ok(())
}

#[cfg(unix)]
async fn shutdown_signal() {
    let Ok(mut sigterm) = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
    else {
        let _ = tokio::signal::ctrl_c().await;
        return;
    };
    tokio::select! {
        _ = tokio::signal::ctrl_c() => {}
        _ = sigterm.recv() => {}
    }
}

#[cfg(not(unix))]
async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
}

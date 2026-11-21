//! OpenBitFun browser gateway.
//!
//! Browsers do not run Link. This process signs a browser in with the email
//! verification code (through the identity authority), registers the
//! browser's own device key in the account's device directory, lists the
//! account's devices, and pipes bytes between the browser's WebSocket and a
//! device's OBP port inside the account's Link network
//! (`openbitfun_link::gateway::LinkGateway`). The browser and the device run
//! OBP's end-to-end channel inside the pipe, so this process sees only
//! ciphertext.
//!
//! It mints its own membership of each account network from the issuer key,
//! so it runs where the issuer key is (as the issuer's user) and listens on
//! loopback only; nginx exposes `https://super.openbitfun.com/obp/` and the web
//! UI pool `https://super.openbitfun.com/cas/` (domain-only server, `deploy/easytier/README.md`).

mod app;
mod pool;
mod probe;
mod session;
mod upstream;

use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::Context;
use clap::Parser;

#[derive(Parser, Debug)]
#[command(name = "openbitfun-link-gateway", version, about)]
struct Args {
    /// Loopback address to listen on.
    #[arg(long, env = "LINK_GATEWAY_LISTEN", default_value = "127.0.0.1:19730")]
    listen: std::net::SocketAddr,
    /// The issuer key file (64 hex characters, mode 0600).
    #[arg(long, env = "MESH_ISSUER_KEY_FILE")]
    issuer_key_file: String,
    /// The Link relay node as this host reaches it.
    #[arg(
        long,
        env = "LINK_GATEWAY_RELAY_NODE",
        default_value = "ws://127.0.0.1:11011/"
    )]
    relay_node: String,
    /// The account device directory: OpenBitFun 2.0's own directory
    /// instance (`openbitfun-directory`, a relay-service with its own
    /// database), never the 1.0 relay.
    #[arg(
        long,
        env = "LINK_GATEWAY_DIRECTORY_URL",
        default_value = "http://127.0.0.1:19750"
    )]
    directory_url: String,
    /// The cloud agent's loopback root; each account's first browser
    /// sign-in asks it to create the account's cloud node. Empty: off.
    #[arg(
        long,
        env = "LINK_GATEWAY_SUPERAGENT_URL",
        default_value = "http://127.0.0.1:19740"
    )]
    superagent_url: String,
    /// The identity authority's API root.
    #[arg(
        long,
        env = "LINK_GATEWAY_AUTH_URL",
        default_value = "https://auth.openbitfun.com/api/v1"
    )]
    auth_url: String,
    /// Page origins allowed to use the gateway (comma separated).
    #[arg(
        long,
        env = "LINK_GATEWAY_ORIGINS",
        value_delimiter = ',',
        default_value = "https://super.openbitfun.com"
    )]
    origins: Vec<String>,
    /// The gateway's member name in every account network.
    #[arg(long, env = "LINK_GATEWAY_MEMBER", default_value = "obf-gateway")]
    member: String,
    /// Open pipes at the same time.
    #[arg(long, env = "LINK_GATEWAY_MAX_PIPES", default_value_t = 1024)]
    max_pipes: usize,
    /// Account networks joined at the same time.
    #[arg(long, env = "LINK_GATEWAY_MAX_ACCOUNTS", default_value_t = 256)]
    max_accounts: usize,
    /// Open streams per account.
    #[arg(long, env = "LINK_GATEWAY_STREAMS_PER_ACCOUNT", default_value_t = 16)]
    streams_per_account: usize,
    /// Cookies without `Secure` (local `http://` development only).
    #[arg(long, env = "LINK_GATEWAY_INSECURE_COOKIES")]
    insecure_cookies: bool,
    /// The web UI pool directory (files by hash; a cache, safe to delete).
    #[arg(
        long,
        env = "LINK_GATEWAY_UI_POOL_DIR",
        default_value = "/var/lib/openbitfun-ui-pool"
    )]
    ui_pool_dir: std::path::PathBuf,
    /// Total bytes the pool keeps (oldest-unused files are evicted first).
    #[arg(long, env = "LINK_GATEWAY_UI_POOL_MAX_BYTES", default_value_t = 4 * 1024 * 1024 * 1024)]
    ui_pool_max_bytes: u64,
    /// Files not used for this many days are deleted by the daily cleanup.
    #[arg(long, env = "LINK_GATEWAY_UI_POOL_MAX_AGE_DAYS", default_value_t = 30)]
    ui_pool_max_age_days: u64,
    /// Files one account may pull from its devices per minute.
    #[arg(
        long,
        env = "LINK_GATEWAY_UI_POOL_PULLS_PER_MINUTE",
        default_value_t = 240
    )]
    ui_pool_pulls_per_minute: u32,
}

/// Gateway membership minted from the issuer key (this host holds it).
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

fn read_issuer_key(path: &str) -> anyhow::Result<[u8; 32]> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(path)
            .with_context(|| format!("cannot read the issuer key file {path}"))?
            .permissions()
            .mode();
        anyhow::ensure!(
            mode & 0o077 == 0,
            "the issuer key file {path} must not be readable by group or others (chmod 600)"
        );
    }
    let text = std::fs::read_to_string(path)
        .with_context(|| format!("cannot read the issuer key file {path}"))?;
    let text = text.trim();
    anyhow::ensure!(
        text.len() == 64 && text.bytes().all(|byte| byte.is_ascii_hexdigit()),
        "the issuer key file must hold exactly 64 hex characters"
    );
    let mut key = [0u8; 32];
    for (index, chunk) in text.as_bytes().chunks(2).enumerate() {
        key[index] = u8::from_str_radix(std::str::from_utf8(chunk)?, 16)?;
    }
    Ok(key)
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
    if !(args.listen.ip().is_loopback()) {
        log::warn!(
            "The gateway listens on {}, not loopback; production traffic must enter through nginx",
            args.listen
        );
    }
    let key = read_issuer_key(&args.issuer_key_file)?;
    let link = openbitfun_link::gateway::LinkGateway::new(
        Arc::new(IssuerKeyNetworks {
            key,
            relay: args.relay_node.clone(),
        }),
        &args.member,
        openbitfun_link::gateway::GatewayLimits {
            max_accounts: args.max_accounts,
            max_streams_per_account: args.streams_per_account,
            idle_timeout: Duration::from_secs(10 * 60),
            open_timeout: Duration::from_secs(20),
        },
    )
    .map_err(anyhow::Error::msg)?;
    // Without a usable pool directory the gateway still signs browsers in
    // and pipes; `/cas/` answers `pool_unavailable`.
    let pool = match pool::UiPool::open(
        &args.ui_pool_dir,
        pool::PoolOptions {
            max_total_bytes: args.ui_pool_max_bytes,
            max_age: Duration::from_secs(args.ui_pool_max_age_days.max(1) * 24 * 60 * 60),
            pulls_per_account_per_minute: args.ui_pool_pulls_per_minute,
            ..pool::PoolOptions::default()
        },
        pool::system_clock(),
    ) {
        Ok(pool) => {
            pool.spawn_cleanup(Duration::from_secs(24 * 60 * 60));
            Some(pool)
        }
        Err(error) => {
            log::error!(
                "The web UI pool at {} cannot be opened; /cas/ is unavailable: {}",
                args.ui_pool_dir.display(),
                error
            );
            None
        }
    };
    let gateway = app::Gateway::new(
        Arc::new(
            upstream::HttpAccounts::new(&args.auth_url, &args.directory_url)?
                .with_superagent(Some(&args.superagent_url)),
        ),
        Arc::new(upstream::LinkStreams(Arc::clone(&link))),
        session::SessionSealer::from_issuer_key(&key),
        app::GatewayOptions {
            origins: args.origins.clone(),
            secure_cookies: !args.insecure_cookies,
            max_pipes: args.max_pipes,
            ..app::GatewayOptions::default()
        },
        pool,
    );
    let listener = tokio::net::TcpListener::bind(args.listen)
        .await
        .with_context(|| format!("cannot listen on {}", args.listen))?;
    log::info!(
        "OpenBitFun Link gateway v{} listening on {} (member={}, relay={}, origins={:?})",
        env!("CARGO_PKG_VERSION"),
        args.listen,
        args.member,
        args.relay_node,
        args.origins
    );
    axum::serve(
        listener,
        gateway
            .router()
            .into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .with_graceful_shutdown(async {
        shutdown_signal().await;
    })
    .await?;
    log::info!("Link gateway stopping");
    tokio::time::timeout(Duration::from_secs(10), link.shutdown())
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

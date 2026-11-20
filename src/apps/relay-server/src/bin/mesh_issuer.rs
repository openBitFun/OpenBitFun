//! OpenBitFun mesh credential issuer.
//!
//! A small standalone host for `openbitfun_relay_service::mesh_issuer`: it
//! verifies an OpenBitFun identity access token against the shared identity
//! authority and returns the account's EasyTier network (name, secret, relay
//! peers). It has no database and keeps no per-account state. Deployed beside
//! the relay behind the same edge (`deploy/easytier/README.md`).
//!
//! Environment:
//! - `MESH_ISSUER_LISTEN_ADDR` (default `127.0.0.1:19720`)
//! - `MESH_ISSUER_KEY_FILE`: file holding the 32-byte derivation key as 64
//!   hex characters (mode 0600). Never commit or log it.
//! - `MESH_ISSUER_PEERS`: comma-separated EasyTier peer URLs, in preference order
//! - `MESH_ISSUER_EASYTIER_VERSION` (default `2.6.4`)

use anyhow::Context;
use tracing::info;

fn read_key(path: &str) -> anyhow::Result<[u8; 32]> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(path)
            .with_context(|| format!("cannot read the mesh issuer key file {path}"))?
            .permissions()
            .mode();
        anyhow::ensure!(
            mode & 0o077 == 0,
            "the mesh issuer key file {path} must not be readable by group or others (chmod 600)"
        );
    }
    let text = std::fs::read_to_string(path)
        .with_context(|| format!("cannot read the mesh issuer key file {path}"))?;
    let text = text.trim();
    anyhow::ensure!(
        text.len() == 64 && text.bytes().all(|byte| byte.is_ascii_hexdigit()),
        "the mesh issuer key file must hold exactly 64 hex characters"
    );
    let mut key = [0u8; 32];
    for (index, chunk) in text.as_bytes().chunks(2).enumerate() {
        let pair = std::str::from_utf8(chunk)?;
        key[index] = u8::from_str_radix(pair, 16)?;
    }
    Ok(key)
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let listen_addr: std::net::SocketAddr = std::env::var("MESH_ISSUER_LISTEN_ADDR")
        .unwrap_or_else(|_| "127.0.0.1:19720".to_string())
        .parse()
        .context("MESH_ISSUER_LISTEN_ADDR must be an ip:port")?;
    let key_file =
        std::env::var("MESH_ISSUER_KEY_FILE").context("MESH_ISSUER_KEY_FILE is required")?;
    let peers: Vec<String> = std::env::var("MESH_ISSUER_PEERS")
        .context("MESH_ISSUER_PEERS is required")?
        .split(',')
        .map(|peer| peer.trim().to_string())
        .filter(|peer| !peer.is_empty())
        .collect();
    let easytier_version =
        std::env::var("MESH_ISSUER_EASYTIER_VERSION").unwrap_or_else(|_| "2.6.4".to_string());

    let config = openbitfun_relay_service::mesh_issuer::MeshIssuerConfig {
        key: read_key(&key_file)?,
        peers,
        easytier_version,
    };
    info!(
        "OpenBitFun mesh issuer v{}: peers={:?}, easytier={}",
        env!("CARGO_PKG_VERSION"),
        config.peers,
        config.easytier_version
    );
    let app = openbitfun_relay_service::mesh_issuer::mesh_issuer_router(config)?.layer(
        axum::middleware::from_fn(openbitfun_relay_service::relay_security_headers),
    );
    let listener = tokio::net::TcpListener::bind(listen_addr).await?;
    info!("Mesh issuer listening on {listen_addr}");
    axum::serve(listener, app).await?;
    Ok(())
}

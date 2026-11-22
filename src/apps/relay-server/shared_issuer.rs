//! Shared server helpers for the OpenBitFun 2.0 Link binaries
//! (`openbitfun-link-node`, `openbitfun-link-gateway`, `openbitfun-superagent`).
//!
//! Included via `#[path = "../../shared_issuer.rs"]` so issuer key loading
//! (with mandatory 0600 permission checks), gateway membership minting, and
//! graceful shutdown signals stay in one place without drifting.

use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

/// Gateway membership minted from the issuer key (held on this host).
pub(crate) struct IssuerKeyNetworks {
    key: [u8; 32],
    relay: String,
}

impl IssuerKeyNetworks {
    pub(crate) fn new(key: [u8; 32], relay: String) -> Self {
        Self { key, relay }
    }
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

/// Reads a 32-byte hex issuer key file, enforcing owner-only (0600) permissions
/// on Unix.
pub(crate) fn read_issuer_key(path: &Path) -> anyhow::Result<[u8; 32]> {
    openbitfun_link::gateway::read_hex_key_file(path).map_err(anyhow::Error::msg)
}

/// Resolves on Ctrl-C or SIGTERM.
#[cfg(unix)]
pub(crate) async fn shutdown_signal() {
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

/// Resolves on Ctrl-C.
#[cfg(not(unix))]
pub(crate) async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
}

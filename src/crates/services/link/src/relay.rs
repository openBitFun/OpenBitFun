//! The shared relay node and its join gate.
//!
//! The relay forwards account networks (`obf-*`) for their devices without
//! holding their secrets. Upstream EasyTier lets anyone create such a network
//! on a shared node; the Link relay admits a peer of a foreign network only
//! when its handshake carries a join token the issuer signed for that
//! network ([`install_join_gate`]). Verification (signature, expiry, network
//! binding) is the caller's: the token format belongs to the issuer.

use std::sync::Arc;
use std::time::Duration;

use crate::config::RelayNodeConfig;
use crate::node::{LinkNode, NodeOptions};

/// Verifies a join token for a network: `Ok(label)` (logged, e.g. the
/// device id) or `Err(reason)`.
pub type JoinVerifier = dyn Fn(&str, &str) -> Result<String, String> + Send + Sync;

struct Gate {
    verify: Arc<JoinVerifier>,
}

impl easytier::openbitfun::ForeignNetworkAdmission for Gate {
    fn admit(&self, request: &easytier::openbitfun::ForeignJoinRequest<'_>) -> Result<(), String> {
        if request.join_token.is_empty() {
            return Err(
                "no join token (sign in to OpenBitFun; Link needs a current client)".into(),
            );
        }
        let token = std::str::from_utf8(request.join_token)
            .map_err(|_| "unreadable join token".to_string())?;
        match (self.verify)(request.network_name, token) {
            Ok(label) => {
                log::info!(
                    "Link join admitted: network={}, member={}, remote={}",
                    request.network_name,
                    label,
                    request.remote_url.as_deref().unwrap_or("-")
                );
                Ok(())
            }
            Err(reason) => {
                log::warn!(
                    "Link join refused: network={}, reason={}, remote={}",
                    request.network_name,
                    reason,
                    request.remote_url.as_deref().unwrap_or("-")
                );
                Err(reason)
            }
        }
    }
}

/// Installs the process-wide join gate: from now on this process admits a
/// peer of a foreign network only with a token `verify` accepts.
pub fn install_join_gate(verify: Arc<JoinVerifier>) {
    easytier::openbitfun::set_foreign_network_admission(Some(Arc::new(Gate { verify })));
}

/// Removes the join gate (tests).
pub fn remove_join_gate() {
    easytier::openbitfun::set_foreign_network_admission(None);
}

/// Starts the relay node. Install the gate first.
pub async fn start_relay(config: &RelayNodeConfig) -> Result<Arc<LinkNode>, String> {
    LinkNode::start(NodeOptions {
        config_toml: config.render()?,
        network_name: config.network_name.clone(),
        hostname: config.hostname.clone(),
        join_token: None,
        status_interval: Duration::from_secs(30),
    })
    .await
}

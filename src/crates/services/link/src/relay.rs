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
                    remote_label(request.remote_url.as_deref())
                );
                Ok(())
            }
            Err(reason) => {
                log::warn!(
                    "Link join refused: network={}, reason={}, remote={}",
                    request.network_name,
                    reason,
                    remote_label(request.remote_url.as_deref())
                );
                Err(reason)
            }
        }
    }
}

/// The peer's transport for the log, without its address: a client IP is
/// personal data and the log keeps no user data (`ws`, `ws-loopback`, `-`).
fn remote_label(remote_url: Option<&str>) -> String {
    let Some(url) = remote_url else {
        return "-".to_string();
    };
    let (scheme, rest) = url.split_once("://").unwrap_or(("unknown", url));
    let host = rest
        .split(['/', '?'])
        .next()
        .unwrap_or_default()
        .rsplit_once(':')
        .map(|(host, _)| host)
        .unwrap_or_default()
        .trim_matches(['[', ']']);
    let loopback = host == "localhost"
        || host
            .parse::<std::net::IpAddr>()
            .is_ok_and(|address| address.is_loopback());
    let scheme: String = scheme
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(8)
        .collect();
    if loopback {
        format!("{scheme}-loopback")
    } else {
        scheme
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

#[cfg(test)]
mod tests {
    use super::remote_label;

    #[test]
    fn the_remote_label_never_carries_an_address() {
        assert_eq!(remote_label(None), "-");
        assert_eq!(remote_label(Some("ws://127.0.0.1:50700/")), "ws-loopback");
        assert_eq!(remote_label(Some("ws://[::1]:50700/")), "ws-loopback");
        for url in [
            "ws://121.36.124.31:37624/?proxy=127.0.0.1%3A37624",
            "wss://[2405:f080::1]:443/mesh/et/",
            "tcp://10.126.126.3:11010",
            "garbage 203.0.113.9",
        ] {
            let label = remote_label(Some(url));
            assert!(
                !label.contains('.') && !label.contains(':'),
                "{url} -> {label}"
            );
        }
        assert_eq!(
            remote_label(Some("ws://121.36.124.31:37624/?proxy=127.0.0.1%3A37624")),
            "ws"
        );
    }
}

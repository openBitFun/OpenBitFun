//! OpenBitFun Link hooks (fork addition; see ../../OPENBITFUN-PATCH.md).
//!
//! OpenBitFun runs one EasyTier network per account and a shared relay node
//! that forwards those networks without holding their secrets. Upstream lets
//! any peer create a foreign network on such a relay; OpenBitFun requires an
//! issuer-signed join token instead, so only signed-in devices of the account
//! can join or use relay bandwidth.
//!
//! Two process-wide hooks keep the change small and local to the handshake:
//!
//! - a join-token registry: a node attaches the current token of its network
//!   to every handshake it starts (`HandshakeRequest.obf_join_token`);
//! - a foreign-network admission gate: a relay node consults it for every
//!   accepted tunnel of a network other than its own, after the handshake and
//!   before the peer is added. Without a gate, upstream behaviour is unchanged.
//!
//! A third registry marks controller-only members (phone app, browser
//! gateway session): their route info carries `PeerFeatureFlag.obf_controller`
//! so devices list them as controllers, not as unreachable devices.
//!
//! The token format and its verification belong to OpenBitFun
//! (`openbitfun-link`), not to the fork; the fork only carries opaque bytes.

use std::{
    collections::HashMap,
    sync::{Arc, OnceLock, RwLock},
};

/// Longest gap between pings on a WebSocket tunnel. The OpenBitFun relay is
/// reachable only through its domain over HTTPS, and the provider's front end
/// closes connections idle for 180 s; upstream backs off to 32 s between
/// pings, OpenBitFun keeps WebSocket tunnels at 15 s.
pub const WEBSOCKET_MAX_PING_INTERVAL: std::time::Duration = std::time::Duration::from_secs(15);

/// Largest join token the fork carries (bytes).
pub const MAX_JOIN_TOKEN_LEN: usize = 2048;

fn token_key(network_name: &str, hostname: &str) -> String {
    format!("{network_name}\u{0}{hostname}")
}

fn tokens() -> &'static RwLock<HashMap<String, Vec<u8>>> {
    static TOKENS: OnceLock<RwLock<HashMap<String, Vec<u8>>>> = OnceLock::new();
    TOKENS.get_or_init(Default::default)
}

/// Sets (or with `None` clears) the join token handshakes of the member
/// `hostname` of `network_name` carry from now on. Established connections
/// are unaffected.
pub fn set_join_token(network_name: &str, hostname: &str, token: Option<Vec<u8>>) {
    let key = token_key(network_name, hostname);
    let mut tokens = tokens().write().unwrap_or_else(|error| error.into_inner());
    match token {
        Some(token) if token.len() <= MAX_JOIN_TOKEN_LEN => {
            tokens.insert(key, token);
        }
        Some(_) => {
            tracing::warn!(network_name, "join token too large; not attached");
            tokens.remove(&key);
        }
        None => {
            tokens.remove(&key);
        }
    }
}

/// The join token handshakes of member `hostname` of `network_name` carry
/// (empty when none).
pub fn join_token(network_name: &str, hostname: &str) -> Vec<u8> {
    tokens()
        .read()
        .unwrap_or_else(|error| error.into_inner())
        .get(&token_key(network_name, hostname))
        .cloned()
        .unwrap_or_default()
}

fn controllers() -> &'static RwLock<std::collections::HashSet<String>> {
    static CONTROLLERS: OnceLock<RwLock<std::collections::HashSet<String>>> = OnceLock::new();
    CONTROLLERS.get_or_init(Default::default)
}

/// Marks (or unmarks) the member `hostname` of `network_name` as a
/// controller-only node: its route info carries
/// `PeerFeatureFlag.obf_controller`, so the account's devices list it as a
/// controller (a phone app or browser gateway session that serves nothing)
/// instead of probing it as a device. Set before the node starts.
pub fn set_controller(network_name: &str, hostname: &str, controller: bool) {
    let key = token_key(network_name, hostname);
    let mut controllers = controllers()
        .write()
        .unwrap_or_else(|error| error.into_inner());
    if controller {
        controllers.insert(key);
    } else {
        controllers.remove(&key);
    }
}

/// Whether the member `hostname` of `network_name` is a controller-only node.
pub fn is_controller(network_name: &str, hostname: &str) -> bool {
    let controllers = controllers()
        .read()
        .unwrap_or_else(|error| error.into_inner());
    !controllers.is_empty() && controllers.contains(&token_key(network_name, hostname))
}

/// Longest display name a member advertises (bytes).
pub const MAX_DISPLAY_NAME_LEN: usize = 64;

fn display_names() -> &'static RwLock<HashMap<String, String>> {
    static NAMES: OnceLock<RwLock<HashMap<String, String>>> = OnceLock::new();
    NAMES.get_or_init(Default::default)
}

/// Sets (or with `None` clears) the display name the member `hostname` of
/// `network_name` advertises in its route info
/// (`RoutePeerInfo.obf_display_name`): control characters dropped, trimmed,
/// cut to [`MAX_DISPLAY_NAME_LEN`] bytes. Set before the node starts.
pub fn set_display_name(network_name: &str, hostname: &str, name: Option<&str>) {
    let key = token_key(network_name, hostname);
    let clean = name.map(|name| {
        let mut clean: String = name
            .chars()
            .filter(|c| !c.is_control())
            .collect::<String>()
            .trim()
            .to_string();
        while clean.len() > MAX_DISPLAY_NAME_LEN {
            clean.pop();
        }
        clean
    });
    let mut names = display_names()
        .write()
        .unwrap_or_else(|error| error.into_inner());
    match clean.filter(|name| !name.is_empty()) {
        Some(name) => {
            names.insert(key, name);
        }
        None => {
            names.remove(&key);
        }
    }
}

/// The display name the member `hostname` of `network_name` advertises
/// (empty when none).
pub fn display_name(network_name: &str, hostname: &str) -> String {
    let names = display_names()
        .read()
        .unwrap_or_else(|error| error.into_inner());
    if names.is_empty() {
        return String::new();
    }
    names
        .get(&token_key(network_name, hostname))
        .cloned()
        .unwrap_or_default()
}

/// What a relay knows about a peer asking to join a foreign network.
#[derive(Debug)]
pub struct ForeignJoinRequest<'a> {
    pub network_name: &'a str,
    /// `HandshakeRequest.obf_join_token`; empty for upstream peers and for
    /// secure-mode (Noise) handshakes, which carry no token.
    pub join_token: &'a [u8],
    /// The tunnel's remote URL, for logs.
    pub remote_url: Option<String>,
}

/// Decides whether a relay node admits a peer of a foreign network.
pub trait ForeignNetworkAdmission: Send + Sync {
    /// `Err(reason)` refuses the tunnel; the reason is logged, never sent.
    fn admit(&self, request: &ForeignJoinRequest<'_>) -> Result<(), String>;
}

fn gate() -> &'static RwLock<Option<Arc<dyn ForeignNetworkAdmission>>> {
    static GATE: OnceLock<RwLock<Option<Arc<dyn ForeignNetworkAdmission>>>> = OnceLock::new();
    GATE.get_or_init(Default::default)
}

/// Installs (or with `None` removes) the process-wide admission gate.
pub fn set_foreign_network_admission(admission: Option<Arc<dyn ForeignNetworkAdmission>>) {
    *gate().write().unwrap_or_else(|error| error.into_inner()) = admission;
}

/// Runs the gate, if one is installed.
pub(crate) fn admit_foreign_peer(request: &ForeignJoinRequest<'_>) -> Result<(), String> {
    let admission = gate()
        .read()
        .unwrap_or_else(|error| error.into_inner())
        .clone();
    match admission {
        Some(admission) => admission.admit(request),
        None => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens_are_per_member_and_bounded() {
        set_join_token("obf-test-a", "dev-1", Some(b"token-a1".to_vec()));
        set_join_token("obf-test-a", "dev-2", Some(b"token-a2".to_vec()));
        set_join_token("obf-test-b", "dev-1", Some(b"token-b".to_vec()));
        assert_eq!(join_token("obf-test-a", "dev-1"), b"token-a1");
        assert_eq!(join_token("obf-test-a", "dev-2"), b"token-a2");
        assert_eq!(join_token("obf-test-b", "dev-1"), b"token-b");
        set_join_token("obf-test-a", "dev-1", Some(vec![0; MAX_JOIN_TOKEN_LEN + 1]));
        assert!(join_token("obf-test-a", "dev-1").is_empty());
        assert_eq!(join_token("obf-test-a", "dev-2"), b"token-a2");
        set_join_token("obf-test-b", "dev-1", None);
        assert!(join_token("obf-test-b", "dev-1").is_empty());
    }

    #[test]
    fn display_names_are_per_member_and_sanitized() {
        assert_eq!(display_name("obf-test-e", "phone-1"), "");
        set_display_name("obf-test-e", "phone-1", Some("  Bob's\nphone  "));
        assert_eq!(display_name("obf-test-e", "phone-1"), "Bob'sphone");
        set_display_name("obf-test-e", "phone-2", Some(&"x".repeat(200)));
        assert_eq!(display_name("obf-test-e", "phone-2").len(), MAX_DISPLAY_NAME_LEN);
        set_display_name("obf-test-e", "phone-1", Some("   "));
        assert_eq!(display_name("obf-test-e", "phone-1"), "");
        set_display_name("obf-test-e", "phone-2", None);
        assert_eq!(display_name("obf-test-e", "phone-2"), "");
    }

    #[test]
    fn controller_role_is_per_member() {
        assert!(!is_controller("obf-test-c", "phone-1"));
        set_controller("obf-test-c", "phone-1", true);
        assert!(is_controller("obf-test-c", "phone-1"));
        assert!(!is_controller("obf-test-c", "desk-1"));
        assert!(!is_controller("obf-test-d", "phone-1"));
        set_controller("obf-test-c", "phone-1", false);
        assert!(!is_controller("obf-test-c", "phone-1"));
    }
}

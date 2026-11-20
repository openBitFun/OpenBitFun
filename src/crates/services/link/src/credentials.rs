//! The document the account issuer returns (`POST /mesh/v1/credentials`,
//! owner: `relay-service::mesh_issuer`).
//!
//! It names the account's Link network (name and secret, the same for every
//! device of the account), the relay URLs, and a short-lived join token bound
//! to the account and this device. The relay node admits the device only with
//! a valid token. None of it is ever shown in a UI or written to a log.

use serde::{Deserialize, Serialize};

/// Network names issued to accounts start with this prefix (the relay node
/// forwards only `obf-*` networks).
pub const MESH_NETWORK_PREFIX: &str = "obf-";
/// Path of the credential endpoint on the account edge.
pub const MESH_CREDENTIALS_PATH: &str = "/mesh/v1/credentials";
/// The default issuer (overridable with `OPENBITFUN_MESH_API_URL`).
pub const DEFAULT_MESH_API_URL: &str = "https://remote.openbitfun.com";
const MAX_PEERS: usize = 8;
const MAX_JOIN_TOKEN_LEN: usize = 2048;

fn default_version() -> u32 {
    1
}

/// One account's Link network, as issued to one device.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeshCredentials {
    #[serde(default = "default_version")]
    pub version: u32,
    pub network_name: String,
    pub network_secret: String,
    #[serde(default)]
    pub peers: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub easytier_version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub issued_at: Option<i64>,
    /// Issuer-signed join token for this account and device (Link relays
    /// refuse a network without one). Absent from issuers before Link.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub join_token: Option<String>,
    /// Unix seconds after which the relay refuses `join_token`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub join_token_expires_at: Option<i64>,
}

impl std::fmt::Debug for MeshCredentials {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MeshCredentials")
            .field("version", &self.version)
            .field("network_name", &self.network_name)
            .field("network_secret", &"<redacted>")
            .field("peers", &self.peers)
            .field("easytier_version", &self.easytier_version)
            .field(
                "join_token",
                &self.join_token.as_ref().map(|_| "<redacted>"),
            )
            .field("join_token_expires_at", &self.join_token_expires_at)
            .finish()
    }
}

/// EasyTier peer URLs this client accepts from an issuer.
pub fn valid_peer_url(value: &str) -> bool {
    let Some((scheme, rest)) = value.split_once("://") else {
        return false;
    };
    matches!(scheme, "tcp" | "udp" | "ws" | "wss" | "quic")
        && !rest.is_empty()
        && value.len() <= 256
        && !value.contains(['@', '?', '#', '"', '\'', '\\', ' '])
        && value.chars().all(|c| c.is_ascii_graphic())
}

impl MeshCredentials {
    /// Rejects documents a compromised or wrong endpoint could use to point
    /// the node somewhere unexpected or to break its config.
    pub fn validate(&self) -> Result<(), String> {
        if self.version != 1 {
            return Err(format!(
                "mesh_unsupported: the mesh issuer speaks credential version {}; update OpenBitFun",
                self.version
            ));
        }
        let name_ok = self.network_name.starts_with(MESH_NETWORK_PREFIX)
            && self.network_name.len() <= 64
            && self
                .network_name
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-');
        if !name_ok {
            return Err("the mesh issuer returned an invalid network name".to_string());
        }
        let secret_ok = (16..=128).contains(&self.network_secret.len())
            && self.network_secret.chars().all(|c| c.is_ascii_graphic());
        if !secret_ok {
            return Err("the mesh issuer returned an invalid network secret".to_string());
        }
        if self.peers.is_empty() || self.peers.len() > MAX_PEERS {
            return Err("the mesh issuer returned no usable relay nodes".to_string());
        }
        if let Some(peer) = self.peers.iter().find(|peer| !valid_peer_url(peer)) {
            return Err(format!(
                "the mesh issuer returned an invalid peer URL: {peer}"
            ));
        }
        if let Some(token) = &self.join_token {
            let token_ok = !token.is_empty()
                && token.len() <= MAX_JOIN_TOKEN_LEN
                && token.chars().all(|c| c.is_ascii_graphic());
            if !token_ok {
                return Err("the mesh issuer returned an invalid join token".to_string());
            }
        }
        Ok(())
    }

    /// The join token, when present and not expired at `now_secs` (with
    /// `margin_secs` to spare).
    pub fn usable_join_token(&self, now_secs: i64, margin_secs: i64) -> Option<&str> {
        let token = self.join_token.as_deref()?;
        match self.join_token_expires_at {
            Some(expires) if expires - margin_secs <= now_secs => None,
            _ => Some(token),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> MeshCredentials {
        serde_json::from_str(
            r#"{"version":1,"networkName":"obf-ff0a7d2cfa2526e8cdf8e6a2",
                "networkSecret":"c2VjcmV0LXNlY3JldC1zZWNyZXQtc2VjcmV0LXNlY3JldA",
                "peers":["wss://remote.openbitfun.com:443/mesh/et/"],
                "easytierVersion":"2.7.1","issuedAt":1795110000,
                "joinToken":"obfjt1.e30.c2ln","joinTokenExpiresAt":1795111800,
                "futureField":true}"#,
        )
        .unwrap()
    }

    #[test]
    fn accepts_the_issuer_document_and_tolerates_new_fields() {
        let credentials = sample();
        credentials.validate().unwrap();
        let debug = format!("{credentials:?}");
        assert!(!debug.contains("c2VjcmV0"));
        assert!(!debug.contains("obfjt1"));
        // A document cached by a build before Link (no token) still parses.
        let legacy: MeshCredentials = serde_json::from_str(
            r#"{"networkName":"obf-1","networkSecret":"0123456789abcdef0123","peers":["tcp://a:1"]}"#,
        )
        .unwrap();
        assert_eq!(legacy.version, 1);
        assert!(legacy.join_token.is_none());
        legacy.validate().unwrap();
        let round_trip: MeshCredentials =
            serde_json::from_str(&serde_json::to_string(&credentials).unwrap()).unwrap();
        assert_eq!(round_trip, credentials);
    }

    #[test]
    fn join_token_expiry_is_respected() {
        let credentials = sample();
        assert_eq!(
            credentials.usable_join_token(1795110000, 60),
            Some("obfjt1.e30.c2ln")
        );
        assert_eq!(credentials.usable_join_token(1795111790, 60), None);
    }

    #[test]
    fn rejects_foreign_networks_and_unsafe_values() {
        let mut bad = sample();
        bad.network_name = "home-lan".into();
        assert!(bad.validate().is_err());
        let mut bad = sample();
        bad.peers = vec!["tcp://x:1\"\n[flags]".into()];
        assert!(bad.validate().is_err());
        let mut bad = sample();
        bad.version = 2;
        assert!(bad.validate().unwrap_err().starts_with("mesh_unsupported"));
        let mut bad = sample();
        bad.network_secret = "short".into();
        assert!(bad.validate().is_err());
        let mut bad = sample();
        bad.join_token = Some("has space".into());
        assert!(bad.validate().is_err());
    }
}

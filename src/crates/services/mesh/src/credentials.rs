//! The credential document the account mesh issuer returns
//! (`POST /mesh/v1/credentials`, owner: `relay-service::mesh_issuer`).

use serde::{Deserialize, Serialize};

/// Network names issued to accounts start with this prefix (the relay node
/// forwards only `obf-*` networks).
pub const MESH_NETWORK_PREFIX: &str = "obf-";
/// Path of the credential endpoint on the account edge.
pub const MESH_CREDENTIALS_PATH: &str = "/mesh/v1/credentials";
/// The default issuer (overridable with `OPENBITFUN_MESH_API_URL`).
pub const DEFAULT_MESH_API_URL: &str = "https://remote.openbitfun.com";
const MAX_PEERS: usize = 8;

fn default_version() -> u32 {
    1
}

/// One account's mesh network.
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
}

impl std::fmt::Debug for MeshCredentials {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MeshCredentials")
            .field("version", &self.version)
            .field("network_name", &self.network_name)
            .field("network_secret", &"<redacted>")
            .field("peers", &self.peers)
            .field("easytier_version", &self.easytier_version)
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
    /// the sidecar somewhere unexpected or to break its config.
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
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> MeshCredentials {
        serde_json::from_str(
            r#"{"version":1,"networkName":"obf-ff0a7d2cfa2526e8cdf8e6a2",
                "networkSecret":"c2VjcmV0LXNlY3JldC1zZWNyZXQtc2VjcmV0LXNlY3JldA",
                "peers":["wss://remote.openbitfun.com:443/mesh/et/","tcp://190.92.203.184:11010"],
                "easytierVersion":"2.6.4","issuedAt":1795110000,"futureField":true}"#,
        )
        .unwrap()
    }

    #[test]
    fn accepts_the_issuer_document_and_tolerates_new_fields() {
        let credentials = sample();
        credentials.validate().unwrap();
        assert!(!format!("{credentials:?}").contains("c2VjcmV0"));
        // A document cached by an older build (no version, no peers metadata)
        // still parses; validation decides whether it is usable.
        let legacy: MeshCredentials = serde_json::from_str(
            r#"{"networkName":"obf-1","networkSecret":"0123456789abcdef0123","peers":["tcp://a:1"]}"#,
        )
        .unwrap();
        assert_eq!(legacy.version, 1);
        legacy.validate().unwrap();
        let round_trip: MeshCredentials =
            serde_json::from_str(&serde_json::to_string(&credentials).unwrap()).unwrap();
        assert_eq!(round_trip, credentials);
    }

    #[test]
    fn rejects_foreign_networks_and_unsafe_peers() {
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
    }
}

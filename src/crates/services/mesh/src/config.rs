//! The `easytier-core` configuration of one device node.
//!
//! The file holds the network secret: the sidecar writes it with mode 0600
//! inside the profile's data directory and never logs it.

use std::net::Ipv4Addr;

use toml::{Table, Value};

use crate::credentials::MeshCredentials;

/// A device node: no TUN (userspace only), DHCP virtual address, hostname =
/// the account device id, loopback-only SOCKS5 for outbound mesh connections,
/// and inbound mesh TCP admitted to the OBP mesh ports only.
#[derive(Clone)]
pub struct MeshNodeConfig {
    /// Stable per profile (lets two profiles on one machine coexist).
    pub instance_name: String,
    /// The account device id; peers map mesh hosts to devices by it.
    pub hostname: String,
    pub credentials: MeshCredentials,
    /// TCP+UDP listener for direct (LAN / hole-punched) peer connections;
    /// `None` runs without listeners (outbound connections only).
    pub listener_port: Option<u16>,
    /// Loopback SOCKS5 port controllers use to reach other devices.
    pub socks5_port: u16,
    /// Inbound virtual TCP ports reachable from peers (inclusive range).
    pub inbound_tcp_ports: (u16, u16),
    /// Turns off ordinary P2P (relay only); a diagnostics/test knob.
    pub disable_p2p: bool,
}

impl std::fmt::Debug for MeshNodeConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MeshNodeConfig")
            .field("instance_name", &self.instance_name)
            .field("hostname", &self.hostname)
            .field("credentials", &self.credentials)
            .field("listener_port", &self.listener_port)
            .field("socks5_port", &self.socks5_port)
            .field("inbound_tcp_ports", &self.inbound_tcp_ports)
            .field("disable_p2p", &self.disable_p2p)
            .finish()
    }
}

fn strings(values: impl IntoIterator<Item = String>) -> Value {
    Value::Array(values.into_iter().map(Value::String).collect())
}

impl MeshNodeConfig {
    /// The TOML document for `easytier-core --config-file`.
    pub fn render(&self) -> Result<String, String> {
        self.credentials.validate()?;
        let hostname_ok = !self.hostname.is_empty()
            && self.hostname.len() <= 64
            && self
                .hostname
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'));
        if !hostname_ok {
            return Err(format!("invalid mesh hostname: {}", self.hostname));
        }
        let (first, last) = self.inbound_tcp_ports;
        if first == 0 || last < first {
            return Err("invalid inbound mesh port range".to_string());
        }
        let mut root = Table::new();
        root.insert(
            "instance_name".into(),
            Value::String(self.instance_name.clone()),
        );
        root.insert("hostname".into(), Value::String(self.hostname.clone()));
        root.insert("dhcp".into(), Value::Boolean(true));
        let listeners = match self.listener_port {
            Some(port) => vec![
                format!("tcp://0.0.0.0:{port}"),
                format!("udp://0.0.0.0:{port}"),
            ],
            None => Vec::new(),
        };
        root.insert("listeners".into(), strings(listeners));
        root.insert(
            "socks5_proxy".into(),
            Value::String(format!(
                "socks5://{}:{}",
                Ipv4Addr::LOCALHOST,
                self.socks5_port
            )),
        );
        let ports = if first == last {
            first.to_string()
        } else {
            format!("{first}-{last}")
        };
        root.insert("tcp_whitelist".into(), strings([ports]));
        // No inbound virtual UDP: whitelist a port nothing listens on (an
        // empty list would admit every port).
        root.insert("udp_whitelist".into(), strings(["9".to_string()]));

        let mut identity = Table::new();
        identity.insert(
            "network_name".into(),
            Value::String(self.credentials.network_name.clone()),
        );
        identity.insert(
            "network_secret".into(),
            Value::String(self.credentials.network_secret.clone()),
        );
        root.insert("network_identity".into(), Value::Table(identity));

        let peers = self
            .credentials
            .peers
            .iter()
            .map(|uri| {
                let mut peer = Table::new();
                peer.insert("uri".into(), Value::String(uri.clone()));
                Value::Table(peer)
            })
            .collect();
        root.insert("peer".into(), Value::Array(peers));

        let mut flags = Table::new();
        flags.insert("no_tun".into(), Value::Boolean(true));
        flags.insert("multi_thread".into(), Value::Boolean(false));
        flags.insert("enable_ipv6".into(), Value::Boolean(false));
        flags.insert("accept_dns".into(), Value::Boolean(false));
        if self.disable_p2p {
            flags.insert("disable_p2p".into(), Value::Boolean(true));
        }
        root.insert("flags".into(), Value::Table(flags));

        toml::to_string(&root).map_err(|error| format!("failed to render the mesh config: {error}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> MeshNodeConfig {
        MeshNodeConfig {
            instance_name: "openbitfun-mesh-1234".into(),
            hostname: "ea4c87d093d8d571b48bba45cdf37f5f".into(),
            credentials: MeshCredentials {
                version: 1,
                network_name: "obf-ff0a7d2cfa2526e8cdf8e6a2".into(),
                network_secret: "a\"b\\c-secret-0123456789".into(),
                peers: vec!["wss://remote.openbitfun.com:443/mesh/et/".into()],
                easytier_version: None,
                issued_at: None,
            },
            listener_port: Some(11010),
            socks5_port: 21080,
            inbound_tcp_ports: (47612, 47619),
            disable_p2p: false,
        }
    }

    #[test]
    fn renders_a_userspace_node_with_escaped_values() {
        let text = config().render().unwrap();
        let parsed: Table = toml::from_str(&text).unwrap();
        assert_eq!(parsed["flags"]["no_tun"].as_bool(), Some(true));
        assert_eq!(
            parsed["network_identity"]["network_secret"].as_str(),
            Some("a\"b\\c-secret-0123456789")
        );
        assert_eq!(
            parsed["socks5_proxy"].as_str(),
            Some("socks5://127.0.0.1:21080")
        );
        assert_eq!(
            parsed["tcp_whitelist"].as_array().unwrap()[0].as_str(),
            Some("47612-47619")
        );
        assert_eq!(
            parsed["peer"].as_array().unwrap()[0]["uri"].as_str(),
            Some("wss://remote.openbitfun.com:443/mesh/et/")
        );
        assert!(!format!("{:?}", config()).contains("secret-0123456789"));
    }

    #[test]
    fn refuses_unsafe_values() {
        let mut bad = config();
        bad.hostname = "a b".into();
        assert!(bad.render().is_err());
        let mut bad = config();
        bad.credentials.network_name = "someone-else".into();
        assert!(bad.render().is_err());
    }
}

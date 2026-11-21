//! EasyTier configuration of the Link node roles.
//!
//! Documents are rendered in memory and handed to the in-process instance;
//! they hold the network secret and are never written to disk or logged.

use toml::{Table, Value};

use crate::credentials::MeshCredentials;
use crate::status::NodeRole;

/// STUN servers for NAT discovery (UDP, IPv4), in order: EasyTier's
/// mainland China list (`txt:` entries are resolved through public DNS,
/// mainland resolvers first), the mainland servers measured at 11-33 ms from
/// the mainland, then Cloudflare as the offshore fallback. Google is left out
/// (unreachable from the mainland without a proxy).
pub const STUN_SERVERS: &[&str] = &[
    "txt:stun.easytier.cn",
    "stun.miwifi.com:3478",
    "stun.chat.bilibili.com:3478",
    "stun.hitv.com:3478",
    "stun.cloudflare.com:3478",
];
/// IPv6 STUN servers: EasyTier's list, then Cloudflare.
pub const STUN_SERVERS_V6: &[&str] = &["txt:stun-v6.easytier.cn", "stun.cloudflare.com:3478"];

/// A device (or gateway) node of an account network.
#[derive(Clone)]
pub struct DeviceNodeConfig {
    /// Stable per profile (two profiles on one machine coexist).
    pub instance_name: String,
    /// The account device id; peers map nodes to devices by it.
    pub hostname: String,
    pub credentials: MeshCredentials,
    /// TCP+UDP port for direct (LAN / hole-punched) connections on every
    /// IPv4 and IPv6 address; `None` runs without listeners (outbound only).
    pub listener_port: Option<u16>,
    /// Virtual TCP ports peers may reach on this node (inclusive range).
    pub inbound_tcp_ports: (u16, u16),
    /// Relay-only (no direct connections); a diagnostics/test knob.
    pub disable_p2p: bool,
}

impl std::fmt::Debug for DeviceNodeConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DeviceNodeConfig")
            .field("instance_name", &self.instance_name)
            .field("hostname", &self.hostname)
            .field("credentials", &self.credentials)
            .field("listener_port", &self.listener_port)
            .field("inbound_tcp_ports", &self.inbound_tcp_ports)
            .field("disable_p2p", &self.disable_p2p)
            .finish()
    }
}

fn strings<'a>(values: impl IntoIterator<Item = &'a str>) -> Value {
    Value::Array(
        values
            .into_iter()
            .map(|value| Value::String(value.to_string()))
            .collect(),
    )
}

pub(crate) fn valid_hostname(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
}

impl DeviceNodeConfig {
    /// The TOML document of this node as a device.
    pub fn render(&self) -> Result<String, String> {
        self.render_as(NodeRole::Device)
    }

    /// The TOML document of this node in `role`. A controller admits no
    /// inbound virtual TCP (it serves nothing) and forwards no other
    /// device's data (a phone must not become a relay for the account's
    /// desktops); the role itself travels in the route info
    /// ([`crate::LinkNode::start_as`]).
    pub fn render_as(&self, role: NodeRole) -> Result<String, String> {
        self.credentials.validate()?;
        if !valid_hostname(&self.hostname) {
            return Err(format!("invalid Link hostname: {}", self.hostname));
        }
        let (first, last) = self.inbound_tcp_ports;
        if first == 0 || last < first {
            return Err("invalid inbound Link port range".to_string());
        }
        let mut root = Table::new();
        root.insert(
            "instance_name".into(),
            Value::String(self.instance_name.clone()),
        );
        root.insert("hostname".into(), Value::String(self.hostname.clone()));
        root.insert("dhcp".into(), Value::Boolean(true));
        // IPv4 listeners; `enable_ipv6` adds the `[::]` twin of each.
        let listeners = match self.listener_port {
            Some(port) => vec![
                format!("tcp://0.0.0.0:{port}"),
                format!("udp://0.0.0.0:{port}"),
            ],
            None => Vec::new(),
        };
        root.insert(
            "listeners".into(),
            strings(listeners.iter().map(String::as_str)),
        );
        let ports = if role.is_controller() {
            // An empty list would admit every port; port 9 (discard) is
            // never bound by Link.
            "9".to_string()
        } else if first == last {
            first.to_string()
        } else {
            format!("{first}-{last}")
        };
        // Inbound virtual TCP only for the OBP listener; no inbound virtual
        // UDP (an empty list would admit every port).
        root.insert("tcp_whitelist".into(), strings([ports.as_str()]));
        root.insert("udp_whitelist".into(), strings(["9"]));
        root.insert("stun_servers".into(), strings(STUN_SERVERS.iter().copied()));
        root.insert(
            "stun_servers_v6".into(),
            strings(STUN_SERVERS_V6.iter().copied()),
        );

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
        flags.insert("enable_ipv6".into(), Value::Boolean(true));
        flags.insert("accept_dns".into(), Value::Boolean(false));
        if self.disable_p2p {
            flags.insert("disable_p2p".into(), Value::Boolean(true));
        }
        if role.is_controller() {
            flags.insert("disable_relay_data".into(), Value::Boolean(true));
        }
        // A relay on this host's loopback (the server-side gateway) is not
        // reachable through a socket bound to a physical interface.
        let loopback_relay = self.credentials.peers.iter().any(|peer| {
            ["://127.0.0.1:", "://[::1]:", "://localhost:"]
                .iter()
                .any(|host| peer.contains(host))
        });
        if loopback_relay {
            flags.insert("bind_device".into(), Value::Boolean(false));
        }
        root.insert("flags".into(), Value::Table(flags));

        toml::to_string(&root).map_err(|error| format!("failed to render the Link config: {error}"))
    }
}

/// The shared relay node: forwards account networks (`obf-*`) whose peers
/// present a valid join token, listens on loopback only (the provider's front end and nginx
/// edge terminates TLS and reaches it), joins no account network itself.
#[derive(Clone)]
pub struct RelayNodeConfig {
    pub hostname: String,
    /// `ws://127.0.0.1:<port>/` and friends; loopback only in production.
    pub listeners: Vec<String>,
    /// The relay's own network (random per deployment; nobody joins it).
    pub network_name: String,
    pub network_secret: String,
    /// Bytes per second each account network may relay.
    pub foreign_relay_bps_limit: u64,
}

impl std::fmt::Debug for RelayNodeConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RelayNodeConfig")
            .field("hostname", &self.hostname)
            .field("listeners", &self.listeners)
            .field("network_name", &self.network_name)
            .field("network_secret", &"<redacted>")
            .field("foreign_relay_bps_limit", &self.foreign_relay_bps_limit)
            .finish()
    }
}

impl RelayNodeConfig {
    pub fn render(&self) -> Result<String, String> {
        if !valid_hostname(&self.hostname) {
            return Err(format!("invalid relay hostname: {}", self.hostname));
        }
        if self.network_secret.len() < 16 {
            return Err("the relay network secret is too short".to_string());
        }
        let mut root = Table::new();
        root.insert(
            "instance_name".into(),
            Value::String("openbitfun-link-relay".into()),
        );
        root.insert("hostname".into(), Value::String(self.hostname.clone()));
        root.insert(
            "listeners".into(),
            strings(self.listeners.iter().map(String::as_str)),
        );
        // The relay sits behind the domain's front end: no NAT discovery.
        root.insert("stun_servers".into(), Value::Array(Vec::new()));
        root.insert("stun_servers_v6".into(), Value::Array(Vec::new()));
        let mut identity = Table::new();
        identity.insert(
            "network_name".into(),
            Value::String(self.network_name.clone()),
        );
        identity.insert(
            "network_secret".into(),
            Value::String(self.network_secret.clone()),
        );
        root.insert("network_identity".into(), Value::Table(identity));
        let mut flags = Table::new();
        flags.insert("no_tun".into(), Value::Boolean(true));
        flags.insert("multi_thread".into(), Value::Boolean(true));
        flags.insert("enable_ipv6".into(), Value::Boolean(false));
        flags.insert("accept_dns".into(), Value::Boolean(false));
        flags.insert(
            "relay_network_whitelist".into(),
            Value::String(format!("{}*", crate::credentials::MESH_NETWORK_PREFIX)),
        );
        flags.insert("private_mode".into(), Value::Boolean(false));
        flags.insert(
            "foreign_relay_bps_limit".into(),
            Value::Integer(self.foreign_relay_bps_limit.min(i64::MAX as u64) as i64),
        );
        root.insert("flags".into(), Value::Table(flags));
        toml::to_string(&root)
            .map_err(|error| format!("failed to render the relay config: {error}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> DeviceNodeConfig {
        DeviceNodeConfig {
            instance_name: "openbitfun-1234".into(),
            hostname: "ea4c87d093d8d571b48bba45cdf37f5f".into(),
            credentials: MeshCredentials {
                version: 1,
                network_name: "obf-ff0a7d2cfa2526e8cdf8e6a2".into(),
                network_secret: "a\"b\\c-secret-0123456789".into(),
                peers: vec!["wss://super.openbitfun.com:443/mesh/et/".into()],
                easytier_version: None,
                issued_at: None,
                join_token: Some("obfjt1.x.y".into()),
                join_token_expires_at: None,
            },
            listener_port: Some(11010),
            inbound_tcp_ports: (47612, 47619),
            disable_p2p: false,
        }
    }

    #[test]
    fn renders_a_userspace_node_with_ipv6_and_escaped_values() {
        let text = config().render().unwrap();
        let parsed: Table = toml::from_str(&text).unwrap();
        assert_eq!(parsed["flags"]["no_tun"].as_bool(), Some(true));
        assert_eq!(parsed["flags"]["enable_ipv6"].as_bool(), Some(true));
        assert_eq!(
            parsed["network_identity"]["network_secret"].as_str(),
            Some("a\"b\\c-secret-0123456789")
        );
        assert!(parsed.get("socks5_proxy").is_none());
        assert_eq!(
            parsed["tcp_whitelist"].as_array().unwrap()[0].as_str(),
            Some("47612-47619")
        );
        assert_eq!(
            parsed["listeners"].as_array().unwrap()[1].as_str(),
            Some("udp://0.0.0.0:11010")
        );
        assert!(
            !text.contains("obfjt1"),
            "the join token never enters the config"
        );
        // Mainland STUN first, no Google.
        let stun = parsed["stun_servers"].as_array().unwrap();
        assert_eq!(stun[0].as_str(), Some("txt:stun.easytier.cn"));
        assert_eq!(stun[1].as_str(), Some("stun.miwifi.com:3478"));
        assert!(!text.contains("google"));
        assert_eq!(
            parsed["stun_servers_v6"].as_array().unwrap()[0].as_str(),
            Some("txt:stun-v6.easytier.cn")
        );
        assert!(!format!("{:?}", config()).contains("secret-0123456789"));
    }

    #[test]
    fn controllers_admit_no_inbound_streams_and_relay_nothing() {
        let device: Table = toml::from_str(&config().render().unwrap()).unwrap();
        assert!(device["flags"].get("disable_relay_data").is_none());
        let text = config().render_as(NodeRole::Controller).unwrap();
        let parsed: Table = toml::from_str(&text).unwrap();
        assert_eq!(
            parsed["tcp_whitelist"].as_array().unwrap()[0].as_str(),
            Some("9")
        );
        assert_eq!(parsed["flags"]["disable_relay_data"].as_bool(), Some(true));
        // Still P2P first: listeners and hole punching stay on.
        assert!(parsed["flags"].get("disable_p2p").is_none());
        assert_eq!(parsed["listeners"].as_array().unwrap().len(), 2);
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

    #[test]
    fn relay_config_whitelists_account_networks_only() {
        let text = RelayNodeConfig {
            hostname: "openbitfun-link-relay-lw".into(),
            listeners: vec!["ws://127.0.0.1:11011/".into()],
            network_name: "openbitfun-link-relay".into(),
            network_secret: "0123456789abcdef0123".into(),
            foreign_relay_bps_limit: 2 << 20,
        }
        .render()
        .unwrap();
        let parsed: Table = toml::from_str(&text).unwrap();
        assert_eq!(
            parsed["flags"]["relay_network_whitelist"].as_str(),
            Some("obf-*")
        );
        assert_eq!(
            parsed["listeners"].as_array().unwrap()[0].as_str(),
            Some("ws://127.0.0.1:11011/")
        );
    }
}

#[cfg(test)]
mod stun_txt_tests {
    /// A one-shot DNS server on loopback answering a TXT query the way
    /// public resolvers do (name compression in the answer).
    async fn fake_dns(text: &'static str) -> std::net::SocketAddr {
        let socket = tokio::net::UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let addr = socket.local_addr().unwrap();
        tokio::spawn(async move {
            let mut buf = [0u8; 512];
            let (len, from) = socket.recv_from(&mut buf).await.unwrap();
            let mut answer = buf[..len].to_vec();
            answer[2] = 0x81;
            answer[3] = 0x80;
            answer[7] = 1;
            answer.extend_from_slice(&[0xc0, 0x0c, 0, 16, 0, 1, 0, 0, 0, 60]);
            answer.extend_from_slice(&((text.len() + 1) as u16).to_be_bytes());
            answer.push(text.len() as u8);
            answer.extend_from_slice(text.as_bytes());
            socket.send_to(&answer, from).await.unwrap();
        });
        addr
    }

    #[tokio::test]
    async fn txt_stun_entries_resolve_without_a_full_resolver() {
        let server = fake_dns("stun.example:3478 203.0.113.7:8489").await;
        let text = easytier::openbitfun::resolve_txt_udp_via("stun.easytier.cn", &[server])
            .await
            .unwrap();
        assert_eq!(text, "stun.example:3478 203.0.113.7:8489");
    }

    /// Live: `cargo test -p openbitfun-link --lib stun_txt -- --ignored`.
    #[tokio::test]
    #[ignore]
    async fn easytier_stun_list_resolves_live() {
        let text = easytier::openbitfun::resolve_txt_udp("stun.easytier.cn")
            .await
            .unwrap();
        eprintln!("stun.easytier.cn TXT: {text}");
        assert!(!text.trim().is_empty());
    }
}

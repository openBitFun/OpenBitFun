//! Mesh status: what `easytier-cli` reports, projected for OpenBitFun.
//!
//! `easytier-cli node` output embeds the node's config (with the network
//! secret): it is parsed into the few fields below and never logged.

use serde::{Deserialize, Serialize};

/// Lifecycle of the device's mesh node.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MeshState {
    /// Turned off (`OPENBITFUN_MESH=off`) or not started by this host.
    Disabled,
    /// No account is signed in; the mesh needs account credentials.
    SignedOut,
    /// This build or platform cannot run the mesh (`reason` says why).
    Unsupported,
    /// Fetching credentials or starting the sidecar.
    Starting,
    /// The sidecar runs and answers status probes.
    Running,
    /// The sidecar exited; restarting after a backoff.
    Restarting,
    /// Credentials or the sidecar failed; retried later (`reason`).
    Failed,
    /// Stopped (sign-out or shutdown).
    Stopped,
}

/// How traffic reaches a peer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MeshPath {
    /// Direct connection (LAN or hole-punched).
    P2p,
    /// Forwarded by a relay node or another peer.
    Relayed,
}

/// Another device in the account mesh.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeshPeer {
    pub peer_id: String,
    /// The mesh hostname, which OpenBitFun sets to the account device id.
    pub hostname: String,
    pub virtual_ip: String,
    pub path: MeshPath,
    /// Route cost (1 = direct).
    pub hops: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latency_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub loss_rate: Option<f64>,
    /// `tcp`, `udp`, `wss`, ... for direct connections.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tunnel: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nat_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub easytier_version: Option<String>,
}

/// A relay/discovery node this device is connected to.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeshRelayNode {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latency_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tunnel: Option<String>,
}

/// The device's mesh node now.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeshStatus {
    pub state: MeshState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    pub easytier_version: String,
    /// This device's account device id (its mesh hostname).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub virtual_ip: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nat_type: Option<String>,
    /// The OBP mesh listener's port (on the virtual IP), while it runs.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub obp_port: Option<u16>,
    pub peers: Vec<MeshPeer>,
    pub relay_nodes: Vec<MeshRelayNode>,
    pub restarts: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sidecar_pid: Option<u32>,
    pub updated_at_ms: u64,
}

impl MeshStatus {
    pub fn new(state: MeshState, reason: Option<String>) -> Self {
        Self {
            state,
            reason,
            easytier_version: crate::EASYTIER_VERSION.to_string(),
            device_id: None,
            virtual_ip: None,
            nat_type: None,
            obp_port: None,
            peers: Vec::new(),
            relay_nodes: Vec::new(),
            restarts: 0,
            sidecar_pid: None,
            updated_at_ms: crate::now_ms(),
        }
    }

    /// Whether `other` differs in what a UI shows (state, addresses, peer
    /// set and paths, relay nodes); latency jitter alone is not a change.
    pub fn differs_materially(&self, other: &Self) -> bool {
        let peers = |status: &Self| {
            let mut peers: Vec<(String, String, MeshPath, Option<String>)> = status
                .peers
                .iter()
                .map(|peer| {
                    (
                        peer.hostname.clone(),
                        peer.virtual_ip.clone(),
                        peer.path,
                        peer.tunnel.clone(),
                    )
                })
                .collect();
            peers.sort_by(|a, b| a.0.cmp(&b.0));
            peers
        };
        let relays = |status: &Self| {
            let mut names: Vec<String> = status
                .relay_nodes
                .iter()
                .map(|node| node.name.clone())
                .collect();
            names.sort();
            names
        };
        self.state != other.state
            || self.reason != other.reason
            || self.virtual_ip != other.virtual_ip
            || self.obp_port != other.obp_port
            || self.restarts != other.restarts
            || peers(self) != peers(other)
            || relays(self) != relays(other)
    }

    /// The peer whose mesh hostname is `device_id`.
    pub fn peer(&self, device_id: &str) -> Option<&MeshPeer> {
        self.peers.iter().find(|peer| peer.hostname == device_id)
    }
}

/// One row of `easytier-cli -o json peer`.
#[derive(Debug, Deserialize)]
struct PeerRow {
    #[serde(default)]
    ipv4: String,
    #[serde(default)]
    hostname: String,
    #[serde(default)]
    cost: String,
    #[serde(default)]
    lat_ms: Option<serde_json::Value>,
    #[serde(default)]
    loss_rate: Option<serde_json::Value>,
    #[serde(default)]
    tunnel_proto: String,
    #[serde(default)]
    nat_type: String,
    #[serde(default)]
    id: Option<serde_json::Value>,
    #[serde(default)]
    version: String,
}

fn number(value: &Option<serde_json::Value>) -> Option<f64> {
    match value.as_ref()? {
        serde_json::Value::Number(number) => number.as_f64(),
        serde_json::Value::String(text) => text.trim_end_matches('%').trim().parse().ok(),
        _ => None,
    }
}

fn text(value: &str) -> Option<String> {
    let value = value.trim();
    (!value.is_empty() && value != "-").then(|| value.to_string())
}

/// Peers and relay nodes from `easytier-cli -o json peer`.
pub fn parse_peers(json: &str) -> Result<(Vec<MeshPeer>, Vec<MeshRelayNode>), String> {
    let rows: Vec<PeerRow> =
        serde_json::from_str(json).map_err(|error| format!("unreadable peer list: {error}"))?;
    let mut peers = Vec::new();
    let mut relays = Vec::new();
    for row in rows {
        if row.cost == "Local" {
            continue;
        }
        let virtual_ip = row.ipv4.split('/').next().unwrap_or_default().to_string();
        if virtual_ip.is_empty() {
            // Relay/discovery nodes have no address in an account network.
            relays.push(MeshRelayNode {
                name: row.hostname.trim_start_matches("PublicServer_").to_string(),
                latency_ms: number(&row.lat_ms),
                tunnel: text(&row.tunnel_proto),
            });
            continue;
        }
        let (path, hops) = if row.cost == "p2p" {
            (MeshPath::P2p, 1)
        } else {
            let hops = row
                .cost
                .trim_start_matches("relay(")
                .trim_end_matches(')')
                .parse()
                .unwrap_or(2);
            (MeshPath::Relayed, hops)
        };
        peers.push(MeshPeer {
            peer_id: match &row.id {
                Some(serde_json::Value::String(id)) => id.clone(),
                Some(other) => other.to_string(),
                None => String::new(),
            },
            hostname: row.hostname,
            virtual_ip,
            path,
            hops,
            latency_ms: number(&row.lat_ms),
            loss_rate: number(&row.loss_rate).map(|percent| percent / 100.0),
            tunnel: text(&row.tunnel_proto),
            nat_type: text(&row.nat_type),
            easytier_version: text(&row.version),
        });
    }
    Ok((peers, relays))
}

/// This node's own facts from `easytier-cli -o json node`.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct NodeFacts {
    pub virtual_ip: Option<String>,
    pub hostname: Option<String>,
    pub nat_type: Option<String>,
}

#[derive(Deserialize)]
struct NodeInfo {
    #[serde(default)]
    ipv4_addr: String,
    #[serde(default)]
    hostname: String,
    #[serde(default)]
    stun_info: Option<StunInfo>,
}

#[derive(Deserialize)]
struct StunInfo {
    #[serde(default)]
    udp_nat_type: i64,
}

/// EasyTier's `NatType` numbering (`common.proto`).
fn nat_type_name(value: i64) -> Option<&'static str> {
    Some(match value {
        1 => "OpenInternet",
        2 => "NoPAT",
        3 => "FullCone",
        4 => "Restricted",
        5 => "PortRestricted",
        6 => "Symmetric",
        7 => "SymUdpFirewall",
        8 => "SymmetricEasyInc",
        9 => "SymmetricEasyDec",
        _ => return None,
    })
}

/// Parses `node` output; only addresses and NAT type are kept.
pub fn parse_node(json: &str) -> Result<NodeFacts, String> {
    let info: NodeInfo = serde_json::from_str(json)
        .map_err(|_| "unreadable node info from easytier-cli".to_string())?;
    Ok(NodeFacts {
        virtual_ip: text(info.ipv4_addr.split('/').next().unwrap_or_default()),
        hostname: text(&info.hostname),
        nat_type: info
            .stun_info
            .and_then(|stun| nat_type_name(stun.udp_nat_type))
            .map(str::to_string),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // Captured from easytier-cli 2.6.4 (`-o json peer`).
    const PEERS: &str = r#"[
      {"cidr":"10.126.126.2/24","ipv4":"10.126.126.2","hostname":"dev-a","cost":"Local","lat_ms":"-","loss_rate":"-","rx_bytes":"-","tx_bytes":"-","tunnel_proto":"-","nat_type":"Symmetric","id":"1959385090","version":"2.6.4-8428a89d"},
      {"cidr":"10.126.126.1/24","ipv4":"10.126.126.1","hostname":"dev-b","cost":"p2p","lat_ms":"0.09","loss_rate":"0.0%","rx_bytes":"2.18 kB","tx_bytes":"2.55 kB","tunnel_proto":"tcp","nat_type":"Symmetric","id":"918793805","version":"2.6.4-8428a89d"},
      {"cidr":"10.126.126.3/24","ipv4":"10.126.126.3","hostname":"dev-c","cost":"relay(2)","lat_ms":"151.2","loss_rate":"1.5%","tunnel_proto":"","nat_type":"PortRestricted","id":"77","version":"2.6.4-8428a89d"},
      {"cidr":"","ipv4":"","hostname":"PublicServer_openbitfun-relay-lw","cost":"p2p","lat_ms":"142.72","loss_rate":"0.0%","tunnel_proto":"wss","nat_type":"PortRestricted","id":"5","version":"2.6.4-8428a89d"}
    ]"#;

    #[test]
    fn classifies_p2p_relayed_and_relay_nodes() {
        let (peers, relays) = parse_peers(PEERS).unwrap();
        assert_eq!(peers.len(), 2);
        assert_eq!(peers[0].hostname, "dev-b");
        assert_eq!(peers[0].path, MeshPath::P2p);
        assert_eq!(peers[0].latency_ms, Some(0.09));
        assert_eq!(peers[0].tunnel.as_deref(), Some("tcp"));
        assert_eq!(peers[1].path, MeshPath::Relayed);
        assert_eq!(peers[1].hops, 2);
        assert_eq!(peers[1].loss_rate, Some(0.015));
        assert_eq!(relays.len(), 1);
        assert_eq!(relays[0].name, "openbitfun-relay-lw");
        assert_eq!(relays[0].tunnel.as_deref(), Some("wss"));
    }

    #[test]
    fn node_info_keeps_addresses_and_drops_the_config() {
        let facts = parse_node(
            r#"{"peer_id":1,"ipv4_addr":"10.126.126.2/24","hostname":"dev-a",
                "stun_info":{"udp_nat_type":6},
                "config":"[network_identity]\nnetwork_secret = \"s\"\n"}"#,
        )
        .unwrap();
        assert_eq!(facts.virtual_ip.as_deref(), Some("10.126.126.2"));
        assert_eq!(facts.nat_type.as_deref(), Some("Symmetric"));
        assert!(!format!("{facts:?}").contains("network_secret"));
        assert!(parse_node("not json").unwrap_err().contains("unreadable"));
    }

    #[test]
    fn latency_jitter_is_not_a_material_change() {
        let (peers, relays) = parse_peers(PEERS).unwrap();
        let mut a = MeshStatus::new(MeshState::Running, None);
        a.peers = peers;
        a.relay_nodes = relays;
        let mut b = a.clone();
        b.peers[0].latency_ms = Some(3.0);
        assert!(!a.differs_materially(&b));
        b.peers[1].path = MeshPath::P2p;
        assert!(a.differs_materially(&b));
    }
}

//! Link status for hosts and UIs: this node's state and, per device, how it
//! is reached (direct over the LAN, IPv4 or IPv6, or relayed through the
//! server or another device), its latency and when it was last seen.
//!
//! Status never carries network credentials or join tokens.

use serde::{Deserialize, Serialize};

/// Lifecycle of the device's Link node.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MeshState {
    /// Turned off (`OPENBITFUN_MESH=off`) or not started by this host.
    Disabled,
    /// No account is signed in; Link needs the account sign-in.
    SignedOut,
    /// This build or server cannot run Link (`reason` says why).
    Unsupported,
    /// Fetching credentials or starting the node.
    Starting,
    /// The node runs.
    Running,
    /// The node stopped unexpectedly; restarting after a backoff.
    Restarting,
    /// Credentials or the node failed; retried later (`reason`).
    Failed,
    /// Stopped (sign-out or shutdown).
    Stopped,
}

/// How traffic reaches a peer (coarse; kept for older UIs).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MeshPath {
    /// Direct connection (LAN or hole-punched).
    P2p,
    /// Forwarded by the relay node or another device.
    Relayed,
}

/// The concrete route to a peer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MeshRoute {
    /// Direct, to a private (LAN) address.
    DirectLan,
    /// Direct over the public IPv4 internet (hole-punched or mapped).
    DirectIpv4,
    /// Direct over IPv6.
    DirectIpv6,
    /// Relayed by the OpenBitFun server (the WebSocket relay path).
    RelayedServer,
    /// Relayed by another device of the account that reaches both.
    RelayedPeer,
}

impl MeshRoute {
    pub fn path(self) -> MeshPath {
        match self {
            Self::DirectLan | Self::DirectIpv4 | Self::DirectIpv6 => MeshPath::P2p,
            Self::RelayedServer | Self::RelayedPeer => MeshPath::Relayed,
        }
    }
}

/// What a node of an account network does.
///
/// Nodes from builds before roles carry none and are devices.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NodeRole {
    /// A host that serves OBP to the account's other devices (desktop
    /// backend, CLI host).
    #[default]
    Device,
    /// Opens streams to devices and serves nothing: the phone app, or the
    /// server gateway acting for a browser. Devices list it as a controller,
    /// never as an unreachable device, and do not probe it.
    Controller,
}

impl NodeRole {
    pub fn is_controller(self) -> bool {
        self == Self::Controller
    }
}

/// Another device in the account network.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeshPeer {
    pub peer_id: String,
    /// The node hostname, which OpenBitFun sets to the account device id.
    pub hostname: String,
    pub virtual_ip: String,
    pub path: MeshPath,
    /// Absent in status documents from hosts before Link.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub route: Option<MeshRoute>,
    /// For `relayed_peer`: the device (its id) that forwards the traffic.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relay_via: Option<String>,
    /// Route cost (1 = direct).
    pub hops: u32,
    /// `controller` for a phone app or browser gateway session (it serves no
    /// OBP); `device` otherwise, including every node from builds before
    /// roles.
    #[serde(default)]
    pub role: NodeRole,
    /// The name the member advertises in Link (a phone app's device name);
    /// hosts prefer the account directory's name when it has one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
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
    /// When this node last saw the peer in its route table (Unix ms).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_seen_ms: Option<u64>,
}

/// A relay node this device is connected to.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeshRelayNode {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latency_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tunnel: Option<String>,
}

/// The device's Link node now.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MeshStatus {
    pub state: MeshState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    pub easytier_version: String,
    /// This device's account device id (its node hostname).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device_id: Option<String>,
    /// The role this node joined with (`device` in documents before roles).
    #[serde(default)]
    pub role: NodeRole,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub virtual_ip: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nat_type: Option<String>,
    /// The OBP listener's port on the virtual IP, while it runs.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub obp_port: Option<u16>,
    pub peers: Vec<MeshPeer>,
    /// Devices seen in the last day that are not in the network now.
    #[serde(default)]
    pub recent_peers: Vec<MeshPeer>,
    pub relay_nodes: Vec<MeshRelayNode>,
    pub restarts: u32,
    /// Always absent since Link (the node runs in-process); kept so older
    /// readers of the document parse it.
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
            role: NodeRole::Device,
            virtual_ip: None,
            nat_type: None,
            obp_port: None,
            peers: Vec::new(),
            recent_peers: Vec::new(),
            relay_nodes: Vec::new(),
            restarts: 0,
            sidecar_pid: None,
            updated_at_ms: crate::now_ms(),
        }
    }

    /// Whether `other` differs in what a UI shows (state, addresses, peer
    /// set and routes, relay nodes); latency jitter alone is not a change.
    pub fn differs_materially(&self, other: &Self) -> bool {
        let peers = |status: &Self| {
            type PeerKey = (
                String,
                String,
                MeshPath,
                Option<MeshRoute>,
                Option<String>,
                NodeRole,
            );
            let mut peers: Vec<PeerKey> = status
                .peers
                .iter()
                .map(|peer| {
                    (
                        peer.hostname.clone(),
                        peer.virtual_ip.clone(),
                        peer.path,
                        peer.route,
                        peer.tunnel.clone(),
                        peer.role,
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
            || self.role != other.role
            || self.virtual_ip != other.virtual_ip
            || self.obp_port != other.obp_port
            || self.restarts != other.restarts
            || peers(self) != peers(other)
            || relays(self) != relays(other)
    }

    /// The peer whose node hostname is `device_id`.
    pub fn peer(&self, device_id: &str) -> Option<&MeshPeer> {
        self.peers.iter().find(|peer| peer.hostname == device_id)
    }

    /// Peers that serve OBP (controllers left out).
    pub fn devices(&self) -> impl Iterator<Item = &MeshPeer> {
        self.peers.iter().filter(|peer| !peer.role.is_controller())
    }

    /// Peers that joined as controllers (phone app, browser gateway).
    pub fn controllers(&self) -> impl Iterator<Item = &MeshPeer> {
        self.peers.iter().filter(|peer| peer.role.is_controller())
    }
}

/// EasyTier's `NatType` numbering (`common.proto`).
pub(crate) fn nat_type_name(value: i32) -> Option<&'static str> {
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

/// An IPv4 network this machine is attached to (address, netmask).
pub(crate) type LocalSubnet = (std::net::Ipv4Addr, std::net::Ipv4Addr);

/// The IPv4 networks of this machine's interfaces.
pub(crate) fn local_subnets() -> Vec<LocalSubnet> {
    use network_interface::{Addr, NetworkInterface, NetworkInterfaceConfig};
    NetworkInterface::show()
        .map(|interfaces| {
            interfaces
                .into_iter()
                .flat_map(|interface| interface.addr)
                .filter_map(|addr| match addr {
                    Addr::V4(v4) => v4.netmask.map(|mask| (v4.ip, mask)),
                    Addr::V6(_) => None,
                })
                .filter(|(ip, _)| !ip.is_loopback())
                .collect()
        })
        .unwrap_or_default()
}

/// Classifies a direct tunnel by the address it reaches the peer at: an
/// address on one of this machine's networks, or a private one, is the LAN.
pub(crate) fn direct_route_for(remote: &str, subnets: &[LocalSubnet]) -> MeshRoute {
    let host = url_host(remote);
    match host.parse::<std::net::IpAddr>() {
        Ok(std::net::IpAddr::V6(v6)) => {
            if let Some(v4) = v6.to_ipv4_mapped() {
                classify_v4(v4, subnets)
            } else if v6.is_unicast_link_local() || v6.is_unique_local() {
                MeshRoute::DirectLan
            } else {
                MeshRoute::DirectIpv6
            }
        }
        Ok(std::net::IpAddr::V4(v4)) => classify_v4(v4, subnets),
        Err(_) => MeshRoute::DirectIpv4,
    }
}

fn classify_v4(v4: std::net::Ipv4Addr, subnets: &[LocalSubnet]) -> MeshRoute {
    let on_local_network = subnets.iter().any(|(ip, mask)| {
        let mask = u32::from(*mask);
        mask != 0 && u32::from(*ip) & mask == u32::from(v4) & mask
    });
    if on_local_network || v4.is_private() || v4.is_link_local() || v4.is_loopback() {
        MeshRoute::DirectLan
    } else {
        MeshRoute::DirectIpv4
    }
}

/// `tcp://[::1]:11010` -> `::1`, `udp://10.0.0.2:11010` -> `10.0.0.2`.
fn url_host(url: &str) -> &str {
    let rest = url.split_once("://").map(|(_, rest)| rest).unwrap_or(url);
    let authority = rest.split(['/', '?', '#']).next().unwrap_or_default();
    if let Some(stripped) = authority.strip_prefix('[') {
        return stripped.split(']').next().unwrap_or_default();
    }
    match authority.rsplit_once(':') {
        Some((host, _)) => host,
        None => authority,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn peer(hostname: &str, route: MeshRoute) -> MeshPeer {
        MeshPeer {
            peer_id: "1".into(),
            hostname: hostname.into(),
            virtual_ip: "10.126.126.2".into(),
            path: route.path(),
            route: Some(route),
            relay_via: None,
            hops: 1,
            role: NodeRole::Device,
            display_name: None,
            latency_ms: Some(1.0),
            loss_rate: None,
            tunnel: Some("udp".into()),
            nat_type: None,
            easytier_version: None,
            last_seen_ms: Some(1),
        }
    }

    #[test]
    fn classifies_direct_tunnels_by_address() {
        let none: &[LocalSubnet] = &[];
        assert_eq!(
            direct_route_for("udp://192.168.1.20:11010", none),
            MeshRoute::DirectLan
        );
        assert_eq!(
            direct_route_for("tcp://10.0.0.2:1", none),
            MeshRoute::DirectLan
        );
        assert_eq!(
            direct_route_for("udp://203.0.113.9:40000", none),
            MeshRoute::DirectIpv4
        );
        // A public-range address on one of this machine's own networks.
        let corporate = [(
            "7.249.253.33".parse().unwrap(),
            "255.255.254.0".parse().unwrap(),
        )];
        assert_eq!(
            direct_route_for("tcp://7.249.252.10:1", &corporate),
            MeshRoute::DirectLan
        );
        assert_eq!(
            direct_route_for("tcp://7.249.250.10:1", &corporate),
            MeshRoute::DirectIpv4
        );
        assert_eq!(
            direct_route_for("udp://[2001:db8::5]:11010", none),
            MeshRoute::DirectIpv6
        );
        assert_eq!(
            direct_route_for("tcp://[fe80::1]:11010", none),
            MeshRoute::DirectLan
        );
        assert_eq!(
            direct_route_for("udp://[::ffff:192.168.0.3]:1", none),
            MeshRoute::DirectLan
        );
        assert_eq!(MeshRoute::RelayedServer.path(), MeshPath::Relayed);
    }

    #[test]
    fn latency_jitter_is_not_a_material_change_but_routes_are() {
        let mut a = MeshStatus::new(MeshState::Running, None);
        a.peers = vec![peer("dev-b", MeshRoute::DirectIpv4)];
        let mut b = a.clone();
        b.peers[0].latency_ms = Some(30.0);
        b.peers[0].last_seen_ms = Some(99);
        assert!(!a.differs_materially(&b));
        b.peers[0].route = Some(MeshRoute::RelayedServer);
        b.peers[0].path = MeshPath::Relayed;
        assert!(a.differs_materially(&b));
        let mut c = a.clone();
        c.peers[0].role = NodeRole::Controller;
        assert!(a.differs_materially(&c));
        assert_eq!(c.devices().count(), 0);
        assert_eq!(c.controllers().count(), 1);
    }

    #[test]
    fn status_documents_from_older_hosts_still_parse() {
        let old = r#"{"state":"running","easytierVersion":"2.6.4","peers":[
            {"peerId":"9","hostname":"dev-b","virtualIp":"10.1.1.2","path":"p2p","hops":1}],
            "relayNodes":[],"restarts":0,"sidecarPid":42,"updatedAtMs":1}"#;
        let status: MeshStatus = serde_json::from_str(old).unwrap();
        assert_eq!(status.peers[0].route, None);
        // Nodes before roles are devices.
        assert_eq!(status.peers[0].role, NodeRole::Device);
        assert_eq!(status.role, NodeRole::Device);
        assert_eq!(status.devices().count(), 1);
        assert!(status.recent_peers.is_empty());
        let json = serde_json::to_string(&MeshStatus::new(MeshState::Running, None)).unwrap();
        assert!(!json.contains("sidecarPid"));
        assert!(json.contains(r#""role":"device""#));
        let mut controller = peer("phone-1", MeshRoute::RelayedServer);
        controller.role = NodeRole::Controller;
        let json = serde_json::to_string(&controller).unwrap();
        assert!(json.contains(r#""role":"controller""#));
        let back: MeshPeer = serde_json::from_str(&json).unwrap();
        assert_eq!(back.role, NodeRole::Controller);
    }
}

//! One running Link node: the EasyTier fork in this process.
//!
//! The node runs on the host's Tokio runtime (no threads of its own), in
//! userspace: no TUN device, no root, no proxy port. Peers reach this device
//! through virtual TCP streams the node accepts on its OBP listener port;
//! this device reaches peers by opening virtual TCP streams through the
//! node's userspace stack ([`LinkNode::connect`]).

use std::collections::HashMap;
use std::net::{Ipv4Addr, SocketAddr};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use easytier::openbitfun::{create_instance_on_current_runtime, NativeCoreInstance};
use easytier_core::config::toml::TomlConfig;
use easytier_core::gateway::{DataPlaneTcpListener, DataPlaneTcpStream};
use tokio::sync::watch;
use tokio::task::JoinHandle;

use crate::status::{
    direct_route_for, local_subnets, nat_type_name, LocalSubnet, MeshPeer, MeshRelayNode,
    MeshRoute, MeshState, MeshStatus, NodeRole,
};
use crate::stream::{LinkListener, LinkStream};

/// How long a device that left the network stays in `recent_peers`.
const RECENT_PEER_TTL_MS: u64 = 24 * 60 * 60 * 1000;

/// How a node presents itself to the account's other members.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct NodeProfile {
    pub role: NodeRole,
    /// Advertised to the account's members (at most 64 bytes); `None` for
    /// hosts the account directory names.
    pub display_name: Option<String>,
}

/// What the node needs to start.
#[derive(Clone)]
pub struct NodeOptions {
    /// The rendered EasyTier configuration (holds the network secret).
    pub config_toml: String,
    pub network_name: String,
    /// The node hostname (the account device id for device nodes).
    pub hostname: String,
    /// The current join token, attached to every handshake it starts.
    pub join_token: Option<String>,
    /// How often the status is rebuilt while running.
    pub status_interval: Duration,
}

impl std::fmt::Debug for NodeOptions {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("NodeOptions")
            .field("network_name", &self.network_name)
            .field("hostname", &self.hostname)
            .field("status_interval", &self.status_interval)
            .finish_non_exhaustive()
    }
}

struct Inner {
    instance: Arc<NativeCoreInstance>,
    network_name: String,
    hostname: String,
    role: NodeRole,
    status: watch::Sender<MeshStatus>,
    seen: Mutex<HashMap<String, MeshPeer>>,
    obp_port: Mutex<Option<u16>>,
    subnets: Mutex<Option<(std::time::Instant, Vec<LocalSubnet>)>>,
}

/// A running node. Dropping it without [`LinkNode::stop`] stops the status
/// task but leaves the instance to stop with the runtime.
pub struct LinkNode {
    inner: Arc<Inner>,
    poller: Mutex<Option<JoinHandle<()>>>,
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl LinkNode {
    /// Starts a device node (fails when the configuration is refused or the
    /// listeners cannot bind).
    pub async fn start(options: NodeOptions) -> Result<Arc<Self>, String> {
        Self::start_as(options, NodeRole::Device).await
    }

    /// Starts a node in `role`. A controller's route info carries the
    /// controller flag, so the account's devices list it as a controller and
    /// do not probe it; render its config with
    /// [`crate::DeviceNodeConfig::render_as`] in the same role.
    pub async fn start_as(options: NodeOptions, role: NodeRole) -> Result<Arc<Self>, String> {
        Self::start_with(
            options,
            NodeProfile {
                role,
                display_name: None,
            },
        )
        .await
    }

    /// Starts a node with its role and the display name it advertises to
    /// the account's other members ([`MeshPeer::display_name`]).
    pub async fn start_with(
        options: NodeOptions,
        profile: NodeProfile,
    ) -> Result<Arc<Self>, String> {
        let role = profile.role;
        let config = TomlConfig::new_from_str(&options.config_toml)
            .map_err(|_| "the Link configuration was refused".to_string())?;
        easytier::openbitfun::set_controller(
            &options.network_name,
            &options.hostname,
            role.is_controller(),
        );
        easytier::openbitfun::set_display_name(
            &options.network_name,
            &options.hostname,
            profile.display_name.as_deref(),
        );
        easytier::openbitfun::set_join_token(
            &options.network_name,
            &options.hostname,
            options
                .join_token
                .as_ref()
                .map(|token| token.as_bytes().to_vec()),
        );
        let instance = create_instance_on_current_runtime(config)
            .map_err(|error| format!("failed to create the Link node: {error}"))?;
        if let Err(error) = instance.start().await {
            instance.stop().await;
            easytier::openbitfun::set_join_token(&options.network_name, &options.hostname, None);
            easytier::openbitfun::set_controller(&options.network_name, &options.hostname, false);
            easytier::openbitfun::set_display_name(&options.network_name, &options.hostname, None);
            return Err(format!("failed to start the Link node: {error}"));
        }
        let mut initial = MeshStatus::new(MeshState::Running, None);
        initial.device_id = Some(options.hostname.clone());
        initial.role = role;
        let inner = Arc::new(Inner {
            instance,
            network_name: options.network_name,
            hostname: options.hostname,
            role,
            status: watch::channel(initial).0,
            seen: Mutex::new(HashMap::new()),
            obp_port: Mutex::new(None),
            subnets: Mutex::new(None),
        });
        let poll_inner = Arc::clone(&inner);
        let interval = options.status_interval.max(Duration::from_millis(200));
        let poller = tokio::spawn(async move {
            loop {
                poll_inner.refresh().await;
                tokio::time::sleep(interval).await;
            }
        });
        Ok(Arc::new(Self {
            inner,
            poller: Mutex::new(Some(poller)),
        }))
    }

    /// Replaces the join token new handshakes carry.
    pub fn set_join_token(&self, token: Option<&str>) {
        easytier::openbitfun::set_join_token(
            &self.inner.network_name,
            &self.inner.hostname,
            token.map(|token| token.as_bytes().to_vec()),
        );
    }

    /// Stops the node and closes every stream it carries.
    pub async fn stop(&self) {
        if let Some(poller) = lock(&self.poller).take() {
            poller.abort();
        }
        self.inner.instance.stop().await;
        easytier::openbitfun::set_join_token(&self.inner.network_name, &self.inner.hostname, None);
        easytier::openbitfun::set_controller(&self.inner.network_name, &self.inner.hostname, false);
        easytier::openbitfun::set_display_name(
            &self.inner.network_name,
            &self.inner.hostname,
            None,
        );
        self.inner.status.send_modify(|status| {
            status.state = MeshState::Stopped;
            status.peers.clear();
            status.relay_nodes.clear();
            status.updated_at_ms = crate::now_ms();
        });
    }

    /// Whether the instance stopped (on its own or through [`Self::stop`]).
    pub fn has_stopped(&self) -> bool {
        matches!(
            self.inner.instance.state(),
            easytier_core::instance::CoreInstanceState::Stopping
                | easytier_core::instance::CoreInstanceState::Stopped
        )
    }

    pub fn network_name(&self) -> &str {
        &self.inner.network_name
    }

    pub fn hostname(&self) -> &str {
        &self.inner.hostname
    }

    /// The role this node joined with.
    pub fn role(&self) -> NodeRole {
        self.inner.role
    }

    /// Changes the display name this node advertises (members see it after
    /// the next route update, within seconds).
    pub fn set_display_name(&self, name: Option<&str>) {
        easytier::openbitfun::set_display_name(
            &self.inner.network_name,
            &self.inner.hostname,
            name,
        );
    }

    /// The latest status (rebuilt every status interval).
    pub fn status(&self) -> MeshStatus {
        self.inner.status.borrow().clone()
    }

    /// Notified whenever the status is rebuilt.
    pub fn subscribe(&self) -> watch::Receiver<MeshStatus> {
        self.inner.status.subscribe()
    }

    /// Rebuilds the status now.
    pub async fn refresh_status(&self) -> MeshStatus {
        self.inner.refresh().await;
        self.status()
    }

    /// This node's virtual IPv4 address, once assigned.
    pub async fn virtual_ip(&self) -> Option<Ipv4Addr> {
        self.inner
            .instance
            .node_snapshot()
            .await
            .ipv4_addr
            .map(|inet| inet.address())
    }

    /// The virtual address of the device named `device_id`, from the live
    /// route table.
    pub async fn resolve(&self, device_id: &str) -> Option<Ipv4Addr> {
        self.resolve_member(device_id).await.map(|(ip, _)| ip)
    }

    /// The virtual address and role of the member named `device_id`.
    pub async fn resolve_member(&self, device_id: &str) -> Option<(Ipv4Addr, NodeRole)> {
        let route = self
            .inner
            .instance
            .route_snapshots()
            .await
            .into_iter()
            .find(|route| route.hostname == device_id)?;
        let ip = route
            .ipv4_addr
            .and_then(|inet| inet.address)
            .map(Ipv4Addr::from)?;
        let role = role_from_flag(route.feature_flag.is_some_and(|flags| flags.obf_controller));
        Some((ip, role))
    }

    /// The device whose virtual address is `ip`.
    pub async fn device_for_ip(&self, ip: Ipv4Addr) -> Option<String> {
        self.inner
            .instance
            .route_snapshots()
            .await
            .into_iter()
            .find(|route| {
                route
                    .ipv4_addr
                    .and_then(|inet| inet.address)
                    .map(Ipv4Addr::from)
                    == Some(ip)
            })
            .map(|route| route.hostname)
    }

    /// Opens a virtual TCP stream to `port` on the device `device_id`.
    pub async fn connect(
        &self,
        device_id: &str,
        port: u16,
        timeout: Duration,
    ) -> Result<LinkStream, String> {
        let (ip, role) = self.resolve_member(device_id).await.ok_or_else(|| {
            format!("mesh_unreachable: device {device_id} is not in the account network")
        })?;
        if role.is_controller() {
            return Err(format!(
                "mesh_controller: {device_id} is a controller (phone app or browser) and serves no backend"
            ));
        }
        self.connect_addr(SocketAddr::from((ip, port)), timeout)
            .await
            .map(|stream| stream.with_peer_device(device_id.to_string()))
    }

    /// Waits until this node has its virtual address (DHCP), up to
    /// `timeout`. Streams opened before that would be reset when the address
    /// is assigned.
    pub async fn wait_for_address(&self, timeout: Duration) -> Result<Ipv4Addr, String> {
        let deadline = tokio::time::Instant::now() + timeout;
        loop {
            if let Some(ip) = self.virtual_ip().await {
                return Ok(ip);
            }
            if tokio::time::Instant::now() >= deadline {
                return Err("mesh_unavailable: this device has no Link address yet".to_string());
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }

    /// Opens a virtual TCP stream to `addr` (a virtual address).
    pub async fn connect_addr(
        &self,
        addr: SocketAddr,
        timeout: Duration,
    ) -> Result<LinkStream, String> {
        self.wait_for_address(timeout).await?;
        let stream: DataPlaneTcpStream = self
            .inner
            .instance
            .data_plane_tcp_connect(addr, timeout)
            .await
            .map_err(|error| format!("mesh_unreachable: {addr}: {error}"))?;
        Ok(LinkStream::new(stream, addr))
    }

    /// Listens for virtual TCP streams on `port` of this node's address.
    pub async fn bind(&self, port: u16, timeout: Duration) -> Result<LinkListener, String> {
        let listener: DataPlaneTcpListener = self
            .inner
            .instance
            .data_plane_tcp_bind(port, timeout)
            .await
            .map_err(|error| format!("failed to listen on Link port {port}: {error}"))?;
        Ok(LinkListener::new(listener))
    }

    /// Closes this node's direct connections to `device_id` (LAN or
    /// hole-punched); its streams continue through the relay, and P2P is
    /// attempted again as usual. Returns how many connections closed. For
    /// diagnostics and for hosts that know a network path just changed.
    pub async fn close_direct_paths(&self, device_id: &str) -> usize {
        let Some(peer_id) = self
            .inner
            .instance
            .route_snapshots()
            .await
            .into_iter()
            .find(|route| route.hostname == device_id)
            .map(|route| route.peer_id)
        else {
            return 0;
        };
        let mut closed = 0;
        for peer in self.inner.instance.peer_snapshots().await {
            if peer.peer_id != peer_id {
                continue;
            }
            for conn in peer.conns.iter().filter(|conn| !conn.is_closed) {
                let Ok(conn_id) = conn.conn_id.parse() else {
                    continue;
                };
                if self
                    .inner
                    .instance
                    .close_peer_conn(peer_id, &conn_id)
                    .await
                    .is_ok()
                {
                    closed += 1;
                }
            }
        }
        closed
    }

    /// Records the OBP listener port reported in the status.
    pub fn set_obp_port(&self, port: Option<u16>) {
        *lock(&self.inner.obp_port) = port;
        self.inner
            .status
            .send_modify(|status| status.obp_port = port);
    }
}

#[cfg(test)]
impl LinkNode {
    /// Test hook: dials `url` directly (a manual peer), as a punched or LAN
    /// connection would.
    pub(crate) fn add_direct_peer(&self, url: &str) {
        self.inner
            .instance
            .add_connector(url.parse().expect("peer url"))
            .expect("add connector");
    }

    /// Test hook: forgets the manual peer `url` and closes the direct
    /// connections to `device_id`.
    pub(crate) async fn drop_direct_peer(&self, url: &str, device_id: &str) -> usize {
        self.inner
            .instance
            .remove_connector(&url.parse().expect("peer url"));
        self.close_direct_paths(device_id).await
    }
}

impl Drop for LinkNode {
    fn drop(&mut self) {
        if let Some(poller) = lock(&self.poller).take() {
            poller.abort();
        }
    }
}

/// The role a route advertises (`PeerFeatureFlag.obf_controller`).
fn role_from_flag(controller: bool) -> NodeRole {
    if controller {
        NodeRole::Controller
    } else {
        NodeRole::Device
    }
}

impl Inner {
    async fn refresh(&self) {
        let now = crate::now_ms();
        let node = self.instance.node_snapshot().await;
        let routes = self.instance.route_snapshots().await;
        let direct = self.instance.peer_snapshots().await;
        let subnets = {
            let mut cache = lock(&self.subnets);
            match cache.as_ref() {
                Some((at, subnets)) if at.elapsed() < Duration::from_secs(30) => subnets.clone(),
                _ => {
                    let subnets = local_subnets();
                    *cache = Some((std::time::Instant::now(), subnets.clone()));
                    subnets
                }
            }
        };

        // Direct connections by peer id: (route, latency ms, loss, tunnel).
        let mut direct_by_peer = HashMap::new();
        for peer in &direct {
            let best = peer
                .conns
                .iter()
                .filter(|conn| !conn.is_closed)
                .min_by_key(|conn| conn.stats.map(|stats| stats.latency_us).unwrap_or(u64::MAX));
            if let Some(conn) = best {
                let remote = conn
                    .tunnel
                    .as_ref()
                    .and_then(|tunnel| tunnel.remote_addr.as_ref())
                    .map(|url| url.url.clone())
                    .unwrap_or_default();
                let tunnel = conn
                    .tunnel
                    .as_ref()
                    .map(|tunnel| tunnel.tunnel_type.clone())
                    .filter(|kind| !kind.is_empty());
                direct_by_peer.insert(
                    peer.peer_id,
                    (
                        remote,
                        conn.stats.map(|stats| stats.latency_us as f64 / 1000.0),
                        f64::from(conn.loss_rate),
                        tunnel,
                    ),
                );
            }
        }

        let relay_ids: std::collections::HashSet<u32> = routes
            .iter()
            .filter(|route| {
                route
                    .feature_flag
                    .is_some_and(|flags| flags.is_public_server)
                    || route.ipv4_addr.and_then(|inet| inet.address).is_none()
            })
            .map(|route| route.peer_id)
            .collect();

        let hostname_by_peer: HashMap<u32, String> = routes
            .iter()
            .map(|route| (route.peer_id, route.hostname.clone()))
            .collect();
        let mut peers = Vec::new();
        let mut relays = Vec::new();
        for route in &routes {
            if relay_ids.contains(&route.peer_id) {
                let direct = direct_by_peer.get(&route.peer_id);
                relays.push(MeshRelayNode {
                    name: route
                        .hostname
                        .trim_start_matches("PublicServer_")
                        .to_string(),
                    latency_ms: direct.and_then(|(_, latency, _, _)| *latency),
                    tunnel: direct.and_then(|(_, _, _, tunnel)| tunnel.clone()),
                });
                continue;
            }
            let virtual_ip = route
                .ipv4_addr
                .and_then(|inet| inet.address)
                .map(|addr| Ipv4Addr::from(addr).to_string())
                .unwrap_or_default();
            let relay_via = (!relay_ids.contains(&route.next_hop_peer_id)
                && !direct_by_peer.contains_key(&route.peer_id))
            .then(|| hostname_by_peer.get(&route.next_hop_peer_id).cloned())
            .flatten();
            let (route_kind, latency_ms, loss_rate, tunnel) =
                match direct_by_peer.get(&route.peer_id) {
                    Some((remote, latency, loss, tunnel)) => (
                        direct_route_for(remote, &subnets),
                        *latency,
                        Some(*loss),
                        tunnel.clone(),
                    ),
                    None => (
                        if relay_ids.contains(&route.next_hop_peer_id) {
                            MeshRoute::RelayedServer
                        } else {
                            MeshRoute::RelayedPeer
                        },
                        (route.path_latency > 0).then_some(f64::from(route.path_latency)),
                        None,
                        None,
                    ),
                };
            peers.push(MeshPeer {
                peer_id: route.peer_id.to_string(),
                hostname: route.hostname.clone(),
                virtual_ip,
                path: route_kind.path(),
                route: Some(route_kind),
                relay_via: (route_kind == MeshRoute::RelayedPeer)
                    .then_some(relay_via)
                    .flatten(),
                hops: route.cost.max(1) as u32,
                role: role_from_flag(route.feature_flag.is_some_and(|flags| flags.obf_controller)),
                display_name: (!route.obf_display_name.is_empty())
                    .then(|| route.obf_display_name.clone()),
                latency_ms,
                loss_rate,
                tunnel,
                nat_type: route
                    .stun_info
                    .as_ref()
                    .and_then(|stun| nat_type_name(stun.udp_nat_type))
                    .map(str::to_string),
                easytier_version: (!route.version.is_empty()).then(|| route.version.clone()),
                last_seen_ms: Some(now),
            });
        }
        peers.sort_by(|a, b| a.hostname.cmp(&b.hostname));

        let recent_peers = {
            let mut seen = lock(&self.seen);
            for peer in &peers {
                seen.insert(peer.hostname.clone(), peer.clone());
            }
            seen.retain(|_, peer| {
                peer.last_seen_ms
                    .is_some_and(|at| now.saturating_sub(at) < RECENT_PEER_TTL_MS)
            });
            let mut recent: Vec<MeshPeer> = seen
                .values()
                .filter(|peer| peer.last_seen_ms != Some(now))
                .cloned()
                .collect();
            recent.sort_by(|a, b| a.hostname.cmp(&b.hostname));
            recent
        };

        let obp_port = *lock(&self.obp_port);
        self.status.send_modify(|status| {
            status.state = MeshState::Running;
            status.reason = None;
            status.device_id = Some(self.hostname.clone());
            status.role = self.role;
            status.virtual_ip = node.ipv4_addr.map(|inet| inet.address().to_string());
            status.nat_type = nat_type_name(node.stun_info.udp_nat_type).map(str::to_string);
            status.obp_port = obp_port;
            status.peers = peers;
            status.recent_peers = recent_peers;
            status.relay_nodes = relays;
            status.updated_at_ms = now;
        });
    }
}

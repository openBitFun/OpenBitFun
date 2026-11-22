//! What a runtime host plugs into the fleet layer.
//!
//! Desktop and CLI hosts run the same fleet layer; this module is the glue
//! they share, so a host only provides its [`FleetBackend`] (local digest
//! and dispatcher), its account directory, and its links:
//!
//! - [`FleetHost`]: the fleet of one signed-in account on this host. It owns
//!   the index, the router, the replication driver and the event mux, and
//!   answers every `fleet_*` verb a host dispatcher receives
//!   ([`FleetHost::dispatch`]). It is started when the host's mesh listener
//!   starts for an account and shut down when it stops.
//! - [`LinksPeerTransport`]: [`FleetPeerTransport`] over the host's
//!   [`PeerLinks`] (index links, plain calls with the owner's errors
//!   unchanged) and a [`FleetPresenceSource`].
//! - [`LinkPresence`]: presence from the host's Link node (who is on the
//!   device network, and how it is reached) merged with the account
//!   directory (names, host kinds, versions, relay-only hosts).
//! - [`LinkPeerConnector`]: [`PeerConnector`] over a Link node and the
//!   host's [`MeshAuthority`], for hosts without a mesh runtime of their own
//!   (the CLI).
//!
//! The `fleet_ui_bundle` choice ([`choose_ui_bundle`]) also lives here: the
//! newest web UI among the online fleet hosts a browser can run against this
//! entry, with every holder of that bundle for the server's pool.

use std::collections::HashMap;
use std::net::{Ipv4Addr, SocketAddr};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use openbitfun_link::session::Link;
use openbitfun_link::{MeshPeer, MeshRoute};
use openbitfun_product_domains::fleet::*;
use serde::de::DeserializeOwned;
use serde_json::{json, Value};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

use super::attention::FleetAttention;
use super::index::FleetIndex;
use super::mux::{serve_replay, FleetClientKey, FleetMux};
use super::router::{FleetBackend, FleetRouter};
use super::sync::{
    FleetPeerLinkInfo, FleetPeerPresence, FleetPeerSignal, FleetPeerSubscription,
    FleetPeerTransport, FleetSync, FleetSyncConfig,
};
use super::views::FleetViews;
use super::{FleetCallError, FleetFuture};
use crate::authority::{MeshAuthority, MeshIo};
use crate::client::links::{ConnectFuture, LinkState, PeerConnector, PeerLinks};
use crate::client::{MeshConnectOptions, MeshConnector, MeshDialer, MeshOpenFuture, MeshTarget};
use crate::events::EventHub;

/// Every `fleet_*` verb a host dispatcher hands to [`FleetHost::dispatch`].
pub const FLEET_HOST_COMMANDS: &[&str] = &[
    "fleet_attention",
    "fleet_attention_mark_read",
    "fleet_blob_get",
    "fleet_blob_holders",
    "fleet_call",
    "fleet_device_detail",
    "fleet_digest",
    "fleet_events",
    "fleet_models",
    "fleet_navigator",
    "fleet_prompts",
    "fleet_recent_sessions",
    "fleet_replay",
    "fleet_replica_digest",
    "fleet_replica_list",
    "fleet_replica_pull",
    "fleet_replica_push",
    "fleet_subscribe",
    "fleet_ui_bundle",
];

/// The owner verbs (`fleet_v1`): same-account host verbs another runtime
/// host calls on the mesh listener (`ObpBackend::is_account_device_host_verb`).
pub const FLEET_OWNER_VERBS: &[&str] = &[
    "fleet_digest",
    "fleet_replay",
    // The account replica (`fleet::replica`, `account_replica_v1`).
    "fleet_blob_get",
    "fleet_blob_holders",
    "fleet_replica_digest",
    "fleet_replica_list",
    "fleet_replica_pull",
    "fleet_replica_push",
];

/// The error prefix while a host has no fleet (signed out, device network
/// off, or still starting).
pub const FLEET_UNAVAILABLE: &str = "fleet_unavailable";

/// Whether `command` is a fleet verb [`FleetHost::dispatch`] answers.
pub fn is_fleet_host_command(command: &str) -> bool {
    FLEET_HOST_COMMANDS.contains(&command)
}

/// Whether `command` is an owner verb (`fleet_digest`, `fleet_replay`).
pub fn is_fleet_owner_verb(command: &str) -> bool {
    FLEET_OWNER_VERBS.contains(&command)
}

/// The answer of a host without a running fleet.
pub fn fleet_unavailable(command: &str) -> String {
    format!(
        "{FLEET_UNAVAILABLE}: command '{command}' needs this device signed in to an account with its device network running"
    )
}

/// The longest `fleet_events` long poll.
const MAX_EVENTS_WAIT: Duration = Duration::from_secs(25);
/// How long `fleet_ui_bundle` waits for each peer's manifest.
const UI_BUNDLE_PEER_TIMEOUT: Duration = Duration::from_secs(5);
/// Peers asked for their manifest by one `fleet_ui_bundle`.
const UI_BUNDLE_MAX_PEERS: usize = 8;
/// How long a directory read is reused for presence.
const DIRECTORY_TTL: Duration = Duration::from_secs(60);
/// How long opening a Link stream to a peer may take.
const LINK_OPEN_TIMEOUT: Duration = Duration::from_secs(15);

fn request_of<T: DeserializeOwned + Default>(args: &Value) -> Result<T, String> {
    match args.get("request") {
        None | Some(Value::Null) => Ok(T::default()),
        Some(request) => serde_json::from_value(request.clone())
            .map_err(|error| format!("invalid fleet request: {error}")),
    }
}

fn to_value<T: serde::Serialize>(value: T) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|error| error.to_string())
}

/// Runs a `fleet_call` aimed at this host exactly as a plain `call` from
/// another device of the account would run: the `account-device` allowlist
/// (a forbidden command is `-32003`, `data.kind = "forbidden"`), then the
/// host's dispatcher (a failure is `-32000`, `data.kind` `unsupported` or
/// `command`). The local and the forwarded path answer alike.
///
/// Only `Owner` and `AccountDevice` callers may reach `fleet_call` (enforced
/// by [`crate::server::check_command`] and [`FleetRouter::fleet_call_for_scope`]);
/// `Scope::CloudAgent` is never admitted here.
pub async fn dispatch_as_account_device(
    backend: &dyn crate::server::ObpBackend,
    device_id: &str,
    command: String,
    args: Value,
) -> Result<Value, FleetCallError> {
    let scope = crate::server::Scope::AccountDevice {
        device_id: device_id.to_string(),
    };
    let host_verb = |name: &str| backend.is_account_device_host_verb(name);
    if let Err(refusal) = crate::server::check_command(&scope, &command, &host_verb) {
        return Err(FleetCallError {
            code: -32003,
            message: refusal,
            data: Some(json!({
                "kind": "forbidden",
                "command": command,
                "scope": "account-device",
            })),
        });
    }
    let args = if args.is_null() {
        Value::Object(Default::default())
    } else {
        args
    };
    backend
        .dispatch(command.clone(), args)
        .await
        .map_err(|message| {
            let kind = if backend.is_unsupported_error(&message) {
                "unsupported"
            } else {
                "command"
            };
            FleetCallError {
                code: -32000,
                message,
                data: Some(json!({ "kind": kind, "command": command })),
            }
        })
}

// ---------------------------------------------------------------------------
// Presence
// ---------------------------------------------------------------------------

/// The other devices of the account as the host sees them now.
pub trait FleetPresenceSource: Send + Sync + 'static {
    fn presence(&self) -> FleetFuture<'_, Vec<FleetPeerPresence>>;
    /// Whether the last [`Self::presence`] listed every runtime host of the
    /// account (the account directory was read), so a device missing from
    /// it has left the account and is dropped from the index. `false` (the
    /// default) never drops anything.
    fn lists_every_device(&self) -> bool {
        false
    }
}

/// Drops from the index the devices that left the account: after a
/// presence read that listed every device, any indexed device it does not
/// name (other than this host) is removed. A device that is only offline or
/// unreachable stays listed (stale), since the directory still names it.
struct DepartedDevices {
    inner: Arc<dyn FleetPresenceSource>,
    index: Arc<FleetIndex>,
}

impl FleetPresenceSource for DepartedDevices {
    fn presence(&self) -> FleetFuture<'_, Vec<FleetPeerPresence>> {
        Box::pin(async move {
            let presence = self.inner.presence().await;
            if self.inner.lists_every_device() {
                let listed: std::collections::BTreeSet<&str> = presence
                    .iter()
                    .map(|peer| peer.device_id.as_str())
                    .collect();
                for device_id in self.index.device_ids() {
                    if device_id != self.index.self_device_id()
                        && !listed.contains(device_id.as_str())
                        && self.index.remove_device(&device_id)
                    {
                        log::info!(
                            "Fleet dropped a device that left the account: device={device_id}"
                        );
                    }
                }
            }
            presence
        })
    }

    fn lists_every_device(&self) -> bool {
        self.inner.lists_every_device()
    }
}

/// One device row of the account directory.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct FleetDirectoryDevice {
    pub device_id: String,
    /// Alias first, else the reported name.
    pub name: String,
    /// `desktop`, `cli`, `mobile`, `watch`, `cloud_agent`; `None` for a row
    /// that predates kind reporting (a desktop).
    pub kind: Option<String>,
    /// The legacy relay socket is up (hosts on Link do not keep one).
    pub online: bool,
    pub version: Option<String>,
    pub last_seen_ms: Option<u64>,
}

/// The account directory of the signed-in account.
pub trait FleetDirectory: Send + Sync + 'static {
    fn devices(&self) -> FleetFuture<'_, Result<Vec<FleetDirectoryDevice>, String>>;
}

fn host_kind_of(kind: Option<&str>) -> Option<FleetHostKind> {
    match kind {
        None | Some("desktop") => Some(FleetHostKind::Desktop),
        Some("cli") => Some(FleetHostKind::Cli),
        // Controllers (phones, watches) are not runtime hosts this layer
        // dials; the cloud agent is listed from its own row (see
        // `merge_presence_with`), never as a device-network peer.
        _ => None,
    }
}

fn is_cloud_row(row: &FleetDirectoryDevice) -> bool {
    row.kind.as_deref() == Some(openbitfun_product_domains::superagent::CLOUD_AGENT_DIRECTORY_KIND)
        && crate::client::cloud::is_cloud_device_id(&row.device_id)
}

fn route_of(peer: &MeshPeer) -> Option<FleetDeviceRoute> {
    let kind = peer
        .route
        .map(|route: MeshRoute| {
            serde_json::to_value(route)
                .ok()
                .and_then(|value| serde_json::from_value::<FleetRouteKind>(value).ok())
                .unwrap_or_default()
        })
        .unwrap_or_default();
    Some(FleetDeviceRoute {
        kind,
        latency_ms: peer
            .latency_ms
            .filter(|latency| latency.is_finite() && *latency >= 0.0)
            .map(|latency| latency.round().min(u32::MAX as f64) as u32),
        relay_via: peer.relay_via.clone(),
    })
}

/// The presence of every other runtime host of the account: devices on the
/// device network (reached over OBP), directory hosts that are only on the
/// legacy relay (`mesh: false`, shown `update_required`), and directory
/// hosts that are offline. `directory` is `None` when it could not be read;
/// the device network alone is then the truth.
pub fn merge_presence(
    self_id: &str,
    peers: &[MeshPeer],
    directory: Option<&[FleetDirectoryDevice]>,
    now_ms: u64,
) -> Vec<FleetPeerPresence> {
    merge_presence_with(self_id, peers, directory, now_ms, false)
}

/// [`merge_presence`], plus the account's cloud node from its directory row
/// (kind `cloud_agent`): online and dialed when this host has a cloud
/// dialer (`dials_cloud_node`, [`crate::client::cloud::WithCloudNode`]),
/// otherwise listed `unknown` with `cloud_connector_unavailable` and never
/// dialed. The node is not on the device network, so a Link peer that
/// claims its id is ignored.
pub fn merge_presence_with(
    self_id: &str,
    peers: &[MeshPeer],
    directory: Option<&[FleetDirectoryDevice]>,
    now_ms: u64,
    dials_cloud_node: bool,
) -> Vec<FleetPeerPresence> {
    let mut presence = merge_device_presence(self_id, peers, directory, now_ms);
    for row in directory.unwrap_or_default() {
        if !is_cloud_row(row) || row.device_id == self_id {
            continue;
        }
        presence.retain(|peer| peer.device_id != row.device_id);
        presence.push(FleetPeerPresence {
            device_id: row.device_id.clone(),
            name: openbitfun_product_domains::superagent::cloud_node_display_name(&row.name)
                .to_string(),
            host_kind: FleetHostKind::Cloud,
            // Always on the account server; whether it answers is the link's.
            online: true,
            mesh: true,
            route: None,
            version: row.version.clone(),
            as_of_ms: now_ms,
            unsupported: (!dials_cloud_node)
                .then(|| crate::client::cloud::CLOUD_CONNECTOR_UNAVAILABLE.to_string()),
        });
    }
    presence
}

fn merge_device_presence(
    self_id: &str,
    peers: &[MeshPeer],
    directory: Option<&[FleetDirectoryDevice]>,
    now_ms: u64,
) -> Vec<FleetPeerPresence> {
    let rows: HashMap<&str, &FleetDirectoryDevice> = directory
        .unwrap_or_default()
        .iter()
        .map(|row| (row.device_id.as_str(), row))
        .collect();
    let mut seen = std::collections::BTreeSet::new();
    let mut presence = Vec::new();
    for peer in peers {
        let id = peer.hostname.as_str();
        if id == self_id
            || peer.role.is_controller()
            || !openbitfun_link::handshake::valid_device_id(id)
            || !seen.insert(id.to_string())
        {
            continue;
        }
        let row = rows.get(id).copied();
        let Some(host_kind) = host_kind_of(row.and_then(|row| row.kind.as_deref())) else {
            continue;
        };
        presence.push(FleetPeerPresence {
            device_id: id.to_string(),
            name: row
                .map(|row| row.name.clone())
                .filter(|name| !name.trim().is_empty())
                .or_else(|| peer.display_name.clone())
                .unwrap_or_else(|| id.to_string()),
            host_kind,
            online: true,
            mesh: true,
            route: route_of(peer),
            version: row.and_then(|row| row.version.clone()),
            as_of_ms: now_ms,
            unsupported: None,
        });
    }
    for row in directory.unwrap_or_default() {
        let id = row.device_id.as_str();
        if id == self_id || seen.contains(id) || !openbitfun_link::handshake::valid_device_id(id) {
            continue;
        }
        let Some(host_kind) = host_kind_of(row.kind.as_deref()) else {
            continue;
        };
        seen.insert(id.to_string());
        presence.push(FleetPeerPresence {
            device_id: id.to_string(),
            name: if row.name.trim().is_empty() {
                id.to_string()
            } else {
                row.name.clone()
            },
            host_kind,
            // On the legacy relay only: a host older than the device
            // network (update required). Otherwise it is simply offline.
            online: row.online,
            mesh: !row.online,
            route: None,
            version: row.version.clone(),
            as_of_ms: row.last_seen_ms.unwrap_or(now_ms),
            unsupported: None,
        });
    }
    presence
}

/// Presence from a Link node and the account directory.
pub struct LinkPresence {
    link: Arc<Link>,
    self_id: String,
    directory: Arc<dyn FleetDirectory>,
    /// The host's links can reach the account's cloud node.
    dials_cloud_node: bool,
    cache: Mutex<Option<(Instant, Vec<FleetDirectoryDevice>)>>,
    /// The last read had a directory (fresh or the last good one).
    complete: std::sync::atomic::AtomicBool,
}

impl LinkPresence {
    pub fn new(link: Arc<Link>, self_id: String, directory: Arc<dyn FleetDirectory>) -> Arc<Self> {
        Self::with_cloud_node(link, self_id, directory, false)
    }

    /// Presence for a host whose links dial the account's cloud node
    /// (`dials_cloud_node`) or list it unknown (see [`merge_presence_with`]).
    pub fn with_cloud_node(
        link: Arc<Link>,
        self_id: String,
        directory: Arc<dyn FleetDirectory>,
        dials_cloud_node: bool,
    ) -> Arc<Self> {
        Arc::new(Self {
            link,
            self_id,
            directory,
            dials_cloud_node,
            cache: Mutex::new(None),
            complete: std::sync::atomic::AtomicBool::new(false),
        })
    }

    async fn directory(&self) -> Option<Vec<FleetDirectoryDevice>> {
        let cached = self
            .cache
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .as_ref()
            .filter(|(at, _)| at.elapsed() < DIRECTORY_TTL)
            .map(|(_, rows)| rows.clone());
        if cached.is_some() {
            return cached;
        }
        match self.directory.devices().await {
            Ok(rows) => {
                *self.cache.lock().unwrap_or_else(|p| p.into_inner()) =
                    Some((Instant::now(), rows.clone()));
                Some(rows)
            }
            Err(error) => {
                log::debug!("Fleet presence without the account directory: {error}");
                // An older read is better than none.
                self.cache
                    .lock()
                    .unwrap_or_else(|p| p.into_inner())
                    .as_ref()
                    .map(|(_, rows)| rows.clone())
            }
        }
    }
}

impl FleetPresenceSource for LinkPresence {
    fn presence(&self) -> FleetFuture<'_, Vec<FleetPeerPresence>> {
        Box::pin(async move {
            let status = self.link.status();
            let directory = self.directory().await;
            self.complete
                .store(directory.is_some(), std::sync::atomic::Ordering::SeqCst);
            merge_presence_with(
                &self.self_id,
                &status.peers,
                directory.as_deref(),
                crate::now_ms(),
                self.dials_cloud_node,
            )
        })
    }

    fn lists_every_device(&self) -> bool {
        self.complete.load(std::sync::atomic::Ordering::SeqCst)
    }
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

/// [`FleetPeerTransport`] over the host's [`PeerLinks`].
pub struct LinksPeerTransport {
    links: Arc<PeerLinks>,
    presence: Arc<dyn FleetPresenceSource>,
    /// The newest subscription per device: an older pump that ends after a
    /// re-subscription must not release the new subscription's link.
    generations: Arc<Mutex<HashMap<String, u64>>>,
}

impl LinksPeerTransport {
    pub fn new(links: Arc<PeerLinks>, presence: Arc<dyn FleetPresenceSource>) -> Arc<Self> {
        Arc::new(Self {
            links,
            presence,
            generations: Arc::default(),
        })
    }
}

fn link_info(
    hello: &Value,
    capabilities: Vec<String>,
    host_capabilities: Vec<String>,
) -> FleetPeerLinkInfo {
    FleetPeerLinkInfo {
        instance_id: hello["backend"]["instanceId"].as_str().map(str::to_string),
        capabilities,
        host_capabilities,
        version: hello["backend"]["version"].as_str().map(str::to_string),
    }
}

/// Forwards the events of the index link to `device_id` until the
/// subscriber goes away or the link closes. A reconnect of the link is
/// invisible here (the link resumes); a new peer instance shows as an
/// `events-dropped` notice, which the sync answers with a full pull.
async fn pump_index_events(
    links: Arc<PeerLinks>,
    device_id: String,
    tx: mpsc::UnboundedSender<FleetPeerSignal>,
    generations: Arc<Mutex<HashMap<String, u64>>>,
    generation: u64,
) {
    let mut cursor: Option<u64> = None;
    let mut instance: Option<String> = None;
    loop {
        if tx.is_closed() {
            break;
        }
        let batch = match links
            .events(&device_id, cursor, instance.as_deref(), MAX_EVENTS_WAIT)
            .await
        {
            Ok(batch) => batch,
            Err(error) => {
                let _ = tx.send(FleetPeerSignal::Closed { reason: error });
                break;
            }
        };
        if batch.instance_id.is_some() {
            instance = batch.instance_id.clone();
        }
        for event in batch.events {
            if let Some(seq) = event["seq"].as_u64() {
                cursor = Some(seq);
            }
            let name = event["event"].as_str().unwrap_or_default().to_string();
            let payload = event.get("payload").cloned().unwrap_or(Value::Null);
            if tx
                .send(FleetPeerSignal::Event {
                    event: name,
                    payload,
                })
                .is_err()
            {
                break;
            }
        }
        if batch.state == LinkState::Closed {
            let _ = tx.send(FleetPeerSignal::Closed {
                reason: batch
                    .error
                    .unwrap_or_else(|| "the link to the device closed".to_string()),
            });
            break;
        }
    }
    let newest = generations
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .get(&device_id)
        .copied();
    if newest == Some(generation) {
        links.release_index(&device_id).await;
    }
}

impl FleetPeerTransport for LinksPeerTransport {
    fn presence(&self) -> FleetFuture<'_, Vec<FleetPeerPresence>> {
        self.presence.presence()
    }

    fn subscribe_index(
        &self,
        device_id: &str,
    ) -> FleetFuture<'_, Result<FleetPeerSubscription, String>> {
        let device_id = device_id.to_string();
        Box::pin(async move {
            let info = self.links.connect_index(&device_id).await?;
            let hello = self.links.hello_of(&device_id).await.unwrap_or_default();
            let link = link_info(&hello, info.capabilities, info.host_capabilities);
            let (tx, signals) = mpsc::unbounded_channel();
            let generation = {
                let mut generations = self.generations.lock().unwrap_or_else(|p| p.into_inner());
                let next = generations.get(&device_id).copied().unwrap_or(0) + 1;
                generations.insert(device_id.clone(), next);
                next
            };
            tokio::spawn(pump_index_events(
                Arc::clone(&self.links),
                device_id,
                tx,
                Arc::clone(&self.generations),
                generation,
            ));
            Ok(FleetPeerSubscription { link, signals })
        })
    }

    fn call(
        &self,
        device_id: &str,
        command: &str,
        args: Value,
    ) -> FleetFuture<'_, Result<Value, FleetCallError>> {
        let device_id = device_id.to_string();
        let command = command.to_string();
        Box::pin(async move {
            // A forwarded call opens an idle-expirable RPC link when the index
            // has none yet (a legacy peer polled earlier, or a link that was
            // released), so it never permanently pins `holds.index`.
            if self.links.state_of(&device_id).await.is_none() {
                self.links
                    .connect_rpc(&device_id)
                    .await
                    .map_err(FleetCallError::transport)?;
            }
            self.links
                .call_typed(&device_id, &command, args)
                .await
                .map_err(FleetCallError::from)
        })
    }
}

/// Raw streams through a Link node.
struct LinkStreams(Arc<Link>);

impl MeshConnector for LinkStreams {
    fn open(&self, ip: Ipv4Addr, port: u16) -> MeshOpenFuture<'_> {
        Box::pin(async move {
            let node = self
                .0
                .node()
                .ok_or_else(|| "mesh_unavailable: the device network is not running".to_string())?;
            let stream = node
                .connect_addr(SocketAddr::from((ip, port)), LINK_OPEN_TIMEOUT)
                .await?;
            Ok(Box::new(stream) as Box<dyn MeshIo>)
        })
    }
}

/// [`PeerConnector`] over a Link node: finds the device in the node's route
/// table and dials its OBP listener with the account-device handshake.
pub struct LinkPeerConnector {
    link: Arc<Link>,
    authority: Arc<dyn MeshAuthority>,
}

impl LinkPeerConnector {
    pub fn new(link: Arc<Link>, authority: Arc<dyn MeshAuthority>) -> Arc<Self> {
        Arc::new(Self { link, authority })
    }
}

impl PeerConnector for LinkPeerConnector {
    fn connect(&self, device_id: String, options: MeshConnectOptions) -> ConnectFuture {
        let link = Arc::clone(&self.link);
        let authority = Arc::clone(&self.authority);
        Box::pin(async move {
            let mut status = link.status();
            if status.peer(&device_id).is_none() {
                status = link.refresh().await;
            }
            let peer = status.peer(&device_id).ok_or_else(|| {
                format!("mesh_unreachable: device {device_id} is not in the account mesh right now")
            })?;
            if peer.role.is_controller() {
                return Err(format!(
                    "mesh_controller: {device_id} is a controller (phone app or browser) and serves no backend"
                ));
            }
            if status.virtual_ip.as_deref() == Some(peer.virtual_ip.as_str()) {
                return Err(format!(
                    "mesh_unreachable: device {device_id} shares this device's mesh address while the mesh resolves the conflict; retry in a few seconds"
                ));
            }
            let virtual_ip: Ipv4Addr = peer.virtual_ip.parse().map_err(|_| {
                format!("mesh_unreachable: device {device_id} has no mesh address yet")
            })?;
            let dialer = MeshDialer {
                connector: Arc::new(LinkStreams(Arc::clone(&link))),
                authority,
            };
            let target = MeshTarget {
                device_id,
                virtual_ip,
                port: None,
            };
            dialer.connect(&target, options).await
        })
    }

    fn route(&self, device_id: &str) -> Option<(String, Option<f64>)> {
        let status = self.link.status();
        let peer = status.peer(device_id)?;
        let path = serde_json::to_value(peer.path)
            .ok()?
            .as_str()
            .map(str::to_string)?;
        Some((path, peer.latency_ms))
    }
}

// ---------------------------------------------------------------------------
// UI bundle
// ---------------------------------------------------------------------------

/// `major.minor.patch[-pre][+build]` as an ordered key; a release sorts
/// after its pre-releases. `None` for anything else.
fn parse_version(text: &str) -> Option<(u64, u64, u64, bool)> {
    let text = text.trim().trim_start_matches('v');
    let text = text.split('+').next().unwrap_or_default();
    let (core, pre) = match text.split_once('-') {
        Some((core, pre)) => (core, !pre.is_empty()),
        None => (text, false),
    };
    let mut parts = core.split('.').map(|part| part.parse::<u64>().ok());
    let version = (parts.next()??, parts.next()??, parts.next()??, !pre);
    parts.next().is_none().then_some(version)
}

/// The web UI a browser should load through this entry: among the
/// `ui_bundle_manifest` answers of the entry (`entry_device_id`) and of
/// online fleet hosts, the newest manifest version a browser can run against
/// this entry (`minEntryFleetProtocol` at most this build's fleet protocol),
/// the entry's own on a tie. The bundle id is recomputed from each manifest
/// (a stated id is never trusted), and every device with that id is a
/// holder (the entry first). `None` when nobody ships a usable bundle.
pub fn choose_ui_bundle(
    entry_device_id: &str,
    answers: &[(String, Value)],
) -> Option<FleetUiBundleResponse> {
    struct Candidate<'a> {
        device_id: &'a str,
        manifest: &'a Value,
        bundle_id: String,
        version: Option<(u64, u64, u64, bool)>,
    }
    let candidates: Vec<Candidate<'_>> = answers
        .iter()
        .filter_map(|(device_id, answer)| {
            let manifest = answer.get("manifest")?;
            let bundle_id = crate::ui_bundle::bundle_id(manifest).ok()?;
            let needs = manifest
                .get("minEntryFleetProtocol")
                .and_then(Value::as_u64)
                .unwrap_or(0);
            if needs > u64::from(FLEET_PROTOCOL_VERSION) {
                return None;
            }
            let version = manifest
                .get("version")
                .and_then(Value::as_str)
                .and_then(parse_version);
            Some(Candidate {
                device_id,
                manifest,
                bundle_id,
                version,
            })
        })
        .collect();
    let best = candidates.iter().max_by(|a, b| {
        a.version
            .cmp(&b.version)
            .then_with(|| (a.device_id == entry_device_id).cmp(&(b.device_id == entry_device_id)))
            // Lower device id wins the remaining tie (max_by keeps the last).
            .then_with(|| b.device_id.cmp(a.device_id))
    })?;
    let mut holders: Vec<String> = candidates
        .iter()
        .filter(|candidate| candidate.bundle_id == best.bundle_id)
        .map(|candidate| candidate.device_id.to_string())
        .collect();
    holders.sort_by(|a, b| {
        (b == entry_device_id)
            .cmp(&(a == entry_device_id))
            .then_with(|| a.cmp(b))
    });
    holders.dedup();
    Some(FleetUiBundleResponse {
        manifest: best.manifest.clone(),
        bundle_id: best.bundle_id.clone(),
        owner_device_id: best.device_id.to_string(),
        holders,
    })
}

// ---------------------------------------------------------------------------
// The fleet of one account on this host
// ---------------------------------------------------------------------------

/// What a host hands to [`FleetHost::start`].
pub struct FleetHostParts {
    pub backend: Arc<dyn FleetBackend>,
    pub links: Arc<PeerLinks>,
    pub presence: Arc<dyn FleetPresenceSource>,
    pub authority: Arc<dyn MeshAuthority>,
    /// The host's event stream (the fleet layer's own events go here, and
    /// `fleet://digest-changed` on it drives the local partition).
    pub hub: Arc<EventHub>,
    /// `<data>/fleet/index.json` (`index::index_cache_path`).
    pub cache_path: Option<PathBuf>,
    pub config: FleetSyncConfig,
    /// Called with the name of every event on `hub` (the host marks its
    /// digest dirty for the relevant ones).
    pub on_local_event: Option<LocalEventHook>,
}

/// A host callback for the names of its own events.
pub type LocalEventHook = Arc<dyn Fn(&str) + Send + Sync>;

/// The fleet of one signed-in account on this host.
pub struct FleetHost {
    device_id: String,
    backend: Arc<dyn FleetBackend>,
    links: Arc<PeerLinks>,
    hub: Arc<EventHub>,
    index: Arc<FleetIndex>,
    router: Arc<FleetRouter>,
    sync: Arc<FleetSync>,
    mux: Arc<FleetMux>,
    /// The Inbox (`fleet_attention`).
    attention: Arc<FleetAttention>,
    /// `fleet_recent_sessions`, `fleet_device_detail`.
    views: Arc<FleetViews>,
    watcher: Mutex<Option<JoinHandle<()>>>,
    /// Links to the account's other devices (the account replica uses them).
    transport: Arc<dyn FleetPeerTransport>,
    /// The account replica's exchange, once the host attached one.
    replica: Mutex<Option<Arc<super::replica::ReplicaSync>>>,
}

impl FleetHost {
    /// Starts the fleet of `device_id` (needs a Tokio runtime): loads the
    /// cached index, starts replication, and follows the host's own
    /// `fleet://digest-changed`.
    pub fn start(device_id: String, parts: FleetHostParts) -> Arc<Self> {
        let FleetHostParts {
            backend,
            links,
            presence,
            authority,
            hub,
            cache_path,
            config,
            on_local_event,
        } = parts;
        let sink: Arc<dyn super::FleetEventSink> = Arc::clone(&hub) as _;
        let index = FleetIndex::new(device_id.clone(), cache_path, Some(sink));
        let presence: Arc<dyn FleetPresenceSource> = Arc::new(DepartedDevices {
            inner: presence,
            index: Arc::clone(&index),
        });
        let transport: Arc<dyn FleetPeerTransport> =
            LinksPeerTransport::new(Arc::clone(&links), presence);
        let router = FleetRouter::new(
            Arc::clone(&backend),
            Arc::clone(&index),
            Arc::clone(&transport),
        );
        let attention = FleetAttention::new(
            Arc::clone(&index),
            Arc::clone(&transport),
            Some(Arc::clone(&hub) as Arc<dyn super::FleetEventSink>),
        );
        let sync = FleetSync::new(
            Arc::clone(&index),
            Arc::clone(&backend),
            Arc::clone(&transport),
            config,
        );
        sync.start();
        sync.local_changed();
        sync.presence_changed();
        let mux = FleetMux::new(authority, Arc::clone(&hub), Arc::clone(&links));
        let views = FleetViews::new(Arc::clone(&index), Arc::clone(&attention));
        let host = Arc::new(Self {
            device_id,
            backend,
            links,
            hub: Arc::clone(&hub),
            index,
            router,
            sync: Arc::clone(&sync),
            mux,
            attention: Arc::clone(&attention),
            views,
            watcher: Mutex::new(None),
            transport,
            replica: Mutex::new(None),
        });
        let weak = Arc::downgrade(&sync);
        let attention = Arc::downgrade(&attention);
        let watcher = tokio::spawn(async move {
            let mut events = hub.subscribe(None);
            loop {
                let batch = events.next_batch(256).await;
                let Some(sync) = weak.upgrade() else { return };
                if let Some(hook) = on_local_event.as_ref() {
                    for event in &batch.events {
                        hook(&event.event);
                    }
                }
                if batch
                    .events
                    .iter()
                    .any(|event| event.event == FLEET_DIGEST_CHANGED_EVENT)
                {
                    sync.local_changed();
                }
                // The Inbox is a projection of the index.
                if batch.events.iter().any(|event| {
                    event.event == FLEET_INDEX_CHANGED_EVENT
                        || event.event == FLEET_PROMPTS_CHANGED_EVENT
                }) {
                    if let Some(attention) = attention.upgrade() {
                        attention.local_changed();
                    }
                }
                if batch.closed {
                    return;
                }
            }
        });
        *host.watcher.lock().unwrap_or_else(|p| p.into_inner()) = Some(watcher);
        log::info!("Fleet started for this device");
        host
    }

    /// This host's device id.
    pub fn device_id(&self) -> &str {
        &self.device_id
    }

    /// The event mux (`ObpBackend::fleet_mux`).
    pub fn mux(&self) -> Arc<FleetMux> {
        Arc::clone(&self.mux)
    }

    pub fn router(&self) -> &Arc<FleetRouter> {
        &self.router
    }

    pub fn index(&self) -> &Arc<FleetIndex> {
        &self.index
    }

    pub fn sync(&self) -> &Arc<FleetSync> {
        &self.sync
    }

    /// The Inbox (`fleet_attention`).
    pub fn attention(&self) -> &Arc<FleetAttention> {
        &self.attention
    }

    /// The view models (`fleet_recent_sessions`, `fleet_device_detail`).
    pub fn views(&self) -> &Arc<FleetViews> {
        &self.views
    }

    /// Runs one command on another device of the account over this host's
    /// links (the owner's errors unchanged). The model catalog uses it for
    /// the model relay (`fleet_model_*`).
    pub async fn call_device(
        &self,
        device_id: &str,
        command: &str,
        args: Value,
    ) -> Result<Value, String> {
        self.links.call(device_id, command, args).await
    }

    /// The device network changed (a device came, left, or moved).
    pub fn presence_changed(&self) {
        self.sync.presence_changed();
        if let Some(replica) = self.replica_sync() {
            replica.wake();
        }
    }

    /// Attaches the account replica (`fleet::replica`) and starts its
    /// exchange with the account's other devices; replaces an earlier one.
    pub fn attach_replica(
        &self,
        replica: Arc<super::replica::AccountReplica>,
    ) -> Arc<super::replica::ReplicaSync> {
        // Super Agent history: every replica that serves the cloud node pins
        // the conversation chunks (`superagent_archive`).
        super::superagent_archive::declare(&replica);
        let sync = super::replica::ReplicaSync::new(
            replica,
            Arc::clone(&self.transport),
            super::replica::ReplicaSyncConfig::default(),
        );
        sync.start();
        if let Some(previous) = self
            .replica
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .replace(Arc::clone(&sync))
        {
            previous.shutdown();
        }
        sync
    }

    /// The account replica's exchange, when attached.
    pub fn replica_sync(&self) -> Option<Arc<super::replica::ReplicaSync>> {
        self.replica
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .clone()
    }

    /// Answers a fleet verb; `None` for any other command. `instance_id` is
    /// this host's OBP server instance (the replay key). `fleet_subscribe`
    /// and `fleet_events` serve the in-process client (the native desktop UI);
    /// OBP connections answer them in the connection layer.
    pub async fn dispatch(
        &self,
        command: &str,
        args: Value,
        instance_id: &str,
    ) -> Option<Result<Value, String>> {
        if !is_fleet_host_command(command) {
            return None;
        }
        if super::replica::REPLICA_VERBS.contains(&command) {
            return Some(match self.replica_sync() {
                Some(sync) => sync
                    .replica()
                    .handle(command, &args)
                    .unwrap_or_else(|| Err(format!("fleet verb {command} has no handler"))),
                None => Err(format!(
                    "{FLEET_UNAVAILABLE}: the account replica is not running on this device"
                )),
            });
        }
        // A frontend's Super Agent history call leaves with what this
        // device's replica holds (`superagent_archive`).
        let args = match (command, self.replica_sync()) {
            ("fleet_call", Some(sync)) => {
                super::superagent_archive::augment_fleet_call(&sync, args).await
            }
            _ => args,
        };
        if let Some(result) = self.attention.handle(command, &args).await {
            return Some(result);
        }
        if let Some(result) = self.views.handle(command, &args).await {
            return Some(result);
        }
        if let Some(result) = self.router.handle(command, args.clone()).await {
            return Some(result.map_err(FleetCallError::into_message));
        }
        Some(match command {
            "fleet_replay" => request_of::<FleetReplayRequest>(&args)
                .and_then(|request| to_value(serve_replay(&self.hub, instance_id, &request))),
            "fleet_subscribe" => match request_of::<FleetSubscribeRequest>(&args) {
                Ok(request) => self.subscribe(request).await.and_then(to_value),
                Err(error) => Err(error),
            },
            "fleet_events" => match request_of::<FleetEventsRequest>(&args) {
                Ok(request) => to_value(self.events(request).await),
                Err(error) => Err(error),
            },
            "fleet_ui_bundle" => self.ui_bundle().await.and_then(to_value),
            other => Err(format!("fleet verb {other} has no handler on this host")),
        })
    }

    /// `fleet_subscribe` for the in-process client.
    pub async fn subscribe(
        &self,
        request: FleetSubscribeRequest,
    ) -> Result<FleetSubscribeResponse, String> {
        self.mux
            .set_follow(FleetClientKey::Local, request.follow)
            .await;
        Ok(FleetSubscribeResponse { applied: true })
    }

    /// `fleet_events` for the in-process client.
    pub async fn events(&self, request: FleetEventsRequest) -> FleetEventsResponse {
        let wait = Duration::from_millis(request.wait_ms.unwrap_or(0)).min(MAX_EVENTS_WAIT);
        self.mux
            .poll(FleetClientKey::Local, &request.cursor, wait)
            .await
    }

    /// `fleet_ui_bundle`.
    pub async fn ui_bundle(&self) -> Result<FleetUiBundleResponse, String> {
        let request = json!({ "request": {} });
        let mut answers: Vec<(String, Value)> = Vec::new();
        match self
            .backend
            .dispatch_local("ui_bundle_manifest".to_string(), request.clone())
            .await
        {
            Ok(answer) => answers.push((self.device_id.clone(), answer)),
            Err(error) => log::debug!("This host ships no web UI: {}", error.message),
        }
        let peers: Vec<String> = self
            .index
            .navigator(None)
            .devices
            .into_iter()
            .filter(|device| {
                device.device_id != self.device_id
                    && device.state == FleetDeviceState::Online
                    && device.fleet_protocol.is_some()
            })
            .map(|device| device.device_id)
            .take(UI_BUNDLE_MAX_PEERS)
            .collect();
        let asks = peers.into_iter().map(|device_id| {
            let links = Arc::clone(&self.links);
            let request = request.clone();
            async move {
                let answer = tokio::time::timeout(
                    UI_BUNDLE_PEER_TIMEOUT,
                    links.call_typed(&device_id, "ui_bundle_manifest", request),
                )
                .await;
                match answer {
                    Ok(Ok(answer)) => Some((device_id, answer)),
                    _ => None,
                }
            }
        });
        answers.extend(futures::future::join_all(asks).await.into_iter().flatten());
        choose_ui_bundle(&self.device_id, &answers).ok_or_else(|| {
            format!(
                "{}: no online device of this account ships a web UI this entry can serve",
                crate::ui_bundle::UNAVAILABLE
            )
        })
    }

    /// Stops replication, releases every index link and writes the cache.
    pub fn shutdown(&self) {
        if let Some(watcher) = self
            .watcher
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .take()
        {
            watcher.abort();
        }
        self.sync.shutdown();
        if let Some(replica) = self
            .replica
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .take()
        {
            replica.shutdown();
        }
        log::info!("Fleet stopped for this device");
    }
}

impl Drop for FleetHost {
    fn drop(&mut self) {
        if let Some(watcher) = self
            .watcher
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .take()
        {
            watcher.abort();
        }
    }
}

#[cfg(test)]
#[path = "host_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "host_e2e_tests.rs"]
mod e2e_tests;

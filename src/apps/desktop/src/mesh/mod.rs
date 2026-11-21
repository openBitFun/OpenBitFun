//! The device network (OpenBitFun Link) of the native desktop host.
//!
//! While an account is signed in, this host runs Link in-process
//! (`openbitfun-link`: the EasyTier fork, joined with the account's
//! credentials and a short-lived join token from the account issuer), serves
//! OBP to other devices of the account on Link's inbound streams
//! (`backend_protocol::ws::mesh`), and exposes `mesh_status`,
//! `mesh_list_devices` and [`connect_device`] for controllers. The old relay
//! server is never a transport here: it is only read as the account's device
//! directory (names and public keys). No sidecar process, no proxy port, and
//! no network credential ever reaches a UI.
//!
//! Remote scenarios: Link is a transport between same-account devices. It
//! does not change remote workspaces (they keep running where they are), and
//! its commands are `ControllerLocal`: a remote client sees the backend's
//! network only through its own host.

pub mod mesh_api;
pub mod peer_link;
pub mod route;

#[cfg(test)]
mod directory_tests;

use std::collections::HashMap;
use std::net::{Ipv4Addr, SocketAddr};
use std::path::Path;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use openbitfun_link::session::{AccountIdentity, AccountSession, BoxFuture, Link, LinkOptions};
use openbitfun_link::{MeshPath, MeshRoute, MeshState, MeshStatus, NodeRole};
use serde::Serialize;
use tokio::sync::watch;

use crate::backend_protocol::ws::mesh_client::{
    MeshConnectOptions, MeshConnector, MeshDialer, MeshObpConnection, MeshOpenFuture, MeshTarget,
};
use crate::backend_protocol::ws::{
    MeshAcceptFuture, MeshAuthority, MeshIncoming, MeshInfo, MeshIo, ObpServer, PairKeyFuture,
};

/// Event emitted (owner scope only) when the network status changes materially.
pub const MESH_STATUS_CHANGED_EVENT: &str = "mesh://status-changed";

const PROBE_CACHE_TTL: Duration = Duration::from_secs(30);
const DIRECTORY_CACHE_TTL: Duration = Duration::from_secs(60);
const OPEN_TIMEOUT: Duration = Duration::from_secs(15);

/// The account behind the running network.
#[derive(Clone, PartialEq, Eq)]
struct AccountKey {
    user_id: String,
    device_id: String,
}

/// The same-account directory through the signed-in account session.
struct AccountMeshAuthority {
    account: AccountKey,
}

impl MeshAuthority for AccountMeshAuthority {
    fn local_device_id(&self) -> Option<String> {
        Some(self.account.device_id.clone())
    }

    fn pair_key<'a>(&'a self, device_id: &'a str) -> PairKeyFuture<'a> {
        Box::pin(async move {
            if !openbitfun_link::handshake::valid_device_id(device_id) {
                return Err("invalid device id".to_string());
            }
            // The new-version account directory, never the legacy relay.
            crate::api::account_directory::with_directory_session(
                |session, directory_url| async move {
                    if session.user_id != self.account.user_id {
                        return Err("the signed-in account changed".to_string());
                    }
                    session
                        .peer_message_key(&directory_url, device_id)
                        .await
                        .map_err(|error| format!("device key lookup failed: {error}"))
                },
            )
            .await
        })
    }

    /// The directory row kind (the same cached key lookup): `cloud_agent`
    /// gives the account's cloud agent its narrow scope.
    fn device_kind<'a>(&'a self, device_id: &'a str) -> openbitfun_obp::DeviceKindFuture<'a> {
        Box::pin(async move {
            crate::api::account_directory::with_directory_session(
                |session, directory_url| async move {
                    if session.user_id != self.account.user_id {
                        return Err("the signed-in account changed".to_string());
                    }
                    session
                        .peer_device_kind(&directory_url, device_id)
                        .await
                        .map_err(|error| format!("device kind lookup failed: {error}"))
                },
            )
            .await
        })
    }
}

/// The desktop's account session as Link needs it.
struct DesktopAccountSession;

impl AccountSession for DesktopAccountSession {
    fn identity(&self) -> BoxFuture<'_, Option<AccountIdentity>> {
        Box::pin(async {
            MeshRuntime::account().await.map(|account| AccountIdentity {
                user_id: account.user_id,
                device_id: account.device_id,
            })
        })
    }

    fn access_token(&self) -> BoxFuture<'_, Result<Option<String>, String>> {
        Box::pin(async {
            let mut identity = openbitfun_services_integrations::account_identity::AccountIdentityClient::from_environment()
                .await
                .map_err(|error| error.to_string())?;
            identity
                .access_token()
                .await
                .map_err(|error| error.to_string())
        })
    }
}

/// Link's inbound OBP streams as the mesh listener's source.
struct LinkIncoming(Arc<Link>);

impl MeshIncoming for LinkIncoming {
    fn accept(&self) -> MeshAcceptFuture<'_> {
        Box::pin(async move {
            let stream = self.0.accept().await?;
            let peer = stream.peer_addr();
            Some((Box::new(stream) as Box<dyn MeshIo>, peer))
        })
    }

    fn port(&self) -> Option<u16> {
        self.0.status().obp_port
    }
}

/// Outbound streams through this process's Link node.
struct LinkConnector(Arc<Link>);

impl MeshConnector for LinkConnector {
    fn open(&self, ip: Ipv4Addr, port: u16) -> MeshOpenFuture<'_> {
        Box::pin(async move {
            let node = self
                .0
                .node()
                .ok_or_else(|| "mesh_unavailable: the device network is not running".to_string())?;
            let stream = node
                .connect_addr(SocketAddr::from((ip, port)), OPEN_TIMEOUT)
                .await?;
            Ok(Box::new(stream) as Box<dyn MeshIo>)
        })
    }
}

#[derive(Clone)]
struct ProbeEntry {
    at: Instant,
    virtual_ip: String,
    result: Result<(u16, MeshInfo), String>,
}

/// One device in `mesh_list_devices`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeshDeviceEntry {
    pub device_id: String,
    /// Directory name (alias first), else the name the member advertises
    /// in Link (a phone app); `None` when neither is known.
    pub name: Option<String>,
    pub virtual_ip: String,
    /// `controller` for a phone app or browser session in the account
    /// network: it drives devices and serves no backend, so it is never
    /// probed and is not an unreachable device.
    pub role: NodeRole,
    /// The device answered on its OBP listener (always `false` for a
    /// controller).
    pub reachable: bool,
    pub path: MeshPath,
    /// Direct (LAN / IPv4 / IPv6) or relayed (server / another device).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub route: Option<MeshRoute>,
    /// The device relaying the traffic, for `relayed_peer`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub relay_via: Option<String>,
    pub hops: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latency_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_seen_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub obp_protocol: Option<u32>,
    pub capabilities: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub obp_port: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub backend_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// The device network of this process.
pub struct MeshRuntime {
    obp: Option<Arc<ObpServer>>,
    link: Arc<Link>,
    status: watch::Sender<MeshStatus>,
    /// The account whose OBP mesh listener runs.
    serving: tokio::sync::Mutex<Option<AccountKey>>,
    probes: Mutex<HashMap<String, ProbeEntry>>,
    directory: Mutex<Option<(Instant, HashMap<String, String>)>>,
}

static RUNTIME: OnceLock<Arc<MeshRuntime>> = OnceLock::new();

/// The running network runtime, when the native host started one.
pub fn global() -> Option<Arc<MeshRuntime>> {
    RUNTIME.get().cloned()
}

fn emit_status(status: &MeshStatus) {
    if let Some(app) = crate::api::remote_connect_api::account_app_handle() {
        if let Err(error) = app.emit(MESH_STATUS_CHANGED_EVENT, status.clone()) {
            log::warn!("Failed to emit {}: {}", MESH_STATUS_CHANGED_EVENT, error);
        }
    }
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl MeshRuntime {
    fn new(link: Arc<Link>, obp: Option<Arc<ObpServer>>) -> Arc<Self> {
        Arc::new(Self {
            obp,
            status: watch::channel(link.status()).0,
            link,
            serving: tokio::sync::Mutex::new(None),
            probes: Mutex::new(HashMap::new()),
            directory: Mutex::new(None),
        })
    }

    /// The current status.
    pub fn status(&self) -> MeshStatus {
        self.status.borrow().clone()
    }

    fn publish(&self, status: MeshStatus) {
        let changed = self.status.send_if_modified(|current| {
            let changed = current.differs_materially(&status);
            *current = status;
            changed
        });
        if changed {
            emit_status(&self.status.borrow());
            // Devices came, left, or changed route: the fleet re-reads presence.
            crate::fleet::presence_changed();
        }
    }

    /// Re-checks the account now (sign-in or sign-out just happened).
    pub fn wake(&self) {
        self.link.wake();
    }

    async fn account() -> Option<AccountKey> {
        let (session, _) = crate::api::account_directory::read_directory_context()
            .await
            .ok()?;
        let device_id = crate::api::remote_connect_api::current_device_id_for_peer().ok()?;
        Some(AccountKey {
            user_id: session.user_id,
            device_id,
        })
    }

    /// Keeps the OBP mesh listener in step with Link: serving while Link
    /// runs for an account, stopped (with every mesh connection and Peer
    /// Device Mode link) when it stops or the account changes.
    async fn reconcile_listener(self: &Arc<Self>, status: &MeshStatus) {
        let account = if status.state == MeshState::Running {
            self.link.account().await.map(|account| AccountKey {
                user_id: account.user_id,
                device_id: account.device_id,
            })
        } else {
            None
        };
        let mut serving = self.serving.lock().await;
        if *serving == account {
            return;
        }
        if serving.take().is_some() {
            // The fleet and Peer Device Mode links ride the network; they end
            // with it.
            crate::fleet::stop();
            peer_link::shutdown_global().await;
            if let Some(server) = &self.obp {
                server.stop_mesh();
            }
            lock(&self.probes).clear();
            *lock(&self.directory) = None;
        }
        let Some(account) = account else {
            return;
        };
        if let Some(server) = &self.obp {
            let authority: Arc<dyn MeshAuthority> = Arc::new(AccountMeshAuthority {
                account: account.clone(),
            });
            // The fleet first, so the first hello already advertises it.
            crate::fleet::start(
                account.device_id.clone(),
                Arc::clone(&authority),
                Arc::clone(&self.link),
            );
            // The account replica (synced settings) rides the fleet.
            crate::api::account_settings_sync_api::attach_replica(&account.user_id);
            let local = SocketAddr::from((
                Ipv4Addr::UNSPECIFIED,
                status
                    .obp_port
                    .unwrap_or(openbitfun_link::MESH_OBP_PORT_FIRST),
            ));
            if let Err(error) = server
                .start_mesh_with(
                    authority,
                    Arc::new(LinkIncoming(Arc::clone(&self.link))),
                    local,
                )
                .await
            {
                log::warn!("OBP mesh listener not started: {}", error);
                crate::fleet::stop();
                return;
            }
        }
        *serving = Some(account);
    }

    async fn run(self: Arc<Self>) {
        let mut updates = self.link.subscribe();
        loop {
            let status = updates.borrow_and_update().clone();
            self.reconcile_listener(&status).await;
            self.publish(status);
            if updates.changed().await.is_err() {
                break;
            }
        }
    }

    /// A fresh status.
    pub async fn refresh(&self) -> MeshStatus {
        let status = self.link.refresh().await;
        self.publish(status);
        self.status()
    }

    async fn dialer(&self) -> Result<MeshDialer, String> {
        let account = self.serving.lock().await.clone();
        match (self.link.node(), account) {
            (Some(_), Some(account)) => Ok(MeshDialer {
                connector: Arc::new(LinkConnector(Arc::clone(&self.link))),
                authority: Arc::new(AccountMeshAuthority { account }),
            }),
            _ => Err(match self.status().state {
                MeshState::SignedOut => {
                    "mesh_signed_out: sign in to reach your other devices".to_string()
                }
                state => format!(
                    "mesh_unavailable: the device network is not running ({state:?}); {}",
                    self.status().reason.unwrap_or_default()
                ),
            }),
        }
    }

    async fn probe(
        &self,
        dialer: &MeshDialer,
        device_id: &str,
        virtual_ip: Ipv4Addr,
    ) -> ProbeEntry {
        let known_port = lock(&self.probes)
            .get(device_id)
            .filter(|entry| entry.virtual_ip == virtual_ip.to_string())
            .and_then(|entry| {
                if entry.at.elapsed() < PROBE_CACHE_TTL {
                    return Some(Err(entry.clone()));
                }
                entry.result.as_ref().ok().map(|(port, _)| Ok(*port))
            });
        let port = match known_port {
            Some(Err(fresh)) => return fresh,
            Some(Ok(port)) => Some(port),
            None => None,
        };
        let target = MeshTarget {
            device_id: device_id.to_string(),
            virtual_ip,
            port,
        };
        let mut result = dialer.locate(&target).await;
        if result.is_err() && port.is_some() {
            result = dialer
                .locate(&MeshTarget {
                    port: None,
                    ..target
                })
                .await;
        }
        let entry = ProbeEntry {
            at: Instant::now(),
            virtual_ip: virtual_ip.to_string(),
            result,
        };
        lock(&self.probes).insert(device_id.to_string(), entry.clone());
        entry
    }

    async fn directory_names(&self) -> HashMap<String, String> {
        if let Some((at, names)) = lock(&self.directory).as_ref() {
            if at.elapsed() < DIRECTORY_CACHE_TTL {
                return names.clone();
            }
        }
        let names = match crate::api::account_directory::read_directory_context().await {
            Ok((session, directory_url)) => {
                match openbitfun_core::service::remote_connect::AccountClient::new()
                    .list_devices(&directory_url, &session)
                    .await
                {
                    Ok(devices) => devices
                        .into_iter()
                        .map(|device| {
                            let name = device
                                .device_alias
                                .filter(|alias| !alias.trim().is_empty())
                                .unwrap_or(device.device_name);
                            (device.device_id, name)
                        })
                        .collect(),
                    Err(error) => {
                        log::debug!("Mesh device names unavailable: {}", error);
                        HashMap::new()
                    }
                }
            }
            Err(_) => HashMap::new(),
        };
        *lock(&self.directory) = Some((Instant::now(), names.clone()));
        names
    }

    /// Devices of the account in the mesh, with reachability and protocol.
    pub async fn list_devices(&self) -> Result<Vec<MeshDeviceEntry>, String> {
        let dialer = self.dialer().await?;
        let status = self.refresh().await;
        let names = self.directory_names().await;
        let own_ip = status.virtual_ip.clone();
        let probes = status
            .peers
            .iter()
            .filter(|peer| openbitfun_link::handshake::valid_device_id(&peer.hostname))
            .map(|peer| {
                let dialer = &dialer;
                let own_ip = own_ip.clone();
                async move {
                    // An address shared with this device (a transient DHCP
                    // conflict) would reach this device itself.
                    if peer.role.is_controller() {
                        return (peer, Ok(None));
                    }
                    if own_ip.as_deref() == Some(peer.virtual_ip.as_str()) {
                        return (
                            peer,
                            Err(
                                "mesh address conflict being resolved; retry in a few seconds"
                                    .to_string(),
                            ),
                        );
                    }
                    let Ok(ip) = peer.virtual_ip.parse::<Ipv4Addr>() else {
                        return (peer, Err("no mesh address yet".to_string()));
                    };
                    (
                        peer,
                        self.probe(dialer, &peer.hostname, ip)
                            .await
                            .result
                            .map(Some),
                    )
                }
            });
        let results = futures::future::join_all(probes).await;
        Ok(results
            .into_iter()
            .map(|(peer, probe)| {
                let (reachable, port, info, error) = match probe {
                    Ok(Some((port, info))) => (true, Some(port), Some(info), None),
                    Ok(None) => (false, None, None, None),
                    Err(error) => (false, None, None, Some(error)),
                };
                MeshDeviceEntry {
                    device_id: peer.hostname.clone(),
                    // The account directory's name first; a phone or
                    // browser session it does not list names itself in Link.
                    name: names
                        .get(&peer.hostname)
                        .cloned()
                        .or_else(|| peer.display_name.clone()),
                    virtual_ip: peer.virtual_ip.clone(),
                    role: peer.role,
                    reachable,
                    path: peer.path,
                    route: peer.route,
                    relay_via: peer.relay_via.clone(),
                    hops: peer.hops,
                    latency_ms: peer.latency_ms,
                    last_seen_ms: peer.last_seen_ms,
                    obp_protocol: info.as_ref().map(|info| info.protocol),
                    capabilities: info
                        .as_ref()
                        .map(|info| info.capabilities.clone())
                        .unwrap_or_default(),
                    obp_port: port,
                    backend_version: info.map(|info| info.backend_version),
                    error,
                }
            })
            .collect())
    }

    /// Opens an authenticated OBP connection to `device_id` over the mesh.
    pub async fn connect_device(
        &self,
        device_id: &str,
        options: MeshConnectOptions,
    ) -> Result<MeshObpConnection, String> {
        let dialer = self.dialer().await?;
        let status = self.refresh().await;
        let peer = status.peer(device_id).ok_or_else(|| {
            format!("mesh_unreachable: device {device_id} is not in the account mesh right now")
        })?;
        if peer.role.is_controller() {
            return Err(controller_refusal(device_id));
        }
        let virtual_ip: Ipv4Addr = peer
            .virtual_ip
            .parse()
            .map_err(|_| format!("device {device_id} has no mesh address yet"))?;
        if status.virtual_ip.as_deref() == Some(peer.virtual_ip.as_str()) {
            return Err(format!(
                "mesh_unreachable: device {device_id} shares this device's mesh address while the mesh resolves the conflict; retry in a few seconds"
            ));
        }
        let port = lock(&self.probes)
            .get(device_id)
            .filter(|entry| entry.virtual_ip == peer.virtual_ip)
            .and_then(|entry| entry.result.as_ref().ok().map(|(port, _)| *port));
        let target = MeshTarget {
            device_id: device_id.to_string(),
            virtual_ip,
            port,
        };
        dialer.connect(&target, options).await
    }

    /// Opens an OBP connection to the account's cloud node (`cloud-…`) at
    /// `wss://<account server>/agent/obp` over the end-to-end channel, with
    /// this device's account-device proof. The cloud node is not on the
    /// device network; only the account session is needed.
    pub async fn connect_cloud_node(
        &self,
        device_id: &str,
        options: MeshConnectOptions,
    ) -> Result<MeshObpConnection, String> {
        let account = self
            .serving
            .lock()
            .await
            .clone()
            .ok_or_else(|| "mesh_signed_out: sign in to reach Super Agent".to_string())?;
        let url = openbitfun_obp::client::cloud::cloud_node_url(
            &crate::api::account_directory::directory_url(),
        )
        .unwrap_or_else(|| openbitfun_obp::client::cloud::DEFAULT_CLOUD_NODE_URL.to_string());
        openbitfun_obp::client::cloud::CloudNodeConnector::new(
            openbitfun_obp::client::cloud::WssCloudStream::new(url),
            Arc::new(AccountMeshAuthority { account }),
            openbitfun_obp::client::default_client_name(),
        )
        .connect(device_id, options)
        .await
    }

    /// What `device_id` advertises on its OBP mesh listener, for transport
    /// selection (`mesh::route`): `None` when this host's mesh is not running
    /// or the device is not in the account mesh (an older device that never
    /// joins it, or one that is offline); `Some(Err)` for a mesh device whose
    /// listener did not answer. Probes are cached like `mesh_list_devices`.
    pub async fn device_capabilities(
        &self,
        device_id: &str,
    ) -> Option<Result<Vec<String>, String>> {
        let dialer = self.dialer().await.ok()?;
        let mut status = self.status();
        if status.peer(device_id).is_none() {
            status = self.refresh().await;
        }
        let peer = status.peer(device_id)?;
        if peer.role.is_controller() {
            return Some(Err(controller_refusal(device_id)));
        }
        if status.virtual_ip.as_deref() == Some(peer.virtual_ip.as_str()) {
            return Some(Err(format!(
                "mesh_unreachable: device {device_id} shares this device's mesh address while the mesh resolves the conflict; retry in a few seconds"
            )));
        }
        let Ok(virtual_ip) = peer.virtual_ip.parse::<Ipv4Addr>() else {
            return Some(Err(format!(
                "mesh_unreachable: device {device_id} has no mesh address yet"
            )));
        };
        Some(
            self.probe(&dialer, device_id, virtual_ip)
                .await
                .result
                .map(|(_, info)| info.capabilities),
        )
    }
}

/// Why a controller (phone app, browser session) cannot be driven.
fn controller_refusal(device_id: &str) -> String {
    format!(
        "mesh_controller: {device_id} is a controller (phone app or browser) and serves no backend"
    )
}

/// Starts Link for the native host (unless `OPENBITFUN_MESH=off`): it joins
/// the account's network on sign-in and leaves it on sign-out.
pub fn start_for_native_host(data_dir: &Path) {
    if openbitfun_link::session::disabled_by_environment() {
        log::info!("Device network disabled by OPENBITFUN_MESH");
        return;
    }
    let link = Link::start(
        LinkOptions::from_environment(data_dir.join("mesh"), crate::VERSION),
        Arc::new(DesktopAccountSession),
    );
    let runtime = MeshRuntime::new(link, crate::backend_protocol::ws::global_server());
    if RUNTIME.set(Arc::clone(&runtime)).is_err() {
        log::warn!("Device network runtime was already started in this process");
        return;
    }
    // Detached dispatch and IM bots reach new account devices over Link.
    openbitfun_services_integrations::remote_connect::mesh_route::install_mesh_route(Arc::new(
        route::DesktopMeshRoute::default(),
    ));
    tokio::spawn(runtime.run());
}

/// Leaves the network (backend shutdown); waits up to a few seconds.
pub async fn shutdown_global() {
    let Some(runtime) = RUNTIME.get() else {
        return;
    };
    crate::fleet::stop();
    peer_link::shutdown_global().await;
    if let Some(server) = &runtime.obp {
        server.stop_mesh();
    }
    let _ = tokio::time::timeout(Duration::from_secs(8), runtime.link.shutdown()).await;
}

/// Opens an authenticated OBP connection to another device of the signed-in
/// account over the mesh (scope `account-device` on that device).
pub async fn connect_device(
    device_id: &str,
    options: MeshConnectOptions,
) -> Result<MeshObpConnection, String> {
    global()
        .ok_or_else(|| {
            "mesh_unavailable: this host does not run the device mesh (native desktop app only)"
                .to_string()
        })?
        .connect_device(device_id, options)
        .await
}

/// [`MeshRuntime::connect_cloud_node`] of this process.
pub async fn connect_cloud_node(
    device_id: &str,
    options: MeshConnectOptions,
) -> Result<MeshObpConnection, String> {
    global()
        .ok_or_else(|| {
            "mesh_unavailable: this host does not run the device mesh (native desktop app only)"
                .to_string()
        })?
        .connect_cloud_node(device_id, options)
        .await
}

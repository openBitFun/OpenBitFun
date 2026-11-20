//! The device mesh of the native desktop host.
//!
//! While an account is signed in, this host joins the account's EasyTier
//! network (credentials from the account mesh issuer, cached so a restart
//! works while the issuer is unreachable), supervises the `easytier-core`
//! sidecar, serves OBP to other devices of the account on the mesh listener
//! (`backend_protocol::ws::mesh`), and exposes `mesh_status`,
//! `mesh_list_devices` and [`connect_device`] for controllers. The old relay
//! server is never a transport here: it is only read as the account's device
//! directory (names and public keys).
//!
//! Remote scenarios: the mesh is a transport between same-account devices.
//! It does not change remote workspaces (they keep running where they are),
//! and its commands are `ControllerLocal`: a remote client sees the backend's
//! mesh only through its own host.

pub mod mesh_api;
pub mod peer_link;
pub mod route;

use std::collections::HashMap;
use std::net::Ipv4Addr;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use openbitfun_mesh_service::credentials::{DEFAULT_MESH_API_URL, MESH_CREDENTIALS_PATH};
use openbitfun_mesh_service::sidecar::{free_listener_port, free_loopback_port};
use openbitfun_mesh_service::{
    EasyTierBinaries, MeshCredentials, MeshNodeConfig, MeshPath, MeshSidecar, MeshState,
    MeshStatus, SidecarOptions, EASYTIER_VERSION,
};
use serde::{Deserialize, Serialize};
use tokio::sync::{watch, Notify};

use crate::backend_protocol::ws::mesh_client::{
    MeshConnectOptions, MeshDialer, MeshObpConnection, MeshTarget,
};
use crate::backend_protocol::ws::{MeshAuthority, MeshInfo, ObpServer, PairKeyFuture};

/// Event emitted (owner scope only) when the mesh status changes materially.
pub const MESH_STATUS_CHANGED_EVENT: &str = "mesh://status-changed";

const ACCOUNT_POLL: Duration = Duration::from_secs(15);
const STATUS_INTERVAL: Duration = Duration::from_secs(10);
const PREFERRED_LISTENER_PORT: u16 = 11010;
const PROBE_CACHE_TTL: Duration = Duration::from_secs(30);
const DIRECTORY_CACHE_TTL: Duration = Duration::from_secs(60);
const CREDENTIALS_FILE: &str = "credentials.json";

/// The account behind the running mesh.
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
            if !openbitfun_mesh_service::handshake::valid_device_id(device_id) {
                return Err("invalid device id".to_string());
            }
            let (session, relay_url) =
                crate::api::remote_connect_api::read_account_context().await?;
            if session.user_id != self.account.user_id {
                return Err("the signed-in account changed".to_string());
            }
            session
                .peer_message_key(&relay_url, device_id)
                .await
                .map_err(|error| format!("device key lookup failed: {error}"))
        })
    }
}

struct Running {
    account: AccountKey,
    /// The account network this node joined (also what a phone joins).
    credentials: MeshCredentials,
    sidecar: MeshSidecar,
    dialer: MeshDialer,
    forwarder: tokio::task::JoinHandle<()>,
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
    /// Directory name (alias first); `None` when the directory is unavailable.
    pub name: Option<String>,
    pub virtual_ip: String,
    /// The device answered on its OBP mesh listener.
    pub reachable: bool,
    pub path: MeshPath,
    pub hops: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latency_ms: Option<f64>,
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

/// `mesh_phone_join_info`: the EasyTier network a phone joins and where it
/// reaches this device. `network_secret` is a credential (owner only).
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeshPhoneJoinInfo {
    pub network_name: String,
    pub network_secret: String,
    /// EasyTier peer URLs (the account's relay/discovery node).
    pub peers: Vec<String>,
    pub easytier_version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device_id: Option<String>,
    /// This device's mesh address (`None` until DHCP assigned one).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub virtual_ip: Option<String>,
    /// The OBP mesh listener port on that address.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub obp_port: Option<u16>,
    /// The listener serves the web UI bundle (a phone browser gets the UI).
    pub web_ui: bool,
}

impl std::fmt::Debug for MeshPhoneJoinInfo {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MeshPhoneJoinInfo")
            .field("network_name", &self.network_name)
            .field("network_secret", &"<redacted>")
            .field("peers", &self.peers)
            .field("virtual_ip", &self.virtual_ip)
            .field("obp_port", &self.obp_port)
            .finish()
    }
}

/// The mesh of this process.
pub struct MeshRuntime {
    work_dir: PathBuf,
    obp: Option<Arc<ObpServer>>,
    status: watch::Sender<MeshStatus>,
    running: tokio::sync::Mutex<Option<Running>>,
    wake: Notify,
    stopping: watch::Sender<bool>,
    probes: Mutex<HashMap<String, ProbeEntry>>,
    directory: Mutex<Option<(Instant, HashMap<String, String>)>>,
}

static RUNTIME: OnceLock<Arc<MeshRuntime>> = OnceLock::new();

/// The running mesh runtime, when the native host started one.
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

/// Repository build output of `scripts/fetch-easytier.mjs` (development).
fn development_binary_dirs() -> Vec<PathBuf> {
    let Some(platform) = EasyTierBinaries::platform_dir_name() else {
        return Vec::new();
    };
    if !cfg!(debug_assertions) {
        return Vec::new();
    }
    vec![PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../target/easytier")
        .join(platform)]
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CachedCredentials {
    user_id: String,
    credentials: MeshCredentials,
}

fn write_private(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    use std::io::Write;
    let mut file = options.open(path)?;
    file.write_all(bytes)
}

/// Fetches the account's mesh credentials from the issuer.
async fn fetch_credentials(device_id: &str) -> Result<MeshCredentials, FetchError> {
    let base = std::env::var("OPENBITFUN_MESH_API_URL")
        .ok()
        .map(|value| value.trim().trim_end_matches('/').to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_MESH_API_URL.to_string());
    let mut identity =
        openbitfun_services_integrations::account_identity::AccountIdentityClient::from_environment()
            .await
            .map_err(|error| FetchError::Transient(error.to_string()))?;
    let token = identity
        .access_token()
        .await
        .map_err(|error| FetchError::Transient(error.to_string()))?
        .ok_or_else(|| {
            FetchError::Refused("sign in to OpenBitFun to join your device mesh".into())
        })?;
    crate::ensure_rustls_crypto_provider();
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| FetchError::Transient(error.to_string()))?;
    let response = client
        .post(format!("{base}{MESH_CREDENTIALS_PATH}"))
        .bearer_auth(token)
        .json(&serde_json::json!({
            "deviceId": device_id,
            "clientVersion": crate::VERSION,
            "easytierVersion": EASYTIER_VERSION,
        }))
        .send()
        .await
        .map_err(|error| {
            FetchError::Transient(format!("the mesh issuer is unreachable: {error}"))
        })?;
    let status = response.status();
    if matches!(status.as_u16(), 404 | 405 | 410) {
        return Err(FetchError::Unsupported(format!(
            "mesh_unsupported: the account server does not issue mesh credentials (HTTP {status}); update the server"
        )));
    }
    if matches!(status.as_u16(), 401 | 403) {
        return Err(FetchError::Refused(format!(
            "the account server refused mesh credentials (HTTP {status}); sign in again"
        )));
    }
    if !status.is_success() {
        return Err(FetchError::Transient(format!(
            "the mesh issuer answered HTTP {status}"
        )));
    }
    let credentials: MeshCredentials = response
        .json()
        .await
        .map_err(|error| FetchError::Transient(format!("unreadable mesh credentials: {error}")))?;
    credentials.validate().map_err(FetchError::Refused)?;
    Ok(credentials)
}

enum FetchError {
    /// Network or service trouble: a cached document may be used.
    Transient(String),
    /// The account may not have credentials now.
    Refused(String),
    /// The issuer does not exist at this server.
    Unsupported(String),
}

impl MeshRuntime {
    fn new(data_dir: &Path, obp: Option<Arc<ObpServer>>) -> Arc<Self> {
        Arc::new(Self {
            work_dir: data_dir.join("mesh"),
            obp,
            status: watch::channel(MeshStatus::new(MeshState::SignedOut, None)).0,
            running: tokio::sync::Mutex::new(None),
            wake: Notify::new(),
            stopping: watch::channel(false).0,
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
        }
    }

    fn set_state(&self, state: MeshState, reason: Option<String>) {
        let mut status = MeshStatus::new(state, reason);
        status.device_id = self.status.borrow().device_id.clone();
        self.publish(status);
    }

    /// Re-checks the account now (sign-in or sign-out just happened).
    pub fn wake(&self) {
        self.wake.notify_one();
    }

    async fn account() -> Option<AccountKey> {
        let (session, _) = crate::api::remote_connect_api::read_account_context()
            .await
            .ok()?;
        let device_id = crate::api::remote_connect_api::current_device_id_for_peer().ok()?;
        Some(AccountKey {
            user_id: session.user_id,
            device_id,
        })
    }

    async fn credentials(
        &self,
        account: &AccountKey,
    ) -> Result<MeshCredentials, (MeshState, String)> {
        let cache = self.work_dir.join(CREDENTIALS_FILE);
        match fetch_credentials(&account.device_id).await {
            Ok(credentials) => {
                let cached = CachedCredentials {
                    user_id: account.user_id.clone(),
                    credentials: credentials.clone(),
                };
                if let Ok(json) = serde_json::to_vec(&cached) {
                    if let Err(error) = write_private(&cache, &json) {
                        log::warn!("Failed to cache mesh credentials: {}", error);
                    }
                }
                Ok(credentials)
            }
            Err(FetchError::Transient(error)) => {
                let cached = std::fs::read(&cache)
                    .ok()
                    .and_then(|bytes| serde_json::from_slice::<CachedCredentials>(&bytes).ok())
                    .filter(|cached| cached.user_id == account.user_id)
                    .filter(|cached| cached.credentials.validate().is_ok());
                match cached {
                    Some(cached) => {
                        log::warn!(
                            "Mesh issuer unavailable; using cached credentials: {}",
                            error
                        );
                        Ok(cached.credentials)
                    }
                    None => Err((MeshState::Failed, error)),
                }
            }
            Err(FetchError::Refused(error)) => Err((MeshState::Failed, error)),
            Err(FetchError::Unsupported(error)) => Err((MeshState::Unsupported, error)),
        }
    }

    async fn start_account(
        self: &Arc<Self>,
        account: AccountKey,
    ) -> Result<Running, (MeshState, String)> {
        let binaries = EasyTierBinaries::locate(&development_binary_dirs()).ok_or_else(|| {
            (
                MeshState::Unsupported,
                format!(
                    "mesh_unavailable: easytier-core {EASYTIER_VERSION} is not bundled with this build (run `node scripts/fetch-easytier.mjs` in development)"
                ),
            )
        })?;
        let credentials = self.credentials(&account).await?;
        let authority: Arc<dyn MeshAuthority> = Arc::new(AccountMeshAuthority {
            account: account.clone(),
        });
        let obp_port = match &self.obp {
            Some(server) => Some(
                server
                    .start_mesh(Arc::clone(&authority))
                    .await
                    .map_err(|error| (MeshState::Failed, error))?
                    .port(),
            ),
            None => None,
        };
        let ports = (|| -> std::io::Result<(u16, u16, u16)> {
            Ok((
                free_loopback_port()?,
                free_loopback_port()?,
                free_listener_port(PREFERRED_LISTENER_PORT)?,
            ))
        })()
        .map_err(|error| (MeshState::Failed, format!("no free mesh ports: {error}")))?;
        let (socks5_port, rpc_port, listener_port) = ports;
        let config = MeshNodeConfig {
            instance_name: format!(
                "openbitfun-{}",
                &account.device_id[..account.device_id.len().min(12)]
            ),
            hostname: account.device_id.clone(),
            credentials: credentials.clone(),
            listener_port: Some(listener_port),
            socks5_port,
            inbound_tcp_ports: (
                openbitfun_mesh_service::MESH_OBP_PORT_FIRST,
                openbitfun_mesh_service::MESH_OBP_PORT_LAST,
            ),
            disable_p2p: std::env::var("OPENBITFUN_MESH_DISABLE_P2P")
                .is_ok_and(|value| value == "1"),
        };
        let sidecar = MeshSidecar::start(SidecarOptions {
            binaries,
            work_dir: self.work_dir.clone(),
            config,
            rpc_port,
            status_interval: STATUS_INTERVAL,
            obp_port,
        });
        let dialer = MeshDialer {
            socks5: sidecar.socks5_addr(),
            authority,
        };
        let mut updates = sidecar.subscribe();
        let runtime = Arc::clone(self);
        let forwarder = tokio::spawn(async move {
            loop {
                let status = updates.borrow_and_update().clone();
                runtime.publish(status);
                if updates.changed().await.is_err() {
                    break;
                }
            }
        });
        Ok(Running {
            account,
            credentials,
            sidecar,
            dialer,
            forwarder,
        })
    }

    async fn stop_running(&self, reason: MeshState) {
        let running = self.running.lock().await.take();
        if let Some(running) = running {
            // Peer Device Mode links ride this mesh; they end with it.
            peer_link::shutdown_global().await;
            if let Some(server) = &self.obp {
                server.stop_mesh();
            }
            running.forwarder.abort();
            running.sidecar.stop().await;
            lock(&self.probes).clear();
            *lock(&self.directory) = None;
            log::info!("Mesh stopped: reason={:?}", reason);
        }
        self.set_state(reason, None);
    }

    async fn reconcile(self: &Arc<Self>) {
        let account = Self::account().await;
        let current = self
            .running
            .lock()
            .await
            .as_ref()
            .map(|running| running.account.clone());
        match (account, current) {
            (None, None) => self.set_state(MeshState::SignedOut, None),
            (None, Some(_)) => self.stop_running(MeshState::SignedOut).await,
            (Some(account), Some(current)) if account == current => {}
            (Some(account), current) => {
                if current.is_some() {
                    self.stop_running(MeshState::Starting).await;
                }
                self.set_state(MeshState::Starting, None);
                match self.start_account(account).await {
                    Ok(running) => {
                        log::info!("Mesh started for the signed-in account");
                        *self.running.lock().await = Some(running);
                    }
                    Err((state, reason)) => {
                        log::warn!("Mesh not started: {}", reason);
                        if let Some(server) = &self.obp {
                            server.stop_mesh();
                        }
                        self.set_state(state, Some(reason));
                    }
                }
            }
        }
    }

    async fn run(self: Arc<Self>) {
        let mut stopping = self.stopping.subscribe();
        loop {
            if *stopping.borrow() {
                break;
            }
            self.reconcile().await;
            // Failed starts retry on the next tick; sign-in/out wakes early.
            tokio::select! {
                _ = tokio::time::sleep(ACCOUNT_POLL) => {}
                _ = self.wake.notified() => {}
                _ = stopping.changed() => {}
            }
        }
        self.stop_running(MeshState::Stopped).await;
    }

    /// A fresh status (probes the sidecar now).
    pub async fn refresh(&self) -> MeshStatus {
        let fresh = match self.running.lock().await.as_ref() {
            Some(running) => Some(running.sidecar.refresh().await),
            None => None,
        };
        if let Some(status) = fresh {
            self.publish(status);
        }
        self.status()
    }

    async fn dialer(&self) -> Result<MeshDialer, String> {
        self.running
            .lock()
            .await
            .as_ref()
            .map(|running| running.dialer.clone())
            .ok_or_else(|| match self.status().state {
                MeshState::SignedOut => {
                    "mesh_signed_out: sign in to reach your other devices".to_string()
                }
                state => format!(
                    "mesh_unavailable: the device mesh is not running ({state:?}); {}",
                    self.status().reason.unwrap_or_default()
                ),
            })
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
        let names = match crate::api::remote_connect_api::read_account_context().await {
            Ok((session, relay_url)) => {
                match openbitfun_core::service::remote_connect::AccountClient::new()
                    .list_devices(&relay_url, &session)
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
            .filter(|peer| openbitfun_mesh_service::handshake::valid_device_id(&peer.hostname))
            .map(|peer| {
                let dialer = &dialer;
                let own_ip = own_ip.clone();
                async move {
                    // An address shared with this device (a transient DHCP
                    // conflict) would reach this device itself.
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
                    (peer, self.probe(dialer, &peer.hostname, ip).await.result)
                }
            });
        let results = futures::future::join_all(probes).await;
        Ok(results
            .into_iter()
            .map(|(peer, probe)| {
                let (reachable, port, info, error) = match probe {
                    Ok((port, info)) => (true, Some(port), Some(info), None),
                    Err(error) => (false, None, None, Some(error)),
                };
                MeshDeviceEntry {
                    device_id: peer.hostname.clone(),
                    name: names.get(&peer.hostname).cloned(),
                    virtual_ip: peer.virtual_ip.clone(),
                    reachable,
                    path: peer.path,
                    hops: peer.hops,
                    latency_ms: peer.latency_ms,
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

    /// What a phone needs to join this account's mesh with the EasyTier app
    /// and reach this device's OBP listener there. Carries the network
    /// secret: only the owner scope may read it, and it is never logged.
    pub async fn phone_join_info(&self) -> Result<MeshPhoneJoinInfo, String> {
        let credentials = self
            .running
            .lock()
            .await
            .as_ref()
            .map(|running| running.credentials.clone());
        let Some(credentials) = credentials else {
            return Err(self.dialer().await.err().unwrap_or_else(|| {
                "mesh_unavailable: the device mesh is not running".to_string()
            }));
        };
        let status = self.refresh().await;
        Ok(MeshPhoneJoinInfo {
            network_name: credentials.network_name,
            network_secret: credentials.network_secret,
            peers: credentials.peers,
            easytier_version: EASYTIER_VERSION.to_string(),
            device_id: status.device_id.clone(),
            virtual_ip: status.virtual_ip.clone(),
            obp_port: self
                .obp
                .as_ref()
                .and_then(|server| server.mesh_addr())
                .map(|addr| addr.port())
                .or(status.obp_port),
            web_ui: self
                .obp
                .as_ref()
                .is_some_and(|server| server.web_root().is_some()),
        })
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

/// Starts the mesh runtime of the native host (unless `OPENBITFUN_MESH=off`).
pub fn start_for_native_host(data_dir: &Path) {
    if std::env::var("OPENBITFUN_MESH")
        .map(|value| value.eq_ignore_ascii_case("off") || value == "0")
        .unwrap_or(false)
    {
        log::info!("Device mesh disabled by OPENBITFUN_MESH");
        return;
    }
    let runtime = MeshRuntime::new(data_dir, crate::backend_protocol::ws::global_server());
    if RUNTIME.set(Arc::clone(&runtime)).is_err() {
        log::warn!("Device mesh runtime was already started in this process");
        return;
    }
    // Detached dispatch and IM bots reach new account devices over the mesh.
    openbitfun_services_integrations::remote_connect::mesh_route::install_mesh_route(Arc::new(
        route::DesktopMeshRoute::default(),
    ));
    tokio::spawn(runtime.run());
}

/// Stops the sidecar (backend shutdown); waits up to a few seconds.
pub async fn shutdown_global() {
    let Some(runtime) = RUNTIME.get() else {
        return;
    };
    runtime.stopping.send_replace(true);
    let _ = tokio::time::timeout(Duration::from_secs(6), async {
        while runtime.running.lock().await.is_some() {
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await;
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

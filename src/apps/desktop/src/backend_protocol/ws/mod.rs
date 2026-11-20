//! The backend protocol (OBP) over WebSocket: one listener on loopback for
//! browsers on this machine, and an opt-in TLS listener on the LAN for phones
//! and other browsers, both serving the NSH web bundle at `/` and the
//! protocol at `/obp`.
//!
//! The server is a transport only: every call goes to
//! [`BackendService::dispatch`](crate::backend_protocol::BackendService) and
//! every event comes from the same [`EventHub`] the in-process UI reads.
//! Each connection is bound to a scope (`owner` on loopback with the
//! per-launch token, `paired-client` on the LAN with a revocable QR
//! credential, `account-device` on the mesh listener with the device key
//! handshake); the Product Operation Registry decides what a non-owner scope
//! may run and receive. See `docs/architecture/unified-client-architecture.md`.

mod connection;
mod http;
mod mesh;
pub mod mesh_client;
#[cfg(test)]
mod mesh_tests;
mod mesh_verbs;
mod obp_api;
mod protocol;
mod scope;
mod store;
#[cfg(test)]
mod tests;
mod tls;

pub use connection::{ConnectionLimits, StopReason};
pub use mesh::{MeshAuthority, MeshInfo, PairKeyFuture};
pub use obp_api::*;
pub use protocol::OBP_PROTOCOL_VERSION;
pub use scope::Scope;

use std::collections::HashMap;
use std::future::Future;
use std::net::{Ipv4Addr, SocketAddr};
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use serde::Serialize;
use serde_json::Value;
use tokio::sync::{oneshot, watch};

use super::{BackendService, EventHub};

/// Default loopback port (falls back to an ephemeral one when taken).
pub const DEFAULT_LOOPBACK_PORT: u16 = 47610;
/// Default LAN port (falls back to an ephemeral one when taken).
pub const DEFAULT_LAN_PORT: u16 = 47611;

/// A boxed dispatch future owning its inputs.
pub type ObpDispatchFuture = Pin<Box<dyn Future<Output = Result<Value, String>> + Send + 'static>>;

/// What the server needs from a backend.
pub trait ObpBackend: Send + Sync + 'static {
    /// Runs one command with Tauri-shaped JSON arguments.
    fn dispatch(&self, command: String, args: Value) -> ObpDispatchFuture;
    /// The ordered event stream.
    fn events(&self) -> Arc<EventHub>;
    /// `{version, platform, dataDir}`.
    fn info(&self) -> Value;
}

impl ObpBackend for BackendService {
    fn dispatch(&self, command: String, args: Value) -> ObpDispatchFuture {
        // Same-account host verbs (dispatch targets, the bot lane); the
        // scope check admits them for `account-device` (and the owner) only.
        if mesh_verbs::is_account_device_host_verb(&command) {
            if let Some(future) = mesh_verbs::route(&command, args) {
                return future;
            }
            return Box::pin(async move { Err(format!("unknown host verb {command}")) });
        }
        Box::pin(self.dispatch_owned(command, args))
    }

    fn events(&self) -> Arc<EventHub> {
        Arc::clone(BackendService::events(self))
    }

    fn info(&self) -> Value {
        serde_json::to_value(BackendService::info(self)).unwrap_or_default()
    }
}

/// How a server is set up.
#[derive(Debug, Clone)]
pub struct ObpServerOptions {
    /// Where tokens, credentials and the LAN identity live (`<data>/obp`).
    pub state_dir: PathBuf,
    /// The NSH web bundle (`index.html` and its files), if this build has it.
    pub web_root: Option<PathBuf>,
    /// Preferred loopback port; `0` asks for an ephemeral one.
    pub loopback_port: u16,
    /// Preferred LAN port when the settings name none; `0`: ephemeral.
    pub lan_port: u16,
    pub limits: ConnectionLimits,
}

impl ObpServerOptions {
    pub fn new(state_dir: PathBuf) -> Self {
        Self {
            state_dir,
            web_root: None,
            loopback_port: DEFAULT_LOOPBACK_PORT,
            lan_port: DEFAULT_LAN_PORT,
            limits: ConnectionLimits::default(),
        }
    }
}

struct RunningListener {
    addr: SocketAddr,
    shutdown: Option<oneshot::Sender<()>>,
}

impl RunningListener {
    fn stop(&mut self) {
        if let Some(shutdown) = self.shutdown.take() {
            let _ = shutdown.send(());
        }
    }
}

struct ConnectionEntry {
    scope: Scope,
    stop: watch::Sender<Option<StopReason>>,
    /// Served on the mesh listener (another account device, or a phone that
    /// joined the account mesh); closed when the mesh stops.
    via_mesh: bool,
}

/// Status of the listeners, for the Devices scene.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObpStatus {
    pub available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unavailable_reason: Option<String>,
    pub protocol: u32,
    /// The web bundle is present, so `/` serves the UI.
    pub web_ui: bool,
    pub loopback_url: Option<String>,
    /// The loopback URL carrying the owner token (opens an owner session).
    pub owner_url: Option<String>,
    pub lan: LanStatus,
    pub paired_clients: Vec<PairedClientStatus>,
    pub owner_connections: usize,
    pub paired_connections: usize,
    /// Other devices of the account connected over the mesh listener.
    pub account_device_connections: usize,
    /// The mesh listener's loopback port (reached on the virtual IP).
    pub mesh_port: Option<u16>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanStatus {
    pub enabled: bool,
    pub running: bool,
    pub port: Option<u16>,
    pub urls: Vec<String>,
    pub fingerprint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairedClientStatus {
    pub id: String,
    pub name: String,
    pub created_at_ms: u64,
    pub last_seen_at_ms: Option<u64>,
    pub connected: bool,
}

/// A one-time pairing offer: the QR payload and what the desktop shows.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingOffer {
    /// What the QR encodes: `https://<lan>/pair?code=…#fp=sha256:…`.
    pub qr_payload: String,
    pub url: String,
    pub fingerprint: String,
    pub expires_at_ms: u64,
}

impl ObpStatus {
    fn unavailable(reason: String) -> Self {
        Self {
            available: false,
            unavailable_reason: Some(reason),
            protocol: OBP_PROTOCOL_VERSION,
            web_ui: false,
            loopback_url: None,
            owner_url: None,
            lan: LanStatus::default(),
            paired_clients: Vec::new(),
            owner_connections: 0,
            paired_connections: 0,
            account_device_connections: 0,
            mesh_port: None,
        }
    }
}

/// The listeners of one backend.
pub struct ObpServer {
    backend: Arc<dyn ObpBackend>,
    options: ObpServerOptions,
    instance_id: String,
    registry_digest: String,
    store: Mutex<store::ObpStore>,
    loopback: Mutex<Option<RunningListener>>,
    lan: Mutex<Option<RunningListener>>,
    lan_fingerprint: Mutex<Option<String>>,
    lan_error: Mutex<Option<String>>,
    connections: Mutex<HashMap<u64, ConnectionEntry>>,
    next_connection: AtomicU64,
    mesh: mesh::MeshListenerState,
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    match mutex.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

async fn bind_preferring(ip: Ipv4Addr, port: u16) -> std::io::Result<tokio::net::TcpListener> {
    match tokio::net::TcpListener::bind((ip, port)).await {
        Ok(listener) => Ok(listener),
        Err(error) if port != 0 => {
            log::info!(
                "OBP port {} unavailable ({}); using an ephemeral port",
                port,
                error
            );
            tokio::net::TcpListener::bind((ip, 0)).await
        }
        Err(error) => Err(error),
    }
}

impl ObpServer {
    /// Opens the state directory and writes this launch's owner token.
    pub fn new(
        backend: Arc<dyn ObpBackend>,
        options: ObpServerOptions,
    ) -> std::io::Result<Arc<Self>> {
        let store = store::ObpStore::open(options.state_dir.clone())?;
        Ok(Arc::new(Self {
            backend,
            options,
            instance_id: uuid::Uuid::new_v4().to_string(),
            registry_digest: openbitfun_product_domains::remote_surface::digest(),
            store: Mutex::new(store),
            loopback: Mutex::new(None),
            lan: Mutex::new(None),
            lan_fingerprint: Mutex::new(None),
            lan_error: Mutex::new(None),
            connections: Mutex::new(HashMap::new()),
            next_connection: AtomicU64::new(1),
            mesh: mesh::MeshListenerState::default(),
        }))
    }

    /// The per-launch owner token (also in `<state_dir>/owner-token`).
    pub fn owner_token(&self) -> String {
        lock(&self.store).owner_token().to_string()
    }

    pub fn instance_id(&self) -> &str {
        &self.instance_id
    }

    pub fn web_root(&self) -> Option<&Path> {
        self.options.web_root.as_deref()
    }

    /// The loopback listener's address, once started.
    pub fn loopback_addr(&self) -> Option<SocketAddr> {
        lock(&self.loopback).as_ref().map(|listener| listener.addr)
    }

    /// The LAN listener's address, while it runs.
    pub fn lan_addr(&self) -> Option<SocketAddr> {
        lock(&self.lan).as_ref().map(|listener| listener.addr)
    }

    fn spawn_server<L>(
        self: &Arc<Self>,
        listener: L,
        kind: http::ListenerKind,
    ) -> oneshot::Sender<()>
    where
        L: axum::serve::Listener<Addr = SocketAddr>,
    {
        let (shutdown, stopped) = oneshot::channel::<()>();
        let router = http::router(Arc::clone(self), kind);
        tokio::spawn(async move {
            let served = axum::serve(listener, router)
                .with_graceful_shutdown(async move {
                    let _ = stopped.await;
                })
                .await;
            if let Err(error) = served {
                log::warn!("OBP listener stopped with an error: {}", error);
            }
        });
        shutdown
    }

    /// Starts the loopback listener (idempotent). Returns its address.
    pub async fn start_loopback(self: &Arc<Self>) -> std::io::Result<SocketAddr> {
        if let Some(addr) = self.loopback_addr() {
            return Ok(addr);
        }
        let listener = bind_preferring(Ipv4Addr::LOCALHOST, self.options.loopback_port).await?;
        let addr = listener.local_addr()?;
        let shutdown =
            self.spawn_server(listener, http::ListenerKind::Loopback { port: addr.port() });
        *lock(&self.loopback) = Some(RunningListener {
            addr,
            shutdown: Some(shutdown),
        });
        log::info!("OBP loopback listener started: url=http://{}", addr);
        Ok(addr)
    }

    /// Starts the LAN listener (idempotent). Returns its address.
    pub async fn start_lan(self: &Arc<Self>) -> Result<SocketAddr, String> {
        if let Some(addr) = self.lan_addr() {
            return Ok(addr);
        }
        let started = async {
            let (identity, port) = {
                let store = lock(&self.store);
                let port = store.settings().lan_port.unwrap_or(self.options.lan_port);
                (store.lan_identity()?, port)
            };
            let config = tls::server_config(&identity)?;
            let listener = bind_preferring(Ipv4Addr::UNSPECIFIED, port)
                .await
                .map_err(|error| format!("failed to listen on the LAN: {error}"))?;
            let addr = listener
                .local_addr()
                .map_err(|error| format!("failed to read the LAN address: {error}"))?;
            let listener = tls::TlsListener::new(listener, config)
                .map_err(|error| format!("failed to start TLS on the LAN: {error}"))?;
            let shutdown =
                self.spawn_server(listener, http::ListenerKind::Lan { port: addr.port() });
            *lock(&self.lan) = Some(RunningListener {
                addr,
                shutdown: Some(shutdown),
            });
            *lock(&self.lan_fingerprint) = Some(identity.fingerprint.clone());
            // Remember the port so paired clients find the backend again.
            let _ =
                lock(&self.store).update_settings(|settings| settings.lan_port = Some(addr.port()));
            log::info!(
                "OBP LAN listener started: port={}, fingerprint={}",
                addr.port(),
                identity.fingerprint
            );
            Ok::<SocketAddr, String>(addr)
        }
        .await;
        *lock(&self.lan_error) = started.as_ref().err().cloned();
        if let Err(error) = &started {
            log::warn!("OBP LAN listener failed to start: {}", error);
        }
        started
    }

    /// Stops the LAN listener and disconnects every paired client.
    pub fn stop_lan(&self) {
        if let Some(mut listener) = lock(&self.lan).take() {
            listener.stop();
            log::info!("OBP LAN listener stopped");
        }
        for entry in lock(&self.connections).values() {
            if matches!(entry.scope, Scope::PairedClient { .. }) && !entry.via_mesh {
                entry.stop.send_replace(Some(StopReason::Shutdown));
            }
        }
    }

    /// Persists the LAN choice and starts or stops the LAN listener.
    pub async fn set_lan_enabled(self: &Arc<Self>, enabled: bool) -> Result<(), String> {
        lock(&self.store)
            .update_settings(|settings| settings.lan_enabled = enabled)
            .map_err(|error| format!("failed to store the LAN setting: {error}"))?;
        if enabled {
            self.start_lan().await.map(|_| ())
        } else {
            self.stop_lan();
            *lock(&self.lan_error) = None;
            Ok(())
        }
    }

    /// Whether the user enabled the LAN listener.
    pub fn lan_enabled(&self) -> bool {
        lock(&self.store).settings().lan_enabled
    }

    fn lan_urls(port: u16) -> Vec<String> {
        openbitfun_core::service::remote_connect::lan::list_local_ips()
            .map(|interfaces| {
                interfaces
                    .into_iter()
                    .map(|interface| format!("https://{}:{}", interface.ip, port))
                    .collect()
            })
            .unwrap_or_default()
    }

    /// The listeners, pairings and connections now.
    pub fn status(&self) -> ObpStatus {
        let loopback = self.loopback_addr();
        let lan = self.lan_addr();
        let owner_token = self.owner_token();
        let connections = lock(&self.connections);
        let connected: Vec<&str> = connections
            .values()
            .filter_map(|entry| match &entry.scope {
                Scope::PairedClient { client_id } => Some(client_id.as_str()),
                Scope::Owner | Scope::AccountDevice { .. } => None,
            })
            .collect();
        let owner_connections = connections
            .values()
            .filter(|entry| entry.scope.is_owner())
            .count();
        let account_device_connections = connections
            .values()
            .filter(|entry| matches!(entry.scope, Scope::AccountDevice { .. }))
            .count();
        let paired_clients = lock(&self.store)
            .clients()
            .iter()
            .map(|client| PairedClientStatus {
                id: client.id.clone(),
                name: client.name.clone(),
                created_at_ms: client.created_at_ms,
                last_seen_at_ms: client.last_seen_at_ms,
                connected: connected.contains(&client.id.as_str()),
            })
            .collect();
        ObpStatus {
            available: true,
            unavailable_reason: None,
            protocol: OBP_PROTOCOL_VERSION,
            web_ui: self.options.web_root.is_some(),
            loopback_url: loopback.map(|addr| format!("http://{addr}/")),
            owner_url: loopback.map(|addr| format!("http://{addr}/?token={owner_token}")),
            lan: LanStatus {
                enabled: self.lan_enabled(),
                running: lan.is_some(),
                port: lan.map(|addr| addr.port()),
                urls: lan
                    .map(|addr| Self::lan_urls(addr.port()))
                    .unwrap_or_default(),
                fingerprint: lan.and(lock(&self.lan_fingerprint).clone()),
                error: lock(&self.lan_error).clone(),
            },
            paired_clients,
            owner_connections,
            paired_connections: connected.len(),
            account_device_connections,
            mesh_port: self.mesh_addr().map(|addr| addr.port()),
        }
    }

    /// A one-time pairing code for the LAN, as a QR payload.
    pub fn create_pairing(&self, name: Option<String>) -> Result<PairingOffer, String> {
        let Some(addr) = self.lan_addr() else {
            return Err(
                "obp_lan_disabled: turn on \"Open on phone or browser\" in Devices before pairing"
                    .to_string(),
            );
        };
        let fingerprint = lock(&self.lan_fingerprint)
            .clone()
            .ok_or_else(|| "the LAN certificate is not ready".to_string())?;
        let base = Self::lan_urls(addr.port()).into_iter().next().ok_or_else(|| {
            "obp_no_lan_address: this machine has no LAN IPv4 address; connect it to a network first"
                .to_string()
        })?;
        Ok(self.pairing_offer(&base, fingerprint, name))
    }

    /// A one-time pairing code for a phone or browser that joined the
    /// account mesh with the EasyTier app; `virtual_ip` is this device's
    /// mesh address (the mesh listener is reached at that IP and its port).
    pub fn create_mesh_pairing(
        &self,
        name: Option<String>,
        virtual_ip: &str,
    ) -> Result<PairingOffer, String> {
        let ip: Ipv4Addr = virtual_ip.parse().map_err(|_| {
            "mesh_unavailable: this device has no mesh address yet; wait for the device mesh to connect"
                .to_string()
        })?;
        let (Some(addr), Some(fingerprint)) = (self.mesh_addr(), self.mesh_fingerprint()) else {
            return Err(
                "mesh_unavailable: the device-mesh listener is not running; sign in and wait for the device mesh to connect"
                    .to_string(),
            );
        };
        let base = format!("https://{}:{}", ip, addr.port());
        Ok(self.pairing_offer(&base, fingerprint, name))
    }

    fn pairing_offer(&self, base: &str, fingerprint: String, name: Option<String>) -> PairingOffer {
        let name = name
            .map(|name| name.trim().chars().take(80).collect::<String>())
            .filter(|name| !name.is_empty())
            .unwrap_or_else(|| "Phone or browser".to_string());
        let code = lock(&self.store).create_code(name);
        let url = format!("{base}/pair?code={code}");
        PairingOffer {
            qr_payload: format!("{url}#fp={fingerprint}"),
            url,
            fingerprint,
            expires_at_ms: store::now_ms() + store::PAIRING_CODE_TTL.as_millis() as u64,
        }
    }

    /// Revokes a paired client and closes its connections.
    pub fn revoke(&self, client_id: &str) -> Result<bool, String> {
        let removed = lock(&self.store)
            .revoke(client_id)
            .map_err(|error| format!("failed to store the revocation: {error}"))?;
        for entry in lock(&self.connections).values() {
            if matches!(&entry.scope, Scope::PairedClient { client_id: id } if id == client_id) {
                entry.stop.send_replace(Some(StopReason::Revoked));
            }
        }
        if removed {
            log::info!("OBP paired client revoked: client_id={}", client_id);
        }
        Ok(removed)
    }

    fn register_connection(&self, scope: Scope) -> (u64, watch::Receiver<Option<StopReason>>) {
        let via_mesh = matches!(scope, Scope::AccountDevice { .. });
        self.register_connection_via(scope, via_mesh)
    }

    fn register_connection_via(
        &self,
        scope: Scope,
        via_mesh: bool,
    ) -> (u64, watch::Receiver<Option<StopReason>>) {
        let id = self.next_connection.fetch_add(1, Ordering::Relaxed);
        let (stop, stopped) = watch::channel(None);
        if let Scope::PairedClient { client_id } = &scope {
            lock(&self.store).touch_client(client_id);
        }
        lock(&self.connections).insert(
            id,
            ConnectionEntry {
                scope,
                stop,
                via_mesh,
            },
        );
        (id, stopped)
    }

    fn unregister_connection(&self, id: u64) {
        lock(&self.connections).remove(&id);
    }

    /// Stops both listeners and every connection, and removes the token file.
    pub fn shutdown(&self) {
        if let Some(mut listener) = lock(&self.loopback).take() {
            listener.stop();
        }
        if let Some(mut listener) = lock(&self.lan).take() {
            listener.stop();
        }
        self.stop_mesh();
        for entry in lock(&self.connections).values() {
            entry.stop.send_replace(Some(StopReason::Shutdown));
        }
        lock(&self.store).remove_owner_token();
    }
}

static GLOBAL_SERVER: OnceLock<Arc<ObpServer>> = OnceLock::new();

/// The running server of this process, if the host started one.
pub fn global_server() -> Option<Arc<ObpServer>> {
    GLOBAL_SERVER.get().cloned()
}

/// The NSH web bundle: `OPENBITFUN_WEB_UI_DIR`, the packaged app's resources,
/// next to the executable, or the repository build output in development
/// builds (`pnpm run desktop-nsh:web`).
pub fn default_web_root() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(dir) = std::env::var_os("OPENBITFUN_WEB_UI_DIR") {
        candidates.push(PathBuf::from(dir));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(contents) = exe.parent().and_then(|dir| dir.parent()) {
            candidates.push(contents.join("Resources/nsh-web"));
        }
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("nsh-web"));
        }
    }
    if cfg!(debug_assertions) {
        candidates.push(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../../../target/desktop-nsh/web/OpenBitFun"),
        );
    }
    candidates
        .into_iter()
        .find(|dir| dir.join("index.html").is_file())
        .and_then(|dir| dir.canonicalize().ok())
}

fn env_port(name: &str, default: u16) -> u16 {
    std::env::var(name)
        .ok()
        .and_then(|value| value.trim().parse().ok())
        .unwrap_or(default)
}

/// Starts the listeners for the native host: loopback always (unless
/// `OPENBITFUN_OBP_LISTENER=off`), the LAN when the user enabled it.
pub async fn start_for_native_host(service: BackendService, data_dir: &Path) {
    if std::env::var("OPENBITFUN_OBP_LISTENER")
        .map(|value| value.eq_ignore_ascii_case("off") || value == "0")
        .unwrap_or(false)
    {
        log::info!("OBP listener disabled by OPENBITFUN_OBP_LISTENER");
        return;
    }
    let mut options = ObpServerOptions::new(data_dir.join("obp"));
    options.web_root = default_web_root();
    options.loopback_port = env_port("OPENBITFUN_OBP_PORT", DEFAULT_LOOPBACK_PORT);
    options.lan_port = env_port("OPENBITFUN_OBP_LAN_PORT", DEFAULT_LAN_PORT);
    match &options.web_root {
        Some(root) => log::info!("OBP serves the web UI from: {}", root.display()),
        None => log::info!(
            "OBP has no web UI bundle; `/` explains how to build it (pnpm run desktop-nsh:web)"
        ),
    }
    let server = match ObpServer::new(Arc::new(service), options) {
        Ok(server) => server,
        Err(error) => {
            log::warn!("OBP listener unavailable: {}", error);
            return;
        }
    };
    if let Err(error) = server.start_loopback().await {
        log::warn!("OBP loopback listener failed to start: {}", error);
    }
    if server.lan_enabled() {
        let _ = server.start_lan().await;
    }
    if GLOBAL_SERVER.set(server).is_err() {
        log::warn!("OBP listener was already started in this process");
    }
}

/// Stops the process's listeners (backend shutdown).
pub fn shutdown_global() {
    if let Some(server) = GLOBAL_SERVER.get() {
        server.shutdown();
    }
}

/// Status for hosts that never start the listener (the Tauri host).
pub fn unavailable_status() -> ObpStatus {
    ObpStatus::unavailable(
        "obp_unavailable: this desktop host does not run the browser/phone listener; use the native desktop app"
            .to_string(),
    )
}

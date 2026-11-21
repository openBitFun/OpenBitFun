//! The backend protocol (OBP) over WebSocket, server side: one listener on
//! loopback for browsers on this machine, and the TLS listener on the
//! account device network (`mesh.rs`) for the account's other devices and
//! for phones that joined it, both serving the NSH web bundle at `/` and the
//! protocol at `/obp`.
//!
//! The server is a transport only: every call goes to the host's
//! [`ObpBackend::dispatch`] and every event comes from the host's
//! [`EventHub`]. Each connection is bound to a scope (`owner` on loopback
//! with the per-launch token, `paired-client` on the mesh listener with a
//! revocable QR credential, `account-device` on the mesh listener with the
//! device key handshake); the Product Operation Registry decides what a
//! non-owner scope may run and receive. See
//! `docs/architecture/unified-client-architecture.md`.

mod connection;
pub mod e2e;
mod http;
mod link;
mod mesh;
mod protocol;
mod scope;
mod store;
mod tls;
mod ui_fetch;

#[cfg(test)]
mod e2e_tests;
#[cfg(test)]
mod fleet_tests;
#[cfg(test)]
mod mesh_tests;
#[cfg(test)]
mod test_http;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod ui_fetch_tests;

#[cfg(feature = "fleet")]
pub(crate) use connection::{coalesce as coalesce_events, Outgoing};
pub use connection::{ConnectionLimits, StopReason};
pub use link::{serve_on_link, LinkIncoming};
#[cfg(any(test, feature = "test-support"))]
pub use mesh::LoopbackIncoming;
pub use mesh::{MeshAcceptFuture, MeshIncoming};
pub use openbitfun_product_domains::remote_surface::PeerHostKind;
#[cfg(feature = "fleet")]
pub(crate) use protocol::passes_prefixes;
pub use protocol::{BASE_MESH_CAPABILITIES, SERVER_CAPABILITIES};
pub use scope::{
    check_cloud_agent_call, check_command, event_visible, scope_for_device, CloudAgentPolicy,
    Scope, CLOUD_AGENT_DEVICE_KIND, CLOUD_AGENT_SCOPE_CAPABILITY, FLEET_MODEL_COMMANDS,
};

pub use crate::authority::{DeviceKindFuture, MeshAuthority, MeshInfo, MeshIo, PairKeyFuture};
pub use crate::OBP_PROTOCOL_VERSION;

use std::collections::HashMap;
use std::future::Future;
use std::net::{Ipv4Addr, SocketAddr};
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use serde_json::Value;
use tokio::sync::{oneshot, watch};

use crate::events::EventHub;
pub use crate::ui_bundle::UiBundleSource;

/// Default loopback port (falls back to an ephemeral one when taken).
pub const DEFAULT_LOOPBACK_PORT: u16 = 47610;

/// A boxed dispatch future owning its inputs.
pub type ObpDispatchFuture = Pin<Box<dyn Future<Output = Result<Value, String>> + Send + 'static>>;

/// What the server needs from a backend (the host plugs in its dispatcher,
/// its event source and what kind of host it is).
pub trait ObpBackend: Send + Sync + 'static {
    /// Runs one command with Tauri-shaped JSON arguments.
    fn dispatch(&self, command: String, args: Value) -> ObpDispatchFuture;
    /// The ordered event stream.
    fn events(&self) -> Arc<EventHub>;
    /// `{version, platform, dataDir}`.
    fn info(&self) -> Value;
    /// The kind of host behind this backend: its `hello` advertises the
    /// registry's peer-host capabilities of that kind (`hostCapabilities`),
    /// so a controller gates features exactly as it does for that host.
    fn host_kind(&self) -> PeerHostKind {
        PeerHostKind::Desktop
    }
    /// Same-account host verbs this backend serves to `account-device`
    /// connections besides registry `Proxied` commands (detached dispatch
    /// targets, the IM bot `RemoteCommand` lane). Never admitted for a paired
    /// client.
    fn is_account_device_host_verb(&self, _command: &str) -> bool {
        false
    }
    /// Capabilities added to an `account-device` connection's `hello` and to
    /// `/obp/mesh/info` for the host verbs above (`dispatch_target_v1`,
    /// `remote_command_v1`).
    fn mesh_capabilities(&self) -> Vec<&'static str> {
        Vec::new()
    }
    /// Whether a failed command's text means "not available on this host"
    /// (`data.kind = "unsupported"` on the wire).
    fn is_unsupported_error(&self, message: &str) -> bool {
        message.starts_with(crate::UNSUPPORTED_IN_NATIVE_HOST)
    }
    /// The fleet event mux of this host, once its fleet layer runs: a hello
    /// with `fleet` on the owner or account-device scope then gets the
    /// merged, origin-tagged stream and the connection answers
    /// `fleet_subscribe` itself. `None` (the default): such a hello is
    /// answered as an old entry's, frames unchanged.
    #[cfg(feature = "fleet")]
    fn fleet_mux(&self) -> Option<Arc<crate::fleet::mux::FleetMux>> {
        None
    }
    /// Whether this host serves the account's cloud agent (its device
    /// switches and the model relay): advertises `cloud_agent_scope_v1`.
    /// The superagent never dials a host that does not.
    fn serves_cloud_agent(&self) -> bool {
        false
    }
    /// The device's cloud-agent switches, read for each `cloud-agent` call
    /// (`superagent.acceptDispatch`, `superagent.allowAutoApproval`; both
    /// default on).
    fn cloud_agent_policy(&self) -> CloudAgentPolicyFuture {
        Box::pin(async { CloudAgentPolicy::default() })
    }
}

/// A boxed future yielding the device's cloud-agent switches.
pub type CloudAgentPolicyFuture = Pin<Box<dyn Future<Output = CloudAgentPolicy> + Send>>;

/// How a server is set up.
#[derive(Debug, Clone)]
pub struct ObpServerOptions {
    /// Where tokens, credentials and the TLS identity live (`<data>/obp`).
    pub state_dir: PathBuf,
    /// The NSH web bundle (`index.html` and its files), if this build has it.
    pub web_root: Option<PathBuf>,
    /// The web UI bundle browsers load from this host by hash
    /// (`ui_bundle_manifest`, `GET /obp-ui/v1/<sha256>` on the mesh
    /// listener). `None`: the bundle under `web_root`, or none.
    pub ui_bundle: Option<Arc<UiBundleSource>>,
    /// Preferred loopback port; `0` asks for an ephemeral one.
    pub loopback_port: u16,
    pub limits: ConnectionLimits,
}

impl ObpServerOptions {
    pub fn new(state_dir: PathBuf) -> Self {
        Self {
            state_dir,
            web_root: None,
            ui_bundle: None,
            loopback_port: DEFAULT_LOOPBACK_PORT,
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
    /// Phones and browsers paired on the mesh listener.
    pub paired_clients: Vec<PairedClientStatus>,
    pub owner_connections: usize,
    pub paired_connections: usize,
    /// Other devices of the account connected over the mesh listener.
    pub account_device_connections: usize,
    /// The mesh listener's loopback port (reached on the virtual IP).
    pub mesh_port: Option<u16>,
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
    /// What the QR encodes: `https://<virtual-ip>:<port>/pair?code=…#fp=sha256:…`.
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
    connections: Mutex<HashMap<u64, ConnectionEntry>>,
    next_connection: AtomicU64,
    mesh: mesh::MeshListenerState,
    ui_bundle: Arc<UiBundleSource>,
    /// Concurrent by-hash fetches of web UI files (`ui_fetch`).
    ui_fetch_slots: Arc<tokio::sync::Semaphore>,
    /// Connections attached as fleet clients now (their hello carried
    /// `fleet` and was answered with a fleet stream): `fleetLoad` on
    /// `/obp/mesh/info`, which entry rankings use to spread clients.
    fleet_clients: Arc<AtomicUsize>,
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
        let ui_bundle = options.ui_bundle.clone().unwrap_or_else(|| {
            Arc::new(match &options.web_root {
                Some(root) => UiBundleSource::directory(root.clone()),
                None => UiBundleSource::unavailable(
                    "this build ships no web UI bundle; update OpenBitFun on this device",
                ),
            })
        });
        Ok(Arc::new(Self {
            backend,
            options,
            instance_id: uuid::Uuid::new_v4().to_string(),
            registry_digest: openbitfun_product_domains::remote_surface::digest(),
            store: Mutex::new(store),
            loopback: Mutex::new(None),
            connections: Mutex::new(HashMap::new()),
            next_connection: AtomicU64::new(1),
            mesh: mesh::MeshListenerState::default(),
            ui_bundle,
            ui_fetch_slots: Arc::new(tokio::sync::Semaphore::new(ui_fetch::MAX_CONCURRENT)),
            fleet_clients: Arc::new(AtomicUsize::new(0)),
        }))
    }

    /// The per-launch owner token (also in `<state_dir>/owner-token`).
    pub fn owner_token(&self) -> String {
        lock(&self.store).owner_token().to_string()
    }

    pub fn instance_id(&self) -> &str {
        &self.instance_id
    }

    /// Connections attached as fleet clients now (`fleetLoad`).
    pub fn fleet_load(&self) -> usize {
        self.fleet_clients.load(Ordering::Relaxed)
    }

    pub fn web_root(&self) -> Option<&Path> {
        self.options.web_root.as_deref()
    }

    /// The web UI bundle this host hands to browsers.
    pub fn ui_bundle(&self) -> &Arc<UiBundleSource> {
        &self.ui_bundle
    }

    /// `ui_bundle_manifest`: `{manifest, bundleId}`, or
    /// `ui_bundle_unavailable: <reason>` (loads off the async workers).
    pub async fn ui_bundle_manifest(&self) -> Result<Value, String> {
        ui_bundle_manifest(Arc::clone(&self.ui_bundle)).await
    }

    /// The loopback listener's address, once started.
    pub fn loopback_addr(&self) -> Option<SocketAddr> {
        lock(&self.loopback).as_ref().map(|listener| listener.addr)
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

    /// The listeners, pairings and connections now.
    pub fn status(&self) -> ObpStatus {
        let loopback = self.loopback_addr();
        let owner_token = self.owner_token();
        let connections = lock(&self.connections);
        let connected: Vec<&str> = connections
            .values()
            .filter_map(|entry| match &entry.scope {
                Scope::PairedClient { client_id } => Some(client_id.as_str()),
                Scope::Owner | Scope::AccountDevice { .. } | Scope::CloudAgent { .. } => None,
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
            paired_clients,
            owner_connections,
            paired_connections: connected.len(),
            account_device_connections,
            mesh_port: self.mesh_addr().map(|addr| addr.port()),
        }
    }

    /// A one-time pairing code for a phone or browser on the account's
    /// device network (OpenBitFun Link); `virtual_ip` is this device's
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
        let via_mesh = scope.is_mesh_device();
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
        self.stop_mesh();
        for entry in lock(&self.connections).values() {
            entry.stop.send_replace(Some(StopReason::Shutdown));
        }
        lock(&self.store).remove_owner_token();
    }
}

/// `ui_bundle_manifest` of `source` on a blocking thread (the first load
/// hashes every file of the bundle).
pub async fn ui_bundle_manifest(source: Arc<UiBundleSource>) -> Result<Value, String> {
    tokio::task::spawn_blocking(move || source.manifest_response())
        .await
        .unwrap_or_else(|error| {
            Err(format!(
                "{}: the bundle check failed: {error}",
                crate::ui_bundle::UNAVAILABLE
            ))
        })
}

/// Status for a host whose listener is not running.
pub fn unavailable_status(reason: impl Into<String>) -> ObpStatus {
    ObpStatus::unavailable(reason.into())
}

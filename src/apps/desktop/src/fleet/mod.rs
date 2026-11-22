//! The fleet layer of the native desktop host.
//!
//! While this host's device network serves an account (`crate::mesh`), it
//! runs the shared fleet layer (`openbitfun_obp::fleet`): an index of every
//! runtime host of the account, `fleet_call` routing, replication of the
//! other hosts' digests, and the per-origin event mux. Any client connected
//! to this host (the native UI in-process, a phone or browser over the mesh)
//! then sees and drives every device of the account through it. This module
//! only plugs the desktop in:
//!
//! - [`DesktopFleetBackend`]: the local digest (`openbitfun_core::service::fleet`),
//!   the local dispatcher under the `account-device` allowlist, and this
//!   device's facts;
//! - presence from the desktop's Link node and the account directory, links
//!   through Peer Device Mode's [`crate::mesh::peer_link::global`];
//! - [`fleet_api`]: the fleet backend commands, and the owner verbs served on the
//!   mesh listener (`backend_protocol::ws::mesh_verbs`);
//! - `models`: sessions here may run another device's model: the account
//!   catalog mirrored as runtime model entries, rounds over the links.
//!
//! It starts with the mesh listener (before it, so the first hello already
//! advertises `fleet_v1`) and stops with it. Without a running fleet every
//! fleet command answers `fleet_unavailable: ...`.
//!
//! Remote scenarios: a phone or browser reaches this through the mesh
//! listener (`account-device` scope); Peer Device Mode keeps working beside
//! it; remote workspaces stay owned by the device holding the SSH profile.

pub mod fleet_api;
mod models;

use std::path::PathBuf;
use std::sync::{Arc, OnceLock, RwLock};

use openbitfun_core::service::fleet::{
    is_digest_relevant_event, CoreFleetDigestSource, FleetDigestProducer,
};
use openbitfun_link::session::Link;
use openbitfun_obp::fleet::host::{
    dispatch_as_account_device, fleet_unavailable, FleetDirectory, FleetDirectoryDevice, FleetHost,
    FleetHostParts, LinkPresence, LocalEventHook,
};
use openbitfun_obp::fleet::index::index_cache_path;
use openbitfun_obp::fleet::mux::FleetMux;
use openbitfun_obp::fleet::router::FleetBackend;
use openbitfun_obp::fleet::sync::FleetSyncConfig;
use openbitfun_obp::fleet::{FleetCallError, FleetFuture};
use openbitfun_product_domains::fleet::{
    FleetDeviceFacts, FleetDeviceRoute, FleetDeviceState, FleetDigest, FleetDigestRequest,
    FleetHostKind, FleetRouteKind, FLEET_PROTOCOL_VERSION,
};
use openbitfun_product_domains::remote_surface::{advertised_by, PeerHostKind};
use serde_json::Value;

use crate::backend_protocol::ws::MeshAuthority;
use crate::backend_protocol::{BackendService, EventHub};

/// What the native host installs at startup.
struct Installed {
    service: BackendService,
    data_dir: PathBuf,
}

static INSTALLED: OnceLock<Installed> = OnceLock::new();
static CURRENT: RwLock<Option<Arc<FleetHost>>> = RwLock::new(None);
static MODEL_CONFIG_FOLLOWER: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

fn ensure_model_config_follower() {
    if MODEL_CONFIG_FOLLOWER.swap(true, std::sync::atomic::Ordering::AcqRel) {
        return;
    }
    tokio::spawn(async move {
        let Ok(service) = openbitfun_core::service::config::get_global_config_service().await
        else {
            MODEL_CONFIG_FOLLOWER.store(false, std::sync::atomic::Ordering::Release);
            return;
        };
        let mut changes = service.subscribe_local_changes();
        while changes.changed().await.is_ok() {
            let digest = DIGEST
                .read()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .clone();
            if let Some(digest) = digest {
                digest.notify_changed();
            }
        }
        MODEL_CONFIG_FOLLOWER.store(false, std::sync::atomic::Ordering::Release);
    });
}
/// The digest producer of the running fleet (Detached Dispatch pokes it).
static DIGEST: RwLock<Option<Arc<FleetDigestProducer>>> = RwLock::new(None);

/// Remembers the backend and data directory the fleet runs with (the native
/// host, once at startup).
pub fn install(service: BackendService, data_dir: PathBuf) {
    if INSTALLED.set(Installed { service, data_dir }).is_err() {
        log::debug!("Fleet layer was already installed in this process");
    }
}

/// The running fleet, if this host serves one now.
pub fn current() -> Option<Arc<FleetHost>> {
    CURRENT
        .read()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone()
}

/// The running fleet, or the `fleet_unavailable` answer for `command`.
pub(crate) fn require(command: &str) -> Result<Arc<FleetHost>, String> {
    current().ok_or_else(|| fleet_unavailable(command))
}

/// The event mux of the running fleet (`ObpBackend::fleet_mux`).
pub fn mux() -> Option<Arc<FleetMux>> {
    current().map(|host| host.mux())
}

/// The OBP server's instance id: the key of this host's events and digest.
pub(crate) fn instance_id() -> String {
    crate::backend_protocol::ws::global_server()
        .map(|server| server.instance_id().to_string())
        .unwrap_or_default()
}

/// This device's own facts as the fleet shows them.
pub(crate) fn local_facts(device_id: &str, host_kind: FleetHostKind) -> FleetDeviceFacts {
    let name = openbitfun_core::service::remote_connect::DeviceIdentity::from_current_machine()
        .map(|identity| identity.device_name)
        .ok()
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| device_id.to_string());
    let peer_kind = match host_kind {
        FleetHostKind::Cli => PeerHostKind::Cli,
        _ => PeerHostKind::Desktop,
    };
    FleetDeviceFacts {
        device_id: device_id.to_string(),
        name,
        host_kind,
        // The native UI runs on this machine.
        is_client_device: true,
        state: FleetDeviceState::Online,
        state_reason: None,
        as_of_ms: now_ms(),
        version: Some(crate::VERSION.to_string()),
        fleet_protocol: Some(FLEET_PROTOCOL_VERSION),
        host_capabilities: advertised_by(peer_kind)
            .iter()
            .map(|capability| capability.key().to_string())
            .collect(),
        route: Some(FleetDeviceRoute {
            kind: FleetRouteKind::Local,
            latency_ms: None,
            relay_via: None,
        }),
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or_default()
}

/// `fleet://digest-changed` into the host's event stream (which the native
/// UI and every OBP connection read).
struct HubEmitter(Arc<EventHub>);

#[async_trait::async_trait]
impl openbitfun_events::EventEmitter for HubEmitter {
    async fn emit(&self, event_name: &str, payload: Value) -> anyhow::Result<()> {
        self.0.publish(event_name, payload);
        Ok(())
    }
}

/// This host's digest producer over the core owners (workspace catalog,
/// session store, Runtime mailboxes). `None` until the backend finished
/// starting.
fn digest_producer(
    service: &BackendService,
    device_id: &str,
    hub: &Arc<EventHub>,
) -> Option<Arc<FleetDigestProducer>> {
    let host = service.host();
    let app = host.try_state::<crate::api::app_state::AppState>()?;
    let runtime = host.try_state::<crate::runtime::DesktopRuntimeContext>()?;
    // The Detached Dispatch mailbox is owned by the CLI runner; the desktop
    // reads it out of process and pokes the digest when it changes.
    let dispatch_prompts = Arc::new(crate::api::dispatch_host::DesktopDispatchPrompts::default());
    let source = CoreFleetDigestSource::new(
        Arc::clone(&app.workspace_service),
        runtime.session_application().compatibility().clone(),
        runtime.agent_runtime().clone(),
    )
    .with_dispatch_prompts(Arc::clone(&dispatch_prompts) as _);
    let producer = FleetDigestProducer::new(
        device_id.to_string(),
        instance_id(),
        Arc::new(source),
        Some(Arc::new(HubEmitter(Arc::clone(hub)))),
    );
    let weak = Arc::downgrade(&producer);
    dispatch_prompts.on_change(move || {
        if let Some(producer) = weak.upgrade() {
            producer.notify_changed();
        }
    });
    Some(producer)
}

/// The desktop as a fleet owner and entry.
pub struct DesktopFleetBackend {
    device_id: String,
    service: BackendService,
    digest: Arc<FleetDigestProducer>,
}

impl FleetBackend for DesktopFleetBackend {
    fn local_device_id(&self) -> Option<String> {
        Some(self.device_id.clone())
    }

    fn local_facts(&self) -> FleetDeviceFacts {
        local_facts(&self.device_id, FleetHostKind::Desktop)
    }

    fn local_digest(
        &self,
        request: FleetDigestRequest,
    ) -> FleetFuture<'_, Result<FleetDigest, String>> {
        Box::pin(self.digest.digest(request))
    }

    fn dispatch_local(
        &self,
        command: String,
        args: Value,
    ) -> FleetFuture<'_, Result<Value, FleetCallError>> {
        Box::pin(dispatch_as_account_device(
            &self.service,
            &self.device_id,
            command,
            args,
        ))
    }
}

/// The signed-in account's directory, through the desktop's account session.
struct DesktopDirectory;

impl FleetDirectory for DesktopDirectory {
    fn devices(&self) -> FleetFuture<'_, Result<Vec<FleetDirectoryDevice>, String>> {
        Box::pin(async {
            // The new-version account directory (with the account's cloud
            // node row, kind `cloud_agent`), never the legacy relay.
            let devices = crate::api::account_directory::with_directory_session(
                |session, directory_url| async move {
                    openbitfun_core::service::remote_connect::AccountClient::new()
                        .list_devices_with_cloud_agent(&directory_url, &session)
                        .await
                        .map_err(|error| format!("device directory unavailable: {error}"))
                },
            )
            .await?;
            Ok(devices
                .into_iter()
                .map(|device| FleetDirectoryDevice {
                    name: device
                        .device_alias
                        .filter(|alias| !alias.trim().is_empty())
                        .unwrap_or(device.device_name),
                    device_id: device.device_id,
                    kind: device.device_kind,
                    online: device.online,
                    version: device.device_client_version,
                    last_seen_ms: device
                        .last_seen_at
                        .and_then(|seconds| u64::try_from(seconds).ok())
                        .map(|seconds| seconds.saturating_mul(1000)),
                })
                .collect())
        })
    }
}

/// Starts the fleet of `device_id` (the mesh listener is about to serve that
/// account). Replaces a fleet of another account.
pub fn start(device_id: String, authority: Arc<dyn MeshAuthority>, link: Arc<Link>) {
    let Some(installed) = INSTALLED.get() else {
        log::debug!("Fleet layer not installed; the fleet stays off");
        return;
    };
    if current().is_some_and(|host| host.device_id() == device_id) {
        return;
    }
    stop();
    let hub = Arc::clone(installed.service.events());
    let Some(digest) = digest_producer(&installed.service, &device_id, &hub) else {
        log::warn!("Fleet not started: the backend runtime is not ready");
        return;
    };
    *DIGEST
        .write()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(Arc::clone(&digest));
    let backend: Arc<dyn FleetBackend> = Arc::new(DesktopFleetBackend {
        device_id: device_id.clone(),
        service: installed.service.clone(),
        digest: Arc::clone(&digest),
    });
    // Follow local model config changes with a single process-wide task so
    // repeated Link/fleet reconnects never accumulate parked follower tasks.
    ensure_model_config_follower();
    let on_local_event: LocalEventHook = Arc::new(move |event: &str| {
        if is_digest_relevant_event(event) {
            digest.notify_changed();
        }
        if event == openbitfun_product_domains::fleet::FLEET_INDEX_CHANGED_EVENT {
            models::schedule_sync();
        }
    });
    // The peer links dial the account's cloud node too (`peer_link`).
    let presence =
        LinkPresence::with_cloud_node(link, device_id.clone(), Arc::new(DesktopDirectory), true);
    let host = FleetHost::start(
        device_id,
        FleetHostParts {
            backend,
            links: crate::mesh::peer_link::global(),
            presence,
            authority,
            hub,
            cache_path: Some(index_cache_path(&installed.data_dir)),
            config: FleetSyncConfig::default(),
            on_local_event: Some(on_local_event),
        },
    );
    *CURRENT
        .write()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(host);
    // Sessions here may run other devices' models (`fleet_models`).
    openbitfun_core::service::fleet::models::install_peers(Arc::new(models::DesktopModelPeers));
    models::schedule_sync();
}

/// Stops the running fleet (sign-out, account change, shutdown). The index
/// cache stays on disk.
pub fn stop() {
    openbitfun_core::service::fleet::models::clear_peers();
    DIGEST
        .write()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .take();
    let host = CURRENT
        .write()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .take();
    if let Some(host) = host {
        host.shutdown();
    }
}

/// A Detached Dispatch target verb answered on this host. The job runs in the
/// `openbitfun dispatch` runner (another process), so this host learns of its
/// workspace and session only here: a submitted job's workspace (its managed
/// worktree) becomes one of this host's recent workspaces, and every verb
/// (the cloud node polls status while a job runs) re-reads the digest, so the
/// index lists the job's session once the runner created it. Opening a job
/// then finds the session in its own workspace.
pub(crate) async fn dispatch_target_answered(command: &str, workspace_path: Option<String>) {
    if command == "dispatch_target_submit" {
        if let (Some(path), Some(installed)) = (
            workspace_path.filter(|path| !path.trim().is_empty()),
            INSTALLED.get(),
        ) {
            let host = installed.service.host();
            if let Some(app) = host.try_state::<crate::api::app_state::AppState>() {
                if let Err(error) = app
                    .workspace_service
                    .track_dispatch_workspace(PathBuf::from(&path))
                    .await
                {
                    log::warn!("Dispatch job workspace not tracked: error={error}");
                }
            }
        }
    }
    let digest = DIGEST
        .read()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone();
    if let Some(digest) = digest {
        digest.notify_changed();
    }
}

/// The device network changed (devices came, left, or moved).
pub fn presence_changed() {
    if let Some(host) = current() {
        host.presence_changed();
    }
}

/// The `fleet` member of the native host's ready answer: the fleet protocol
/// this build speaks and this device's id, so the native UI keys its own
/// device before the first fleet call.
pub fn ready_info() -> Option<Value> {
    let device_id = current()
        .map(|host| host.device_id().to_string())
        .or_else(|| crate::api::remote_connect_api::current_device_id_for_peer().ok())?;
    Some(serde_json::json!({
        "protocol": FLEET_PROTOCOL_VERSION,
        "deviceId": device_id,
    }))
}

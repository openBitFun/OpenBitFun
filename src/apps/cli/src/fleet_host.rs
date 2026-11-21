//! The fleet layer of the CLI host.
//!
//! While this process serves the device on OpenBitFun Link (`obp_host`), it
//! runs the same fleet layer as a desktop host (`openbitfun_obp::fleet`): an
//! index of every runtime host of the account, `fleet_call` routing,
//! replication, and the per-origin event mux. So a CLI host is a fleet owner
//! (its digest and event replay for the other hosts) and a fleet entry (a
//! phone or browser connected to it sees and drives every device of the
//! account). It dials other devices over its own Link node
//! ([`LinkPeerConnector`]).
//!
//! The digest reads the core owners through the Peer Device host state
//! (workspace catalog, session store, Runtime mailboxes) and the Detached
//! Dispatch store's pending permissions (`answerRoute: "dispatch"`).
//! `fleet_subscribe` / `fleet_events` serve an in-process UI, which this host
//! has none of: OBP connections answer them in the connection layer.
//!
//! Without a running fleet (signed out, Link off, another host serving the
//! device) every fleet verb answers `fleet_unavailable: ...`.

use std::path::PathBuf;
use std::sync::{Arc, RwLock, Weak};

use openbitfun_core::service::fleet::{
    is_digest_relevant_event, CoreFleetDigestSource, FleetDigestProducer, FleetDispatchPrompt,
    FleetDispatchPromptSource,
};
use openbitfun_link::session::Link;
use openbitfun_obp::client::cloud::{self, CloudStreamOpener};
use openbitfun_obp::fleet::host::{
    dispatch_as_account_device, fleet_unavailable, FleetDirectory, FleetDirectoryDevice, FleetHost,
    FleetHostParts, LinkPeerConnector, LinkPresence, LocalEventHook,
};
use openbitfun_obp::fleet::index::index_cache_path;
use openbitfun_obp::fleet::mux::FleetMux;
use openbitfun_obp::fleet::router::FleetBackend;
use openbitfun_obp::fleet::sync::FleetSyncConfig;
use openbitfun_obp::fleet::{FleetCallError, FleetFuture};
use openbitfun_obp::server::{MeshAuthority, ObpBackend};
use openbitfun_obp::EventHub;
use openbitfun_product_domains::fleet::{
    FleetDeviceFacts, FleetDeviceRoute, FleetDeviceState, FleetDigest, FleetDigestRequest,
    FleetHostKind, FleetRouteKind, FLEET_PROTOCOL_VERSION,
};
use openbitfun_product_domains::remote_surface::{advertised_by, PeerHostKind};
use serde_json::Value;

use crate::runtime::CliRuntimeContext;

static CURRENT: RwLock<Option<Arc<FleetHost>>> = RwLock::new(None);
/// The digest producer of the running fleet (Detached Dispatch pokes it).
static DIGEST: RwLock<Option<Arc<FleetDigestProducer>>> = RwLock::new(None);

/// The running fleet, if this host serves one now.
pub(crate) fn current() -> Option<Arc<FleetHost>> {
    CURRENT
        .read()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone()
}

/// The event mux of the running fleet (`ObpBackend::fleet_mux`).
pub(crate) fn mux() -> Option<Arc<FleetMux>> {
    current().map(|host| host.mux())
}

/// Answers a fleet verb for the OBP backend (`instance_id` is this host's
/// OBP server instance).
pub(crate) async fn dispatch(
    command: &str,
    args: Value,
    instance_id: &str,
) -> Result<Value, String> {
    let Some(host) = current() else {
        return Err(fleet_unavailable(command));
    };
    host.dispatch(command, args, instance_id)
        .await
        .unwrap_or_else(|| Err(format!("command '{command}' is not a fleet verb")))
}

fn now_ms() -> u64 {
    openbitfun_obp::now_ms()
}

/// This machine's display name (the device identity's host name).
fn machine_name(device_id: &str) -> String {
    openbitfun_core::service::remote_connect::DeviceIdentity::from_current_machine()
        .map(|identity| identity.device_name)
        .ok()
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| device_id.to_string())
}

/// This CLI host's own facts as the fleet shows them.
fn local_facts(device_id: &str, name: &str) -> FleetDeviceFacts {
    FleetDeviceFacts {
        device_id: device_id.to_string(),
        name: name.to_string(),
        host_kind: FleetHostKind::Cli,
        // No UI runs in this process; a client is always elsewhere.
        is_client_device: false,
        state: FleetDeviceState::Online,
        state_reason: None,
        as_of_ms: now_ms(),
        version: Some(env!("CARGO_PKG_VERSION").to_string()),
        fleet_protocol: Some(FLEET_PROTOCOL_VERSION),
        host_capabilities: advertised_by(PeerHostKind::Cli)
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

/// The CLI as a fleet owner and entry.
struct CliFleetBackend {
    device_id: String,
    name: String,
    obp: Arc<dyn ObpBackend>,
    digest: Arc<FleetDigestProducer>,
}

impl FleetBackend for CliFleetBackend {
    fn local_device_id(&self) -> Option<String> {
        Some(self.device_id.clone())
    }

    fn local_facts(&self) -> FleetDeviceFacts {
        local_facts(&self.device_id, &self.name)
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
        Box::pin(async move {
            dispatch_as_account_device(self.obp.as_ref(), &self.device_id, command, args).await
        })
    }
}

/// The Detached Dispatch store's pending permissions (read-only).
struct CliDispatchPrompts;

impl FleetDispatchPromptSource for CliDispatchPrompts {
    fn pending_dispatch_prompts(&self) -> Result<Vec<FleetDispatchPrompt>, String> {
        let pending =
            crate::dispatch::pending_dispatch_prompts().map_err(|error| format!("{error:#}"))?;
        Ok(pending
            .into_iter()
            .flat_map(|(job, requests)| {
                requests
                    .into_iter()
                    .map(move |request| FleetDispatchPrompt {
                        job_id: job.job_id.clone(),
                        session_id: job.session_id.clone(),
                        workspace_path: job.workspace_path.clone(),
                        title: job.title.clone(),
                        request,
                    })
            })
            .collect())
    }
}

/// The signed-in account's directory, through the CLI's account session.
struct CliDirectory {
    runtime: Weak<CliRuntimeContext>,
}

impl FleetDirectory for CliDirectory {
    fn devices(&self) -> FleetFuture<'_, Result<Vec<FleetDirectoryDevice>, String>> {
        Box::pin(async move {
            let runtime = self
                .runtime
                .upgrade()
                .ok_or_else(|| "the CLI runtime is shutting down".to_string())?;
            // The new-version account directory (with the account's cloud
            // node row, kind `cloud_agent`), never the legacy relay.
            let account = runtime.account_runtime();
            let (session, directory_url) = account
                .read_directory_context()
                .await
                .map_err(|error| error.to_string())?;
            let listed = openbitfun_core::service::remote_connect::AccountClient::new()
                .list_devices_with_cloud_agent(&directory_url, &session)
                .await;
            let devices = match listed {
                Err(error)
                    if openbitfun_core::service::remote_connect::account::error_indicates_expired_token(
                        &format!("{error:#}"),
                    ) =>
                {
                    account.invalidate_directory_session(&session.token).await;
                    let (session, directory_url) = account
                        .read_directory_context()
                        .await
                        .map_err(|error| error.to_string())?;
                    openbitfun_core::service::remote_connect::AccountClient::new()
                        .list_devices_with_cloud_agent(&directory_url, &session)
                        .await
                }
                other => other,
            }
            .map_err(|error| format!("device directory unavailable: {error}"))?;
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

/// The account's cloud node endpoint (`wss://<account server>/agent/obp`),
/// resolved from the signed-in session per connection.
struct CliCloudStream {
    runtime: Weak<CliRuntimeContext>,
}

impl CloudStreamOpener for CliCloudStream {
    fn open(&self) -> openbitfun_obp::client::MeshOpenFuture<'_> {
        Box::pin(async move {
            let runtime = self
                .runtime
                .upgrade()
                .ok_or_else(|| "the CLI runtime is shutting down".to_string())?;
            // The cloud node lives with the new-version account directory.
            let url = cloud::cloud_node_url(runtime.account_runtime().directory_url())
                .unwrap_or_else(|| cloud::DEFAULT_CLOUD_NODE_URL.to_string());
            cloud::open_websocket(url).await
        })
    }
}

/// `fleet://digest-changed` into this host's event stream.
struct HubEmitter(Arc<EventHub>);

#[async_trait::async_trait]
impl openbitfun_events::EventEmitter for HubEmitter {
    async fn emit(&self, event_name: &str, payload: Value) -> anyhow::Result<()> {
        self.0.publish(event_name, payload);
        Ok(())
    }
}

/// What the OBP host hands over when Link starts serving an account.
pub(crate) struct CliFleetStart {
    pub(crate) device_id: String,
    pub(crate) authority: Arc<dyn MeshAuthority>,
    pub(crate) link: Arc<Link>,
    pub(crate) obp: Arc<dyn ObpBackend>,
    pub(crate) hub: Arc<EventHub>,
    pub(crate) instance_id: String,
    pub(crate) data_dir: PathBuf,
    pub(crate) runtime: Weak<CliRuntimeContext>,
}

/// Starts the fleet of `start.device_id` (Link is about to serve that
/// account). Replaces a fleet of another account. Needs the Peer Device host
/// state (the core owners); without it the fleet stays off.
pub(crate) fn start(start: CliFleetStart) {
    if current().is_some_and(|host| host.device_id() == start.device_id) {
        return;
    }
    stop();
    let Some(state) = crate::peer_host::try_peer_host_state() else {
        tracing::warn!("Fleet not started: the CLI peer host state is not ready");
        return;
    };
    let source = CoreFleetDigestSource::new(
        Arc::clone(&state.workspace_service),
        state.compatibility.clone(),
        state.agent_runtime.clone(),
    )
    .with_dispatch_prompts(Arc::new(CliDispatchPrompts));
    let digest = FleetDigestProducer::new(
        start.device_id.clone(),
        start.instance_id.clone(),
        Arc::new(source),
        Some(Arc::new(HubEmitter(Arc::clone(&start.hub)))),
    );
    *DIGEST
        .write()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(Arc::clone(&digest));
    let backend: Arc<dyn FleetBackend> = Arc::new(CliFleetBackend {
        device_id: start.device_id.clone(),
        name: machine_name(&start.device_id),
        obp: start.obp,
        digest: Arc::clone(&digest),
    });
    let on_local_event: LocalEventHook = Arc::new(move |event: &str| {
        if is_digest_relevant_event(event) {
            digest.notify_changed();
        }
    });
    // The links dial the account's cloud node too (`client::cloud`).
    let presence = LinkPresence::with_cloud_node(
        Arc::clone(&start.link),
        start.device_id.clone(),
        Arc::new(CliDirectory {
            runtime: start.runtime.clone(),
        }),
        true,
    );
    let cloud_node = cloud::CloudNodeConnector::new(
        Arc::new(CliCloudStream {
            runtime: start.runtime,
        }),
        Arc::clone(&start.authority),
        openbitfun_obp::client::default_client_name(),
    );
    let links = openbitfun_obp::client::links::PeerLinks::new(cloud::WithCloudNode::new(
        LinkPeerConnector::new(start.link, Arc::clone(&start.authority)),
        Some(cloud_node),
    ));
    let host = FleetHost::start(
        start.device_id,
        FleetHostParts {
            backend,
            links,
            presence,
            authority: start.authority,
            hub: start.hub,
            cache_path: Some(index_cache_path(&start.data_dir)),
            config: FleetSyncConfig::default(),
            on_local_event: Some(on_local_event),
        },
    );
    *CURRENT
        .write()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(host);
}

/// Stops the running fleet (sign-out, account change, shutdown).
/// A Detached Dispatch target verb answered on this host. The job runs in the
/// `openbitfun dispatch` runner (another process), so this host learns of its
/// workspace and session only here: a submitted job's workspace becomes one of
/// this host's recent workspaces, and every verb (the cloud node polls status
/// while a job runs) re-reads the digest, so the index lists the job's session
/// once the runner created it.
pub(crate) async fn dispatch_target_answered(command: &str, workspace_path: Option<String>) {
    if command == "dispatch_target_submit" {
        if let (Some(path), Some(state)) = (
            workspace_path.filter(|path| !path.trim().is_empty()),
            crate::peer_host::try_peer_host_state(),
        ) {
            if let Err(error) = state
                .workspace_service
                .track_dispatch_workspace(std::path::PathBuf::from(&path))
                .await
            {
                tracing::warn!("Dispatch job workspace not tracked: error={error}");
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

pub(crate) fn stop() {
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

/// Sets the running fleet directly (tests).
#[cfg(test)]
pub(crate) fn install_for_test(host: Option<Arc<FleetHost>>) {
    *CURRENT
        .write()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = host;
}

/// The device network changed (devices came, left, or moved).
pub(crate) fn presence_changed() {
    if let Some(host) = current() {
        host.presence_changed();
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::time::Duration;

    use openbitfun_core::service::fleet::{
        FleetDigestFuture, FleetDigestProducer, FleetDigestSnapshot, FleetDigestSource,
    };
    use openbitfun_obp::client::links::{ConnectFuture, PeerConnector, PeerLinks};
    use openbitfun_obp::client::{LoopbackConnector, MeshConnectOptions, MeshDialer, MeshTarget};
    use openbitfun_obp::fleet::host::{FleetHost, FleetHostParts, FleetPresenceSource};
    use openbitfun_obp::fleet::sync::{FleetPeerPresence, FleetSyncConfig};
    use openbitfun_obp::fleet::FleetFuture;
    use openbitfun_obp::server::{MeshAuthority, ObpServer, ObpServerOptions, PairKeyFuture};
    use openbitfun_obp::EventHub;
    use openbitfun_product_domains::fleet::{
        FleetDigest, FleetHostKind, FleetNavigator, FleetWorkspace, FleetWorkspaceKind,
        FLEET_V1_CAPABILITY,
    };
    use serde_json::json;

    struct SharedKey(&'static str);

    impl MeshAuthority for SharedKey {
        fn local_device_id(&self) -> Option<String> {
            Some(self.0.to_string())
        }

        fn pair_key<'a>(&'a self, _device_id: &'a str) -> PairKeyFuture<'a> {
            Box::pin(async { Ok([6u8; 32]) })
        }
    }

    /// The core owners: one workspace.
    struct OneWorkspace;

    impl FleetDigestSource for OneWorkspace {
        fn snapshot(&self) -> FleetDigestFuture<'_, Result<FleetDigestSnapshot, String>> {
            Box::pin(async {
                Ok(FleetDigestSnapshot {
                    workspaces: vec![FleetWorkspace {
                        workspace_id: "local_cli".into(),
                        name: "build".into(),
                        root_path: "/srv/build".into(),
                        kind: FleetWorkspaceKind::Local,
                        ..FleetWorkspace::default()
                    }],
                    ..FleetDigestSnapshot::default()
                })
            })
        }
    }

    struct NoPeers;

    impl FleetPresenceSource for NoPeers {
        fn presence(&self) -> FleetFuture<'_, Vec<FleetPeerPresence>> {
            Box::pin(async { Vec::new() })
        }
    }

    impl PeerConnector for NoPeers {
        fn connect(&self, device_id: String, _options: MeshConnectOptions) -> ConnectFuture {
            Box::pin(async move { Err(format!("mesh_unreachable: {device_id}")) })
        }

        fn route(&self, _device_id: &str) -> Option<(String, Option<f64>)> {
            None
        }
    }

    /// The CLI host is a fleet entry (a controller reads the navigator and
    /// runs a `fleet_call` on it, under the CLI's own registry answers) and a
    /// fleet owner (another runtime host pulls its digest, advertised as
    /// `fleet_v1`), through the same OBP backend that serves everything else.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn cli_is_fleet_entry_and_owner() {
        let dir = tempfile::tempdir().unwrap();
        let hub = EventHub::new(64);
        let (backend, set_instance) =
            crate::obp_host::test_backend(Arc::clone(&hub), dir.path().display().to_string());
        let mut options = ObpServerOptions::new(dir.path().join("obp"));
        options.loopback_port = 0;
        let server = ObpServer::new(Arc::clone(&backend), options).unwrap();
        set_instance(server.instance_id());
        let authority: Arc<dyn MeshAuthority> = Arc::new(SharedKey("cli-fleet-host"));
        let digest = FleetDigestProducer::new(
            "cli-fleet-host".into(),
            server.instance_id().to_string(),
            Arc::new(OneWorkspace),
            None,
        );
        let fleet = FleetHost::start(
            "cli-fleet-host".into(),
            FleetHostParts {
                backend: Arc::new(super::CliFleetBackend {
                    device_id: "cli-fleet-host".into(),
                    name: "Build box".into(),
                    obp: Arc::clone(&backend),
                    digest,
                }),
                links: PeerLinks::new(Arc::new(NoPeers)),
                presence: Arc::new(NoPeers),
                authority: Arc::clone(&authority),
                hub: Arc::clone(&hub),
                cache_path: Some(super::index_cache_path(dir.path())),
                config: FleetSyncConfig::default(),
                on_local_event: None,
            },
        );
        super::install_for_test(Some(Arc::clone(&fleet)));
        server.start_mesh(authority).await.unwrap();

        let dialer = MeshDialer {
            connector: Arc::new(LoopbackConnector),
            authority: Arc::new(SharedKey("cli-fleet-controller")),
        };
        let target = MeshTarget {
            device_id: "cli-fleet-host".into(),
            virtual_ip: std::net::Ipv4Addr::new(10, 126, 126, 9),
            port: None,
        };
        let (_, info) = dialer.locate(&target).await.unwrap();
        assert!(info.capabilities.iter().any(|c| c == FLEET_V1_CAPABILITY));
        let connection = dialer
            .connect(
                &target,
                MeshConnectOptions {
                    fleet: Some(json!({ "protocol": 1, "cursor": {} })),
                    ..MeshConnectOptions::default()
                },
            )
            .await
            .unwrap();
        assert_eq!(connection.hello()["hostKind"], "cli");
        assert_eq!(connection.hello()["fleet"]["deviceId"], "cli-fleet-host");

        // Entry: the navigator lists this CLI host with its workspace.
        let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
        let navigator = loop {
            let value = connection
                .call("fleet_navigator", json!({ "request": {} }))
                .await
                .unwrap();
            let navigator: FleetNavigator = serde_json::from_value(value).unwrap();
            let ready = navigator
                .devices
                .first()
                .is_some_and(|device| !device.workspaces.is_empty());
            if ready || tokio::time::Instant::now() >= deadline {
                break navigator;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        };
        assert_eq!(navigator.devices.len(), 1);
        let device = &navigator.devices[0];
        assert_eq!(device.device_id, "cli-fleet-host");
        assert_eq!(device.host_kind, FleetHostKind::Cli);
        assert!(!device.is_client_device);
        assert_eq!(device.workspaces[0].workspace_id, "local_cli");

        // A fleet call aimed at this host runs under its own registry.
        let refused = connection
            .call(
                "fleet_call",
                json!({ "request": { "target": "cli-fleet-host", "command": "worktree_list", "args": {} } }),
            )
            .await
            .unwrap_err();
        assert!(
            refused
                .message
                .starts_with("command 'worktree_list' is not supported on CLI peer host"),
            "{refused}"
        );

        // Owner: another runtime host pulls the digest.
        let value = connection
            .call("fleet_digest", json!({ "request": {} }))
            .await
            .unwrap();
        let digest: FleetDigest = serde_json::from_value(value).unwrap();
        assert_eq!(digest.device_id, "cli-fleet-host");
        assert_eq!(digest.instance_id, server.instance_id());
        assert!(digest.full);
        assert_eq!(digest.workspaces.len(), 1);
        let replay = connection
            .call(
                "fleet_replay",
                json!({ "request": { "afterSeq": 0, "instanceId": server.instance_id(), "max": 10 } }),
            )
            .await
            .unwrap();
        assert_eq!(replay["instanceId"], server.instance_id());

        connection.close().await;
        super::install_for_test(None);
        fleet.shutdown();
        server.shutdown();
        assert!(super::current().is_none());
    }
}

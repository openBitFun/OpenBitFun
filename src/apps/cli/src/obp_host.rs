//! The CLI host as a remotely controlled device over OpenBitFun Link.
//!
//! While this process owns the machine's device routing (the interactive
//! CLI without a daemon, or the daemon), remote control is on and an account
//! is signed in, it joins the account's Link network as a device and serves
//! the backend protocol (OBP, `openbitfun-obp`) on its OBP port: the same
//! listener, handshake, scopes and wire as a desktop host, so the desktop's
//! Peer Device Mode, the phone app and the browser controller drive it like
//! one. Calls run through the Peer Device host's registry-derived handlers
//! (`peer_host::handle_obp_call`); a command this host does not run answers
//! with the registry's refusal, and the `hello` advertises the registry's CLI
//! capability set (`hostCapabilities`, `hostKind: "cli"`) so a UI gates
//! features instead of failing late. Events come from the Peer Device host's
//! fan-out ([`publish_event`]).
//!
//! A Desktop on the same machine serving the same device identity wins (it
//! is the primary routing host); this host then stays off Link until it
//! exits. `OPENBITFUN_MESH=off` turns Link off; `openbitfun remote-control
//! off` turns remote control off for the whole machine.

use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock, Weak};

use openbitfun_core::service::remote_connect::account_identity::AccountIdentityClient;
use openbitfun_core::service::remote_connect::device;
use openbitfun_core::service::remote_connect::mesh_route::{
    CAPABILITY_DISPATCH_TARGET_V1, CAPABILITY_REMOTE_COMMAND_V1, OBP_REMOTE_COMMAND,
};
use openbitfun_core::service::remote_connect::remote_server::{RemoteCommand, RemoteServer};
use openbitfun_core::service::superagent_relay;
use openbitfun_link::session::{AccountIdentity, AccountSession, BoxFuture, Link, LinkOptions};
use openbitfun_link::MeshStatus;
use openbitfun_obp::server::{
    serve_on_link, CloudAgentPolicy, CloudAgentPolicyFuture, MeshAuthority, ObpBackend,
    ObpDispatchFuture, ObpServer, ObpServerOptions, PairKeyFuture, PeerHostKind,
};
use openbitfun_obp::EventHub;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::runtime::CliRuntimeContext;

/// Where this host keeps its Link credential cache, OBP TLS identity and
/// status document (`<user data>/cli-host`).
fn host_dir() -> Option<PathBuf> {
    openbitfun_core::infrastructure::try_get_path_manager_arc()
        .ok()
        .map(|paths| paths.user_data_dir().join("cli-host"))
}

const STATUS_FILE: &str = "remote-control.json";
/// A status document older than this is from a host that is gone.
const STATUS_FRESH_MS: u64 = 60_000;

struct CliObpHost {
    hub: Arc<EventHub>,
    link: Arc<Link>,
    server: Arc<ObpServer>,
}

static HOST: OnceLock<CliObpHost> = OnceLock::new();

/// Publishes one event to OBP controllers (no-op until the host runs).
pub(crate) fn publish_event(event: &str, payload: &Value) {
    if let Some(host) = HOST.get() {
        host.hub.publish(event, payload.clone());
    }
}

/// Re-checks whether this process should be on Link now (routing started or
/// stopped, remote control switched).
pub(crate) fn wake() {
    if let Some(host) = HOST.get() {
        host.link.wake();
    }
}

/// Leaves Link and stops the listener (process shutdown); waits briefly.
pub(crate) async fn shutdown() {
    if let Some(host) = HOST.get() {
        crate::fleet_host::stop();
        host.server.shutdown();
        let _ = tokio::time::timeout(std::time::Duration::from_secs(8), host.link.shutdown()).await;
        if let Some(dir) = host_dir() {
            let _ = std::fs::remove_file(dir.join(STATUS_FILE));
        }
    }
}

/// Starts the host for this process (idempotent). Link stays idle until
/// [`CliAccountSession`] lets it join.
pub(crate) fn install(runtime: &Arc<CliRuntimeContext>) {
    if HOST.get().is_some() {
        return;
    }
    if openbitfun_link::session::disabled_by_environment() {
        tracing::info!("CLI remote control over Link disabled by OPENBITFUN_MESH");
        return;
    }
    let Some(dir) = host_dir() else {
        tracing::warn!("CLI remote control over Link unavailable: no user data directory");
        return;
    };
    let hub = EventHub::new(openbitfun_obp::DEFAULT_EVENT_REPLAY_CAPACITY);
    let backend = Arc::new(CliObpBackend {
        hub: Arc::clone(&hub),
        data_dir: dir.display().to_string(),
        instance: OnceLock::new(),
    });
    let mut options = ObpServerOptions::new(dir.join("obp"));
    // No loopback listener: the CLI's own UI is the terminal; browsers on
    // this machine use the desktop app or the web controller.
    options.loopback_port = 0;
    // The web UI a browser loads from this host (compiled in; see
    // `crate::ui_bundle`).
    options.ui_bundle = Some(crate::ui_bundle::source());
    let instance_slot = Arc::clone(&backend);
    let fleet_backend: Arc<dyn ObpBackend> = Arc::clone(&backend) as Arc<dyn ObpBackend>;
    let fleet_hub = Arc::clone(&hub);
    let server = match ObpServer::new(backend, options) {
        Ok(server) => server,
        Err(error) => {
            tracing::warn!("CLI OBP listener unavailable: {error}");
            return;
        }
    };
    let _ = instance_slot.instance.set(server.instance_id().to_string());
    let gate = Arc::new(Mutex::new("starting"));
    let link = Link::start(
        LinkOptions::from_environment(dir.join("mesh"), env!("CARGO_PKG_VERSION")),
        Arc::new(CliAccountSession {
            runtime: Arc::downgrade(runtime),
            gate: Arc::clone(&gate),
        }),
    );
    let host = CliObpHost {
        hub,
        link: Arc::clone(&link),
        server: Arc::clone(&server),
    };
    if HOST.set(host).is_err() {
        return;
    }
    let weak = Arc::downgrade(runtime);
    let status_server = Arc::clone(&server);
    let fleet_link = Arc::clone(&link);
    let fleet_instance = server.instance_id().to_string();
    let fleet_dir = dir.clone();
    tokio::spawn(serve_on_link(
        server,
        link,
        move |account: &AccountIdentity| -> Arc<dyn MeshAuthority> {
            let authority: Arc<dyn MeshAuthority> = Arc::new(CliMeshAuthority {
                runtime: weak.clone(),
                account: account.clone(),
            });
            // The mesh listener is about to serve this account: its fleet
            // starts first, so the first hello already advertises it.
            crate::fleet_host::stop();
            crate::fleet_host::start(crate::fleet_host::CliFleetStart {
                device_id: account.device_id.clone(),
                authority: Arc::clone(&authority),
                link: Arc::clone(&fleet_link),
                obp: Arc::clone(&fleet_backend),
                hub: Arc::clone(&fleet_hub),
                instance_id: fleet_instance.clone(),
                data_dir: fleet_dir.clone(),
                runtime: weak.clone(),
            });
            // Bots and Detached Dispatch on this host reach other devices
            // over the same Link node (`crate::mesh_route`).
            crate::mesh_route::attach(Arc::clone(&fleet_link), Arc::clone(&authority));
            authority
        },
        move |status: &MeshStatus, port: Option<u16>| {
            if status.state == openbitfun_link::MeshState::Running {
                crate::fleet_host::presence_changed();
            } else {
                crate::fleet_host::stop();
                crate::mesh_route::detach();
            }
            write_status(&dir, status, port, &status_server, &gate);
        },
    ));
    tracing::info!("CLI remote control over Link installed");
}

/// The account behind Link, gated on this process owning the device.
struct CliAccountSession {
    runtime: Weak<CliRuntimeContext>,
    gate: Arc<Mutex<&'static str>>,
}

impl CliAccountSession {
    fn set_gate(&self, reason: &'static str) {
        *self.gate.lock().unwrap_or_else(|p| p.into_inner()) = reason;
    }
}

impl AccountSession for CliAccountSession {
    fn identity(&self) -> BoxFuture<'_, Option<AccountIdentity>> {
        Box::pin(async move {
            let Some(runtime) = self.runtime.upgrade() else {
                self.set_gate("shutting_down");
                return None;
            };
            if !device::remote_control_allowed().unwrap_or(false) {
                self.set_gate("remote_control_off");
                return None;
            }
            // The new-version account directory, never the legacy relay.
            let Ok(info) = runtime.account_runtime().directory_account_info().await else {
                self.set_gate("signed_out");
                return None;
            };
            if !runtime.account_routing().serves_device().await {
                // Another host (a Desktop, or the daemon) serves this device.
                self.set_gate("another_host_serves_this_device");
                return None;
            }
            self.set_gate("serving");
            Some(AccountIdentity {
                user_id: info.user_id,
                device_id: info.device_id,
            })
        })
    }

    fn access_token(&self) -> BoxFuture<'_, Result<Option<String>, String>> {
        Box::pin(async {
            let mut identity = AccountIdentityClient::from_environment()
                .await
                .map_err(|error| error.to_string())?;
            identity
                .access_token()
                .await
                .map_err(|error| error.to_string())
        })
    }
}

/// The same-account device directory through the signed-in session.
struct CliMeshAuthority {
    runtime: Weak<CliRuntimeContext>,
    account: AccountIdentity,
}

impl MeshAuthority for CliMeshAuthority {
    fn local_device_id(&self) -> Option<String> {
        Some(self.account.device_id.clone())
    }

    fn pair_key<'a>(&'a self, device_id: &'a str) -> PairKeyFuture<'a> {
        Box::pin(async move {
            if !openbitfun_link::handshake::valid_device_id(device_id) {
                return Err("invalid device id".to_string());
            }
            let runtime = self
                .runtime
                .upgrade()
                .ok_or_else(|| "the CLI runtime is shutting down".to_string())?;
            // The new-version account directory; a 401 signs in again once.
            let account = runtime.account_runtime();
            let mut retried = false;
            loop {
                let (session, directory_url) = account
                    .read_directory_context()
                    .await
                    .map_err(|error| error.to_string())?;
                if session.user_id != self.account.user_id {
                    return Err("the signed-in account changed".to_string());
                }
                match session.peer_message_key(&directory_url, device_id).await {
                    Err(error)
                        if !retried
                            && openbitfun_core::service::remote_connect::account::error_indicates_expired_token(
                                &format!("{error:#}"),
                            ) =>
                    {
                        retried = true;
                        account.invalidate_directory_session(&session.token).await;
                    }
                    result => {
                        return result.map_err(|error| format!("device key lookup failed: {error}"));
                    }
                }
            }
        })
    }

    /// The directory row kind (the same cached key lookup): `cloud_agent`
    /// gives the account's cloud agent its narrow scope.
    fn device_kind<'a>(&'a self, device_id: &'a str) -> openbitfun_obp::DeviceKindFuture<'a> {
        Box::pin(async move {
            let runtime = self
                .runtime
                .upgrade()
                .ok_or_else(|| "the CLI runtime is shutting down".to_string())?;
            // The new-version account directory; a 401 signs in again once.
            let account = runtime.account_runtime();
            let mut retried = false;
            loop {
                let (session, directory_url) = account
                    .read_directory_context()
                    .await
                    .map_err(|error| error.to_string())?;
                if session.user_id != self.account.user_id {
                    return Err("the signed-in account changed".to_string());
                }
                match session.peer_device_kind(&directory_url, device_id).await {
                    Err(error)
                        if !retried
                            && openbitfun_core::service::remote_connect::account::error_indicates_expired_token(
                                &format!("{error:#}"),
                            ) =>
                    {
                        retried = true;
                        account.invalidate_directory_session(&session.token).await;
                    }
                    result => {
                        return result.map_err(|error| format!("device kind lookup failed: {error}"));
                    }
                }
            }
        })
    }
}

/// This host's commands and events, as OBP serves them.
struct CliObpBackend {
    hub: Arc<EventHub>,
    data_dir: String,
    /// The OBP server's instance (the fleet replay key), set once the
    /// server exists.
    instance: OnceLock<String>,
}

impl ObpBackend for CliObpBackend {
    fn dispatch(&self, command: String, args: Value) -> ObpDispatchFuture {
        if command == OBP_REMOTE_COMMAND {
            return Box::pin(remote_command(args));
        }
        // The model relay for the account's cloud agent (the OBP scope admits
        // it for `cloud-agent` connections only).
        if superagent_relay::is_fleet_model_command(&command) {
            return Box::pin(async move {
                superagent_relay::global_relay()
                    .handle(&command, args)
                    .await
            });
        }
        // The fleet layer: entry verbs for any client, owner verbs for the
        // other runtime hosts of the account (`fleet_host`).
        if openbitfun_obp::fleet::host::is_fleet_host_command(&command) {
            let instance = self.instance.get().cloned().unwrap_or_default();
            return Box::pin(async move {
                crate::fleet_host::dispatch(&command, args, &instance).await
            });
        }
        Box::pin(async move { crate::peer_host::handle_obp_call(&command, args).await })
    }

    fn events(&self) -> Arc<EventHub> {
        Arc::clone(&self.hub)
    }

    fn info(&self) -> Value {
        json!({
            "version": env!("CARGO_PKG_VERSION"),
            "platform": std::env::consts::OS,
            "dataDir": self.data_dir,
        })
    }

    fn host_kind(&self) -> PeerHostKind {
        PeerHostKind::Cli
    }

    fn is_account_device_host_verb(&self, command: &str) -> bool {
        command == OBP_REMOTE_COMMAND
            || crate::peer_host::is_dispatch_target_command(command)
            || superagent_relay::is_fleet_model_command(command)
            || openbitfun_obp::fleet::host::is_fleet_owner_verb(command)
    }

    fn mesh_capabilities(&self) -> Vec<&'static str> {
        let mut capabilities = vec![
            CAPABILITY_DISPATCH_TARGET_V1,
            CAPABILITY_REMOTE_COMMAND_V1,
            superagent_relay::FLEET_MODEL_CAPABILITY,
        ];
        // `fleet_v1` only while the fleet serves the owner verbs.
        if crate::fleet_host::current().is_some() {
            capabilities.push(openbitfun_product_domains::fleet::FLEET_V1_CAPABILITY);
        }
        capabilities
    }

    fn fleet_mux(&self) -> Option<Arc<openbitfun_obp::fleet::mux::FleetMux>> {
        crate::fleet_host::mux()
    }

    fn serves_cloud_agent(&self) -> bool {
        true
    }

    fn cloud_agent_policy(&self) -> CloudAgentPolicyFuture {
        Box::pin(async {
            let settings = superagent_relay::device_settings().await;
            CloudAgentPolicy {
                accept_dispatch: settings.accept_dispatch,
                allow_auto_approval: settings.allow_auto_approval,
            }
        })
    }

    fn is_unsupported_error(&self, message: &str) -> bool {
        is_unsupported_refusal(message)
    }
}

/// This host's OBP backend over `hub` (tests of other modules), and a setter
/// for the server instance once the server exists.
#[cfg(test)]
pub(crate) fn test_backend(
    hub: Arc<EventHub>,
    data_dir: String,
) -> (Arc<dyn ObpBackend>, Box<dyn Fn(&str) + Send + Sync>) {
    let backend = Arc::new(CliObpBackend {
        hub,
        data_dir,
        instance: OnceLock::new(),
    });
    let slot = Arc::clone(&backend);
    (
        backend,
        Box::new(move |instance: &str| {
            let _ = slot.instance.set(instance.to_string());
        }),
    )
}

/// The registry's refusals for a command this host does not run (typed
/// `unsupported` on the wire so a UI degrades instead of reporting a fault).
fn is_unsupported_refusal(message: &str) -> bool {
    message.starts_with(openbitfun_obp::UNSUPPORTED_IN_NATIVE_HOST)
        || (message.starts_with("command '")
            && (message.contains("' is not supported on ")
                || message.contains("' is unsupported because ")
                || message.contains("' is unknown to this OpenBitFun ")
                || message.contains("' is local-only and cannot run on peer")))
}

/// `obp_remote_command`: one `RemoteCommand` (the IM bot protocol) run by
/// the generic `RemoteServer` dispatcher on this host (the desktop's
/// `ws::mesh_verbs` does the same), answering its `RemoteResponse`.
async fn remote_command(args: Value) -> Result<Value, String> {
    let command = match args {
        Value::Object(mut object) => object.remove("command").unwrap_or(Value::Null),
        _ => Value::Null,
    };
    if command.is_null() {
        return Err(format!(
            "{OBP_REMOTE_COMMAND} needs {{\"command\": <RemoteCommand>}}"
        ));
    }
    let command: RemoteCommand = serde_json::from_value(command)
        .map_err(|error| format!("{OBP_REMOTE_COMMAND}: unreadable RemoteCommand: {error}"))?;
    match command {
        RemoteCommand::HostInvoke { .. } => Err(format!(
            "{OBP_REMOTE_COMMAND}: host_invoke is not carried here; send the product command as an OBP call"
        )),
        RemoteCommand::DeviceEvent { .. } => Err(format!(
            "{OBP_REMOTE_COMMAND}: device events are not carried here; OBP streams events"
        )),
        command => {
            let response = RemoteServer::new([0u8; 32]).dispatch(&command).await;
            serde_json::to_value(&response)
                .map_err(|error| format!("serialize RemoteResponse: {error}"))
        }
    }
}

/// What `openbitfun remote-control status` reads: the serving process's view
/// (no secrets: no network name, secret or token).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct RemoteControlStatus {
    pub(crate) pid: u32,
    pub(crate) updated_at_ms: u64,
    /// Why this process is or is not on Link (`serving`, `signed_out`,
    /// `remote_control_off`, `another_host_serves_this_device`).
    pub(crate) gate: String,
    pub(crate) state: String,
    pub(crate) reason: Option<String>,
    pub(crate) device_id: Option<String>,
    pub(crate) virtual_ip: Option<String>,
    pub(crate) obp_port: Option<u16>,
    pub(crate) peers: usize,
    pub(crate) relay_nodes: usize,
    pub(crate) account_device_connections: usize,
    pub(crate) paired_connections: usize,
}

fn write_status(
    dir: &std::path::Path,
    status: &MeshStatus,
    port: Option<u16>,
    server: &ObpServer,
    gate: &Mutex<&'static str>,
) {
    let listener = server.status();
    let document = RemoteControlStatus {
        pid: std::process::id(),
        updated_at_ms: openbitfun_obp::now_ms(),
        gate: gate.lock().unwrap_or_else(|p| p.into_inner()).to_string(),
        state: serde_json::to_value(status.state)
            .ok()
            .and_then(|value| value.as_str().map(str::to_string))
            .unwrap_or_default(),
        reason: status.reason.clone(),
        device_id: status.device_id.clone(),
        virtual_ip: status.virtual_ip.clone(),
        obp_port: port,
        peers: status.peers.len(),
        relay_nodes: status.relay_nodes.len(),
        account_device_connections: listener.account_device_connections,
        paired_connections: listener.paired_connections,
    };
    let Ok(bytes) = serde_json::to_vec_pretty(&document) else {
        return;
    };
    if let Err(error) =
        std::fs::create_dir_all(dir).and_then(|_| std::fs::write(dir.join(STATUS_FILE), bytes))
    {
        tracing::debug!("CLI remote control status not written: {error}");
    }
}

/// The serving process's status, when one wrote it recently.
pub(crate) fn read_status() -> Option<RemoteControlStatus> {
    let bytes = std::fs::read(host_dir()?.join(STATUS_FILE)).ok()?;
    let status: RemoteControlStatus = serde_json::from_slice(&bytes).ok()?;
    (openbitfun_obp::now_ms().saturating_sub(status.updated_at_ms) <= STATUS_FRESH_MS)
        .then_some(status)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_refusals_are_typed_unsupported() {
        use openbitfun_product_domains::remote_surface::{
            peer_host_verdict, PeerHostKind, PeerHostVerdict,
        };
        for command in [
            "worktree_list",
            "account_logout",
            "lsp_open_workspace",
            "no_such_cmd",
        ] {
            let PeerHostVerdict::Refuse(refusal) = peer_host_verdict(command, PeerHostKind::Cli)
            else {
                panic!("{command} should be refused on the CLI host");
            };
            assert!(
                is_unsupported_refusal(&refusal.message(command)),
                "{command}: {}",
                refusal.message(command)
            );
        }
        assert!(!is_unsupported_refusal("boom: the command failed"));
        assert!(is_unsupported_refusal(
            "unsupported_in_native_host: something"
        ));
    }

    #[test]
    fn the_backend_advertises_the_cli_host_and_its_host_verbs() {
        let backend = CliObpBackend {
            hub: EventHub::new(8),
            data_dir: "/data".into(),
            instance: OnceLock::new(),
        };
        assert_eq!(backend.host_kind(), PeerHostKind::Cli);
        assert!(backend.is_account_device_host_verb("obp_remote_command"));
        assert!(backend.is_account_device_host_verb("dispatch_target_probe"));
        assert!(!backend.is_account_device_host_verb("peer_mode_ping"));
        assert!(!backend.is_account_device_host_verb("open_workspace"));
        // The model relay for the cloud agent (the OBP scope admits it for
        // `cloud-agent` connections only).
        assert!(backend.is_account_device_host_verb("fleet_model_start"));
        assert!(backend.serves_cloud_agent());
        assert_eq!(
            backend.mesh_capabilities(),
            ["dispatch_target_v1", "remote_command_v1", "fleet_model_v1"]
        );
        assert_eq!(backend.info()["dataDir"], "/data");
    }

    /// Both ends of a test pair share one key (the account directory would
    /// derive it from their X25519 keys).
    struct SharedKey(&'static str);

    impl MeshAuthority for SharedKey {
        fn local_device_id(&self) -> Option<String> {
            Some(self.0.to_string())
        }

        fn pair_key<'a>(&'a self, _device_id: &'a str) -> PairKeyFuture<'a> {
            Box::pin(async { Ok([5u8; 32]) })
        }
    }

    /// The serving path end to end on loopback (standing in for Link): a
    /// controller dials this host with the account-device handshake, sees a
    /// CLI host with the registry's CLI capability set, gets the registry's
    /// typed refusal for a command this host does not run, cannot reach the
    /// peer control plane, and streams this host's events.
    #[tokio::test]
    async fn controllers_drive_the_cli_host_over_obp() {
        use openbitfun_obp::client::{
            LoopbackConnector, MeshConnectOptions, MeshDialer, MeshTarget,
        };
        let dir = tempfile::tempdir().unwrap();
        let hub = EventHub::new(64);
        let backend = Arc::new(CliObpBackend {
            hub: Arc::clone(&hub),
            data_dir: dir.path().display().to_string(),
            instance: OnceLock::new(),
        });
        let mut options = ObpServerOptions::new(dir.path().join("obp"));
        options.loopback_port = 0;
        let server = ObpServer::new(backend, options).unwrap();
        server
            .start_mesh(Arc::new(SharedKey("cli-host-test")))
            .await
            .unwrap();
        let dialer = MeshDialer {
            connector: Arc::new(LoopbackConnector),
            authority: Arc::new(SharedKey("controller-test")),
        };
        let target = MeshTarget {
            device_id: "cli-host-test".into(),
            virtual_ip: std::net::Ipv4Addr::new(10, 126, 126, 9),
            port: None,
        };
        let (_, info) = dialer.locate(&target).await.unwrap();
        for capability in [
            "obp_v1",
            "mesh_v1",
            "dispatch_target_v1",
            "remote_command_v1",
        ] {
            assert!(
                info.capabilities.iter().any(|c| c == capability),
                "{capability}"
            );
        }
        let connection = dialer
            .connect(&target, MeshConnectOptions::default())
            .await
            .unwrap();
        let hello = connection.hello().clone();
        assert_eq!(hello["scope"], "account-device");
        assert_eq!(hello["hostKind"], "cli");
        let advertised: Vec<&str> = hello["hostCapabilities"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(Value::as_str)
            .collect();
        let expected: Vec<&str> =
            openbitfun_product_domains::remote_surface::advertised_by(PeerHostKind::Cli)
                .iter()
                .map(|capability| capability.key())
                .collect();
        assert_eq!(advertised, expected);

        // A registry command the CLI host does not run: the registry's own
        // refusal, typed `unsupported`.
        let refused = connection
            .call("worktree_list", json!({}))
            .await
            .unwrap_err();
        assert_eq!(refused.code, -32000);
        assert_eq!(refused.data.as_ref().unwrap()["kind"], "unsupported");
        assert!(
            refused
                .message
                .starts_with("command 'worktree_list' is not supported on CLI peer host"),
            "{}",
            refused.message
        );
        // The peer control plane is not an OBP command.
        let refused = connection
            .call("peer_mode_ping", json!({}))
            .await
            .unwrap_err();
        assert_eq!(refused.code, -32003);
        // The bot lane is admitted and answers with its own refusal text.
        let refused = connection
            .call(
                "obp_remote_command",
                json!({"command": {"cmd": "host_invoke", "command": "x", "args": {}}}),
            )
            .await
            .unwrap_err();
        assert!(refused.message.contains("host_invoke is not carried here"));

        // Events this host publishes reach the controller; owner-only ones
        // do not.
        hub.publish("account://login-state", json!({"loggedIn": true}));
        hub.publish(
            "agentic://text-chunk",
            json!({"sessionId": "s", "text": "hi"}),
        );
        let event =
            tokio::time::timeout(std::time::Duration::from_secs(5), connection.next_event())
                .await
                .unwrap()
                .unwrap();
        assert_eq!(event.event, "agentic://text-chunk");
        assert_eq!(event.payload["text"], "hi");
        connection.close().await;
        server.shutdown();
    }

    #[tokio::test]
    async fn remote_commands_refuse_forms_with_their_own_obp_lane() {
        let refused = remote_command(
            json!({"command": {"cmd": "host_invoke", "command": "list_sessions", "args": {}}}),
        )
        .await
        .unwrap_err();
        assert!(
            refused.contains("host_invoke is not carried here"),
            "{refused}"
        );
        assert!(remote_command(json!({}))
            .await
            .unwrap_err()
            .contains("needs"));
        assert!(remote_command(json!({"command": {"cmd": "no_such"}}))
            .await
            .unwrap_err()
            .contains("unreadable RemoteCommand"));
    }
}

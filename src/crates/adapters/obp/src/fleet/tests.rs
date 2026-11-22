//! Fleet replication and routing: in-process hosts A (this one), B and C,
//! a mesh peer without `fleet_v1`, and a relay-only device, over a fake
//! transport. The wire links are the hosts' (F-C end-to-end tests).

use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};
use tokio::sync::mpsc;

use openbitfun_product_domains::fleet::*;
use openbitfun_product_domains::remote_surface::FleetEntity;

use super::index::{index_cache_path, FleetApply, FleetIndex};
use super::router::{FleetBackend, FleetRouter};
use super::sync::{
    FleetPeerLinkInfo, FleetPeerPresence, FleetPeerSignal, FleetPeerSubscription,
    FleetPeerTransport, FleetSync, FleetSyncConfig,
};
use super::{FleetCallError, FleetFuture};

// ---------------------------------------------------------------------------
// A fleet_v1 owner with delta revisions
// ---------------------------------------------------------------------------

#[derive(Default)]
struct OwnerState {
    instance: String,
    revision: u64,
    floor: u64,
    workspaces: BTreeMap<String, (FleetWorkspace, u64)>,
    sessions: BTreeMap<String, (FleetSession, u64)>,
    prompts: BTreeMap<String, (FleetPrompt, u64)>,
    removed_sessions: Vec<(String, u64)>,
    removed_workspaces: Vec<(String, u64)>,
    requests: Vec<FleetDigestRequest>,
}

struct FakeOwner {
    device_id: String,
    state: Mutex<OwnerState>,
}

fn workspace(id: &str, name: &str) -> FleetWorkspace {
    FleetWorkspace {
        workspace_id: id.to_string(),
        name: name.to_string(),
        root_path: format!("/home/u/{name}"),
        kind: FleetWorkspaceKind::Local,
        ..Default::default()
    }
}

fn session(workspace_id: &str, id: &str, at: u64) -> FleetSession {
    FleetSession {
        workspace_id: workspace_id.to_string(),
        session_id: id.to_string(),
        title: format!("session {id}"),
        agent_type: "agentic".to_string(),
        last_activity_ms: at,
        ..Default::default()
    }
}

impl FakeOwner {
    fn new(device_id: &str, instance: &str) -> Arc<Self> {
        Arc::new(Self {
            device_id: device_id.to_string(),
            state: Mutex::new(OwnerState {
                instance: instance.to_string(),
                revision: 1,
                floor: 1,
                ..Default::default()
            }),
        })
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, OwnerState> {
        self.state.lock().unwrap()
    }

    fn put_workspace(&self, workspace: FleetWorkspace) {
        let mut state = self.lock();
        state.revision += 1;
        let revision = state.revision;
        state
            .workspaces
            .insert(workspace.workspace_id.clone(), (workspace, revision));
    }

    fn put_session(&self, session: FleetSession) {
        let mut state = self.lock();
        state.revision += 1;
        let revision = state.revision;
        state
            .sessions
            .insert(session.session_id.clone(), (session, revision));
    }

    fn remove_session(&self, id: &str) {
        let mut state = self.lock();
        state.revision += 1;
        let revision = state.revision;
        state.sessions.remove(id);
        state.removed_sessions.push((id.to_string(), revision));
    }

    /// A process restart: a new instance with its own revisions.
    fn restart(&self, instance: &str) {
        let mut state = self.lock();
        let requests = std::mem::take(&mut state.requests);
        *state = OwnerState {
            instance: instance.to_string(),
            revision: 1,
            floor: 1,
            requests,
            ..Default::default()
        };
    }

    fn digest(&self, request: FleetDigestRequest) -> FleetDigest {
        let mut state = self.lock();
        state.requests.push(request.clone());
        let delta_from = request.since_revision.filter(|since| {
            request.instance_id.as_deref() == Some(state.instance.as_str())
                && *since >= state.floor
                && *since <= state.revision
        });
        let after = delta_from.unwrap_or(0);
        let mut digest = FleetDigest {
            device_id: self.device_id.clone(),
            instance_id: state.instance.clone(),
            revision: state.revision,
            full: delta_from.is_none(),
            workspaces: state
                .workspaces
                .values()
                .filter(|(_, at)| *at > after)
                .map(|(w, _)| w.clone())
                .collect(),
            sessions: state
                .sessions
                .values()
                .filter(|(_, at)| *at > after)
                .map(|(s, _)| s.clone())
                .collect(),
            prompts: state
                .prompts
                .values()
                .filter(|(_, at)| *at > after)
                .map(|(p, _)| p.clone())
                .collect(),
            ..Default::default()
        };
        if delta_from.is_some() {
            digest.removed.session_ids = state
                .removed_sessions
                .iter()
                .filter(|(_, at)| *at > after)
                .map(|(id, _)| id.clone())
                .collect();
            digest.removed.workspace_ids = state
                .removed_workspaces
                .iter()
                .filter(|(_, at)| *at > after)
                .map(|(id, _)| id.clone())
                .collect();
        }
        digest
    }
}

// ---------------------------------------------------------------------------
// Fake peers and transport
// ---------------------------------------------------------------------------

#[derive(Clone)]
enum FakePeer {
    Fleet(Arc<FakeOwner>),
    /// A mesh host without `fleet_v1`: navigator, pages, permissions.
    Legacy {
        navigator: Value,
        pages: HashMap<String, Value>,
        permissions: Value,
    },
}

#[derive(Default)]
struct FakeTransport {
    presence: Mutex<Vec<FleetPeerPresence>>,
    peers: Mutex<HashMap<String, FakePeer>>,
    unreachable: Mutex<HashSet<String>>,
    signals: Mutex<HashMap<String, mpsc::UnboundedSender<FleetPeerSignal>>>,
    subscribes: Mutex<Vec<String>>,
    calls: Mutex<Vec<(String, String, Value)>>,
}

impl FakeTransport {
    fn add(&self, presence: FleetPeerPresence, peer: Option<FakePeer>) {
        if let Some(peer) = peer {
            self.peers
                .lock()
                .unwrap()
                .insert(presence.device_id.clone(), peer);
        }
        self.presence.lock().unwrap().push(presence);
    }

    fn set_online(&self, device_id: &str, online: bool) {
        for peer in self.presence.lock().unwrap().iter_mut() {
            if peer.device_id == device_id {
                peer.online = online;
            }
        }
    }

    fn signal(&self, device_id: &str, signal: FleetPeerSignal) {
        if let Some(sender) = self.signals.lock().unwrap().get(device_id) {
            let _ = sender.send(signal);
        }
    }

    fn link_of(&self, device_id: &str) -> Option<FleetPeerLinkInfo> {
        Some(match self.peers.lock().unwrap().get(device_id)? {
            FakePeer::Fleet(owner) => FleetPeerLinkInfo {
                instance_id: Some(owner.lock().instance.clone()),
                capabilities: vec![FLEET_V1_CAPABILITY.to_string()],
                host_capabilities: vec!["user_question_response".to_string()],
                version: Some("0.9.0".to_string()),
            },
            FakePeer::Legacy { .. } => FleetPeerLinkInfo {
                instance_id: Some("old-instance".to_string()),
                capabilities: vec!["dispatch_target_v1".to_string()],
                host_capabilities: Vec::new(),
                version: Some("0.8.0".to_string()),
            },
        })
    }
}

fn echo(device_id: &str, command: &str, args: &Value) -> Value {
    json!({"handledBy": device_id, "command": command, "args": args})
}

impl FleetPeerTransport for FakeTransport {
    fn presence(&self) -> FleetFuture<'_, Vec<FleetPeerPresence>> {
        let presence = self.presence.lock().unwrap().clone();
        Box::pin(async move { presence })
    }

    fn subscribe_index(
        &self,
        device_id: &str,
    ) -> FleetFuture<'_, Result<FleetPeerSubscription, String>> {
        let device_id = device_id.to_string();
        Box::pin(async move {
            self.subscribes.lock().unwrap().push(device_id.clone());
            if self.unreachable.lock().unwrap().contains(&device_id) {
                return Err(format!("mesh_unreachable: {device_id}"));
            }
            let link = self
                .link_of(&device_id)
                .ok_or_else(|| "mesh_unreachable: no such peer".to_string())?;
            let (sender, signals) = mpsc::unbounded_channel();
            self.signals.lock().unwrap().insert(device_id, sender);
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
            self.calls
                .lock()
                .unwrap()
                .push((device_id.clone(), command.clone(), args.clone()));
            if self.unreachable.lock().unwrap().contains(&device_id) {
                return Err(FleetCallError::transport("mesh_unreachable: link down"));
            }
            let peer = self.peers.lock().unwrap().get(&device_id).cloned();
            match (peer, command.as_str()) {
                (None, _) => Err(FleetCallError::transport("mesh_unreachable: no such peer")),
                (Some(FakePeer::Fleet(owner)), "fleet_digest") => {
                    let request: FleetDigestRequest =
                        serde_json::from_value(args["request"].clone()).unwrap();
                    Ok(serde_json::to_value(owner.digest(request)).unwrap())
                }
                (Some(FakePeer::Legacy { .. }), "fleet_digest") => Err(FleetCallError::command(
                    "unsupported_in_native_host: fleet_digest",
                )),
                (Some(FakePeer::Legacy { navigator, .. }), "get_workspace_navigator") => {
                    Ok(navigator)
                }
                (Some(FakePeer::Legacy { pages, .. }), "list_persisted_sessions_page") => {
                    let id = args["request"]["workspaceId"].as_str().unwrap_or_default();
                    pages
                        .get(id)
                        .cloned()
                        .ok_or_else(|| FleetCallError::command("Workspace not found"))
                }
                (
                    Some(FakePeer::Legacy { permissions, .. }),
                    "list_pending_permission_requests",
                ) => Ok(permissions),
                (Some(_), "fail_on_owner") => Err(FleetCallError {
                    code: -32000,
                    message: "Session not found: s-x".to_string(),
                    data: Some(json!({"kind": "command"})),
                }),
                (Some(_), _) => Ok(echo(&device_id, &command, &args)),
            }
        })
    }
}

struct FakeBackend {
    device_id: String,
    owner: Arc<FakeOwner>,
}

impl FleetBackend for FakeBackend {
    fn local_device_id(&self) -> Option<String> {
        Some(self.device_id.clone())
    }

    fn local_facts(&self) -> FleetDeviceFacts {
        FleetDeviceFacts {
            device_id: self.device_id.clone(),
            name: "Laptop A".to_string(),
            host_kind: FleetHostKind::Desktop,
            is_client_device: true,
            state: FleetDeviceState::Online,
            fleet_protocol: Some(FLEET_PROTOCOL_VERSION),
            ..Default::default()
        }
    }

    fn local_digest(
        &self,
        request: FleetDigestRequest,
    ) -> FleetFuture<'_, Result<FleetDigest, String>> {
        let digest = self.owner.digest(request);
        Box::pin(async move { Ok(digest) })
    }

    fn dispatch_local(
        &self,
        command: String,
        args: Value,
    ) -> FleetFuture<'_, Result<Value, FleetCallError>> {
        let value = echo(&self.device_id, &command, &args);
        Box::pin(async move { Ok(value) })
    }
}

fn presence(device_id: &str, name: &str, kind: FleetHostKind) -> FleetPeerPresence {
    FleetPeerPresence {
        device_id: device_id.to_string(),
        name: name.to_string(),
        host_kind: kind,
        online: true,
        mesh: true,
        ..Default::default()
    }
}

struct Fleet {
    index: Arc<FleetIndex>,
    sync: Arc<FleetSync>,
    router: Arc<FleetRouter>,
    transport: Arc<FakeTransport>,
    local: Arc<FakeOwner>,
}

fn fleet_with(cache: Option<std::path::PathBuf>, config: FleetSyncConfig) -> Fleet {
    let transport = Arc::new(FakeTransport::default());
    let local = FakeOwner::new("dev-a", "a-1");
    local.put_workspace(workspace("ws-a", "alpha"));
    let backend = Arc::new(FakeBackend {
        device_id: "dev-a".to_string(),
        owner: Arc::clone(&local),
    });
    let index = FleetIndex::new("dev-a".to_string(), cache, None);
    let sync = FleetSync::new(
        Arc::clone(&index),
        backend.clone(),
        transport.clone(),
        config,
    );
    let router = FleetRouter::new(backend, Arc::clone(&index), transport.clone());
    Fleet {
        index,
        sync,
        router,
        transport,
        local,
    }
}

fn fleet() -> Fleet {
    fleet_with(None, FleetSyncConfig::default())
}

fn link(instance: &str) -> FleetPeerLinkInfo {
    FleetPeerLinkInfo {
        instance_id: Some(instance.to_string()),
        capabilities: vec![FLEET_V1_CAPABILITY.to_string()],
        ..Default::default()
    }
}

fn device<'a>(navigator: &'a FleetNavigator, id: &str) -> &'a FleetDevice {
    navigator
        .devices
        .iter()
        .find(|device| device.device_id == id)
        .unwrap_or_else(|| panic!("device {id} not in the navigator"))
}

fn session_ids(device: &FleetDevice) -> Vec<String> {
    let mut ids: Vec<String> = device
        .workspaces
        .iter()
        .flat_map(|w| w.sessions.iter().map(|s| s.session_id.clone()))
        .collect();
    ids.sort();
    ids
}

async fn call(
    router: &FleetRouter,
    target: Option<&str>,
    command: &str,
    args: Value,
) -> Result<Value, FleetCallError> {
    router
        .fleet_call(FleetCallRequest {
            target: target.map(str::to_string),
            command: command.to_string(),
            args,
        })
        .await
}

/// Add fleet_v1 peer B with one workspace and session, indexed.
async fn with_peer(
    fleet: &Fleet,
    id: &str,
    name: &str,
    sessions: &[(&str, &str)],
) -> Arc<FakeOwner> {
    let owner = FakeOwner::new(id, &format!("{id}-1"));
    for (ws, sid) in sessions {
        if !owner.lock().workspaces.contains_key(*ws) {
            owner.put_workspace(workspace(ws, &format!("{name}-{ws}")));
        }
        owner.put_session(session(ws, sid, 1_000));
    }
    fleet.transport.add(
        presence(id, name, FleetHostKind::Cli),
        Some(FakePeer::Fleet(Arc::clone(&owner))),
    );
    fleet
        .index
        .set_presence(&fleet.transport.presence.lock().unwrap().clone());
    let instance = owner.lock().instance.clone();
    let mut link = link(&instance);
    link.host_capabilities = vec!["user_question_response".to_string()];
    fleet.index.set_link(id, link.clone());
    fleet.sync.pull_digest(id, &link, false).await.unwrap();
    owner
}

async fn wait_until(mut done: impl FnMut() -> bool) {
    for _ in 0..200 {
        if done() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("condition not reached in time");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[tokio::test]
async fn deltas_then_full_resync_on_instance_change() {
    let fleet = fleet();
    let owner = with_peer(&fleet, "dev-b", "Build box", &[("ws-1", "s1")]).await;
    assert_eq!(owner.lock().requests.last().unwrap().since_revision, None);
    let held = fleet.index.partition_cursor("dev-b").unwrap();
    assert_eq!(held.0, "dev-b-1");

    // A change on the owner arrives as a delta from the held revision.
    owner.put_session(session("ws-1", "s2", 2_000));
    owner.remove_session("s1");
    let applied = fleet
        .sync
        .pull_digest("dev-b", &link("dev-b-1"), false)
        .await
        .unwrap();
    assert_eq!(applied, FleetApply::Applied { changed: true });
    let request = owner.lock().requests.last().cloned().unwrap();
    assert_eq!(request.since_revision, Some(held.1));
    assert_eq!(request.instance_id.as_deref(), Some("dev-b-1"));
    let navigator = fleet.index.navigator(None);
    assert_eq!(session_ids(device(&navigator, "dev-b")), vec!["s2"]);

    // A delta that does not start at the held revision is a gap.
    let mut gap = owner.digest(FleetDigestRequest {
        since_revision: Some(1),
        instance_id: Some("dev-b-1".into()),
    });
    gap.revision += 5;
    assert_eq!(
        fleet.index.apply_digest("dev-b", Some(1), gap),
        FleetApply::NeedFull { reason: "gap" }
    );

    // The owner restarted: its partition is replaced by a full snapshot.
    owner.restart("dev-b-2");
    owner.put_workspace(workspace("ws-1", "build"));
    owner.put_session(session("ws-1", "s3", 3_000));
    fleet
        .sync
        .pull_digest("dev-b", &link("dev-b-2"), false)
        .await
        .unwrap();
    let request = owner.lock().requests.last().cloned().unwrap();
    assert_eq!(request.since_revision, None, "instance change pulls full");
    assert_eq!(fleet.index.partition_cursor("dev-b").unwrap().0, "dev-b-2");
    let navigator = fleet.index.navigator(None);
    assert_eq!(session_ids(device(&navigator, "dev-b")), vec!["s3"]);

    // A stale delta from the old instance never applies over the new one.
    let stale = FleetDigest {
        instance_id: "dev-b-1".into(),
        revision: 99,
        full: false,
        ..Default::default()
    };
    assert_eq!(
        fleet.index.apply_digest("dev-b", Some(99), stale),
        FleetApply::NeedFull {
            reason: "instance_changed"
        }
    );

    // Navigator deltas: only devices changed after the client's revision.
    let revision = fleet.index.revision();
    owner.put_session(session("ws-1", "s4", 4_000));
    fleet
        .sync
        .pull_digest("dev-b", &link("dev-b-2"), false)
        .await
        .unwrap();
    let delta = fleet.index.navigator(Some(revision));
    assert!(!delta.full);
    assert_eq!(
        delta
            .devices
            .iter()
            .map(|d| d.device_id.as_str())
            .collect::<Vec<_>>(),
        vec!["dev-b"]
    );

    // Live: a digest hint on the index link pulls a delta.
    let live = fleet_with(None, FleetSyncConfig::default());
    let owner = FakeOwner::new("dev-c", "c-1");
    owner.put_workspace(workspace("ws-c", "gamma"));
    live.transport.add(
        presence("dev-c", "Gamma", FleetHostKind::Desktop),
        Some(FakePeer::Fleet(Arc::clone(&owner))),
    );
    live.sync.start();
    wait_until(|| live.index.partition("dev-c").is_some()).await;
    owner.put_session(session("ws-c", "live-1", 9_000));
    live.transport.signal(
        "dev-c",
        FleetPeerSignal::Event {
            event: FLEET_DIGEST_CHANGED_EVENT.to_string(),
            payload: json!({"revision": 3}),
        },
    );
    wait_until(|| {
        live.index
            .partition("dev-c")
            .is_some_and(|p| p.sessions.iter().any(|s| s.session_id == "live-1"))
    })
    .await;
    assert!(owner
        .lock()
        .requests
        .iter()
        .any(|r| r.since_revision.is_some()));
    // The host's own partition is indexed too.
    wait_until(|| live.index.partition("dev-a").is_some()).await;
    live.sync.shutdown();
    let _ = &live.local;
}

#[tokio::test]
async fn offline_partition_kept_stale() {
    let fleet = fleet();
    with_peer(&fleet, "dev-b", "Build box", &[("ws-1", "s1")]).await;
    let confirmed = fleet.index.device_facts("dev-b").unwrap().as_of_ms;
    assert!(confirmed > 0);

    // The link fails while the device is still present: stale, kept.
    fleet
        .index
        .mark_link_failed("dev-b", "mesh_unreachable: timed out");
    let navigator = fleet.index.navigator(None);
    let b = device(&navigator, "dev-b");
    assert_eq!(b.state, FleetDeviceState::Stale);
    assert_eq!(b.state_reason.as_deref(), Some("mesh_unreachable"));
    assert_eq!(b.as_of_ms, confirmed);
    assert_eq!(session_ids(b), vec!["s1"]);

    // The device goes offline: its partition stays listed and owned.
    fleet.transport.set_online("dev-b", false);
    fleet.sync.refresh_presence().await;
    let navigator = fleet.index.navigator(None);
    let b = device(&navigator, "dev-b");
    assert_eq!(b.state, FleetDeviceState::Offline);
    assert_eq!(session_ids(b), vec!["s1"]);
    assert_eq!(b.as_of_ms, confirmed);
    assert!(!b.actions.create_workspace.allowed);
    assert_eq!(
        fleet_owner_index_owners(&fleet.index, "s1"),
        vec!["dev-b".to_string()]
    );
    let refused = call(
        &fleet.router,
        None,
        "cancel_dialog_turn",
        json!({"request": {"sessionId": "s1"}}),
    )
    .await
    .unwrap_err();
    assert!(
        refused.message.starts_with("fleet_device_offline: dev-b"),
        "{refused:?}"
    );

    // A device absent from presence is shown offline, never removed.
    fleet.transport.presence.lock().unwrap().clear();
    fleet.sync.refresh_presence().await;
    assert!(fleet.index.partition("dev-b").is_some());
}

fn fleet_owner_index_owners(index: &FleetIndex, session: &str) -> Vec<String> {
    use openbitfun_product_domains::fleet::FleetOwnerIndex;
    index.owners(FleetEntity::Session, session)
}

#[tokio::test]
async fn same_workspace_id_on_two_devices_stays_distinct() {
    let fleet = fleet();
    with_peer(&fleet, "dev-b", "B", &[("local_same", "sb")]).await;
    with_peer(&fleet, "dev-c", "C", &[("local_same", "sc")]).await;
    let navigator = fleet.index.navigator(None);
    let b = device(&navigator, "dev-b");
    let c = device(&navigator, "dev-c");
    assert_eq!(b.workspaces[0].workspace_id, "local_same");
    assert_eq!(c.workspaces[0].workspace_id, "local_same");
    assert_eq!(b.workspaces[0].device_id, "dev-b");
    assert_eq!(c.workspaces[0].device_id, "dev-c");
    assert_eq!(session_ids(b), vec!["sb"]);
    assert_eq!(session_ids(c), vec!["sc"]);

    // Without a target the owner is ambiguous; with one it is forwarded.
    let args = json!({"request": {"workspaceId": "local_same"}});
    let refused = call(&fleet.router, None, "create_session", args.clone())
        .await
        .unwrap_err();
    assert!(
        refused.message.starts_with("fleet_target_required:"),
        "{refused:?}"
    );
    let answer = call(&fleet.router, Some("dev-c"), "create_session", args.clone())
        .await
        .unwrap();
    assert_eq!(answer["handledBy"], "dev-c");
    assert_eq!(answer["args"], args, "args are forwarded verbatim");
    // A session id resolves to its single owner.
    let answer = call(
        &fleet.router,
        None,
        "cancel_dialog_turn",
        json!({"request": {"sessionId": "sb"}}),
    )
    .await
    .unwrap();
    assert_eq!(answer["handledBy"], "dev-b");
}

#[tokio::test]
async fn owner_mismatch_refused() {
    let fleet = fleet();
    with_peer(&fleet, "dev-b", "B", &[("ws-b", "s1")]).await;
    let owner_c = with_peer(&fleet, "dev-c", "C", &[("ws-c", "s2")]).await;
    let args = json!({"request": {"sessionId": "s1"}});
    let refused = call(
        &fleet.router,
        Some("dev-c"),
        "cancel_dialog_turn",
        args.clone(),
    )
    .await
    .unwrap_err();
    assert_eq!(refused.message, "fleet_owner_mismatch: dev-b");
    assert_eq!(refused.data, Some(json!({"kind": "fleet_owner_mismatch"})));
    assert!(
        !fleet
            .transport
            .calls
            .lock()
            .unwrap()
            .iter()
            .any(|(_, command, _)| command == "cancel_dialog_turn"),
        "a refused call never reaches any owner"
    );

    // A target whose partition is incomplete may hold the id: forwarded.
    let mut ws = workspace("ws-c", "C-ws-c");
    ws.session_total = 120;
    ws.has_more = true;
    owner_c.put_workspace(ws);
    let instance = owner_c.lock().instance.clone();
    fleet
        .sync
        .pull_digest("dev-c", &link(&instance), false)
        .await
        .unwrap();
    let answer = call(&fleet.router, Some("dev-c"), "cancel_dialog_turn", args)
        .await
        .unwrap();
    assert_eq!(answer["handledBy"], "dev-c");

    // The owner's own errors pass through unchanged.
    let error = call(
        &fleet.router,
        Some("dev-b"),
        "fail_on_owner",
        json!({"request": {}}),
    )
    .await
    .unwrap_err();
    assert_eq!(error.message, "Session not found: s-x");
    assert_eq!(error.data, Some(json!({"kind": "command"})));

    // The target is this host: run here.
    fleet.sync.refresh_local().await.unwrap();
    let answer = call(&fleet.router, Some("dev-a"), "get_config", json!({}))
        .await
        .unwrap();
    assert_eq!(answer["handledBy"], "dev-a");
    // A device-scoped command needs a target.
    let refused = call(&fleet.router, None, "get_config", json!({}))
        .await
        .unwrap_err();
    assert!(refused.message.starts_with("fleet_target_required:"));
}

#[tokio::test]
async fn nested_call_refused() {
    let fleet = fleet();
    for command in [
        "fleet_navigator",
        "fleet_call",
        "fleet_digest",
        "fleet_whatever",
    ] {
        let refused = call(&fleet.router, Some("dev-a"), command, json!({}))
            .await
            .unwrap_err();
        assert!(
            refused.message.starts_with("fleet_nested_call:"),
            "{command}: {refused:?}"
        );
    }
    // Through the verb dispatcher too.
    let refused = fleet
        .router
        .handle(
            "fleet_call",
            json!({"request": {"target": "dev-a", "command": "fleet_prompts", "args": {}}}),
        )
        .await
        .unwrap()
        .unwrap_err();
    assert!(refused.message.starts_with("fleet_nested_call:"));
    assert!(fleet
        .router
        .handle("fleet_events", json!({}))
        .await
        .is_none());
}

#[tokio::test]
async fn bounds_truncate() {
    let fleet = fleet();
    fleet
        .transport
        .add(presence("dev-b", "Huge", FleetHostKind::Cli), None);
    fleet.sync.refresh_presence().await;
    let mut digest = FleetDigest {
        instance_id: "big-1".into(),
        revision: 7,
        full: true,
        ..Default::default()
    };
    for w in 0..300 {
        digest
            .workspaces
            .push(workspace(&format!("w{w:03}"), &format!("w{w}")));
    }
    let title = "t".repeat(2_500);
    for s in 0..700u64 {
        let mut item = session(&format!("w{:03}", s % 100), &format!("s{s:03}"), 10_000 + s);
        item.title = title.clone();
        digest.sessions.push(item);
    }
    // The oldest session is running: pinned, kept over newer idle ones.
    let mut running = session("w000", "s-running", 1);
    running.status = FleetSessionStatus::Running;
    digest.sessions.push(running);
    for p in 0..300u64 {
        digest.prompts.push(FleetPrompt {
            session_id: "s001".into(),
            workspace_id: "w001".into(),
            kind: FleetPromptKind::Permission,
            prompt_id: format!("p{p:03}"),
            revision: p,
            answerable: true,
            payload: Some(
                json!({"x": if p == 0 { "y".repeat(20 * 1024) } else { "ok".to_string() }}),
            ),
            ..Default::default()
        });
    }
    fleet.index.apply_digest("dev-b", None, digest);
    let held = fleet.index.partition("dev-b").unwrap();
    assert_eq!(held.workspaces.len(), MAX_WORKSPACES_PER_DEVICE);
    assert!(held.sessions.len() <= MAX_SESSIONS_PER_DEVICE);
    assert_eq!(held.prompts.len(), MAX_PROMPTS_PER_DEVICE);
    assert!(serde_json::to_vec(&held).unwrap().len() <= MAX_PARTITION_BYTES);
    assert!(held.sessions_truncated);
    assert!(held.sessions.iter().any(|s| s.session_id == "s-running"));
    let big = held.prompts.iter().find(|p| p.prompt_id == "p000").unwrap();
    assert!(big.payload.is_none() && big.payload_truncated);

    let navigator = fleet.index.navigator(None);
    let b = device(&navigator, "dev-b");
    assert!(b.sessions_truncated);
    assert!(b.workspaces.len() <= MAX_WORKSPACES_PER_DEVICE);

    // Beyond 32 indexed devices the rest are listed `not_indexed`.
    for d in 0..40 {
        let id = format!("dev-x{d:02}");
        fleet
            .transport
            .add(presence(&id, &format!("x{d:02}"), FleetHostKind::Cli), None);
    }
    fleet.sync.refresh_presence().await;
    for d in 0..40 {
        let id = format!("dev-x{d:02}");
        fleet.index.apply_digest(
            &id,
            None,
            FleetDigest {
                instance_id: "i".into(),
                revision: 1,
                full: true,
                workspaces: vec![workspace("w", "w")],
                ..Default::default()
            },
        );
    }
    let navigator = fleet.index.navigator(None);
    let not_indexed = navigator
        .devices
        .iter()
        .filter(|d| d.state == FleetDeviceState::NotIndexed)
        .count();
    assert!(not_indexed >= 40 + 1 - MAX_INDEXED_DEVICES, "{not_indexed}");
    fleet.sync.shutdown();
}

#[tokio::test]
async fn old_mesh_peer_indexed_by_polling_and_forwarded() {
    let fleet = fleet();
    let navigator = json!({
        "opened": [
            {"id": "local_old", "name": "legacy-repo", "rootPath": "C:\\src\\legacy", "workspaceKind": "normal", "sshHost": "localhost"},
            {"id": "remote_x", "name": "server", "rootPath": "/srv/app", "workspaceKind": "remote", "sshHost": "build.example"}
        ],
        "recent": [{"id": "asst_1", "name": "Helper", "rootPath": "/a", "workspaceKind": "assistant"}],
        "selectedId": "local_old",
        "selection": "host_current"
    });
    let mut pages = HashMap::new();
    pages.insert(
        "local_old".to_string(),
        json!({
            "sessions": [
                {"sessionId": "old-1", "sessionName": "Fix build", "agentType": "agentic", "lastActiveAt": 500},
                {"sessionId": "old-2", "sessionName": "Ask", "agentType": "agentic", "lastActiveAt": 900,
                 "relationship": {"parentSessionId": "old-1"}},
                {"sessionId": "old-3", "sessionName": "Done", "agentType": "agentic", "lastActiveAt": 100}
            ],
            "activities": [
                {"sessionId": "old-1", "execution": "running", "pendingApprovals": 0, "pendingQuestions": 0},
                {"sessionId": "old-2", "execution": "idle", "pendingApprovals": 1, "pendingQuestions": 0},
                {"sessionId": "old-3", "execution": "idle", "pendingApprovals": 0, "pendingQuestions": 0, "unread": true}
            ],
            "totalTopLevelCount": 80, "loadedTopLevelCount": 2, "hasMore": true
        }),
    );
    let permissions = json!([
        {"requestId": "perm-1", "roundId": "r", "order": 0, "projectId": "p", "sessionId": "old-2",
         "agentId": "a", "action": "bash", "resources": ["rm -rf build"], "source": {"kind": "tool_call", "identity": "Bash"}}
    ]);
    fleet.transport.add(
        presence("dev-old", "Old CLI", FleetHostKind::Cli),
        Some(FakePeer::Legacy {
            navigator,
            pages,
            permissions,
        }),
    );
    fleet.sync.refresh_presence().await;
    let link = fleet.transport.link_of("dev-old").unwrap();
    fleet.index.set_link("dev-old", link.clone());
    fleet.sync.poll_legacy("dev-old", &link).await.unwrap();

    let navigator = fleet.index.navigator(None);
    let old = device(&navigator, "dev-old");
    assert_eq!(old.state, FleetDeviceState::Online);
    assert_eq!(old.fleet_protocol, None, "a leaf owner without fleet_v1");
    assert_eq!(old.workspaces.len(), 3);
    let repo = old
        .workspaces
        .iter()
        .find(|w| w.workspace_id == "local_old")
        .unwrap();
    assert!(repo.is_host_current);
    assert_eq!(repo.root_path, "C:/src/legacy", "paths are POSIX");
    assert_eq!(repo.ssh_host, None);
    assert!(repo.has_more);
    assert_eq!(repo.session_total, 80);
    let status = |id: &str| {
        repo.sessions
            .iter()
            .find(|s| s.session_id == id)
            .unwrap()
            .clone()
    };
    assert_eq!(status("old-1").status, FleetSessionStatus::Running);
    assert_eq!(status("old-2").status, FleetSessionStatus::Waiting);
    assert!(status("old-2").needs_attention);
    assert_eq!(status("old-2").parent_session_id.as_deref(), Some("old-1"));
    assert!(status("old-3").unread);
    let remote = old
        .workspaces
        .iter()
        .find(|w| w.workspace_id == "remote_x")
        .unwrap();
    assert_eq!(remote.kind, FleetWorkspaceKind::RemoteSsh);
    assert_eq!(remote.ssh_host.as_deref(), Some("build.example"));
    let prompts = fleet.index.prompts();
    let prompt = prompts
        .prompts
        .iter()
        .find(|p| p.prompt_id == "perm-1")
        .unwrap();
    assert_eq!(prompt.device_id, "dev-old");
    assert_eq!(prompt.workspace_id, "local_old");
    assert_eq!(prompt.tool_name.as_deref(), Some("Bash"));
    assert!(prompt.answerable);

    // Commands go to it as plain calls, args unchanged.
    let args = json!({"request": {"sessionId": "old-1", "turnId": "t"}});
    let answer = call(&fleet.router, None, "cancel_dialog_turn", args.clone())
        .await
        .unwrap();
    assert_eq!(answer["handledBy"], "dev-old");
    let calls = fleet.transport.calls.lock().unwrap().clone();
    let (device_id, command, sent) = calls.last().unwrap();
    assert_eq!(
        (device_id.as_str(), command.as_str()),
        ("dev-old", "cancel_dialog_turn")
    );
    assert_eq!(sent, &args);
    // The window holds only the first page; ids beyond it may exist there.
    let answer = call(
        &fleet.router,
        Some("dev-old"),
        "cancel_dialog_turn",
        json!({"request": {"sessionId": "older-not-listed"}}),
    )
    .await
    .unwrap();
    assert_eq!(answer["handledBy"], "dev-old");

    // A second poll with no change leaves the projection's revision alone.
    let revision = fleet.index.revision();
    fleet.sync.poll_legacy("dev-old", &link).await.unwrap();
    assert!(fleet.index.navigator(Some(revision)).devices.is_empty());
}

#[tokio::test]
async fn relay_only_is_update_required() {
    let fleet = fleet();
    let mut relay = presence("dev-tauri", "Old desktop", FleetHostKind::Desktop);
    relay.mesh = false;
    relay.version = Some("0.5.2".into());
    fleet.transport.add(relay, None);
    fleet.sync.refresh_presence().await;
    tokio::time::sleep(Duration::from_millis(20)).await;
    assert!(
        !fleet
            .transport
            .subscribes
            .lock()
            .unwrap()
            .contains(&"dev-tauri".to_string()),
        "a relay-only host is never dialed"
    );
    let navigator = fleet.index.navigator(None);
    let tauri = device(&navigator, "dev-tauri");
    assert_eq!(tauri.state, FleetDeviceState::UpdateRequired);
    assert_eq!(tauri.state_reason.as_deref(), Some("relay_only_host"));
    assert_eq!(tauri.version.as_deref(), Some("0.5.2"));
    assert!(!tauri.actions.create_workspace.allowed);
    let refused = call(&fleet.router, Some("dev-tauri"), "get_config", json!({}))
        .await
        .unwrap_err();
    assert!(
        refused
            .message
            .starts_with("fleet_device_outdated: dev-tauri"),
        "{refused:?}"
    );
    fleet.sync.shutdown();
}

#[tokio::test]
async fn legacy_index_cache_round_trip() {
    let dir = tempfile::tempdir().unwrap();
    let path = index_cache_path(dir.path());
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    // An older writer: no version, nulls, unknown enum values and fields,
    // one unreadable record, nested sessions.
    let legacy = json!({
        "selfDeviceId": "dev-a",
        "futureField": {"x": 1},
        "devices": [
            "not a record",
            {
                "deviceId": "dev-b",
                "name": null,
                "hostKind": "toaster",
                "hostCapabilities": null,
                "asOfMs": 1234,
                "unknown": true,
                "partition": {
                    "instanceId": "b-1",
                    "revision": 9,
                    "workspaces": [{
                        "workspaceId": "ws-1", "name": "repo", "rootPath": "/r", "kind": "remote_container",
                        "sessions": [{"sessionId": "s1", "workspaceId": "ws-1", "status": "paused", "title": null}]
                    }],
                    "sessions": null,
                    "prompts": [{"promptId": "p1", "kind": "permission", "answerRoute": "carrier_pigeon", "answerable": true}]
                }
            },
            {"deviceId": "dev-a", "partition": {"instanceId": "self", "revision": 1}}
        ]
    });
    std::fs::write(&path, serde_json::to_vec(&legacy).unwrap()).unwrap();

    let first = fleet_with(Some(path.clone()), FleetSyncConfig::default());
    let navigator = first.index.navigator(None);
    let b = device(&navigator, "dev-b");
    assert_eq!(
        b.state,
        FleetDeviceState::Stale,
        "cached until presence says otherwise"
    );
    assert_eq!(b.state_reason.as_deref(), Some("cached"));
    assert_eq!(b.host_kind, FleetHostKind::Unknown);
    assert_eq!(b.as_of_ms, 1234);
    assert_eq!(session_ids(b), vec!["s1"]);
    assert_eq!(b.workspaces[0].kind, FleetWorkspaceKind::Unknown);
    assert_eq!(
        b.workspaces[0].sessions[0].status,
        FleetSessionStatus::Unknown
    );
    let prompts = first.index.prompts();
    let p1 = prompts
        .prompts
        .iter()
        .find(|p| p.prompt_id == "p1")
        .unwrap();
    assert!(
        !p1.answerable,
        "an unknown answer route is not answerable here"
    );
    assert_eq!(
        first.index.partition_cursor("dev-b"),
        Some(("b-1".to_string(), 9))
    );
    assert!(
        first.index.partition("dev-a").is_none(),
        "self is never read from the cache"
    );

    // Round trip through this build's writer.
    first
        .index
        .set_presence(&[presence("dev-b", "Build box", FleetHostKind::Cli)]);
    first.index.flush().unwrap();
    let second = fleet_with(Some(path.clone()), FleetSyncConfig::default());
    let again = second.index.navigator(None);
    let b2 = device(&again, "dev-b");
    assert_eq!(b2.name, "Build box");
    assert_eq!(b2.host_kind, FleetHostKind::Cli);
    assert_eq!(session_ids(b2), vec!["s1"]);
    assert_eq!(
        second.index.partition("dev-b"),
        first.index.partition("dev-b")
    );
    let written: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    assert_eq!(written["version"], 1);

    // An unparsable cache is kept aside, never deleted.
    std::fs::write(&path, b"{ not json").unwrap();
    let third = fleet_with(Some(path.clone()), FleetSyncConfig::default());
    assert!(third.index.partition("dev-b").is_none());
    third
        .index
        .set_presence(&[presence("dev-c", "C", FleetHostKind::Cli)]);
    third.index.apply_digest(
        "dev-c",
        None,
        FleetDigest {
            instance_id: "c".into(),
            revision: 1,
            full: true,
            ..Default::default()
        },
    );
    third.index.flush().unwrap();
    let kept: Vec<String> = std::fs::read_dir(path.parent().unwrap())
        .unwrap()
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().to_string())
        .filter(|name| name.contains("unreadable"))
        .collect();
    assert_eq!(kept.len(), 1, "{kept:?}");
    let aside = path.parent().unwrap().join(&kept[0]);
    assert_eq!(std::fs::read(aside).unwrap(), b"{ not json");
}

#[tokio::test]
async fn router_serves_navigator_prompts_and_digest() {
    let fleet = fleet();
    with_peer(&fleet, "dev-b", "B", &[("ws-1", "s1")]).await;
    fleet.sync.refresh_local().await.unwrap();
    fleet.transport.calls.lock().unwrap().clear();
    let navigator = fleet
        .router
        .handle("fleet_navigator", json!({"request": {}}))
        .await
        .unwrap()
        .unwrap();
    let navigator: FleetNavigator = serde_json::from_value(navigator).unwrap();
    assert!(navigator.full);
    assert_eq!(
        navigator.devices[0].device_id, "dev-a",
        "the client's own machine first"
    );
    assert!(navigator.devices[0].is_client_device);
    let digest = fleet
        .router
        .handle("fleet_digest", json!({"request": {"sinceRevision": null}}))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(digest["deviceId"], "dev-a");
    assert_eq!(digest["full"], true);
    let prompts = fleet
        .router
        .handle("fleet_prompts", json!({}))
        .await
        .unwrap()
        .unwrap();
    assert!(prompts["prompts"].as_array().unwrap().is_empty());
    let _ = &fleet.local;
}

#[tokio::test]
async fn router_refuses_fleet_call_for_cloud_agent_and_paired_client() {
    let fleet = fleet();
    with_peer(&fleet, "dev-b", "B", &[("ws-1", "s1")]).await;
    fleet.sync.refresh_local().await.unwrap();
    fleet.transport.calls.lock().unwrap().clear();

    for scope in [
        crate::server::Scope::CloudAgent {
            device_id: "cloud-1".into(),
        },
        crate::server::Scope::PairedClient {
            client_id: "paired-1".into(),
        },
    ] {
        for target in ["dev-a", "dev-b"] {
            let err = fleet
                .router
                .fleet_call_for_scope(
                    &scope,
                    FleetCallRequest {
                        target: Some(target.into()),
                        command: "open_workspace".into(),
                        args: json!({ "request": { "path": "/w" } }),
                    },
                )
                .await
                .unwrap_err();
            assert_eq!(err.code, -32003, "{target}: {err}");
            assert!(err.message.starts_with("forbidden_for_scope:"), "{err}");
        }
    }
    assert!(
        fleet.transport.calls.lock().unwrap().is_empty(),
        "cloud agent fleet_call must never forward to a peer"
    );
}

//! The fleet host glue end to end, over real mesh listeners, the device
//! handshake and the controller client on loopback TCP: two runtime hosts
//! (`A`, `B`), each with a [`FleetHost`], and a client (`C`) that connects to
//! one of them as another account device.

use std::collections::HashMap;
use std::net::Ipv4Addr;
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use serde_json::{json, Value};

use super::*;
use crate::client::links::{ConnectFuture, PeerConnector, PeerLinks};
use crate::client::{
    LoopbackConnector, MeshConnectOptions, MeshDialer, MeshObpConnection, MeshObpEvent, MeshTarget,
};
use crate::events::{EventHub, EVENTS_DROPPED_EVENT};
use crate::server::{
    MeshAcceptFuture, MeshIncoming, ObpBackend, ObpDispatchFuture, ObpServer, ObpServerOptions,
    PairKeyFuture,
};

/// Every device of these tests derives the same pair key (the directory
/// would derive it from their X25519 keys; the handshake is the same).
struct SharedKey(String);

impl MeshAuthority for SharedKey {
    fn local_device_id(&self) -> Option<String> {
        Some(self.0.clone())
    }

    fn pair_key<'a>(&'a self, _device_id: &'a str) -> PairKeyFuture<'a> {
        Box::pin(async { Ok([9u8; 32]) })
    }
}

/// A runtime host: `page_list` (a registry `Proxied` command) publishes
/// `count` text chunks tagged with `tag`; fleet verbs go to its fleet.
struct HostBackend {
    hub: Arc<EventHub>,
    fleet: OnceLock<Arc<FleetHost>>,
    instance: OnceLock<String>,
}

impl ObpBackend for HostBackend {
    fn dispatch(&self, command: String, args: Value) -> ObpDispatchFuture {
        let hub = Arc::clone(&self.hub);
        let fleet = self.fleet.get().cloned();
        let instance = self.instance.get().cloned().unwrap_or_default();
        Box::pin(async move {
            if is_fleet_host_command(&command) {
                let Some(fleet) = fleet else {
                    return Err(fleet_unavailable(&command));
                };
                return fleet
                    .dispatch(&command, args, &instance)
                    .await
                    .unwrap_or_else(|| Err("not a fleet verb".into()));
            }
            match command.as_str() {
                "page_list" => {
                    let count = args["request"]["count"].as_u64().unwrap_or(1);
                    let tag = args["request"]["tag"].as_str().unwrap_or_default();
                    for index in 0..count {
                        hub.publish(
                            "agentic://text-chunk",
                            json!({ "tag": tag, "index": index }),
                        );
                    }
                    Ok(json!({ "published": count }))
                }
                other => Err(format!("{}: {other}", crate::UNSUPPORTED_IN_NATIVE_HOST)),
            }
        })
    }

    fn events(&self) -> Arc<EventHub> {
        Arc::clone(&self.hub)
    }

    fn info(&self) -> Value {
        json!({ "version": "9.9.9-fleet-host", "platform": "test" })
    }

    fn is_account_device_host_verb(&self, command: &str) -> bool {
        is_fleet_owner_verb(command)
    }

    fn mesh_capabilities(&self) -> Vec<&'static str> {
        if self.fleet.get().is_some() {
            vec![FLEET_V1_CAPABILITY]
        } else {
            Vec::new()
        }
    }

    fn fleet_mux(&self) -> Option<Arc<FleetMux>> {
        self.fleet.get().map(|fleet| fleet.mux())
    }
}

/// One workspace with one running session.
struct FakeOwner {
    device_id: String,
    instance: String,
    backend: Arc<HostBackend>,
}

impl FleetBackend for FakeOwner {
    fn local_device_id(&self) -> Option<String> {
        Some(self.device_id.clone())
    }

    fn local_facts(&self) -> FleetDeviceFacts {
        FleetDeviceFacts {
            device_id: self.device_id.clone(),
            name: format!("{} name", self.device_id),
            host_kind: FleetHostKind::Desktop,
            is_client_device: true,
            state: FleetDeviceState::Online,
            fleet_protocol: Some(FLEET_PROTOCOL_VERSION),
            ..FleetDeviceFacts::default()
        }
    }

    fn local_digest(
        &self,
        _request: FleetDigestRequest,
    ) -> FleetFuture<'_, Result<FleetDigest, String>> {
        Box::pin(async move {
            Ok(FleetDigest {
                device_id: self.device_id.clone(),
                instance_id: self.instance.clone(),
                revision: 1,
                full: true,
                // The same workspace id on every device: still two rows.
                workspaces: vec![FleetWorkspace {
                    device_id: self.device_id.clone(),
                    workspace_id: "local_same".into(),
                    name: "repo".into(),
                    root_path: "/src/repo".into(),
                    kind: FleetWorkspaceKind::Local,
                    ..FleetWorkspace::default()
                }],
                sessions: vec![FleetSession {
                    device_id: self.device_id.clone(),
                    workspace_id: "local_same".into(),
                    session_id: format!("s-{}", self.device_id),
                    title: "turn".into(),
                    agent_type: "agentic".into(),
                    status: FleetSessionStatus::Running,
                    last_activity_ms: 5,
                    ..FleetSession::default()
                }],
                ..FleetDigest::default()
            })
        })
    }

    fn dispatch_local(
        &self,
        command: String,
        args: Value,
    ) -> FleetFuture<'_, Result<Value, FleetCallError>> {
        Box::pin(dispatch_as_account_device(
            self.backend.as_ref(),
            &self.device_id,
            command,
            args,
        ))
    }
}

/// The other host, always online on the device network.
struct FixedPresence(Vec<FleetPeerPresence>);

impl FleetPresenceSource for FixedPresence {
    fn presence(&self) -> FleetFuture<'_, Vec<FleetPeerPresence>> {
        let presence = self.0.clone();
        Box::pin(async move { presence })
    }
}

/// Loopback TCP on an ephemeral port as the device network.
struct EphemeralIncoming {
    listener: tokio::net::TcpListener,
    port: u16,
}

impl MeshIncoming for EphemeralIncoming {
    fn accept(&self) -> MeshAcceptFuture<'_> {
        Box::pin(async move {
            loop {
                if let Ok((stream, peer)) = self.listener.accept().await {
                    let _ = stream.set_nodelay(true);
                    return Some((Box::new(stream) as Box<dyn MeshIo>, peer));
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
    }

    fn port(&self) -> Option<u16> {
        Some(self.port)
    }
}

/// Reaches devices at known ports.
struct PortConnector {
    dialer: MeshDialer,
    ports: Arc<std::sync::Mutex<HashMap<String, u16>>>,
}

impl PeerConnector for PortConnector {
    fn connect(&self, device_id: String, options: MeshConnectOptions) -> ConnectFuture {
        let dialer = self.dialer.clone();
        let port = self.ports.lock().unwrap().get(&device_id).copied();
        Box::pin(async move {
            let Some(port) = port else {
                return Err(format!("mesh_unreachable: device {device_id} is not known"));
            };
            let target = MeshTarget {
                device_id,
                virtual_ip: Ipv4Addr::new(10, 126, 126, 8),
                port: Some(port),
            };
            dialer.connect(&target, options).await
        })
    }

    fn route(&self, _device_id: &str) -> Option<(String, Option<f64>)> {
        Some(("p2p".to_string(), Some(0.5)))
    }
}

struct Host {
    id: String,
    server: Arc<ObpServer>,
    hub: Arc<EventHub>,
    fleet: Arc<FleetHost>,
    port: u16,
    _dir: tempfile::TempDir,
}

type Ports = Arc<std::sync::Mutex<HashMap<String, u16>>>;

async fn host(id: &str, peer: &str, ports: &Ports) -> Host {
    let presence = vec![FleetPeerPresence {
        device_id: peer.to_string(),
        name: format!("{peer} name"),
        host_kind: FleetHostKind::Desktop,
        online: true,
        mesh: true,
        route: None,
        version: Some("9.9.9".into()),
        as_of_ms: 1,
        unsupported: None,
    }];
    host_with(id, presence, None, ports).await
}

/// A host with the given presence whose links also dial the account's cloud
/// node through `cloud` (`None`: a host without a cloud dialer).
async fn host_with(
    id: &str,
    presence: Vec<FleetPeerPresence>,
    cloud: Option<Arc<crate::client::cloud::CloudNodeConnector>>,
    ports: &Ports,
) -> Host {
    let dir = tempfile::tempdir().unwrap();
    let hub = EventHub::new(1024);
    let backend = Arc::new(HostBackend {
        hub: Arc::clone(&hub),
        fleet: OnceLock::new(),
        instance: OnceLock::new(),
    });
    let mut options = ObpServerOptions::new(dir.path().join("obp"));
    options.loopback_port = 0;
    let server = ObpServer::new(Arc::clone(&backend) as Arc<dyn ObpBackend>, options).unwrap();
    let instance = server.instance_id().to_string();
    backend.instance.set(instance.clone()).unwrap();
    let authority: Arc<dyn MeshAuthority> = Arc::new(SharedKey(id.to_string()));
    let devices: Arc<dyn PeerConnector> = Arc::new(PortConnector {
        dialer: MeshDialer {
            connector: Arc::new(LoopbackConnector),
            authority: Arc::clone(&authority),
        },
        ports: Arc::clone(ports),
    });
    let links = PeerLinks::new(crate::client::cloud::WithCloudNode::new(devices, cloud));
    let presence = Arc::new(FixedPresence(presence));
    let fleet = FleetHost::start(
        id.to_string(),
        FleetHostParts {
            backend: Arc::new(FakeOwner {
                device_id: id.to_string(),
                instance,
                backend: Arc::clone(&backend),
            }),
            links,
            presence,
            authority: Arc::clone(&authority),
            hub: Arc::clone(&hub),
            cache_path: Some(super::super::index::index_cache_path(dir.path())),
            config: FleetSyncConfig {
                presence_poll: Duration::from_millis(200),
                retry_min: Duration::from_millis(100),
                retry_max: Duration::from_millis(500),
                ..FleetSyncConfig::default()
            },
            on_local_event: None,
        },
    );
    assert!(backend.fleet.set(Arc::clone(&fleet)).is_ok());
    let listener = tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .await
        .unwrap();
    let port = listener.local_addr().unwrap().port();
    let addr = std::net::SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    server
        .start_mesh_with(
            authority,
            Arc::new(EphemeralIncoming { listener, port }),
            addr,
        )
        .await
        .unwrap();
    ports.lock().unwrap().insert(id.to_string(), port);
    Host {
        id: id.to_string(),
        server,
        hub,
        fleet,
        port,
        _dir: dir,
    }
}

async fn connect(client: &str, to: &Host, fleet: Option<Value>) -> MeshObpConnection {
    MeshDialer {
        connector: Arc::new(LoopbackConnector),
        authority: Arc::new(SharedKey(client.to_string())),
    }
    .connect(
        &MeshTarget {
            device_id: to.id.clone(),
            virtual_ip: Ipv4Addr::new(10, 126, 126, 8),
            port: Some(to.port),
        },
        MeshConnectOptions {
            fleet,
            ..MeshConnectOptions::default()
        },
    )
    .await
    .unwrap()
}

/// Polls `fleet_navigator` until `done` holds (10 s at most).
async fn navigator_until(
    connection: &MeshObpConnection,
    done: impl Fn(&FleetNavigator) -> bool,
) -> FleetNavigator {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
    loop {
        let value = connection
            .call("fleet_navigator", json!({ "request": {} }))
            .await
            .unwrap();
        let navigator: FleetNavigator = serde_json::from_value(value).unwrap();
        if done(&navigator) || tokio::time::Instant::now() >= deadline {
            return navigator;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

async fn read_until(
    connection: &MeshObpConnection,
    done: impl Fn(&[MeshObpEvent]) -> bool,
) -> Vec<MeshObpEvent> {
    let mut seen = Vec::new();
    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
    while !done(&seen) {
        let left = deadline.saturating_duration_since(tokio::time::Instant::now());
        match tokio::time::timeout(left, connection.next_event()).await {
            Ok(Some(event)) => seen.push(event),
            _ => break,
        }
    }
    seen
}

fn chunks<'a>(events: &'a [MeshObpEvent], origin: &str, tag: &str) -> Vec<&'a MeshObpEvent> {
    events
        .iter()
        .filter(|event| event.origin.as_deref() == Some(origin))
        .filter(|event| event.event == "agentic://text-chunk" && event.payload["tag"] == tag)
        .collect()
}

async fn follow(connection: &MeshObpConnection, device_id: &str) {
    let answer = connection
        .call(
            "fleet_subscribe",
            json!({ "request": { "follow": { device_id: { "all": true } } } }),
        )
        .await
        .unwrap();
    assert_eq!(answer["applied"], true);
}

/// A client on `A` sees both hosts in one navigator (the same workspace id on
/// two devices stays two rows), a `fleet_call` aimed at `B` runs on `B` and
/// its events reach the client tagged with origin `B`, and owner errors and
/// fleet refusals come back as they are.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn fleet_navigator_and_forwarded_call_over_two_hosts() {
    let ports: Ports = Arc::default();
    let a = host("fh-a", "fh-b", &ports).await;
    let b = host("fh-b", "fh-a", &ports).await;
    let client = connect(
        "fh-client",
        &a,
        Some(json!({ "protocol": 1, "cursor": {} })),
    )
    .await;
    assert!(client.hello()["capabilities"]
        .as_array()
        .unwrap()
        .contains(&json!(FLEET_V1_CAPABILITY)));
    assert_eq!(client.hello()["fleet"]["deviceId"], "fh-a");

    let navigator = navigator_until(&client, |navigator| {
        navigator
            .devices
            .iter()
            .all(|device| !device.workspaces.is_empty())
            && navigator.devices.len() == 2
    })
    .await;
    let ids: Vec<&str> = navigator
        .devices
        .iter()
        .map(|d| d.device_id.as_str())
        .collect();
    assert_eq!(navigator.devices.len(), 2, "{ids:?}");
    for device in &navigator.devices {
        assert_eq!(device.workspaces.len(), 1, "{}", device.device_id);
        assert_eq!(device.workspaces[0].workspace_id, "local_same");
        assert_eq!(device.workspaces[0].device_id, device.device_id);
        assert_eq!(device.workspaces[0].sessions.len(), 1);
    }
    assert_eq!(navigator.totals.running, 2);

    follow(&client, "fh-b").await;
    // Give the entry's link to B time to widen to the whole stream.
    tokio::time::sleep(Duration::from_millis(300)).await;
    let answer = client
        .call(
            "fleet_call",
            json!({ "request": { "target": "fh-b", "command": "page_list",
                    "args": { "request": { "count": 2, "tag": "turn" } } } }),
        )
        .await
        .unwrap();
    assert_eq!(answer, json!({ "published": 2 }));
    let events = read_until(&client, |seen| chunks(seen, "fh-b", "turn").len() >= 2).await;
    let from_b = chunks(&events, "fh-b", "turn");
    assert_eq!(from_b.len(), 2, "{events:?}");
    assert_eq!(
        from_b[0].origin_instance.as_deref(),
        Some(b.server.instance_id())
    );

    // Run here when this host is the target; the allowlist is the same.
    let local = client
        .call(
            "fleet_call",
            json!({ "request": { "target": "fh-a", "command": "page_list",
                    "args": { "request": { "count": 1, "tag": "here" } } } }),
        )
        .await
        .unwrap();
    assert_eq!(local["published"], 1);
    let refused = client
        .call(
            "fleet_call",
            json!({ "request": { "target": "fh-b", "command": "account_delete_device", "args": {} } }),
        )
        .await
        .unwrap_err();
    assert!(
        refused.message.starts_with("forbidden_for_scope:"),
        "{refused}"
    );
    let nested = client
        .call(
            "fleet_call",
            json!({ "request": { "target": "fh-b", "command": "fleet_navigator", "args": {} } }),
        )
        .await
        .unwrap_err();
    assert!(nested.message.starts_with(FLEET_NESTED_CALL), "{nested}");
    let owner = client
        .call(
            "fleet_call",
            json!({ "request": { "command": "get_session_permission_mode",
                    "args": { "request": { "sessionId": "s-fh-b" } } } }),
        )
        .await
        .unwrap_err();
    // Resolved to B from the index, where the backend answers its own error.
    assert!(
        owner.message.contains("get_session_permission_mode"),
        "{owner}"
    );

    client.close().await;
    a.fleet.shutdown();
    b.fleet.shutdown();
    a.server.shutdown();
    b.server.shutdown();
}

/// The client loses its entry `A` and re-enters through `B` with its vector
/// cursor: every event `B` published, before and during the switch, arrives
/// exactly once; `A`'s origin, now unreachable, is resumed from what `B`
/// holds of it or reported dropped.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn failover_a_to_b_vector_cursor_no_loss_no_dup() {
    let ports: Ports = Arc::default();
    let a = host("fo-a", "fo-b", &ports).await;
    let b = host("fo-b", "fo-a", &ports).await;
    let first = connect(
        "fo-client",
        &a,
        Some(json!({ "protocol": 1, "cursor": {} })),
    )
    .await;
    follow(&first, "fo-b").await;
    tokio::time::sleep(Duration::from_millis(300)).await;

    let mut cursor = FleetCursor::default();
    b.hub
        .publish("agentic://text-chunk", json!({ "tag": "b", "index": 0 }));
    b.hub
        .publish("agentic://text-chunk", json!({ "tag": "b", "index": 1 }));
    a.hub
        .publish("agentic://text-chunk", json!({ "tag": "a", "index": 0 }));
    let seen = read_until(&first, |seen| {
        chunks(seen, "fo-b", "b").len() >= 2 && chunks(seen, "fo-a", "a").len() >= 1
    })
    .await;
    let mut delivered: Vec<(String, u64)> = Vec::new();
    for event in &seen {
        if let (Some(origin), Some(instance)) = (&event.origin, &event.origin_instance) {
            assert!(
                !cursor.has_seen(origin, instance, event.seq),
                "duplicate {event:?}"
            );
            cursor.advance(origin, instance, event.seq);
            if event.event == "agentic://text-chunk" {
                delivered.push((origin.clone(), event.payload["index"].as_u64().unwrap()));
            }
        }
    }
    assert_eq!(chunks(&seen, "fo-b", "b").len(), 2, "{seen:?}");

    // The entry goes away; B keeps working meanwhile.
    a.fleet.shutdown();
    a.server.shutdown();
    first.close().await;
    b.hub
        .publish("agentic://text-chunk", json!({ "tag": "b", "index": 2 }));
    b.hub
        .publish("agentic://text-chunk", json!({ "tag": "b", "index": 3 }));

    let cursor_json = serde_json::to_value(&cursor).unwrap();
    let second = connect(
        "fo-client",
        &b,
        Some(json!({ "protocol": 1, "cursor": cursor_json })),
    )
    .await;
    let states = second.hello()["fleet"]["cursorState"].clone();
    assert_eq!(states["fo-b"], "resumed", "{states}");
    // A's origin: whatever B's link to A still holds (A is gone, so
    // nothing newer exists), or dropped; never an error.
    assert!(
        matches!(states["fo-a"].as_str(), Some("resumed" | "dropped")),
        "{states}"
    );
    b.hub
        .publish("agentic://text-chunk", json!({ "tag": "b", "index": 4 }));
    let resumed = read_until(&second, |seen| chunks(seen, "fo-b", "b").len() >= 3).await;
    for event in &resumed {
        if event.event == EVENTS_DROPPED_EVENT {
            // Only A's origin may be dropped.
            assert_eq!(event.payload["origin"], "fo-a", "{event:?}");
            continue;
        }
        let (Some(origin), Some(instance)) = (&event.origin, &event.origin_instance) else {
            continue;
        };
        assert!(
            !cursor.has_seen(origin, instance, event.seq),
            "duplicate {event:?}"
        );
        cursor.advance(origin, instance, event.seq);
        if event.event == "agentic://text-chunk" {
            delivered.push((origin.clone(), event.payload["index"].as_u64().unwrap()));
        }
    }
    let from_b: Vec<u64> = delivered
        .iter()
        .filter(|(origin, _)| origin == "fo-b")
        .map(|(_, index)| *index)
        .collect();
    assert_eq!(from_b, [0, 1, 2, 3, 4], "no loss, no duplicate");
    second.close().await;
    b.fleet.shutdown();
    b.server.shutdown();
}

/// The account's cloud node (an in-process fake behind the cloud
/// connector) as a fleet peer: listed first, online once its link is up,
/// never polled for workspaces, and `superagent_*` aimed at it are forwarded
/// with its answers and errors unchanged.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn cloud_node_leads_the_navigator_and_answers_forwarded_calls() {
    use crate::client::cloud::tests::{fake_cloud_node, TcpOpener, CLOUD_ID};
    use crate::client::cloud::CloudNodeConnector;

    let node = fake_cloud_node([9u8; 32], true).await;
    let ports: Ports = Arc::default();
    let cloud = FleetPeerPresence {
        device_id: CLOUD_ID.to_string(),
        name: "OpenBitFun".into(),
        host_kind: FleetHostKind::Cloud,
        online: true,
        mesh: true,
        as_of_ms: 1,
        ..FleetPeerPresence::default()
    };
    let a = host_with(
        "fc-a",
        vec![cloud],
        Some(CloudNodeConnector::new(
            Arc::new(TcpOpener(node.addr)),
            Arc::new(SharedKey("fc-a".into())),
            "openbitfun-test/1".into(),
        )),
        &ports,
    )
    .await;
    let client = connect(
        "fc-client",
        &a,
        Some(json!({ "protocol": 1, "cursor": {} })),
    )
    .await;
    // The entry's index link reaches the node.
    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
    while node.log.lock().unwrap().clients.is_empty() && tokio::time::Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert_eq!(node.log.lock().unwrap().clients, ["fc-a"]);
    let navigator = navigator_until(&client, |navigator| navigator.devices.len() == 2).await;
    let ids: Vec<&str> = navigator
        .devices
        .iter()
        .map(|device| device.device_id.as_str())
        .collect();
    assert_eq!(
        ids,
        [CLOUD_ID, "fc-a"],
        "the cloud node leads the navigator"
    );
    let node_row = &navigator.devices[0];
    assert_eq!(node_row.host_kind, FleetHostKind::Cloud);
    assert_eq!(node_row.state, FleetDeviceState::Online, "{node_row:?}");
    assert!(node_row.workspaces.is_empty());

    let status = client
        .call(
            "fleet_call",
            json!({ "request": { "target": CLOUD_ID, "command": "superagent_status",
                    "args": { "request": {} } } }),
        )
        .await
        .unwrap();
    assert_eq!(status, json!({ "enabled": true, "deviceId": CLOUD_ID }));
    let refused = client
        .call(
            "fleet_call",
            json!({ "request": { "target": CLOUD_ID, "command": "get_config", "args": {} } }),
        )
        .await
        .unwrap_err();
    assert!(
        refused
            .message
            .starts_with(crate::UNSUPPORTED_IN_NATIVE_HOST),
        "the node's own error passes through: {refused}"
    );
    // Superagent commands aimed at a runtime host are answered unsupported.
    let wrong = client
        .call(
            "fleet_call",
            json!({ "request": { "target": "fc-a", "command": "superagent_status", "args": {} } }),
        )
        .await
        .unwrap_err();
    assert!(
        wrong.message.starts_with(crate::UNSUPPORTED_IN_NATIVE_HOST),
        "{wrong}"
    );
    let calls: Vec<String> = node
        .log
        .lock()
        .unwrap()
        .calls
        .iter()
        .map(|(command, _)| command.clone())
        .collect();
    assert_eq!(
        calls,
        ["superagent_status", "get_config"],
        "the node is never polled for workspaces or digests"
    );

    client.close().await;
    a.fleet.shutdown();
    a.server.shutdown();
}

/// An entry without a cloud dialer (built before the connector, or on a
/// host that cannot reach the account server) still lists the node from its
/// directory row, as `unknown` with a reason, and gates calls to it.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn an_entry_without_the_cloud_connector_lists_the_node_unknown_and_gated() {
    use crate::client::cloud::tests::CLOUD_ID;

    let ports: Ports = Arc::default();
    let directory = vec![FleetDirectoryDevice {
        device_id: CLOUD_ID.into(),
        name: "OpenBitFun".into(),
        kind: Some("cloud_agent".into()),
        online: false,
        version: None,
        last_seen_ms: None,
    }];
    let presence = merge_presence("fc-old", &[], Some(&directory), 1);
    let old = host_with("fc-old", presence, None, &ports).await;
    let client = connect(
        "fc-client",
        &old,
        Some(json!({ "protocol": 1, "cursor": {} })),
    )
    .await;
    let navigator = navigator_until(&client, |navigator| navigator.devices.len() == 2).await;
    let node_row = &navigator.devices[0];
    assert_eq!(node_row.device_id, CLOUD_ID);
    assert_eq!(node_row.state, FleetDeviceState::Unknown);
    assert_eq!(
        node_row.state_reason.as_deref(),
        Some("cloud_connector_unavailable")
    );
    let gated = client
        .call(
            "fleet_call",
            json!({ "request": { "target": CLOUD_ID, "command": "superagent_status", "args": {} } }),
        )
        .await
        .unwrap_err();
    assert!(gated.message.starts_with(FLEET_DEVICE_OFFLINE), "{gated}");

    client.close().await;
    old.fleet.shutdown();
    old.server.shutdown();
}

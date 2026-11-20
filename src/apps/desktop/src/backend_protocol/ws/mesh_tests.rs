//! OBP over the account device network (OpenBitFun Link), desktop side.
//!
//! The listener, the handshake, the end-to-end channel and the client are
//! tested in the shared crate (`openbitfun-obp`). These tests drive the
//! desktop's adapter over the same loopback stand-ins: its own host verbs
//! (`mesh_verbs`: dispatch targets and the bot lane) and Peer Device Mode
//! links (`mesh::peer_link`), with device pair keys derived from real X25519
//! device keys.
//!
//! `mesh_e2e_*` and `peer_link_e2e_*` (ignored) run the whole path for real:
//! two in-process Link nodes join a throwaway account network through the
//! relay node (`wss://remote.openbitfun.com/mesh/et/`), and one backend
//! calls the other and streams its events. The credentials come from the
//! server (`openbitfun-link-node issue`, two devices of one scratch account):
//!
//! ```text
//! OPENBITFUN_LINK_E2E_A=/path/a.json OPENBITFUN_LINK_E2E_B=/path/b.json \
//!   cargo test -p openbitfun-desktop --lib mesh_e2e -- --ignored --nocapture --test-threads 1
//! ```

use std::collections::HashMap;
use std::net::{Ipv4Addr, SocketAddr};
use std::sync::Arc;
use std::time::{Duration, Instant};

use openbitfun_services_integrations::remote_connect::device_crypto;
use serde_json::{json, Value};

use super::mesh_client::{LoopbackConnector, MeshConnectOptions, MeshDialer, MeshTarget};

use super::*;
use crate::backend_protocol::EventHub;

struct EchoBackend {
    hub: Arc<EventHub>,
}

impl ObpBackend for EchoBackend {
    fn dispatch(&self, command: String, args: Value) -> ObpDispatchFuture {
        let hub = Arc::clone(&self.hub);
        Box::pin(async move {
            match command.as_str() {
                "open_workspace" => Ok(json!({ "command": command, "args": args })),
                // A registry `Proxied` command stands in for any command that
                // produces events (non-owner scopes run registry commands only).
                "page_list" => {
                    let count = args["count"].as_u64().unwrap_or(1);
                    for index in 0..count {
                        hub.publish("agentic://text-chunk", json!({ "index": index }));
                    }
                    hub.publish("account://login-state", json!({ "logged_in": true }));
                    hub.publish("mesh://status-changed", json!({ "state": "running" }));
                    hub.publish("agentic://tool-event", json!({ "done": true }));
                    Ok(Value::Null)
                }
                // Detached-dispatch target verb: stands in for the CLI runner.
                "dispatch_target_probe" => Ok(json!({ "routed": command, "args": args })),
                // The bot lane runs the real host-verb router (its refusals
                // are deterministic without a running agent runtime).
                "obp_remote_command" => match super::mesh_verbs::route(&command, args) {
                    Some(future) => future.await,
                    None => Err("obp_remote_command was not routed".to_string()),
                },
                other => Err(crate::host::unsupported_in_native_host(other)),
            }
        })
    }

    fn is_account_device_host_verb(&self, command: &str) -> bool {
        super::mesh_verbs::is_account_device_host_verb(command)
    }

    fn mesh_capabilities(&self) -> Vec<&'static str> {
        super::mesh_verbs::CAPABILITIES.to_vec()
    }

    fn events(&self) -> Arc<EventHub> {
        Arc::clone(&self.hub)
    }

    fn info(&self) -> Value {
        json!({ "version": "9.9.9-mesh", "platform": "test", "dataDir": "/secret/data" })
    }
}

/// A device with a real X25519 key; its directory knows `peers`.
struct TestAuthority {
    device_id: String,
    secret: [u8; 32],
    directory: HashMap<String, [u8; 32]>,
}

impl MeshAuthority for TestAuthority {
    fn local_device_id(&self) -> Option<String> {
        Some(self.device_id.clone())
    }

    fn pair_key<'a>(&'a self, device_id: &'a str) -> PairKeyFuture<'a> {
        Box::pin(async move {
            let public = self
                .directory
                .get(device_id)
                .ok_or_else(|| format!("device {device_id} is not in this account"))?;
            device_crypto::derive_message_key(&self.secret, public).map_err(|e| e.to_string())
        })
    }
}

fn device(id: &str, secret: [u8; 32], known: &[(&str, [u8; 32])]) -> Arc<TestAuthority> {
    Arc::new(TestAuthority {
        device_id: id.to_string(),
        secret,
        directory: known
            .iter()
            .map(|(id, secret)| (id.to_string(), device_crypto::public_key(secret)))
            .collect(),
    })
}

async fn server(
    authority: Arc<TestAuthority>,
) -> (Arc<ObpServer>, Arc<EventHub>, tempfile::TempDir) {
    let dir = tempfile::tempdir().unwrap();
    let hub = EventHub::new(256);
    let mut options = ObpServerOptions::new(dir.path().join("obp"));
    options.loopback_port = 0;
    let server = ObpServer::new(
        Arc::new(EchoBackend {
            hub: Arc::clone(&hub),
        }),
        options,
    )
    .unwrap();
    server.start_mesh(authority).await.unwrap();
    (server, hub, dir)
}

/// Tests whose servers share a device id scan the same mesh port range;
/// they hold this so a range scan cannot find the other test's listener.
static SHARED_DEVICE_ID_RANGE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

const ALICE: [u8; 32] = [11; 32];
const BOB: [u8; 32] = [23; 32];

/// Detached Dispatch and IM bots between two new devices: the target verbs
/// and the `RemoteCommand` lane run over the account-device connection, and
/// both capabilities are negotiated in `/obp/mesh/info` and `hello`.
#[tokio::test]
async fn account_devices_run_dispatch_and_bot_host_verbs_over_the_mesh() {
    let bob = device("dispatch-target", BOB, &[("dispatch-controller", ALICE)]);
    // Distinct device ids: tests run in parallel and share the mesh port range.
    let (_server, _hub, _dir) = server(Arc::clone(&bob)).await;
    let dialer = MeshDialer {
        connector: Arc::new(LoopbackConnector),
        authority: device("dispatch-controller", ALICE, &[("dispatch-target", BOB)]),
    };
    let target = MeshTarget {
        device_id: "dispatch-target".into(),
        virtual_ip: Ipv4Addr::new(10, 126, 126, 2),
        port: None,
    };
    let (_, info) = dialer.locate(&target).await.unwrap();
    for capability in ["dispatch_target_v1", "remote_command_v1"] {
        assert!(
            info.capabilities.contains(&capability.to_string()),
            "{capability}"
        );
    }
    let connection = dialer
        .connect(&target, MeshConnectOptions::default())
        .await
        .unwrap();
    let advertised = connection.hello()["capabilities"]
        .as_array()
        .unwrap()
        .clone();
    assert!(advertised.contains(&json!("dispatch_target_v1")));
    assert!(advertised.contains(&json!("remote_command_v1")));

    let probe = connection
        .call("dispatch_target_probe", json!({ "workspacePath": "/w" }))
        .await
        .unwrap();
    assert_eq!(probe["routed"], "dispatch_target_probe");
    assert_eq!(probe["args"]["workspacePath"], "/w");

    // Admitted and routed to the host-verb router, which refuses the forms
    // that have their own OBP lane with the backend's own text.
    let refused = connection
        .call(
            "obp_remote_command",
            json!({ "command": { "cmd": "host_invoke", "command": "list_sessions", "args": {} } }),
        )
        .await
        .unwrap_err();
    assert_eq!(refused.code, -32000, "{refused}");
    assert!(
        refused.message.contains("host_invoke is not carried here"),
        "{refused}"
    );

    // Other host control-plane names stay with the legacy peer host.
    let refused = connection
        .call("peer_mode_ping", json!({}))
        .await
        .unwrap_err();
    assert_eq!(refused.code, -32003);
    connection.close().await;
}

// ---------------------------------------------------------------------------
// Live end-to-end over Link and the relay node.

/// Two credential documents of one scratch account network, as
/// `openbitfun-link-node issue` writes them on the server.
fn live_credentials() -> (
    openbitfun_link::MeshCredentials,
    openbitfun_link::MeshCredentials,
) {
    let read = |var: &str| -> openbitfun_link::MeshCredentials {
        let path = std::env::var(var).unwrap_or_else(|_| panic!("set {var} (see the module docs)"));
        serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap()
    };
    (read("OPENBITFUN_LINK_E2E_A"), read("OPENBITFUN_LINK_E2E_B"))
}

/// A Link node's inbound OBP streams as the mesh listener's source.
struct NodeIncoming {
    node: Arc<openbitfun_link::LinkNode>,
    listener: tokio::sync::Mutex<Option<openbitfun_link::LinkListener>>,
}

impl MeshIncoming for NodeIncoming {
    fn accept(&self) -> MeshAcceptFuture<'_> {
        Box::pin(async move {
            loop {
                let mut listener = self.listener.lock().await;
                if listener.is_none() {
                    *listener = self
                        .node
                        .bind(
                            openbitfun_link::MESH_OBP_PORT_FIRST,
                            Duration::from_secs(30),
                        )
                        .await
                        .ok();
                }
                match listener.as_mut()?.accept().await {
                    Ok(stream) => {
                        let peer = stream.peer_addr();
                        return Some((Box::new(stream) as Box<dyn MeshIo>, peer));
                    }
                    Err(_) if self.node.has_stopped() => return None,
                    Err(_) => *listener = None,
                }
            }
        })
    }

    fn port(&self) -> Option<u16> {
        Some(openbitfun_link::MESH_OBP_PORT_FIRST)
    }
}

/// Outbound streams through a Link node.
struct NodeConnector(Arc<openbitfun_link::LinkNode>);

impl super::mesh_client::MeshConnector for NodeConnector {
    fn open(&self, ip: Ipv4Addr, port: u16) -> super::mesh_client::MeshOpenFuture<'_> {
        Box::pin(async move {
            let stream = self
                .0
                .connect_addr(SocketAddr::from((ip, port)), Duration::from_secs(15))
                .await?;
            Ok(Box::new(stream) as Box<dyn MeshIo>)
        })
    }
}

/// A backend on a live Link node: its OBP mesh listener serves the node's
/// inbound streams (no loopback socket).
async fn live_backend(
    id: &str,
    authority: Arc<TestAuthority>,
    credentials: &openbitfun_link::MeshCredentials,
    disable_p2p: bool,
) -> (
    Arc<ObpServer>,
    Arc<EventHub>,
    tempfile::TempDir,
    Arc<openbitfun_link::LinkNode>,
) {
    let dir = tempfile::tempdir().unwrap();
    let hub = EventHub::new(256);
    let mut options = ObpServerOptions::new(dir.path().join("obp"));
    options.loopback_port = 0;
    let server = ObpServer::new(
        Arc::new(EchoBackend {
            hub: Arc::clone(&hub),
        }),
        options,
    )
    .unwrap();
    let config = openbitfun_link::DeviceNodeConfig {
        instance_name: format!("e2e-{id}"),
        hostname: id.to_string(),
        credentials: credentials.clone(),
        listener_port: Some(openbitfun_link::session::free_listener_port(0).unwrap()),
        inbound_tcp_ports: (
            openbitfun_link::MESH_OBP_PORT_FIRST,
            openbitfun_link::MESH_OBP_PORT_LAST,
        ),
        disable_p2p,
    };
    let node = openbitfun_link::LinkNode::start(openbitfun_link::NodeOptions {
        config_toml: config.render().unwrap(),
        network_name: credentials.network_name.clone(),
        hostname: id.to_string(),
        join_token: credentials.join_token.clone(),
        status_interval: Duration::from_secs(2),
    })
    .await
    .expect("Link node");
    server
        .start_mesh_with(
            authority,
            Arc::new(NodeIncoming {
                node: Arc::clone(&node),
                listener: tokio::sync::Mutex::new(None),
            }),
            SocketAddr::from((Ipv4Addr::UNSPECIFIED, openbitfun_link::MESH_OBP_PORT_FIRST)),
        )
        .await
        .unwrap();
    (server, hub, dir, node)
}

/// Resident memory (KiB) and CPU time of a process (live tests, unix).
fn ps_sample(pid: u32) -> Option<(u64, String)> {
    let output = std::process::Command::new("ps")
        .args(["-o", "rss=,time=", "-p", &pid.to_string()])
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let mut parts = text.split_whitespace();
    Some((parts.next()?.parse().ok()?, parts.next()?.to_string()))
}

fn live_suffix() -> String {
    openbitfun_link::handshake::new_nonce()
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .take(10)
        .collect::<String>()
        .to_ascii_lowercase()
}

async fn live_round(disable_p2p: bool) {
    use openbitfun_link::{MeshPath, MeshState};

    let (alice_credentials, bob_credentials) = live_credentials();
    let suffix = live_suffix();
    let alice_id = format!("e2ealice{suffix}");
    let bob_id = format!("e2ebob{suffix}");
    let alice = device(&alice_id, ALICE, &[(&bob_id, BOB)]);
    let bob = device(&bob_id, BOB, &[(&alice_id, ALICE)]);
    let started = Instant::now();
    let (_alice_server, _alice_hub, _a, alice_node) = live_backend(
        &alice_id,
        Arc::clone(&alice),
        &alice_credentials,
        disable_p2p,
    )
    .await;
    let (bob_server, bob_hub, _b, bob_node) =
        live_backend(&bob_id, Arc::clone(&bob), &bob_credentials, disable_p2p).await;

    let mut seen = None;
    for _ in 0..90 {
        tokio::time::sleep(Duration::from_secs(1)).await;
        let status = alice_node.refresh_status().await;
        if let Some(peer) = status.peer(&bob_id) {
            // Nodes that join at the same moment can pick the same DHCP
            // address; Link resolves it within seconds.
            if status.virtual_ip.as_deref() == Some(peer.virtual_ip.as_str()) {
                continue;
            }
            if !disable_p2p
                && peer.path != MeshPath::P2p
                && started.elapsed() < Duration::from_secs(45)
            {
                continue; // give hole punching a chance
            }
            seen = Some((status.clone(), peer.clone()));
            break;
        }
    }
    let (status, peer) = seen.expect("bob never appeared in alice's mesh");
    println!(
        "[mesh-e2e] mode={} joined_after_ms={} alice_ip={:?} relay_nodes={:?}",
        if disable_p2p {
            "relay-forced"
        } else {
            "default"
        },
        started.elapsed().as_millis(),
        status.virtual_ip,
        status
            .relay_nodes
            .iter()
            .map(|node| format!(
                "{}({:?}ms via {:?})",
                node.name, node.latency_ms, node.tunnel
            ))
            .collect::<Vec<_>>()
    );
    println!(
        "[mesh-e2e] bob as seen by alice: ip={} route={:?} hops={} latency_ms={:?} tunnel={:?}",
        peer.virtual_ip, peer.route, peer.hops, peer.latency_ms, peer.tunnel
    );
    assert_eq!(status.state, MeshState::Running);
    assert_ne!(status.virtual_ip.as_deref(), Some(peer.virtual_ip.as_str()));
    if disable_p2p {
        assert_eq!(peer.path, MeshPath::Relayed);
    }

    let dialer = MeshDialer {
        connector: Arc::new(NodeConnector(Arc::clone(&alice_node))),
        authority: alice,
    };
    let target = MeshTarget {
        device_id: bob_id.clone(),
        virtual_ip: peer.virtual_ip.parse().unwrap(),
        port: None,
    };
    let connect_started = Instant::now();
    let connection = dialer
        .connect(&target, MeshConnectOptions::default())
        .await
        .expect("OBP over the mesh");
    println!(
        "[mesh-e2e] OBP connected (locate + TLS + device handshake + hello) in {} ms; scope={} capabilities={}",
        connect_started.elapsed().as_millis(),
        connection.hello()["scope"],
        connection.hello()["capabilities"]
    );
    assert_eq!(connection.hello()["scope"], "account-device");
    assert_eq!(bob_server.status().account_device_connections, 1);

    let mut samples = Vec::new();
    for index in 0..20 {
        let begun = Instant::now();
        let reply = connection
            .call("open_workspace", json!({ "request": { "index": index } }))
            .await
            .unwrap();
        samples.push(begun.elapsed().as_secs_f64() * 1000.0);
        assert_eq!(reply["args"]["request"]["index"], index);
    }
    samples.sort_by(|a, b| a.partial_cmp(b).unwrap());
    println!(
        "[mesh-e2e] OBP call RTT over 20 calls: min={:.1} ms p50={:.1} ms max={:.1} ms",
        samples[0], samples[10], samples[19]
    );
    let refused = connection
        .call(
            "obp_set_lan_enabled",
            json!({ "request": { "enabled": true } }),
        )
        .await
        .unwrap_err();
    assert_eq!(refused.code, -32003);

    let stream_started = Instant::now();
    connection
        .call("page_list", json!({ "count": 500 }))
        .await
        .unwrap();
    let mut received = 0usize;
    let mut last = String::new();
    while last != "agentic://tool-event" {
        let event = tokio::time::timeout(Duration::from_secs(20), connection.next_event())
            .await
            .expect("events keep flowing")
            .expect("open stream");
        assert!(!event.event.starts_with("account://") && !event.event.starts_with("mesh://"));
        received += 1;
        last = event.event;
    }
    println!(
        "[mesh-e2e] event stream: {} events (500 text chunks, coalescing allowed) in {} ms; bob last_seq={}",
        received,
        stream_started.elapsed().as_millis(),
        bob_hub.last_seq()
    );
    connection.close().await;

    // Idle cost of Link in this process (two nodes, two backends, status
    // rebuilt every 2 s): no sidecar process any more.
    let pid = std::process::id();
    let before = ps_sample(pid);
    tokio::time::sleep(Duration::from_secs(30)).await;
    let after = ps_sample(pid);
    println!(
        "[mesh-e2e] idle test process (2 Link nodes + 2 backends) over 30 s: rss_kb/cpu-time before={before:?} after={after:?}"
    );
    alice_node.stop().await;
    bob_node.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "live: needs Link credentials from the relay server"]
async fn mesh_e2e_default_path() {
    live_round(false).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "live: needs Link credentials from the relay server"]
async fn mesh_e2e_relay_forced() {
    live_round(true).await;
}

// ── Peer Device Mode over the mesh (controller-side link) ────────────────────

/// Reaches devices through a test dialer (loopback streams, real handshake).
struct DialerConnector {
    dialer: MeshDialer,
}

impl crate::mesh::peer_link::PeerConnector for DialerConnector {
    fn connect(
        &self,
        device_id: String,
        options: MeshConnectOptions,
    ) -> crate::mesh::peer_link::ConnectFuture {
        let dialer = self.dialer.clone();
        Box::pin(async move {
            let target = MeshTarget {
                device_id,
                virtual_ip: Ipv4Addr::new(10, 126, 126, 9),
                port: None,
            };
            dialer.connect(&target, options).await
        })
    }

    fn route(&self, _device_id: &str) -> Option<(String, Option<f64>)> {
        Some(("p2p".to_string(), Some(0.4)))
    }
}

async fn wait_for_events(
    links: &crate::mesh::peer_link::PeerLinks,
    device: &str,
    after: Option<u64>,
    want: impl Fn(&[Value]) -> bool,
) -> Vec<Value> {
    let mut seen = Vec::new();
    let mut cursor = after;
    let deadline = Instant::now() + Duration::from_secs(10);
    while Instant::now() < deadline {
        let batch = links
            .events(device, cursor, None, Duration::from_millis(500))
            .await
            .unwrap();
        for event in batch.events {
            if let Some(seq) = event["seq"].as_u64() {
                cursor = Some(seq);
            }
            seen.push(event);
        }
        if want(&seen) {
            break;
        }
    }
    seen
}

/// Two in-process backends over the mesh client: the controller's peer link
/// drives "dana" (calls with the exact Tauri args, live events with the
/// peer's own seq, owner-only events withheld, registry refusals passed
/// through), survives a dropped mesh connection by resuming after its last
/// seq, and closes.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn peer_device_mode_links_call_stream_and_resume_over_the_mesh() {
    let _range = SHARED_DEVICE_ID_RANGE.lock().await;
    let dana = device("dana-device", BOB, &[("erin-device", ALICE)]);
    let (server, hub, _dir) = server(Arc::clone(&dana)).await;
    let links = crate::mesh::peer_link::PeerLinks::new(Arc::new(DialerConnector {
        dialer: MeshDialer {
            connector: Arc::new(LoopbackConnector),
            authority: device("erin-device", ALICE, &[("dana-device", BOB)]),
        },
    }));

    let info = links.connect("dana-device").await.unwrap();
    assert_eq!(info.scope, "account-device");
    assert!(info.capabilities.contains(&"mesh_v1".to_string()));
    assert!(info.capabilities.contains(&"obp_v1".to_string()));
    assert!(info.host_capabilities.contains(&"tool_catalog".to_string()));
    assert_eq!(info.mesh_path.as_deref(), Some("p2p"));
    assert!(info.backend.get("dataDir").is_none());
    // Connecting again reuses the open link.
    links.connect("dana-device").await.unwrap();
    assert_eq!(server.status().account_device_connections, 1);

    // Calls carry the Tauri args unchanged and return the peer's own JSON.
    let echoed = links
        .call(
            "dana-device",
            "open_workspace",
            json!({ "request": { "path": "/srv" } }),
        )
        .await
        .unwrap();
    assert_eq!(echoed["args"], json!({ "request": { "path": "/srv" } }));
    // Registry refusals of the peer reach the controller as they are.
    let refused = links
        .call("dana-device", "account_delete_device", json!({}))
        .await
        .unwrap_err();
    assert!(refused.starts_with("forbidden_for_scope:"), "{refused}");

    // Live events: the peer's seq, owner-only events withheld.
    links
        .call("dana-device", "page_list", json!({ "count": 3 }))
        .await
        .unwrap();
    let events = wait_for_events(&links, "dana-device", None, |seen| {
        seen.iter()
            .any(|event| event["event"] == "agentic://tool-event")
    })
    .await;
    let names: Vec<&str> = events
        .iter()
        .filter_map(|event| event["event"].as_str())
        .collect();
    assert!(names.contains(&"agentic://text-chunk"), "{names:?}");
    assert!(names.contains(&"agentic://tool-event"), "{names:?}");
    assert!(!names.iter().any(|name| name.starts_with("account://")));
    assert!(!names.iter().any(|name| name.starts_with("mesh://")));
    let seqs: Vec<u64> = events.iter().filter_map(|e| e["seq"].as_u64()).collect();
    assert!(seqs.windows(2).all(|pair| pair[0] < pair[1]), "{seqs:?}");
    let cursor = *seqs.last().unwrap();
    assert_eq!(cursor, hub.last_seq());

    // Drop the mesh connection; events published meanwhile are replayed
    // after the link reconnects with its resume cursor.
    server.stop_mesh();
    hub.publish("agentic://text-chunk", json!({ "index": "while-away" }));
    let offline = links
        .call("dana-device", "open_workspace", json!({}))
        .await
        .unwrap_err();
    assert!(
        offline.starts_with("peer_reconnecting") || offline.starts_with("peer_unreachable"),
        "{offline}"
    );
    server.start_mesh(dana).await.unwrap();
    let resumed = wait_for_events(&links, "dana-device", Some(cursor), |seen| {
        seen.iter()
            .any(|event| event["payload"]["index"] == "while-away")
    })
    .await;
    assert!(
        resumed
            .iter()
            .any(|event| event["payload"]["index"] == "while-away"),
        "{resumed:?}"
    );
    assert!(resumed
        .iter()
        .all(|event| event["seq"].as_u64().is_some_and(|seq| seq > cursor)));
    // Calls work again on the resumed link.
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        match links.call("dana-device", "open_workspace", json!({})).await {
            Ok(_) => break,
            Err(error) if Instant::now() < deadline => {
                assert!(error.starts_with("peer_"), "{error}");
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
            Err(error) => panic!("the link did not resume: {error}"),
        }
    }

    // A cursor older than the link's ring gets an explicit drop notice.
    let stale = links
        .events(
            "dana-device",
            Some(0),
            Some("another-instance"),
            Duration::ZERO,
        )
        .await
        .unwrap();
    assert_eq!(
        stale.events[0]["event"],
        crate::backend_protocol::EVENTS_DROPPED_EVENT
    );
    assert!(stale.events[0].get("seq").is_none());

    assert!(links.disconnect("dana-device").await);
    let closed = links
        .call("dana-device", "open_workspace", json!({}))
        .await
        .unwrap_err();
    assert!(closed.starts_with("peer_link_closed"), "{closed}");
}

/// Peer Device Mode for real: two in-process Link nodes join a scratch
/// account network through the relay node, and the controller's peer link drives the
/// other backend over it while that backend streams paced text chunks (a
/// model's tokens). Prints when each chunk reached the controller's long poll.
///
/// ```text
/// OPENBITFUN_LINK_E2E_A=/path/a.json OPENBITFUN_LINK_E2E_B=/path/b.json \
///   cargo test -p openbitfun-desktop --lib peer_link_e2e -- --ignored --nocapture --test-threads 1
/// ```
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "live: needs Link credentials from the relay server"]
async fn peer_link_e2e_streams_live_tokens_over_the_relay_node() {
    let (controller_credentials, target_credentials) = live_credentials();
    let suffix = live_suffix();
    let controller_id = format!("e2ectl{suffix}");
    let target_id = format!("e2etgt{suffix}");
    let controller = device(&controller_id, ALICE, &[(&target_id, BOB)]);
    let target = device(&target_id, BOB, &[(&controller_id, ALICE)]);
    let disable_p2p = std::env::var("OPENBITFUN_MESH_DISABLE_P2P").is_ok_and(|v| v == "1");
    let started = Instant::now();
    let (_controller_server, _controller_hub, _c, controller_node) = live_backend(
        &controller_id,
        Arc::clone(&controller),
        &controller_credentials,
        disable_p2p,
    )
    .await;
    let (_target_server, target_hub, _t, target_node) = live_backend(
        &target_id,
        Arc::clone(&target),
        &target_credentials,
        disable_p2p,
    )
    .await;
    let mut found = None;
    for _ in 0..90 {
        tokio::time::sleep(Duration::from_secs(1)).await;
        let status = controller_node.refresh_status().await;
        if let Some(peer) = status.peer(&target_id) {
            if status.virtual_ip.as_deref() != Some(peer.virtual_ip.as_str()) {
                found = Some(peer.clone());
                break;
            }
        }
    }
    let peer = found.expect("the target never joined the controller's mesh");
    println!(
        "[peer-e2e] joined after {} ms: target ip={} route={:?} latency_ms={:?}",
        started.elapsed().as_millis(),
        peer.virtual_ip,
        peer.route,
        peer.latency_ms
    );

    struct LiveConnector {
        dialer: MeshDialer,
        ip: Ipv4Addr,
        path: String,
        latency: Option<f64>,
    }
    impl crate::mesh::peer_link::PeerConnector for LiveConnector {
        fn connect(
            &self,
            device_id: String,
            options: MeshConnectOptions,
        ) -> crate::mesh::peer_link::ConnectFuture {
            let dialer = self.dialer.clone();
            let ip = self.ip;
            Box::pin(async move {
                dialer
                    .connect(
                        &MeshTarget {
                            device_id,
                            virtual_ip: ip,
                            port: None,
                        },
                        options,
                    )
                    .await
            })
        }
        fn route(&self, _device_id: &str) -> Option<(String, Option<f64>)> {
            Some((self.path.clone(), self.latency))
        }
    }
    let links = crate::mesh::peer_link::PeerLinks::new(Arc::new(LiveConnector {
        dialer: MeshDialer {
            connector: Arc::new(NodeConnector(Arc::clone(&controller_node))),
            authority: controller,
        },
        ip: peer.virtual_ip.parse().unwrap(),
        path: format!("{:?}", peer.path).to_lowercase(),
        latency: peer.latency_ms,
    }));
    let begun = Instant::now();
    let info = links
        .connect(&target_id)
        .await
        .expect("peer link over the mesh");
    println!(
        "[peer-e2e] peer_link_connect in {} ms: scope={} capabilities={:?} hostCapabilities={}",
        begun.elapsed().as_millis(),
        info.scope,
        info.capabilities,
        info.host_capabilities.len()
    );
    let mut rtts = Vec::new();
    for index in 0..10 {
        let begun = Instant::now();
        let reply = links
            .call(
                &target_id,
                "open_workspace",
                json!({ "request": { "index": index } }),
            )
            .await
            .unwrap();
        rtts.push(begun.elapsed().as_secs_f64() * 1000.0);
        assert_eq!(reply["args"]["request"]["index"], index);
    }
    rtts.sort_by(|a, b| a.partial_cmp(b).unwrap());
    println!(
        "[peer-e2e] peer_link_call RTT over 10 calls: min={:.1} ms p50={:.1} ms max={:.1} ms",
        rtts[0], rtts[5], rtts[9]
    );

    // A model streaming 40 tokens, 25 ms apart, on the target.
    let cursor = links
        .events(&target_id, None, None, Duration::ZERO)
        .await
        .unwrap()
        .events
        .iter()
        .filter_map(|event| event["seq"].as_u64())
        .last();
    let publisher = {
        let hub = Arc::clone(&target_hub);
        tokio::spawn(async move {
            let mut sent = Vec::new();
            for index in 0..40u64 {
                hub.publish(
                    "agentic://text-chunk",
                    json!({ "sessionId": "s", "turnId": "t", "roundId": "r", "text": format!("tok{index} ") }),
                );
                sent.push(Instant::now());
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
            sent
        })
    };
    // Token index -> when it reached the controller (a slow poll may merge
    // consecutive chunks into one event; each token is still counted).
    let mut arrivals: Vec<Option<Instant>> = vec![None; 40];
    let mut after = cursor;
    let deadline = Instant::now() + Duration::from_secs(20);
    while arrivals.iter().any(Option::is_none) && Instant::now() < deadline {
        let batch = links
            .events(&target_id, after, None, Duration::from_secs(5))
            .await
            .unwrap();
        let now = Instant::now();
        for event in batch.events {
            if let Some(seq) = event["seq"].as_u64() {
                after = Some(seq);
            }
            if let Some(text) = event["payload"]["text"].as_str() {
                for word in text.split_whitespace() {
                    if let Some(index) = word
                        .strip_prefix("tok")
                        .and_then(|i| i.parse::<usize>().ok())
                    {
                        if index < 40 && arrivals[index].is_none() {
                            arrivals[index] = Some(now);
                        }
                    }
                }
            }
        }
    }
    let sent = publisher.await.unwrap();
    let arrived: Vec<Instant> = arrivals.iter().flatten().copied().collect();
    assert_eq!(arrived.len(), 40, "only {} tokens arrived", arrived.len());
    let mut delays: Vec<f64> = arrived
        .iter()
        .zip(sent.iter())
        .map(|(got, put)| got.duration_since(*put).as_secs_f64() * 1000.0)
        .collect();
    let batches_spread_ms = arrived[39].duration_since(arrived[0]).as_millis();
    delays.sort_by(|a, b| a.partial_cmp(b).unwrap());
    println!(
        "[peer-e2e] 40 paced tokens: publish->controller long poll min={:.1} ms p50={:.1} ms max={:.1} ms; first-to-last arrival spread {} ms (publishing took ~1000 ms, so tokens arrived live, not in one pull)",
        delays[0], delays[20], delays[39], batches_spread_ms
    );
    assert!(batches_spread_ms > 500, "tokens arrived in one batch");
    assert!(links.disconnect(&target_id).await);
    controller_node.stop().await;
    target_node.stop().await;
}

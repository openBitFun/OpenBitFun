//! The fleet stream and the prefix filter over the account device network.
//!
//! Real mesh listeners, the real device handshake and the real controller
//! client over loopback TCP: an entry (`A`, with the fleet mux and its peer
//! links), an owner (`B`, serving `fleet_replay`), and a client (`C`)
//! connected to the entry as another account device.

use std::collections::HashMap;
use std::net::Ipv4Addr;
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use serde_json::{json, Value};

use super::mesh_tests::{device, TestAuthority};
use super::*;
use crate::client::links::{ConnectFuture, PeerConnector, PeerLinks};
use crate::client::{
    LoopbackConnector, MeshConnectOptions, MeshDialer, MeshObpConnection, MeshObpEvent, MeshTarget,
};
use crate::events::{EventHub, EVENTS_DROPPED_EVENT};

const A_KEY: [u8; 32] = [41; 32];
const B_KEY: [u8; 32] = [43; 32];
const C_KEY: [u8; 32] = [47; 32];

/// A runtime host for these tests: publishes what it is told to, and serves
/// `fleet_replay` from its own ring.
struct FleetTestBackend {
    hub: Arc<EventHub>,
    instance: OnceLock<String>,
    #[cfg(feature = "fleet")]
    mux: OnceLock<Arc<crate::fleet::mux::FleetMux>>,
}

impl ObpBackend for FleetTestBackend {
    fn dispatch(&self, command: String, args: Value) -> ObpDispatchFuture {
        let hub = Arc::clone(&self.hub);
        let instance = self.instance.get().cloned().unwrap_or_default();
        Box::pin(async move {
            match command.as_str() {
                #[cfg(feature = "fleet")]
                "fleet_replay" => {
                    let request = serde_json::from_value(args["request"].clone())
                        .map_err(|error| error.to_string())?;
                    let answer = crate::fleet::mux::serve_replay(&hub, &instance, &request);
                    serde_json::to_value(answer).map_err(|error| error.to_string())
                }
                // A call that is still running when the link changes
                // what it carries (link switch tests): a registered command
                // every account device may run, answered slowly.
                "get_config" => {
                    tokio::time::sleep(Duration::from_millis(
                        args["request"]["ms"].as_u64().unwrap_or(500),
                    ))
                    .await;
                    Ok(json!({ "echo": args["request"]["path"].clone() }))
                }
                other => {
                    let _ = (&hub, &instance, &args);
                    Err(format!("{}: {other}", crate::UNSUPPORTED_IN_NATIVE_HOST))
                }
            }
        })
    }

    fn events(&self) -> Arc<EventHub> {
        Arc::clone(&self.hub)
    }

    fn info(&self) -> Value {
        json!({ "version": "9.9.9-fleet", "platform": "test" })
    }

    fn is_account_device_host_verb(&self, command: &str) -> bool {
        command == "fleet_replay"
    }

    #[cfg(feature = "fleet")]
    fn fleet_mux(&self) -> Option<Arc<crate::fleet::mux::FleetMux>> {
        self.mux.get().cloned()
    }

    /// An entry (a node with the mux) advertises the fleet layer, as the
    /// desktop and CLI hosts do.
    fn mesh_capabilities(&self) -> Vec<&'static str> {
        #[cfg(feature = "fleet")]
        if self.mux.get().is_some() {
            return vec![openbitfun_product_domains::fleet::FLEET_V1_CAPABILITY];
        }
        Vec::new()
    }
}

struct Node {
    server: Arc<ObpServer>,
    hub: Arc<EventHub>,
    #[cfg_attr(not(feature = "fleet"), allow(dead_code))]
    backend: Arc<FleetTestBackend>,
    authority: Arc<TestAuthority>,
    port: u16,
    _dir: tempfile::TempDir,
}

async fn node(
    id: &str,
    key: [u8; 32],
    known: &[(&str, [u8; 32])],
    limits: ConnectionLimits,
) -> Node {
    let dir = tempfile::tempdir().unwrap();
    let hub = EventHub::new(256);
    let backend = Arc::new(FleetTestBackend {
        hub: Arc::clone(&hub),
        instance: OnceLock::new(),
        #[cfg(feature = "fleet")]
        mux: OnceLock::new(),
    });
    let mut options = ObpServerOptions::new(dir.path().join("obp"));
    options.loopback_port = 0;
    options.limits = limits;
    let server = ObpServer::new(Arc::clone(&backend) as Arc<dyn ObpBackend>, options).unwrap();
    backend
        .instance
        .set(server.instance_id().to_string())
        .unwrap();
    let authority = device(id, key, known);
    // An ephemeral port, not the shared mesh range: the peers here dial
    // known ports, and the range has room for only eight listeners.
    let incoming = EphemeralIncoming::bind().await;
    let addr = std::net::SocketAddr::from((Ipv4Addr::LOCALHOST, incoming.port));
    let port = server
        .start_mesh_with(
            Arc::clone(&authority) as Arc<dyn MeshAuthority>,
            Arc::new(incoming),
            addr,
        )
        .await
        .unwrap()
        .port();
    Node {
        server,
        hub,
        backend,
        authority,
        port,
        _dir: dir,
    }
}

/// Loopback TCP on an ephemeral port as the device network.
struct EphemeralIncoming {
    listener: tokio::net::TcpListener,
    port: u16,
}

impl EphemeralIncoming {
    async fn bind() -> Self {
        let listener = tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
            .await
            .unwrap();
        let port = listener.local_addr().unwrap().port();
        Self { listener, port }
    }
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

/// Reaches devices at known ports with a node's identity.
struct PortConnector {
    dialer: MeshDialer,
    ports: HashMap<String, u16>,
}

impl PeerConnector for PortConnector {
    fn connect(&self, device_id: String, options: MeshConnectOptions) -> ConnectFuture {
        let dialer = self.dialer.clone();
        let port = self.ports.get(&device_id).copied();
        Box::pin(async move {
            let target = MeshTarget {
                device_id,
                virtual_ip: Ipv4Addr::new(10, 126, 126, 7),
                port,
            };
            dialer.connect(&target, options).await
        })
    }

    fn route(&self, _device_id: &str) -> Option<(String, Option<f64>)> {
        Some(("p2p".to_string(), Some(0.3)))
    }
}

fn links_for(from: &Node, peers: &[(&str, &Node)]) -> Arc<PeerLinks> {
    PeerLinks::new(Arc::new(PortConnector {
        dialer: MeshDialer {
            connector: Arc::new(LoopbackConnector),
            authority: Arc::clone(&from.authority) as Arc<dyn MeshAuthority>,
        },
        ports: peers
            .iter()
            .map(|(id, node)| (id.to_string(), node.port))
            .collect(),
    }))
}

async fn dial(
    from: &Arc<TestAuthority>,
    to: &str,
    port: u16,
    options: MeshConnectOptions,
) -> MeshObpConnection {
    MeshDialer {
        connector: Arc::new(LoopbackConnector),
        authority: Arc::clone(from) as Arc<dyn MeshAuthority>,
    }
    .connect(
        &MeshTarget {
            device_id: to.to_string(),
            virtual_ip: Ipv4Addr::new(10, 126, 126, 7),
            port: Some(port),
        },
        options,
    )
    .await
    .unwrap()
}

/// Events until `done` holds (10 s at most).
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

fn named<'a>(events: &'a [MeshObpEvent], origin: Option<&str>) -> Vec<&'a MeshObpEvent> {
    events
        .iter()
        .filter(|event| event.event != EVENTS_DROPPED_EVENT)
        .filter(|event| origin.is_none() || event.origin.as_deref() == origin)
        .collect()
}

/// The prefix filter: a hello with `events: {prefixes}` gets only matching
/// events (and the answer echoes the filter); an index-only peer link holds
/// only `fleet://` events, whatever else the owner emits.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn prefix_filter_limits_upstream() {
    let b = node(
        "pf-owner",
        B_KEY,
        &[("pf-entry", A_KEY), ("pf-client", C_KEY)],
        ConnectionLimits::default(),
    )
    .await;
    let client = device("pf-client", C_KEY, &[("pf-owner", B_KEY)]);
    let filtered = dial(
        &client,
        "pf-owner",
        b.port,
        MeshConnectOptions {
            event_prefixes: Some(vec!["fleet://".into()]),
            ..MeshConnectOptions::default()
        },
    )
    .await;
    assert_eq!(filtered.hello()["events"]["prefixes"], json!(["fleet://"]));
    let plain = dial(&client, "pf-owner", b.port, MeshConnectOptions::default()).await;
    assert!(plain.hello().get("events").is_none());

    let a = node(
        "pf-entry",
        A_KEY,
        &[("pf-owner", B_KEY)],
        ConnectionLimits::default(),
    )
    .await;
    let links = links_for(&a, &[("pf-owner", &b)]);
    links.connect_index("pf-owner").await.unwrap();

    b.hub
        .publish("agentic://text-chunk", json!({ "text": "x" }));
    b.hub
        .publish("fleet://digest-changed", json!({ "revision": 1 }));
    b.hub
        .publish("agentic://tool-event", json!({ "sessionId": "s" }));
    b.hub
        .publish("fleet://digest-changed", json!({ "revision": 2 }));

    let events = read_until(&filtered, |seen| seen.len() >= 2).await;
    let names: Vec<&str> = events.iter().map(|event| event.event.as_str()).collect();
    assert_eq!(names, ["fleet://digest-changed", "fleet://digest-changed"]);
    assert_eq!(events[1].payload["revision"], 2);
    // The unfiltered connection still sees everything.
    let all = read_until(&plain, |seen| seen.len() >= 4).await;
    assert_eq!(all.len(), 4);

    // The index-only link took the fleet events only.
    let mut kept = Vec::new();
    for _ in 0..50 {
        let batch = links
            .events("pf-owner", None, None, Duration::from_millis(200))
            .await
            .unwrap();
        kept = batch.events;
        if kept.len() >= 2 {
            break;
        }
    }
    let names: Vec<&str> = kept
        .iter()
        .filter_map(|event| event["event"].as_str())
        .collect();
    assert_eq!(names, ["fleet://digest-changed", "fleet://digest-changed"]);
    links.disconnect_all().await;
    filtered.close().await;
    plain.close().await;
}

/// An old client (no `fleet` on its hello) sees exactly the old frames from
/// a fleet entry; a fleet hello to a host without the fleet layer is answered
/// as an old entry's.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn old_hello_gets_unchanged_frames() {
    let a = node(
        "oh-entry",
        A_KEY,
        &[("oh-client", C_KEY)],
        ConnectionLimits::default(),
    )
    .await;
    #[cfg(feature = "fleet")]
    {
        let links = links_for(&a, &[]);
        let mux = crate::fleet::mux::FleetMux::new(
            Arc::clone(&a.authority) as Arc<dyn MeshAuthority>,
            Arc::clone(&a.hub),
            links,
        );
        let _ = a.backend.mux.set(mux);
    }
    let client = device("oh-client", C_KEY, &[("oh-entry", A_KEY)]);
    let old = dial(&client, "oh-entry", a.port, MeshConnectOptions::default()).await;
    assert!(old.hello().get("fleet").is_none());
    assert!(old.hello().get("events").is_none());

    let first = a
        .hub
        .publish("agentic://text-chunk", json!({ "text": "a" }));
    a.hub
        .publish("agentic://tool-event", json!({ "sessionId": "s" }));
    let events = read_until(&old, |seen| seen.len() >= 2).await;
    assert_eq!(events.len(), 2);
    assert_eq!(events[0].seq, first);
    assert!(events.iter().all(|event| event.origin.is_none()));
    assert!(events.iter().all(|event| event.origin_instance.is_none()));
    assert_eq!(
        events[0].to_wire(),
        json!({
            "seq": first, "event": "agentic://text-chunk", "payload": { "text": "a" },
        })
    );
    old.close().await;

    // A host without a fleet mux answers a fleet hello without `fleet`.
    let b = node(
        "oh-plain",
        B_KEY,
        &[("oh-client", C_KEY)],
        ConnectionLimits::default(),
    )
    .await;
    let client = device("oh-client", C_KEY, &[("oh-plain", B_KEY)]);
    let fleet_hello = dial(
        &client,
        "oh-plain",
        b.port,
        MeshConnectOptions {
            fleet: Some(json!({ "protocol": 1, "cursor": {} })),
            ..MeshConnectOptions::default()
        },
    )
    .await;
    assert!(fleet_hello.hello().get("fleet").is_none());
    b.hub
        .publish("agentic://text-chunk", json!({ "text": "b" }));
    let events = read_until(&fleet_hello, |seen| !seen.is_empty()).await;
    assert!(events[0].origin.is_none());
    // `fleet_events` never runs over OBP.
    let refused = fleet_hello
        .call("fleet_events", json!({ "request": {} }))
        .await
        .unwrap_err();
    assert!(
        refused.message.starts_with("fleet_events_unsupported"),
        "{refused}"
    );
    assert_eq!(refused.data.unwrap()["kind"], "unsupported");
    fleet_hello.close().await;
}

#[cfg(feature = "fleet")]
mod fleet {
    use super::*;
    use crate::fleet::mux::FleetMux;

    struct Fleet {
        a: Node,
        b: Node,
        client: Arc<TestAuthority>,
        links: Arc<PeerLinks>,
    }

    /// Entry `A` with its mux and an index link to owner `B`; client `C`.
    async fn fleet(prefix: &str, entry_limits: ConnectionLimits) -> Fleet {
        let (a_id, b_id, c_id) = (
            format!("{prefix}-entry"),
            format!("{prefix}-owner"),
            format!("{prefix}-client"),
        );
        let b = node(
            &b_id,
            B_KEY,
            &[(&a_id, A_KEY), (&c_id, C_KEY)],
            ConnectionLimits::default(),
        )
        .await;
        let a = node(
            &a_id,
            A_KEY,
            &[(&b_id, B_KEY), (&c_id, C_KEY)],
            entry_limits,
        )
        .await;
        let links = links_for(&a, &[(&b_id, &b)]);
        let mux = FleetMux::new(
            Arc::clone(&a.authority) as Arc<dyn MeshAuthority>,
            Arc::clone(&a.hub),
            Arc::clone(&links),
        );
        assert!(a.backend.mux.set(mux).is_ok());
        links.connect_index(&b_id).await.unwrap();
        let client = device(&c_id, C_KEY, &[(&a_id, A_KEY)]);
        Fleet {
            a,
            b,
            client,
            links,
        }
    }

    impl Fleet {
        fn a_id(&self) -> String {
            self.a.authority.local_device_id().unwrap()
        }

        fn b_id(&self) -> String {
            self.b.authority.local_device_id().unwrap()
        }

        async fn connect(&self, cursor: Value, credit: Option<u64>) -> MeshObpConnection {
            dial(
                &self.client,
                &self.a_id(),
                self.a.port,
                MeshConnectOptions {
                    fleet: Some(json!({ "protocol": 1, "cursor": cursor })),
                    credit_bytes: credit,
                    ..MeshConnectOptions::default()
                },
            )
            .await
        }

        async fn follow_b(&self, connection: &MeshObpConnection) {
            let answer = connection
                .call(
                    "fleet_subscribe",
                    json!({ "request": { "follow": { self.b_id(): { "all": true } } } }),
                )
                .await
                .unwrap();
            assert_eq!(answer["applied"], true);
            // The link widens to the whole stream (a reconnect with its cursor).
            let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
            loop {
                let hello = self.links.hello_of(&self.b_id()).await.unwrap_or_default();
                if hello.get("events").is_none() && !hello.is_null() {
                    break;
                }
                assert!(tokio::time::Instant::now() < deadline, "link never widened");
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        }
    }

    /// Frames of a fleet stream carry their origin, its backend instance and
    /// the origin's own seq; the hello answer names the entry and the payload
    /// is the origin's, unchanged.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn fleet_frames_carry_origin_seq() {
        let fleet = fleet("fo", ConnectionLimits::default()).await;
        let (a_id, b_id) = (fleet.a_id(), fleet.b_id());
        let connection = fleet.connect(json!({}), None).await;
        let answer = &connection.hello()["fleet"];
        assert_eq!(answer["protocol"], 1);
        assert_eq!(answer["deviceId"], a_id.as_str());
        assert_eq!(answer["cursorState"], json!({}));
        fleet.follow_b(&connection).await;

        let b_seq = fleet.b.hub.publish(
            "agentic://text-chunk",
            json!({ "sessionId": "sb", "text": "from b" }),
        );
        let a_seq = fleet
            .a
            .hub
            .publish("agentic://tool-event", json!({ "sessionId": "sa" }));
        let events = read_until(&connection, |seen| named(seen, None).len() >= 2).await;
        let from_b = named(&events, Some(&b_id));
        let from_a = named(&events, Some(&a_id));
        assert_eq!(from_b.len(), 1, "{events:?}");
        assert_eq!(from_a.len(), 1, "{events:?}");
        assert_eq!(from_b[0].seq, b_seq);
        assert_eq!(
            from_b[0].origin_instance.as_deref(),
            Some(fleet.b.server.instance_id())
        );
        assert_eq!(
            from_b[0].payload,
            json!({ "sessionId": "sb", "text": "from b" })
        );
        assert_eq!(from_a[0].seq, a_seq);
        assert_eq!(
            from_a[0].origin_instance.as_deref(),
            Some(fleet.a.server.instance_id())
        );
        // Owner-only events stay with each owner.
        fleet.b.hub.publish("account://login-state", json!({}));
        fleet
            .b
            .hub
            .publish("agentic://tool-event", json!({ "sessionId": "sb" }));
        let more = read_until(&connection, |seen| !named(seen, None).is_empty()).await;
        assert_eq!(more[0].event, "agentic://tool-event");
        connection.close().await;
        fleet.links.disconnect_all().await;
    }

    /// A vector cursor resumes every origin on its own: the entry's ring for
    /// its own events, the link ring for a peer, and the owner's ring through
    /// `fleet_replay` for what the index-only link never took. A cursor of
    /// another instance is dropped for that origin only.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn cursor_resumes_per_origin() {
        let fleet = fleet("cr", ConnectionLimits::default()).await;
        let (a_id, b_id) = (fleet.a_id(), fleet.b_id());
        let first = fleet.connect(json!({}), None).await;
        fleet.follow_b(&first).await;
        fleet
            .a
            .hub
            .publish("agentic://tool-event", json!({ "n": "a1" }));
        fleet
            .b
            .hub
            .publish("agentic://tool-event", json!({ "n": "b1" }));
        let seen = read_until(&first, |seen| named(seen, None).len() >= 2).await;
        let cursor_of = |origin: &str| {
            let event = named(&seen, Some(origin))[0];
            (event.origin_instance.clone().unwrap(), event.seq)
        };
        let (a_instance, a_seq) = cursor_of(&a_id);
        let (b_instance, b_seq) = cursor_of(&b_id);
        first.close().await;

        // While nobody follows B its link goes back to index-only: these
        // events never reach the entry's ring, and a fleet hint moves the
        // link past them.
        let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
        while fleet
            .links
            .hello_of(&b_id)
            .await
            .is_none_or(|hello| hello.get("events").is_none())
        {
            assert!(
                tokio::time::Instant::now() < deadline,
                "link never narrowed"
            );
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        fleet
            .a
            .hub
            .publish("agentic://tool-event", json!({ "n": "a2" }));
        fleet
            .b
            .hub
            .publish("agentic://tool-event", json!({ "n": "b2" }));
        fleet
            .b
            .hub
            .publish("agentic://tool-event", json!({ "n": "b3" }));
        fleet
            .b
            .hub
            .publish("fleet://digest-changed", json!({ "revision": 9 }));
        tokio::time::sleep(Duration::from_millis(300)).await;

        let second = fleet
            .connect(
                json!({
                    a_id.clone(): { "instanceId": a_instance, "seq": a_seq },
                    b_id.clone(): { "instanceId": b_instance, "seq": b_seq },
                }),
                None,
            )
            .await;
        assert_eq!(
            second.hello()["fleet"]["cursorState"],
            json!({ a_id.clone(): "resumed", b_id.clone(): "resumed" })
        );
        fleet.follow_b(&second).await;
        let resumed = read_until(&second, |seen| named(seen, None).len() >= 4).await;
        let label = |event: &&MeshObpEvent| {
            event.payload["n"]
                .as_str()
                .map(str::to_string)
                .unwrap_or_else(|| event.event.clone())
        };
        let a_labels: Vec<String> = named(&resumed, Some(&a_id)).iter().map(label).collect();
        let b_labels: Vec<String> = named(&resumed, Some(&b_id)).iter().map(label).collect();
        assert_eq!(a_labels, ["a2"], "{resumed:?}");
        assert_eq!(
            b_labels,
            ["b2", "b3", "fleet://digest-changed"],
            "{resumed:?}"
        );
        assert!(
            resumed
                .iter()
                .all(|event| event.event != EVENTS_DROPPED_EVENT),
            "{resumed:?}"
        );
        second.close().await;

        // A cursor of an earlier entry instance: that origin only is dropped.
        let third = fleet
            .connect(
                json!({
                    a_id.clone(): { "instanceId": "an-old-instance", "seq": 1 },
                    b_id.clone(): { "instanceId": b_instance, "seq": b_seq },
                }),
                None,
            )
            .await;
        assert_eq!(
            third.hello()["fleet"]["cursorState"],
            json!({ a_id.clone(): "dropped", b_id.clone(): "resumed" })
        );
        let notice = read_until(&third, |seen| !seen.is_empty()).await;
        assert_eq!(notice[0].event, EVENTS_DROPPED_EVENT);
        assert_eq!(notice[0].origin.as_deref(), Some(a_id.as_str()));
        assert_eq!(notice[0].payload["origin"], a_id.as_str());
        assert_eq!(notice[0].payload["reason"], "instance_changed");
        third.close().await;
        fleet.links.disconnect_all().await;
    }

    /// A client that stops acknowledging is skipped forward for the origin
    /// that overran the backlog bound only; the entry's own events, still
    /// within the bound, all arrive.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn slow_client_drops_one_origin() {
        let limits = ConnectionLimits {
            min_credit_bytes: 1024,
            backlog_drop_bytes: 16 * 1024,
            ..ConnectionLimits::default()
        };
        let fleet = fleet("sc", limits).await;
        let (a_id, b_id) = (fleet.a_id(), fleet.b_id());
        let connection = fleet.connect(json!({}), Some(2048)).await;
        fleet.follow_b(&connection).await;

        let big = "x".repeat(4096);
        for index in 0..24 {
            fleet.b.hub.publish(
                "agentic://tool-event",
                json!({ "index": index, "blob": big }),
            );
        }
        // Let the link take B's burst and the pump spend the window.
        let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
        while fleet
            .links
            .position_of(&b_id)
            .await
            .is_none_or(|(_, seq)| seq < 24)
        {
            assert!(
                tokio::time::Instant::now() < deadline,
                "burst never arrived"
            );
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        tokio::time::sleep(Duration::from_millis(300)).await;
        for index in 0..3 {
            fleet
                .a
                .hub
                .publish("agentic://tool-event", json!({ "index": index }));
        }
        tokio::time::sleep(Duration::from_millis(300)).await;

        let events = read_until(&connection, |seen| named(seen, Some(&a_id)).len() >= 3).await;
        let drops: Vec<&MeshObpEvent> = events
            .iter()
            .filter(|event| event.event == EVENTS_DROPPED_EVENT)
            .collect();
        // Only the lagging origin is skipped (once per overrun, so the count
        // depends on how the burst reached the entry), each time to resume
        // after what it skipped; the frames after the last skip are B's
        // newest, contiguous to the end of the burst.
        assert!(!drops.is_empty(), "{events:?}");
        for drop in &drops {
            assert_eq!(drop.origin.as_deref(), Some(b_id.as_str()), "{drop:?}");
            assert_eq!(drop.payload["origin"], b_id.as_str());
            assert_eq!(drop.payload["reason"], "slow_client");
        }
        let resume = drops.last().unwrap().payload["resumeSeq"].as_u64().unwrap();
        assert!(resume <= 25, "{resume}");
        let last_drop = events
            .iter()
            .rposition(|event| event.event == EVENTS_DROPPED_EVENT)
            .unwrap();
        let after: Vec<u64> = events[last_drop + 1..]
            .iter()
            .filter(|event| event.origin.as_deref() == Some(b_id.as_str()))
            .map(|event| event.seq)
            .collect();
        assert_eq!(after, (resume..=24).collect::<Vec<u64>>(), "{events:?}");
        assert!(named(&events, Some(&b_id)).len() < 24);
        let a_indexes: Vec<u64> = named(&events, Some(&a_id))
            .iter()
            .filter_map(|event| event.payload["index"].as_u64())
            .collect();
        assert_eq!(a_indexes, [0, 1, 2]);
        connection.close().await;
        fleet.links.disconnect_all().await;
    }

    /// `GET /obp/mesh/info` as the gateway reads it (the plain opening of a
    /// Link stream, no TLS), and as a device reads it over TLS.
    async fn plain_info(port: u16) -> Value {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let mut stream = tokio::net::TcpStream::connect((Ipv4Addr::LOCALHOST, port))
            .await
            .unwrap();
        stream
            .write_all(
                b"GET /obp/mesh/info HTTP/1.1\r\nHost: obp-info\r\nConnection: close\r\n\r\n",
            )
            .await
            .unwrap();
        let mut answer = Vec::new();
        stream.read_to_end(&mut answer).await.unwrap();
        let text = String::from_utf8(answer).unwrap();
        let (head, body) = text.split_once("\r\n\r\n").unwrap();
        assert!(head.starts_with("HTTP/1.1 200 OK"), "{head}");
        assert!(head.contains("Content-Type: application/json"), "{head}");
        serde_json::from_str(body).unwrap()
    }

    async fn fleet_load_becomes(port: u16, expected: u64) -> Value {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
        loop {
            let info = plain_info(port).await;
            if info["fleetLoad"].as_u64() == Some(expected) {
                return info;
            }
            assert!(
                tokio::time::Instant::now() < deadline,
                "fleetLoad stayed {info}"
            );
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }

    /// `fleetLoad` counts the connections attached as fleet clients (their
    /// hello opened a fleet stream): a plain hello does not count, and a
    /// closed fleet connection gives its unit back. The same answer lists
    /// `fleet_v1`; a host without the fleet layer omits `fleetLoad`.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn mesh_info_counts_fleet_clients() {
        let fleet = fleet("fl", ConnectionLimits::default()).await;
        let info = fleet_load_becomes(fleet.a.port, 0).await;
        assert_eq!(info["deviceId"], fleet.a_id().as_str());
        assert!(info["capabilities"].as_array().unwrap().contains(&json!(
            openbitfun_product_domains::fleet::FLEET_V1_CAPABILITY
        )));

        let first = fleet.connect(json!({}), None).await;
        let second = fleet.connect(json!({}), None).await;
        let plain = dial(
            &fleet.client,
            &fleet.a_id(),
            fleet.a.port,
            MeshConnectOptions::default(),
        )
        .await;
        assert!(plain.hello().get("fleet").is_none_or(Value::is_null));
        fleet_load_becomes(fleet.a.port, 2).await;
        assert_eq!(fleet.a.server.fleet_load(), 2);

        // Over TLS (how a device reads it) the answer is the same.
        let dialer = MeshDialer {
            connector: Arc::new(LoopbackConnector),
            authority: Arc::clone(&fleet.client) as Arc<dyn MeshAuthority>,
        };
        let tls = dialer
            .probe_info(Ipv4Addr::LOCALHOST, fleet.a.port)
            .await
            .unwrap();
        assert_eq!(tls.fleet_load, Some(2));

        first.close().await;
        fleet_load_becomes(fleet.a.port, 1).await;
        plain.close().await;
        second.close().await;
        fleet_load_becomes(fleet.a.port, 0).await;

        // The owner has no fleet mux: no `fleetLoad`, no `fleet_v1`.
        let owner = plain_info(fleet.b.port).await;
        assert!(owner.get("fleetLoad").is_none(), "{owner}");
        assert!(!owner["capabilities"].as_array().unwrap().contains(&json!(
            openbitfun_product_domains::fleet::FLEET_V1_CAPABILITY
        )));
        fleet.links.disconnect_all().await;
    }
}

/// Following and unfollowing a device changes what its link carries; the
/// switch is make-before-break, so a call in flight on the old connection
/// still answers and a call made during the switch never sees
/// `peer_reconnecting`.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn follow_and_unfollow_never_drop_calls_in_flight() {
    let b = node(
        "sw-owner",
        B_KEY,
        &[("sw-entry", A_KEY)],
        ConnectionLimits::default(),
    )
    .await;
    let a = node(
        "sw-entry",
        A_KEY,
        &[("sw-owner", B_KEY)],
        ConnectionLimits::default(),
    )
    .await;
    let links = links_for(&a, &[("sw-owner", &b)]);
    links.connect_index("sw-owner").await.unwrap();

    for (round, follow) in [true, false, true].into_iter().enumerate() {
        let running = {
            let links = Arc::clone(&links);
            tokio::spawn(async move {
                links
                    .call(
                        "sw-owner",
                        "get_config",
                        json!({ "request": { "path": format!("slow-{round}"), "ms": 800 } }),
                    )
                    .await
            })
        };
        tokio::time::sleep(Duration::from_millis(150)).await;
        links.set_followed("sw-owner", follow).await;
        // Calls made while the link switches go through.
        for quick in 0..5 {
            let answer = links
                .call(
                    "sw-owner",
                    "get_config",
                    json!({ "request": { "path": format!("quick-{round}-{quick}"), "ms": 1 } }),
                )
                .await
                .unwrap_or_else(|error| panic!("round {round}: quick call failed: {error}"));
            assert_eq!(answer["echo"], format!("quick-{round}-{quick}"));
            tokio::time::sleep(Duration::from_millis(30)).await;
        }
        let answer = running.await.unwrap().unwrap_or_else(|error| {
            panic!("round {round}: the call in flight was dropped: {error}")
        });
        assert_eq!(answer["echo"], format!("slow-{round}"));
        assert_eq!(
            links.state_of("sw-owner").await.map(|(state, _)| state),
            Some(crate::client::links::LinkState::Connected)
        );
    }

    // The link now carries the whole stream (followed), not only fleet events.
    tokio::time::sleep(Duration::from_millis(200)).await;
    b.hub.publish(
        "agentic://text-chunk",
        json!({ "text": "after the switch" }),
    );
    let mut seen = false;
    for _ in 0..50 {
        let batch = links
            .events("sw-owner", None, None, Duration::from_millis(200))
            .await
            .unwrap();
        if batch
            .events
            .iter()
            .any(|event| event["event"] == "agentic://text-chunk")
        {
            seen = true;
            break;
        }
    }
    assert!(seen, "a followed link carries the whole stream");
}

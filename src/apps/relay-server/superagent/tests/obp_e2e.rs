//! The frontend endpoint: the OBP end-to-end channel handshake (both
//! proofs), then OBP JSON-RPC with the `superagent_*` commands.

use std::sync::Arc;

use base64::Engine as _;
use openbitfun_link::handshake::{self, Claims, Role};
use openbitfun_obp::server::e2e::{
    client_fingerprint, decode_message, derive_keys, encode_message, read_record,
    server_fingerprint, write_record, ClientHello, RecordCipher, ServerHello, MAGIC,
};
use openbitfun_superagent::api::Service;
use openbitfun_superagent::crypto;
use openbitfun_superagent::device::{BoxFuture, DeviceRpc, DeviceSnapshot, RpcError};
use openbitfun_superagent::directory::{Directory, DirectoryDevice, DirectoryError, Identity};
use openbitfun_superagent::engine::{Engine, EngineConfig, SystemClock};
use openbitfun_superagent::model::RelayModel;
use openbitfun_superagent::obp_server::{serve_stream, Frontends, FrontendsLimits};
use openbitfun_superagent::slots::{SlotLimits, Slots};
use openbitfun_superagent::store::Store;
use serde_json::{json, Value};
use tokio::io::AsyncWriteExt;
use x25519_dalek::{PublicKey, StaticSecret};

const ACCOUNT: &str = "email-scratch-obp";

struct NoDevices;

impl DeviceRpc for NoDevices {
    fn devices<'a>(&'a self, _a: &'a str) -> BoxFuture<'a, Result<Vec<DeviceSnapshot>, RpcError>> {
        Box::pin(async { Ok(Vec::new()) })
    }
    fn call<'a>(
        &'a self,
        _a: &'a str,
        _d: &'a str,
        _c: &'a str,
        _v: Value,
    ) -> BoxFuture<'a, Result<Value, RpcError>> {
        Box::pin(async { Err(RpcError::Offline("offline".into())) })
    }
}

struct Keys {
    laptop_public: String,
}

impl Directory for Keys {
    fn register<'a>(
        &'a self,
        _a: &'a str,
        d: &'a str,
        _n: &'a str,
        _k: &'a str,
    ) -> BoxFuture<'a, Result<String, DirectoryError>> {
        Box::pin(async move { Ok(format!("token-{d}")) })
    }
    fn unregister<'a>(
        &'a self,
        _a: &'a str,
        _d: &'a str,
        _t: Option<&'a str>,
    ) -> BoxFuture<'a, Result<(), DirectoryError>> {
        Box::pin(async { Ok(()) })
    }
    fn devices<'a>(
        &'a self,
        _t: &'a str,
    ) -> BoxFuture<'a, Result<Vec<DirectoryDevice>, DirectoryError>> {
        Box::pin(async { Ok(Vec::new()) })
    }
    fn device_key<'a>(
        &'a self,
        _t: &'a str,
        device: &'a str,
    ) -> BoxFuture<'a, Result<(String, Option<String>), DirectoryError>> {
        Box::pin(async move {
            match device {
                "laptop" => Ok((self.laptop_public.clone(), Some("desktop".to_string()))),
                "other-agent" => Ok((self.laptop_public.clone(), Some("cloud_agent".to_string()))),
                _ => Err(DirectoryError::NotFound),
            }
        })
    }
}

struct AnyIdentity;

impl Identity for AnyIdentity {
    fn account_of<'a>(&'a self, token: &'a str) -> BoxFuture<'a, Result<String, DirectoryError>> {
        Box::pin(async move {
            if token == "good" {
                Ok(ACCOUNT.to_string())
            } else {
                Err(DirectoryError::SignedOut)
            }
        })
    }
}

fn b64() -> base64::engine::GeneralPurpose {
    base64::engine::general_purpose::URL_SAFE_NO_PAD
}

struct Client {
    stream: tokio::io::DuplexStream,
    c2s: RecordCipher,
    s2c: RecordCipher,
    next_id: u64,
}

impl Client {
    async fn send(&mut self, method: &str, params: Value) -> u64 {
        self.next_id += 1;
        let text =
            json!({ "jsonrpc": "2.0", "id": self.next_id, "method": method, "params": params })
                .to_string();
        let record = self
            .c2s
            .seal(&encode_message(&axum::extract::ws::Message::Text(
                text.into(),
            )))
            .unwrap();
        write_record(&mut self.stream, &record).await.unwrap();
        self.next_id
    }

    async fn answer(&mut self, id: u64) -> Value {
        loop {
            let record = read_record(&mut self.stream, 1 << 20).await.unwrap();
            let message = decode_message(self.s2c.open(&record).unwrap()).unwrap();
            if let axum::extract::ws::Message::Text(text) = message {
                let value: Value = serde_json::from_str(&text).unwrap();
                if value["id"] == id {
                    return value;
                }
            }
        }
    }

    async fn next_message(&mut self) -> Option<axum::extract::ws::Message> {
        let record = read_record(&mut self.stream, 1 << 20).await.ok()?;
        decode_message(self.s2c.open(&record).ok()?).ok()
    }

    async fn send_message(&mut self, msg: axum::extract::ws::Message) {
        let record = self.c2s.seal(&encode_message(&msg)).unwrap();
        write_record(&mut self.stream, &record).await.unwrap();
    }

    async fn rpc(&mut self, method: &str, params: Value) -> Value {
        let id = self.send(method, params).await;
        self.answer(id).await
    }
}

async fn setup_with_limits(
    frontends_on: bool,
    limits: FrontendsLimits,
) -> (tempfile::TempDir, Arc<Frontends>, [u8; 32], String) {
    let dir = tempfile::tempdir().unwrap();
    let laptop_secret = [5u8; 32];
    let store = Arc::new(Store::open(dir.path(), [1u8; 32]).unwrap());
    let slots = Arc::new(Slots::new(store, SlotLimits::default()));
    let rpc: Arc<dyn DeviceRpc> = Arc::new(NoDevices);
    let engine = Engine::new(
        slots,
        Arc::clone(&rpc),
        Arc::new(RelayModel::new(rpc)),
        Arc::new(SystemClock),
        EngineConfig::default(),
    );
    let directory = Arc::new(Keys {
        laptop_public: crypto::public_key_base64(&laptop_secret),
    });
    let service = Service::new(engine, directory);
    let frontends =
        Frontends::new_with_limits(service, Arc::new(AnyIdentity), frontends_on, limits);
    let slot = frontends.ensure(ACCOUNT).await.unwrap();
    let state = slot.state.lock().await;
    let node_public = crypto::parse_public_key(&crypto::public_key_base64(
        &openbitfun_superagent::api::node_secret(&state.meta).unwrap(),
    ))
    .unwrap();
    let pair = crypto::derive_pair_key(&laptop_secret, &node_public).unwrap();
    let target = state.meta.device_id.clone();
    drop(state);
    (dir, frontends, pair, target)
}

async fn setup(frontends_on: bool) -> (tempfile::TempDir, Arc<Frontends>, [u8; 32], String) {
    setup_with_limits(frontends_on, FrontendsLimits::default()).await
}

async fn open(
    frontends: &Arc<Frontends>,
    pair: [u8; 32],
    device: &str,
    target: &str,
    tamper: bool,
) -> Result<Client, Value> {
    let (mut stream, server) = tokio::io::duplex(1 << 20);
    tokio::spawn(serve_stream(Arc::clone(frontends), server));
    let key = handshake::handshake_key(&pair);
    let eph = StaticSecret::random_from_rng(rand::rngs::OsRng);
    let eph_public = b64().encode(PublicKey::from(&eph).as_bytes());
    let claims = Claims {
        client_device_id: device.into(),
        server_device_id: target.into(),
        cert_fingerprint: client_fingerprint(&eph_public),
        time_ms: openbitfun_obp::now_ms(),
        nonce: handshake::new_nonce(),
    };
    let mut proof = handshake::prove(&key, Role::Client, &claims);
    if tamper {
        proof = handshake::prove(&[9u8; 32], Role::Client, &claims);
    }
    let hello = ClientHello {
        v: 1,
        device: device.into(),
        target: target.into(),
        time: claims.time_ms,
        nonce: claims.nonce.clone(),
        eph: eph_public.clone(),
        proof: proof.clone(),
    };
    stream.write_all(MAGIC).await.unwrap();
    write_record(&mut stream, &serde_json::to_vec(&hello).unwrap())
        .await
        .unwrap();
    let answer: Value =
        serde_json::from_slice(&read_record(&mut stream, 4096).await.unwrap()).unwrap();
    if answer.get("error").is_some() {
        return Err(answer);
    }
    let server: ServerHello = serde_json::from_value(answer).unwrap();
    let server_claims = Claims {
        cert_fingerprint: server_fingerprint(&eph_public, &server.eph),
        ..claims
    };
    assert!(
        handshake::verify(&key, Role::Server, &server_claims, &server.proof),
        "the node proves it is the target"
    );
    let server_eph: [u8; 32] = b64().decode(&server.eph).unwrap().try_into().unwrap();
    let shared = eph.diffie_hellman(&PublicKey::from(server_eph));
    let (c2s, s2c) = derive_keys(&key, shared.as_bytes(), &proof, &server.proof);
    Ok(Client {
        stream,
        c2s: RecordCipher::new(&c2s),
        s2c: RecordCipher::new(&s2c),
        next_id: 0,
    })
}

#[tokio::test]
async fn e2e_handshake_then_superagent_commands() {
    let (_dir, frontends, pair, target) = setup(true).await;
    let mut client = open(&frontends, pair, "laptop", &target, false)
        .await
        .unwrap();
    let before = client
        .rpc(
            "call",
            json!({ "command": "superagent_status", "args": {} }),
        )
        .await;
    assert_eq!(before["error"]["code"], -32002, "hello first");
    let hello = client.rpc("hello", json!({ "protocol": 1 })).await;
    assert_eq!(hello["result"]["hostKind"], "cloud");
    assert_eq!(hello["result"]["deviceId"], target.as_str());
    assert!(hello["result"]["hostCapabilities"]
        .as_array()
        .unwrap()
        .iter()
        .any(|c| c == "superagent_v1"));
    let status = client
        .rpc(
            "call",
            json!({ "command": "superagent_status", "args": { "request": {} } }),
        )
        .await;
    assert_eq!(status["result"]["enabled"], true);
    assert_eq!(status["result"]["holderAvailable"], false);
    let unknown = client
        .rpc("call", json!({ "command": "open_workspace", "args": {} }))
        .await;
    assert_eq!(unknown["error"]["data"]["kind"], "unsupported");
    // A send with no device online parks with the no-holder card; the event
    // reaches the attached frontend.
    let sent = client.rpc("call", json!({ "command": "superagent_send", "args": { "request": { "message": "hi", "clientMessageId": "c1" } } })).await;
    assert!(sent["result"]["conversationId"].is_string(), "{sent}");
}

#[tokio::test]
async fn e2e_refuses_forged_proofs_strangers_agents_and_disabled_frontends() {
    let (_dir, frontends, pair, target) = setup(true).await;
    let forged = open(&frontends, pair, "laptop", &target, true)
        .await
        .err()
        .unwrap();
    assert_eq!(forged["error"], "unauthorized");
    let stranger = open(&frontends, pair, "stranger", &target, false)
        .await
        .err()
        .unwrap();
    assert_eq!(stranger["error"], "not_account_device");
    let agent = open(&frontends, pair, "other-agent", &target, false)
        .await
        .err()
        .unwrap();
    assert_eq!(agent["error"], "not_account_device");
    let wrong = open(
        &frontends,
        pair,
        "laptop",
        "cloud-000000000000000000000000",
        false,
    )
    .await
    .err()
    .unwrap();
    assert_eq!(wrong["error"], "wrong_device");
    // The HTTP surface: off until the fleet wiring ships.
    let (_dir2, off, _, _) = setup(false).await;
    let router = off.router();
    let response = tower_call(router.clone(), "GET", "/agent/health", None).await;
    assert_eq!(response.0, 200);
    assert_eq!(response.1["frontends"], false);
    let ensure = tower_call(router, "POST", "/agent/api/v1/ensure", Some("good")).await;
    assert_eq!(ensure.0, 503);
    assert_eq!(ensure.1["error"], "superagent_unavailable");
    let on = frontends.router();
    let unauthorized = tower_call(on.clone(), "POST", "/agent/api/v1/ensure", Some("bad")).await;
    assert_eq!(unauthorized.0, 401);
    let ensured = tower_call(on, "POST", "/agent/api/v1/ensure", Some("good")).await;
    assert_eq!(ensured.0, 200);
    assert_eq!(ensured.1["deviceId"], target.as_str());
}

async fn tower_call(
    router: axum::Router,
    method: &str,
    path: &str,
    bearer: Option<&str>,
) -> (u16, Value) {
    use tower::ServiceExt;
    let mut request = axum::http::Request::builder().method(method).uri(path);
    if let Some(token) = bearer {
        request = request.header("authorization", format!("Bearer {token}"));
    }
    let response = router
        .oneshot(request.body(axum::body::Body::empty()).unwrap())
        .await
        .unwrap();
    let status = response.status().as_u16();
    let bytes = axum::body::to_bytes(response.into_body(), 1 << 20)
        .await
        .unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

#[tokio::test]
async fn e2e_enforces_connection_caps_and_hello_timeout() {
    use std::time::Duration;
    let (_dir, frontends, pair, target) = setup_with_limits(
        true,
        FrontendsLimits {
            max_connections: 2,
            max_connections_per_account: 1,
            hello_timeout: Duration::from_millis(80),
            ..FrontendsLimits::default()
        },
    )
    .await;

    // 1st connection succeeds; 2nd for the same account is refused by per-account cap.
    let mut c1 = open(&frontends, pair, "laptop", &target, false)
        .await
        .unwrap();
    let _ = c1.rpc("hello", json!({ "protocol": 1 })).await;

    let refused = open(&frontends, pair, "laptop", &target, false)
        .await
        .err()
        .expect("per-account cap must reject 2nd connection");
    assert_eq!(refused["error"], "too_many_connections");

    drop(c1);
    tokio::time::sleep(Duration::from_millis(30)).await;

    // Connection that never sends OBP `hello` is closed after hello_timeout.
    let mut silent = open(&frontends, pair, "laptop", &target, false)
        .await
        .unwrap();
    let closed = tokio::time::timeout(Duration::from_millis(500), silent.next_message())
        .await
        .expect("must close after hello_timeout");
    assert!(
        closed.is_none() || matches!(closed, Some(axum::extract::ws::Message::Close(_))),
        "expected EOF or Close, got {closed:?}"
    );
}

#[tokio::test]
async fn e2e_ping_does_not_touch_slot_and_idle_client_closes() {
    use std::time::Duration;
    let (_dir, frontends, pair, target) = setup_with_limits(
        true,
        FrontendsLimits {
            ping_interval: Duration::from_millis(40),
            idle_timeout: Duration::from_millis(130),
            ..FrontendsLimits::default()
        },
    )
    .await;

    let mut client = open(&frontends, pair, "laptop", &target, false)
        .await
        .unwrap();
    let _ = client.rpc("hello", json!({ "protocol": 1 })).await;
    let slot = frontends.service.engine.slots.resident(ACCOUNT).unwrap();
    let after_hello = slot.last_used_ms();

    // Receive a server Ping and reply Pong: connection stays alive, and
    // slot.last_used_ms() MUST NOT advance on ping.tick() or Pong.
    let msg = tokio::time::timeout(Duration::from_millis(300), client.next_message())
        .await
        .expect("expected Ping")
        .expect("stream open");
    assert!(
        matches!(msg, axum::extract::ws::Message::Ping(_)),
        "{msg:?}"
    );
    tokio::time::sleep(Duration::from_millis(10)).await;
    client
        .send_message(axum::extract::ws::Message::Pong(Vec::new().into()))
        .await;
    tokio::time::sleep(Duration::from_millis(20)).await;
    assert_eq!(
        slot.last_used_ms(),
        after_hello,
        "ping.tick() and Pong must not touch() the slot"
    );

    // Now go silent (stop replying Pong): server must close after idle_timeout.
    let closed = tokio::time::timeout(Duration::from_millis(600), async {
        loop {
            match client.next_message().await {
                None | Some(axum::extract::ws::Message::Close(_)) => break true,
                Some(_) => {}
            }
        }
    })
    .await
    .expect("idle client must be closed");
    assert!(closed);
}

#[tokio::test]
async fn e2e_hello_emits_events_dropped_on_restart_and_unknown_cursor() {
    let (_dir, frontends, pair, target) = setup(true).await;
    let slot = frontends.service.engine.slots.resident(ACCOUNT).unwrap();
    slot.events
        .publish("superagent://card-changed", json!({ "n": 1 }));
    slot.events
        .publish("superagent://card-changed", json!({ "n": 2 }));

    // Case 1: instanceId mismatch (backend restarted) -> backend://events-dropped.
    let mut c1 = open(&frontends, pair, "laptop", &target, false)
        .await
        .unwrap();
    let hello1 = c1
        .rpc(
            "hello",
            json!({ "protocol": 1, "instanceId": "old-instance", "lastSeq": 1 }),
        )
        .await;
    assert_eq!(hello1["result"]["lastSeq"], 2);
    let ev1 = match c1.next_message().await.unwrap() {
        axum::extract::ws::Message::Text(t) => serde_json::from_str::<Value>(&t).unwrap(),
        other => panic!("expected event text, got {other:?}"),
    };
    assert_eq!(ev1["method"], "event");
    assert_eq!(ev1["params"]["event"], openbitfun_obp::EVENTS_DROPPED_EVENT);
    assert_eq!(ev1["params"]["payload"]["reason"], "backend_restarted");
    assert_eq!(ev1["params"]["payload"]["afterSeq"], 1);
    assert_eq!(ev1["params"]["payload"]["resumeSeq"], 3);

    // Case 2: same instanceId but lastSeq > newest -> unknown_cursor.
    let mut c2 = open(&frontends, pair, "laptop", &target, false)
        .await
        .unwrap();
    let _ = c2
        .rpc(
            "hello",
            json!({ "protocol": 1, "instanceId": slot.instance_id, "lastSeq": 99 }),
        )
        .await;
    let ev2 = match c2.next_message().await.unwrap() {
        axum::extract::ws::Message::Text(t) => serde_json::from_str::<Value>(&t).unwrap(),
        other => panic!("expected event text, got {other:?}"),
    };
    assert_eq!(ev2["params"]["event"], openbitfun_obp::EVENTS_DROPPED_EVENT);
    assert_eq!(ev2["params"]["payload"]["reason"], "unknown_cursor");
}

#[tokio::test]
async fn e2e_credit_backpressure_pauses_and_closes_slow_client() {
    use std::time::Duration;
    let (_dir, frontends, pair, target) = setup_with_limits(
        true,
        FrontendsLimits {
            min_credit_bytes: 128,
            default_credit_bytes: 128,
            max_credit_bytes: 1024,
            slow_client_timeout: Duration::from_millis(120),
            ..FrontendsLimits::default()
        },
    )
    .await;

    let mut client = open(&frontends, pair, "laptop", &target, false)
        .await
        .unwrap();
    let hello = client
        .rpc(
            "hello",
            json!({ "protocol": 1, "ack": true, "creditBytes": 128 }),
        )
        .await;
    assert_eq!(hello["result"]["creditBytes"], 128);

    // Publish an event larger than the 128-byte credit window and never ack it.
    let slot = frontends.service.engine.slots.resident(ACCOUNT).unwrap();
    let big = "x".repeat(200);
    slot.events
        .publish("superagent://turn-delta", json!({ "delta": big }));
    slot.events
        .publish("superagent://turn-delta", json!({ "delta": "second" }));

    // Client receives the first event, then must receive a slow_client Close
    // after slow_client_timeout because it never sent `ack`.
    let got_close = tokio::time::timeout(Duration::from_millis(600), async {
        loop {
            match client.next_message().await {
                Some(axum::extract::ws::Message::Close(Some(frame))) => {
                    assert_eq!(frame.code, 4008);
                    break true;
                }
                None => break true,
                Some(_) => {}
            }
        }
    })
    .await
    .expect("slow client must be closed when credit stays exhausted");
    assert!(got_close);
}

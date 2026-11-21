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
use openbitfun_superagent::obp_server::{serve_stream, Frontends};
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

    async fn rpc(&mut self, method: &str, params: Value) -> Value {
        let id = self.send(method, params).await;
        self.answer(id).await
    }
}

async fn setup(frontends_on: bool) -> (tempfile::TempDir, Arc<Frontends>, [u8; 32], String) {
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
    let frontends = Frontends::new(service, Arc::new(AnyIdentity), frontends_on);
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

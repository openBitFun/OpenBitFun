//! The cloud node connector against an in-process fake cloud node: the
//! `obp-e2e-v1` handshake and records over loopback TCP (standing in for the
//! `wss://<domain>/agent/obp` WebSocket bridge), then OBP inside.

use std::net::{Ipv4Addr, SocketAddr};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::extract::ws::Message as ServerMessage;
use base64::Engine as _;
use openbitfun_link::handshake::{self, Claims, Role};
use serde_json::{json, Value};
use tokio::io::AsyncReadExt;
use x25519_dalek::{PublicKey, StaticSecret};

use super::*;
use crate::authority::PairKeyFuture;
use crate::server::e2e::{decode_message, encode_message};

pub(crate) const CLOUD_ID: &str = "cloud-3f2a9c";

/// A device of the account whose pair key with every device is `key`.
pub(crate) struct FixedKey {
    pub(crate) device_id: String,
    pub(crate) key: [u8; 32],
}

impl MeshAuthority for FixedKey {
    fn local_device_id(&self) -> Option<String> {
        Some(self.device_id.clone())
    }

    fn pair_key<'a>(&'a self, _device_id: &'a str) -> PairKeyFuture<'a> {
        let key = self.key;
        Box::pin(async move { Ok(key) })
    }
}

/// Plain TCP to the fake node.
pub(crate) struct TcpOpener(pub(crate) SocketAddr);

impl CloudStreamOpener for TcpOpener {
    fn open(&self) -> MeshOpenFuture<'_> {
        let addr = self.0;
        Box::pin(async move {
            let stream = tokio::net::TcpStream::connect(addr)
                .await
                .map_err(|error| format!("{CLOUD_UNREACHABLE}: {error}"))?;
            Ok(Box::new(stream) as Box<dyn MeshIo>)
        })
    }
}

/// What the fake node saw.
#[derive(Default)]
pub(crate) struct NodeLog {
    pub(crate) calls: Vec<(String, Value)>,
    pub(crate) clients: Vec<String>,
    pub(crate) pongs: usize,
}

/// The account's cloud node as the superagent serves it (`hostKind:
/// "cloud"`, `superagent_*` only), on a loopback port.
pub(crate) struct FakeCloudNode {
    pub(crate) addr: SocketAddr,
    pub(crate) instance: String,
    pub(crate) log: Arc<Mutex<NodeLog>>,
}

fn b64() -> base64::engine::GeneralPurpose {
    base64::engine::general_purpose::URL_SAFE_NO_PAD
}

/// Starts a fake node holding pair key `key`; `check_clients: false` makes
/// it skip the client proof (an impostor that answers with its own key).
pub(crate) async fn fake_cloud_node(key: [u8; 32], check_clients: bool) -> FakeCloudNode {
    let listener = tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .await
        .unwrap();
    let addr = listener.local_addr().unwrap();
    let log = Arc::new(Mutex::new(NodeLog::default()));
    let instance = "cloud-instance-1".to_string();
    {
        let log = Arc::clone(&log);
        let instance = instance.clone();
        tokio::spawn(async move {
            while let Ok((stream, _)) = listener.accept().await {
                let log = Arc::clone(&log);
                let instance = instance.clone();
                tokio::spawn(serve(stream, key, check_clients, log, instance));
            }
        });
    }
    FakeCloudNode {
        addr,
        instance,
        log,
    }
}

async fn serve(
    mut stream: tokio::net::TcpStream,
    key: [u8; 32],
    check_clients: bool,
    log: Arc<Mutex<NodeLog>>,
    instance: String,
) {
    let mut magic = [0u8; 8];
    if stream.read_exact(&mut magic).await.is_err() || &magic != MAGIC {
        return;
    }
    let Ok(hello) = read_record(&mut stream, 4096).await else {
        return;
    };
    let hello: ClientHello = serde_json::from_slice(&hello).unwrap();
    let key = handshake::handshake_key(&key);
    let claims = Claims {
        client_device_id: hello.device.clone(),
        server_device_id: hello.target.clone(),
        cert_fingerprint: client_fingerprint(&hello.eph),
        time_ms: hello.time,
        nonce: hello.nonce.clone(),
    };
    if check_clients && !handshake::verify(&key, Role::Client, &claims, &hello.proof) {
        let refusal =
            json!({"error": "unauthorized", "message": "the account-device proof is invalid"});
        let _ = write_record(&mut stream, refusal.to_string().as_bytes()).await;
        return;
    }
    log.lock().unwrap().clients.push(hello.device.clone());
    let secret = StaticSecret::random_from_rng(rand::rngs::OsRng);
    let server_eph = b64().encode(PublicKey::from(&secret).as_bytes());
    let client_eph: [u8; 32] = b64().decode(&hello.eph).unwrap().try_into().unwrap();
    let shared = secret.diffie_hellman(&PublicKey::from(client_eph));
    let server_claims = Claims {
        cert_fingerprint: server_fingerprint(&hello.eph, &server_eph),
        ..claims
    };
    let proof = handshake::prove(&key, Role::Server, &server_claims);
    let answer = ServerHello {
        v: VERSION,
        eph: server_eph,
        proof: proof.clone(),
        protocol: crate::OBP_PROTOCOL_VERSION,
        capabilities: vec!["obp_v1".into(), "resume".into(), "superagent_v1".into()],
    };
    write_record(&mut stream, &serde_json::to_vec(&answer).unwrap())
        .await
        .unwrap();
    let (c2s, s2c) = derive_keys(&key, shared.as_bytes(), &hello.proof, &proof);
    let mut inbound = RecordCipher::new(&c2s);
    let mut outbound = RecordCipher::new(&s2c);
    let target = hello.target.clone();
    loop {
        let Ok(record) = read_record(&mut stream, RECORD_MAX).await else {
            return;
        };
        let Ok(message) = inbound.open(&record).and_then(decode_message) else {
            return;
        };
        let text = match message {
            ServerMessage::Text(text) => text.to_string(),
            ServerMessage::Pong(_) => {
                log.lock().unwrap().pongs += 1;
                continue;
            }
            ServerMessage::Close(_) => return,
            _ => continue,
        };
        let frame: Value = serde_json::from_str(&text).unwrap();
        let id = frame["id"].clone();
        let mut replies = Vec::new();
        match frame["method"].as_str().unwrap_or_default() {
            "hello" => {
                replies.push(json!({"jsonrpc": "2.0", "id": id, "result": {
                    "protocol": 1,
                    "scope": "account-device",
                    "capabilities": ["obp_v1", "resume", "superagent_v1"],
                    "backend": {"version": "0.9.0-cloud", "platform": "cloud", "instanceId": instance},
                    "lastSeq": 1,
                    "hostCapabilities": ["superagent_v1"],
                    "hostKind": "cloud",
                    "deviceId": target,
                }}));
                replies.push(json!({"jsonrpc": "2.0", "method": "event", "params": {
                    "seq": 1, "event": "superagent://card-changed", "payload": {"jobId": "j1"}
                }}));
            }
            "call" => {
                let command = frame["params"]["command"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string();
                let args = frame["params"]["args"].clone();
                log.lock().unwrap().calls.push((command.clone(), args));
                replies.push(match command.as_str() {
                    "superagent_status" => json!({"jsonrpc": "2.0", "id": id, "result": {
                        "enabled": true, "deviceId": target
                    }}),
                    other => json!({"jsonrpc": "2.0", "id": id, "error": {
                        "code": -32000,
                        "message": format!("{}: command '{other}' is not served by the cloud node", crate::UNSUPPORTED_IN_NATIVE_HOST),
                        "data": {"kind": "unsupported"}
                    }}),
                });
            }
            _ => {}
        }
        let mut messages: Vec<ServerMessage> = replies
            .into_iter()
            .map(|reply| ServerMessage::Text(reply.to_string().into()))
            .collect();
        if frame["method"] == "hello" {
            messages.push(ServerMessage::Ping(b"keepalive".to_vec().into()));
        }
        for message in messages {
            let sealed = outbound.seal(&encode_message(&message)).unwrap();
            if write_record(&mut stream, &sealed).await.is_err() {
                return;
            }
        }
    }
}

pub(crate) fn connector(
    node: &FakeCloudNode,
    device_id: &str,
    key: [u8; 32],
) -> Arc<CloudNodeConnector> {
    CloudNodeConnector::new(
        Arc::new(TcpOpener(node.addr)),
        Arc::new(FixedKey {
            device_id: device_id.to_string(),
            key,
        }),
        "openbitfun-test/1".to_string(),
    )
}

#[tokio::test]
async fn the_connector_reaches_the_cloud_node_over_the_end_to_end_channel() {
    let node = fake_cloud_node([7u8; 32], true).await;
    let connection = connector(&node, "desk-1", [7u8; 32])
        .connect(CLOUD_ID, MeshConnectOptions::default())
        .await
        .unwrap();
    assert_eq!(connection.device_id(), CLOUD_ID);
    assert_eq!(connection.hello()["hostKind"], "cloud");
    assert_eq!(
        connection.instance_id().as_deref(),
        Some(node.instance.as_str())
    );
    let status = connection
        .call("superagent_status", json!({"request": {}}))
        .await
        .unwrap();
    assert_eq!(status, json!({"enabled": true, "deviceId": CLOUD_ID}));
    let refused = connection.call("get_config", json!({})).await.unwrap_err();
    assert!(
        refused
            .message
            .starts_with(crate::UNSUPPORTED_IN_NATIVE_HOST),
        "{refused}"
    );
    let event = tokio::time::timeout(Duration::from_secs(5), connection.next_event())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(event.event, "superagent://card-changed");
    assert_eq!(event.seq, 1);
    // The node's ping was answered inside the channel.
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    while node.log.lock().unwrap().pongs == 0 && tokio::time::Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    let log = node.log.lock().unwrap();
    assert_eq!(log.pongs, 1);
    assert_eq!(log.clients, ["desk-1"]);
    assert_eq!(log.calls[0].0, "superagent_status");
}

#[tokio::test]
async fn a_device_outside_the_account_and_an_impostor_node_are_refused() {
    let node = fake_cloud_node([7u8; 32], true).await;
    let error = connector(&node, "stranger", [8u8; 32])
        .connect(CLOUD_ID, MeshConnectOptions::default())
        .await
        .err()
        .unwrap();
    assert!(error.starts_with("unauthorized:"), "{error}");
    // A server that does not hold the node's key cannot prove it is the node.
    let impostor = fake_cloud_node([1u8; 32], false).await;
    let error = connector(&impostor, "desk-1", [7u8; 32])
        .connect(CLOUD_ID, MeshConnectOptions::default())
        .await
        .err()
        .unwrap();
    assert!(error.starts_with("mesh_impostor:"), "{error}");
    let error = connector(&node, "desk-1", [7u8; 32])
        .connect("desk-2", MeshConnectOptions::default())
        .await
        .err()
        .unwrap();
    assert!(error.contains("not a cloud node id"), "{error}");
}

/// Records what the device connector was asked for.
struct DeviceDialer(Arc<Mutex<Vec<String>>>);

impl PeerConnector for DeviceDialer {
    fn connect(&self, device_id: String, _options: MeshConnectOptions) -> ConnectFuture {
        self.0.lock().unwrap().push(device_id.clone());
        Box::pin(async move { Err(format!("mesh_unreachable: device {device_id} is asleep")) })
    }

    fn route(&self, _device_id: &str) -> Option<(String, Option<f64>)> {
        Some(("p2p".into(), Some(1.0)))
    }
}

#[tokio::test]
async fn cloud_ids_go_to_the_cloud_dialer_and_devices_to_link() {
    let dialed = Arc::new(Mutex::new(Vec::new()));
    let without = WithCloudNode::new(Arc::new(DeviceDialer(Arc::clone(&dialed))), None);
    assert!(!without.dials_cloud_node());
    let error = without
        .connect(CLOUD_ID.into(), MeshConnectOptions::default())
        .await
        .err()
        .unwrap();
    assert!(error.starts_with(CLOUD_CONNECTOR_UNAVAILABLE), "{error}");
    let error = without
        .connect("desk-1".into(), MeshConnectOptions::default())
        .await
        .err()
        .unwrap();
    assert!(error.starts_with("mesh_unreachable"), "{error}");
    assert_eq!(*dialed.lock().unwrap(), ["desk-1"]);
    assert_eq!(without.route(CLOUD_ID), None);
    assert!(without.route("desk-1").is_some());

    let node = fake_cloud_node([7u8; 32], true).await;
    let with = WithCloudNode::new(
        Arc::new(DeviceDialer(Arc::clone(&dialed))),
        Some(connector(&node, "desk-1", [7u8; 32])),
    );
    assert!(with.dials_cloud_node());
    let connection = with
        .connect(CLOUD_ID.into(), MeshConnectOptions::default())
        .await
        .unwrap();
    assert_eq!(connection.hello()["hostKind"], "cloud");
    assert_eq!(
        dialed.lock().unwrap().len(),
        1,
        "the device dialer is not asked"
    );
}

#[test]
fn the_endpoint_follows_the_account_server_origin() {
    assert_eq!(
        cloud_node_url("https://super.openbitfun.com/directory/").as_deref(),
        Some(DEFAULT_CLOUD_NODE_URL)
    );
    assert_eq!(
        cloud_node_url("http://127.0.0.1:8080").as_deref(),
        Some("ws://127.0.0.1:8080/agent/obp")
    );
    assert_eq!(cloud_node_url("ftp://x"), None);
    assert_eq!(cloud_node_url("https://"), None);
    assert!(is_cloud_device_id(CLOUD_ID));
    assert!(!is_cloud_device_id("desk-1"));
    assert!(!is_cloud_device_id("cloud-"));
}

#[test]
fn records_use_the_server_channel_layout() {
    let cases = [
        (
            Message::Text("{\"a\":1}".into()),
            ServerMessage::Text("{\"a\":1}".into()),
        ),
        (
            Message::Binary(vec![1, 2, 3].into()),
            ServerMessage::Binary(vec![1, 2, 3].into()),
        ),
        (
            Message::Ping(vec![9].into()),
            ServerMessage::Ping(vec![9].into()),
        ),
        (
            Message::Pong(vec![9].into()),
            ServerMessage::Pong(vec![9].into()),
        ),
        (Message::Close(None), ServerMessage::Close(None)),
    ];
    for (client, server) in cases {
        let encoded = encode(&client).unwrap();
        assert_eq!(encoded, encode_message(&server));
        assert_eq!(decode(encoded).unwrap(), client);
    }
    let close = Message::Close(Some(CloseFrame {
        code: CloseCode::Normal,
        reason: "bye".into(),
    }));
    assert_eq!(decode(encode(&close).unwrap()).unwrap(), close);
    assert!(decode(vec![42]).is_err());
}

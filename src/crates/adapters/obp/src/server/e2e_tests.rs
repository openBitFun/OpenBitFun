//! The end-to-end channel (`obp-e2e-v1`) of browser controllers that reach a
//! device through the server gateway: a reference client in Rust drives the
//! real mesh listener over loopback TCP (standing in for the gateway pipe).

use std::sync::{Arc, Mutex};

use base64::Engine;
use openbitfun_link::handshake::{self, Claims, Role};
use serde_json::{json, Value};
use tokio::io::{AsyncRead, AsyncWrite, AsyncWriteExt, ReadBuf};
use x25519_dalek::{PublicKey, StaticSecret};

use super::e2e::{
    client_fingerprint, decode_message, derive_keys, encode_message, read_record,
    server_fingerprint, write_record, ClientHello, RecordCipher, ServerHello, MAGIC, RECORD_MAX,
};
use super::mesh_tests::{device, device_crypto, server, EchoBackend, ALICE, BOB, MALLORY};
use axum::extract::ws::Message;

fn b64() -> base64::engine::GeneralPurpose {
    base64::engine::general_purpose::URL_SAFE_NO_PAD
}

/// A TCP stream that records every byte it wrote (what the gateway pipes).
struct Recorded {
    inner: tokio::net::TcpStream,
    written: Arc<Mutex<Vec<u8>>>,
    read: Arc<Mutex<Vec<u8>>>,
}

impl AsyncRead for Recorded {
    fn poll_read(
        self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        let this = self.get_mut();
        let before = buf.filled().len();
        let polled = std::pin::Pin::new(&mut this.inner).poll_read(cx, buf);
        if polled.is_ready() {
            this.read
                .lock()
                .unwrap()
                .extend_from_slice(&buf.filled()[before..]);
        }
        polled
    }
}

impl AsyncWrite for Recorded {
    fn poll_write(
        self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
        buf: &[u8],
    ) -> std::task::Poll<std::io::Result<usize>> {
        let this = self.get_mut();
        let polled = std::pin::Pin::new(&mut this.inner).poll_write(cx, buf);
        if let std::task::Poll::Ready(Ok(written)) = &polled {
            this.written
                .lock()
                .unwrap()
                .extend_from_slice(&buf[..*written]);
        }
        polled
    }

    fn poll_flush(
        self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        std::pin::Pin::new(&mut self.get_mut().inner).poll_flush(cx)
    }

    fn poll_shutdown(
        self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        std::pin::Pin::new(&mut self.get_mut().inner).poll_shutdown(cx)
    }
}

/// One end-to-end client connection, after the channel handshake.
struct E2eClient {
    stream: Recorded,
    send: RecordCipher,
    recv: RecordCipher,
    next_id: u64,
    hello: ServerHello,
    /// Frames that arrived while a call waited for its answer.
    backlog: std::collections::VecDeque<Value>,
}

/// What a channel handshake attempt changes (refusal tests).
#[derive(Default, Clone)]
struct Tamper {
    wrong_target: bool,
    swap_eph_after_proof: bool,
    nonce: Option<String>,
}

async fn open_channel(
    addr: std::net::SocketAddr,
    client: &str,
    client_secret: [u8; 32],
    target: &str,
    target_public: [u8; 32],
    tamper: Tamper,
) -> Result<E2eClient, Value> {
    let tcp = tokio::net::TcpStream::connect(addr).await.unwrap();
    let mut stream = Recorded {
        inner: tcp,
        written: Arc::default(),
        read: Arc::default(),
    };
    stream.write_all(MAGIC).await.unwrap();
    let ephemeral = StaticSecret::random_from_rng(rand::rngs::OsRng);
    let eph = b64().encode(PublicKey::from(&ephemeral).as_bytes());
    let pair = device_crypto::derive_message_key(&client_secret, &target_public).unwrap();
    let key = handshake::handshake_key(&pair);
    let nonce = tamper.nonce.clone().unwrap_or_else(handshake::new_nonce);
    let time = crate::now_ms();
    let claims = Claims {
        client_device_id: client.to_string(),
        server_device_id: target.to_string(),
        cert_fingerprint: client_fingerprint(&eph),
        time_ms: time,
        nonce: nonce.clone(),
    };
    let proof = handshake::prove(&key, Role::Client, &claims);
    let sent_eph = if tamper.swap_eph_after_proof {
        b64().encode(PublicKey::from(&StaticSecret::random_from_rng(rand::rngs::OsRng)).as_bytes())
    } else {
        eph.clone()
    };
    let hello = ClientHello {
        v: 1,
        device: client.to_string(),
        target: if tamper.wrong_target {
            "someone-else".to_string()
        } else {
            target.to_string()
        },
        time,
        nonce,
        eph: sent_eph,
        proof: proof.clone(),
    };
    write_record(&mut stream, &serde_json::to_vec(&hello).unwrap())
        .await
        .unwrap();
    let answer: Value =
        serde_json::from_slice(&read_record(&mut stream, 4096).await.unwrap()).unwrap();
    if answer.get("error").is_some() {
        return Err(answer);
    }
    let server_hello: ServerHello = serde_json::from_value(answer).unwrap();
    let server_claims = Claims {
        cert_fingerprint: server_fingerprint(&eph, &server_hello.eph),
        ..claims
    };
    assert!(
        handshake::verify(&key, Role::Server, &server_claims, &server_hello.proof),
        "the server proof must verify"
    );
    let server_eph: [u8; 32] = b64().decode(&server_hello.eph).unwrap().try_into().unwrap();
    let shared = ephemeral.diffie_hellman(&PublicKey::from(server_eph));
    let (c2s, s2c) = derive_keys(&key, shared.as_bytes(), &proof, &server_hello.proof);
    Ok(E2eClient {
        stream,
        send: RecordCipher::new(&c2s),
        recv: RecordCipher::new(&s2c),
        next_id: 1,
        hello: server_hello,
        backlog: Default::default(),
    })
}

impl E2eClient {
    async fn send(&mut self, message: Message) {
        let record = self.send.seal(&encode_message(&message)).unwrap();
        write_record(&mut self.stream, &record).await.unwrap();
    }

    async fn receive(&mut self) -> Message {
        let record = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            read_record(&mut self.stream, RECORD_MAX),
        )
        .await
        .expect("a record within 5 s")
        .unwrap();
        decode_message(self.recv.open(&record).unwrap()).unwrap()
    }

    async fn frame(&mut self) -> Value {
        if let Some(frame) = self.backlog.pop_front() {
            return frame;
        }
        loop {
            match self.receive().await {
                Message::Text(text) => return serde_json::from_str(text.as_str()).unwrap(),
                Message::Ping(payload) => self.send(Message::Pong(payload)).await,
                _ => {}
            }
        }
    }

    async fn rpc(&mut self, method: &str, params: Value) -> Value {
        let id = self.next_id;
        self.next_id += 1;
        let frame = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
        self.send(Message::Text(frame.to_string().into())).await;
        let mut held = Vec::new();
        loop {
            let frame = self.frame().await;
            if frame["id"] == json!(id) {
                self.backlog.extend(held);
                return frame;
            }
            held.push(frame);
        }
    }
}

#[tokio::test]
async fn browser_controllers_call_and_stream_over_the_end_to_end_channel() {
    let bob = device("e2e-desk", BOB, &[("e2e-browser", ALICE)]);
    let (server, _hub, _dir) = server(bob).await;
    let addr = server.mesh_addr().unwrap();
    let mut client = open_channel(
        addr,
        "e2e-browser",
        ALICE,
        "e2e-desk",
        device_crypto::public_key(&BOB),
        Tamper::default(),
    )
    .await
    .unwrap();
    assert!(client.hello.capabilities.contains(&"mesh_v1".to_string()));

    let id = 0;
    let hello = json!({ "jsonrpc": "2.0", "id": id, "method": "hello",
        "params": { "protocol": 1, "client": "e2e-test", "ack": true } });
    client.send(Message::Text(hello.to_string().into())).await;
    let answer = client.frame().await;
    assert_eq!(answer["result"]["scope"], "account-device", "{answer}");
    assert!(answer["result"]["backend"].get("dataDir").is_none());
    assert_eq!(server.status().account_device_connections, 1);

    let echoed = client
        .rpc(
            "call",
            json!({ "command": "open_workspace", "args": { "request": { "path": "/secret-path" } } }),
        )
        .await;
    assert_eq!(echoed["result"]["args"]["request"]["path"], "/secret-path");
    // The registry allowlist holds: controller-local commands stay with the owner.
    let refused = client
        .rpc("call", json!({ "command": "mesh_status", "args": {} }))
        .await;
    assert_eq!(refused["error"]["code"], -32003, "{refused}");

    client
        .rpc(
            "call",
            json!({ "command": "page_list", "args": { "count": 3 } }),
        )
        .await;
    let mut names = Vec::new();
    while names.len() < 4 {
        let frame = client.frame().await;
        if frame["method"] == "event" {
            names.push(frame["params"]["event"].as_str().unwrap().to_string());
        }
    }
    assert!(names.iter().all(|name| !name.starts_with("account://")));
    assert!(names.iter().all(|name| !name.starts_with("mesh://")));
    assert_eq!(names.last().unwrap(), "agentic://tool-event");

    // The pipe carried only ciphertext: neither direction shows the content.
    let written = client.stream.written.lock().unwrap().clone();
    let read = client.stream.read.lock().unwrap().clone();
    for needle in [&b"open_workspace"[..], b"secret-path", b"hello", b"jsonrpc"] {
        assert!(!written.windows(needle.len()).any(|window| window == needle));
        assert!(!read.windows(needle.len()).any(|window| window == needle));
    }

    client.send(Message::Close(None)).await;
    drop(client);
    server.stop_mesh();
}

#[tokio::test]
async fn the_end_to_end_channel_refuses_strangers_tampering_and_replays() {
    let bob = device("e2e-desk-2", BOB, &[("e2e-browser-2", ALICE)]);
    let (server, _hub, _dir) = server(bob).await;
    let addr = server.mesh_addr().unwrap();
    let bob_public = device_crypto::public_key(&BOB);

    // A key outside the account directory.
    let refused = open_channel(
        addr,
        "e2e-stranger",
        MALLORY,
        "e2e-desk-2",
        bob_public,
        Tamper::default(),
    )
    .await
    .err()
    .unwrap();
    assert_eq!(refused["error"], "not_account_device", "{refused}");

    // The browser's id without its key.
    let refused = open_channel(
        addr,
        "e2e-browser-2",
        MALLORY,
        "e2e-desk-2",
        bob_public,
        Tamper::default(),
    )
    .await
    .err()
    .unwrap();
    assert_eq!(refused["error"], "unauthorized", "{refused}");

    // An ephemeral key swapped after the proof (a pipe in the middle).
    let refused = open_channel(
        addr,
        "e2e-browser-2",
        ALICE,
        "e2e-desk-2",
        bob_public,
        Tamper {
            swap_eph_after_proof: true,
            ..Tamper::default()
        },
    )
    .await
    .err()
    .unwrap();
    assert_eq!(refused["error"], "unauthorized", "{refused}");

    // Another device's address.
    let refused = open_channel(
        addr,
        "e2e-browser-2",
        ALICE,
        "e2e-desk-2",
        bob_public,
        Tamper {
            wrong_target: true,
            ..Tamper::default()
        },
    )
    .await
    .err()
    .unwrap();
    assert_eq!(refused["error"], "wrong_device", "{refused}");

    // A replayed hello (same nonce) is refused after the first one.
    let nonce = handshake::new_nonce();
    let replay = Tamper {
        nonce: Some(nonce),
        ..Tamper::default()
    };
    assert!(open_channel(
        addr,
        "e2e-browser-2",
        ALICE,
        "e2e-desk-2",
        bob_public,
        replay.clone()
    )
    .await
    .is_ok());
    let refused = open_channel(
        addr,
        "e2e-browser-2",
        ALICE,
        "e2e-desk-2",
        bob_public,
        replay,
    )
    .await
    .err()
    .unwrap();
    assert_eq!(refused["error"], "unauthorized", "{refused}");
    server.stop_mesh();
}

#[test]
fn records_are_bound_to_their_direction_and_order() {
    let (c2s, s2c) = derive_keys(&[1; 32], &[2; 32], "client-proof", "server-proof");
    assert_ne!(c2s, s2c);
    let mut sender = RecordCipher::new(&c2s);
    let first = sender
        .seal(&encode_message(&Message::Text("one".into())))
        .unwrap();
    let second = sender
        .seal(&encode_message(&Message::Text("two".into())))
        .unwrap();
    // The other direction's key cannot open it.
    assert!(RecordCipher::new(&s2c).open(&first).is_err());
    // Out of order (a dropped or replayed record) fails authentication.
    assert!(RecordCipher::new(&c2s).open(&second).is_err());
    let mut receiver = RecordCipher::new(&c2s);
    assert!(matches!(
        decode_message(receiver.open(&first).unwrap()).unwrap(),
        Message::Text(text) if text.as_str() == "one"
    ));
    // Different proofs (another handshake) give other keys.
    assert_ne!(
        derive_keys(&[1; 32], &[2; 32], "client-proof", "other").0,
        c2s
    );
}

/// The browser's directory entry, read from a file the page module writes
/// (the interop test below).
struct FileAuthority {
    device_id: String,
    secret: [u8; 32],
    browser_file: std::path::PathBuf,
}

impl crate::MeshAuthority for FileAuthority {
    fn local_device_id(&self) -> Option<String> {
        Some(self.device_id.clone())
    }

    fn pair_key<'a>(&'a self, device_id: &'a str) -> crate::PairKeyFuture<'a> {
        Box::pin(async move {
            let browser: Value = serde_json::from_slice(
                &std::fs::read(&self.browser_file).map_err(|error| error.to_string())?,
            )
            .map_err(|error| error.to_string())?;
            if browser["deviceId"] != device_id {
                return Err(format!("device {device_id} is not in this account"));
            }
            let public: [u8; 32] = base64::engine::general_purpose::STANDARD
                .decode(browser["publicKey"].as_str().unwrap_or_default())
                .map_err(|error| error.to_string())?
                .try_into()
                .map_err(|_| "bad key length".to_string())?;
            device_crypto::derive_message_key(&self.secret, &public)
        })
    }
}

/// Interop with the page-realm channel in `src/nsh-ui/host.js` (run by
/// `node /tmp/.../interop.mjs`): a WebSocket stands in for the gateway pipe.
///
/// ```text
/// E2E_INTEROP_DIR=/tmp/x cargo test -p openbitfun-desktop --lib e2e_interop -- --ignored --nocapture
/// ```
#[tokio::test]
#[ignore]
async fn e2e_interop_with_the_page_module() {
    use axum::extract::ws::{Message as AxumMessage, WebSocketUpgrade};
    use futures::{SinkExt, StreamExt};
    use tokio::io::AsyncReadExt;

    let dir = std::path::PathBuf::from(std::env::var("E2E_INTEROP_DIR").expect("E2E_INTEROP_DIR"));
    let state = tempfile::tempdir().unwrap();
    let hub = crate::events::EventHub::new(256);
    let mut options = super::ObpServerOptions::new(state.path().join("obp"));
    options.loopback_port = 0;
    let server = super::ObpServer::new(
        Arc::new(EchoBackend {
            hub: Arc::clone(&hub),
        }),
        options,
    )
    .unwrap();
    let mesh = server
        .start_mesh(Arc::new(FileAuthority {
            device_id: "e2e-interop-desk".into(),
            secret: BOB,
            browser_file: dir.join("browser.json"),
        }))
        .await
        .unwrap();
    let app = axum::Router::new().route(
        "/obp/{device}",
        axum::routing::get(move |upgrade: WebSocketUpgrade| async move {
            upgrade.on_upgrade(move |socket| async move {
                let tcp = tokio::net::TcpStream::connect(mesh).await.unwrap();
                let (mut reader, mut writer) = tcp.into_split();
                let (mut tx, mut rx) = socket.split();
                let mut buffer = vec![0u8; 65536];
                loop {
                    tokio::select! {
                        message = rx.next() => match message {
                            Some(Ok(AxumMessage::Binary(bytes))) => {
                                if writer.write_all(&bytes).await.is_err() { break; }
                            }
                            Some(Ok(AxumMessage::Close(_))) | None | Some(Err(_)) => break,
                            _ => {}
                        },
                        read = reader.read(&mut buffer) => match read {
                            Ok(0) | Err(_) => break,
                            Ok(count) => {
                                if tx.send(AxumMessage::Binary(buffer[..count].to_vec().into())).await.is_err() { break; }
                            }
                        },
                    }
                }
            })
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    std::fs::write(
        dir.join("desk.json"),
        json!({
            "port": port,
            "deviceId": "e2e-interop-desk",
            "publicKey": base64::engine::general_purpose::STANDARD.encode(device_crypto::public_key(&BOB)),
        })
        .to_string(),
    )
    .unwrap();
    eprintln!("interop server on {port}");
    for _ in 0..1200 {
        if dir.join("done").exists() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    let result = std::fs::read_to_string(dir.join("done")).unwrap_or_default();
    eprintln!("page module result: {result}");
    assert!(result.starts_with("ok"), "{result}");
    server.stop_mesh();
}

//! Integration tests: a real server on an ephemeral port, real WebSocket and
//! HTTP clients, and a fake backend (dispatch table + a real event hub).

use std::sync::Arc;
use std::time::Duration;

use futures::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};

use super::*;
use crate::backend_protocol::{EventHub, EVENTS_DROPPED_EVENT};

struct FakeBackend {
    hub: Arc<EventHub>,
}

impl ObpBackend for FakeBackend {
    fn dispatch(&self, command: String, args: Value) -> ObpDispatchFuture {
        let hub = Arc::clone(&self.hub);
        Box::pin(async move {
            match command.as_str() {
                "echo" | "open_workspace" | "account_delete_device" => {
                    Ok(json!({ "command": command, "args": args }))
                }
                "emit" => {
                    let count = args["count"].as_u64().unwrap_or(1);
                    for index in 0..count {
                        hub.publish("agentic://tool-event", json!({ "index": index }));
                    }
                    Ok(Value::Null)
                }
                "fail" => Err("boom: the command failed".to_string()),
                "panic" => panic!("command panicked"),
                other => Err(crate::host::unsupported_in_native_host(other)),
            }
        })
    }

    fn events(&self) -> Arc<EventHub> {
        Arc::clone(&self.hub)
    }

    fn info(&self) -> Value {
        json!({ "version": "9.9.9", "platform": "test", "dataDir": "/secret/data" })
    }
}

struct Harness {
    server: Arc<ObpServer>,
    hub: Arc<EventHub>,
    _dir: tempfile::TempDir,
}

async fn harness(limits: ConnectionLimits, web: Option<&std::path::Path>) -> Harness {
    let dir = tempfile::tempdir().unwrap();
    let hub = EventHub::new(64);
    let mut options = ObpServerOptions::new(dir.path().join("obp"));
    options.loopback_port = 0;
    options.lan_port = 0;
    options.limits = limits;
    options.web_root = web.map(|path| path.canonicalize().unwrap());
    let backend = Arc::new(FakeBackend {
        hub: Arc::clone(&hub),
    });
    let server = ObpServer::new(backend, options).unwrap();
    server.start_loopback().await.unwrap();
    Harness {
        server,
        hub,
        _dir: dir,
    }
}

type Socket = WebSocketStream<MaybeTlsStream<TcpStream>>;

async fn connect_owner(harness: &Harness, origin: Option<&str>) -> Result<Socket, u16> {
    let addr = harness.server.loopback_addr().unwrap();
    let mut request = format!("ws://{addr}/obp").into_client_request().unwrap();
    request.headers_mut().insert(
        "authorization",
        format!("Bearer {}", harness.server.owner_token())
            .parse()
            .unwrap(),
    );
    if let Some(origin) = origin {
        request
            .headers_mut()
            .insert("origin", origin.parse().unwrap());
    }
    match tokio_tungstenite::connect_async(request).await {
        Ok((socket, _)) => Ok(socket),
        Err(tokio_tungstenite::tungstenite::Error::Http(response)) => {
            Err(response.status().as_u16())
        }
        Err(error) => panic!("unexpected connect error: {error}"),
    }
}

async fn send(socket: &mut Socket, value: Value) {
    socket
        .send(Message::Text(value.to_string().into()))
        .await
        .unwrap();
}

async fn recv(socket: &mut Socket) -> Value {
    loop {
        let message = tokio::time::timeout(Duration::from_secs(5), socket.next())
            .await
            .expect("a message within 5 s")
            .expect("open socket")
            .expect("readable message");
        if let Message::Text(text) = message {
            return serde_json::from_str(text.as_str()).unwrap();
        }
    }
}

/// Reads until the response with `id`, collecting event notifications.
async fn response(socket: &mut Socket, id: u64, events: &mut Vec<Value>) -> Value {
    loop {
        let frame = recv(socket).await;
        if frame["id"] == json!(id) {
            return frame;
        }
        if frame["method"] == "event" {
            events.push(frame["params"].clone());
        }
    }
}

async fn hello(socket: &mut Socket, params: Value) -> Value {
    send(
        socket,
        json!({ "jsonrpc": "2.0", "id": 0, "method": "hello", "params": params }),
    )
    .await;
    let mut ignored = Vec::new();
    response(socket, 0, &mut ignored).await
}

#[tokio::test]
async fn hello_call_events_and_structured_errors() {
    let harness = harness(ConnectionLimits::default(), None).await;
    let mut socket = connect_owner(&harness, None).await.unwrap();

    // Calls before hello are refused.
    send(
        &mut socket,
        json!({ "jsonrpc": "2.0", "id": 7, "method": "call", "params": { "command": "echo" } }),
    )
    .await;
    let early = recv(&mut socket).await;
    assert_eq!(early["error"]["code"], -32002);

    let reply = hello(&mut socket, json!({ "protocol": 1, "client": "test" })).await;
    let result = &reply["result"];
    assert_eq!(result["scope"], "owner");
    assert_eq!(result["protocol"], 1);
    assert_eq!(result["backend"]["version"], "9.9.9");
    assert_eq!(result["backend"]["dataDir"], "/secret/data");
    assert_eq!(
        result["registryDigest"],
        openbitfun_product_domains::remote_surface::digest()
    );
    assert!(result["capabilities"]
        .as_array()
        .unwrap()
        .contains(&json!("obp_v1")));

    let mut events = Vec::new();
    send(&mut socket, json!({ "jsonrpc": "2.0", "id": 1, "method": "call", "params": { "command": "echo", "args": { "request": { "a": 1 } } } })).await;
    let echoed = response(&mut socket, 1, &mut events).await;
    assert_eq!(echoed["result"]["args"]["request"]["a"], 1);

    send(&mut socket, json!({ "jsonrpc": "2.0", "id": 2, "method": "call", "params": { "command": "emit", "args": { "count": 3 } } })).await;
    response(&mut socket, 2, &mut events).await;
    while events.len() < 3 {
        let frame = recv(&mut socket).await;
        assert_eq!(frame["method"], "event");
        events.push(frame["params"].clone());
    }
    let seqs: Vec<u64> = events.iter().map(|e| e["seq"].as_u64().unwrap()).collect();
    assert_eq!(seqs, [1, 2, 3]);
    assert_eq!(events[2]["event"], "agentic://tool-event");
    assert_eq!(events[2]["payload"]["index"], 2);

    send(
        &mut socket,
        json!({ "jsonrpc": "2.0", "id": 3, "method": "call", "params": { "command": "fail" } }),
    )
    .await;
    let failed = response(&mut socket, 3, &mut events).await;
    assert_eq!(failed["error"]["code"], -32000);
    assert_eq!(failed["error"]["message"], "boom: the command failed");
    assert_eq!(failed["error"]["data"]["kind"], "command");

    send(
        &mut socket,
        json!({ "jsonrpc": "2.0", "id": 4, "method": "call", "params": { "command": "nope" } }),
    )
    .await;
    let unsupported = response(&mut socket, 4, &mut events).await;
    assert_eq!(unsupported["error"]["data"]["kind"], "unsupported");
    assert_eq!(
        unsupported["error"]["message"],
        "unsupported_in_native_host: nope"
    );

    send(
        &mut socket,
        json!({ "jsonrpc": "2.0", "id": 5, "method": "call", "params": { "command": "panic" } }),
    )
    .await;
    let panicked = response(&mut socket, 5, &mut events).await;
    assert_eq!(panicked["error"]["code"], -32603);

    send(
        &mut socket,
        json!({ "jsonrpc": "2.0", "id": 6, "method": "nope" }),
    )
    .await;
    assert_eq!(
        response(&mut socket, 6, &mut events).await["error"]["code"],
        -32601
    );

    // The connection survived the panic and answers again.
    send(
        &mut socket,
        json!({ "jsonrpc": "2.0", "id": 8, "method": "call", "params": { "command": "echo" } }),
    )
    .await;
    assert!(response(&mut socket, 8, &mut events).await["result"].is_object());
    harness.server.shutdown();
}

#[tokio::test]
async fn resume_replays_after_last_seq_and_a_foreign_instance_is_told_to_rehydrate() {
    let harness = harness(ConnectionLimits::default(), None).await;
    for index in 0..5 {
        harness
            .hub
            .publish("agentic://tool-event", json!({ "index": index }));
    }
    let instance = harness.server.instance_id().to_string();

    let mut socket = connect_owner(&harness, None).await.unwrap();
    let reply = hello(&mut socket, json!({ "lastSeq": 2, "instanceId": instance })).await;
    assert_eq!(reply["result"]["lastSeq"], 5);
    let seqs: Vec<u64> = [
        recv(&mut socket).await,
        recv(&mut socket).await,
        recv(&mut socket).await,
    ]
    .iter()
    .map(|frame| frame["params"]["seq"].as_u64().unwrap())
    .collect();
    assert_eq!(seqs, [3, 4, 5]);

    // A cursor from another backend process: events-dropped, then live events.
    let mut stale = connect_owner(&harness, None).await.unwrap();
    hello(
        &mut stale,
        json!({ "lastSeq": 40, "instanceId": "another-process" }),
    )
    .await;
    let dropped = recv(&mut stale).await;
    assert_eq!(dropped["params"]["event"], EVENTS_DROPPED_EVENT);
    assert_eq!(dropped["params"]["payload"]["reason"], "backend_restarted");
    assert_eq!(dropped["params"]["payload"]["resumeSeq"], 6);
    harness
        .hub
        .publish("agentic://tool-event", json!({ "index": 5 }));
    assert_eq!(recv(&mut stale).await["params"]["seq"], 6);

    // A cursor that fell out of the replay ring (64 events).
    for index in 0..100 {
        harness
            .hub
            .publish("agentic://tool-event", json!({ "index": index }));
    }
    let mut late = connect_owner(&harness, None).await.unwrap();
    hello(&mut late, json!({ "lastSeq": 3, "instanceId": instance })).await;
    let first = recv(&mut late).await;
    assert_eq!(first["params"]["event"], EVENTS_DROPPED_EVENT);
    harness.server.shutdown();
}

#[tokio::test]
async fn loopback_requires_the_owner_token_a_local_host_and_the_same_origin() {
    let harness = harness(ConnectionLimits::default(), None).await;
    let addr = harness.server.loopback_addr().unwrap();

    // No credentials.
    let request = format!("ws://{addr}/obp").into_client_request().unwrap();
    match tokio_tungstenite::connect_async(request).await {
        Err(tokio_tungstenite::tungstenite::Error::Http(response)) => {
            assert_eq!(response.status().as_u16(), 401)
        }
        other => panic!("expected 401, got {:?}", other.map(|_| ())),
    }
    // A cross-site page.
    assert_eq!(
        connect_owner(&harness, Some("https://evil.example"))
            .await
            .err(),
        Some(403)
    );
    // The page's own origin.
    assert!(connect_owner(&harness, Some(&format!("http://{addr}")))
        .await
        .is_ok());

    // DNS rebinding: a foreign Host header.
    let mut request = format!("ws://{addr}/obp").into_client_request().unwrap();
    request
        .headers_mut()
        .insert("host", "evil.example".parse().unwrap());
    request.headers_mut().insert(
        "authorization",
        format!("Bearer {}", harness.server.owner_token())
            .parse()
            .unwrap(),
    );
    match tokio_tungstenite::connect_async(request).await {
        Err(tokio_tungstenite::tungstenite::Error::Http(response)) => {
            assert_eq!(response.status().as_u16(), 421)
        }
        other => panic!("expected 421, got {:?}", other.map(|_| ())),
    }
    harness.server.shutdown();
}

fn tls_connector() -> tokio_tungstenite::Connector {
    #[derive(Debug)]
    struct AcceptAny;
    impl rustls::client::danger::ServerCertVerifier for AcceptAny {
        fn verify_server_cert(
            &self,
            _: &rustls::pki_types::CertificateDer<'_>,
            _: &[rustls::pki_types::CertificateDer<'_>],
            _: &rustls::pki_types::ServerName<'_>,
            _: &[u8],
            _: rustls::pki_types::UnixTime,
        ) -> Result<rustls::client::danger::ServerCertVerified, rustls::Error> {
            Ok(rustls::client::danger::ServerCertVerified::assertion())
        }
        fn verify_tls12_signature(
            &self,
            _: &[u8],
            _: &rustls::pki_types::CertificateDer<'_>,
            _: &rustls::DigitallySignedStruct,
        ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
            Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
        }
        fn verify_tls13_signature(
            &self,
            _: &[u8],
            _: &rustls::pki_types::CertificateDer<'_>,
            _: &rustls::DigitallySignedStruct,
        ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
            Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
        }
        fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
            rustls::crypto::CryptoProvider::get_default()
                .map(|provider| {
                    provider
                        .signature_verification_algorithms
                        .supported_schemes()
                })
                .unwrap_or_default()
        }
    }
    crate::ensure_rustls_crypto_provider();
    let config = rustls::ClientConfig::builder()
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(AcceptAny))
        .with_no_client_auth();
    tokio_tungstenite::Connector::Rustls(Arc::new(config))
}

#[tokio::test]
async fn lan_pairing_scopes_and_revocation() {
    let harness = harness(ConnectionLimits::default(), None).await;
    harness.server.set_lan_enabled(true).await.unwrap();
    let lan = harness.server.lan_addr().expect("LAN listener");
    let status = harness.server.status();
    assert!(status.lan.running);
    let fingerprint = status.lan.fingerprint.clone().unwrap();
    assert!(fingerprint.starts_with("sha256:"));

    // Pair through the JSON endpoint with a one-time code.
    let code = super::lock(&harness.server.store).create_code("Test phone".into());
    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .build()
        .unwrap();
    let paired: Value = client
        .post(format!("https://127.0.0.1:{}/obp/pair", lan.port()))
        .json(&json!({ "code": code }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(paired["fingerprint"], json!(fingerprint));
    let credential = paired["credential"].as_str().unwrap().to_string();
    let client_id = paired["clientId"].as_str().unwrap().to_string();
    // The code is single-use.
    let again = client
        .post(format!("https://127.0.0.1:{}/obp/pair", lan.port()))
        .json(&json!({ "code": code }))
        .send()
        .await
        .unwrap();
    assert_eq!(again.status().as_u16(), 403);

    let connect = |credential: String| {
        let mut request = format!("wss://127.0.0.1:{}/obp", lan.port())
            .into_client_request()
            .unwrap();
        request.headers_mut().insert(
            "authorization",
            format!("Bearer {credential}").parse().unwrap(),
        );
        tokio_tungstenite::connect_async_tls_with_config(
            request,
            None,
            false,
            Some(tls_connector()),
        )
    };
    // The owner token does not open a LAN session.
    assert!(connect(harness.server.owner_token()).await.is_err());

    let (mut socket, _) = connect(credential.clone()).await.unwrap();
    let reply = hello(&mut socket, json!({})).await;
    assert_eq!(reply["result"]["scope"], "paired-client");
    assert!(reply["result"]["backend"].get("dataDir").is_none());

    let mut events = Vec::new();
    // ControllerLocal commands are refused before dispatch.
    send(&mut socket, json!({ "jsonrpc": "2.0", "id": 1, "method": "call", "params": { "command": "account_delete_device" } })).await;
    let refused = response(&mut socket, 1, &mut events).await;
    assert_eq!(refused["error"]["code"], -32003);
    assert_eq!(refused["error"]["data"]["scope"], "paired-client");
    send(&mut socket, json!({ "jsonrpc": "2.0", "id": 2, "method": "call", "params": { "command": "obp_create_pairing" } })).await;
    assert_eq!(
        response(&mut socket, 2, &mut events).await["error"]["code"],
        -32003
    );
    // Proxied commands run.
    send(&mut socket, json!({ "jsonrpc": "2.0", "id": 3, "method": "call", "params": { "command": "open_workspace", "args": {} } })).await;
    assert!(response(&mut socket, 3, &mut events).await["result"].is_object());

    // Owner-only events are filtered out; others arrive.
    harness
        .hub
        .publish("account://login-state", json!({ "secret": true }));
    harness.hub.publish("window://fullscreen-chrome", json!({}));
    harness
        .hub
        .publish("agentic://tool-event", json!({ "ok": true }));
    let event = recv(&mut socket).await;
    assert_eq!(event["params"]["event"], "agentic://tool-event");

    assert!(harness.server.status().paired_clients[0].connected);

    // Revocation closes the live connection and refuses the credential.
    harness.server.revoke(&client_id).unwrap();
    let closed = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            match socket.next().await {
                Some(Ok(Message::Close(frame))) => return frame.map(|f| u16::from(f.code)),
                Some(Ok(_)) => continue,
                _ => return None,
            }
        }
    })
    .await
    .unwrap();
    assert_eq!(closed, Some(4003));
    assert!(connect(credential).await.is_err());

    // Turning the LAN off stops the listener.
    harness.server.set_lan_enabled(false).await.unwrap();
    assert!(harness.server.lan_addr().is_none());
    harness.server.shutdown();
}

#[tokio::test]
async fn a_stalled_client_gets_credit_backpressure_then_events_dropped() {
    let limits = ConnectionLimits {
        min_credit_bytes: 1024,
        default_credit_bytes: 4 * 1024,
        backlog_drop_bytes: 16 * 1024,
        ..ConnectionLimits::default()
    };
    let harness = harness(limits, None).await;
    let mut socket = connect_owner(&harness, None).await.unwrap();
    let reply = hello(&mut socket, json!({ "ack": true, "creditBytes": 4096 })).await;
    assert_eq!(reply["result"]["creditBytes"], 4096);

    let filler = "x".repeat(900);
    for index in 0..10 {
        harness.hub.publish(
            "agentic://tool-event",
            json!({ "index": index, "filler": filler }),
        );
    }
    // Without acks, the server stops after about one window of bytes.
    let mut received = Vec::new();
    while let Ok(Some(Ok(Message::Text(text)))) =
        tokio::time::timeout(Duration::from_millis(400), socket.next()).await
    {
        let frame: Value = serde_json::from_str(text.as_str()).unwrap();
        received.push(frame["params"]["seq"].as_u64().unwrap());
    }
    assert!(
        !received.is_empty() && received.len() < 10,
        "received {received:?}"
    );
    let last = *received.last().unwrap();

    // An ack returns the credit and the stream continues where it stopped.
    send(
        &mut socket,
        json!({ "jsonrpc": "2.0", "method": "ack", "params": { "seq": last } }),
    )
    .await;
    let next = recv(&mut socket).await;
    assert_eq!(next["params"]["seq"], last + 1);

    // A large backlog while stalled ends in events-dropped, not in buffering.
    for index in 0..40 {
        harness.hub.publish(
            "agentic://tool-event",
            json!({ "index": index, "filler": filler }),
        );
    }
    let dropped = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let frame = recv(&mut socket).await;
            if frame["params"]["event"] == EVENTS_DROPPED_EVENT {
                return frame;
            }
        }
    })
    .await
    .expect("events-dropped while stalled");
    assert_eq!(dropped["params"]["payload"]["reason"], "slow_client");
    let newest = harness.hub.last_seq();
    assert_eq!(dropped["params"]["seq"], newest);
    // After acking everything, live events flow again.
    send(
        &mut socket,
        json!({ "jsonrpc": "2.0", "method": "ack", "params": { "seq": newest } }),
    )
    .await;
    harness
        .hub
        .publish("agentic://tool-event", json!({ "live": true }));
    let live = recv(&mut socket).await;
    assert_eq!(live["params"]["payload"]["live"], true);
    harness.server.shutdown();
}

#[tokio::test]
async fn serves_the_web_bundle_with_csp_and_the_owner_launch_link() {
    let web = tempfile::tempdir().unwrap();
    std::fs::write(
        web.path().join("index.html"),
        "<!doctype html><html><head><title>t</title></head><body></body></html>",
    )
    .unwrap();
    std::fs::write(web.path().join("app.ab404372c0.js"), "console.log(1)").unwrap();
    let harness = harness(ConnectionLimits::default(), Some(web.path())).await;
    let addr = harness.server.loopback_addr().unwrap();
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap();

    let index = client.get(format!("http://{addr}/")).send().await.unwrap();
    assert_eq!(index.status().as_u16(), 200);
    let csp = index.headers()["content-security-policy"]
        .to_str()
        .unwrap()
        .to_string();
    assert!(
        csp.contains("script-src 'self' 'wasm-unsafe-eval'"),
        "{csp}"
    );
    assert!(csp.contains("frame-ancestors 'none'"));
    let body = index.text().await.unwrap();
    assert!(body.contains("id=\"nsh-params\""));

    let script = client
        .get(format!("http://{addr}/app.ab404372c0.js"))
        .send()
        .await
        .unwrap();
    assert_eq!(
        script.headers()["cache-control"],
        "public, max-age=31536000, immutable"
    );
    let traversal = client
        .get(format!("http://{addr}/..%2f..%2fetc%2fpasswd"))
        .send()
        .await
        .unwrap();
    assert_eq!(traversal.status().as_u16(), 404);

    // The launch link trades the token for an HttpOnly session cookie.
    let token = harness.server.owner_token();
    let launch = client
        .get(format!("http://{addr}/?token={token}"))
        .send()
        .await
        .unwrap();
    assert_eq!(launch.status().as_u16(), 303);
    let cookie = launch.headers()["set-cookie"].to_str().unwrap().to_string();
    assert!(cookie.contains("HttpOnly") && cookie.contains(&token));
    let bad = client
        .get(format!("http://{addr}/?token=wrong"))
        .send()
        .await
        .unwrap();
    assert_eq!(bad.status().as_u16(), 403);

    // The cookie authorizes the upgrade from the page's origin.
    let mut request = format!("ws://{addr}/obp").into_client_request().unwrap();
    let pair = cookie.split(';').next().unwrap().to_string();
    request
        .headers_mut()
        .insert("cookie", pair.parse().unwrap());
    request
        .headers_mut()
        .insert("origin", format!("http://{addr}").parse().unwrap());
    let (mut socket, _) = tokio_tungstenite::connect_async(request).await.unwrap();
    assert_eq!(
        hello(&mut socket, json!({})).await["result"]["scope"],
        "owner"
    );

    let session: Value = client
        .get(format!("http://{addr}/obp/session"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(session["authorized"], false);
    harness.server.shutdown();
}

#[tokio::test]
async fn shutdown_closes_connections_and_removes_the_token_file() {
    let harness = harness(ConnectionLimits::default(), None).await;
    let token_file = harness
        .server
        .options
        .state_dir
        .join(store::OWNER_TOKEN_FILE);
    assert!(token_file.is_file());
    let mut socket = connect_owner(&harness, None).await.unwrap();
    hello(&mut socket, json!({})).await;
    assert_eq!(harness.server.status().owner_connections, 1);
    harness.server.shutdown();
    let closed = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            match socket.next().await {
                Some(Ok(Message::Close(frame))) => return frame.map(|f| u16::from(f.code)),
                Some(Ok(_)) => continue,
                _ => return None,
            }
        }
    })
    .await
    .unwrap();
    assert_eq!(closed, Some(1001));
    assert!(!token_file.exists());
}

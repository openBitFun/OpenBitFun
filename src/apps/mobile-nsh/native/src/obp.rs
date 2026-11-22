//! OBP to one device over a Link stream: the client side of the account
//! mesh handshake every desktop and CLI host serves. The implementation is
//! the shared protocol crate's (`openbitfun_obp::client`, the same code the
//! desktop's Peer Device Mode dials with); this module keeps the phone
//! controller's types (a JSON event per item, transport errors flagged) and
//! names the phone in the `hello`.
//!
//! TLS to the device's self-signed certificate (its fingerprint is bound into
//! the handshake), a WebSocket upgrade carrying this phone's proof, the
//! device's proof checked in the `101`, then JSON-RPC `hello`, `call`, `ack`
//! and the event stream with credit/ack backpressure (an event is
//! acknowledged when the UI takes it).

use std::time::Duration;

use openbitfun_obp::client::{self, MeshConnectOptions, MeshObpConnection};
use serde_json::Value;

/// The OBP protocol version this client speaks.
#[allow(dead_code)]
pub(crate) const OBP_PROTOCOL_VERSION: u32 = openbitfun_obp::OBP_PROTOCOL_VERSION;
const MAX_BATCH: usize = client::MAX_EVENT_BATCH;

/// `/obp/mesh/info`: what a device says before authentication (no secrets).
#[allow(unused_imports)]
pub(crate) use openbitfun_obp::MeshInfo;
/// A byte stream to a device (a Link stream; loopback TCP in tests).
pub(crate) use openbitfun_obp::MeshIo as Io;

/// `GET /obp/mesh/info` over `stream`.
pub(crate) async fn probe_info(stream: Box<dyn Io>, host: &str) -> Result<MeshInfo, String> {
    client::probe_info(stream, host).await
}

/// Who connects to whom, and with which pair key.
pub(crate) struct Dial<'a> {
    pub(crate) local_device_id: &'a str,
    pub(crate) target_device_id: &'a str,
    pub(crate) pair_key: [u8; 32],
    /// `host:port` of the device's OBP listener (its virtual address).
    pub(crate) authority: String,
}

/// Resume and window parameters of the `hello`.
#[derive(Debug, Clone, Default)]
pub(crate) struct Resume {
    pub(crate) last_seq: Option<u64>,
    pub(crate) instance_id: Option<String>,
    /// The fleet member of the hello (`{protocol, cursor}` with the vector
    /// cursor): a fleet entry then tags every event with its origin and
    /// resumes each origin from the cursor. An older device ignores it.
    pub(crate) fleet: Option<Value>,
}

/// A failed call: the device backend's own error, or a transport failure.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct CallError {
    pub(crate) code: i64,
    pub(crate) message: String,
    pub(crate) transport: bool,
}

/// One event of the device's stream.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Event {
    pub(crate) seq: u64,
    pub(crate) json: Value,
}

/// An authenticated OBP connection to one device.
pub(crate) struct Connection {
    inner: MeshObpConnection,
}

/// Opens an authenticated OBP connection over `stream`.
pub(crate) async fn connect(
    stream: Box<dyn Io>,
    dial: Dial<'_>,
    resume: Resume,
) -> Result<Connection, String> {
    let inner = client::connect(
        stream,
        client::Dial {
            local_device_id: dial.local_device_id,
            target_device_id: dial.target_device_id,
            pair_key: dial.pair_key,
            authority: dial.authority,
            client: format!("openbitfun-mobile/{}", env!("CARGO_PKG_VERSION")),
        },
        MeshConnectOptions {
            last_seq: resume.last_seq,
            instance_id: resume.instance_id,
            credit_bytes: None,
            fleet: resume.fleet,
            ..MeshConnectOptions::default()
        },
    )
    .await?;
    Ok(Connection { inner })
}

impl Connection {
    /// The `hello` result: scope, capabilities, backend identity, `lastSeq`.
    pub(crate) fn hello(&self) -> &Value {
        self.inner.hello()
    }

    /// The backend process instance (resume key).
    pub(crate) fn instance_id(&self) -> Option<String> {
        self.inner.instance_id()
    }

    /// Why the connection ended, once it did.
    pub(crate) fn closed(&self) -> Option<String> {
        self.inner.closed()
    }

    /// Runs `command` on the device backend.
    pub(crate) async fn call(&self, command: &str, args: Value) -> Result<Value, CallError> {
        self.inner
            .call(command, args)
            .await
            .map_err(|error| CallError {
                transport: error.is_transport(),
                code: error.code,
                message: error.message,
            })
    }

    /// Waits for at least one event and takes up to 512 (acknowledging
    /// them); `Err` with the reason once the connection ended and nothing is
    /// left.
    pub(crate) async fn next_events(&self) -> Result<Vec<Event>, String> {
        Ok(self
            .inner
            .next_events(MAX_BATCH)
            .await?
            .into_iter()
            .map(|event| Event {
                seq: event.seq,
                json: event.to_wire(),
            })
            .collect())
    }

    /// Closes the connection.
    pub(crate) fn close(&self) {
        self.inner.request_close();
    }
}

/// How long one dial may take before it is reported.
pub(crate) const CONNECT_TIMEOUT: Duration = Duration::from_secs(20);
/// How long a port probe may take.
pub(crate) const PROBE_TIMEOUT: Duration = Duration::from_secs(8);

#[cfg(test)]
#[allow(clippy::result_large_err)]
pub(crate) mod tests {
    //! The client against a loopback device that speaks the server side of
    //! the account mesh handshake with `openbitfun_link::handshake` (the
    //! functions the desktop's mesh listener verifies with).

    use super::*;
    use std::sync::Arc;

    use futures::{SinkExt, StreamExt};
    use openbitfun_link::handshake::{self, Claims, Role};
    use serde_json::json;
    use tokio::sync::mpsc;
    use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};
    use tokio_tungstenite::tungstenite::Message;

    struct Device {
        addr: std::net::SocketAddr,
        acks: mpsc::UnboundedReceiver<u64>,
        fingerprint: String,
    }

    /// One device that accepts `client` with `pair_key` and serves one
    /// connection: hello (`lastSeq` 5, events 6 and 7 queued), `echo`,
    /// `fail`, and closes after `bye`.
    async fn device(pair_key: [u8; 32], client: &'static str, server: &'static str) -> Device {
        openbitfun_services_core::tls_provider::ensure_ring_crypto_provider();
        let certified =
            rcgen::generate_simple_self_signed(vec!["openbitfun.local".to_string()]).unwrap();
        let cert_der = certified.cert.der().clone();
        let fingerprint = crate::crypto::fingerprint(cert_der.as_ref());
        let key = rustls::pki_types::PrivateKeyDer::try_from(certified.signing_key.serialize_der())
            .unwrap();
        let config = rustls::ServerConfig::builder()
            .with_no_client_auth()
            .with_single_cert(vec![cert_der], key)
            .unwrap();
        let acceptor = tokio_rustls::TlsAcceptor::from(Arc::new(config));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let (ack_sender, acks) = mpsc::unbounded_channel();
        let bound_fingerprint = fingerprint.clone();
        tokio::spawn(async move {
            loop {
                let (tcp, _) = listener.accept().await.unwrap();
                let tls = acceptor.accept(tcp).await.unwrap();
                let fingerprint = bound_fingerprint.clone();
                let acks = ack_sender.clone();
                tokio::spawn(async move {
                    let hs_key = handshake::handshake_key(&pair_key);
                    let callback = |request: &Request,
                                    mut response: Response|
                     -> Result<Response, ErrorResponse> {
                        let header = |name: &str| {
                            request
                                .headers()
                                .get(name)
                                .and_then(|value| value.to_str().ok())
                                .unwrap_or_default()
                                .to_string()
                        };
                        let claims = Claims {
                            client_device_id: header(handshake::HEADER_DEVICE),
                            server_device_id: header(handshake::HEADER_TARGET),
                            cert_fingerprint: fingerprint.clone(),
                            time_ms: header(handshake::HEADER_TIME).parse().unwrap_or_default(),
                            nonce: header(handshake::HEADER_NONCE),
                        };
                        let proof = header("authorization")
                            .strip_prefix(&format!("{} ", handshake::AUTH_SCHEME))
                            .unwrap_or_default()
                            .to_string();
                        if claims.client_device_id != client
                            || claims.server_device_id != server
                            || !handshake::verify(&hs_key, Role::Client, &claims, &proof)
                        {
                            let mut refusal =
                                ErrorResponse::new(Some("handshake refused".to_string()));
                            *refusal.status_mut() =
                                tokio_tungstenite::tungstenite::http::StatusCode::UNAUTHORIZED;
                            return Err(refusal);
                        }
                        response.headers_mut().insert(
                            handshake::HEADER_SERVER_PROOF,
                            handshake::prove(&hs_key, Role::Server, &claims)
                                .parse()
                                .unwrap(),
                        );
                        Ok(response)
                    };
                    let Ok(mut ws) = tokio_tungstenite::accept_hdr_async(tls, callback).await
                    else {
                        return;
                    };
                    let send = |value: Value| Message::Text(value.to_string().into());
                    while let Some(Ok(message)) = ws.next().await {
                        let Message::Text(text) = message else {
                            continue;
                        };
                        let frame: Value = serde_json::from_str(text.as_str()).unwrap();
                        match frame["method"].as_str().unwrap_or_default() {
                            "hello" => {
                                assert_eq!(frame["params"]["ack"], true);
                                let mut result = json!({
                                    "protocol": 1, "scope": "account-device", "capabilities": ["mesh_v1"],
                                    "backend": {"version": "9.9.9", "platform": "test", "instanceId": "inst-1"},
                                    "lastSeq": 5, "creditBytes": 1048576});
                                // A fleet entry answers the fleet hello per cursor origin.
                                if let Some(cursor) = frame["params"]["fleet"]["cursor"].as_object()
                                {
                                    let state: serde_json::Map<String, Value> = cursor
                                        .keys()
                                        .map(|origin| (origin.clone(), json!("resumed")))
                                        .collect();
                                    result["fleet"] = json!({"protocol": 1, "cursorState": state});
                                }
                                ws.send(send(
                                    json!({"jsonrpc": "2.0", "id": frame["id"], "result": result}),
                                ))
                                .await
                                .unwrap();
                                for seq in [6, 7] {
                                    ws.send(send(json!({"jsonrpc": "2.0", "method": "event", "params": {
                                        "seq": seq, "event": "agentic://text-chunk", "payload": {"n": seq}}})))
                                        .await
                                        .unwrap();
                                }
                            }
                            "ack" => {
                                let _ = acks.send(frame["params"]["seq"].as_u64().unwrap());
                            }
                            "call" => {
                                let id = frame["id"].clone();
                                let answer = match frame["params"]["command"].as_str().unwrap() {
                                    "echo" => {
                                        json!({"jsonrpc": "2.0", "id": id, "result": frame["params"]["args"]})
                                    }
                                    "bye" => break,
                                    _ => {
                                        json!({"jsonrpc": "2.0", "id": id, "error": {"code": -32000, "message": "unsupported_in_native_host: fail"}})
                                    }
                                };
                                ws.send(send(answer)).await.unwrap();
                            }
                            _ => {}
                        }
                    }
                });
            }
        });
        Device {
            addr,
            acks,
            fingerprint,
        }
    }

    async fn dial(addr: std::net::SocketAddr, pair_key: [u8; 32]) -> Result<Connection, String> {
        dial_with(addr, pair_key, Resume::default()).await
    }

    pub(crate) struct ScriptedSession {
        pub(crate) instance_id: String,
        pub(crate) last_seq: u64,
        pub(crate) events: Vec<Value>,
        pub(crate) close_after_events: bool,
    }

    pub(crate) struct ScriptedDevice {
        pub(crate) addr: std::net::SocketAddr,
        pub(crate) hellos: mpsc::UnboundedReceiver<Value>,
    }

    /// Loopback OBP device whose successive connections play `sessions` in order.
    pub(crate) async fn scripted_device(
        pair_key: [u8; 32],
        client: &'static str,
        server: &'static str,
        sessions: Vec<ScriptedSession>,
    ) -> ScriptedDevice {
        openbitfun_services_core::tls_provider::ensure_ring_crypto_provider();
        let certified =
            rcgen::generate_simple_self_signed(vec!["openbitfun.local".to_string()]).unwrap();
        let cert_der = certified.cert.der().clone();
        let fingerprint = crate::crypto::fingerprint(cert_der.as_ref());
        let key = rustls::pki_types::PrivateKeyDer::try_from(certified.signing_key.serialize_der())
            .unwrap();
        let config = rustls::ServerConfig::builder()
            .with_no_client_auth()
            .with_single_cert(vec![cert_der], key)
            .unwrap();
        let acceptor = tokio_rustls::TlsAcceptor::from(Arc::new(config));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let (hello_sender, hellos) = mpsc::unbounded_channel();
        let sessions = Arc::new(std::sync::Mutex::new(std::collections::VecDeque::from(
            sessions,
        )));
        tokio::spawn(async move {
            loop {
                let Ok((tcp, _)) = listener.accept().await else {
                    return;
                };
                let Ok(tls) = acceptor.accept(tcp).await else {
                    continue;
                };
                let fingerprint = fingerprint.clone();
                let hellos = hello_sender.clone();
                let session = sessions.lock().unwrap().pop_front();
                tokio::spawn(async move {
                    let hs_key = handshake::handshake_key(&pair_key);
                    let callback = |request: &Request,
                                    mut response: Response|
                     -> Result<Response, ErrorResponse> {
                        let header = |name: &str| {
                            request
                                .headers()
                                .get(name)
                                .and_then(|value| value.to_str().ok())
                                .unwrap_or_default()
                                .to_string()
                        };
                        let claims = Claims {
                            client_device_id: header(handshake::HEADER_DEVICE),
                            server_device_id: header(handshake::HEADER_TARGET),
                            cert_fingerprint: fingerprint.clone(),
                            time_ms: header(handshake::HEADER_TIME).parse().unwrap_or_default(),
                            nonce: header(handshake::HEADER_NONCE),
                        };
                        let proof = header("authorization")
                            .strip_prefix(&format!("{} ", handshake::AUTH_SCHEME))
                            .unwrap_or_default()
                            .to_string();
                        if claims.client_device_id != client
                            || claims.server_device_id != server
                            || !handshake::verify(&hs_key, Role::Client, &claims, &proof)
                        {
                            let mut refusal =
                                ErrorResponse::new(Some("handshake refused".to_string()));
                            *refusal.status_mut() =
                                tokio_tungstenite::tungstenite::http::StatusCode::UNAUTHORIZED;
                            return Err(refusal);
                        }
                        response.headers_mut().insert(
                            handshake::HEADER_SERVER_PROOF,
                            handshake::prove(&hs_key, Role::Server, &claims)
                                .parse()
                                .unwrap(),
                        );
                        Ok(response)
                    };
                    let Ok(mut ws) = tokio_tungstenite::accept_hdr_async(tls, callback).await
                    else {
                        return;
                    };
                    let Some(session) = session else {
                        return;
                    };
                    let send = |value: Value| Message::Text(value.to_string().into());
                    while let Some(Ok(message)) = ws.next().await {
                        let Message::Text(text) = message else {
                            continue;
                        };
                        let frame: Value = serde_json::from_str(text.as_str()).unwrap();
                        match frame["method"].as_str().unwrap_or_default() {
                            "hello" => {
                                let _ = hellos.send(frame["params"].clone());
                                let result = json!({
                                    "protocol": 1,
                                    "scope": "account-device",
                                    "capabilities": ["mesh_v1"],
                                    "backend": {
                                        "version": "2.0.0",
                                        "platform": "test",
                                        "instanceId": session.instance_id,
                                    },
                                    "lastSeq": session.last_seq,
                                    "creditBytes": 1048576,
                                });
                                if ws
                                    .send(send(json!({
                                        "jsonrpc": "2.0",
                                        "id": frame["id"],
                                        "result": result,
                                    })))
                                    .await
                                    .is_err()
                                {
                                    return;
                                }
                                for event in &session.events {
                                    if ws
                                        .send(send(json!({
                                            "jsonrpc": "2.0",
                                            "method": "event",
                                            "params": event,
                                        })))
                                        .await
                                        .is_err()
                                    {
                                        return;
                                    }
                                }
                                if session.close_after_events {
                                    let _ = ws.close(None).await;
                                    return;
                                }
                            }
                            "call" => {
                                let id = frame["id"].clone();
                                let answer = match frame["params"]["command"].as_str().unwrap() {
                                    "echo" => {
                                        json!({"jsonrpc": "2.0", "id": id, "result": frame["params"]["args"]})
                                    }
                                    "bye" => break,
                                    _ => {
                                        json!({"jsonrpc": "2.0", "id": id, "error": {"code": -32000, "message": "unsupported"}})
                                    }
                                };
                                let _ = ws.send(send(answer)).await;
                            }
                            _ => {}
                        }
                    }
                });
            }
        });
        ScriptedDevice { addr, hellos }
    }

    pub(crate) async fn dial_with(
        addr: std::net::SocketAddr,
        pair_key: [u8; 32],
        resume: Resume,
    ) -> Result<Connection, String> {
        let stream = tokio::net::TcpStream::connect(addr).await.unwrap();
        connect(
            Box::new(stream),
            Dial {
                local_device_id: "phone-1",
                target_device_id: "desk-1",
                pair_key,
                authority: addr.to_string(),
            },
            resume,
        )
        .await
    }

    #[tokio::test]
    async fn the_fleet_hello_carries_the_vector_cursor() {
        let key = [7u8; 32];
        let device = device(key, "phone-1", "desk-1").await;
        let plain = dial(device.addr, key).await.unwrap();
        assert!(
            plain.hello().get("fleet").is_none(),
            "no fleet member, no fleet answer"
        );
        let fleet = dial_with(
            device.addr,
            key,
            Resume {
                fleet: Some(json!({"protocol": 1, "cursor": {"desk-1": {"instanceId": "inst-1", "seq": 4}}})),
                ..Resume::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(fleet.hello()["fleet"]["cursorState"]["desk-1"], "resumed");
    }

    #[tokio::test]
    async fn handshake_hello_calls_events_and_acks() {
        let key = [42u8; 32];
        let mut device = device(key, "phone-1", "desk-1").await;
        let connection = dial(device.addr, key).await.unwrap();
        assert_eq!(connection.hello()["scope"], "account-device");
        assert_eq!(connection.instance_id().as_deref(), Some("inst-1"));

        let mut events = Vec::new();
        while events.len() < 2 {
            events.extend(connection.next_events().await.unwrap());
        }
        assert_eq!(
            events.iter().map(|event| event.seq).collect::<Vec<_>>(),
            [6, 7]
        );
        assert_eq!(events[1].json["payload"]["n"], 7);
        let mut acked = 0;
        while acked < 7 {
            acked = device.acks.recv().await.unwrap();
        }

        assert_eq!(
            connection.call("echo", json!({"x": 1})).await.unwrap(),
            json!({"x": 1})
        );
        let refused = connection.call("fail", json!({})).await.unwrap_err();
        assert_eq!(refused.code, -32000);
        assert!(!refused.transport);
        assert!(refused.message.starts_with("unsupported_in_native_host"));

        let gone = connection.call("bye", json!({})).await.unwrap_err();
        assert!(gone.transport);
        assert!(connection.next_events().await.is_err());
        assert!(connection.closed().is_some());
    }

    #[tokio::test]
    async fn a_wrong_pair_key_is_refused_before_any_frame() {
        let device = device([1u8; 32], "phone-1", "desk-1").await;
        let error = dial(device.addr, [2u8; 32]).await.err().unwrap();
        assert!(error.starts_with("mesh_refused"), "{error}");
    }

    #[tokio::test]
    async fn the_info_probe_reports_a_device_without_the_info_route() {
        let device = device([3u8; 32], "phone-1", "desk-1").await;
        let stream = tokio::net::TcpStream::connect(device.addr).await.unwrap();
        // The test device speaks WebSocket only: the probe sees a refusal.
        let error = probe_info(Box::new(stream), &device.addr.to_string())
            .await
            .unwrap_err();
        assert!(
            error.contains("refused") || error.contains("unreadable"),
            "{error}"
        );
        assert!(device.fingerprint.starts_with("sha256:"));
    }
}

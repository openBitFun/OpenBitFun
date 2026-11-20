//! Client side of OBP over the account mesh, for a controller that drives
//! another device of the same account (Peer Device Mode on OBP).
//!
//! A connection goes through the local EasyTier sidecar's loopback SOCKS5 to
//! the target's virtual IP, speaks TLS (the certificate is not CA-signed: its
//! fingerprint is bound into the account-device handshake instead), upgrades
//! to the OBP WebSocket with this device's handshake proof, checks the
//! target's proof in the `101` response, and then runs `hello`, `call` and
//! the event stream with credit/ack backpressure: an event is acknowledged
//! when the consumer takes it, so a slow consumer slows the server, never the
//! socket reader (call responses keep flowing).

use std::collections::HashMap;
use std::net::{Ipv4Addr, SocketAddr};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures::{SinkExt, StreamExt};
use openbitfun_mesh_service::handshake::{self, Claims, Role};
use openbitfun_mesh_service::{MESH_OBP_PORT_FIRST, MESH_OBP_PORT_LAST};
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::{mpsc, oneshot};
use tokio_rustls::client::TlsStream;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;

use super::mesh::{MeshAuthority, MeshInfo};
use super::store::sha256_hex;
use super::OBP_PROTOCOL_VERSION;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const PROBE_TIMEOUT: Duration = Duration::from_secs(6);
const DEFAULT_CREDIT_BYTES: u64 = 1024 * 1024;

/// How a controller reaches devices: its sidecar's SOCKS5 and its identity.
#[derive(Clone)]
pub struct MeshDialer {
    pub socks5: SocketAddr,
    pub authority: Arc<dyn MeshAuthority>,
}

/// A device to connect to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MeshTarget {
    pub device_id: String,
    pub virtual_ip: Ipv4Addr,
    /// The OBP mesh port when already known (from a probe); otherwise the
    /// port range is probed.
    pub port: Option<u16>,
}

/// Resume and window parameters of the `hello`.
#[derive(Debug, Clone, Default)]
pub struct MeshConnectOptions {
    /// Resume after this event `seq` of `instance_id`.
    pub last_seq: Option<u64>,
    pub instance_id: Option<String>,
    /// Event window in bytes (default 1 MiB).
    pub credit_bytes: Option<u64>,
}

/// One event from the remote backend.
#[derive(Debug, Clone, PartialEq)]
pub struct MeshObpEvent {
    pub seq: u64,
    pub event: String,
    pub payload: Value,
}

/// A failed remote call: the JSON-RPC error of the remote backend, or a
/// transport failure (`code` 0).
#[derive(Debug, Clone, PartialEq)]
pub struct MeshCallError {
    pub code: i64,
    pub message: String,
    pub data: Option<Value>,
}

impl std::fmt::Display for MeshCallError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl MeshCallError {
    fn transport(message: impl Into<String>) -> Self {
        Self {
            code: 0,
            message: message.into(),
            data: None,
        }
    }
}

type TlsSocket = TlsStream<TcpStream>;

/// SOCKS5 CONNECT (no authentication) to `ip:port` through `proxy`.
async fn socks5_connect(proxy: SocketAddr, ip: Ipv4Addr, port: u16) -> Result<TcpStream, String> {
    let mut stream = TcpStream::connect(proxy)
        .await
        .map_err(|error| format!("mesh_unavailable: the mesh sidecar is not reachable: {error}"))?;
    let _ = stream.set_nodelay(true);
    stream
        .write_all(&[5, 1, 0])
        .await
        .map_err(|error| format!("mesh SOCKS5 greeting failed: {error}"))?;
    let mut reply = [0u8; 2];
    stream
        .read_exact(&mut reply)
        .await
        .map_err(|error| format!("mesh SOCKS5 greeting failed: {error}"))?;
    if reply != [5, 0] {
        return Err("mesh SOCKS5 proxy refused the greeting".to_string());
    }
    let mut request = vec![5, 1, 0, 1];
    request.extend_from_slice(&ip.octets());
    request.extend_from_slice(&port.to_be_bytes());
    stream
        .write_all(&request)
        .await
        .map_err(|error| format!("mesh SOCKS5 connect failed: {error}"))?;
    let mut head = [0u8; 4];
    stream
        .read_exact(&mut head)
        .await
        .map_err(|error| format!("mesh SOCKS5 connect failed: {error}"))?;
    if head[1] != 0 {
        return Err(format!(
            "mesh_unreachable: {ip}:{port} is not reachable over the mesh (SOCKS5 reply {})",
            head[1]
        ));
    }
    let rest = match head[3] {
        1 => 4 + 2,
        4 => 16 + 2,
        3 => {
            let mut len = [0u8; 1];
            stream
                .read_exact(&mut len)
                .await
                .map_err(|error| format!("mesh SOCKS5 connect failed: {error}"))?;
            len[0] as usize + 2
        }
        other => return Err(format!("mesh SOCKS5 reply has address type {other}")),
    };
    let mut skip = vec![0u8; rest];
    stream
        .read_exact(&mut skip)
        .await
        .map_err(|error| format!("mesh SOCKS5 connect failed: {error}"))?;
    Ok(stream)
}

/// Accepts the server's self-signed certificate (the handshake authenticates
/// it) while still requiring proof of its private key, and records the
/// fingerprint the handshake binds.
#[derive(Debug)]
struct FingerprintRecorder {
    seen: Arc<Mutex<Option<String>>>,
    provider: Arc<rustls::crypto::CryptoProvider>,
}

impl rustls::client::danger::ServerCertVerifier for FingerprintRecorder {
    fn verify_server_cert(
        &self,
        end_entity: &rustls::pki_types::CertificateDer<'_>,
        _intermediates: &[rustls::pki_types::CertificateDer<'_>],
        _server_name: &rustls::pki_types::ServerName<'_>,
        _ocsp_response: &[u8],
        _now: rustls::pki_types::UnixTime,
    ) -> Result<rustls::client::danger::ServerCertVerified, rustls::Error> {
        *self.seen.lock().unwrap_or_else(|p| p.into_inner()) =
            Some(format!("sha256:{}", sha256_hex(end_entity.as_ref())));
        Ok(rustls::client::danger::ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &rustls::pki_types::CertificateDer<'_>,
        dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls12_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &rustls::pki_types::CertificateDer<'_>,
        dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        self.provider
            .signature_verification_algorithms
            .supported_schemes()
    }
}

/// TLS over `stream`; returns the stream and the certificate fingerprint.
async fn tls_connect(stream: TcpStream) -> Result<(TlsSocket, String), String> {
    crate::ensure_rustls_crypto_provider();
    let provider = rustls::crypto::CryptoProvider::get_default()
        .cloned()
        .ok_or_else(|| "no TLS crypto provider is installed".to_string())?;
    let seen = Arc::new(Mutex::new(None));
    let verifier = Arc::new(FingerprintRecorder {
        seen: Arc::clone(&seen),
        provider,
    });
    let mut config = rustls::ClientConfig::builder()
        .dangerous()
        .with_custom_certificate_verifier(verifier)
        .with_no_client_auth();
    config.alpn_protocols = vec![b"http/1.1".to_vec()];
    let connector = tokio_rustls::TlsConnector::from(Arc::new(config));
    let name = rustls::pki_types::ServerName::try_from("openbitfun.local")
        .map_err(|error| error.to_string())?;
    let tls = connector
        .connect(name, stream)
        .await
        .map_err(|error| format!("mesh TLS handshake failed: {error}"))?;
    let fingerprint = seen
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .clone()
        .ok_or_else(|| "the mesh peer presented no certificate".to_string())?;
    Ok((tls, fingerprint))
}

impl MeshDialer {
    async fn open(&self, ip: Ipv4Addr, port: u16) -> Result<(TlsSocket, String), String> {
        let stream = socks5_connect(self.socks5, ip, port).await?;
        tls_connect(stream).await
    }

    /// `GET /obp/mesh/info` on one port.
    pub async fn probe_info(&self, ip: Ipv4Addr, port: u16) -> Result<MeshInfo, String> {
        let probe = async {
            let (mut tls, fingerprint) = self.open(ip, port).await?;
            let request = format!(
                "GET /obp/mesh/info HTTP/1.1\r\nHost: {ip}:{port}\r\nAccept: application/json\r\nConnection: close\r\n\r\n"
            );
            tls.write_all(request.as_bytes())
                .await
                .map_err(|error| format!("mesh info request failed: {error}"))?;
            let mut response = Vec::new();
            let _ = tls.take(64 * 1024).read_to_end(&mut response).await;
            let text = String::from_utf8_lossy(&response);
            let (head, body) = text
                .split_once("\r\n\r\n")
                .ok_or_else(|| "unreadable mesh info response".to_string())?;
            if !head.starts_with("HTTP/1.1 200") {
                let status = head.lines().next().unwrap_or_default();
                return Err(format!("mesh info refused: {status}"));
            }
            let info: MeshInfo = serde_json::from_str(body.trim())
                .map_err(|error| format!("unreadable mesh info: {error}"))?;
            if info.fingerprint != fingerprint {
                return Err("the mesh info names another certificate".to_string());
            }
            Ok(info)
        };
        tokio::time::timeout(PROBE_TIMEOUT, probe)
            .await
            .map_err(|_| format!("mesh_unreachable: {ip}:{port} did not answer"))?
    }

    /// Finds `target`'s OBP mesh port (the known one, else the range).
    pub async fn locate(&self, target: &MeshTarget) -> Result<(u16, MeshInfo), String> {
        let ports: Vec<u16> = match target.port {
            Some(port) => vec![port],
            None => (MESH_OBP_PORT_FIRST..=MESH_OBP_PORT_LAST).collect(),
        };
        let mut last_error = format!(
            "mesh_unreachable: device {} has no OBP mesh listener",
            target.device_id
        );
        for port in ports {
            match self.probe_info(target.virtual_ip, port).await {
                Ok(info) if info.device_id == target.device_id => return Ok((port, info)),
                Ok(info) => {
                    last_error = format!(
                        "mesh port {port} at {} belongs to device {}",
                        target.virtual_ip, info.device_id
                    )
                }
                Err(error) => last_error = error,
            }
        }
        Err(last_error)
    }

    /// Opens an authenticated OBP connection to `target`.
    pub async fn connect(
        &self,
        target: &MeshTarget,
        options: MeshConnectOptions,
    ) -> Result<MeshObpConnection, String> {
        tokio::time::timeout(CONNECT_TIMEOUT, self.connect_inner(target, options))
            .await
            .map_err(|_| {
                format!(
                    "mesh_unreachable: connecting to device {} timed out",
                    target.device_id
                )
            })?
    }

    async fn connect_inner(
        &self,
        target: &MeshTarget,
        options: MeshConnectOptions,
    ) -> Result<MeshObpConnection, String> {
        let local = self
            .authority
            .local_device_id()
            .ok_or_else(|| "mesh_signed_out: sign in to reach your other devices".to_string())?;
        let (port, _) = self.locate(target).await?;
        let pair_key = self.authority.pair_key(&target.device_id).await?;
        let key = handshake::handshake_key(&pair_key);
        let (tls, fingerprint) = self.open(target.virtual_ip, port).await?;
        let claims = Claims {
            client_device_id: local.clone(),
            server_device_id: target.device_id.clone(),
            cert_fingerprint: fingerprint,
            time_ms: openbitfun_mesh_service::now_ms(),
            nonce: handshake::new_nonce(),
        };
        let mut request = format!("ws://{}:{port}/obp", target.virtual_ip)
            .into_client_request()
            .map_err(|error| error.to_string())?;
        let headers = request.headers_mut();
        let header = |value: String| {
            value
                .parse()
                .map_err(|_| "invalid handshake header".to_string())
        };
        headers.insert(
            "authorization",
            header(format!(
                "{} {}",
                handshake::AUTH_SCHEME,
                handshake::prove(&key, Role::Client, &claims)
            ))?,
        );
        headers.insert(handshake::HEADER_DEVICE, header(local)?);
        headers.insert(handshake::HEADER_TARGET, header(target.device_id.clone())?);
        headers.insert(handshake::HEADER_TIME, header(claims.time_ms.to_string())?);
        headers.insert(handshake::HEADER_NONCE, header(claims.nonce.clone())?);
        let (socket, response) = tokio_tungstenite::client_async(request, tls)
            .await
            .map_err(|error| match error {
                tokio_tungstenite::tungstenite::Error::Http(response) => {
                    let body = response
                        .body()
                        .as_ref()
                        .map(|body| String::from_utf8_lossy(body).into_owned())
                        .unwrap_or_default();
                    format!(
                        "mesh_refused: device {} refused the connection ({}): {}",
                        target.device_id,
                        response.status(),
                        body
                    )
                }
                other => format!("mesh OBP upgrade failed: {other}"),
            })?;
        let server_proof = response
            .headers()
            .get(handshake::HEADER_SERVER_PROOF)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default();
        if !handshake::verify(&key, Role::Server, &claims, server_proof) {
            return Err(format!(
                "mesh_impostor: the device at {} could not prove it is {}",
                target.virtual_ip, target.device_id
            ));
        }
        MeshObpConnection::start(socket, target.device_id.clone(), options).await
    }
}

enum Outgoing {
    Call {
        command: String,
        args: Value,
        reply: oneshot::Sender<Result<Value, MeshCallError>>,
    },
    Ack(u64),
    Close,
}

/// Runs calls on a [`MeshObpConnection`]; fails with a transport error once
/// the connection closed.
#[derive(Clone)]
pub struct MeshCaller {
    outgoing: mpsc::UnboundedSender<Outgoing>,
}

impl MeshCaller {
    /// Runs `command` on the device.
    pub async fn call(&self, command: &str, args: Value) -> Result<Value, MeshCallError> {
        let (reply, answer) = oneshot::channel();
        self.outgoing
            .send(Outgoing::Call {
                command: command.to_string(),
                args,
                reply,
            })
            .map_err(|_| MeshCallError::transport("the mesh connection is closed"))?;
        answer
            .await
            .map_err(|_| MeshCallError::transport("the mesh connection closed during the call"))?
    }

    /// Whether the connection behind this handle is gone.
    pub fn is_closed(&self) -> bool {
        self.outgoing.is_closed()
    }
}

/// An authenticated OBP connection to another device.
pub struct MeshObpConnection {
    device_id: String,
    hello: Value,
    outgoing: mpsc::UnboundedSender<Outgoing>,
    events: mpsc::UnboundedReceiver<MeshObpEvent>,
    acks: bool,
    task: Option<tokio::task::JoinHandle<()>>,
}

type WsStream = tokio_tungstenite::WebSocketStream<TlsSocket>;

impl MeshObpConnection {
    async fn start(
        mut socket: WsStream,
        device_id: String,
        options: MeshConnectOptions,
    ) -> Result<Self, String> {
        let credit = options.credit_bytes.unwrap_or(DEFAULT_CREDIT_BYTES);
        let mut params = json!({
            "protocol": OBP_PROTOCOL_VERSION,
            "client": format!("openbitfun-mesh/{}", crate::VERSION),
            "ack": true,
            "creditBytes": credit,
        });
        if let (Some(seq), Some(instance)) = (options.last_seq, options.instance_id) {
            params["lastSeq"] = json!(seq);
            params["instanceId"] = json!(instance);
        }
        let hello = json!({"jsonrpc": "2.0", "id": 0, "method": "hello", "params": params});
        socket
            .send(Message::Text(hello.to_string().into()))
            .await
            .map_err(|error| format!("mesh hello failed: {error}"))?;
        let mut early_events = Vec::new();
        let hello = loop {
            let message = socket
                .next()
                .await
                .ok_or_else(|| "the device closed the connection during hello".to_string())?
                .map_err(|error| format!("mesh hello failed: {error}"))?;
            let Message::Text(text) = message else {
                continue;
            };
            let frame: Value = serde_json::from_str(text.as_str())
                .map_err(|error| format!("unreadable hello response: {error}"))?;
            if frame["id"] == json!(0) {
                if let Some(error) = frame.get("error") {
                    return Err(format!("the device refused hello: {error}"));
                }
                break frame["result"].clone();
            }
            if frame["method"] == "event" {
                early_events.push(frame["params"].clone());
            }
        };
        let acks = hello["creditBytes"].is_u64();
        let (outgoing, requests) = mpsc::unbounded_channel();
        let (event_sender, events) = mpsc::unbounded_channel();
        for params in early_events {
            if let Some(event) = parse_event(&params) {
                let _ = event_sender.send(event);
            }
        }
        let task = tokio::spawn(pump(socket, requests, event_sender));
        Ok(Self {
            device_id,
            hello,
            outgoing,
            events,
            acks,
            task: Some(task),
        })
    }

    /// The device this connection reaches.
    pub fn device_id(&self) -> &str {
        &self.device_id
    }

    /// The `hello` result: scope (`account-device`), capabilities, backend
    /// identity, `lastSeq` and the negotiated window.
    pub fn hello(&self) -> &Value {
        &self.hello
    }

    /// Runs `command` on the device.
    pub async fn call(&self, command: &str, args: Value) -> Result<Value, MeshCallError> {
        self.caller().call(command, args).await
    }

    /// A cloneable handle that runs calls on this connection while the
    /// connection itself is held by whoever reads its event stream (Peer
    /// Device Mode keeps the two apart: calls come from the UI, events go to
    /// a long-poll ring).
    pub fn caller(&self) -> MeshCaller {
        MeshCaller {
            outgoing: self.outgoing.clone(),
        }
    }

    /// The next event (acknowledged as it is taken); `None` once closed.
    pub async fn next_event(&mut self) -> Option<MeshObpEvent> {
        let event = self.events.recv().await?;
        if self.acks {
            let _ = self.outgoing.send(Outgoing::Ack(event.seq));
        }
        Some(event)
    }

    /// Closes the connection.
    pub async fn close(mut self) {
        let _ = self.outgoing.send(Outgoing::Close);
        if let Some(task) = self.task.take() {
            let _ = tokio::time::timeout(Duration::from_secs(3), task).await;
        }
    }
}

impl Drop for MeshObpConnection {
    fn drop(&mut self) {
        let _ = self.outgoing.send(Outgoing::Close);
    }
}

fn parse_event(params: &Value) -> Option<MeshObpEvent> {
    Some(MeshObpEvent {
        seq: params["seq"].as_u64()?,
        event: params["event"].as_str()?.to_string(),
        payload: params["payload"].clone(),
    })
}

async fn pump(
    socket: WsStream,
    mut requests: mpsc::UnboundedReceiver<Outgoing>,
    events: mpsc::UnboundedSender<MeshObpEvent>,
) {
    let (mut sink, mut stream) = socket.split();
    let mut pending: HashMap<u64, oneshot::Sender<Result<Value, MeshCallError>>> = HashMap::new();
    let mut next_id = 1u64;
    let closed = loop {
        tokio::select! {
            request = requests.recv() => match request {
                Some(Outgoing::Call { command, args, reply }) => {
                    let id = next_id;
                    next_id += 1;
                    let frame = json!({"jsonrpc": "2.0", "id": id, "method": "call",
                        "params": {"command": command, "args": args}});
                    if let Err(error) = sink.send(Message::Text(frame.to_string().into())).await {
                        let _ = reply.send(Err(MeshCallError::transport(format!("mesh send failed: {error}"))));
                        break "the mesh connection failed".to_string();
                    }
                    pending.insert(id, reply);
                }
                Some(Outgoing::Ack(seq)) => {
                    let frame = json!({"jsonrpc": "2.0", "method": "ack", "params": {"seq": seq}});
                    if sink.send(Message::Text(frame.to_string().into())).await.is_err() {
                        break "the mesh connection failed".to_string();
                    }
                }
                Some(Outgoing::Close) | None => {
                    let _ = sink.send(Message::Close(None)).await;
                    break "the mesh connection was closed".to_string();
                }
            },
            message = stream.next() => {
                let text = match message {
                    Some(Ok(Message::Text(text))) => text,
                    Some(Ok(Message::Close(frame))) => {
                        break format!("the device closed the connection: {}",
                            frame.map(|frame| frame.reason.to_string()).unwrap_or_default());
                    }
                    Some(Ok(_)) => continue,
                    Some(Err(error)) => break format!("the mesh connection failed: {error}"),
                    None => break "the device closed the connection".to_string(),
                };
                let Ok(frame) = serde_json::from_str::<Value>(text.as_str()) else {
                    continue;
                };
                if frame["method"] == "event" {
                    if let Some(event) = parse_event(&frame["params"]) {
                        let _ = events.send(event);
                    }
                    continue;
                }
                let Some(id) = frame["id"].as_u64() else { continue };
                let Some(reply) = pending.remove(&id) else { continue };
                let result = match frame.get("error") {
                    Some(error) => Err(MeshCallError {
                        code: error["code"].as_i64().unwrap_or_default(),
                        message: error["message"].as_str().unwrap_or_default().to_string(),
                        data: error.get("data").cloned(),
                    }),
                    None => Ok(frame["result"].clone()),
                };
                let _ = reply.send(result);
            }
        }
    };
    for (_, reply) in pending.drain() {
        let _ = reply.send(Err(MeshCallError::transport(closed.clone())));
    }
}

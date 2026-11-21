//! The controller side of OBP over the account device network: one copy for
//! every controller (the desktop's Peer Device Mode, Detached Dispatch and IM
//! bots through `MeshDialer`; the phone app through [`connect`] on its own
//! Link streams).
//!
//! A connection is a byte stream to the device's OBP port (a Link virtual
//! TCP stream), TLS to the device's self-signed certificate (its fingerprint
//! is bound into the account-device handshake instead of a CA), a WebSocket
//! upgrade carrying this device's proof, the device's proof checked in the
//! `101`, then JSON-RPC `hello`, `call`, `ack` and the event stream with
//! credit/ack backpressure: an event is acknowledged when the consumer takes
//! it, so a slow consumer slows the server, never the socket reader (call
//! responses keep flowing).

use std::collections::{HashMap, VecDeque};
use std::net::Ipv4Addr;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures::{SinkExt, StreamExt};
use openbitfun_link::handshake::{self, Claims, Role};
use openbitfun_link::{MESH_OBP_PORT_FIRST, MESH_OBP_PORT_LAST};
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::{mpsc, oneshot, Notify};
use tokio_rustls::client::TlsStream;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;

pub use crate::authority::{MeshAuthority, MeshInfo, MeshIo};
use crate::{sha256_hex, OBP_PROTOCOL_VERSION};

#[cfg(feature = "fleet")]
pub mod cloud;
pub mod links;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const PROBE_TIMEOUT: Duration = Duration::from_secs(6);
/// The event window a controller asks for by default.
pub const DEFAULT_CREDIT_BYTES: u64 = 1024 * 1024;
/// The most events [`ObpConnection::next_events`] takes at once.
pub const MAX_EVENT_BATCH: usize = 512;

/// A TLS stream to a device.
pub type TlsSocket = TlsStream<Box<dyn MeshIo>>;
type WsError = tokio_tungstenite::tungstenite::Error;

/// A message transport an OBP connection runs over: a WebSocket to a
/// device, or the end-to-end channel to the account's cloud node
/// ([`cloud`]).
pub(crate) trait ObpSocket:
    futures::Stream<Item = Result<Message, WsError>>
    + futures::Sink<Message, Error = WsError>
    + Unpin
    + Send
    + 'static
{
}
impl<T> ObpSocket for T where
    T: futures::Stream<Item = Result<Message, WsError>>
        + futures::Sink<Message, Error = WsError>
        + Unpin
        + Send
        + 'static
{
}

/// The `client` a controller names in its `hello` by default.
pub fn default_client_name() -> String {
    format!("openbitfun-mesh/{}", env!("CARGO_PKG_VERSION"))
}

/// Accepts the device's self-signed certificate (the handshake authenticates
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

/// TLS over `stream`; returns the stream and the certificate fingerprint
/// (`sha256:<hex>`).
pub async fn tls_connect(stream: Box<dyn MeshIo>) -> Result<(TlsSocket, String), String> {
    crate::ensure_tls_provider();
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

/// `GET /obp/mesh/info` over `stream` (`host` is the `Host` header). The
/// answer must name the certificate the stream presented.
pub async fn probe_info(stream: Box<dyn MeshIo>, host: &str) -> Result<MeshInfo, String> {
    let (mut tls, fingerprint) = tls_connect(stream).await?;
    let request = format!(
        "GET /obp/mesh/info HTTP/1.1\r\nHost: {host}\r\nAccept: application/json\r\nConnection: close\r\n\r\n"
    );
    tls.write_all(request.as_bytes())
        .await
        .map_err(|error| format!("mesh info request failed: {error}"))?;
    let mut response = Vec::new();
    let _ = (&mut tls).take(64 * 1024).read_to_end(&mut response).await;
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
}

/// Who connects to whom, and with which pair key.
pub struct Dial<'a> {
    pub local_device_id: &'a str,
    pub target_device_id: &'a str,
    pub pair_key: [u8; 32],
    /// `host:port` of the device's OBP listener (its virtual address).
    pub authority: String,
    /// What the `hello` names as the client (`openbitfun-mobile/1.2.3`).
    pub client: String,
}

/// Resume and window parameters of the `hello`.
#[derive(Debug, Clone, Default)]
pub struct MeshConnectOptions {
    /// Resume after this event `seq` of `instance_id`.
    pub last_seq: Option<u64>,
    pub instance_id: Option<String>,
    /// Event window in bytes (default 1 MiB).
    pub credit_bytes: Option<u64>,
    /// Only events whose name starts with one of these (hello
    /// `events: {prefixes}`; `backend://events-dropped` always passes). A
    /// server that applies the filter echoes it in its hello answer; older
    /// servers ignore it and send everything.
    pub event_prefixes: Option<Vec<String>>,
    /// The fleet member of the hello (`{protocol, cursor}`): a fleet entry
    /// then tags every event with `origin` and `originInstance`.
    pub fleet: Option<Value>,
}

/// Opens an authenticated OBP connection over `stream` (no timeout: callers
/// bound it).
pub async fn connect(
    stream: Box<dyn MeshIo>,
    dial: Dial<'_>,
    options: MeshConnectOptions,
) -> Result<MeshObpConnection, String> {
    let key = handshake::handshake_key(&dial.pair_key);
    let (tls, fingerprint) = tls_connect(stream).await?;
    let claims = Claims {
        client_device_id: dial.local_device_id.to_string(),
        server_device_id: dial.target_device_id.to_string(),
        cert_fingerprint: fingerprint,
        time_ms: openbitfun_link::now_ms(),
        nonce: handshake::new_nonce(),
    };
    let mut request = format!("ws://{}/obp", dial.authority)
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
    headers.insert(
        handshake::HEADER_DEVICE,
        header(claims.client_device_id.clone())?,
    );
    headers.insert(
        handshake::HEADER_TARGET,
        header(claims.server_device_id.clone())?,
    );
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
                    dial.target_device_id,
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
            dial.authority, dial.target_device_id
        ));
    }
    MeshObpConnection::start(
        socket,
        dial.target_device_id.to_string(),
        options,
        dial.client,
    )
    .await
}

/// A boxed future opening a stream on the device network.
pub type MeshOpenFuture<'a> = std::pin::Pin<
    Box<dyn std::future::Future<Output = Result<Box<dyn MeshIo>, String>> + Send + 'a>,
>;

/// Opens streams to virtual addresses of the device network.
pub trait MeshConnector: Send + Sync + 'static {
    fn open(&self, ip: Ipv4Addr, port: u16) -> MeshOpenFuture<'_>;
}

/// How a controller reaches devices: its Link node and its identity.
#[derive(Clone)]
pub struct MeshDialer {
    pub connector: Arc<dyn MeshConnector>,
    pub authority: Arc<dyn MeshAuthority>,
}

/// Plain loopback TCP as the device network (tests: every virtual address
/// is this machine, as a single-host network would deliver it).
#[cfg(any(test, feature = "test-support"))]
pub struct LoopbackConnector;

#[cfg(any(test, feature = "test-support"))]
impl MeshConnector for LoopbackConnector {
    fn open(&self, _ip: Ipv4Addr, port: u16) -> MeshOpenFuture<'_> {
        Box::pin(async move {
            let stream = tokio::net::TcpStream::connect((Ipv4Addr::LOCALHOST, port))
                .await
                .map_err(|error| format!("mesh_unreachable: port {port}: {error}"))?;
            let _ = stream.set_nodelay(true);
            Ok(Box::new(stream) as Box<dyn MeshIo>)
        })
    }
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

/// One event from the remote backend.
#[derive(Debug, Clone, PartialEq)]
pub struct MeshObpEvent {
    pub seq: u64,
    pub event: String,
    pub payload: Value,
    /// The device the event comes from, on a fleet stream (hello `fleet`);
    /// `seq` is then that origin's own.
    pub origin: Option<String>,
    /// The backend instance of `origin`, on a fleet stream.
    pub origin_instance: Option<String>,
}

impl MeshObpEvent {
    /// The event as the in-process stream shapes it: `{seq, event, payload}`
    /// (plus `origin` and `originInstance` on a fleet stream).
    pub fn to_wire(&self) -> Value {
        let mut wire = json!({"seq": self.seq, "event": self.event, "payload": self.payload});
        if let Some(origin) = &self.origin {
            wire["origin"] = json!(origin);
        }
        if let Some(instance) = &self.origin_instance {
            wire["originInstance"] = json!(instance);
        }
        wire
    }
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

    /// The connection failed (not the remote command).
    pub fn is_transport(&self) -> bool {
        self.code == 0
    }
}

impl MeshDialer {
    async fn open(&self, ip: Ipv4Addr, port: u16) -> Result<Box<dyn MeshIo>, String> {
        self.connector.open(ip, port).await
    }

    /// `GET /obp/mesh/info` on one port.
    pub async fn probe_info(&self, ip: Ipv4Addr, port: u16) -> Result<MeshInfo, String> {
        let probe = async {
            let stream = self.open(ip, port).await?;
            probe_info(stream, &format!("{ip}:{port}")).await
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
        let stream = self.open(target.virtual_ip, port).await?;
        connect(
            stream,
            Dial {
                local_device_id: &local,
                target_device_id: &target.device_id,
                pair_key,
                authority: format!("{}:{port}", target.virtual_ip),
                client: default_client_name(),
            },
            options,
        )
        .await
    }
}

enum Outgoing {
    Call {
        command: String,
        args: Value,
        reply: oneshot::Sender<Result<Value, MeshCallError>>,
    },
    /// `{seq}`, plus the vector cursor on a fleet stream.
    Ack(u64, Option<Value>),
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

/// What the reader task shares with the connection.
#[derive(Default)]
struct Inbox {
    events: Mutex<VecDeque<MeshObpEvent>>,
    /// Fleet streams: `{[origin]: {instanceId, seq}}` of the events taken.
    cursor: Mutex<serde_json::Map<String, Value>>,
    closed: Mutex<Option<String>>,
    notify: Notify,
}

impl Inbox {
    fn push(&self, event: MeshObpEvent) {
        self.events
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .push_back(event);
        self.notify.notify_waiters();
    }

    fn closed(&self) -> Option<String> {
        self.closed
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .clone()
    }
}

/// An authenticated OBP connection to another device.
pub struct MeshObpConnection {
    device_id: String,
    hello: Value,
    outgoing: mpsc::UnboundedSender<Outgoing>,
    inbox: Arc<Inbox>,
    acks: bool,
    task: Option<tokio::task::JoinHandle<()>>,
}

impl MeshObpConnection {
    pub(crate) async fn start<S: ObpSocket>(
        mut socket: S,
        device_id: String,
        options: MeshConnectOptions,
        client: String,
    ) -> Result<Self, String> {
        let credit = options.credit_bytes.unwrap_or(DEFAULT_CREDIT_BYTES);
        let mut params = json!({
            "protocol": OBP_PROTOCOL_VERSION,
            "client": client,
            "ack": true,
            "creditBytes": credit,
        });
        if let (Some(seq), Some(instance)) = (options.last_seq, options.instance_id) {
            params["lastSeq"] = json!(seq);
            params["instanceId"] = json!(instance);
        }
        if let Some(prefixes) = options.event_prefixes {
            params["events"] = json!({ "prefixes": prefixes });
        }
        if let Some(fleet) = options.fleet {
            params["fleet"] = fleet;
        }
        let hello = json!({"jsonrpc": "2.0", "id": 0, "method": "hello", "params": params});
        socket
            .send(Message::Text(hello.to_string().into()))
            .await
            .map_err(|error| format!("mesh hello failed: {error}"))?;
        let inbox = Arc::new(Inbox::default());
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
                if let Some(event) = parse_event(&frame["params"]) {
                    inbox.push(event);
                }
            }
        };
        let acks = hello["creditBytes"].is_u64();
        let (outgoing, requests) = mpsc::unbounded_channel();
        let task = tokio::spawn(pump(socket, requests, Arc::clone(&inbox)));
        Ok(Self {
            device_id,
            hello,
            outgoing,
            inbox,
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

    /// The backend process instance (the resume key).
    pub fn instance_id(&self) -> Option<String> {
        self.hello["backend"]["instanceId"]
            .as_str()
            .map(str::to_string)
    }

    /// Why the connection ended, once it did.
    pub fn closed(&self) -> Option<String> {
        self.inbox.closed()
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

    /// Waits for events and takes up to `max` of them (acknowledging the
    /// last one); `Err` with the reason once the connection ended and
    /// nothing is left.
    pub async fn next_events(&self, max: usize) -> Result<Vec<MeshObpEvent>, String> {
        loop {
            let notified = self.inbox.notify.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            {
                let mut events = self.inbox.events.lock().unwrap_or_else(|p| p.into_inner());
                if !events.is_empty() {
                    let count = events.len().min(max.max(1));
                    let batch: Vec<MeshObpEvent> = events.drain(..count).collect();
                    drop(events);
                    if self.acks {
                        if let Some(last) = batch.last() {
                            let cursor = self.advance_cursor(&batch);
                            let _ = self.outgoing.send(Outgoing::Ack(last.seq, cursor));
                        }
                    }
                    return Ok(batch);
                }
            }
            if let Some(reason) = self.closed() {
                return Err(reason);
            }
            notified.await;
        }
    }

    /// Moves the fleet cursor past `batch`; the cursor to ack with, on a
    /// fleet stream (events tagged with their origin).
    fn advance_cursor(&self, batch: &[MeshObpEvent]) -> Option<Value> {
        let mut cursor = self.inbox.cursor.lock().unwrap_or_else(|p| p.into_inner());
        let mut tagged = false;
        for event in batch {
            let (Some(origin), Some(instance)) = (&event.origin, &event.origin_instance) else {
                continue;
            };
            tagged = true;
            let same = cursor
                .get(origin)
                .is_some_and(|position| position["instanceId"] == json!(instance));
            if !same
                || cursor[origin]["seq"]
                    .as_u64()
                    .is_none_or(|seq| event.seq > seq)
            {
                cursor.insert(
                    origin.clone(),
                    json!({ "instanceId": instance, "seq": event.seq }),
                );
            }
        }
        (tagged || !cursor.is_empty()).then(|| Value::Object(cursor.clone()))
    }

    /// The next event (acknowledged as it is taken); `None` once closed.
    pub async fn next_event(&self) -> Option<MeshObpEvent> {
        self.next_events(1).await.ok()?.into_iter().next()
    }

    /// Asks the connection to close (returns at once).
    pub fn request_close(&self) {
        let _ = self.outgoing.send(Outgoing::Close);
    }

    /// Closes the connection and waits briefly for it to finish.
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
        origin: params["origin"].as_str().map(str::to_string),
        origin_instance: params["originInstance"].as_str().map(str::to_string),
    })
}

async fn pump<S: ObpSocket>(
    socket: S,
    mut requests: mpsc::UnboundedReceiver<Outgoing>,
    inbox: Arc<Inbox>,
) {
    let (mut sink, mut stream) = socket.split();
    let mut pending: HashMap<u64, oneshot::Sender<Result<Value, MeshCallError>>> = HashMap::new();
    let mut next_id = 1u64;
    // The device pings nothing at this layer; Link keeps the tunnel alive.
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
                Some(Outgoing::Ack(seq, cursor)) => {
                    let mut params = json!({"seq": seq});
                    if let Some(cursor) = cursor {
                        params["cursor"] = cursor;
                    }
                    let frame = json!({"jsonrpc": "2.0", "method": "ack", "params": params});
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
                        inbox.push(event);
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
    *inbox.closed.lock().unwrap_or_else(|p| p.into_inner()) = Some(closed);
    inbox.notify.notify_waiters();
}

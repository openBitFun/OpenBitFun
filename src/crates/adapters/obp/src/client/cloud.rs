//! The account's cloud node (`hostKind: "cloud"`, the OpenBitFun superagent)
//! as a peer of the fleet layer.
//!
//! The cloud node is not on the device network: an entry reaches it at
//! `wss://<domain>/agent/obp` (an nginx location on the account server,
//! loopback behind it). Inside that WebSocket the binary frames carry the
//! same end-to-end channel a browser uses to reach a device (`obp-e2e-v1`,
//! [`crate::server::e2e`]): this device's account-device proof with the pair
//! key of its directory key and the node's (looked up like any other device
//! of the account through [`MeshAuthority::pair_key`]), fresh ephemeral keys,
//! then AES-256-GCM records. The server front end and nginx see ciphertext
//! only. Inside the channel the connection is plain OBP (`hello`, `call`,
//! `ack`, events), so [`super::links::PeerLinks`] holds it like any link.
//!
//! [`WithCloudNode`] is the [`PeerConnector`] a fleet host installs: cloud
//! device ids (`cloud-<hash>`) go to the cloud dialer, every other id to the
//! host's Link connector. A host built without a cloud dialer refuses the
//! cloud id with `cloud_connector_unavailable`, and its presence lists the
//! node as unknown (`fleet::host::merge_presence`).
//!
//! Remote scenarios: this is how an entry (desktop or CLI) serves
//! `superagent_*` to every frontend (`fleet_call {target: "cloud-…"}`). The
//! node owns its conversations and jobs; dropping the link never cancels a
//! turn.

use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};
use std::time::Duration;

use base64::Engine as _;
use futures::{SinkExt, StreamExt};
use openbitfun_link::handshake::{self, Claims, Role};
use openbitfun_product_domains::superagent::CLOUD_DEVICE_ID_PREFIX;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_tungstenite::tungstenite::protocol::CloseFrame;
use tokio_tungstenite::tungstenite::Message;
use x25519_dalek::{PublicKey, StaticSecret};

use super::links::{ConnectFuture, PeerConnector};
use super::{MeshConnectOptions, MeshObpConnection, MeshOpenFuture, WsError};
use crate::authority::{MeshAuthority, MeshIo};
use crate::server::e2e::{
    client_fingerprint, derive_keys, read_record, server_fingerprint, write_record, ClientHello,
    RecordCipher, ServerHello, MAGIC, RECORD_MAX, VERSION,
};

/// The cloud node's OBP endpoint on the account server.
pub const DEFAULT_CLOUD_NODE_URL: &str = "wss://super.openbitfun.com/agent/obp";
/// The path of that endpoint on any account server origin.
pub const CLOUD_NODE_PATH: &str = "/agent/obp";
/// The error prefix of a host that has no cloud dialer.
pub const CLOUD_CONNECTOR_UNAVAILABLE: &str = "cloud_connector_unavailable";
/// The error prefix when the cloud node cannot be reached.
pub const CLOUD_UNREACHABLE: &str = "cloud_unreachable";

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const HELLO_MAX: usize = 4 * 1024;
const BRIDGE_BUFFER: usize = 256 * 1024;

const TYPE_TEXT: u8 = 1;
const TYPE_BINARY: u8 = 2;
const TYPE_PING: u8 = 3;
const TYPE_PONG: u8 = 4;
const TYPE_CLOSE: u8 = 5;

/// Whether `device_id` names an account's cloud node (`cloud-<hash>`).
pub fn is_cloud_device_id(device_id: &str) -> bool {
    device_id
        .strip_prefix(CLOUD_DEVICE_ID_PREFIX)
        .is_some_and(|hash| !hash.is_empty())
        && handshake::valid_device_id(device_id)
}

/// The cloud node endpoint of the account server behind `relay_url` (its
/// origin, `https` → `wss`), or `None` for a URL that is not http(s).
pub fn cloud_node_url(relay_url: &str) -> Option<String> {
    let trimmed = relay_url.trim();
    let (scheme, rest) = if let Some(rest) = trimmed.strip_prefix("https://") {
        ("wss", rest)
    } else if let Some(rest) = trimmed.strip_prefix("http://") {
        ("ws", rest)
    } else {
        return None;
    };
    let authority = rest.split(['/', '?', '#']).next().unwrap_or_default();
    if authority.is_empty() {
        return None;
    }
    Some(format!("{scheme}://{authority}{CLOUD_NODE_PATH}"))
}

/// Opens the byte stream that carries the end-to-end channel to the cloud
/// node (production: [`WssCloudStream`]; tests: a loopback stream).
pub trait CloudStreamOpener: Send + Sync + 'static {
    fn open(&self) -> MeshOpenFuture<'_>;
}

/// The cloud node endpoint over WebSocket (`wss://`, or `ws://` for a
/// loopback deployment); its binary frames carry the channel's bytes.
pub struct WssCloudStream {
    url: String,
}

impl WssCloudStream {
    pub fn new(url: impl Into<String>) -> Arc<Self> {
        Arc::new(Self { url: url.into() })
    }
}

impl CloudStreamOpener for WssCloudStream {
    fn open(&self) -> MeshOpenFuture<'_> {
        Box::pin(open_websocket(self.url.clone()))
    }
}

/// Opens the cloud node endpoint at `url` (`wss://…/agent/obp`) and returns
/// the byte stream its binary frames carry (for hosts whose own opener
/// resolves the address per connection).
pub async fn open_websocket(url: String) -> Result<Box<dyn MeshIo>, String> {
    let request = url
        .as_str()
        .into_client_request()
        .map_err(|error| format!("{CLOUD_UNREACHABLE}: invalid cloud node address: {error}"))?;
    let uri = request.uri().clone();
    let secure = match uri.scheme_str() {
        Some("wss") => true,
        Some("ws") => false,
        _ => {
            return Err(format!(
                "{CLOUD_UNREACHABLE}: the cloud node address must be ws(s)"
            ))
        }
    };
    let host = uri
        .host()
        .ok_or_else(|| format!("{CLOUD_UNREACHABLE}: the cloud node address has no host"))?
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_string();
    let port = uri.port_u16().unwrap_or(if secure { 443 } else { 80 });
    let tcp = tokio::net::TcpStream::connect((host.as_str(), port))
        .await
        .map_err(|error| format!("{CLOUD_UNREACHABLE}: {error}"))?;
    let _ = tcp.set_nodelay(true);
    if secure {
        crate::ensure_tls_provider();
        let roots =
            rustls::RootCertStore::from_iter(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
        let config = rustls::ClientConfig::builder()
            .with_root_certificates(roots)
            .with_no_client_auth();
        let name = rustls::pki_types::ServerName::try_from(host.clone())
            .map_err(|error| format!("{CLOUD_UNREACHABLE}: {error}"))?;
        let tls = tokio_rustls::TlsConnector::from(Arc::new(config))
            .connect(name, tcp)
            .await
            .map_err(|error| format!("{CLOUD_UNREACHABLE}: TLS handshake failed: {error}"))?;
        upgrade(request, tls).await
    } else {
        upgrade(request, tcp).await
    }
}

async fn upgrade<S>(
    request: tokio_tungstenite::tungstenite::handshake::client::Request,
    stream: S,
) -> Result<Box<dyn MeshIo>, String>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
{
    let (socket, _) = tokio_tungstenite::client_async(request, stream)
        .await
        .map_err(|error| match error {
            WsError::Http(response) => {
                let body = response
                    .body()
                    .as_ref()
                    .map(|body| String::from_utf8_lossy(body).into_owned())
                    .unwrap_or_default();
                format!(
                    "{CLOUD_UNREACHABLE}: the cloud node refused the connection ({}): {}",
                    response.status(),
                    body
                )
            }
            other => format!("{CLOUD_UNREACHABLE}: WebSocket upgrade failed: {other}"),
        })?;
    let (local, remote) = tokio::io::duplex(BRIDGE_BUFFER);
    tokio::spawn(async move {
        let (mut sink, mut stream) = socket.split();
        let (mut read, mut write) = tokio::io::split(remote);
        let inbound = async {
            while let Some(Ok(message)) = stream.next().await {
                match message {
                    Message::Binary(bytes) => {
                        if write.write_all(&bytes).await.is_err() {
                            break;
                        }
                    }
                    Message::Close(_) => break,
                    _ => {}
                }
            }
            let _ = write.shutdown().await;
        };
        let outbound = async {
            let mut buffer = vec![0u8; 64 * 1024];
            loop {
                match read.read(&mut buffer).await {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        if sink
                            .send(Message::Binary(buffer[..n].to_vec().into()))
                            .await
                            .is_err()
                        {
                            break;
                        }
                    }
                }
            }
            let _ = sink.send(Message::Close(None)).await;
        };
        tokio::select! {
            _ = inbound => {}
            _ = outbound => {}
        }
    });
    Ok(Box::new(local))
}

/// Dials the account's cloud node with this device's identity.
pub struct CloudNodeConnector {
    opener: Arc<dyn CloudStreamOpener>,
    authority: Arc<dyn MeshAuthority>,
    client: String,
}

impl CloudNodeConnector {
    pub fn new(
        opener: Arc<dyn CloudStreamOpener>,
        authority: Arc<dyn MeshAuthority>,
        client: String,
    ) -> Arc<Self> {
        Arc::new(Self {
            opener,
            authority,
            client,
        })
    }

    /// Opens an OBP connection to the cloud node `device_id`.
    pub async fn connect(
        &self,
        device_id: &str,
        options: MeshConnectOptions,
    ) -> Result<MeshObpConnection, String> {
        tokio::time::timeout(CONNECT_TIMEOUT, self.connect_inner(device_id, options))
            .await
            .map_err(|_| format!("{CLOUD_UNREACHABLE}: the cloud node did not answer in time"))?
    }

    async fn connect_inner(
        &self,
        device_id: &str,
        options: MeshConnectOptions,
    ) -> Result<MeshObpConnection, String> {
        if !is_cloud_device_id(device_id) {
            return Err(format!("{device_id} is not a cloud node id"));
        }
        let local = self
            .authority
            .local_device_id()
            .ok_or_else(|| "mesh_signed_out: this device is not signed in".to_string())?;
        let pair = self.authority.pair_key(device_id).await?;
        let mut stream = self.opener.open().await?;
        let (send, recv) = client_handshake(&mut stream, &local, device_id, &pair).await?;
        let socket = start_channel(stream, send, recv);
        MeshObpConnection::start(socket, device_id.to_string(), options, self.client.clone()).await
    }
}

fn b64() -> base64::engine::GeneralPurpose {
    base64::engine::general_purpose::URL_SAFE_NO_PAD
}

/// The client side of the `obp-e2e-v1` handshake; the two record ciphers
/// (send, receive) on success.
async fn client_handshake(
    stream: &mut Box<dyn MeshIo>,
    local: &str,
    target: &str,
    pair: &[u8; 32],
) -> Result<(RecordCipher, RecordCipher), String> {
    let failed = |error: std::io::Error| format!("{CLOUD_UNREACHABLE}: {error}");
    let key = handshake::handshake_key(pair);
    let ephemeral = StaticSecret::random_from_rng(rand::rngs::OsRng);
    let eph = b64().encode(PublicKey::from(&ephemeral).as_bytes());
    let claims = Claims {
        client_device_id: local.to_string(),
        server_device_id: target.to_string(),
        cert_fingerprint: client_fingerprint(&eph),
        time_ms: crate::now_ms(),
        nonce: handshake::new_nonce(),
    };
    let proof = handshake::prove(&key, Role::Client, &claims);
    let hello = ClientHello {
        v: VERSION,
        device: local.to_string(),
        target: target.to_string(),
        time: claims.time_ms,
        nonce: claims.nonce.clone(),
        eph: eph.clone(),
        proof: proof.clone(),
    };
    stream.write_all(MAGIC).await.map_err(failed)?;
    let body = serde_json::to_vec(&hello).map_err(|error| error.to_string())?;
    write_record(stream, &body).await.map_err(failed)?;
    let answer = read_record(stream, HELLO_MAX).await.map_err(failed)?;
    let answer: serde_json::Value = serde_json::from_slice(&answer)
        .map_err(|_| format!("{CLOUD_UNREACHABLE}: the cloud node answer is unreadable"))?;
    if let Some(code) = answer.get("error").and_then(serde_json::Value::as_str) {
        let message = answer
            .get("message")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default();
        return Err(format!("{code}: {message}"));
    }
    let server: ServerHello = serde_json::from_value(answer)
        .map_err(|_| format!("{CLOUD_UNREACHABLE}: the cloud node answer is unreadable"))?;
    if server.v != VERSION {
        return Err(format!(
            "{CLOUD_UNREACHABLE}: the cloud node speaks channel version {}",
            server.v
        ));
    }
    let server_claims = Claims {
        cert_fingerprint: server_fingerprint(&eph, &server.eph),
        ..claims
    };
    if !handshake::verify(&key, Role::Server, &server_claims, &server.proof) {
        return Err(format!(
            "mesh_impostor: the server could not prove it is the cloud node {target}"
        ));
    }
    let server_eph: [u8; 32] = b64()
        .decode(server.eph.trim())
        .ok()
        .and_then(|bytes| bytes.try_into().ok())
        .ok_or_else(|| format!("{CLOUD_UNREACHABLE}: the cloud node key is invalid"))?;
    let shared = ephemeral.diffie_hellman(&PublicKey::from(server_eph));
    if !shared.was_contributory() {
        return Err(format!(
            "{CLOUD_UNREACHABLE}: the cloud node key is invalid"
        ));
    }
    let (c2s, s2c) = derive_keys(&key, shared.as_bytes(), &proof, &server.proof);
    Ok((RecordCipher::new(&c2s), RecordCipher::new(&s2c)))
}

/// The plaintext of one data record (the record layout of
/// `server::e2e::encode_message`). `None` for a raw frame, which never
/// travels.
fn encode(message: &Message) -> Option<Vec<u8>> {
    Some(match message {
        Message::Text(text) => [&[TYPE_TEXT][..], text.as_str().as_bytes()].concat(),
        Message::Binary(bytes) => [&[TYPE_BINARY][..], &bytes[..]].concat(),
        Message::Ping(bytes) => [&[TYPE_PING][..], &bytes[..]].concat(),
        Message::Pong(bytes) => [&[TYPE_PONG][..], &bytes[..]].concat(),
        Message::Close(frame) => {
            let mut out = vec![TYPE_CLOSE];
            if let Some(frame) = frame {
                out.extend_from_slice(&u16::from(frame.code).to_be_bytes());
                out.extend_from_slice(frame.reason.as_str().as_bytes());
            }
            out
        }
        Message::Frame(_) => return None,
    })
}

fn decode(plaintext: Vec<u8>) -> std::io::Result<Message> {
    let invalid =
        |message: &str| std::io::Error::new(std::io::ErrorKind::InvalidData, message.to_string());
    let (kind, payload) = plaintext
        .split_first()
        .ok_or_else(|| invalid("empty record"))?;
    Ok(match *kind {
        TYPE_TEXT => Message::Text(
            String::from_utf8(payload.to_vec())
                .map_err(|_| invalid("text record is not UTF-8"))?
                .into(),
        ),
        TYPE_BINARY => Message::Binary(payload.to_vec().into()),
        TYPE_PING => Message::Ping(payload.to_vec().into()),
        TYPE_PONG => Message::Pong(payload.to_vec().into()),
        TYPE_CLOSE => Message::Close((payload.len() >= 2).then(|| CloseFrame {
            code: CloseCode::from(u16::from_be_bytes([payload[0], payload[1]])),
            reason: String::from_utf8_lossy(&payload[2..]).into_owned().into(),
        })),
        _ => return Err(invalid("unknown record type")),
    })
}

/// The channel as the message transport of an OBP connection.
struct ChannelSocket {
    incoming: mpsc::UnboundedReceiver<Result<Message, WsError>>,
    outgoing: mpsc::UnboundedSender<Message>,
}

impl futures::Stream for ChannelSocket {
    type Item = Result<Message, WsError>;

    fn poll_next(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        self.get_mut().incoming.poll_recv(cx)
    }
}

impl futures::Sink<Message> for ChannelSocket {
    type Error = WsError;

    fn poll_ready(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<Result<(), WsError>> {
        Poll::Ready(Ok(()))
    }

    fn start_send(self: Pin<&mut Self>, item: Message) -> Result<(), WsError> {
        self.outgoing
            .send(item)
            .map_err(|_| WsError::ConnectionClosed)
    }

    fn poll_flush(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<Result<(), WsError>> {
        Poll::Ready(Ok(()))
    }

    fn poll_close(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<Result<(), WsError>> {
        Poll::Ready(Ok(()))
    }
}

/// Runs the record layer over `stream` and returns its message transport.
/// Pings are answered here; the channel ends when either side closes.
fn start_channel(
    stream: Box<dyn MeshIo>,
    mut send: RecordCipher,
    mut recv: RecordCipher,
) -> ChannelSocket {
    let (incoming_tx, incoming) = mpsc::unbounded_channel();
    let (outgoing, mut outgoing_rx) = mpsc::unbounded_channel::<Message>();
    let pong = outgoing.clone();
    tokio::spawn(async move {
        let (mut reader, mut writer) = tokio::io::split(stream);
        let read = async move {
            loop {
                let Ok(record) = read_record(&mut reader, RECORD_MAX).await else {
                    break;
                };
                let Ok(message) = recv.open(&record).and_then(decode) else {
                    break;
                };
                match message {
                    Message::Ping(payload) => {
                        let _ = pong.send(Message::Pong(payload));
                    }
                    Message::Close(_) => break,
                    message => {
                        if incoming_tx.send(Ok(message)).is_err() {
                            break;
                        }
                    }
                }
            }
        };
        let write = async move {
            while let Some(message) = outgoing_rx.recv().await {
                let close = matches!(message, Message::Close(_));
                let Some(plaintext) = encode(&message) else {
                    continue;
                };
                let Ok(record) = send.seal(&plaintext) else {
                    break;
                };
                if write_record(&mut writer, &record).await.is_err() || close {
                    break;
                }
            }
            let _ = writer.shutdown().await;
        };
        tokio::select! {
            _ = read => {}
            _ = write => {}
        }
    });
    ChannelSocket { incoming, outgoing }
}

/// The [`PeerConnector`] of a fleet host: cloud node ids go to `cloud`,
/// every other device to `devices` (the host's Link connector).
pub struct WithCloudNode {
    devices: Arc<dyn PeerConnector>,
    cloud: Option<Arc<CloudNodeConnector>>,
}

impl WithCloudNode {
    pub fn new(
        devices: Arc<dyn PeerConnector>,
        cloud: Option<Arc<CloudNodeConnector>>,
    ) -> Arc<Self> {
        Arc::new(Self { devices, cloud })
    }

    /// Whether this host can dial the account's cloud node.
    pub fn dials_cloud_node(&self) -> bool {
        self.cloud.is_some()
    }
}

impl PeerConnector for WithCloudNode {
    fn connect(&self, device_id: String, options: MeshConnectOptions) -> ConnectFuture {
        if !is_cloud_device_id(&device_id) {
            return self.devices.connect(device_id, options);
        }
        let cloud = self.cloud.clone();
        Box::pin(async move {
            let cloud = cloud.ok_or_else(|| {
                format!(
                    "{CLOUD_CONNECTOR_UNAVAILABLE}: this OpenBitFun host cannot reach the account's cloud node; update it"
                )
            })?;
            cloud.connect(&device_id, options).await
        })
    }

    fn route(&self, device_id: &str) -> Option<(String, Option<f64>)> {
        if is_cloud_device_id(device_id) {
            // Not on the device network: no Link route.
            return None;
        }
        self.devices.route(device_id)
    }
}

#[cfg(test)]
#[path = "cloud_tests.rs"]
pub(crate) mod tests;

//! The OBP end-to-end channel (`obp-e2e-v1`) on the mesh listener.
//!
//! Browsers do not run Link: they reach a device through the server gateway
//! (`wss://<domain>/obp/<deviceId>`), which pipes bytes to this device's OBP
//! port over the account network. A browser cannot speak TLS over that raw
//! pipe, so a stream that opens with [`MAGIC`] instead of a TLS `ClientHello`
//! gets this channel: the same account-device proof as the TLS upgrade
//! (`openbitfun_link::handshake`, the pair key both devices derive from their
//! directory X25519 keys), bound to fresh X25519 ephemeral keys instead of a
//! certificate, then AES-256-GCM records keyed from the ephemeral exchange.
//! The gateway, the relay node and the issuer see only ciphertext; neither
//! can impersonate either end.
//!
//! Wire (every record is a 4-byte big-endian length and its body):
//! 1. client: `MAGIC`, then a record with the hello JSON
//!    `{v, device, target, time, nonce, eph, proof}`; `proof` is the client
//!    proof over the mesh claims with the fingerprint `obp-e2e-v1:<eph>`.
//! 2. server: a record with `{v, eph, proof, protocol, capabilities}` (the
//!    server proof over the fingerprint `obp-e2e-v1:<client eph>:<server
//!    eph>`), or `{error, message}` and the stream closes.
//! 3. keys: HKDF-SHA256(salt = handshake key, ikm = X25519(ephemerals), info =
//!    `obp-e2e-v1 keys\n<client proof>\n<server proof>`) -> 64 bytes, the
//!    client-to-server key then the server-to-client key.
//! 4. records: AES-256-GCM, nonce = 4 zero bytes + a 64-bit big-endian
//!    counter per direction from 0; the plaintext is one type byte (1 text, 2
//!    binary, 3 ping, 4 pong, 5 close: code u16 + reason) and the payload.
//!    Each text record is one OBP JSON-RPC message.
//!
//! The connection then runs exactly like an `account-device` WebSocket
//! (`connection::serve_split`): registry allowlist, owner-only events
//! withheld, credit/ack, coalescing and resume.

use std::net::SocketAddr;
use std::pin::Pin;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::task::{Context, Poll};

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use axum::extract::ws::{CloseFrame, Message};
use base64::Engine;
use hkdf::Hkdf;
use openbitfun_link::handshake::{self, Claims, Role};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, ReadBuf};
use x25519_dalek::{PublicKey, StaticSecret};

use super::connection::{self, ConnectionContext};
use super::mesh::{verify_client, ClientClaims, HandshakeRefusal, HANDSHAKE_TIMEOUT};
use super::{ObpServer, OBP_PROTOCOL_VERSION};
use crate::authority::MeshIo;

/// The first bytes of an end-to-end channel (a TLS stream starts with 0x16).
pub const MAGIC: &[u8; 8] = b"OBPE2E1\n";
/// Wire version in both hellos.
pub const VERSION: u32 = 1;
/// The fingerprint prefix the proofs bind the ephemeral keys with.
pub const FINGERPRINT_PREFIX: &str = "obp-e2e-v1:";
const KEYS_INFO: &str = "obp-e2e-v1 keys";
/// Largest hello record.
const HELLO_MAX: usize = 4 * 1024;
/// Largest data record (an OBP message is at most 32 MiB).
pub const RECORD_MAX: usize = 34 * 1024 * 1024;
const TAG_LEN: usize = 16;

const TYPE_TEXT: u8 = 1;
const TYPE_BINARY: u8 = 2;
const TYPE_PING: u8 = 3;
const TYPE_PONG: u8 = 4;
const TYPE_CLOSE: u8 = 5;

fn b64() -> base64::engine::GeneralPurpose {
    base64::engine::general_purpose::URL_SAFE_NO_PAD
}

/// The client's opening record.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ClientHello {
    pub v: u32,
    pub device: String,
    pub target: String,
    pub time: u64,
    pub nonce: String,
    /// The client's ephemeral X25519 public key (base64url, 32 bytes).
    pub eph: String,
    pub proof: String,
}

/// The server's answer.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ServerHello {
    pub v: u32,
    pub eph: String,
    pub proof: String,
    pub protocol: u32,
    pub capabilities: Vec<String>,
}

#[derive(Debug, Serialize)]
struct Refusal<'a> {
    error: &'a str,
    message: &'a str,
}

/// The fingerprint the client proof binds (its ephemeral key).
pub fn client_fingerprint(client_eph: &str) -> String {
    format!("{FINGERPRINT_PREFIX}{client_eph}")
}

/// The fingerprint the server proof binds (both ephemeral keys).
pub fn server_fingerprint(client_eph: &str, server_eph: &str) -> String {
    format!("{FINGERPRINT_PREFIX}{client_eph}:{server_eph}")
}

/// The two record keys: client-to-server, server-to-client.
pub fn derive_keys(
    handshake_key: &[u8; 32],
    shared: &[u8; 32],
    client_proof: &str,
    server_proof: &str,
) -> ([u8; 32], [u8; 32]) {
    let info = format!("{KEYS_INFO}\n{client_proof}\n{server_proof}");
    let mut okm = [0u8; 64];
    Hkdf::<Sha256>::new(Some(handshake_key), shared)
        .expand(info.as_bytes(), &mut okm)
        .expect("64 bytes is a valid HKDF-SHA256 length");
    let mut c2s = [0u8; 32];
    let mut s2c = [0u8; 32];
    c2s.copy_from_slice(&okm[..32]);
    s2c.copy_from_slice(&okm[32..]);
    (c2s, s2c)
}

fn parse_public(value: &str) -> Option<PublicKey> {
    let bytes = b64().decode(value.trim()).ok()?;
    let bytes: [u8; 32] = bytes.try_into().ok()?;
    Some(PublicKey::from(bytes))
}

/// One direction's AEAD with its record counter.
pub struct RecordCipher {
    cipher: Aes256Gcm,
    counter: u64,
}

impl RecordCipher {
    pub fn new(key: &[u8; 32]) -> Self {
        Self {
            cipher: Aes256Gcm::new_from_slice(key).expect("32-byte AES key"),
            counter: 0,
        }
    }

    fn nonce(&mut self) -> std::io::Result<[u8; 12]> {
        let mut nonce = [0u8; 12];
        nonce[4..].copy_from_slice(&self.counter.to_be_bytes());
        self.counter = self
            .counter
            .checked_add(1)
            .ok_or_else(|| std::io::Error::other("record counter exhausted"))?;
        Ok(nonce)
    }

    pub fn seal(&mut self, plaintext: &[u8]) -> std::io::Result<Vec<u8>> {
        let nonce = self.nonce()?;
        self.cipher
            .encrypt(Nonce::from_slice(&nonce), plaintext)
            .map_err(|_| std::io::Error::other("record encryption failed"))
    }

    pub fn open(&mut self, record: &[u8]) -> std::io::Result<Vec<u8>> {
        if record.len() < TAG_LEN {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "record too short",
            ));
        }
        let nonce = self.nonce()?;
        self.cipher
            .decrypt(Nonce::from_slice(&nonce), record)
            .map_err(|_| {
                std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "record authentication failed",
                )
            })
    }
}

/// Reads one length-prefixed record of at most `max` bytes.
pub async fn read_record<R: AsyncRead + Unpin>(
    reader: &mut R,
    max: usize,
) -> std::io::Result<Vec<u8>> {
    let mut length = [0u8; 4];
    reader.read_exact(&mut length).await?;
    let length = u32::from_be_bytes(length) as usize;
    if length > max {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("record of {length} bytes exceeds {max}"),
        ));
    }
    let mut body = vec![0u8; length];
    reader.read_exact(&mut body).await?;
    Ok(body)
}

/// Writes one length-prefixed record.
pub async fn write_record<W: AsyncWrite + Unpin>(
    writer: &mut W,
    body: &[u8],
) -> std::io::Result<()> {
    let length = u32::try_from(body.len())
        .map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidInput, "record too large"))?;
    let mut framed = Vec::with_capacity(4 + body.len());
    framed.extend_from_slice(&length.to_be_bytes());
    framed.extend_from_slice(body);
    writer.write_all(&framed).await?;
    writer.flush().await
}

/// The plaintext of one data record.
pub fn encode_message(message: &Message) -> Vec<u8> {
    match message {
        Message::Text(text) => [&[TYPE_TEXT][..], text.as_str().as_bytes()].concat(),
        Message::Binary(bytes) => [&[TYPE_BINARY][..], &bytes[..]].concat(),
        Message::Ping(bytes) => [&[TYPE_PING][..], &bytes[..]].concat(),
        Message::Pong(bytes) => [&[TYPE_PONG][..], &bytes[..]].concat(),
        Message::Close(frame) => {
            let mut out = vec![TYPE_CLOSE];
            if let Some(frame) = frame {
                out.extend_from_slice(&frame.code.to_be_bytes());
                out.extend_from_slice(frame.reason.as_str().as_bytes());
            }
            out
        }
    }
}

/// The message one data record's plaintext carries.
pub fn decode_message(plaintext: Vec<u8>) -> std::io::Result<Message> {
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
        TYPE_CLOSE => Message::Close(if payload.len() >= 2 {
            Some(CloseFrame {
                code: u16::from_be_bytes([payload[0], payload[1]]),
                reason: String::from_utf8_lossy(&payload[2..]).into_owned().into(),
            })
        } else {
            None
        }),
        _ => return Err(invalid("unknown record type")),
    })
}

/// What a mesh stream opened with.
pub(crate) enum Sniffed {
    /// The end-to-end channel (its magic consumed).
    E2e(Box<dyn MeshIo>),
    /// A plain HTTP request (`GET /obp-ui/v1/<sha256>`, the server pool
    /// fetching web UI files by hash), its first byte put back.
    UiFetch(Box<dyn MeshIo>),
    /// Anything else, with the bytes read so far put back (TLS).
    Tls(Box<dyn MeshIo>),
}

/// Tells the end-to-end channel, a plain HTTP fetch and TLS apart by the
/// stream's first bytes (`O`, `G`, and 0x16 for a TLS `ClientHello`).
pub(crate) async fn sniff(mut stream: Box<dyn MeshIo>) -> std::io::Result<Sniffed> {
    let mut first = [0u8; 1];
    stream.read_exact(&mut first).await?;
    if first[0] == super::ui_fetch::FIRST_BYTE {
        return Ok(Sniffed::UiFetch(Box::new(Prefixed::new(
            first.to_vec(),
            stream,
        ))));
    }
    if first[0] != MAGIC[0] {
        return Ok(Sniffed::Tls(Box::new(Prefixed::new(
            first.to_vec(),
            stream,
        ))));
    }
    let mut rest = [0u8; 7];
    stream.read_exact(&mut rest).await?;
    if rest[..] == MAGIC[1..] {
        return Ok(Sniffed::E2e(stream));
    }
    let mut prefix = first.to_vec();
    prefix.extend_from_slice(&rest);
    Ok(Sniffed::Tls(Box::new(Prefixed::new(prefix, stream))))
}

/// A stream with bytes already read put back in front.
struct Prefixed {
    prefix: Vec<u8>,
    offset: usize,
    inner: Box<dyn MeshIo>,
}

impl Prefixed {
    fn new(prefix: Vec<u8>, inner: Box<dyn MeshIo>) -> Self {
        Self {
            prefix,
            offset: 0,
            inner,
        }
    }
}

impl AsyncRead for Prefixed {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        let this = self.get_mut();
        if this.offset < this.prefix.len() {
            let available = &this.prefix[this.offset..];
            let take = available.len().min(buf.remaining());
            buf.put_slice(&available[..take]);
            this.offset += take;
            return Poll::Ready(Ok(()));
        }
        Pin::new(&mut this.inner).poll_read(cx, buf)
    }
}

impl AsyncWrite for Prefixed {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<std::io::Result<usize>> {
        Pin::new(&mut self.get_mut().inner).poll_write(cx, buf)
    }

    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.get_mut().inner).poll_flush(cx)
    }

    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.get_mut().inner).poll_shutdown(cx)
    }
}

async fn refuse<W: AsyncWrite + Unpin>(writer: &mut W, code: &str, message: &str) {
    if let Ok(body) = serde_json::to_vec(&Refusal {
        error: code,
        message,
    }) {
        let _ = write_record(writer, &body).await;
    }
    let _ = writer.shutdown().await;
}

/// Runs the end-to-end channel's handshake and then the OBP connection.
pub(crate) async fn serve(server: Arc<ObpServer>, mut stream: Box<dyn MeshIo>, peer: SocketAddr) {
    let hello =
        match tokio::time::timeout(HANDSHAKE_TIMEOUT, read_record(&mut stream, HELLO_MAX)).await {
            Ok(Ok(body)) => body,
            Ok(Err(error)) => {
                log::debug!("OBP e2e hello unreadable: peer={}, error={}", peer, error);
                return;
            }
            Err(_) => {
                log::debug!("OBP e2e hello timed out: peer={}", peer);
                return;
            }
        };
    let hello: ClientHello = match serde_json::from_slice(&hello) {
        Ok(hello) => hello,
        Err(_) => {
            refuse(
                &mut stream,
                "bad_hello",
                "the end-to-end hello is unreadable",
            )
            .await;
            return;
        }
    };
    if hello.v != VERSION {
        refuse(
            &mut stream,
            "unsupported_version",
            "this device speaks end-to-end channel version 1",
        )
        .await;
        return;
    }
    let Some(client_eph) = parse_public(&hello.eph) else {
        refuse(&mut stream, "bad_hello", "the ephemeral key is invalid").await;
        return;
    };
    let verified = match verify_client(
        &server,
        ClientClaims {
            device: &hello.device,
            target: &hello.target,
            time_ms: hello.time,
            nonce: &hello.nonce,
            fingerprint: Some(client_fingerprint(&hello.eph)),
            proof: &hello.proof,
        },
    )
    .await
    {
        Ok(verified) => verified,
        Err(HandshakeRefusal { code, message, .. }) => {
            refuse(&mut stream, code, message).await;
            return;
        }
    };

    let secret = StaticSecret::random_from_rng(rand::rngs::OsRng);
    let server_eph = b64().encode(PublicKey::from(&secret).as_bytes());
    let shared = secret.diffie_hellman(&client_eph);
    if !shared.was_contributory() {
        refuse(&mut stream, "bad_hello", "the ephemeral key is invalid").await;
        return;
    }
    let server_claims = Claims {
        cert_fingerprint: server_fingerprint(&hello.eph, &server_eph),
        ..verified.claims.clone()
    };
    let server_proof = handshake::prove(&verified.key, Role::Server, &server_claims);
    let answer = ServerHello {
        v: VERSION,
        eph: server_eph,
        proof: server_proof.clone(),
        protocol: OBP_PROTOCOL_VERSION,
        capabilities: connection::mesh_capabilities(server.backend.as_ref())
            .iter()
            .map(|capability| capability.to_string())
            .collect(),
    };
    let Ok(answer) = serde_json::to_vec(&answer) else {
        return;
    };
    if write_record(&mut stream, &answer).await.is_err() {
        return;
    }
    let (c2s, s2c) = derive_keys(
        &verified.key,
        shared.as_bytes(),
        &hello.proof,
        &server_proof,
    );

    let device_id = verified.device;
    // The directory row kind picked the scope (`cloud-agent` for the
    // account's cloud agent, `account-device` otherwise).
    let scope = verified.scope;
    let (id, stop) = server.register_connection(scope.clone());
    let context = ConnectionContext {
        backend: Arc::clone(&server.backend),
        scope,
        instance_id: server.instance_id.clone(),
        registry_digest: server.registry_digest.clone(),
        limits: server.options.limits.clone(),
        ui_bundle_id: server.ui_bundle.cached_bundle_id(),
        fleet_clients: Arc::clone(&server.fleet_clients),
        stop,
    };
    log::info!(
        "OBP e2e connection accepted: device={}, scope={}",
        device_id,
        context.scope.wire_name()
    );

    let received = Arc::new(AtomicU64::new(0));
    let sent = Arc::new(AtomicU64::new(0));
    let (reader, writer) = tokio::io::split(stream);
    let inbound = futures::stream::unfold(
        (
            reader,
            RecordCipher::new(&c2s),
            Arc::clone(&received),
            false,
        ),
        |(mut reader, mut cipher, received, done)| async move {
            if done {
                return None;
            }
            let item = match read_record(&mut reader, RECORD_MAX).await {
                Ok(record) => {
                    received.fetch_add(record.len() as u64 + 4, Ordering::Relaxed);
                    cipher.open(&record).and_then(decode_message)
                }
                Err(error) => Err(error),
            };
            let done = item.is_err();
            if done
                && item.as_ref().err().map(|error| error.kind())
                    == Some(std::io::ErrorKind::UnexpectedEof)
            {
                return None;
            }
            Some((item, (reader, cipher, received, done)))
        },
    );
    let outbound = futures::sink::unfold(
        (writer, RecordCipher::new(&s2c), Arc::clone(&sent)),
        |(mut writer, mut cipher, sent), message: Message| async move {
            let record = cipher.seal(&encode_message(&message))?;
            write_record(&mut writer, &record).await?;
            sent.fetch_add(record.len() as u64 + 4, Ordering::Relaxed);
            if matches!(message, Message::Close(_)) {
                let _ = writer.shutdown().await;
            }
            Ok::<_, std::io::Error>((writer, cipher, sent))
        },
    );
    connection::serve_split(Box::pin(outbound), Box::pin(inbound), context).await;
    server.unregister_connection(id);
    log::info!(
        "OBP e2e connection closed: device={}, received_bytes={}, sent_bytes={}",
        device_id,
        received.load(Ordering::Relaxed),
        sent.load(Ordering::Relaxed)
    );
}

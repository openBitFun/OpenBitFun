//! The cloud node's endpoint for frontends: HTTP routes and OBP over the
//! end-to-end channel (`obp-e2e-v1`) inside a WebSocket.
//!
//! nginx exposes `https://<domain>/agent/` and forwards to this process on
//! loopback (`deploy/superagent`). Routes:
//!
//! - `GET /agent/health`: liveness and counts (no account data);
//! - `POST /agent/api/v1/ensure` (`Authorization: Bearer <access token>`):
//!   first use of an account creates its node (on by default);
//! - `GET /agent/obp` (WebSocket, binary frames): a byte stream carrying the
//!   OBP end-to-end channel. The client proves it holds the key of a device
//!   of the account (the pair key of its directory key and the node's), the
//!   node proves it is `cloud-<hash>`; records are AES-256-GCM. Inside, the
//!   connection speaks OBP JSON-RPC (`hello`, `call`, `ack`, `event`) with
//!   the `superagent_*` commands and events.
//!
//! While `frontends` is off (the deploy default until the fleet wiring
//! lands), `ensure` and `/agent/obp` answer `superagent_unavailable`.

use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use std::time::Duration;

use axum::extract::ws::{CloseFrame, Message as WsMessage, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use base64::Engine as _;
use futures::{SinkExt, StreamExt};
use openbitfun_link::handshake::{self, Claims, Role};
use openbitfun_obp::server::e2e::{
    client_fingerprint, decode_message, derive_keys, encode_message, read_record,
    server_fingerprint, write_record, ClientHello, RecordCipher, ServerHello, MAGIC, RECORD_MAX,
    VERSION,
};
use openbitfun_obp::EVENTS_DROPPED_EVENT;
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt, DuplexStream};
use tokio::sync::{mpsc, OwnedSemaphorePermit, Semaphore};
use x25519_dalek::{PublicKey, StaticSecret};

use crate::api::{node_secret, Service, HOST_CAPABILITIES};
use crate::crypto;
use crate::directory::Identity;
use crate::slots::Slot;

const HELLO_MAX: usize = 4 * 1024;
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);
const EVENT_BATCH: usize = 256;
const OUTBOX_CAPACITY: usize = 256;
/// Capabilities of the node's OBP connection.
pub const CONNECTION_CAPABILITIES: &[&str] = &[
    "obp_v1",
    "resume",
    "superagent_v1",
    openbitfun_product_domains::fleet::FLEET_V1_CAPABILITY,
];

/// Which cloud device id belongs to which account (sealed record).
const TARGETS_ACCOUNT: &str = "openbitfun-superagent:targets";
const TARGETS_RECORD: &str = "targets";

/// Resource limits for `/agent/obp` frontend connections.
#[derive(Debug, Clone)]
pub struct FrontendsLimits {
    /// Maximum concurrent `/agent/obp` connections across the process.
    pub max_connections: usize,
    /// Maximum concurrent `/agent/obp` connections for one account.
    pub max_connections_per_account: usize,
    /// Maximum handshake nonces held in RAM for replay protection.
    pub max_nonces: usize,
    /// Maximum time after the E2E handshake to send the OBP `hello` request.
    pub hello_timeout: Duration,
    /// Interval between server-initiated WebSocket pings.
    pub ping_interval: Duration,
    /// Close the connection when no client frame or Pong arrives for this long.
    pub idle_timeout: Duration,
    /// Maximum concurrent in-flight `call` dispatches per connection.
    pub max_inflight_calls: usize,
    /// Default client credit window in bytes when `ack: true`.
    pub default_credit_bytes: u64,
    /// Minimum negotiated credit window in bytes.
    pub min_credit_bytes: u64,
    /// Maximum negotiated credit window in bytes.
    pub max_credit_bytes: u64,
    /// Close a connection whose event credit stays exhausted for this long.
    pub slow_client_timeout: Duration,
    /// Timeout on writing one encrypted record to the underlying stream.
    pub write_timeout: Duration,
}

impl Default for FrontendsLimits {
    fn default() -> Self {
        Self {
            max_connections: 2_048,
            max_connections_per_account: 16,
            max_nonces: 100_000,
            hello_timeout: Duration::from_secs(15),
            ping_interval: Duration::from_secs(30),
            idle_timeout: Duration::from_secs(90),
            max_inflight_calls: 16,
            default_credit_bytes: 1024 * 1024,
            min_credit_bytes: 64 * 1024,
            max_credit_bytes: 4 * 1024 * 1024,
            slow_client_timeout: Duration::from_secs(30),
            write_timeout: Duration::from_secs(30),
        }
    }
}

struct NonceCache {
    entries: HashMap<String, u64>,
    order: VecDeque<(u64, String)>,
    max_entries: usize,
}

impl NonceCache {
    fn new(max_entries: usize) -> Self {
        Self {
            entries: HashMap::new(),
            order: VecDeque::new(),
            max_entries: max_entries.max(1),
        }
    }

    fn consume(&mut self, nonce: &str, now: u64) -> bool {
        let window = 2 * handshake::MAX_CLOCK_SKEW_MS;
        while let Some((ts, _)) = self.order.front() {
            if now.saturating_sub(*ts) <= window {
                break;
            }
            let Some((expired_ts, expired_nonce)) = self.order.pop_front() else {
                break;
            };
            if self.entries.get(&expired_nonce) == Some(&expired_ts) {
                self.entries.remove(&expired_nonce);
            }
        }
        if self.entries.contains_key(nonce) {
            return false;
        }
        while self.entries.len() >= self.max_entries {
            let Some((old_ts, old_nonce)) = self.order.pop_front() else {
                self.entries.clear();
                break;
            };
            if self.entries.get(&old_nonce) == Some(&old_ts) {
                self.entries.remove(&old_nonce);
            }
        }
        self.entries.insert(nonce.to_string(), now);
        self.order.push_back((now, nonce.to_string()));
        true
    }
}

/// Event-stream byte credit window for one OBP connection.
struct Credit {
    window: u64,
    sent: VecDeque<(u64, u64)>,
    unacked_bytes: u64,
}

impl Credit {
    fn new(window: u64) -> Self {
        Self {
            window: window.max(1),
            sent: VecDeque::new(),
            unacked_bytes: 0,
        }
    }

    fn exhausted(&self) -> bool {
        self.unacked_bytes >= self.window
    }

    fn record(&mut self, seq: u64, bytes: u64) {
        self.sent.push_back((seq, bytes));
        self.unacked_bytes = self.unacked_bytes.saturating_add(bytes);
    }

    fn ack(&mut self, seq: u64) {
        while let Some((sent_seq, bytes)) = self.sent.front() {
            if *sent_seq > seq {
                break;
            }
            let bytes = *bytes;
            self.sent.pop_front();
            self.unacked_bytes = self.unacked_bytes.saturating_sub(bytes);
        }
    }
}

struct AccountConnectionGuard {
    frontends: Arc<Frontends>,
    account_id: String,
}

impl Drop for AccountConnectionGuard {
    fn drop(&mut self) {
        let mut counts = self
            .frontends
            .account_connections
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        if let Some(count) = counts.get_mut(&self.account_id) {
            if *count <= 1 {
                counts.remove(&self.account_id);
            } else {
                *count -= 1;
            }
        }
    }
}

pub struct Frontends {
    pub service: Arc<Service>,
    pub identity: Arc<dyn Identity>,
    /// Off: the node is deployed but frontends cannot use it yet.
    pub enabled: bool,
    pub limits: FrontendsLimits,
    targets: std::sync::Mutex<HashMap<String, String>>,
    nonces: std::sync::Mutex<NonceCache>,
    active_connections: Arc<Semaphore>,
    account_connections: std::sync::Mutex<HashMap<String, usize>>,
}

impl Frontends {
    pub fn new(service: Arc<Service>, identity: Arc<dyn Identity>, enabled: bool) -> Arc<Self> {
        Self::new_with_limits(service, identity, enabled, FrontendsLimits::default())
    }

    pub fn new_with_limits(
        service: Arc<Service>,
        identity: Arc<dyn Identity>,
        enabled: bool,
        limits: FrontendsLimits,
    ) -> Arc<Self> {
        let targets = service
            .engine
            .slots
            .store()
            .account(TARGETS_ACCOUNT, true)
            .ok()
            .and_then(|store| {
                store
                    .read_json::<HashMap<String, String>>(TARGETS_RECORD)
                    .ok()
                    .flatten()
            })
            .unwrap_or_default();
        let max_conns = limits.max_connections.max(1);
        let max_nonces = limits.max_nonces.max(1);
        Arc::new(Self {
            service,
            identity,
            enabled,
            limits,
            targets: std::sync::Mutex::new(targets),
            nonces: std::sync::Mutex::new(NonceCache::new(max_nonces)),
            active_connections: Arc::new(Semaphore::new(max_conns)),
            account_connections: std::sync::Mutex::new(HashMap::new()),
        })
    }

    /// Provisions (or loads) the account's node and records its device id.
    pub async fn ensure(&self, account_id: &str) -> Result<Arc<Slot>, String> {
        let slot = self.service.ensure(account_id).await?;
        let device_id = slot.state.lock().await.meta.device_id.clone();
        let changed = {
            let mut targets = self.targets.lock().unwrap_or_else(|p| p.into_inner());
            targets.insert(device_id, account_id.to_string()).is_none()
        };
        if changed {
            self.save_targets();
        }
        Ok(slot)
    }

    fn save_targets(&self) {
        let targets = self
            .targets
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .clone();
        if let Ok(store) = self
            .service
            .engine
            .slots
            .store()
            .account(TARGETS_ACCOUNT, true)
        {
            if let Err(error) = store.write_json(TARGETS_RECORD, &targets) {
                log::warn!("Superagent target index not saved: {}", error);
            }
        }
    }

    /// Drops the device ids of accounts whose data is gone (shredded by the
    /// time-to-live sweep or deleted); returns how many went.
    pub fn prune_targets(&self) -> usize {
        let store = self.service.engine.slots.store();
        let removed = {
            let mut targets = self.targets.lock().unwrap_or_else(|p| p.into_inner());
            let before = targets.len();
            targets.retain(|_, account_id| store.exists(account_id));
            before - targets.len()
        };
        if removed > 0 {
            self.save_targets();
        }
        removed
    }

    fn account_of_target(&self, device_id: &str) -> Option<String> {
        self.targets
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .get(device_id)
            .cloned()
    }

    fn consume_nonce(&self, nonce: &str, now: u64) -> bool {
        self.nonces
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .consume(nonce, now)
    }

    fn acquire_account_connection(
        self: &Arc<Self>,
        account_id: &str,
    ) -> Option<AccountConnectionGuard> {
        let mut counts = self
            .account_connections
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        let current = counts.get(account_id).copied().unwrap_or(0);
        if current >= self.limits.max_connections_per_account {
            return None;
        }
        counts.insert(account_id.to_string(), current + 1);
        Some(AccountConnectionGuard {
            frontends: Arc::clone(self),
            account_id: account_id.to_string(),
        })
    }

    pub fn router(self: &Arc<Self>) -> Router {
        Router::new()
            .route("/agent/health", get(health))
            .route("/agent/api/v1/ensure", post(ensure))
            .route("/agent/obp", get(obp))
            .with_state(Arc::clone(self))
    }
}

fn refusal(status: StatusCode, code: &str, message: &str) -> Response {
    let mut response = (status, Json(json!({ "error": code, "message": message }))).into_response();
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        header::HeaderValue::from_static("no-store"),
    );
    response
}

async fn health(State(frontends): State<Arc<Frontends>>) -> Response {
    let engine = &frontends.service.engine;
    Json(json!({
        "ok": true,
        "service": "openbitfun-superagent",
        "version": env!("CARGO_PKG_VERSION"),
        "frontends": frontends.enabled,
        "residentSlots": engine.slots.resident_count(),
        "watchedAccounts": engine.watched_accounts().len(),
    }))
    .into_response()
}

async fn ensure(State(frontends): State<Arc<Frontends>>, headers: HeaderMap) -> Response {
    if !frontends.enabled {
        return refusal(
            StatusCode::SERVICE_UNAVAILABLE,
            "superagent_unavailable",
            "Super Agent is not available on this server yet",
        );
    }
    let Some(token) = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .map(str::trim)
        .filter(|token| !token.is_empty())
    else {
        return refusal(
            StatusCode::UNAUTHORIZED,
            "unauthorized",
            "sign in to OpenBitFun first",
        );
    };
    let account = match frontends.identity.account_of(token).await {
        Ok(account) => account,
        Err(crate::directory::DirectoryError::SignedOut) => {
            return refusal(
                StatusCode::UNAUTHORIZED,
                "unauthorized",
                "the account credential is invalid or expired; sign in again",
            )
        }
        Err(_) => {
            return refusal(
                StatusCode::SERVICE_UNAVAILABLE,
                "identity_unavailable",
                "the account service is unavailable; try again later",
            )
        }
    };
    match frontends.ensure(&account).await {
        Ok(slot) => {
            let state = slot.state.lock().await;
            let public = node_secret(&state.meta)
                .map(|secret| crypto::public_key_base64(&secret))
                .unwrap_or_default();
            Json(json!({ "deviceId": state.meta.device_id, "publicKey": public, "enabled": state.meta.enabled })).into_response()
        }
        Err(error) => {
            log::warn!("Superagent ensure failed: error={}", error);
            refusal(
                StatusCode::SERVICE_UNAVAILABLE,
                "superagent_unavailable",
                &error,
            )
        }
    }
}

async fn obp(
    State(frontends): State<Arc<Frontends>>,
    headers: HeaderMap,
    upgrade: WebSocketUpgrade,
) -> Response {
    if !frontends.enabled {
        return refusal(
            StatusCode::SERVICE_UNAVAILABLE,
            "superagent_unavailable",
            "Super Agent is not available on this server yet",
        );
    }
    if headers.contains_key(header::ORIGIN) {
        // Entries (desktop and CLI backends) dial this; a page never does.
        return refusal(
            StatusCode::FORBIDDEN,
            "bad_origin",
            "browser pages reach the agent through a device",
        );
    }
    let Ok(permit) = Arc::clone(&frontends.active_connections).try_acquire_owned() else {
        return refusal(
            StatusCode::SERVICE_UNAVAILABLE,
            "too_many_connections",
            "too many open agent connections; retry later",
        );
    };
    upgrade
        .max_message_size(RECORD_MAX + 64)
        .on_upgrade(move |socket| async move {
            let (io, pump) = bridge(socket);
            let serve = serve_stream_with_permit(frontends, io, permit);
            tokio::select! {
                _ = serve => {}
                _ = pump => {}
            }
        })
}

/// A WebSocket as a byte stream: binary frames carry the channel's bytes.
fn bridge(socket: WebSocket) -> (DuplexStream, impl std::future::Future<Output = ()>) {
    let (local, remote) = tokio::io::duplex(256 * 1024);
    let pump = async move {
        let (mut sink, mut stream) = socket.split();
        let (mut read, mut write) = tokio::io::split(remote);
        let inbound = async {
            while let Some(Ok(message)) = stream.next().await {
                match message {
                    WsMessage::Binary(bytes) => {
                        if write.write_all(&bytes).await.is_err() {
                            break;
                        }
                    }
                    WsMessage::Close(_) => break,
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
                            .send(WsMessage::Binary(buffer[..n].to_vec().into()))
                            .await
                            .is_err()
                        {
                            break;
                        }
                    }
                }
            }
            let _ = sink.send(WsMessage::Close(None)).await;
        };
        tokio::select! {
            _ = inbound => {}
            _ = outbound => {}
        }
    };
    (local, pump)
}

async fn refuse<W: tokio::io::AsyncWrite + Unpin>(writer: &mut W, code: &str, message: &str) {
    if let Ok(body) = serde_json::to_vec(&json!({ "error": code, "message": message })) {
        let _ = write_record(writer, &body).await;
    }
    let _ = writer.shutdown().await;
}

fn b64() -> base64::engine::GeneralPurpose {
    base64::engine::general_purpose::URL_SAFE_NO_PAD
}

/// The end-to-end handshake, then the OBP connection.
pub async fn serve_stream<S>(frontends: Arc<Frontends>, mut stream: S)
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
{
    let Ok(permit) = Arc::clone(&frontends.active_connections).try_acquire_owned() else {
        refuse(
            &mut stream,
            "too_many_connections",
            "too many open agent connections; retry later",
        )
        .await;
        return;
    };
    serve_stream_with_permit(frontends, stream, permit).await;
}

async fn serve_stream_with_permit<S>(
    frontends: Arc<Frontends>,
    mut stream: S,
    _conn_permit: OwnedSemaphorePermit,
) where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
{
    let mut magic = [0u8; 8];
    match tokio::time::timeout(HANDSHAKE_TIMEOUT, stream.read_exact(&mut magic)).await {
        Ok(Ok(_)) if &magic == MAGIC => {}
        _ => return,
    }
    let hello =
        match tokio::time::timeout(HANDSHAKE_TIMEOUT, read_record(&mut stream, HELLO_MAX)).await {
            Ok(Ok(body)) => body,
            _ => return,
        };
    let Ok(hello) = serde_json::from_slice::<ClientHello>(&hello) else {
        refuse(
            &mut stream,
            "bad_hello",
            "the end-to-end hello is unreadable",
        )
        .await;
        return;
    };
    if hello.v != VERSION {
        refuse(
            &mut stream,
            "unsupported_version",
            "the agent speaks end-to-end channel version 1",
        )
        .await;
        return;
    }
    let Some(client_eph) = b64()
        .decode(hello.eph.trim())
        .ok()
        .and_then(|bytes| <[u8; 32]>::try_from(bytes).ok())
        .map(PublicKey::from)
    else {
        refuse(&mut stream, "bad_hello", "the ephemeral key is invalid").await;
        return;
    };
    let verified = match verify(&frontends, &hello).await {
        Ok(verified) => verified,
        Err((code, message)) => {
            refuse(&mut stream, code, &message).await;
            return;
        }
    };
    let (slot, key, claims, _account_guard) = verified;
    let secret = StaticSecret::random_from_rng(rand::rngs::OsRng);
    let server_eph = b64().encode(PublicKey::from(&secret).as_bytes());
    let shared = secret.diffie_hellman(&client_eph);
    if !shared.was_contributory() {
        refuse(&mut stream, "bad_hello", "the ephemeral key is invalid").await;
        return;
    }
    let server_claims = Claims {
        cert_fingerprint: server_fingerprint(&hello.eph, &server_eph),
        ..claims
    };
    let server_proof = handshake::prove(&key, Role::Server, &server_claims);
    let answer = ServerHello {
        v: VERSION,
        eph: server_eph,
        proof: server_proof.clone(),
        protocol: openbitfun_obp::OBP_PROTOCOL_VERSION,
        capabilities: CONNECTION_CAPABILITIES
            .iter()
            .map(|c| c.to_string())
            .collect(),
    };
    let Ok(answer) = serde_json::to_vec(&answer) else {
        return;
    };
    if tokio::time::timeout(
        frontends.limits.write_timeout,
        write_record(&mut stream, &answer),
    )
    .await
    .map(|r| r.is_err())
    .unwrap_or(true)
    {
        return;
    }
    let (c2s, s2c) = derive_keys(&key, shared.as_bytes(), &hello.proof, &server_proof);
    log::info!("Superagent frontend connected");
    let _attached = slot.attach();
    let (reader, writer) = tokio::io::split(stream);
    connection(
        frontends,
        slot,
        reader,
        writer,
        RecordCipher::new(&c2s),
        RecordCipher::new(&s2c),
    )
    .await;
    log::info!("Superagent frontend disconnected");
}

type Verified = (Arc<Slot>, [u8; 32], Claims, AccountConnectionGuard);

async fn verify(
    frontends: &Arc<Frontends>,
    hello: &ClientHello,
) -> Result<Verified, (&'static str, String)> {
    let unauthorized = |message: &str| ("unauthorized", message.to_string());
    if !handshake::valid_device_id(&hello.device) || !handshake::valid_nonce(&hello.nonce) {
        return Err(unauthorized("missing or invalid handshake fields"));
    }
    let Some(account) = frontends.account_of_target(&hello.target) else {
        return Err((
            "wrong_device",
            "this address does not belong to a Super Agent".to_string(),
        ));
    };
    let Some(account_guard) = frontends.acquire_account_connection(&account) else {
        return Err((
            "too_many_connections",
            "too many open connections for this account".to_string(),
        ));
    };
    let now = openbitfun_obp::now_ms();
    if now.abs_diff(hello.time) > handshake::MAX_CLOCK_SKEW_MS {
        return Err(unauthorized(
            "the handshake time is too far from the server's clock; check the system time",
        ));
    }
    let slot = frontends
        .service
        .engine
        .slots
        .load(&account, now, None)
        .await
        .map_err(|error| ("unavailable", error.to_string()))?;
    let (secret, token, enabled) = {
        let state = slot.state.lock().await;
        (
            node_secret(&state.meta).map_err(|e| ("unavailable", e))?,
            state.meta.directory_token.clone(),
            state.meta.enabled,
        )
    };
    let _ = enabled;
    let token = token.ok_or(("unavailable", "the agent is not registered yet".to_string()))?;
    let (public, kind) = frontends
        .service
        .directory
        .device_key(&token, &hello.device)
        .await
        .map_err(|_| {
            (
                "not_account_device",
                "the device is not part of this account".to_string(),
            )
        })?;
    if kind.as_deref() == Some("cloud_agent") {
        return Err((
            "not_account_device",
            "an agent cannot connect to an agent".to_string(),
        ));
    }
    let public = crypto::parse_public_key(&public).map_err(|e| ("not_account_device", e))?;
    let pair = crypto::derive_pair_key(&secret, &public).map_err(|e| ("not_account_device", e))?;
    let key = handshake::handshake_key(&pair);
    let claims = Claims {
        client_device_id: hello.device.clone(),
        server_device_id: hello.target.clone(),
        cert_fingerprint: client_fingerprint(&hello.eph),
        time_ms: hello.time,
        nonce: hello.nonce.clone(),
    };
    if !handshake::verify(&key, Role::Client, &claims, &hello.proof) {
        return Err(unauthorized("the account-device proof is invalid"));
    }
    if !frontends.consume_nonce(&hello.nonce, now) {
        return Err(unauthorized("the handshake was already used"));
    }
    Ok((slot, key, claims, account_guard))
}

fn rpc_result(id: &Value, result: Value) -> String {
    json!({ "jsonrpc": "2.0", "id": id, "result": result }).to_string()
}

fn rpc_error(id: &Value, code: i64, message: &str) -> String {
    let mut error = json!({ "code": code, "message": message });
    if message.starts_with(openbitfun_obp::UNSUPPORTED_IN_NATIVE_HOST) {
        error["data"] = json!({ "kind": "unsupported" });
    }
    json!({ "jsonrpc": "2.0", "id": id, "error": error }).to_string()
}

fn event_frame(seq: u64, event: &str, payload: &Value) -> String {
    json!({
        "jsonrpc": "2.0",
        "method": "event",
        "params": {
            "seq": seq,
            "event": event,
            "payload": payload,
        }
    })
    .to_string()
}

struct HelloSession {
    subscription: openbitfun_obp::EventSubscription,
    credit: Option<Credit>,
}

async fn read_hello_phase<R>(
    frontends: &Arc<Frontends>,
    slot: &Arc<Slot>,
    reader: &mut R,
    inbound: &mut RecordCipher,
    tx: &mpsc::Sender<WsMessage>,
) -> Option<HelloSession>
where
    R: tokio::io::AsyncRead + Unpin,
{
    let text = |value: String| WsMessage::Text(value.into());
    loop {
        let record = read_record(reader, RECORD_MAX).await.ok()?;
        let message = inbound.open(&record).and_then(decode_message).ok()?;
        let body = match message {
            WsMessage::Text(body) => body.to_string(),
            WsMessage::Ping(bytes) => {
                let _ = tx.send(WsMessage::Pong(bytes)).await;
                continue;
            }
            WsMessage::Close(_) => return None,
            _ => continue,
        };
        let Ok(request) = serde_json::from_str::<Value>(&body) else {
            let _ = tx
                .send(text(rpc_error(&Value::Null, -32700, "invalid JSON")))
                .await;
            continue;
        };
        let id = request.get("id").cloned().unwrap_or(Value::Null);
        let method = request
            .get("method")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let params = request.get("params").cloned().unwrap_or(Value::Null);
        if method != "hello" {
            if method == "call" || !id.is_null() {
                let _ = tx.send(text(rpc_error(&id, -32002, "hello first"))).await;
            }
            continue;
        }
        slot.touch(frontends.service.engine.now());
        let newest = slot.events.last_seq();
        let ack = params.get("ack").and_then(Value::as_bool).unwrap_or(false);
        let mut credit = ack.then(|| {
            let limits = &frontends.limits;
            let window = params
                .get("creditBytes")
                .and_then(Value::as_u64)
                .unwrap_or(limits.default_credit_bytes)
                .clamp(limits.min_credit_bytes, limits.max_credit_bytes);
            Credit::new(window)
        });
        let device_id = slot.state.lock().await.meta.device_id.clone();
        let result = json!({
            "protocol": openbitfun_obp::OBP_PROTOCOL_VERSION,
            "scope": "account-device",
            "capabilities": CONNECTION_CAPABILITIES,
            "registryDigest": "",
            "backend": {
                "version": env!("CARGO_PKG_VERSION"),
                "platform": "cloud",
                "instanceId": slot.instance_id,
            },
            "lastSeq": newest,
            "creditBytes": credit.as_ref().map(|c| c.window),
            "hostCapabilities": HOST_CAPABILITIES,
            "hostKind": "cloud",
            "deviceId": device_id,
        });
        if tx.send(text(rpc_result(&id, result))).await.is_err() {
            return None;
        }

        let same_instance = params
            .get("instanceId")
            .and_then(Value::as_str)
            .is_none_or(|instance| instance == slot.instance_id);
        let last_seq = params.get("lastSeq").and_then(Value::as_u64);
        let cursor = match last_seq {
            Some(seq) if same_instance && seq <= newest => seq,
            Some(seq) => {
                let reason = if same_instance {
                    "unknown_cursor"
                } else {
                    "backend_restarted"
                };
                let frame = event_frame(
                    newest,
                    EVENTS_DROPPED_EVENT,
                    &json!({ "afterSeq": seq, "resumeSeq": newest + 1, "reason": reason }),
                );
                if let Some(credit) = credit.as_mut() {
                    credit.record(newest, frame.len() as u64);
                }
                if tx.send(text(frame)).await.is_err() {
                    return None;
                }
                newest
            }
            None => newest,
        };
        let subscription = slot.events.subscribe(Some(cursor));
        return Some(HelloSession {
            subscription,
            credit,
        });
    }
}

async fn connection<R, W>(
    frontends: Arc<Frontends>,
    slot: Arc<Slot>,
    mut reader: R,
    mut writer: W,
    mut inbound: RecordCipher,
    outbound: RecordCipher,
) where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
    W: tokio::io::AsyncWrite + Unpin + Send + 'static,
{
    let (tx, mut rx) = mpsc::channel::<WsMessage>(OUTBOX_CAPACITY);
    let write_timeout = frontends.limits.write_timeout;
    let writer_task = tokio::spawn(async move {
        let mut cipher = outbound;
        while let Some(message) = rx.recv().await {
            let close = matches!(message, WsMessage::Close(_));
            let Ok(record) = cipher.seal(&encode_message(&message)) else {
                break;
            };
            let wrote = tokio::time::timeout(write_timeout, write_record(&mut writer, &record))
                .await
                .map(|r| r.is_ok())
                .unwrap_or(false);
            if !wrote || close {
                break;
            }
        }
        let _ = writer.shutdown().await;
    });

    let hello = tokio::time::timeout(
        frontends.limits.hello_timeout,
        read_hello_phase(&frontends, &slot, &mut reader, &mut inbound, &tx),
    )
    .await;
    let Some(mut session) = hello.ok().flatten() else {
        log::debug!("Superagent frontend closed before hello");
        drop(tx);
        let _ = writer_task.await;
        return;
    };

    let text = |value: String| WsMessage::Text(value.into());
    let calls = Arc::new(Semaphore::new(frontends.limits.max_inflight_calls.max(1)));
    let mut ping = tokio::time::interval(frontends.limits.ping_interval);
    ping.tick().await;
    let mut last_heard = tokio::time::Instant::now();
    let mut stalled_since: Option<tokio::time::Instant> = None;

    let close_reason: Option<CloseFrame> = loop {
        let credit_exhausted = session.credit.as_ref().is_some_and(Credit::exhausted);
        if credit_exhausted {
            if stalled_since.is_none() {
                stalled_since = Some(tokio::time::Instant::now());
            }
        } else {
            stalled_since = None;
        }
        let stall_deadline =
            stalled_since.map(|since| since + frontends.limits.slow_client_timeout);

        let events = async {
            if credit_exhausted {
                std::future::pending().await
            } else {
                session.subscription.next_batch(EVENT_BATCH).await
            }
        };
        let stall_timer = async {
            match stall_deadline {
                Some(deadline) => tokio::time::sleep_until(deadline).await,
                None => std::future::pending().await,
            }
        };

        tokio::select! {
            record = read_record(&mut reader, RECORD_MAX) => {
                let Ok(record) = record else { break None };
                let Ok(message) = inbound.open(&record).and_then(decode_message) else { break None };
                last_heard = tokio::time::Instant::now();
                let body = match message {
                    WsMessage::Text(body) => body.to_string(),
                    WsMessage::Ping(bytes) => {
                        let _ = tx.try_send(WsMessage::Pong(bytes));
                        continue;
                    }
                    WsMessage::Pong(_) => continue,
                    WsMessage::Close(_) => break None,
                    _ => continue,
                };
                let Ok(request) = serde_json::from_str::<Value>(&body) else {
                    let _ = tx.try_send(text(rpc_error(&Value::Null, -32700, "invalid JSON")));
                    continue;
                };
                let id = request.get("id").cloned().unwrap_or(Value::Null);
                let method = request.get("method").and_then(Value::as_str).unwrap_or_default().to_string();
                let params = request.get("params").cloned().unwrap_or(Value::Null);
                match method.as_str() {
                    "call" => {
                        slot.touch(frontends.service.engine.now());
                        let Ok(permit) = Arc::clone(&calls).try_acquire_owned() else {
                            let _ = tx.try_send(text(rpc_error(
                                &id,
                                -32000,
                                "too_many_inflight_calls: too many concurrent calls on this connection",
                            )));
                            continue;
                        };
                        let command = params.get("command").and_then(Value::as_str).unwrap_or_default().to_string();
                        let args = params.get("args").cloned().unwrap_or(Value::Null);
                        let frontends = Arc::clone(&frontends);
                        let account = slot.account_id.clone();
                        let tx = tx.clone();
                        tokio::spawn(async move {
                            let _permit = permit;
                            let frame = match frontends.service.dispatch(&account, &command, args).await {
                                Ok(result) => rpc_result(&id, result),
                                Err(message) => rpc_error(&id, -32000, &message),
                            };
                            let _ = tx.send(WsMessage::Text(frame.into())).await;
                        });
                    }
                    "ack" => {
                        if let (Some(credit), Some(seq)) = (
                            session.credit.as_mut(),
                            params.get("seq").and_then(Value::as_u64),
                        ) {
                            credit.ack(seq);
                        }
                    }
                    "hello" => {
                        let _ = tx.try_send(text(rpc_error(&id, -32600, "hello already completed")));
                    }
                    _ if id.is_null() => {}
                    _ => {
                        let _ = tx.try_send(text(rpc_error(&id, -32601, "unknown method")));
                    }
                }
            }
            batch = events => {
                if batch.closed {
                    break None;
                }
                let mut slow = false;
                for event in batch.events {
                    let frame = event_frame(event.seq, &event.event, &event.payload);
                    if let Some(credit) = session.credit.as_mut() {
                        credit.record(event.seq, frame.len() as u64);
                    }
                    match tx.try_send(text(frame)) {
                        Ok(()) => {}
                        Err(mpsc::error::TrySendError::Full(_)) => {
                            slow = true;
                            break;
                        }
                        Err(mpsc::error::TrySendError::Closed(_)) => {
                            slow = false;
                            break;
                        }
                    }
                }
                if slow {
                    log::debug!("Superagent frontend closed: slow client outbox full");
                    break Some(CloseFrame {
                        code: 4008,
                        reason: "slow_client".into(),
                    });
                }
            }
            _ = stall_timer => {
                log::debug!("Superagent frontend closed: slow client credit exhausted");
                break Some(CloseFrame {
                    code: 4008,
                    reason: "slow_client".into(),
                });
            }
            _ = ping.tick() => {
                if last_heard.elapsed() >= frontends.limits.idle_timeout {
                    log::debug!("Superagent frontend closed: idle timeout");
                    break None;
                }
                if matches!(
                    tx.try_send(WsMessage::Ping(Vec::new().into())),
                    Err(mpsc::error::TrySendError::Closed(_))
                ) {
                    break None;
                }
            }
        }
    };

    if let Some(frame) = close_reason {
        let _ = tx.send(WsMessage::Close(Some(frame))).await;
    }
    drop(tx);
    let _ = writer_task.await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nonce_cache_rejects_replays_prunes_expired_and_enforces_cap() {
        let mut cache = NonceCache::new(3);
        let t0 = 1_000_000u64;
        assert!(cache.consume("n1", t0));
        assert!(!cache.consume("n1", t0 + 1), "replay must be rejected");
        assert!(cache.consume("n2", t0 + 2));
        assert!(cache.consume("n3", t0 + 3));
        assert_eq!(cache.entries.len(), 3);

        // Inserting a 4th evicts the oldest ("n1") and keeps the map capped at 3.
        assert!(cache.consume("n4", t0 + 4));
        assert_eq!(cache.entries.len(), 3);
        assert!(!cache.entries.contains_key("n1"));
        assert!(cache.entries.contains_key("n4"));

        // Advancing past 2 * MAX_CLOCK_SKEW_MS prunes all expired nonces.
        let later = t0 + 2 * handshake::MAX_CLOCK_SKEW_MS + 10;
        assert!(cache.consume("n5", later));
        assert_eq!(cache.entries.len(), 1);
        assert!(cache.entries.contains_key("n5"));
    }

    #[test]
    fn credit_tracks_window_and_releases_on_ack() {
        let mut credit = Credit::new(100);
        assert!(!credit.exhausted());
        credit.record(1, 60);
        assert!(!credit.exhausted());
        credit.record(2, 50);
        assert!(credit.exhausted());
        credit.ack(1);
        assert!(!credit.exhausted());
        assert_eq!(credit.unacked_bytes, 50);
        credit.ack(2);
        assert_eq!(credit.unacked_bytes, 0);
    }
}

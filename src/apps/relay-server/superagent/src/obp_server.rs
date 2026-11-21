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

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use axum::extract::ws::{Message as WsMessage, WebSocket, WebSocketUpgrade};
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
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt, DuplexStream};
use x25519_dalek::{PublicKey, StaticSecret};

use crate::api::{node_secret, Service, HOST_CAPABILITIES};
use crate::crypto;
use crate::directory::Identity;
use crate::slots::Slot;

const HELLO_MAX: usize = 4 * 1024;
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);
const PING_INTERVAL: Duration = Duration::from_secs(30);
const EVENT_BATCH: usize = 256;
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

pub struct Frontends {
    pub service: Arc<Service>,
    pub identity: Arc<dyn Identity>,
    /// Off: the node is deployed but frontends cannot use it yet.
    pub enabled: bool,
    targets: std::sync::Mutex<HashMap<String, String>>,
    nonces: std::sync::Mutex<HashMap<String, u64>>,
}

impl Frontends {
    pub fn new(service: Arc<Service>, identity: Arc<dyn Identity>, enabled: bool) -> Arc<Self> {
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
        Arc::new(Self {
            service,
            identity,
            enabled,
            targets: std::sync::Mutex::new(targets),
            nonces: std::sync::Mutex::new(HashMap::new()),
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
        let mut nonces = self.nonces.lock().unwrap_or_else(|p| p.into_inner());
        nonces.retain(|_, at| now.saturating_sub(*at) <= 2 * handshake::MAX_CLOCK_SKEW_MS);
        nonces.insert(nonce.to_string(), now).is_none()
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
    upgrade
        .max_message_size(RECORD_MAX + 64)
        .on_upgrade(move |socket| async move {
            let (io, pump) = bridge(socket);
            let serve = serve_stream(frontends, io);
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
    let (slot, key, claims) = verified;
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
    if write_record(&mut stream, &answer).await.is_err() {
        return;
    }
    let (c2s, s2c) = derive_keys(&key, shared.as_bytes(), &hello.proof, &server_proof);
    log::info!("Superagent frontend connected: device={}", hello.device);
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
    log::info!("Superagent frontend disconnected: device={}", hello.device);
}

type Verified = (Arc<Slot>, [u8; 32], Claims);

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
    Ok((slot, key, claims))
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
    let (tx, mut rx) = tokio::sync::mpsc::channel::<axum::extract::ws::Message>(256);
    let writer_task = tokio::spawn(async move {
        let mut cipher = outbound;
        while let Some(message) = rx.recv().await {
            let close = matches!(message, axum::extract::ws::Message::Close(_));
            let Ok(record) = cipher.seal(&encode_message(&message)) else {
                break;
            };
            if write_record(&mut writer, &record).await.is_err() || close {
                break;
            }
        }
        let _ = writer.shutdown().await;
    });
    let text = |value: String| axum::extract::ws::Message::Text(value.into());
    let mut subscription: Option<openbitfun_obp::EventSubscription> = None;
    let mut ping = tokio::time::interval(PING_INTERVAL);
    ping.tick().await;
    loop {
        let events = async {
            match subscription.as_mut() {
                Some(subscription) => Some(subscription.next_batch(EVENT_BATCH).await),
                None => std::future::pending().await,
            }
        };
        tokio::select! {
            record = read_record(&mut reader, RECORD_MAX) => {
                let Ok(record) = record else { break };
                let Ok(message) = inbound.open(&record).and_then(decode_message) else { break };
                let body = match message {
                    axum::extract::ws::Message::Text(body) => body.to_string(),
                    axum::extract::ws::Message::Ping(bytes) => {
                        let _ = tx.send(axum::extract::ws::Message::Pong(bytes)).await;
                        continue;
                    }
                    axum::extract::ws::Message::Close(_) => break,
                    _ => continue,
                };
                let Ok(request) = serde_json::from_str::<Value>(&body) else {
                    let _ = tx.send(text(rpc_error(&Value::Null, -32700, "invalid JSON"))).await;
                    continue;
                };
                let id = request.get("id").cloned().unwrap_or(Value::Null);
                let method = request.get("method").and_then(Value::as_str).unwrap_or_default().to_string();
                let params = request.get("params").cloned().unwrap_or(Value::Null);
                match method.as_str() {
                    "hello" => {
                        let last = params.get("lastSeq").and_then(Value::as_u64);
                        let same = params.get("instanceId").and_then(Value::as_str) == Some(slot.instance_id.as_str());
                        let after = if same { last } else { None };
                        subscription = Some(slot.events.subscribe(Some(after.unwrap_or_else(|| slot.events.last_seq()))));
                        let device_id = slot.state.lock().await.meta.device_id.clone();
                        let result = json!({
                            "protocol": openbitfun_obp::OBP_PROTOCOL_VERSION,
                            "scope": "account-device",
                            "capabilities": CONNECTION_CAPABILITIES,
                            "registryDigest": "",
                            "backend": { "version": env!("CARGO_PKG_VERSION"), "platform": "cloud", "instanceId": slot.instance_id },
                            "lastSeq": slot.events.last_seq(),
                            "creditBytes": Value::Null,
                            "hostCapabilities": HOST_CAPABILITIES,
                            "hostKind": "cloud",
                            "deviceId": device_id,
                        });
                        let _ = tx.send(text(rpc_result(&id, result))).await;
                    }
                    "call" if subscription.is_none() => {
                        let _ = tx.send(text(rpc_error(&id, -32002, "hello first"))).await;
                    }
                    "call" => {
                        let command = params.get("command").and_then(Value::as_str).unwrap_or_default().to_string();
                        let args = params.get("args").cloned().unwrap_or(Value::Null);
                        let frontends = Arc::clone(&frontends);
                        let account = slot.account_id.clone();
                        let tx = tx.clone();
                        tokio::spawn(async move {
                            let frame = match frontends.service.dispatch(&account, &command, args).await {
                                Ok(result) => rpc_result(&id, result),
                                Err(message) => rpc_error(&id, -32000, &message),
                            };
                            let _ = tx.send(axum::extract::ws::Message::Text(frame.into())).await;
                        });
                    }
                    "ack" => {}
                    _ if id.is_null() => {}
                    _ => {
                        let _ = tx.send(text(rpc_error(&id, -32601, "unknown method"))).await;
                    }
                }
            }
            batch = events => {
                let Some(batch) = batch else { continue };
                if batch.closed {
                    break;
                }
                for event in batch.events {
                    let frame = json!({ "jsonrpc": "2.0", "method": "event", "params": { "seq": event.seq, "event": event.event, "payload": event.payload } });
                    if tx.send(text(frame.to_string())).await.is_err() {
                        break;
                    }
                }
            }
            _ = ping.tick() => {
                if tx.send(axum::extract::ws::Message::Ping(Vec::new().into())).await.is_err() {
                    break;
                }
            }
        }
        slot.touch(frontends.service.engine.now());
    }
    drop(tx);
    let _ = writer_task.await;
}

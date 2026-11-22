//! The gateway's routes (behind nginx at `https://super.openbitfun.com/obp/`
//! and `/cas/`):
//!
//! - `GET  /obp/api/v1/session`: whether this browser is signed in.
//! - `POST /obp/api/v1/auth/code` `{email, locale}`: sends a sign-in code.
//! - `POST /obp/api/v1/auth/verify` `{challengeId, code, device}`: completes
//!   the sign-in, registers the browser's device key in the account
//!   directory, and sets the session cookie.
//! - `POST /obp/api/v1/auth/sign-out`: revokes the browser's credential.
//! - `GET  /obp/api/v1/devices`: the account's devices, with whether each can
//!   be connected and why not (the gateway decides; the page only draws it),
//!   and `entryCandidates`: the device ids the page tries as its fleet entry,
//!   best first (each device's `fleet_v1` and `fleetLoad` come from its own
//!   `/obp/mesh/info`, probed at most every 30 s, `crate::probe`), with the
//!   account's cloud node always last (`cloudNode` says where it is reached).
//! - `GET  /obp/api/v1/devices/{id}/key`: a device's public key, for the
//!   browser's end-to-end handshake.
//! - `GET  /obp/{deviceId}` (WebSocket): a byte pipe to the device's OBP port
//!   in the account network. The browser runs the end-to-end channel inside
//!   it; the gateway only counts bytes.
//! - `GET  /cas/{sha256}?device={deviceId}`: a file of a device's web UI
//!   bundle from the untrusted pool, pulled through from that device (one of
//!   the account's own) on a miss, then from the other account devices named
//!   in `&holders=` (`crate::pool`). The session cookie is set
//!   on `/obp` and `/cas`.
//!
//! Isolation: the account comes only from the sealed session, a pipe opens
//! only to a device the directory lists for that account (checked with the
//! browser's own directory credential), and streams go through that
//! account's own network member. Limits: pipes in total and per account
//! (Link), code and verify requests per client address, and idle pipes are
//! closed. The gateway pings each WebSocket every 30 s (the provider's front
//! end closes a WebSocket after 180 s of silence).

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::extract::ws::{CloseFrame, Message, WebSocket};
use axum::extract::{Path, State, WebSocketUpgrade};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use base64::Engine;
use futures::{SinkExt, StreamExt};
use serde::Deserialize;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::pool::{PullError, UiPool};
use crate::probe::{InfoProbes, ProbeFacts};
use crate::session::{self, Session, SessionSealer};
use crate::upstream::{
    Accounts, DeviceRegistration, DeviceStreams, DirectoryDevice, OnlineMember, PendingSignIn,
    StreamError, UpstreamError,
};

/// Gateway tunables.
#[derive(Debug, Clone)]
pub(crate) struct GatewayOptions {
    /// Page origins allowed to call the API and open pipes.
    pub(crate) origins: Vec<String>,
    /// Mark cookies `Secure` (off only for local `http://` development).
    pub(crate) secure_cookies: bool,
    /// Open pipes at the same time, all accounts.
    pub(crate) max_pipes: usize,
    /// A pipe without bytes or ping/pong liveness for this long is closed.
    pub(crate) idle_timeout: Duration,
    /// WebSocket ping interval (keeps the provider's front end open).
    pub(crate) ping_interval: Duration,
    /// Longest a WebSocket or device stream write may block before the pipe closes.
    pub(crate) write_timeout: Duration,
    /// Code requests per client address per minute.
    pub(crate) code_requests_per_minute: u32,
    /// Verify attempts per client address per minute.
    pub(crate) verify_requests_per_minute: u32,
}

impl Default for GatewayOptions {
    fn default() -> Self {
        Self {
            origins: vec!["https://super.openbitfun.com".to_string()],
            secure_cookies: true,
            max_pipes: 1024,
            idle_timeout: Duration::from_secs(150),
            ping_interval: Duration::from_secs(30),
            write_timeout: Duration::from_secs(30),
            code_requests_per_minute: 6,
            verify_requests_per_minute: 20,
        }
    }
}

const PENDING_LIMIT: usize = 10_000;
const MAX_VERIFY_ATTEMPTS: u8 = 5;
const RATE_WINDOW_MAX_KEYS: usize = 100_000;
const RATE_WINDOW_DURATION: Duration = Duration::from_secs(60);
const DIRECTORY_CACHE: Duration = Duration::from_secs(20);
const DIRECTORY_CACHE_LIMIT: usize = 10_000;
const PIPE_CHUNK: usize = 64 * 1024;
/// Largest browser frame (the browser splits records into smaller frames).
const MAX_BROWSER_FRAME: usize = 1024 * 1024;

/// Close codes a pipe ends with (the browser shows the reason).
mod close {
    pub(crate) const SIGNED_OUT: u16 = 4401;
    pub(crate) const NOT_YOUR_DEVICE: u16 = 4403;
    pub(crate) const UNREACHABLE: u16 = 4404;
    pub(crate) const BUSY: u16 = 4429;
    pub(crate) const UNAVAILABLE: u16 = 4503;
}

struct RateBucket {
    started: Instant,
    count: u32,
}

/// Per-key fixed-window rate counter with bounded key capacity.
///
/// When at capacity, expired windows are pruned first; if the table is still
/// full of active windows, new keys are refused rather than wiping existing
/// active counters.
pub(crate) struct RateWindow {
    window: Duration,
    max_keys: usize,
    earliest_start: Instant,
    counts: HashMap<String, RateBucket>,
}

impl RateWindow {
    pub(crate) fn new() -> Self {
        Self::with_limits(RATE_WINDOW_MAX_KEYS, RATE_WINDOW_DURATION)
    }

    pub(crate) fn with_limits(max_keys: usize, window: Duration) -> Self {
        Self {
            window,
            max_keys: max_keys.max(1),
            earliest_start: Instant::now(),
            counts: HashMap::new(),
        }
    }

    pub(crate) fn allow(&mut self, key: &str, limit: u32) -> bool {
        self.allow_at(key, limit, Instant::now())
    }

    pub(crate) fn allow_at(&mut self, key: &str, limit: u32, now: Instant) -> bool {
        if limit == 0 {
            return false;
        }
        if let Some(bucket) = self.counts.get_mut(key) {
            if now.saturating_duration_since(bucket.started) >= self.window {
                bucket.started = now;
                bucket.count = 1;
                return true;
            }
            if bucket.count >= limit {
                return false;
            }
            bucket.count += 1;
            return true;
        }
        if self.counts.len() >= self.max_keys {
            if now.saturating_duration_since(self.earliest_start) < self.window {
                return false;
            }
            self.prune_expired(now);
            if self.counts.len() >= self.max_keys {
                return false;
            }
        } else if self.counts.len() >= 1024
            && now.saturating_duration_since(self.earliest_start) >= self.window
        {
            self.prune_expired(now);
        }
        if self.counts.is_empty() || now < self.earliest_start {
            self.earliest_start = now;
        }
        self.counts.insert(
            key.to_string(),
            RateBucket {
                started: now,
                count: 1,
            },
        );
        true
    }

    fn prune_expired(&mut self, now: Instant) {
        let window = self.window;
        self.counts
            .retain(|_, bucket| now.saturating_duration_since(bucket.started) < window);
        self.earliest_start = self
            .counts
            .values()
            .map(|bucket| bucket.started)
            .min()
            .unwrap_or(now);
    }

    #[cfg(test)]
    pub(crate) fn len(&self) -> usize {
        self.counts.len()
    }
}

struct PendingEntry {
    sign_in: PendingSignIn,
    /// Unix seconds.
    expires_at: i64,
    attempts: u8,
}

/// The gateway's shared state.
pub(crate) struct Gateway {
    accounts: Arc<dyn Accounts>,
    streams: Arc<dyn DeviceStreams>,
    sealer: SessionSealer,
    options: GatewayOptions,
    pending: Mutex<HashMap<String, PendingEntry>>,
    codes: Mutex<RateWindow>,
    verifies: Mutex<RateWindow>,
    directory: Mutex<HashMap<String, (Instant, Vec<DirectoryDevice>)>>,
    pipes: AtomicUsize,
    pipe_ids: AtomicU64,
    /// The web UI pool; `None`: it could not be opened (answers say so).
    pool: Option<Arc<UiPool>>,
    /// Each device's `/obp/mesh/info` ranking facts (≤ 30 s old).
    probes: InfoProbes,
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs() as i64)
        .unwrap_or_default()
}

fn random_id() -> String {
    let mut bytes = [0u8; 18];
    rand::RngCore::fill_bytes(&mut rand::rngs::OsRng, &mut bytes);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

/// Device ids as the directory and Link accept them.
fn valid_device_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
}

/// A short, stable label for logs (never the account id itself).
pub(crate) fn account_label(account_id: &str) -> String {
    use sha2::Digest;
    let digest = sha2::Sha256::digest(account_id.as_bytes());
    digest[..4]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn api_error(status: StatusCode, code: &str, message: &str, retry_after: Option<u64>) -> Response {
    let mut body = serde_json::json!({ "error": code, "message": message });
    if let Some(seconds) = retry_after {
        body["retryAfterSeconds"] = seconds.into();
    }
    no_store((status, Json(body)).into_response())
}

fn upstream_error(error: UpstreamError) -> Response {
    let status = match error.code {
        "invalid_email" | "invalid_code" => StatusCode::BAD_REQUEST,
        "rate_limited" => StatusCode::TOO_MANY_REQUESTS,
        "signed_out" => StatusCode::UNAUTHORIZED,
        "not_found" => StatusCode::NOT_FOUND,
        _ => StatusCode::SERVICE_UNAVAILABLE,
    };
    api_error(
        status,
        error.code,
        &error.message,
        error.retry_after_seconds,
    )
}

fn with_cookies(mut response: Response, cookies: Vec<String>) -> Response {
    for cookie in cookies {
        if let Ok(value) = HeaderValue::from_str(&cookie) {
            response.headers_mut().append(header::SET_COOKIE, value);
        }
    }
    response
}

fn no_store(mut response: Response) -> Response {
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

fn parse_ip(value: &str) -> Option<std::net::IpAddr> {
    value.trim().parse::<std::net::IpAddr>().ok()
}

fn client_ip(headers: &HeaderMap, peer: Option<SocketAddr>) -> String {
    let Some(peer) = peer else {
        return "unknown".to_string();
    };
    // Only trust proxy headers when nginx reaches us over loopback.
    if peer.ip().is_loopback() {
        if let Some(ip) = headers
            .get("x-real-ip")
            .and_then(|value| value.to_str().ok())
            .and_then(parse_ip)
        {
            return ip.to_string();
        }
        // Rightmost non-empty entry of the last X-Forwarded-For header
        // (appended by nginx); never the client-controlled leftmost entry.
        if let Some(ip) = headers
            .get_all("x-forwarded-for")
            .iter()
            .next_back()
            .and_then(|value| value.to_str().ok())
            .and_then(|value| {
                value
                    .rsplit(',')
                    .map(str::trim)
                    .find(|part| !part.is_empty())
            })
            .and_then(parse_ip)
        {
            return ip.to_string();
        }
    }
    peer.ip().to_string()
}

/// Readable OS label from a User-Agent (the directory's device name).
fn browser_device_name(headers: &HeaderMap) -> String {
    let agent = headers
        .get(header::USER_AGENT)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    let os = if agent.contains("iPhone") || agent.contains("iPad") {
        "iOS"
    } else if agent.contains("Android") {
        "Android"
    } else if agent.contains("Mac OS X") || agent.contains("Macintosh") {
        "macOS"
    } else if agent.contains("Windows") {
        "Windows"
    } else if agent.contains("Linux") {
        "Linux"
    } else {
        ""
    };
    if os.is_empty() {
        "Web browser".to_string()
    } else {
        format!("Web browser on {os}")
    }
}

impl Gateway {
    pub(crate) fn new(
        accounts: Arc<dyn Accounts>,
        streams: Arc<dyn DeviceStreams>,
        sealer: SessionSealer,
        options: GatewayOptions,
        pool: Option<Arc<UiPool>>,
    ) -> Arc<Self> {
        Arc::new(Self {
            accounts,
            streams,
            sealer,
            options,
            pending: Mutex::new(HashMap::new()),
            codes: Mutex::new(RateWindow::new()),
            verifies: Mutex::new(RateWindow::new()),
            directory: Mutex::new(HashMap::new()),
            pipes: AtomicUsize::new(0),
            pipe_ids: AtomicU64::new(1),
            pool,
            probes: InfoProbes::default(),
        })
    }

    /// The routes, mounted at `/obp`.
    pub(crate) fn router(self: &Arc<Self>) -> Router {
        Router::new()
            .route("/obp/api/v1/session", get(session_route))
            .route("/obp/api/v1/auth/code", post(code_route))
            .route("/obp/api/v1/auth/verify", post(verify_route))
            .route("/obp/api/v1/auth/sign-out", post(sign_out_route))
            .route("/obp/api/v1/devices", get(devices_route))
            .route("/obp/api/v1/devices/{device_id}/key", get(device_key_route))
            .route("/obp/{device_id}", get(pipe_route))
            .route("/cas/{hash}", get(cas_route))
            .with_state(Arc::clone(self))
    }

    /// Open pipes now.
    #[cfg(test)]
    pub(crate) fn open_pipes(&self) -> usize {
        self.pipes.load(Ordering::Acquire)
    }

    fn origin_allowed(&self, headers: &HeaderMap) -> bool {
        match headers
            .get(header::ORIGIN)
            .and_then(|value| value.to_str().ok())
        {
            Some(origin) => self.options.origins.iter().any(|allowed| allowed == origin),
            None => false,
        }
    }

    fn session(&self, headers: &HeaderMap) -> Option<Session> {
        let header = headers.get(header::COOKIE)?.to_str().ok()?;
        self.sealer.open(session::cookie_value(header)?, now_secs())
    }

    fn begin_verify(&self, id: &str) -> Option<PendingSignIn> {
        let mut pending = self.pending.lock().unwrap_or_else(|e| e.into_inner());
        let now = now_secs();
        pending.retain(|_, entry| entry.expires_at > now);
        let entry = pending.get_mut(id)?;
        if entry.attempts >= MAX_VERIFY_ATTEMPTS {
            pending.remove(id);
            return None;
        }
        entry.attempts += 1;
        Some(entry.sign_in.clone())
    }

    fn finish_verify_failure(&self, id: &str, error_code: &str) {
        let mut pending = self.pending.lock().unwrap_or_else(|e| e.into_inner());
        if error_code == "unavailable" {
            if let Some(entry) = pending.get_mut(id) {
                entry.attempts = entry.attempts.saturating_sub(1);
            }
            return;
        }
        if pending
            .get(id)
            .is_some_and(|entry| entry.attempts >= MAX_VERIFY_ATTEMPTS)
        {
            pending.remove(id);
        }
    }

    /// The account's host devices, through the browser's own credential
    /// (cached briefly per credential).
    async fn directory_devices(
        &self,
        session: &Session,
    ) -> Result<Vec<DirectoryDevice>, UpstreamError> {
        {
            let cache = self.directory.lock().unwrap_or_else(|e| e.into_inner());
            if let Some((at, devices)) = cache.get(&session.directory_token) {
                if at.elapsed() < DIRECTORY_CACHE {
                    return Ok(devices.clone());
                }
            }
        }
        let devices = self.accounts.devices(&session.directory_token).await?;
        let mut cache = self.directory.lock().unwrap_or_else(|e| e.into_inner());
        if !cache.contains_key(&session.directory_token) && cache.len() >= DIRECTORY_CACHE_LIMIT {
            cache.retain(|_, (at, _)| at.elapsed() < DIRECTORY_CACHE);
            if cache.len() >= DIRECTORY_CACHE_LIMIT {
                if let Some(oldest) = cache
                    .iter()
                    .min_by_key(|(_, (at, _))| *at)
                    .map(|(k, _)| k.clone())
                {
                    cache.remove(&oldest);
                }
            }
        }
        cache.insert(
            session.directory_token.clone(),
            (Instant::now(), devices.clone()),
        );
        Ok(devices)
    }

    fn forget_directory(&self, token: &str) {
        self.directory
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(token);
    }
}

/// The signed-in account as the web controller reads it: the identity
/// projection every surface shows, built by the shared contract. A browser
/// signs in only with the email code, so the name it knows is that email
/// whatever shape the account id has.
fn account_json(session: &Session) -> serde_json::Value {
    let email = session.email.as_deref();
    serde_json::json!({
        "accountId": session.account_id,
        "identity": openbitfun_product_domains::account::AccountIdentityView::from_parts(
            &session.account_id,
            email,
            email,
            None,
        ),
        "deviceId": session.device_id,
    })
}

async fn session_route(State(gateway): State<Arc<Gateway>>, headers: HeaderMap) -> Response {
    match gateway.session(&headers) {
        // Re-issued on every path, so a browser signed in before the pool
        // existed (cookie on `/obp` only) gets the `/cas` one too.
        Some(session) => {
            let value = headers
                .get(header::COOKIE)
                .and_then(|value| value.to_str().ok())
                .and_then(session::cookie_value)
                .unwrap_or_default()
                .to_string();
            let response =
                Json(serde_json::json!({ "signedIn": true, "account": account_json(&session) }))
                    .into_response();
            no_store(with_cookies(
                response,
                session::set_cookies(
                    &value,
                    session.expires_at - now_secs(),
                    gateway.options.secure_cookies,
                ),
            ))
        }
        None => no_store(Json(serde_json::json!({ "signedIn": false })).into_response()),
    }
}

#[derive(Deserialize)]
struct CodeRequest {
    email: String,
    #[serde(default)]
    locale: Option<String>,
}

async fn code_route(
    State(gateway): State<Arc<Gateway>>,
    connect: Option<axum::Extension<axum::extract::ConnectInfo<SocketAddr>>>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Response {
    if !gateway.origin_allowed(&headers) {
        return api_error(
            StatusCode::FORBIDDEN,
            "bad_origin",
            "This page may not sign in here.",
            None,
        );
    }
    let Ok(request) = serde_json::from_slice::<CodeRequest>(&body) else {
        return api_error(
            StatusCode::BAD_REQUEST,
            "invalid_email",
            "Enter a valid email address.",
            None,
        );
    };
    let email = request.email.trim().to_ascii_lowercase();
    if email.len() > 254 || !email.contains('@') || email.chars().any(char::is_whitespace) {
        return api_error(
            StatusCode::BAD_REQUEST,
            "invalid_email",
            "Enter a valid email address.",
            None,
        );
    }
    let ip = client_ip(&headers, connect.map(|axum::Extension(info)| info.0));
    let limit = gateway.options.code_requests_per_minute;
    if !gateway
        .codes
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .allow(&ip, limit)
    {
        return api_error(
            StatusCode::TOO_MANY_REQUESTS,
            "rate_limited",
            "Too many code requests from this network; wait a minute.",
            Some(60),
        );
    }
    let locale = request
        .locale
        .filter(|locale| {
            locale.len() <= 16
                && locale
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-')
        })
        .unwrap_or_else(|| "en-US".to_string());
    let sign_in = match gateway.accounts.send_code(&email, &locale, &ip).await {
        Ok(sign_in) => sign_in,
        Err(error) => return upstream_error(error),
    };
    let id = random_id();
    let answer = serde_json::json!({
        "challengeId": id,
        "email": sign_in.email,
        "codeLength": 8,
        "retryAfterSeconds": sign_in.retry_after_seconds,
        "expiresAt": sign_in.expires_at.saturating_mul(1000),
    });
    {
        let mut pending = gateway.pending.lock().unwrap_or_else(|e| e.into_inner());
        let now = now_secs();
        pending.retain(|_, entry| entry.expires_at > now);
        if pending.len() >= PENDING_LIMIT {
            return api_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "unavailable",
                "Sign-in is busy; try again shortly.",
                Some(30),
            );
        }
        let expires_at = sign_in.expires_at.min(now + 15 * 60);
        pending.insert(
            id,
            PendingEntry {
                sign_in,
                expires_at,
                attempts: 0,
            },
        );
    }
    no_store(Json(answer).into_response())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct VerifyDevice {
    device_id: String,
    public_key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct VerifyRequest {
    challenge_id: String,
    code: String,
    device: VerifyDevice,
}

async fn verify_route(
    State(gateway): State<Arc<Gateway>>,
    connect: Option<axum::Extension<axum::extract::ConnectInfo<SocketAddr>>>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Response {
    if !gateway.origin_allowed(&headers) {
        return api_error(
            StatusCode::FORBIDDEN,
            "bad_origin",
            "This page may not sign in here.",
            None,
        );
    }
    let Ok(request) = serde_json::from_slice::<VerifyRequest>(&body) else {
        return api_error(
            StatusCode::BAD_REQUEST,
            "invalid_code",
            "The request is incomplete.",
            None,
        );
    };
    let ip = client_ip(&headers, connect.map(|axum::Extension(info)| info.0));
    let limit = gateway.options.verify_requests_per_minute;
    if !gateway
        .verifies
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .allow(&ip, limit)
    {
        return api_error(
            StatusCode::TOO_MANY_REQUESTS,
            "rate_limited",
            "Too many attempts from this network; wait a minute.",
            Some(60),
        );
    }
    let code: String = request
        .code
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect();
    if code.len() != 8 || !code.bytes().all(|b| b.is_ascii_digit()) {
        return api_error(
            StatusCode::BAD_REQUEST,
            "invalid_code",
            "Enter the 8-digit code from the email.",
            None,
        );
    }
    let public_key_ok = base64::engine::general_purpose::STANDARD
        .decode(request.device.public_key.trim())
        .is_ok_and(|key| key.len() == 32 && key.iter().any(|b| *b != 0));
    if !valid_device_id(&request.device.device_id) || !public_key_ok {
        return api_error(
            StatusCode::BAD_REQUEST,
            "invalid_code",
            "This browser's device key is invalid.",
            None,
        );
    }
    let Some(sign_in) = gateway.begin_verify(&request.challenge_id) else {
        return api_error(
            StatusCode::BAD_REQUEST,
            "invalid_code",
            "This sign-in expired; request a new code.",
            None,
        );
    };
    let access_token = match gateway.accounts.verify_code(&sign_in, &code).await {
        Ok(token) => token,
        Err(error) => {
            gateway.finish_verify_failure(&request.challenge_id, error.code);
            return upstream_error(error);
        }
    };
    gateway
        .pending
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(&request.challenge_id);
    let registration = DeviceRegistration {
        device_id: request.device.device_id.clone(),
        public_key: request.device.public_key.trim().to_string(),
        name: browser_device_name(&headers),
    };
    let registered = match gateway
        .accounts
        .register(&access_token, &registration, &ip)
        .await
    {
        Ok(registered) => registered,
        Err(error) => return upstream_error(error),
    };
    let now = now_secs();
    let session = Session {
        account_id: registered.account_id,
        device_id: registration.device_id,
        directory_token: registered.directory_token,
        email: Some(sign_in.email),
        issued_at: now,
        expires_at: now + session::SESSION_SECONDS,
    };
    log::info!(
        "Gateway sign-in: account={}, device={}",
        account_label(&session.account_id),
        session.device_id
    );
    // On by default: the first sign-in creates the account's cloud node.
    // Never awaited here; the browser's sign-in does not depend on it.
    {
        let accounts = Arc::clone(&gateway.accounts);
        tokio::spawn(async move { accounts.ensure_cloud_node(&access_token).await });
    }
    let response = Json(serde_json::json!({ "account": account_json(&session) })).into_response();
    no_store(with_cookies(
        response,
        session::set_cookies(
            &gateway.sealer.seal(&session),
            session::SESSION_SECONDS,
            gateway.options.secure_cookies,
        ),
    ))
}

async fn sign_out_route(State(gateway): State<Arc<Gateway>>, headers: HeaderMap) -> Response {
    if !gateway.origin_allowed(&headers) {
        return api_error(
            StatusCode::FORBIDDEN,
            "bad_origin",
            "This page may not sign out here.",
            None,
        );
    }
    if let Some(session) = gateway.session(&headers) {
        if let Err(error) = gateway.accounts.sign_out(&session.directory_token).await {
            log::warn!(
                "Gateway sign-out could not revoke the directory credential: {}",
                error.message
            );
        }
        gateway.forget_directory(&session.directory_token);
    }
    let response = Json(serde_json::json!({ "signedIn": false })).into_response();
    no_store(with_cookies(
        response,
        session::clear_cookies(gateway.options.secure_cookies),
    ))
}

fn signed_out(secure_cookies: bool) -> Response {
    let response = api_error(
        StatusCode::UNAUTHORIZED,
        "signed_out",
        "Sign in with your OpenBitFun account.",
        None,
    );
    with_cookies(response, session::clear_cookies(secure_cookies))
}

/// The device list the page draws: every reachability decision is here.
///
/// `network` is the account network as the gateway sees it now (device id
/// -> member online), or `None` when it could not be read: then every host
/// device can be tried, the directory's `online` (the legacy relay socket,
/// which hosts on Link do not keep) is only a hint, and a pipe to a device
/// that is not on the device network answers why (4404).
fn device_view(
    device: &DirectoryDevice,
    network: Option<&HashMap<String, OnlineMember>>,
) -> serde_json::Value {
    let name = device
        .device_alias
        .clone()
        .filter(|alias| !alias.trim().is_empty())
        .or_else(|| Some(device.device_name.clone()).filter(|name| !name.trim().is_empty()))
        .unwrap_or_else(|| device.device_id.clone());
    let (online, connectable, unavailable, route) = match network {
        None => (device.online, true, serde_json::Value::Null, None),
        Some(network) => match network.get(&device.device_id) {
            Some(member) if member.controller => (
                true,
                false,
                serde_json::json!({
                    "code": "controller",
                    "message": "This is a phone or browser session; it has nothing to control.",
                }),
                None,
            ),
            Some(member) => (true, true, serde_json::Value::Null, member.route.clone()),
            None => (
                false,
                false,
                serde_json::json!({
                    "code": "offline",
                    "message": "This device is not on your device network right now. Open OpenBitFun on it and sign in.",
                }),
                None,
            ),
        },
    };
    serde_json::json!({
        "deviceId": device.device_id,
        "name": name,
        "kind": device.device_kind,
        "os": device.device_os,
        "model": device.device_model,
        "clientVersion": device.client_version,
        "online": online,
        "lastSeenAt": device.last_seen_at.map(|seconds| seconds.saturating_mul(1000)),
        "connectable": connectable,
        "unavailable": unavailable,
        "route": route,
    })
}

/// Where a page reaches the account's cloud node (an OBP endpoint on this
/// domain, behind nginx; not a pipe into the account network).
pub(crate) const CLOUD_NODE_PATH: &str = "/agent/obp";

/// The account's runtime hosts a browser may enter the fleet through, best
/// first (`rank_entry_candidates`, the same ranking the phone applies):
/// online, then with the fleet layer (`fleet_v1`), then a full host (a
/// desktop), then lowest latency as the gateway reaches it, then fewest
/// attached clients (`fleetLoad`), then newest version. `facts` holds each
/// device's probe of its own `/obp/mesh/info` (missing: unknown, as for an
/// older device). Only devices the page may connect are listed, and the
/// account's cloud node comes last, always: it is the entry when no device
/// is online (it serves its cached index and the superagent).
fn entry_candidates(
    devices: &[DirectoryDevice],
    network: Option<&HashMap<String, OnlineMember>>,
    facts: &HashMap<String, ProbeFacts>,
) -> Vec<String> {
    use openbitfun_product_domains::fleet::{rank_entry_candidates, FleetEntryCandidate};
    let candidates: Vec<FleetEntryCandidate> = devices
        .iter()
        .filter(|device| !device.is_cloud_node())
        .filter_map(|device| {
            let (online, latency_ms) = match network {
                None => (device.online, None),
                Some(network) => match network.get(&device.device_id) {
                    Some(member) if member.controller => return None,
                    Some(member) => (
                        true,
                        member
                            .latency_ms
                            .filter(|latency| latency.is_finite() && *latency >= 0.0)
                            .map(|latency| latency.round().min(u32::MAX as f64) as u32),
                    ),
                    // Not on the device network: the page cannot open it.
                    None => return None,
                },
            };
            // A row without a kind predates kind reporting and is a desktop.
            let full_host = matches!(device.device_kind.as_deref(), None | Some("desktop"));
            let probed = facts.get(&device.device_id).copied().unwrap_or_default();
            Some(FleetEntryCandidate {
                device_id: device.device_id.clone(),
                online,
                fleet_protocol: probed.fleet_protocol,
                full_host,
                latency_ms,
                fleet_load: probed.fleet_load,
                version: device.client_version.clone(),
            })
        })
        .collect();
    let mut ranked: Vec<String> = rank_entry_candidates(&candidates)
        .into_iter()
        .map(|candidate| candidate.device_id)
        .collect();
    let mut cloud: Vec<String> = devices
        .iter()
        .filter(|device| device.is_cloud_node())
        .map(|device| device.device_id.clone())
        .collect();
    cloud.sort();
    cloud.dedup();
    ranked.extend(cloud);
    ranked
}

/// The devices worth probing: the ones `entry_candidates` may list.
fn probe_targets(
    devices: &[DirectoryDevice],
    network: Option<&HashMap<String, OnlineMember>>,
) -> Vec<String> {
    devices
        .iter()
        .filter(|device| !device.is_cloud_node())
        .filter(|device| match network {
            None => device.online,
            Some(network) => network
                .get(&device.device_id)
                .is_some_and(|member| !member.controller),
        })
        .map(|device| device.device_id.clone())
        .collect()
}

/// The account's cloud node for the page: its id, name and endpoint path.
fn cloud_node_view(devices: &[DirectoryDevice]) -> serde_json::Value {
    devices
        .iter()
        .filter(|device| device.is_cloud_node())
        .min_by(|a, b| a.device_id.cmp(&b.device_id))
        .map(|device| {
            let name = device
                .device_alias
                .as_deref()
                .filter(|alias| !alias.trim().is_empty())
                .unwrap_or(device.device_name.as_str());
            serde_json::json!({
                "deviceId": device.device_id,
                "name": openbitfun_product_domains::superagent::cloud_node_display_name(name),
                "path": CLOUD_NODE_PATH,
            })
        })
        .unwrap_or(serde_json::Value::Null)
}

async fn devices_route(State(gateway): State<Arc<Gateway>>, headers: HeaderMap) -> Response {
    let Some(session) = gateway.session(&headers) else {
        return signed_out(gateway.options.secure_cookies);
    };
    let (directory, network) = tokio::join!(
        gateway.directory_devices(&session),
        gateway.streams.online(&session.account_id)
    );
    // Without the network's view (busy, or the network cannot be joined
    // now) every device stays tryable.
    let network = match network {
        Ok(network) => Some(network),
        Err(error) => {
            log::debug!("Account network presence unavailable: {:?}", error);
            None
        }
    };
    match directory {
        Ok(devices) => {
            let mut views: Vec<serde_json::Value> = devices
                .iter()
                .filter(|device| !device.is_cloud_node())
                .map(|device| device_view(device, network.as_ref()))
                .collect();
            // Online first, then by name.
            views.sort_by(|a, b| {
                b["online"]
                    .as_bool()
                    .cmp(&a["online"].as_bool())
                    .then_with(|| a["name"].as_str().cmp(&b["name"].as_str()))
            });
            let targets = probe_targets(&devices, network.as_ref());
            let facts = gateway
                .probes
                .facts(&gateway.streams, &session.account_id, &targets)
                .await;
            let entry_candidates = entry_candidates(&devices, network.as_ref(), &facts);
            no_store(
                Json(serde_json::json!({
                    "devices": views,
                    "entryCandidates": entry_candidates,
                    "cloudNode": cloud_node_view(&devices),
                }))
                .into_response(),
            )
        }
        Err(error) if error.code == "signed_out" => signed_out(gateway.options.secure_cookies),
        Err(error) => upstream_error(error),
    }
}

async fn device_key_route(
    State(gateway): State<Arc<Gateway>>,
    Path(device_id): Path<String>,
    headers: HeaderMap,
) -> Response {
    let Some(session) = gateway.session(&headers) else {
        return signed_out(gateway.options.secure_cookies);
    };
    if !valid_device_id(&device_id) {
        return api_error(
            StatusCode::NOT_FOUND,
            "not_found",
            "This device is not part of your account.",
            None,
        );
    }
    match gateway
        .accounts
        .device_key(&session.directory_token, &device_id)
        .await
    {
        Ok(public_key) => no_store(
            Json(serde_json::json!({ "deviceId": device_id, "publicKey": public_key }))
                .into_response(),
        ),
        Err(error) if error.code == "signed_out" => signed_out(gateway.options.secure_cookies),
        Err(error) => upstream_error(error),
    }
}

async fn pipe_route(
    State(gateway): State<Arc<Gateway>>,
    Path(device_id): Path<String>,
    headers: HeaderMap,
    upgrade: WebSocketUpgrade,
) -> Response {
    // A cross-site page must not ride the session cookie into a pipe.
    if !gateway.origin_allowed(&headers) {
        return api_error(
            StatusCode::FORBIDDEN,
            "bad_origin",
            "This page may not open device connections.",
            None,
        );
    }
    let session = gateway.session(&headers);
    upgrade
        .max_message_size(MAX_BROWSER_FRAME)
        .max_frame_size(MAX_BROWSER_FRAME)
        .on_upgrade(move |socket| run_pipe(gateway, socket, session, device_id))
}

#[derive(Deserialize)]
struct CasQuery {
    #[serde(default)]
    device: Option<String>,
    /// Other devices of the account holding the same bundle, comma
    /// separated (`fleet_ui_bundle` `holders`), tried after `device`.
    #[serde(default)]
    holders: Option<String>,
}

/// The most holders one pull walks.
const MAX_UI_HOLDERS: usize = 8;

/// `device` first, then the named holders: valid ids, no repeats, bounded.
fn ui_holders(device_id: &str, holders: Option<&str>) -> Vec<String> {
    let mut list = vec![device_id.to_string()];
    for holder in holders.unwrap_or_default().split(',').map(str::trim) {
        if list.len() >= MAX_UI_HOLDERS {
            break;
        }
        if valid_device_id(holder) && !list.iter().any(|known| known == holder) {
            list.push(holder.to_string());
        }
    }
    list
}

/// A stored pool file as the answer: immutable, by hash, never sniffed.
fn cas_answer(stored: crate::pool::Stored) -> Response {
    let crate::pool::Stored { size, br, file } = stored;
    let body = futures::stream::unfold(Some(file), |file| async move {
        let mut file = file?;
        let mut buffer = vec![0u8; PIPE_CHUNK];
        match file.read(&mut buffer).await {
            Ok(0) => None,
            Ok(count) => {
                buffer.truncate(count);
                Some((
                    Ok::<_, std::io::Error>(axum::body::Bytes::from(buffer)),
                    Some(file),
                ))
            }
            Err(error) => Some((Err(error), None)),
        }
    });
    let mut response = Response::new(axum::body::Body::from_stream(body));
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/octet-stream"),
    );
    headers.insert(header::CONTENT_LENGTH, HeaderValue::from(size));
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=31536000, immutable"),
    );
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    if br {
        headers.insert(header::CONTENT_ENCODING, HeaderValue::from_static("br"));
    }
    response
}

fn pull_error(error: PullError) -> Response {
    match error {
        PullError::NotInBundle => api_error(
            StatusCode::NOT_FOUND,
            "not_in_bundle",
            "This device's web UI has no such file.",
            None,
        ),
        PullError::Mismatch => api_error(
            StatusCode::BAD_GATEWAY,
            "hash_mismatch",
            "The device sent a file that does not match its hash.",
            None,
        ),
        PullError::TooLarge => api_error(
            StatusCode::PAYLOAD_TOO_LARGE,
            "too_large",
            "This file is larger than the web UI pool stores.",
            None,
        ),
        PullError::Busy(message) => {
            api_error(StatusCode::TOO_MANY_REQUESTS, "busy", &message, Some(10))
        }
        PullError::DeviceBusy => api_error(
            StatusCode::TOO_MANY_REQUESTS,
            "busy",
            "The device is busy serving its web UI; retry shortly.",
            Some(5),
        ),
        PullError::NoBundle => api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "ui_bundle_unavailable",
            "This device can't be opened in a browser; update OpenBitFun on it.",
            None,
        ),
        PullError::Unreachable(message) => api_error(
            StatusCode::GATEWAY_TIMEOUT,
            "unreachable",
            &format!("The device is not reachable now: {message}"),
            None,
        ),
        PullError::BadAnswer(message) => api_error(
            StatusCode::BAD_GATEWAY,
            "bad_device_answer",
            &format!("The device cannot serve its web UI: {message}"),
            None,
        ),
        PullError::Unavailable(message) => api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "unavailable",
            &message,
            Some(30),
        ),
    }
}

async fn cas_route(
    State(gateway): State<Arc<Gateway>>,
    Path(hash): Path<String>,
    axum::extract::Query(query): axum::extract::Query<CasQuery>,
    headers: HeaderMap,
) -> Response {
    let Some(session) = gateway.session(&headers) else {
        return api_error(
            StatusCode::UNAUTHORIZED,
            "signed_out",
            "Sign in with your OpenBitFun account.",
            None,
        );
    };
    let Some(pool) = gateway.pool.as_ref() else {
        return api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "pool_unavailable",
            "The web UI pool is not available on this server.",
            Some(60),
        );
    };
    if !crate::pool::valid_hash(&hash) {
        return api_error(
            StatusCode::NOT_FOUND,
            "not_found",
            "Files are addressed by their lowercase SHA-256.",
            None,
        );
    }
    if let Some(stored) = pool.lookup(&hash).await {
        return cas_answer(stored);
    }
    let Some(device_id) = query.device.filter(|device| valid_device_id(device)) else {
        return api_error(
            StatusCode::BAD_REQUEST,
            "device_required",
            "Name the device whose web UI this file belongs to.",
            None,
        );
    };
    let holders = ui_holders(&device_id, query.holders.as_deref());
    // Only the account's own devices, through the browser's own credential.
    match gateway.directory_devices(&session).await {
        Ok(devices)
            if holders.iter().all(|holder| {
                devices
                    .iter()
                    .any(|device| &device.device_id == holder && !device.is_cloud_node())
            }) => {}
        Ok(_) => {
            log::warn!(
                "UI pool refused a pull from a device outside the account: account={}, device={}, holders={}",
                account_label(&session.account_id),
                device_id,
                holders.len()
            );
            return api_error(
                StatusCode::FORBIDDEN,
                "not_your_device",
                "This device is not part of your account.",
                None,
            );
        }
        Err(error) if error.code == "signed_out" => {
            return signed_out(gateway.options.secure_cookies);
        }
        Err(error) => return upstream_error(error),
    }
    match pool
        .fetch_from_holders(&hash, &session.account_id, &holders, &gateway.streams)
        .await
    {
        Ok(stored) => cas_answer(stored),
        Err(error) => pull_error(error),
    }
}

async fn close_with(mut socket: WebSocket, code: u16, reason: &str) {
    let reason: String = reason.chars().take(110).collect();
    let _ = tokio::time::timeout(
        Duration::from_secs(5),
        socket.send(Message::Close(Some(CloseFrame {
            code,
            reason: reason.into(),
        }))),
    )
    .await;
}

/// Releases a pipe slot on drop.
struct PipeSlot<'a>(&'a AtomicUsize);

impl Drop for PipeSlot<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
    }
}

async fn run_pipe(
    gateway: Arc<Gateway>,
    socket: WebSocket,
    session: Option<Session>,
    device_id: String,
) {
    let Some(session) = session else {
        return close_with(
            socket,
            close::SIGNED_OUT,
            "signed_out: sign in with your OpenBitFun account",
        )
        .await;
    };
    if !valid_device_id(&device_id) {
        return close_with(
            socket,
            close::NOT_YOUR_DEVICE,
            "not_found: this device is not part of your account",
        )
        .await;
    }
    // The account's own devices only, through the browser's own credential.
    match gateway.directory_devices(&session).await {
        // The cloud node is reached at `/agent/obp`, never through a pipe.
        Ok(devices)
            if devices
                .iter()
                .any(|device| device.device_id == device_id && !device.is_cloud_node()) => {}
        Ok(_) => {
            log::warn!(
                "Gateway refused a pipe to a device outside the account: account={}, device={}",
                account_label(&session.account_id),
                device_id
            );
            return close_with(
                socket,
                close::NOT_YOUR_DEVICE,
                "not_found: this device is not part of your account",
            )
            .await;
        }
        Err(error) if error.code == "signed_out" => {
            return close_with(
                socket,
                close::SIGNED_OUT,
                "signed_out: this browser was signed out; sign in again",
            )
            .await;
        }
        Err(error) => {
            return close_with(
                socket,
                close::UNAVAILABLE,
                &format!("unavailable: {}", error.message),
            )
            .await;
        }
    }
    if gateway.pipes.fetch_add(1, Ordering::AcqRel) >= gateway.options.max_pipes {
        gateway.pipes.fetch_sub(1, Ordering::AcqRel);
        return close_with(
            socket,
            close::BUSY,
            "busy: the gateway is at capacity; retry shortly",
        )
        .await;
    }
    let _slot = PipeSlot(&gateway.pipes);
    let started = Instant::now();
    let stream = match gateway.streams.open(&session.account_id, &device_id).await {
        Ok(stream) => stream,
        Err(StreamError::Busy(message)) => return close_with(socket, close::BUSY, &format!("busy: {message}")).await,
        Err(StreamError::Unavailable(message)) => {
            log::warn!("Gateway could not join an account network: {}", message);
            return close_with(socket, close::UNAVAILABLE, "unavailable: the device network is unavailable; retry shortly").await;
        }
        Err(StreamError::Unreachable(_)) => {
            return close_with(
                socket,
                close::UNREACHABLE,
                "unreachable: the device is not on the device network (offline, or OpenBitFun there needs an update)",
            )
            .await
        }
    };
    let id = gateway.pipe_ids.fetch_add(1, Ordering::Relaxed);
    let opened_ms = started.elapsed().as_millis();
    log::info!(
        "Gateway pipe opened: id={}, account={}, device={}, open_ms={}",
        id,
        account_label(&session.account_id),
        device_id,
        opened_ms
    );
    let (up, down, reason) = pipe(socket, stream, &gateway.options).await;
    log::info!(
        "Gateway pipe closed: id={}, device={}, browser_to_device_bytes={}, device_to_browser_bytes={}, duration_ms={}, reason={}",
        id,
        device_id,
        up,
        down,
        started.elapsed().as_millis(),
        reason
    );
}

/// Copies bytes both ways until either side ends; returns the byte counts
/// (browser to device, device to browser) and why it ended. Content is
/// never inspected or logged.
async fn pipe(
    socket: WebSocket,
    stream: Box<dyn crate::upstream::DeviceIo>,
    options: &GatewayOptions,
) -> (u64, u64, &'static str) {
    let (mut ws_tx, mut ws_rx) = socket.split();
    let (mut reader, mut writer) = tokio::io::split(stream);
    let mut up = 0u64;
    let mut down = 0u64;
    let mut buffer = vec![0u8; PIPE_CHUNK];
    let mut ping = tokio::time::interval(options.ping_interval);
    ping.tick().await;
    let write_timeout = options
        .write_timeout
        .min(options.idle_timeout)
        .max(Duration::from_millis(1));
    let mut last_traffic = Instant::now();
    let reason = loop {
        tokio::select! {
            message = ws_rx.next() => {
                let Some(Ok(message)) = message else { break "browser_closed" };
                match message {
                    Message::Binary(bytes) => {
                        last_traffic = Instant::now();
                        up += bytes.len() as u64;
                        match tokio::time::timeout(write_timeout, writer.write_all(&bytes)).await {
                            Ok(Ok(())) => {}
                            Ok(Err(_)) => break "device_write_failed",
                            Err(_) => break "device_write_timeout",
                        }
                    }
                    Message::Close(_) => break "browser_closed",
                    Message::Text(_) => break "text_frame",
                    Message::Ping(_) | Message::Pong(_) => {
                        last_traffic = Instant::now();
                    }
                }
            }
            read = reader.read(&mut buffer) => {
                match read {
                    Ok(0) | Err(_) => break "device_closed",
                    Ok(count) => {
                        last_traffic = Instant::now();
                        down += count as u64;
                        match tokio::time::timeout(
                            write_timeout,
                            ws_tx.send(Message::Binary(buffer[..count].to_vec().into())),
                        )
                        .await
                        {
                            Ok(Ok(())) => {}
                            Ok(Err(_)) => break "browser_write_failed",
                            Err(_) => break "browser_write_timeout",
                        }
                    }
                }
            }
            _ = ping.tick() => {
                if last_traffic.elapsed() > options.idle_timeout {
                    break "idle";
                }
                match tokio::time::timeout(
                    write_timeout,
                    ws_tx.send(Message::Ping(Vec::new().into())),
                )
                .await
                {
                    Ok(Ok(())) => {}
                    Ok(Err(_)) => break "browser_write_failed",
                    Err(_) => break "browser_write_timeout",
                }
            }
        }
    };
    let close_timeout = write_timeout.min(Duration::from_secs(5));
    let _ = tokio::time::timeout(close_timeout, writer.shutdown()).await;
    let _ = tokio::time::timeout(
        close_timeout,
        ws_tx.send(Message::Close(Some(CloseFrame {
            code: 1000,
            reason: reason.into(),
        }))),
    )
    .await;
    (up, down, reason)
}

#[cfg(test)]
mod tests;

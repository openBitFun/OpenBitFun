//! Account-authenticated device credentials and the account device directory
//! (sign-in, device rows, pair keys). OpenBitFun 2.0 sends no messages over
//! the 1.x relay; devices talk over OBP on OpenBitFun Link.

use super::device_crypto;
use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::{collections::HashMap, sync::Arc};
use tokio::sync::{Mutex, OnceCell};

use crate::remote_connect::device::DeviceIdentity;
use crate::remote_connect::relay_http::{
    relay_http_client, send_with_retry, BufferedRelayResponse, RelayHttpRetry,
};

/// An explicit routing request follows credential rotation for this account.
/// A user stop or a later login invalidates pending connection retries.
#[derive(Default)]
pub struct RoutingIntent(AtomicU64);

impl RoutingIntent {
    pub const fn new() -> Self {
        Self(AtomicU64::new(0))
    }

    pub fn request(&self, generation: u64) {
        self.0.store(generation, Ordering::SeqCst);
    }

    pub fn cancel(&self) {
        self.request(0);
    }

    pub fn requested(&self, generation: u64) -> bool {
        generation != 0 && self.0.load(Ordering::SeqCst) == generation
    }

    pub fn rotated(&self, previous: u64, current: u64) {
        let _ = self
            .0
            .compare_exchange(previous, current, Ordering::SeqCst, Ordering::SeqCst);
    }
}

pub const MASTER_KEY_LEN: usize = 32;

/// A retired official deployment has its own credential database. Authenticate
/// with the new deployment instead of replaying its token or deleting the record.
///
/// Every official release lives under `https://remote.openbitfun.com/v/<version>`;
/// any such endpoint other than the one this build targets is retired.
pub fn is_retired_official_relay(value: &str) -> bool {
    let current = reqwest::Url::parse(openbitfun_product_domains::account::DEFAULT_RELAY_URL)
        .expect("official relay endpoint is a valid URL");
    reqwest::Url::parse(value).is_ok_and(|url| {
        url.scheme() == "https"
            && url.host_str() == current.host_str()
            && url.username().is_empty()
            && url.password().is_none()
            && url.port().is_none()
            && url.fragment().is_none()
            && version_only_query(&url)
            && is_retired_official_version_path(url.path(), current.path())
    })
}

/// Official endpoints may announce their service version as a single `v` query
/// parameter. Any other query content disqualifies the URL from being treated
/// as an official endpoint at all, so a crafted query can never inherit the
/// official retirement handling.
fn version_only_query(url: &reqwest::Url) -> bool {
    let Some(query) = url.query() else {
        return true;
    };
    let mut parameters = query.split('&');
    let version = parameters
        .next()
        .and_then(|parameter| parameter.strip_prefix("v="));
    parameters.next().is_none()
        && version.is_some_and(|version| {
            !version.is_empty()
                && version.len() <= 32
                && version
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-'))
        })
}

fn is_retired_official_version_path(path: &str, current: &str) -> bool {
    let path = path.trim_end_matches('/');
    let current = current.trim_end_matches('/');
    // `/v/1.0.2` and `/relay` are two live aliases of one deployment: both reach
    // the same process and account database, so neither retires a stored token.
    if openbitfun_product_domains::account::LIVE_RELAY_ENDPOINT_PATHS.contains(&path) {
        return false;
    }
    path != current
        && path
            .strip_prefix("/v/")
            .is_some_and(|version| !version.is_empty() && !version.contains('/'))
}

/// The pair key derived from a directory row, cached per device.
struct PeerCipher {
    key: [u8; 32],
    /// The directory row kind the key lookup reported (`None` from a
    /// directory that predates it, or for a row without one).
    kind: Option<String>,
}

/// Device-scoped account credentials and a locally owned X25519 private key.
#[derive(Clone)]
pub struct AccountSession {
    pub token: String,
    pub user_id: String,
    pub master_key: [u8; MASTER_KEY_LEN],
    peer_keys: Arc<Mutex<HashMap<String, Arc<OnceCell<Arc<PeerCipher>>>>>>,
    peer_generation: Arc<AtomicU64>,
}

impl std::fmt::Debug for AccountSession {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AccountSession")
            .field("user_id", &self.user_id)
            .finish_non_exhaustive()
    }
}

impl AccountSession {
    pub fn new(token: String, user_id: String, device_secret: [u8; 32]) -> Self {
        Self {
            token,
            user_id,
            master_key: device_secret,
            peer_keys: Arc::new(Mutex::new(HashMap::new())),
            peer_generation: Arc::new(AtomicU64::new(0)),
        }
    }

    pub async fn clear_peer_keys(&self) {
        let mut keys = self.peer_keys.lock().await;
        self.peer_generation.fetch_add(1, Ordering::SeqCst);
        keys.clear();
    }

    pub async fn peer_message_key(&self, relay_url: &str, device_id: &str) -> Result<[u8; 32]> {
        Ok(self.peer_cipher(relay_url, device_id).await?.key)
    }

    /// The directory row kind of `device_id` (`desktop`, `cli`, `mobile`,
    /// `cloud_agent`, …) from the same cached key lookup; `None` when the
    /// relay predates the field or the row has no kind.
    pub async fn peer_device_kind(
        &self,
        relay_url: &str,
        device_id: &str,
    ) -> Result<Option<String>> {
        Ok(self.peer_cipher(relay_url, device_id).await?.kind.clone())
    }

    async fn peer_cipher(&self, relay_url: &str, device_id: &str) -> Result<Arc<PeerCipher>> {
        let endpoint = AccountClient::endpoint(
            relay_url,
            &format!("/api/devices/{}/key", urlencoding::encode(device_id)),
        )?;
        let cache_id = endpoint.to_string();
        let cell = {
            let mut keys = self.peer_keys.lock().await;
            keys.entry(cache_id).or_default().clone()
        };
        // Only callers for this peer share initialization. No account-wide
        // lock survives network IO. Failed/cancelled lookups can be retried;
        // invalidation removes the cell so an older lookup cannot refill it.
        cell.get_or_try_init(|| async {
            let response = relay_http_client()
                .get(endpoint)
                .bearer_auth(&self.token)
                .send()
                .await?;
            if !response.status().is_success() {
                return Err(AccountClient::into_error(response).await);
            }
            #[derive(Deserialize)]
            struct PeerKey {
                device_id: String,
                public_key: String,
                #[serde(default)]
                device_kind: Option<String>,
            }
            let peer: PeerKey = response.json().await?;
            if peer.device_id != device_id {
                return Err(anyhow!("relay returned a different device identity"));
            }
            let public = super::encryption::parse_public_key(&peer.public_key)?;
            let key = device_crypto::derive_message_key(&self.master_key, &public)?;
            Ok(Arc::new(PeerCipher {
                key,
                kind: peer.device_kind.filter(|kind| !kind.trim().is_empty()),
            }))
        })
        .await
        .cloned()
    }
}

/// A delegated token for a paired client (mobile-web / IM bot).
/// The desktop requests this from the relay and transmits it along
/// with a fresh controller private key over the authenticated E2E channel.
#[derive(Clone)]
pub struct DelegateToken {
    pub token: String,
    pub user_id: String,
    pub device_secret: [u8; 32],
}

// ── Relay HTTP client ───────────────────────────────────────────────────

#[derive(Deserialize)]
struct AuthResponse {
    token: String,
    user_id: String,
}

#[derive(Deserialize)]
struct ErrorBody {
    error: String,
    #[serde(default)]
    retry_after_secs: Option<i64>,
}

/// HTTP client for the relay's account endpoints.
pub struct AccountClient {
    http: reqwest::Client,
}

/// Older Desktop builds persisted the temporary embedded LAN credential into
/// the shared account slot. Re-establish the official route from shared identity
/// instead of dialing a stale DHCP address on startup. Other custom endpoints
/// retain their legacy behavior.
pub fn persisted_relay_requires_migration(relay_url: &str) -> bool {
    if is_retired_official_relay(relay_url) {
        return true;
    }
    let Ok(url) = validate_relay_base_url(relay_url) else {
        return false;
    };
    url.scheme() == "http"
        && url.port() == Some(9700)
        && url.path() == "/"
        && url
            .host_str()
            .and_then(|host| host.parse::<std::net::Ipv4Addr>().ok())
            .is_some_and(|ip| ip.is_private() || ip.is_loopback() || ip.is_link_local())
}

#[derive(Debug, thiserror::Error)]
#[error("{0}")]
pub struct RelayUnauthorized(String);

/// Check whether an account/relay error message indicates an invalid or
/// expired account token (relay auth failure). Shared by Desktop, CLI, and
/// account surfaces so they all react to the same relay wording.
pub fn error_indicates_expired_token(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    lower.contains("http 401")
        || lower.contains("unauthorized")
        || lower.contains("invalid or expired token")
        || lower.contains("relay auth error")
}

/// Parse a user/config supplied relay base URL at the shared transport
/// boundary. Paths are allowed for reverse-proxy prefixes; credentials,
/// fragments, and non-HTTP schemes are not.
///
/// The endpoint may announce its service version as a single `v` query
/// parameter (`?v=1.0.9`). That parameter is validated and removed, so every
/// path join downstream still receives a bare base URL. Any other query
/// parameter is rejected: the query must never become a channel for
/// per-request data.
pub fn validate_relay_base_url(relay_url: &str) -> Result<reqwest::Url> {
    let mut url = reqwest::Url::parse(relay_url.trim())
        .map_err(|error| anyhow!("invalid relay URL: {error}"))?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err(anyhow!(
            "relay URL must be an http(s) server address without credentials, query, or fragment"
        ));
    }
    let has_version_parameter = match url.query() {
        Some(query) => {
            let mut parameters = query.split('&');
            let version = parameters
                .next()
                .and_then(|parameter| parameter.strip_prefix("v="));
            let extra = parameters.next();
            match (version, extra) {
                (Some(version), None)
                    if !version.is_empty()
                        && version.len() <= 32
                        && version.bytes().all(|byte| {
                            byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-')
                        }) =>
                {
                    true
                }
                _ => {
                    return Err(anyhow!(
                        "relay URL may only carry a single v=<version> query parameter"
                    ))
                }
            }
        }
        None => false,
    };
    if has_version_parameter {
        url.set_query(None);
    }
    Ok(url)
}

impl Default for AccountClient {
    fn default() -> Self {
        Self::new()
    }
}

/// Device kinds a host may report. Mirrors
/// `relay-service/src/db.rs::DEVICE_KINDS`, which is what validates them.
pub const DEVICE_KIND_DESKTOP: &str = "desktop";
/// A headless host: the CLI and TUI delivery profiles.
pub const DEVICE_KIND_CLI: &str = "cli";

/// Relay capability advertising that a host may report [`DEVICE_KIND_CLI`].
pub const RELAY_CAPABILITY_DEVICE_KIND_CLI: &str = "device_kind_cli_v1";

/// The GitHub/relay login request body.
///
/// `clientVersion`/`clientProtocol` are optional from the Relay's point of view,
/// but a current build always reports both so the Relay can gate control
/// compatibility instead of treating this device as legacy.
///
/// `device_kind` is validated by the Relay against its own kind list, so callers
/// must pass a value that Relay accepts — see
/// [`AccountClient::reported_device_kind`].
fn login_request_body(
    access_token: &str,
    device: &DeviceIdentity,
    device_kind: &str,
    public_key: String,
    request_id: String,
) -> serde_json::Value {
    serde_json::json!({
        "access_token": access_token,
        "device_id": device.device_id,
        "device_name": device.device_name,
        "device_kind": device_kind,
        "public_key": public_key,
        "request_id": request_id,
        "clientVersion": openbitfun_product_domains::account::client_version(),
        "clientProtocol": openbitfun_product_domains::account::CLIENT_PROTOCOL_VERSION,
    })
}

impl AccountClient {
    /// The device kind to report to this Relay for a host that is not a desktop.
    ///
    /// A CLI host may only report [`DEVICE_KIND_CLI`] to a Relay that advertises
    /// [`RELAY_CAPABILITY_DEVICE_KIND_CLI`]: an older Relay validates the kind
    /// against a shorter list and rejects the whole login, which would strand the
    /// user on a host that used to work. Such a Relay gets [`DEVICE_KIND_DESKTOP`]
    /// instead, which every Relay accepts, so the device still registers — only
    /// its artwork falls back. An unreadable capability list counts as
    /// unsupported, never as a guess.
    pub async fn reported_device_kind(&self, relay_url: &str, host_is_cli: bool) -> &'static str {
        if !host_is_cli {
            return DEVICE_KIND_DESKTOP;
        }
        match self.relay_capabilities(relay_url).await {
            Ok(capabilities) => {
                if capabilities
                    .iter()
                    .any(|name| name == RELAY_CAPABILITY_DEVICE_KIND_CLI)
                {
                    DEVICE_KIND_CLI
                } else {
                    DEVICE_KIND_DESKTOP
                }
            }
            Err(error) => {
                log::warn!(
                    "Failed to read relay capabilities ({error}); reporting a desktop device"
                );
                DEVICE_KIND_DESKTOP
            }
        }
    }

    /// Reuse the shared GitHub login used by the OpenBitFun marketplaces.
    pub async fn login_with_identity(
        &self,
        relay_url: &str,
        device: &DeviceIdentity,
        device_kind: &str,
    ) -> Result<(
        AccountSession,
        openbitfun_product_domains::account::GitHubUser,
    )> {
        self.exchange_identity(relay_url, device, device_kind, None)
            .await
    }

    pub(super) async fn exchange_identity(
        &self,
        relay_url: &str,
        device: &DeviceIdentity,
        device_kind: &str,
        previous: Option<&super::session_store::LoadedSession>,
    ) -> Result<(
        AccountSession,
        openbitfun_product_domains::account::GitHubUser,
    )> {
        let mut identity =
            crate::account_identity::AccountIdentityClient::from_environment().await?;
        let profile = identity
            .me()
            .await?
            .ok_or_else(|| anyhow!("Sign in to continue"))?;
        let access_token = identity
            .access_token()
            .await?
            .ok_or_else(|| anyhow!("Sign in to continue"))?;
        let account_id = profile
            .user
            .identity_id()
            .ok_or_else(|| anyhow!("Unsupported account identity"))?;
        let device_secret = match previous {
            Some(saved) if saved.user_id == account_id => saved.master_key,
            Some(_) => return Err(anyhow!("Sign in with the original device account to renew")),
            None => super::session_store::device_secret(relay_url, &account_id, &device.device_id)?,
        };
        let body = login_request_body(
            &access_token,
            device,
            device_kind,
            device_crypto::public_key_base64(&device_secret),
            uuid::Uuid::new_v4().to_string(),
        );
        let response = send_with_retry(
            "GitHub relay login",
            self.http
                .post(Self::endpoint(relay_url, "/api/auth/login")?)
                .json(&body),
            RelayHttpRetry::IdempotentWrite,
        )
        .await?;
        if !response.status().is_success() {
            return Err(Self::into_buffered_error(response));
        }
        let auth: AuthResponse = response.json().await?;
        if auth.user_id != account_id {
            return Err(anyhow!("relay returned a different account identity"));
        }
        let session = AccountSession::new(auth.token, auth.user_id, device_secret);
        if let Err(error) = self
            .report_local_metadata(relay_url, &session, &device.device_id)
            .await
        {
            log::warn!("Failed to report device metadata after login: {error}");
        }
        Ok((session, profile.user))
    }

    pub fn new() -> Self {
        Self {
            http: relay_http_client(),
        }
    }

    fn endpoint(relay_url: &str, path: &str) -> Result<reqwest::Url> {
        let mut url = validate_relay_base_url(relay_url)?;
        let base_path = url.path().trim_end_matches('/').to_string();
        url.set_path(&format!("{base_path}{path}"));
        Ok(url)
    }

    /// Map a non-2xx relay response into a human-readable error.
    async fn into_error(resp: reqwest::Response) -> anyhow::Error {
        let status = resp.status();
        let body = resp.bytes().await.unwrap_or_default();
        Self::error_from_response_parts(status, &body)
    }

    fn into_buffered_error(resp: BufferedRelayResponse) -> anyhow::Error {
        let (status, body) = resp.into_parts();
        Self::error_from_response_parts(status, &body)
    }

    fn error_from_response_parts(status: reqwest::StatusCode, body: &[u8]) -> anyhow::Error {
        if status == reqwest::StatusCode::PAYLOAD_TOO_LARGE {
            return anyhow!(
                "relay returned HTTP 413 Payload Too Large \
                 (encrypted session/settings blob exceeds relay body limit; \
                  raise Axum DefaultBodyLimit on /api/sync/* and any reverse-proxy \
                  client_max_body_size)"
            );
        }
        if status == reqwest::StatusCode::INSUFFICIENT_STORAGE {
            return anyhow!(
                "relay returned HTTP 507 Insufficient Storage (the configured account or asset quota is full)"
            );
        }
        let error = match serde_json::from_slice::<ErrorBody>(body) {
            Ok(body) => {
                let msg = body.error;
                if let Some(retry) = body.retry_after_secs {
                    anyhow!("{msg} (HTTP {status}, retry in {retry}s)")
                } else {
                    anyhow!("{msg} (HTTP {status})")
                }
            }
            Err(_) => anyhow!("relay returned HTTP {status}"),
        };
        if status == reqwest::StatusCode::UNAUTHORIZED {
            RelayUnauthorized(error.to_string()).into()
        } else {
            error
        }
    }

    /// Fetch the login challenge and unwrap the master key locally.
    /// Does not call `/api/auth/login` and does not mint a token.
    fn auth_header(session: &AccountSession) -> String {
        format!("Bearer {}", session.token)
    }

    /// Issue an account token for a paired controller.
    pub async fn delegate_token(
        &self,
        relay_url: &str,
        session: &AccountSession,
    ) -> Result<DelegateToken> {
        let device_secret = super::device_crypto::generate_secret();
        let resp = send_with_retry(
            "delegate account token",
            self.http
                .post(Self::endpoint(relay_url, "/api/auth/delegate")?)
                .header("Authorization", Self::auth_header(session))
                .json(&serde_json::json!({ "public_key": super::device_crypto::public_key_base64(&device_secret) })),
            RelayHttpRetry::SingleAttempt,
        )
        .await?;
        if !resp.status().is_success() {
            return Err(Self::into_buffered_error(resp));
        }
        let auth: AuthResponse = resp.json().await?;
        Ok(DelegateToken {
            token: auth.token,
            user_id: auth.user_id,
            device_secret,
        })
    }

    /// Revoke the account token on the relay (server-side logout).
    pub async fn revoke_token(&self, relay_url: &str, session: &AccountSession) -> Result<()> {
        let resp = send_with_retry(
            "revoke account token",
            self.http
                .post(Self::endpoint(relay_url, "/api/auth/logout")?)
                .header("Authorization", Self::auth_header(session)),
            RelayHttpRetry::IdempotentWrite,
        )
        .await?;
        if !resp.status().is_success() {
            // Non-fatal — best-effort revocation
            log::warn!("revoke_token: relay returned {}", resp.status());
        }
        Ok(())
    }

    /// List all devices in the account (online + offline). Returns
    /// `(device_id, device_name, online, last_seen_at)`.
    pub async fn list_devices(
        &self,
        relay_url: &str,
        session: &AccountSession,
    ) -> Result<Vec<DeviceInfo>> {
        let resp = send_with_retry(
            "list devices",
            self.http
                .get(Self::endpoint(relay_url, "/api/devices")?)
                .header("Authorization", Self::auth_header(session)),
            RelayHttpRetry::SafeRead,
        )
        .await?;
        if !resp.status().is_success() {
            return Err(Self::into_buffered_error(resp));
        }
        let entries: Vec<DeviceListEntry> = resp.json().await?;
        Ok(entries.into_iter().map(project_device_list_entry).collect())
    }

    /// [`Self::list_devices`] plus the account's cloud node row (kind
    /// `cloud_agent`), which `/api/devices` lists only when asked with
    /// `include=cloud_agent`. A relay that predates the parameter ignores it
    /// and answers the plain list, so the cloud node is then simply absent.
    pub async fn list_devices_with_cloud_agent(
        &self,
        relay_url: &str,
        session: &AccountSession,
    ) -> Result<Vec<DeviceInfo>> {
        let mut url = Self::endpoint(relay_url, "/api/devices")?;
        url.set_query(Some("include=cloud_agent"));
        let resp = send_with_retry(
            "list devices",
            self.http
                .get(url)
                .header("Authorization", Self::auth_header(session)),
            RelayHttpRetry::SafeRead,
        )
        .await?;
        if !resp.status().is_success() {
            return Err(Self::into_buffered_error(resp));
        }
        let entries: Vec<DeviceListEntry> = resp.json().await?;
        Ok(entries.into_iter().map(project_device_list_entry).collect())
    }

    /// Missing capabilities (including an old info endpoint) mean unsupported.
    pub async fn relay_capabilities(&self, relay_url: &str) -> Result<Vec<String>> {
        let response = self
            .http
            .get(Self::endpoint(relay_url, "/api/info")?)
            .send()
            .await?;
        if matches!(response.status().as_u16(), 404 | 405) {
            return Ok(Vec::new());
        }
        if !response.status().is_success() {
            return Err(Self::into_error(response).await);
        }
        #[derive(Deserialize)]
        struct Info {
            #[serde(default)]
            capabilities: Vec<String>,
        }
        Ok(response.json::<Info>().await?.capabilities)
    }

    pub async fn update_device_alias(
        &self,
        relay_url: &str,
        session: &AccountSession,
        device_id: &str,
        device_alias: Option<&str>,
    ) -> Result<()> {
        if !self
            .relay_capabilities(relay_url)
            .await?
            .iter()
            .any(|c| c == "device_alias_v1")
        {
            return Err(anyhow!("Relay does not support device_alias_v1"));
        }
        self.patch_device(
            relay_url,
            session,
            device_id,
            &serde_json::json!({"device_alias": device_alias}),
        )
        .await
    }

    async fn patch_device(
        &self,
        relay_url: &str,
        session: &AccountSession,
        device_id: &str,
        body: &serde_json::Value,
    ) -> Result<()> {
        let response = self
            .http
            .patch(Self::endpoint(
                relay_url,
                &format!("/api/devices/{}", urlencoding::encode(device_id)),
            )?)
            .bearer_auth(&session.token)
            .json(body)
            .send()
            .await?;
        if matches!(response.status().as_u16(), 404 | 405) {
            return Err(anyhow!("Device update unavailable: Relay does not support PATCH or device no longer exists (HTTP {})", response.status()));
        }
        if !response.status().is_success() {
            return Err(Self::into_error(response).await);
        }
        Ok(())
    }

    /// Report only metadata collected on this authenticated host. Provisioning
    /// another device must never call this on its controller.
    pub async fn report_local_metadata(
        &self,
        relay_url: &str,
        session: &AccountSession,
        device_id: &str,
    ) -> Result<()> {
        if !self
            .relay_capabilities(relay_url)
            .await?
            .iter()
            .any(|c| c == "device_metadata_v1")
        {
            return Ok(());
        }
        let metadata = super::device::local_device_metadata().await;
        self.patch_device(relay_url, session, device_id, &metadata)
            .await
    }

    /// Remove a device from the account (DELETE /api/devices/:id).
    pub async fn delete_device(
        &self,
        relay_url: &str,
        session: &AccountSession,
        target_device_id: &str,
    ) -> Result<()> {
        let resp = self
            .http
            .delete(Self::endpoint(
                relay_url,
                &format!("/api/devices/{}", urlencoding::encode(target_device_id)),
            )?)
            .header("Authorization", Self::auth_header(session))
            .send()
            .await?;
        if !resp.status().is_success() {
            return Err(Self::into_error(resp).await);
        }
        Ok(())
    }
}

/// A device in the account (online or offline).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceInfo {
    pub device_id: String,
    pub device_name: String,
    /// Kind the device reported (`desktop`, `cli`, `mobile`, `watch`). Absent
    /// for a device that never reported one and for Relays that predate the
    /// field: absent stays "unknown", which is not the same as "not a host".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub device_kind: Option<String>,
    #[serde(default)]
    pub device_alias: Option<String>,
    #[serde(default)]
    pub device_model: Option<String>,
    #[serde(default)]
    pub device_os: Option<String>,
    #[serde(default)]
    pub device_os_version: Option<String>,
    /// Build string the device last reported to the Relay. Absent for legacy
    /// devices and for Relays that predate the field.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub device_client_version: Option<String>,
    /// Control-contract protocol number the device last reported. Absent for
    /// legacy devices and for Relays that predate the field.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub device_client_protocol: Option<u32>,
    /// Relay-computed compatibility with this client's control contract.
    /// `None` means unknown (an older Relay without the field) and must be
    /// treated as compatible rather than incompatible.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub compatible: Option<bool>,
    pub online: bool,
    pub last_seen_at: Option<i64>,
}

impl DeviceInfo {
    /// Whether the Relay considers this device compatible with our control
    /// contract.
    ///
    /// `Some(false)` is the Relay's verdict that the pair must not be
    /// remote-controlled (a device that never reported a protocol number, or
    /// one whose number differs). `None` means an older Relay that predates the
    /// gating field and cannot judge, which is unknown and treated as
    /// compatible. These are different situations; do not fold the
    /// missing-version case into the fallback.
    pub fn is_compatible(&self) -> bool {
        self.compatible.unwrap_or(true)
    }
}

#[derive(Deserialize)]
struct DeviceListEntry {
    device_id: String,
    device_name: String,
    /// Relay field `device_kind`; absent on legacy Relays.
    #[serde(default)]
    device_kind: Option<String>,
    #[serde(default)]
    device_alias: Option<String>,
    #[serde(default)]
    device_model: Option<String>,
    #[serde(default)]
    device_os: Option<String>,
    #[serde(default)]
    device_os_version: Option<String>,
    /// Relay field `client_version`; absent on legacy Relays.
    #[serde(default, rename = "client_version", alias = "clientVersion")]
    device_client_version: Option<String>,
    /// Relay field `client_protocol`; absent on legacy Relays.
    #[serde(default, rename = "client_protocol", alias = "clientProtocol")]
    device_client_protocol: Option<u32>,
    /// Relay-computed; absent on legacy Relays.
    #[serde(default)]
    compatible: Option<bool>,
    /// Absent on legacy relays that only listed in-memory online devices.
    /// `None` means "legacy online list" → treat as online.
    #[serde(default)]
    online: Option<bool>,
    #[serde(default)]
    last_seen_at: Option<i64>,
}

fn project_device_list_entry(entry: DeviceListEntry) -> DeviceInfo {
    DeviceInfo {
        device_id: entry.device_id,
        device_name: entry.device_name,
        device_kind: entry.device_kind,
        device_alias: entry.device_alias,
        device_model: entry.device_model,
        device_os: entry.device_os,
        device_os_version: entry.device_os_version,
        device_client_version: entry.device_client_version,
        device_client_protocol: entry.device_client_protocol,
        compatible: entry.compatible,
        // Legacy relays omit `online` and only return currently-online
        // devices; treat a missing field as online.
        online: entry.online.unwrap_or(true),
        last_seen_at: entry.last_seen_at,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_requested_routing_follows_credential_rotation() {
        let intent = RoutingIntent::new();
        intent.rotated(1, 3);
        assert!(!intent.requested(3));
        intent.request(3);
        intent.rotated(3, 5);
        assert!(intent.requested(5));
        assert!(!intent.requested(3));
        intent.cancel();
        intent.rotated(5, 7);
        assert!(!intent.requested(7));
        intent.request(9);
        intent.rotated(5, 7);
        assert!(intent.requested(9));
    }

    #[test]
    fn legacy_embedded_session_migrates_without_capturing_other_private_relays() {
        for url in [
            "http://192.168.1.2:9700",
            "http://10.1.2.3:9700/",
            "http://127.0.0.1:9700",
        ] {
            assert!(persisted_relay_requires_migration(url), "{url}");
        }
        for url in [
            "https://remote.openbitfun.com/v/1.0.2",
            "http://192.168.1.2:8080",
            "http://192.168.1.2:9700/custom",
            "http://relay.example:9700",
            "http://8.8.8.8:9700",
            "http://user:secret@192.168.1.2:9700",
            "http://192.168.1.2:9700?other=1",
        ] {
            assert!(!persisted_relay_requires_migration(url), "{url}");
        }
    }

    #[test]
    fn device_directory_accepts_legacy_nullable_and_extended_payloads() {
        let old = serde_json::json!({"device_id":"id", "device_name":"technical", "online":true, "last_seen_at":null});
        let device: DeviceInfo = serde_json::from_value(old).unwrap();
        assert!(device.device_alias.is_none());
        let round_trip: DeviceInfo =
            serde_json::from_value(serde_json::to_value(&device).unwrap()).unwrap();
        assert_eq!(round_trip.device_name, "technical");
        let entry: DeviceListEntry = serde_json::from_value(serde_json::json!({
            "device_id":"id", "device_name":"technical", "device_alias":"alias",
            "device_model":"model", "device_os":"linux", "device_os_version":null,
            "future_field":true
        }))
        .unwrap();
        assert_eq!(entry.device_alias.as_deref(), Some("alias"));
        assert_eq!(entry.device_name, "technical");
        assert_eq!(entry.online, None);
        assert_eq!(entry.device_os_version, None);
    }

    #[test]
    fn login_request_body_always_reports_client_protocol_and_version() {
        let device = DeviceIdentity {
            device_id: "0123456789abcdef0123456789abcdef".to_string(),
            device_name: "Laptop".to_string(),
            mac_address: "aa:bb:cc:dd:ee:ff".to_string(),
        };
        let body = login_request_body(
            "token-1",
            &device,
            DEVICE_KIND_CLI,
            "public-key".to_string(),
            "req-1".into(),
        );
        assert_eq!(
            body["clientProtocol"].as_u64(),
            Some(openbitfun_product_domains::account::CLIENT_PROTOCOL_VERSION as u64)
        );
        assert_eq!(
            body["clientVersion"].as_str(),
            Some(openbitfun_product_domains::account::client_version())
        );
        assert_eq!(body["device_id"], device.device_id);
        assert_eq!(body["request_id"], "req-1");
        // Pins the wire value the Relay validates against its own kind list.
        assert_eq!(body["device_kind"], "cli");
    }

    #[test]
    fn device_directory_projects_client_compatibility_for_legacy_and_extended_relays() {
        // Legacy Relay rows have neither the new build fields nor `compatible`.
        let legacy: DeviceListEntry = serde_json::from_value(serde_json::json!({
            "device_id": "id", "device_name": "technical", "online": true
        }))
        .unwrap();
        let projected = project_device_list_entry(legacy);
        assert!(projected.device_client_version.is_none());
        assert!(projected.device_client_protocol.is_none());
        assert!(projected.compatible.is_none());
        assert!(projected.is_compatible());
        // A legacy row carries no kind, which must stay unknown rather than be
        // read as "not a host".
        assert!(projected.device_kind.is_none());

        // A current Relay reports the build fields and the computed flag.
        let extended: DeviceListEntry = serde_json::from_value(serde_json::json!({
            "device_id": "id", "device_name": "technical", "online": true,
            "client_version": "1.0.1", "client_protocol": 2, "compatible": false,
            "device_kind": "cli"
        }))
        .unwrap();
        let projected = project_device_list_entry(extended);
        assert_eq!(projected.device_client_version.as_deref(), Some("1.0.1"));
        assert_eq!(projected.device_client_protocol, Some(2));
        assert_eq!(projected.device_kind.as_deref(), Some("cli"));
        assert!(!projected.is_compatible());

        // A device that never reported a version is judged incompatible by the
        // Relay: no build fields, present `compatible: false`.
        let unversioned: DeviceListEntry = serde_json::from_value(serde_json::json!({
            "device_id": "id", "device_name": "technical", "online": true, "compatible": false
        }))
        .unwrap();
        let projected = project_device_list_entry(unversioned);
        assert!(projected.device_client_protocol.is_none());
        assert!(!projected.is_compatible());

        // The camelCase aliases are accepted for forward tolerance.
        let aliased: DeviceListEntry = serde_json::from_value(serde_json::json!({
            "device_id": "id", "device_name": "technical",
            "clientVersion": "1.0.1", "clientProtocol": 2, "compatible": true
        }))
        .unwrap();
        assert_eq!(aliased.device_client_version.as_deref(), Some("1.0.1"));
        assert_eq!(aliased.device_client_protocol, Some(2));
        assert_eq!(aliased.compatible, Some(true));
    }

    #[tokio::test]
    async fn alias_patch_negotiates_and_sends_explicit_null() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/prefix", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            for index in 0..2 {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut request = Vec::new();
                loop {
                    let mut chunk = [0; 4096];
                    let n = socket.read(&mut chunk).await.unwrap();
                    assert!(n > 0);
                    request.extend_from_slice(&chunk[..n]);
                    let text = String::from_utf8_lossy(&request);
                    if let Some((headers, body)) = text.split_once("\r\n\r\n") {
                        let length: usize = headers
                            .lines()
                            .find_map(|line| {
                                line.to_ascii_lowercase()
                                    .strip_prefix("content-length: ")
                                    .and_then(|n| n.parse().ok())
                            })
                            .unwrap_or(0);
                        if body.len() >= length {
                            break;
                        }
                    }
                }
                let request = String::from_utf8(request).unwrap();
                let body = if index == 0 {
                    assert!(request.starts_with("GET /prefix/api/info "));
                    r#"{"capabilities":["device_alias_v1"]}"#
                } else {
                    assert!(request.starts_with("PATCH /prefix/api/devices/id "));
                    assert!(request
                        .to_ascii_lowercase()
                        .contains("authorization: bearer fixture"));
                    assert!(request.ends_with(r#"{"device_alias":null}"#));
                    "{}"
                };
                socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body).as_bytes()).await.unwrap();
            }
        });
        let session = AccountSession::new("fixture".into(), "user".into(), [7; 32]);
        AccountClient::new()
            .update_device_alias(&url, &session, "id", None)
            .await
            .unwrap();
        server.await.unwrap();
    }

    #[tokio::test]
    async fn cli_kind_is_reported_only_to_a_relay_that_advertises_it() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            for reply in [
                // A Relay that learned the kind.
                Some(r#"{"capabilities":["device_alias_v1","device_kind_cli_v1"]}"#),
                // An older Relay validates kinds against a shorter list and
                // would reject the whole login, so the CLI must stay a desktop.
                Some(r#"{"capabilities":["device_alias_v1"]}"#),
                // No capability list at all: unknown, so unsupported.
                None,
            ] {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut buffer = [0; 4096];
                assert!(socket.read(&mut buffer).await.unwrap() > 0);
                let response = match reply {
                    Some(body) => format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        body.len(),
                        body
                    ),
                    None => "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_string(),
                };
                socket.write_all(response.as_bytes()).await.unwrap();
            }
        });

        let client = AccountClient::new();
        assert_eq!(
            client.reported_device_kind(&url, true).await,
            DEVICE_KIND_CLI
        );
        assert_eq!(
            client.reported_device_kind(&url, true).await,
            DEVICE_KIND_DESKTOP
        );
        assert_eq!(
            client.reported_device_kind(&url, true).await,
            DEVICE_KIND_DESKTOP
        );
        // A Desktop host issues no probe at all: it already reports the value
        // every Relay accepts.
        assert_eq!(
            client.reported_device_kind(&url, false).await,
            DEVICE_KIND_DESKTOP
        );
        server.await.unwrap();
    }

    #[tokio::test]
    async fn slow_peer_lookup_does_not_block_another_device_or_invalidation() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        use tokio::time::{timeout, Duration};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let (started_tx, started_rx) = tokio::sync::oneshot::channel();
        let (release_tx, release_rx) = tokio::sync::oneshot::channel();
        let server = tokio::spawn(async move {
            let (mut slow, _) = listener.accept().await.unwrap();
            let mut request = [0; 4096];
            // The fixture only needs each request to have arrived before it
            // answers; the reply does not depend on the bytes received.
            assert!(slow.read(&mut request).await.unwrap() > 0);
            started_tx.send(()).unwrap();
            let (mut fast, _) = listener.accept().await.unwrap();
            assert!(fast.read(&mut request).await.unwrap() > 0);
            let reply = |device: &str| {
                let body = serde_json::json!({
                    "device_id": device,
                    "public_key": super::super::encryption::KeyPair::generate().public_key_base64()
                })
                .to_string();
                format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body)
            };
            fast.write_all(reply("fast").as_bytes()).await.unwrap();
            release_rx.await.unwrap();
            slow.write_all(reply("slow").as_bytes()).await.unwrap();
        });
        let session = AccountSession::new("fixture".into(), "fixture".into(), [7; 32]);
        let slow_session = session.clone();
        let slow_url = url.clone();
        let slow =
            tokio::spawn(async move { slow_session.peer_message_key(&slow_url, "slow").await });
        timeout(Duration::from_secs(5), started_rx)
            .await
            .unwrap()
            .unwrap();
        timeout(
            Duration::from_secs(5),
            session.peer_message_key(&url, "fast"),
        )
        .await
        .unwrap()
        .unwrap();
        timeout(Duration::from_secs(5), session.clear_peer_keys())
            .await
            .unwrap();
        release_tx.send(()).unwrap();
        slow.await.unwrap().unwrap();
        server.await.unwrap();
        assert!(
            session.peer_keys.lock().await.is_empty(),
            "invalidation must survive an older lookup completing"
        );
    }

    /// The key lookup carries the directory row kind when the relay reports
    /// it; an older relay's answer (no field) reads as `None`, and the key and
    /// kind come from one cached lookup.
    #[tokio::test]
    async fn peer_device_kind_reads_the_relay_row_kind_and_tolerates_old_relays() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            for _ in 0..2 {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut request = [0; 4096];
                let length = stream.read(&mut request).await.unwrap();
                let line = String::from_utf8_lossy(&request[..length]).to_string();
                let public_key = super::super::encryption::KeyPair::generate().public_key_base64();
                let body = if line.starts_with("GET /api/devices/cloud-1/key ") {
                    serde_json::json!({
                        "device_id": "cloud-1",
                        "public_key": public_key,
                        "device_kind": "cloud_agent",
                    })
                } else {
                    serde_json::json!({ "device_id": "old-host", "public_key": public_key })
                }
                .to_string();
                let reply = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body);
                stream.write_all(reply.as_bytes()).await.unwrap();
            }
        });
        let session = AccountSession::new("fixture".into(), "fixture".into(), [7; 32]);
        assert_eq!(
            session
                .peer_device_kind(&url, "cloud-1")
                .await
                .unwrap()
                .as_deref(),
            Some("cloud_agent")
        );
        // Served from the same cached lookup: no third request.
        session.peer_message_key(&url, "cloud-1").await.unwrap();
        assert_eq!(
            session.peer_device_kind(&url, "old-host").await.unwrap(),
            None
        );
        server.await.unwrap();
    }

    #[test]
    fn relay_endpoint_accepts_http_servers_and_rejects_ambiguous_urls() {
        let endpoint =
            AccountClient::endpoint("https://relay.example.com/prefix/", "/api/devices").unwrap();
        assert_eq!(
            endpoint.as_str(),
            "https://relay.example.com/prefix/api/devices"
        );

        for invalid in [
            "file:///tmp/relay",
            "https://user:pass@relay.example.com",
            "https://relay.example.com?target=other",
            "https://relay.example.com/#fragment",
        ] {
            assert!(AccountClient::endpoint(invalid, "/api/devices").is_err());
        }
    }

    #[test]
    fn retired_official_endpoint_does_not_capture_custom_relays() {
        let current = openbitfun_product_domains::account::DEFAULT_RELAY_URL;
        assert_eq!(current, "https://super.openbitfun.com/directory");
        let origin = "https://super.openbitfun.com";
        for old in [[origin, "/v/1.0.0"].concat(), [origin, "/v/1.0.1"].concat()] {
            assert!(is_retired_official_relay(&old), "{old}");
            assert!(is_retired_official_relay(&format!("{old}/")), "{old}/");
            assert!(!is_retired_official_relay(&format!("{old}?other=1")));
            assert!(!is_retired_official_relay(&format!("{old}#pair")));
        }
        for endpoint in [
            current.to_string(),
            format!("{current}/"),
            "https://custom.example/v/1.0.0".to_string(),
            "http://127.0.0.1:9700".to_string(),
            // The 1.0 host is another deployment, never this build's.
            "https://remote.openbitfun.com/v/1.0.0".to_string(),
            format!("{origin}/v/"),
            format!("{origin}/v/1.0.0/p/alice/demo"),
            "https://user@super.openbitfun.com/v/1.0.0".to_string(),
            "https://super.openbitfun.com:444/v/1.0.0".to_string(),
            "http://super.openbitfun.com/v/1.0.1".to_string(),
        ] {
            assert!(!is_retired_official_relay(&endpoint), "{endpoint}");
        }
    }
}

//! The account APIs the phone uses, the same ones every OpenBitFun desktop
//! uses:
//!
//! - the identity service (`https://auth.openbitfun.com/api/v1`): a device
//!   sign-in transaction (`/auth/desktop/start?methods=all`) whose ticket
//!   takes the email code (`/auth/email/send`, `/auth/email/verify`), then
//!   `/auth/desktop/poll` hands this device its token pair; `/auth/refresh`,
//!   `/me`, `/auth/logout`.
//! - the account directory (`https://remote.openbitfun.com/relay`): the
//!   device registers its public key with the identity token
//!   (`/api/auth/login`, kind `mobile`), lists the account's devices and
//!   reads their public keys. The directory is never a transport here.
//!
//! Tokens and keys are never logged.

use std::time::Duration;

use serde::{Deserialize, Serialize};

pub(crate) const DEFAULT_AUTH_API_URL: &str = "https://auth.openbitfun.com/api/v1";
pub(crate) const DEFAULT_DIRECTORY_URL: &str = "https://remote.openbitfun.com/relay";
/// The directory's device kind for phones.
pub(crate) const DEVICE_KIND_MOBILE: &str = "mobile";
/// The relay client protocol the directory expects (`product-domains`
/// `account::CLIENT_PROTOCOL_VERSION`).
const CLIENT_PROTOCOL_VERSION: u32 = 2;
/// Refresh the access token when less than this remains.
const ACCESS_REFRESH_MARGIN_SECS: i64 = 120;

/// The identity service's token pair.
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TokenPair {
    pub(crate) access_token: String,
    pub(crate) access_expires_at: i64,
    pub(crate) refresh_token: String,
    pub(crate) refresh_expires_at: i64,
}

impl std::fmt::Debug for TokenPair {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TokenPair")
            .field("access_expires_at", &self.access_expires_at)
            .field("refresh_expires_at", &self.refresh_expires_at)
            .finish_non_exhaustive()
    }
}

impl TokenPair {
    pub(crate) fn needs_refresh(&self, now: i64) -> bool {
        self.access_expires_at - ACCESS_REFRESH_MARGIN_SECS <= now
    }

    pub(crate) fn refresh_expired(&self, now: i64) -> bool {
        self.refresh_expires_at <= now
    }
}

/// A started device sign-in.
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LoginStart {
    pub(crate) transaction_id: String,
    pub(crate) transaction_secret: String,
    pub(crate) authorization_url: String,
    #[serde(default)]
    pub(crate) expires_at: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodeSent {
    pub(crate) challenge_id: String,
    #[serde(default)]
    pub(crate) retry_after_seconds: u32,
}

#[derive(Deserialize)]
struct PollResponse {
    status: String,
    #[serde(default)]
    tokens: Option<TokenPair>,
}

/// `/me`: what the phone shows about the signed-in account.
#[derive(Debug, Clone, Default, Deserialize)]
pub(crate) struct Me {
    #[serde(default)]
    pub(crate) user: MeUser,
    #[serde(default)]
    pub(crate) email: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub(crate) struct MeUser {
    #[serde(default)]
    pub(crate) login: String,
}

/// One device of the account directory.
#[derive(Debug, Clone, Deserialize)]
pub(crate) struct DirectoryDevice {
    pub(crate) device_id: String,
    #[serde(default)]
    pub(crate) device_name: String,
    #[serde(default)]
    pub(crate) device_kind: Option<String>,
    #[serde(default)]
    pub(crate) device_alias: Option<String>,
    #[serde(default)]
    pub(crate) device_os: Option<String>,
    #[serde(default)]
    pub(crate) device_model: Option<String>,
    #[serde(default, rename = "client_version", alias = "clientVersion")]
    pub(crate) client_version: Option<String>,
    /// Absent on legacy directories (online list only).
    #[serde(default)]
    pub(crate) online: Option<bool>,
    #[serde(default)]
    pub(crate) last_seen_at: Option<i64>,
}

impl DirectoryDevice {
    /// The alias when the user set one, else the device's own name.
    pub(crate) fn display_name(&self) -> String {
        self.device_alias
            .as_deref()
            .map(str::trim)
            .filter(|alias| !alias.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| self.device_name.clone())
    }
}

/// The directory's sign-in answer.
#[derive(Deserialize)]
pub(crate) struct DirectoryLogin {
    pub(crate) token: String,
    pub(crate) user_id: String,
}

pub(crate) fn now_secs() -> i64 {
    (openbitfun_link::now_ms() / 1000) as i64
}

/// The `ticket` of a sign-in page address (`…/sign-in#ticket=<ticket>`).
pub(crate) fn ticket_of(authorization_url: &str) -> Option<String> {
    let fragment = authorization_url.split_once('#')?.1;
    fragment
        .split('&')
        .find_map(|pair| pair.strip_prefix("ticket="))
        .filter(|ticket| !ticket.is_empty() && ticket.bytes().all(|b| b.is_ascii_graphic()))
        .map(str::to_string)
}

/// An HTTPS client for the account APIs.
pub(crate) fn http_client() -> Result<reqwest::Client, String> {
    openbitfun_services_core::tls_provider::ensure_ring_crypto_provider();
    let builder = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(concat!("openbitfun-mobile/", env!("CARGO_PKG_VERSION")));
    #[cfg(target_os = "android")]
    let builder = {
        let mut roots = rustls::RootCertStore::empty();
        roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
        let config = rustls::ClientConfig::builder()
            .with_root_certificates(roots)
            .with_no_client_auth();
        builder.tls_backend_preconfigured(config)
    };
    builder
        .build()
        .map_err(|error| format!("the HTTPS client could not start: {error}"))
}

/// A refusal as `<code>: <sentence>`, the code one of the controller
/// port's (`invalid_email`, `invalid_code`, `rate_limited`, `signed_out`,
/// `unsupported`, `unavailable`); the sentence is the service's own.
async fn refusal(service: &str, response: reqwest::Response) -> String {
    let status = response.status().as_u16();
    let body = response.bytes().await.unwrap_or_default();
    let value: serde_json::Value = serde_json::from_slice(&body).unwrap_or_default();
    // Identity service: `{error: {code, message}}`; directory: `{error: "..."}`.
    let message = value["error"]["message"]
        .as_str()
        .or_else(|| value["error"].as_str())
        .map(str::to_string)
        .unwrap_or_else(|| format!("{service} refused the request"));
    let service_code = value["error"]["code"].as_str().unwrap_or_default();
    let code = refusal_code(status, service_code);
    format!("{code}: {message} (HTTP {status})")
}

/// The port code of a refusal.
pub(crate) fn refusal_code(status: u16, service_code: &str) -> &'static str {
    match service_code {
        "invalid_email" => return "invalid_email",
        "invalid_email_code" | "login_flow_expired" | "desktop_auth_expired" => {
            return "invalid_code"
        }
        "email_rate_limit" | "auth_capacity" => return "rate_limited",
        "email_not_configured" => return "unsupported",
        _ => {}
    }
    match status {
        401 | 403 => "signed_out",
        404 | 405 | 501 => "unsupported",
        429 => "rate_limited",
        _ => "unavailable",
    }
}

fn transport(service: &str, error: reqwest::Error) -> String {
    format!("network: {service} is unreachable: {}", error.without_url())
}

/// The identity service.
#[derive(Clone)]
pub(crate) struct AuthApi {
    base: String,
    http: reqwest::Client,
}

impl AuthApi {
    pub(crate) fn new(base: &str, http: reqwest::Client) -> Self {
        Self {
            base: base.trim_end_matches('/').to_string(),
            http,
        }
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.base, path)
    }

    async fn json<T: for<'de> Deserialize<'de>>(
        &self,
        request: reqwest::RequestBuilder,
    ) -> Result<T, String> {
        const SERVICE: &str = "The sign-in service";
        let response = request
            .send()
            .await
            .map_err(|error| transport(SERVICE, error))?;
        if !response.status().is_success() {
            return Err(refusal(SERVICE, response).await);
        }
        response
            .json()
            .await
            .map_err(|error| format!("unavailable: {SERVICE} sent an unreadable answer: {error}"))
    }

    /// Starts a device sign-in that accepts every method (email included).
    pub(crate) async fn start(&self) -> Result<LoginStart, String> {
        self.json(self.http.post(self.url("/auth/desktop/start?methods=all")))
            .await
    }

    pub(crate) async fn send_code(
        &self,
        ticket: &str,
        email: &str,
        locale: &str,
    ) -> Result<CodeSent, String> {
        self.json(
            self.http
                .post(self.url("/auth/email/send"))
                .json(&serde_json::json!({
                    "ticket": ticket,
                    "email": email,
                    "locale": locale,
                })),
        )
        .await
    }

    /// Checks the code; the sign-in transaction is authorized on success.
    pub(crate) async fn verify_code(
        &self,
        ticket: &str,
        challenge_id: &str,
        code: &str,
    ) -> Result<(), String> {
        self.json::<serde_json::Value>(self.http.post(self.url("/auth/email/verify")).json(
            &serde_json::json!({
                "ticket": ticket,
                "challengeId": challenge_id,
                "code": code,
            }),
        ))
        .await
        .map(|_| ())
    }

    /// The token pair of an authorized transaction; `None` while pending.
    pub(crate) async fn poll(&self, start: &LoginStart) -> Result<Option<TokenPair>, String> {
        let answer: PollResponse = self
            .json(
                self.http
                    .post(self.url("/auth/desktop/poll"))
                    .json(&serde_json::json!({
                        "transactionId": start.transaction_id,
                        "transactionSecret": start.transaction_secret,
                    })),
            )
            .await?;
        match (answer.status.as_str(), answer.tokens) {
            ("authorized", Some(tokens)) => Ok(Some(tokens)),
            ("pending", _) => Ok(None),
            (status, _) => Err(format!(
                "invalid_code: the sign-in request is {status}; request a new code"
            )),
        }
    }

    pub(crate) async fn refresh(&self, refresh_token: &str) -> Result<TokenPair, String> {
        self.json(
            self.http
                .post(self.url("/auth/refresh"))
                .json(&serde_json::json!({ "refreshToken": refresh_token })),
        )
        .await
    }

    pub(crate) async fn me(&self, access_token: &str) -> Result<Me, String> {
        self.json(self.http.get(self.url("/me")).bearer_auth(access_token))
            .await
    }

    /// Best effort: ends the token pair on the server.
    pub(crate) async fn logout(&self, access_token: &str) {
        let result = self
            .http
            .post(self.url("/auth/logout"))
            .bearer_auth(access_token)
            .send()
            .await;
        if let Err(error) = result {
            log::warn!(
                "Sign-out could not reach the sign-in service: {}",
                error.without_url()
            );
        }
    }
}

/// The account directory (names and public keys of the account's devices).
#[derive(Clone)]
pub(crate) struct Directory {
    base: String,
    http: reqwest::Client,
}

impl Directory {
    pub(crate) fn new(base: &str, http: reqwest::Client) -> Self {
        Self {
            base: base.trim_end_matches('/').to_string(),
            http,
        }
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.base, path)
    }

    async fn json<T: for<'de> Deserialize<'de>>(
        &self,
        request: reqwest::RequestBuilder,
    ) -> Result<T, String> {
        const SERVICE: &str = "The device directory";
        let response = request
            .send()
            .await
            .map_err(|error| transport(SERVICE, error))?;
        if !response.status().is_success() {
            return Err(refusal(SERVICE, response).await);
        }
        response
            .json()
            .await
            .map_err(|error| format!("unavailable: {SERVICE} sent an unreadable answer: {error}"))
    }

    /// Registers this phone (its public key) with the identity token.
    pub(crate) async fn login(
        &self,
        access_token: &str,
        device_id: &str,
        device_name: &str,
        public_key: &str,
    ) -> Result<DirectoryLogin, String> {
        self.json(
            self.http
                .post(self.url("/api/auth/login"))
                .json(&serde_json::json!({
                    "access_token": access_token,
                    "device_id": device_id,
                    "device_name": device_name,
                    "device_kind": DEVICE_KIND_MOBILE,
                    "public_key": public_key,
                    "request_id": crate::crypto::new_device_id(),
                    "clientVersion": env!("CARGO_PKG_VERSION"),
                    "clientProtocol": CLIENT_PROTOCOL_VERSION,
                })),
        )
        .await
    }

    pub(crate) async fn devices(&self, token: &str) -> Result<Vec<DirectoryDevice>, String> {
        self.json(self.http.get(self.url("/api/devices")).bearer_auth(token))
            .await
    }

    /// `device_id`'s public key (base64).
    pub(crate) async fn device_key(&self, token: &str, device_id: &str) -> Result<String, String> {
        #[derive(Deserialize)]
        struct PeerKey {
            device_id: String,
            public_key: String,
        }
        let key: PeerKey = self
            .json(
                self.http
                    .get(self.url(&format!("/api/devices/{device_id}/key")))
                    .bearer_auth(token),
            )
            .await?;
        if key.device_id != device_id {
            return Err(
                "unavailable: the device directory answered for another device".to_string(),
            );
        }
        Ok(key.public_key)
    }

    /// Best effort: ends the directory token.
    pub(crate) async fn logout(&self, token: &str) {
        if let Err(error) = self
            .http
            .post(self.url("/api/auth/logout"))
            .bearer_auth(token)
            .send()
            .await
        {
            log::warn!(
                "Sign-out could not reach the device directory: {}",
                error.without_url()
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ticket_comes_from_the_sign_in_fragment() {
        assert_eq!(
            ticket_of("https://auth.openbitfun.com/sign-in#ticket=abc_DEF-123").as_deref(),
            Some("abc_DEF-123")
        );
        assert_eq!(
            ticket_of("https://auth.openbitfun.com/sign-in#x=1&ticket=t2").as_deref(),
            Some("t2")
        );
        assert_eq!(
            ticket_of("https://auth.openbitfun.com/authorize?state=1"),
            None
        );
        assert_eq!(
            ticket_of("https://auth.openbitfun.com/sign-in#ticket="),
            None
        );
    }

    #[test]
    fn directory_rows_from_legacy_and_current_directories_parse() {
        let legacy: Vec<DirectoryDevice> =
            serde_json::from_str(r#"[{"device_id":"a","device_name":"Mac"}]"#).unwrap();
        assert_eq!(legacy[0].online, None);
        assert_eq!(legacy[0].display_name(), "Mac");
        let current: Vec<DirectoryDevice> = serde_json::from_str(
            r#"[{"device_id":"b","device_name":"Mac","device_alias":" Work ","device_kind":"desktop",
                "online":true,"last_seen_at":1700000000,"client_version":"1.0.11","compatible":true,
                "unknown_field":1}]"#,
        )
        .unwrap();
        assert_eq!(current[0].display_name(), "Work");
        assert_eq!(current[0].device_kind.as_deref(), Some("desktop"));
        assert_eq!(current[0].client_version.as_deref(), Some("1.0.11"));
    }

    #[test]
    fn refusals_map_to_port_codes() {
        assert_eq!(refusal_code(400, "invalid_email"), "invalid_email");
        assert_eq!(refusal_code(400, "invalid_email_code"), "invalid_code");
        assert_eq!(refusal_code(400, "login_flow_expired"), "invalid_code");
        assert_eq!(refusal_code(429, "email_rate_limit"), "rate_limited");
        assert_eq!(refusal_code(503, "email_not_configured"), "unsupported");
        assert_eq!(refusal_code(401, ""), "signed_out");
        assert_eq!(refusal_code(404, ""), "unsupported");
        assert_eq!(refusal_code(502, ""), "unavailable");
    }

    #[test]
    fn token_refresh_window() {
        let tokens = TokenPair {
            access_token: "a".into(),
            access_expires_at: 1_000,
            refresh_token: "r".into(),
            refresh_expires_at: 5_000,
        };
        assert!(!tokens.needs_refresh(800));
        assert!(tokens.needs_refresh(900));
        assert!(!tokens.refresh_expired(4_999));
        assert!(tokens.refresh_expired(5_000));
        let shown = format!("{tokens:?}");
        assert!(!shown.contains("access_token") && !shown.contains("refresh_token"));
    }
}

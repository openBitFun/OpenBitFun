//! What the gateway asks other services: the identity authority (email
//! sign-in), the account device directory (the relay: registration, device
//! list, keys, sign-out), and the account networks (Link streams).
//!
//! Each is a trait so the routes are tested without the network.

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::io::{AsyncRead, AsyncWrite};

pub(crate) type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// A failure of another service, already in the browser's vocabulary.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct UpstreamError {
    /// `invalid_email`, `invalid_code`, `rate_limited`, `signed_out`,
    /// `unavailable`, `not_found`.
    pub(crate) code: &'static str,
    pub(crate) message: String,
    pub(crate) retry_after_seconds: Option<u64>,
}

impl UpstreamError {
    pub(crate) fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            retry_after_seconds: None,
        }
    }

    pub(crate) fn unavailable(message: impl Into<String>) -> Self {
        Self::new("unavailable", message)
    }
}

/// A started email sign-in (kept on the gateway; never sent to the browser).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PendingSignIn {
    pub(crate) transaction_id: String,
    pub(crate) transaction_secret: String,
    pub(crate) ticket: String,
    pub(crate) challenge_id: String,
    pub(crate) email: String,
    pub(crate) retry_after_seconds: u64,
    /// Unix seconds.
    pub(crate) expires_at: i64,
}

/// The browser's device as the directory registers it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DeviceRegistration {
    pub(crate) device_id: String,
    /// X25519 public key, standard base64 (32 bytes).
    pub(crate) public_key: String,
    pub(crate) name: String,
}

/// The directory's answer to a registration.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Registered {
    pub(crate) account_id: String,
    pub(crate) directory_token: String,
}

/// One host device of the account, as the directory lists it.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct DirectoryDevice {
    pub(crate) device_id: String,
    #[serde(default)]
    pub(crate) device_name: String,
    #[serde(default)]
    pub(crate) device_alias: Option<String>,
    #[serde(default)]
    pub(crate) device_kind: Option<String>,
    #[serde(default)]
    pub(crate) device_model: Option<String>,
    #[serde(default)]
    pub(crate) device_os: Option<String>,
    #[serde(default)]
    pub(crate) client_version: Option<String>,
    #[serde(default)]
    pub(crate) online: bool,
    /// Unix seconds.
    #[serde(default)]
    pub(crate) last_seen_at: Option<i64>,
}

/// The identity authority and the device directory.
pub(crate) trait Accounts: Send + Sync + 'static {
    /// Starts an email sign-in and sends the code.
    fn send_code<'a>(
        &'a self,
        email: &'a str,
        locale: &'a str,
        client_ip: &'a str,
    ) -> BoxFuture<'a, Result<PendingSignIn, UpstreamError>>;
    /// Checks the code and returns the account's access token.
    fn verify_code<'a>(
        &'a self,
        pending: &'a PendingSignIn,
        code: &'a str,
    ) -> BoxFuture<'a, Result<String, UpstreamError>>;
    /// Registers the browser's device key with the access token.
    fn register<'a>(
        &'a self,
        access_token: &'a str,
        device: &'a DeviceRegistration,
        client_ip: &'a str,
    ) -> BoxFuture<'a, Result<Registered, UpstreamError>>;
    /// The account's host devices (`signed_out` when the token is no longer valid).
    fn devices<'a>(
        &'a self,
        directory_token: &'a str,
    ) -> BoxFuture<'a, Result<Vec<DirectoryDevice>, UpstreamError>>;
    /// A device's X25519 public key (standard base64).
    fn device_key<'a>(
        &'a self,
        directory_token: &'a str,
        device_id: &'a str,
    ) -> BoxFuture<'a, Result<String, UpstreamError>>;
    /// Revokes the browser's directory credential.
    fn sign_out<'a>(&'a self, directory_token: &'a str)
        -> BoxFuture<'a, Result<(), UpstreamError>>;
}

/// A byte stream to a device's OBP port.
pub(crate) trait DeviceIo: AsyncRead + AsyncWrite + Unpin + Send + 'static {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send + 'static> DeviceIo for T {}

/// Why a stream could not be opened.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum StreamError {
    Busy(String),
    Unavailable(String),
    Unreachable(String),
}

/// A member of an account network that is online now.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct OnlineMember {
    /// `direct_lan`, `direct_ipv4`, `direct_ipv6`, `relayed_peer`,
    /// `relayed_server` (as the gateway reaches it).
    pub(crate) route: Option<String>,
    pub(crate) latency_ms: Option<f64>,
    /// A phone app or browser session: drives devices, serves nothing.
    pub(crate) controller: bool,
}

/// Streams into account networks.
pub(crate) trait DeviceStreams: Send + Sync + 'static {
    fn open<'a>(
        &'a self,
        account_id: &'a str,
        device_id: &'a str,
    ) -> BoxFuture<'a, Result<Box<dyn DeviceIo>, StreamError>>;
    /// The account network's members online now, by device id. Polled with
    /// the device list, so it must stay cheap.
    fn online<'a>(
        &'a self,
        account_id: &'a str,
    ) -> BoxFuture<'a, Result<HashMap<String, OnlineMember>, StreamError>>;
}

/// `openbitfun_link::gateway::LinkGateway` as the gateway's stream source.
pub(crate) struct LinkStreams(pub std::sync::Arc<openbitfun_link::gateway::LinkGateway>);

impl DeviceStreams for LinkStreams {
    fn open<'a>(
        &'a self,
        account_id: &'a str,
        device_id: &'a str,
    ) -> BoxFuture<'a, Result<Box<dyn DeviceIo>, StreamError>> {
        use openbitfun_link::gateway::GatewayError;
        Box::pin(async move {
            match self.0.open(account_id, device_id, None).await {
                Ok(stream) => Ok(Box::new(stream) as Box<dyn DeviceIo>),
                Err(GatewayError::Busy(message)) => Err(StreamError::Busy(message)),
                Err(GatewayError::Unavailable(message)) => Err(StreamError::Unavailable(message)),
                Err(GatewayError::Unreachable(message)) => Err(StreamError::Unreachable(message)),
            }
        })
    }

    fn online<'a>(
        &'a self,
        account_id: &'a str,
    ) -> BoxFuture<'a, Result<HashMap<String, OnlineMember>, StreamError>> {
        use openbitfun_link::gateway::GatewayError;
        Box::pin(async move {
            let peers = self
                .0
                .peers(account_id)
                .await
                .map_err(|error| match error {
                    GatewayError::Busy(message) => StreamError::Busy(message),
                    GatewayError::Unavailable(message) => StreamError::Unavailable(message),
                    GatewayError::Unreachable(message) => StreamError::Unreachable(message),
                })?;
            Ok(peers
                .into_iter()
                .map(|peer| {
                    let route = peer
                        .route
                        .and_then(|route| serde_json::to_value(route).ok())
                        .and_then(|value| value.as_str().map(str::to_string));
                    (
                        peer.hostname,
                        OnlineMember {
                            route,
                            latency_ms: peer.latency_ms,
                            controller: peer.role.is_controller(),
                        },
                    )
                })
                .collect())
        })
    }
}

/// The HTTP implementation: the identity authority at `auth_url` (e.g.
/// `https://auth.openbitfun.com/api/v1`) and the directory at
/// `directory_url` (the relay, e.g. `http://127.0.0.1:19702`).
pub(crate) struct HttpAccounts {
    client: reqwest::Client,
    auth_url: String,
    directory_url: String,
    client_version: String,
}

impl HttpAccounts {
    pub(crate) fn new(auth_url: &str, directory_url: &str) -> anyhow::Result<Self> {
        openbitfun_services_core::tls_provider::ensure_ring_crypto_provider();
        Ok(Self {
            client: reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(5))
                .timeout(Duration::from_secs(20))
                .redirect(reqwest::redirect::Policy::none())
                .build()?,
            auth_url: auth_url.trim().trim_end_matches('/').to_string(),
            directory_url: directory_url.trim().trim_end_matches('/').to_string(),
            client_version: env!("CARGO_PKG_VERSION").to_string(),
        })
    }

    async fn auth_post(
        &self,
        path: &str,
        body: serde_json::Value,
    ) -> Result<serde_json::Value, UpstreamError> {
        let response = self
            .client
            .post(format!("{}{path}", self.auth_url))
            .json(&body)
            .send()
            .await
            .map_err(|_| {
                UpstreamError::unavailable("The account service is unreachable; try again shortly.")
            })?;
        let status = response.status();
        let retry_after = response
            .headers()
            .get(reqwest::header::RETRY_AFTER)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse::<u64>().ok());
        let value: serde_json::Value = response.json().await.unwrap_or(serde_json::Value::Null);
        if status.is_success() {
            return Ok(value);
        }
        // `{error: {code, message}}` (the authority's envelope).
        let code = value["error"]["code"].as_str().unwrap_or_default();
        let message = value["error"]["message"]
            .as_str()
            .unwrap_or("The account service refused the request.")
            .to_string();
        let mut error = match (status.as_u16(), code) {
            (_, "invalid_email") => UpstreamError::new("invalid_email", message),
            (_, "invalid_email_code") | (_, "login_flow_expired") => {
                UpstreamError::new("invalid_code", message)
            }
            (429, _) | (_, "email_rate_limit") | (_, "auth_rate_limit") => {
                UpstreamError::new("rate_limited", message)
            }
            _ => UpstreamError::unavailable(message),
        };
        error.retry_after_seconds = retry_after;
        Err(error)
    }

    fn directory(&self, path: &str) -> String {
        format!("{}{path}", self.directory_url)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopStart {
    transaction_id: String,
    transaction_secret: String,
    authorization_url: String,
    expires_at: i64,
}

/// The sign-in ticket in the authority's authorization URL (`…#ticket=<t>`).
pub(crate) fn ticket_of(authorization_url: &str) -> Option<String> {
    let fragment = authorization_url.split_once('#')?.1;
    fragment
        .split('&')
        .filter_map(|pair| pair.split_once('='))
        .find(|(name, _)| *name == "ticket")
        .map(|(_, value)| value.to_string())
        .filter(|ticket| {
            !ticket.is_empty()
                && ticket.len() <= 256
                && ticket
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
        })
}

impl Accounts for HttpAccounts {
    fn send_code<'a>(
        &'a self,
        email: &'a str,
        locale: &'a str,
        _client_ip: &'a str,
    ) -> BoxFuture<'a, Result<PendingSignIn, UpstreamError>> {
        Box::pin(async move {
            let start: DesktopStart = serde_json::from_value(
                self.auth_post("/auth/desktop/start?methods=all", serde_json::json!({}))
                    .await?,
            )
            .map_err(|_| {
                UpstreamError::unavailable("The account service answered unexpectedly.")
            })?;
            let ticket = ticket_of(&start.authorization_url).ok_or_else(|| {
                UpstreamError::unavailable(
                    "The account service does not offer email sign-in here; update the server.",
                )
            })?;
            let sent = self
                .auth_post(
                    "/auth/email/send",
                    serde_json::json!({ "ticket": ticket, "email": email, "locale": locale }),
                )
                .await?;
            let challenge_id = sent["challengeId"]
                .as_str()
                .filter(|id| !id.is_empty())
                .ok_or_else(|| {
                    UpstreamError::unavailable("The account service answered unexpectedly.")
                })?
                .to_string();
            Ok(PendingSignIn {
                transaction_id: start.transaction_id,
                transaction_secret: start.transaction_secret,
                ticket,
                challenge_id,
                email: email.trim().to_ascii_lowercase(),
                retry_after_seconds: sent["retryAfterSeconds"].as_u64().unwrap_or(60),
                expires_at: start.expires_at,
            })
        })
    }

    fn verify_code<'a>(
        &'a self,
        pending: &'a PendingSignIn,
        code: &'a str,
    ) -> BoxFuture<'a, Result<String, UpstreamError>> {
        Box::pin(async move {
            self.auth_post(
                "/auth/email/verify",
                serde_json::json!({
                    "ticket": pending.ticket,
                    "challengeId": pending.challenge_id,
                    "code": code,
                }),
            )
            .await?;
            // The transaction is authorized now; a few polls absorb a lagging replica.
            for _ in 0..5 {
                let polled = self
                    .auth_post(
                        "/auth/desktop/poll",
                        serde_json::json!({
                            "transactionId": pending.transaction_id,
                            "transactionSecret": pending.transaction_secret,
                        }),
                    )
                    .await?;
                match polled["status"].as_str() {
                    Some("authorized") => {
                        return polled["tokens"]["accessToken"]
                            .as_str()
                            .filter(|token| !token.is_empty())
                            .map(str::to_string)
                            .ok_or_else(|| {
                                UpstreamError::unavailable(
                                    "The account service answered unexpectedly.",
                                )
                            })
                    }
                    Some("pending") => tokio::time::sleep(Duration::from_millis(400)).await,
                    _ => {
                        return Err(UpstreamError::new(
                            "invalid_code",
                            "This sign-in is no longer active; request a new code.",
                        ))
                    }
                }
            }
            Err(UpstreamError::unavailable(
                "The account service did not confirm the sign-in; try again.",
            ))
        })
    }

    fn register<'a>(
        &'a self,
        access_token: &'a str,
        device: &'a DeviceRegistration,
        client_ip: &'a str,
    ) -> BoxFuture<'a, Result<Registered, UpstreamError>> {
        Box::pin(async move {
            let response = self
                .client
                .post(self.directory("/api/auth/login"))
                .header("x-forwarded-for", client_ip)
                .json(&serde_json::json!({
                    "access_token": access_token,
                    "device_id": device.device_id,
                    "device_name": device.name,
                    // A controller: the directory never lists it as a host.
                    "device_kind": "mobile",
                    "public_key": device.public_key,
                    "request_id": uuid::Uuid::new_v4().to_string(),
                    "clientVersion": self.client_version,
                }))
                .send()
                .await
                .map_err(|_| {
                    UpstreamError::unavailable(
                        "The device directory is unreachable; try again shortly.",
                    )
                })?;
            let status = response.status();
            let value: serde_json::Value = response.json().await.unwrap_or(serde_json::Value::Null);
            if !status.is_success() {
                let message = value["error"]
                    .as_str()
                    .unwrap_or("The device directory refused this browser.")
                    .to_string();
                return Err(match status.as_u16() {
                    401 | 403 => UpstreamError::new("signed_out", message),
                    429 => UpstreamError::new("rate_limited", message),
                    _ => UpstreamError::unavailable(message),
                });
            }
            let account_id = value["user_id"].as_str().unwrap_or_default().to_string();
            let directory_token = value["token"].as_str().unwrap_or_default().to_string();
            if account_id.is_empty() || directory_token.is_empty() {
                return Err(UpstreamError::unavailable(
                    "The device directory answered unexpectedly.",
                ));
            }
            Ok(Registered {
                account_id,
                directory_token,
            })
        })
    }

    fn devices<'a>(
        &'a self,
        directory_token: &'a str,
    ) -> BoxFuture<'a, Result<Vec<DirectoryDevice>, UpstreamError>> {
        Box::pin(async move {
            let response = self
                .client
                .get(self.directory("/api/devices"))
                .bearer_auth(directory_token)
                .send()
                .await
                .map_err(|_| {
                    UpstreamError::unavailable(
                        "The device directory is unreachable; try again shortly.",
                    )
                })?;
            match response.status().as_u16() {
                200 => response.json().await.map_err(|_| {
                    UpstreamError::unavailable("The device directory answered unexpectedly.")
                }),
                401 | 403 => Err(UpstreamError::new(
                    "signed_out",
                    "This browser was signed out; sign in again.",
                )),
                status => Err(UpstreamError::unavailable(format!(
                    "The device directory answered HTTP {status}."
                ))),
            }
        })
    }

    fn device_key<'a>(
        &'a self,
        directory_token: &'a str,
        device_id: &'a str,
    ) -> BoxFuture<'a, Result<String, UpstreamError>> {
        Box::pin(async move {
            let response = self
                .client
                .get(self.directory(&format!("/api/devices/{device_id}/key")))
                .bearer_auth(directory_token)
                .send()
                .await
                .map_err(|_| {
                    UpstreamError::unavailable(
                        "The device directory is unreachable; try again shortly.",
                    )
                })?;
            match response.status().as_u16() {
                200 => {
                    let value: serde_json::Value = response.json().await.unwrap_or_default();
                    value["public_key"]
                        .as_str()
                        .filter(|key| !key.is_empty())
                        .map(str::to_string)
                        .ok_or_else(|| {
                            UpstreamError::unavailable(
                                "The device directory answered unexpectedly.",
                            )
                        })
                }
                401 | 403 => Err(UpstreamError::new(
                    "signed_out",
                    "This browser was signed out; sign in again.",
                )),
                404 => Err(UpstreamError::new(
                    "not_found",
                    "This device is not part of your account.",
                )),
                status => Err(UpstreamError::unavailable(format!(
                    "The device directory answered HTTP {status}."
                ))),
            }
        })
    }

    fn sign_out<'a>(
        &'a self,
        directory_token: &'a str,
    ) -> BoxFuture<'a, Result<(), UpstreamError>> {
        Box::pin(async move {
            let response = self
                .client
                .post(self.directory("/api/auth/logout"))
                .bearer_auth(directory_token)
                .send()
                .await
                .map_err(|_| UpstreamError::unavailable("The device directory is unreachable."))?;
            if response.status().is_success() || response.status().as_u16() == 401 {
                Ok(())
            } else {
                Err(UpstreamError::unavailable(format!(
                    "The device directory answered HTTP {}.",
                    response.status()
                )))
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::ticket_of;

    #[test]
    fn the_ticket_comes_from_the_authorization_fragment_only() {
        assert_eq!(
            ticket_of("https://auth.openbitfun.com/sign-in#ticket=abc_DEF-1").as_deref(),
            Some("abc_DEF-1")
        );
        assert_eq!(
            ticket_of("https://auth.openbitfun.com/sign-in#x=1&ticket=t2").as_deref(),
            Some("t2")
        );
        assert_eq!(
            ticket_of("https://github.com/login/oauth/authorize?ticket=t"),
            None
        );
        assert_eq!(
            ticket_of("https://auth.openbitfun.com/sign-in#ticket=a%22b"),
            None
        );
    }
}

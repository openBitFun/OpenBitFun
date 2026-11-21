//! The account device directory and the identity authority, as the cloud
//! node uses them. Traits, so the service is tested without the network.
//!
//! - The node's own row (kind `cloud_agent`) is registered through a
//!   server-only directory route; client logins can never write that kind
//!   (`relay-service::db::DeviceRow::register_cloud_agent`).
//! - Device lists and keys are read with the node's own device token, like
//!   any device of the account.

use std::time::Duration;

use serde::Deserialize;

use crate::device::BoxFuture;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DirectoryError {
    /// The credential is no longer valid.
    SignedOut,
    NotFound,
    /// This directory build has no cloud agent registration route.
    Unsupported(String),
    Unavailable(String),
}

impl std::fmt::Display for DirectoryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::SignedOut => f.write_str("signed_out"),
            Self::NotFound => f.write_str("not_found"),
            Self::Unsupported(message) => write!(f, "directory_cloud_agent_unsupported: {message}"),
            Self::Unavailable(message) => write!(f, "directory_unavailable: {message}"),
        }
    }
}

/// One device of the account, as the directory lists it.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(default)]
pub struct DirectoryDevice {
    pub device_id: String,
    pub device_name: String,
    pub device_alias: Option<String>,
    pub device_kind: Option<String>,
    pub device_os: Option<String>,
    pub client_version: Option<String>,
    pub online: bool,
}

pub trait Directory: Send + Sync + 'static {
    /// Registers the node's row and returns its device token.
    fn register<'a>(
        &'a self,
        account_id: &'a str,
        device_id: &'a str,
        name: &'a str,
        public_key: &'a str,
    ) -> BoxFuture<'a, Result<String, DirectoryError>>;
    /// Removes the node's row and revokes its tokens.
    fn unregister<'a>(
        &'a self,
        account_id: &'a str,
        device_id: &'a str,
        token: Option<&'a str>,
    ) -> BoxFuture<'a, Result<(), DirectoryError>>;
    /// The account's host devices.
    fn devices<'a>(
        &'a self,
        token: &'a str,
    ) -> BoxFuture<'a, Result<Vec<DirectoryDevice>, DirectoryError>>;
    /// A device's X25519 public key (standard base64) and its kind.
    fn device_key<'a>(
        &'a self,
        token: &'a str,
        device_id: &'a str,
    ) -> BoxFuture<'a, Result<(String, Option<String>), DirectoryError>>;
}

/// Verifies an OpenBitFun access token and names its account.
pub trait Identity: Send + Sync + 'static {
    fn account_of<'a>(
        &'a self,
        access_token: &'a str,
    ) -> BoxFuture<'a, Result<String, DirectoryError>>;
}

fn client() -> anyhow::Result<reqwest::Client> {
    openbitfun_services_core::tls_provider::ensure_ring_crypto_provider();
    Ok(reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .connect_timeout(Duration::from_secs(5))
        .build()?)
}

async fn read_bounded(response: reqwest::Response) -> Result<Vec<u8>, DirectoryError> {
    let mut response = response;
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| DirectoryError::Unavailable(e.to_string()))?
    {
        if bytes.len() + chunk.len() > 1024 * 1024 {
            return Err(DirectoryError::Unavailable("answer too large".into()));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

fn status_error(status: reqwest::StatusCode) -> DirectoryError {
    match status.as_u16() {
        401 | 403 => DirectoryError::SignedOut,
        404 => DirectoryError::NotFound,
        _ => DirectoryError::Unavailable(format!("HTTP {status}")),
    }
}

/// The relay's directory over HTTP (loopback on the server).
pub struct HttpDirectory {
    base: String,
    /// The server-only credential of the registration route (0600 file).
    internal_key: Option<String>,
    client: reqwest::Client,
}

impl HttpDirectory {
    pub fn new(base: &str, internal_key: Option<String>) -> anyhow::Result<Self> {
        Ok(Self {
            base: base.trim_end_matches('/').to_string(),
            internal_key,
            client: client()?,
        })
    }
}

impl Directory for HttpDirectory {
    fn register<'a>(
        &'a self,
        account_id: &'a str,
        device_id: &'a str,
        name: &'a str,
        public_key: &'a str,
    ) -> BoxFuture<'a, Result<String, DirectoryError>> {
        Box::pin(async move {
            let Some(key) = &self.internal_key else {
                return Err(DirectoryError::Unsupported(
                    "no internal directory credential is configured".into(),
                ));
            };
            let response = self
                .client
                .post(format!("{}/api/internal/v1/cloud-agent", self.base))
                .bearer_auth(key)
                .json(&serde_json::json!({
                    "userId": account_id,
                    "deviceId": device_id,
                    "deviceName": name,
                    "publicKey": public_key,
                }))
                .send()
                .await
                .map_err(|e| DirectoryError::Unavailable(e.to_string()))?;
            if response.status().as_u16() == 404 || response.status().as_u16() == 405 {
                return Err(DirectoryError::Unsupported(
                    "the directory has no cloud agent route yet".into(),
                ));
            }
            if !response.status().is_success() {
                return Err(status_error(response.status()));
            }
            #[derive(Deserialize)]
            struct Registered {
                token: String,
            }
            let body = read_bounded(response).await?;
            serde_json::from_slice::<Registered>(&body)
                .map(|r| r.token)
                .map_err(|e| DirectoryError::Unavailable(e.to_string()))
        })
    }

    fn unregister<'a>(
        &'a self,
        account_id: &'a str,
        device_id: &'a str,
        _token: Option<&'a str>,
    ) -> BoxFuture<'a, Result<(), DirectoryError>> {
        Box::pin(async move {
            let Some(key) = &self.internal_key else {
                return Err(DirectoryError::Unsupported(
                    "no internal directory credential is configured".into(),
                ));
            };
            let response = self
                .client
                .delete(format!("{}/api/internal/v1/cloud-agent", self.base))
                .bearer_auth(key)
                .json(&serde_json::json!({ "userId": account_id, "deviceId": device_id }))
                .send()
                .await
                .map_err(|e| DirectoryError::Unavailable(e.to_string()))?;
            if response.status().is_success() {
                Ok(())
            } else {
                Err(status_error(response.status()))
            }
        })
    }

    fn devices<'a>(
        &'a self,
        token: &'a str,
    ) -> BoxFuture<'a, Result<Vec<DirectoryDevice>, DirectoryError>> {
        Box::pin(async move {
            let response = self
                .client
                .get(format!("{}/api/devices", self.base))
                .bearer_auth(token)
                .send()
                .await
                .map_err(|e| DirectoryError::Unavailable(e.to_string()))?;
            if !response.status().is_success() {
                return Err(status_error(response.status()));
            }
            let body = read_bounded(response).await?;
            serde_json::from_slice(&body).map_err(|e| DirectoryError::Unavailable(e.to_string()))
        })
    }

    fn device_key<'a>(
        &'a self,
        token: &'a str,
        device_id: &'a str,
    ) -> BoxFuture<'a, Result<(String, Option<String>), DirectoryError>> {
        Box::pin(async move {
            if !openbitfun_link::handshake::valid_device_id(device_id) {
                return Err(DirectoryError::NotFound);
            }
            let response = self
                .client
                .get(format!("{}/api/devices/{}/key", self.base, device_id))
                .bearer_auth(token)
                .send()
                .await
                .map_err(|e| DirectoryError::Unavailable(e.to_string()))?;
            if !response.status().is_success() {
                return Err(status_error(response.status()));
            }
            #[derive(Deserialize)]
            struct Key {
                device_id: String,
                public_key: String,
                #[serde(default)]
                device_kind: Option<String>,
            }
            let body = read_bounded(response).await?;
            let key: Key = serde_json::from_slice(&body)
                .map_err(|e| DirectoryError::Unavailable(e.to_string()))?;
            if key.device_id != device_id {
                return Err(DirectoryError::Unavailable(
                    "the directory returned another device".into(),
                ));
            }
            Ok((key.public_key, key.device_kind))
        })
    }
}

/// The identity authority's `GET /me`.
pub struct HttpIdentity {
    me_url: String,
    client: reqwest::Client,
}

impl HttpIdentity {
    pub fn new(auth_base: &str) -> anyhow::Result<Self> {
        Ok(Self {
            me_url: format!("{}/me", auth_base.trim_end_matches('/')),
            client: client()?,
        })
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MeUser {
    #[serde(default, alias = "account_id")]
    account_id: Option<String>,
    #[serde(default, alias = "github_id")]
    github_id: i64,
}

/// The account id of a verified identity, the way the issuer and the relay
/// derive it.
pub fn identity_id(account_id: Option<&str>, github_id: i64) -> Option<String> {
    if github_id > 0 {
        return Some(github_id.to_string());
    }
    account_id
        .filter(|id| {
            id.starts_with("email-")
                && id.len() <= 64
                && id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
        })
        .map(str::to_string)
}

impl Identity for HttpIdentity {
    fn account_of<'a>(
        &'a self,
        access_token: &'a str,
    ) -> BoxFuture<'a, Result<String, DirectoryError>> {
        Box::pin(async move {
            if access_token.is_empty()
                || access_token.len() > 8192
                || access_token
                    .bytes()
                    .any(|c| c.is_ascii_whitespace() || c.is_ascii_control())
            {
                return Err(DirectoryError::SignedOut);
            }
            let response = self
                .client
                .get(&self.me_url)
                .bearer_auth(access_token)
                .send()
                .await
                .map_err(|e| DirectoryError::Unavailable(e.to_string()))?;
            if !response.status().is_success() {
                return Err(status_error(response.status()));
            }
            #[derive(Deserialize)]
            struct Me {
                user: MeUser,
            }
            let body = read_bounded(response).await?;
            let me: Me = serde_json::from_slice(&body)
                .map_err(|e| DirectoryError::Unavailable(e.to_string()))?;
            identity_id(me.user.account_id.as_deref(), me.user.github_id).ok_or_else(|| {
                DirectoryError::Unavailable("this identity has no account id".into())
            })
        })
    }
}

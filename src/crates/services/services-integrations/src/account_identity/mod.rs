//! Shared GitHub identity used by every OpenBitFun product surface.
mod credentials;
mod flow;
#[cfg(test)]
mod refresh_tests;
pub(crate) use credentials::profile_credential_vault;
use credentials::CredentialStore;
pub use credentials::{
    clear_market_credentials, load_market_credentials, save_market_credentials,
    StoredMarketCredentials,
};
pub use flow::{poll_auth_flow, start_auth_flow};
use openbitfun_product_domains::account::GitHubUser;
use reqwest::{RequestBuilder, Response, StatusCode};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
pub const DEFAULT_ACCOUNT_API_URL: &str = "https://auth.openbitfun.com/api/v1";
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAuthStart {
    pub transaction_id: String,
    pub transaction_secret: String,
    pub authorization_url: String,
    pub expires_at: i64,
    pub poll_interval_seconds: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAuthPollRequest {
    pub transaction_id: String,
    pub transaction_secret: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAuthPollResponse {
    pub status: String,
    pub tokens: Option<MarketTokenPair>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketTokenPair {
    pub access_token: String,
    pub access_expires_at: i64,
    pub refresh_token: String,
    pub refresh_expires_at: i64,
}

impl From<MarketTokenPair> for StoredMarketCredentials {
    fn from(value: MarketTokenPair) -> Self {
        Self {
            access_token: value.access_token,
            access_expires_at: value.access_expires_at,
            refresh_token: value.refresh_token,
            refresh_expires_at: value.refresh_expires_at,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketMe {
    pub user: GitHubUser,
    /// Verified email is private account metadata, never a public owner name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    pub is_admin: bool,
}

#[derive(Debug, Clone, Serialize, thiserror::Error)]
#[error("{message}")]
pub struct MarketClientError {
    pub code: String,
    pub message: String,
    pub request_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ErrorEnvelope {
    error: ErrorBody,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ErrorBody {
    code: String,
    message: String,
    request_id: Option<String>,
}

#[derive(Debug)]
pub struct AccountIdentityClient {
    base_url: String,
    client: reqwest::Client,
    credentials: Option<StoredMarketCredentials>,
    store: CredentialStore,
}

/// An access token this close to its expiry is refreshed before use.
const ACCESS_REFRESH_MARGIN_SECS: i64 = 30;
/// Bounds a refresh request, which runs under the credential update guard.
const REFRESH_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

impl AccountIdentityClient {
    /// Verify a controller credential without reading or mutating host credentials.
    pub async fn verify_access_token(access_token: &str) -> Result<MarketMe, MarketClientError> {
        if access_token.is_empty()
            || access_token.len() > 8192
            || access_token.chars().any(char::is_control)
        {
            return Err(local_error(
                "invalid_identity_token",
                "Invalid GitHub account credential.",
            ));
        }
        let client = crate::reqwest_client_builder()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(std::time::Duration::from_secs(3))
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .map_err(|error| local_error("identity_client_failed", error.to_string()))?;
        let response = client
            .get(format!("{DEFAULT_ACCOUNT_API_URL}/me"))
            .bearer_auth(access_token)
            .send()
            .await
            .map_err(transport_error)?;
        let mut response = checked_response(response).await?;
        let mut body = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(transport_error)? {
            if body.len() + chunk.len() > 65536 {
                return Err(local_error(
                    "invalid_identity_response",
                    "Account response is too large.",
                ));
            }
            body.extend_from_slice(&chunk);
        }
        let me: MarketMe = serde_json::from_slice(&body)
            .map_err(|_| local_error("invalid_identity_response", "Invalid account response."))?;
        if me.user.identity_id().is_none() || me.user.login.trim().is_empty() {
            return Err(local_error(
                "invalid_identity_response",
                "Invalid account identity.",
            ));
        }
        Ok(me)
    }

    pub async fn from_environment() -> Result<Self, MarketClientError> {
        let base_url = std::env::var("OPENBITFUN_ACCOUNT_API_URL")
            .or_else(|_| std::env::var("OPENBITFUN_MINIAPP_MARKET_API_URL"))
            .unwrap_or_else(|_| DEFAULT_ACCOUNT_API_URL.to_string());
        Self::new(base_url).await
    }

    pub async fn new(base_url: impl Into<String>) -> Result<Self, MarketClientError> {
        Self::with_store(base_url, CredentialStore::Profile).await
    }

    async fn with_store(
        base_url: impl Into<String>,
        store: CredentialStore,
    ) -> Result<Self, MarketClientError> {
        let base_url = base_url.into().trim_end_matches('/').to_string();
        let parsed = reqwest::Url::parse(&base_url)
            .map_err(|error| local_error("invalid_market_url", error.to_string()))?;
        let local_http = parsed.scheme() == "http"
            && parsed
                .host_str()
                .is_some_and(|host| matches!(host, "127.0.0.1" | "localhost" | "::1"));
        if parsed.scheme() != "https" && !local_http {
            return Err(local_error(
                "invalid_market_url",
                "The GitHub account API must use HTTPS.",
            ));
        }
        let client = crate::reqwest_client_builder()
            .user_agent(format!("OpenBitFun/{}", env!("CARGO_PKG_VERSION")))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|error| local_error("market_client_init_failed", error.to_string()))?;
        let credentials = store.load().await.map_err(store_error)?;
        Ok(Self {
            base_url,
            client,
            credentials,
            store,
        })
    }

    pub async fn start_desktop_auth(&self) -> Result<DesktopAuthStart, MarketClientError> {
        self.json(
            self.client
                .post(self.url("/auth/desktop/start?methods=all")),
        )
        .await
    }

    pub async fn poll_desktop_auth(
        &mut self,
        request: &DesktopAuthPollRequest,
    ) -> Result<DesktopAuthPollResponse, MarketClientError> {
        let response: DesktopAuthPollResponse = self
            .json(
                self.client
                    .post(self.url("/auth/desktop/poll"))
                    .json(request),
            )
            .await?;
        if let Some(tokens) = response.tokens.clone() {
            let credentials: StoredMarketCredentials = tokens.into();
            // Under the update guard, so a refresh that is about to clear a
            // rejected pair never removes this new sign-in.
            let _guard = self.store.update_guard().await;
            self.store.save(&credentials).await.map_err(store_error)?;
            self.credentials = Some(credentials);
        }
        Ok(response)
    }

    pub async fn me(&mut self) -> Result<Option<MarketMe>, MarketClientError> {
        if self.credentials.is_none() {
            return Ok(None);
        }
        self.refresh_if_needed().await?;
        let Some(credentials) = self.credentials.as_ref() else {
            return Ok(None);
        };
        let rejected = credentials.access_token.clone();
        let response = self.get_me(&rejected).await?;
        if response.status() != StatusCode::UNAUTHORIZED {
            return Ok(Some(decode_json(checked_response(response).await?).await?));
        }
        // A refresh anywhere on this sign-in (another task, or another process
        // on the profile) revokes the earlier access tokens of its family, so
        // a 401 here is first recovered from the store or with the refresh
        // token. Only a pair the service still rejects after that is cleared.
        self.refresh_serialized(Some(&rejected)).await?;
        let Some(credentials) = self.credentials.as_ref() else {
            return Ok(None);
        };
        let retried = credentials.access_token.clone();
        let response = self.get_me(&retried).await?;
        if response.status() == StatusCode::UNAUTHORIZED {
            let _guard = self.store.update_guard().await;
            let stored = self.store.load().await.map_err(store_error)?;
            if stored
                .as_ref()
                .is_some_and(|stored| stored.access_token == retried)
            {
                self.store.clear().await.map_err(store_error)?;
            }
            self.credentials = None;
            return Ok(None);
        }
        Ok(Some(decode_json(checked_response(response).await?).await?))
    }

    async fn get_me(&self, access_token: &str) -> Result<Response, MarketClientError> {
        self.client
            .get(self.url("/me"))
            .bearer_auth(access_token)
            .send()
            .await
            .map_err(transport_error)
    }

    pub async fn access_token(&mut self) -> Result<Option<String>, MarketClientError> {
        self.refresh_if_needed().await?;
        Ok(self
            .credentials
            .as_ref()
            .map(|credentials| credentials.access_token.clone()))
    }

    pub async fn logout(&mut self) -> Result<(), MarketClientError> {
        if let Some(credentials) = self.credentials.as_ref() {
            let response = self
                .client
                .post(self.url("/auth/logout"))
                .bearer_auth(&credentials.access_token)
                .send()
                .await
                .map_err(transport_error)?;
            if !response.status().is_success() && response.status() != StatusCode::UNAUTHORIZED {
                return Err(response_error(response).await);
            }
        }
        self.store.clear().await.map_err(store_error)?;
        self.credentials = None;
        Ok(())
    }

    async fn refresh_if_needed(&mut self) -> Result<(), MarketClientError> {
        match self.credentials.as_ref() {
            Some(credentials) if needs_refresh(credentials, chrono::Utc::now().timestamp()) => {
                self.refresh_serialized(None).await
            }
            _ => Ok(()),
        }
    }

    /// Brings the token pair up to date under the update guard. The pair is
    /// re-read from the store first: another task or process may already have
    /// rotated it (a refresh token is single use) or signed out. `rejected`
    /// is an access token the service answered 401 for; a stored pair that
    /// still holds it is refreshed even though it has not expired.
    async fn refresh_serialized(
        &mut self,
        rejected: Option<&str>,
    ) -> Result<(), MarketClientError> {
        let _guard = self.store.update_guard().await;
        let Some(current) = self.store.load().await.map_err(store_error)? else {
            self.credentials = None;
            return Ok(());
        };
        let now = chrono::Utc::now().timestamp();
        if current.refresh_expires_at <= now {
            self.store.clear().await.map_err(store_error)?;
            self.credentials = None;
            return Ok(());
        }
        let was_rejected = rejected.is_some_and(|token| token == current.access_token);
        if !was_rejected && !needs_refresh(&current, now) {
            self.credentials = Some(current);
            return Ok(());
        }
        let response = self
            .client
            .post(self.url("/auth/refresh"))
            .json(&serde_json::json!({ "refreshToken": current.refresh_token }))
            // The update guard is held across this request.
            .timeout(REFRESH_TIMEOUT)
            .send()
            .await
            .map_err(transport_error)?;
        if response.status() == StatusCode::UNAUTHORIZED {
            // The refresh token was spent elsewhere (a process that does not
            // take the update lock, such as an older build) or the sign-in was
            // revoked. A newer pair in the store is adopted; only the pair the
            // service rejected is cleared.
            let latest = self.store.load().await.map_err(store_error)?;
            match latest {
                Some(latest) if latest.refresh_token != current.refresh_token => {
                    log::info!(
                        "Account sign-in was refreshed by another process; using its tokens"
                    );
                    self.credentials = Some(latest);
                }
                Some(_) => {
                    log::warn!("Account refresh token was rejected; signing this profile out");
                    self.store.clear().await.map_err(store_error)?;
                    self.credentials = None;
                }
                None => self.credentials = None,
            }
            return Ok(());
        }
        let tokens: MarketTokenPair = decode_json(checked_response(response).await?).await?;
        let stored: StoredMarketCredentials = tokens.into();
        self.store.save(&stored).await.map_err(store_error)?;
        self.credentials = Some(stored);
        Ok(())
    }

    async fn json<T: DeserializeOwned>(
        &self,
        request: RequestBuilder,
    ) -> Result<T, MarketClientError> {
        let response = request.send().await.map_err(transport_error)?;
        decode_json(checked_response(response).await?).await
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.base_url, path)
    }
}
async fn checked_response(response: Response) -> Result<Response, MarketClientError> {
    if response.status().is_success() {
        Ok(response)
    } else {
        Err(response_error(response).await)
    }
}

async fn decode_json<T: DeserializeOwned>(response: Response) -> Result<T, MarketClientError> {
    response
        .json()
        .await
        .map_err(|error| local_error("invalid_market_response", error.to_string()))
}

async fn response_error(response: Response) -> MarketClientError {
    let status = response.status();
    match response.json::<ErrorEnvelope>().await {
        Ok(envelope) => MarketClientError {
            code: envelope.error.code,
            message: envelope.error.message,
            request_id: envelope.error.request_id,
        },
        Err(_) => local_error(
            "market_request_failed",
            format!("The GitHub account service returned HTTP {status}."),
        ),
    }
}

fn needs_refresh(credentials: &StoredMarketCredentials, now: i64) -> bool {
    credentials.refresh_expires_at <= now
        || credentials.access_expires_at <= now + ACCESS_REFRESH_MARGIN_SECS
}

fn store_error(error: String) -> MarketClientError {
    local_error("credential_store_unavailable", error)
}

fn transport_error(error: reqwest::Error) -> MarketClientError {
    local_error("account_unavailable", error.to_string())
}

fn local_error(code: impl Into<String>, message: impl Into<String>) -> MarketClientError {
    MarketClientError {
        code: code.into(),
        message: message.into(),
        request_id: None,
    }
}

impl std::fmt::Debug for MarketTokenPair {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AccountTokenPair").finish_non_exhaustive()
    }
}

#[cfg(test)]
mod profile_tests {
    use super::MarketMe;

    #[test]
    fn verified_email_is_optional_and_survives_host_projection() {
        let legacy = r#"{"user":{"githubId":42,"login":"alice","avatarUrl":""},"isAdmin":false}"#;
        let github: MarketMe = serde_json::from_str(legacy).unwrap();
        assert!(github.email.is_none());
        assert_eq!(github.user.identity_id().as_deref(), Some("42"));
        let email = r#"{"user":{"githubId":0,"accountId":"email-7","login":"user-internal","avatarUrl":""},"email":"alice@example.com","isAdmin":false}"#;
        let account: MarketMe = serde_json::from_str(email).unwrap();
        let projected = serde_json::to_value(&account).unwrap();
        assert_eq!(projected["email"], "alice@example.com");
        assert_eq!(account.user.identity_id().as_deref(), Some("email-7"));
        assert_eq!(account.user.login, "user-internal");
    }
}

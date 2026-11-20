//! Per-account mesh credentials for the OpenBitFun mesh (EasyTier).
//!
//! Every device of one account must join the same EasyTier network and
//! nobody else may. The issuer derives the network name and secret from the
//! verified account identity with a server-held key, so the credentials are
//! stable across devices and restarts without a database, and a caller can
//! only ever obtain the network of the account its token proves.
//!
//! Mesh membership is only the outer gate: OBP over the mesh still
//! authenticates every connection with the account-device key handshake.
//!
//! The standalone host (`openbitfun-mesh-issuer` in `src/apps/relay-server`)
//! verifies the OpenBitFun identity access token against the shared identity
//! authority, the same authority the relay login trusts, so the derived
//! account id equals the relay `user_id`.

use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::extract::State;
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use base64::Engine;
use hmac::{Hmac, Mac};
use serde::Serialize;
use sha2::Sha256;

use crate::identity::IdentityVerifier;

/// Network names the issuer hands out start with this prefix; the relay
/// node only forwards traffic of networks matching `obf-*`.
pub const MESH_NETWORK_PREFIX: &str = "obf-";
/// Wire version of the credential response.
pub const MESH_CREDENTIALS_VERSION: u32 = 1;
/// Path of the credential endpoint (behind the public edge).
pub const MESH_CREDENTIALS_PATH: &str = "/mesh/v1/credentials";
/// Path of the unauthenticated issuer description.
pub const MESH_INFO_PATH: &str = "/mesh/v1/info";
/// Capability the issuer advertises in its info document.
pub const MESH_CAPABILITY: &str = "mesh_credentials_v1";

const NAME_DOMAIN: &[u8] = b"OpenBitFun mesh network name v1\n";
const SECRET_DOMAIN: &[u8] = b"OpenBitFun mesh network secret v1\n";
/// Hex characters of the derived name (96 bits).
const NAME_HEX_CHARS: usize = 24;

/// The derived network of one account.
#[derive(Clone, PartialEq, Eq)]
pub struct AccountNetwork {
    pub network_name: String,
    pub network_secret: String,
}

impl std::fmt::Debug for AccountNetwork {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AccountNetwork")
            .field("network_name", &self.network_name)
            .field("network_secret", &"<redacted>")
            .finish()
    }
}

fn hmac(key: &[u8; 32], domain: &[u8], account_id: &str) -> [u8; 32] {
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(key).expect("HMAC accepts any key length");
    mac.update(domain);
    mac.update(account_id.as_bytes());
    mac.finalize().into_bytes().into()
}

/// The account's network: stable for one key and account, unrelated across
/// accounts, and not computable without the issuer key.
pub fn derive_account_network(key: &[u8; 32], account_id: &str) -> AccountNetwork {
    let name = hmac(key, NAME_DOMAIN, account_id);
    let hex: String = name.iter().map(|byte| format!("{byte:02x}")).collect();
    let secret = hmac(key, SECRET_DOMAIN, account_id);
    AccountNetwork {
        network_name: format!("{MESH_NETWORK_PREFIX}{}", &hex[..NAME_HEX_CHARS]),
        network_secret: base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(secret),
    }
}

/// Peer URLs clients may use: EasyTier `tcp://`, `udp://`, `ws://`, `wss://`
/// or `quic://` URLs without credentials, queries or quotes.
pub fn valid_peer_url(value: &str) -> bool {
    let Some((scheme, rest)) = value.split_once("://") else {
        return false;
    };
    matches!(scheme, "tcp" | "udp" | "ws" | "wss" | "quic")
        && !rest.is_empty()
        && value.len() <= 256
        && !value.contains(['@', '?', '#', '"', '\'', '\\', ' '])
        && value.chars().all(|c| c.is_ascii_graphic())
}

/// How one issuer is set up.
#[derive(Clone)]
pub struct MeshIssuerConfig {
    /// The 32-byte derivation key (server secret; never leaves the host).
    pub key: [u8; 32],
    /// The relay/discovery nodes, in preference order.
    pub peers: Vec<String>,
    /// The EasyTier release clients and nodes must run.
    pub easytier_version: String,
}

impl std::fmt::Debug for MeshIssuerConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MeshIssuerConfig")
            .field("key", &"<redacted>")
            .field("peers", &self.peers)
            .field("easytier_version", &self.easytier_version)
            .finish()
    }
}

/// `POST /mesh/v1/credentials` response.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CredentialsResponse<'a> {
    version: u32,
    network_name: &'a str,
    network_secret: &'a str,
    peers: &'a [String],
    easytier_version: &'a str,
    issued_at: i64,
}

#[derive(Clone)]
struct IssuerState {
    config: Arc<MeshIssuerConfig>,
    verifier: IdentityVerifier,
}

/// The issuer router (`/mesh/v1/info`, `/mesh/v1/credentials`).
pub fn mesh_issuer_router(config: MeshIssuerConfig) -> anyhow::Result<Router> {
    anyhow::ensure!(
        !config.peers.is_empty(),
        "the mesh issuer needs at least one peer URL"
    );
    for peer in &config.peers {
        anyhow::ensure!(valid_peer_url(peer), "invalid mesh peer URL: {peer}");
    }
    Ok(router_with_verifier(config, IdentityVerifier::new()?))
}

fn router_with_verifier(config: MeshIssuerConfig, verifier: IdentityVerifier) -> Router {
    Router::new()
        .route(MESH_INFO_PATH, get(info))
        .route(MESH_CREDENTIALS_PATH, post(credentials))
        .with_state(IssuerState {
            config: Arc::new(config),
            verifier,
        })
}

async fn info(State(state): State<IssuerState>) -> Response {
    no_store(
        Json(serde_json::json!({
            "version": MESH_CREDENTIALS_VERSION,
            "capabilities": [MESH_CAPABILITY],
            "easytierVersion": state.config.easytier_version,
            "networkPrefix": MESH_NETWORK_PREFIX,
        }))
        .into_response(),
    )
}

fn no_store(mut response: Response) -> Response {
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

fn refusal(status: StatusCode, code: &str, message: &str) -> Response {
    no_store(
        (
            status,
            Json(serde_json::json!({ "error": code, "message": message })),
        )
            .into_response(),
    )
}

async fn credentials(State(state): State<IssuerState>, headers: HeaderMap) -> Response {
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
            "sign in to OpenBitFun to join your device mesh",
        );
    };
    let identity = match state.verifier.verify(token).await {
        Ok(identity) => identity,
        Err(StatusCode::UNAUTHORIZED) => {
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
    let Some(account_id) = identity.identity_id() else {
        return refusal(
            StatusCode::FORBIDDEN,
            "unsupported_identity",
            "this account identity cannot join a device mesh",
        );
    };
    let network = derive_account_network(&state.config.key, &account_id);
    let issued_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs() as i64)
        .unwrap_or_default();
    tracing::info!("Mesh credentials issued: network={}", network.network_name);
    no_store(
        Json(CredentialsResponse {
            version: MESH_CREDENTIALS_VERSION,
            network_name: &network.network_name,
            network_secret: &network.network_secret,
            peers: &state.config.peers,
            easytier_version: &state.config.easytier_version,
            issued_at,
        })
        .into_response(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::Request;
    use tower::ServiceExt;

    const KEY: [u8; 32] = [42; 32];

    #[test]
    fn derivation_is_stable_per_account_and_unrelated_across_accounts() {
        let first = derive_account_network(&KEY, "12345");
        assert_eq!(first, derive_account_network(&KEY, "12345"));
        assert!(first.network_name.starts_with(MESH_NETWORK_PREFIX));
        assert_eq!(first.network_name.len(), MESH_NETWORK_PREFIX.len() + 24);
        assert_eq!(first.network_secret.len(), 43);
        // Pinned so a refactor cannot silently move every account to a new
        // network (devices on old and new builds must keep meeting).
        assert_eq!(first.network_name, "obf-ff0a7d2cfa2526e8cdf8e6a2");
        let other = derive_account_network(&KEY, "12346");
        assert_ne!(first.network_name, other.network_name);
        assert_ne!(first.network_secret, other.network_secret);
        let email = derive_account_network(&KEY, "email-12345");
        assert_ne!(first.network_name, email.network_name);
        let other_key = derive_account_network(&[7; 32], "12345");
        assert_ne!(first.network_name, other_key.network_name);
        assert!(!format!("{first:?}").contains(&first.network_secret));
    }

    #[test]
    fn peer_urls_are_restricted_to_easytier_transports() {
        assert!(valid_peer_url("tcp://190.92.203.184:11010"));
        assert!(valid_peer_url("wss://remote.openbitfun.com:443/mesh/et/"));
        assert!(!valid_peer_url("http://example.com"));
        assert!(!valid_peer_url("tcp://user:pw@example.com:1"));
        assert!(!valid_peer_url("tcp://example.com:1\"\nx"));
        assert!(!valid_peer_url("tcp://"));
    }

    async fn identity_authority(status: StatusCode, body: &'static str) -> String {
        let app = Router::new().route(
            "/me",
            get(move |headers: HeaderMap| async move {
                if headers
                    .get(header::AUTHORIZATION)
                    .and_then(|v| v.to_str().ok())
                    != Some("Bearer good-token")
                {
                    return (StatusCode::UNAUTHORIZED, "").into_response();
                }
                (status, body).into_response()
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await });
        format!("http://{addr}/me")
    }

    fn issuer(me_url: &str) -> Router {
        router_with_verifier(
            MeshIssuerConfig {
                key: KEY,
                peers: vec!["wss://remote.openbitfun.com:443/mesh/et/".into()],
                easytier_version: "2.6.4".into(),
            },
            IdentityVerifier::with_url(me_url).unwrap(),
        )
    }

    async fn post(router: Router, token: Option<&str>) -> (StatusCode, serde_json::Value) {
        let mut request = Request::post(MESH_CREDENTIALS_PATH);
        if let Some(token) = token {
            request = request.header(header::AUTHORIZATION, format!("Bearer {token}"));
        }
        let response = router
            .oneshot(request.body(Body::empty()).unwrap())
            .await
            .unwrap();
        let status = response.status();
        assert_eq!(
            response.headers().get(header::CACHE_CONTROL).unwrap(),
            "no-store"
        );
        let bytes = axum::body::to_bytes(response.into_body(), 65536)
            .await
            .unwrap();
        (status, serde_json::from_slice(&bytes).unwrap())
    }

    #[tokio::test]
    async fn issues_the_verified_accounts_network_only() {
        let me = identity_authority(
            StatusCode::OK,
            r#"{"user":{"githubId":12345,"login":"octo"}}"#,
        )
        .await;
        let (status, body) = post(issuer(&me), Some("good-token")).await;
        assert_eq!(status, StatusCode::OK, "{body}");
        let expected = derive_account_network(&KEY, "12345");
        assert_eq!(body["networkName"], expected.network_name);
        assert_eq!(body["networkSecret"], expected.network_secret);
        assert_eq!(body["version"], 1);
        assert_eq!(body["easytierVersion"], "2.6.4");
        assert_eq!(
            body["peers"],
            serde_json::json!(["wss://remote.openbitfun.com:443/mesh/et/"])
        );

        let (status, body) = post(issuer(&me), Some("forged-token")).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert!(body.get("networkSecret").is_none());
        let (status, _) = post(issuer(&me), None).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn fails_closed_when_the_identity_authority_is_unavailable() {
        let me = identity_authority(StatusCode::BAD_GATEWAY, "").await;
        let (status, body) = post(issuer(&me), Some("good-token")).await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        assert!(body.get("networkSecret").is_none());
    }

    #[tokio::test]
    async fn info_advertises_the_capability_without_secrets() {
        let response = issuer("http://127.0.0.1:9/me")
            .oneshot(Request::get(MESH_INFO_PATH).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), 65536)
            .await
            .unwrap();
        let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(body["capabilities"], serde_json::json!([MESH_CAPABILITY]));
        assert_eq!(body["networkPrefix"], MESH_NETWORK_PREFIX);
    }
}

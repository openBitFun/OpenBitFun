//! The server-only cloud agent registration route.
//!
//! `POST /api/internal/v1/cloud-agent` `{userId, deviceId, deviceName,
//! publicKey}` registers (or re-registers) the account's cloud agent row
//! (kind `cloud_agent`) and answers `{token}`, the row's device token.
//! `DELETE` with `{userId, deviceId}` removes the row and its tokens.
//!
//! Only `openbitfun-superagent` on the same host calls it:
//!
//! - It needs the bearer internal key. The key is read from
//!   `RELAY_CLOUD_AGENT_KEY_FILE` (64 hex characters, mode 0600) or
//!   `RELAY_CLOUD_AGENT_KEY`, and is never logged. Without a configured key
//!   the route answers 404, as if it did not exist.
//! - It refuses requests that came through a proxy (`X-Forwarded-For` or
//!   `X-Real-IP` present). nginx sets those, so a public request never
//!   reaches the handler, even with the key.
//!
//! Client logins can never write the `cloud_agent` kind
//! (`db::DeviceRow::upsert_with_metadata`).

use std::sync::Arc;

use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::{Extension, Json, Router};
use serde::Deserialize;
use sha2::{Digest, Sha256};

use crate::db::DbPool;
use crate::db::DeviceRow;

/// The route's own state: the directory database and the key.
#[derive(Clone)]
struct CloudAgentState {
    key: CloudAgentKey,
    db: Arc<DbPool>,
}

pub const CLOUD_AGENT_ROUTE: &str = "/api/internal/v1/cloud-agent";
const KEY_FILE_ENV: &str = "RELAY_CLOUD_AGENT_KEY_FILE";
const KEY_ENV: &str = "RELAY_CLOUD_AGENT_KEY";

/// The configured internal key (`None`: the route is off).
#[derive(Clone)]
pub struct CloudAgentKey(Arc<Option<String>>);

impl CloudAgentKey {
    pub fn new(key: Option<String>) -> Self {
        Self(Arc::new(key.filter(|key| !key.trim().is_empty())))
    }

    /// From the environment: the key file wins over the variable.
    pub fn from_env() -> Self {
        if let Ok(path) = std::env::var(KEY_FILE_ENV) {
            match read_key_file(&path) {
                Ok(key) => return Self::new(Some(key)),
                Err(error) => {
                    tracing::error!("Cloud agent route disabled: {error}");
                    return Self::new(None);
                }
            }
        }
        Self::new(std::env::var(KEY_ENV).ok())
    }

    fn matches(&self, presented: &str) -> bool {
        let Some(key) = self.0.as_ref() else {
            return false;
        };
        // Compare digests so the comparison time does not depend on where
        // the strings differ.
        let a = Sha256::digest(key.trim().as_bytes());
        let b = Sha256::digest(presented.trim().as_bytes());
        a.iter()
            .zip(b.iter())
            .fold(0u8, |acc, (x, y)| acc | (x ^ y))
            == 0
    }
}

fn read_key_file(path: &str) -> Result<String, String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(path)
            .map_err(|_| format!("cannot read the cloud agent key file {path}"))?
            .permissions()
            .mode();
        if mode & 0o077 != 0 {
            return Err(format!(
                "the cloud agent key file {path} must not be readable by group or others"
            ));
        }
    }
    let text = std::fs::read_to_string(path)
        .map_err(|_| format!("cannot read the cloud agent key file {path}"))?;
    let text = text.trim();
    if text.len() != 64 || !text.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("the cloud agent key file must hold exactly 64 hex characters".into());
    }
    Ok(text.to_ascii_lowercase())
}

/// Mergeable into any relay router (it carries its own state).
pub fn cloud_agent_router<S: Clone + Send + Sync + 'static>(
    key: CloudAgentKey,
    db: Arc<DbPool>,
) -> Router<S> {
    Router::new()
        .route(CLOUD_AGENT_ROUTE, post(register).delete(unregister))
        .layer(Extension(CloudAgentState { key, db }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RegisterRequest {
    user_id: String,
    device_id: String,
    device_name: String,
    public_key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UnregisterRequest {
    user_id: String,
    device_id: String,
}

fn refusal(status: StatusCode, code: &str) -> Response {
    (status, Json(serde_json::json!({ "error": code }))).into_response()
}

/// `Ok(())` when the caller may use the route.
fn authorize(key: &CloudAgentKey, headers: &HeaderMap) -> Result<(), Response> {
    if key.0.is_none() {
        return Err(StatusCode::NOT_FOUND.into_response());
    }
    if headers.contains_key("x-forwarded-for") || headers.contains_key("x-real-ip") {
        return Err(refusal(StatusCode::FORBIDDEN, "internal_only"));
    }
    let Some(presented) = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .filter(|value| !value.trim().is_empty())
    else {
        return Err(refusal(StatusCode::UNAUTHORIZED, "unauthorized"));
    };
    if !key.matches(presented) {
        return Err(refusal(StatusCode::FORBIDDEN, "forbidden"));
    }
    Ok(())
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
}

fn valid_public_key(value: &str) -> bool {
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD
        .decode(value)
        .is_ok_and(|bytes| bytes.len() == 32)
}

async fn register(
    Extension(state): Extension<CloudAgentState>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Response {
    if let Err(response) = authorize(&state.key, &headers) {
        return response;
    }
    let Ok(request) = serde_json::from_slice::<RegisterRequest>(&body) else {
        return refusal(StatusCode::BAD_REQUEST, "invalid_request");
    };
    if !valid_id(&request.user_id)
        || !valid_id(&request.device_id)
        || !request.device_id.starts_with("cloud-")
        || request.device_name.is_empty()
        || request.device_name.len() > 64
        || !valid_public_key(&request.public_key)
    {
        return refusal(StatusCode::BAD_REQUEST, "invalid_request");
    }
    if let Err(error) = crate::db::UserRow::find_by_user_id(&state.db, &request.user_id)
        .await
        .and_then(|row| row.ok_or_else(|| anyhow::anyhow!("unknown account")))
    {
        tracing::info!("Cloud agent registration refused: {error}");
        return refusal(StatusCode::NOT_FOUND, "unknown_account");
    }
    match DeviceRow::register_cloud_agent(
        &state.db,
        &request.user_id,
        &request.device_id,
        &request.device_name,
        &request.public_key,
    )
    .await
    {
        Ok(token) => {
            tracing::info!("Cloud agent row registered: device={}", request.device_id);
            Json(serde_json::json!({ "token": token.token, "expiresAt": token.expires_at }))
                .into_response()
        }
        Err(error) => {
            tracing::warn!(
                "Cloud agent registration failed: device={}, error={}",
                request.device_id,
                error
            );
            refusal(StatusCode::CONFLICT, "device_id_conflict")
        }
    }
}

async fn unregister(
    Extension(state): Extension<CloudAgentState>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Response {
    if let Err(response) = authorize(&state.key, &headers) {
        return response;
    }
    let Ok(request) = serde_json::from_slice::<UnregisterRequest>(&body) else {
        return refusal(StatusCode::BAD_REQUEST, "invalid_request");
    };
    if !valid_id(&request.user_id) || !valid_id(&request.device_id) {
        return refusal(StatusCode::BAD_REQUEST, "invalid_request");
    }
    match DeviceRow::unregister_cloud_agent(&state.db, &request.user_id, &request.device_id).await {
        Ok(true) => {
            tracing::info!("Cloud agent row removed: device={}", request.device_id);
            StatusCode::NO_CONTENT.into_response()
        }
        Ok(false) => refusal(StatusCode::NOT_FOUND, "not_found"),
        Err(_) => refusal(StatusCode::CONFLICT, "not_a_cloud_agent"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::Request;
    use tower::ServiceExt;

    const KEY: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    async fn app(key: Option<&str>) -> (Router, Arc<crate::db::DbPool>) {
        let db = Arc::new(crate::db::connect(":memory:").await.unwrap());
        crate::db::UserRow::create(&db, "u1", "alice")
            .await
            .unwrap();
        let router: Router =
            cloud_agent_router(CloudAgentKey::new(key.map(str::to_string)), Arc::clone(&db));
        (router, db)
    }

    async fn send(
        router: &Router,
        method: &str,
        bearer: Option<&str>,
        proxied: bool,
        body: serde_json::Value,
    ) -> (StatusCode, serde_json::Value) {
        let mut request = Request::builder()
            .method(method)
            .uri(CLOUD_AGENT_ROUTE)
            .header("content-type", "application/json");
        if let Some(bearer) = bearer {
            request = request.header("authorization", format!("Bearer {bearer}"));
        }
        if proxied {
            request = request.header("x-forwarded-for", "203.0.113.9");
        }
        let response = router
            .clone()
            .oneshot(request.body(Body::from(body.to_string())).unwrap())
            .await
            .unwrap();
        let status = response.status();
        let bytes = axum::body::to_bytes(response.into_body(), 1 << 20)
            .await
            .unwrap();
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null),
        )
    }

    fn register_body() -> serde_json::Value {
        use base64::Engine as _;
        serde_json::json!({
            "userId": "u1",
            "deviceId": "cloud-0123456789abcdef01234567",
            "deviceName": "OpenBitFun",
            "publicKey": base64::engine::general_purpose::STANDARD.encode([7u8; 32]),
        })
    }

    #[tokio::test]
    async fn the_route_needs_the_internal_key_and_a_direct_caller() {
        let (router, _) = app(Some(KEY)).await;
        let (status, _) = send(&router, "POST", None, false, register_body()).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        let (status, _) = send(&router, "POST", Some("wrong"), false, register_body()).await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        let (status, body) = send(&router, "POST", Some(KEY), true, register_body()).await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        assert_eq!(body["error"], "internal_only");
        // Without a configured key the route does not exist.
        let (off, _) = app(None).await;
        let (status, _) = send(&off, "POST", Some(KEY), false, register_body()).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn register_and_unregister_round_trip() {
        let (router, db) = app(Some(KEY)).await;
        let (status, body) = send(&router, "POST", Some(KEY), false, register_body()).await;
        assert_eq!(status, StatusCode::OK);
        let token = body["token"].as_str().unwrap().to_string();
        assert!(crate::db::AuthToken::find(&db, &token)
            .await
            .unwrap()
            .is_some());
        // Idempotent with the same key.
        let (_, again) = send(&router, "POST", Some(KEY), false, register_body()).await;
        assert_eq!(again["token"], token.as_str());
        let rows = DeviceRow::list_by_user(&db, "u1").await.unwrap();
        assert_eq!(
            rows[0].device_kind.as_deref(),
            Some(crate::db::DEVICE_KIND_CLOUD_AGENT)
        );
        // Unknown accounts and malformed requests are refused.
        let mut stranger = register_body();
        stranger["userId"] = "nobody".into();
        assert_eq!(
            send(&router, "POST", Some(KEY), false, stranger).await.0,
            StatusCode::NOT_FOUND
        );
        let mut bad = register_body();
        bad["deviceId"] = "laptop".into();
        assert_eq!(
            send(&router, "POST", Some(KEY), false, bad).await.0,
            StatusCode::BAD_REQUEST
        );
        let remove =
            serde_json::json!({ "userId": "u1", "deviceId": "cloud-0123456789abcdef01234567" });
        assert_eq!(
            send(&router, "DELETE", Some(KEY), false, remove.clone())
                .await
                .0,
            StatusCode::NO_CONTENT
        );
        assert!(crate::db::AuthToken::find(&db, &token)
            .await
            .unwrap()
            .is_none());
        assert!(DeviceRow::list_by_user(&db, "u1").await.unwrap().is_empty());
        assert_eq!(
            send(&router, "DELETE", Some(KEY), false, remove).await.0,
            StatusCode::NOT_FOUND
        );
    }
}

//! OBP over the account mesh: the `account-device` listener.
//!
//! The EasyTier sidecar runs without a TUN device, so inbound mesh TCP for
//! this device's virtual IP arrives at `127.0.0.1:<port>`, admitted only for
//! the OBP mesh port range. The listener binds the first free port of that
//! range on loopback, speaks TLS with the backend's self-signed identity, and
//! accepts a WebSocket upgrade only with a valid account-device handshake
//! (`openbitfun_mesh_service::handshake`): the client proves it holds the
//! private key of a device in this account's directory, bound to the TLS
//! certificate it saw, and the `101` response carries the server's proof.
//! Connections get the `account-device` scope (registry-driven allowlist,
//! owner-only events withheld) and the same credit/ack, coalescing and resume
//! as every other OBP connection.
//!
//! The same listener serves phones and browsers that joined the account mesh
//! with the EasyTier app: requests without the device handshake get the LAN
//! routes (`http::ListenerKind::Mesh`: the web UI bundle, QR pairing and the
//! `paired-client` scope), so a paired phone reaches this device from
//! anywhere without the old relay.

use std::collections::HashMap;
use std::future::Future;
use std::net::{Ipv4Addr, SocketAddr};
use std::pin::Pin;
use std::sync::Arc;

use axum::extract::WebSocketUpgrade;
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use openbitfun_mesh_service::handshake::{self, Claims, Role};
use openbitfun_mesh_service::{MESH_OBP_PORT_FIRST, MESH_OBP_PORT_LAST};

use super::connection::{self, ConnectionContext};
use super::protocol::MESH_SERVER_CAPABILITIES;
use super::scope::Scope;
use super::{lock, ObpServer, RunningListener, StopReason, OBP_PROTOCOL_VERSION};

/// A boxed future resolving a device pair key.
pub type PairKeyFuture<'a> = Pin<Box<dyn Future<Output = Result<[u8; 32], String>> + Send + 'a>>;

/// The same-account device directory, as the mesh handshake needs it.
pub trait MeshAuthority: Send + Sync + 'static {
    /// This device's account device id (`None` while signed out).
    fn local_device_id(&self) -> Option<String>;
    /// The X25519 pair key shared with `device_id`; an error when the device
    /// is not in this account's directory.
    fn pair_key<'a>(&'a self, device_id: &'a str) -> PairKeyFuture<'a>;
}

/// Mesh listener state kept on the server.
#[derive(Default)]
pub(super) struct MeshListenerState {
    listener: std::sync::Mutex<Option<RunningListener>>,
    authority: std::sync::Mutex<Option<Arc<dyn MeshAuthority>>>,
    fingerprint: std::sync::Mutex<Option<String>>,
    /// Accepted handshake nonces until they can no longer pass the clock check.
    nonces: std::sync::Mutex<HashMap<String, u64>>,
}

/// `/obp/mesh/info`: what a controller needs to pick this device's port and
/// protocol before it authenticates (no secrets).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MeshInfo {
    pub device_id: String,
    pub protocol: u32,
    pub capabilities: Vec<String>,
    pub backend_version: String,
    pub fingerprint: String,
}

impl ObpServer {
    /// Starts the mesh listener on the first free port of the OBP mesh range
    /// (idempotent). Returns its address.
    pub async fn start_mesh(
        self: &Arc<Self>,
        authority: Arc<dyn MeshAuthority>,
    ) -> Result<SocketAddr, String> {
        *lock(&self.mesh.authority) = Some(authority);
        if let Some(addr) = self.mesh_addr() {
            return Ok(addr);
        }
        let identity = lock(&self.store).lan_identity()?;
        let config = super::tls::server_config(&identity)?;
        let mut bound = None;
        for port in MESH_OBP_PORT_FIRST..=MESH_OBP_PORT_LAST {
            if let Ok(listener) = tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, port)).await {
                bound = Some(listener);
                break;
            }
        }
        let listener = bound.ok_or_else(|| {
            format!(
                "mesh_ports_busy: every OBP mesh port ({MESH_OBP_PORT_FIRST}-{MESH_OBP_PORT_LAST}) is in use on this machine"
            )
        })?;
        let addr = listener
            .local_addr()
            .map_err(|error| format!("failed to read the mesh listener address: {error}"))?;
        let listener = super::tls::TlsListener::new(listener, config)
            .map_err(|error| format!("failed to start TLS on the mesh listener: {error}"))?;
        let (shutdown, stopped) = tokio::sync::oneshot::channel::<()>();
        let router = super::http::router(
            Arc::clone(self),
            super::http::ListenerKind::Mesh { port: addr.port() },
        );
        tokio::spawn(async move {
            let served = axum::serve(listener, router)
                .with_graceful_shutdown(async move {
                    let _ = stopped.await;
                })
                .await;
            if let Err(error) = served {
                log::warn!("OBP mesh listener stopped with an error: {}", error);
            }
        });
        *lock(&self.mesh.fingerprint) = Some(identity.fingerprint.clone());
        *lock(&self.mesh.listener) = Some(RunningListener {
            addr,
            shutdown: Some(shutdown),
        });
        log::info!(
            "OBP mesh listener started: port={}, fingerprint={}",
            addr.port(),
            identity.fingerprint
        );
        Ok(addr)
    }

    /// The mesh listener's address, while it runs.
    pub fn mesh_addr(&self) -> Option<SocketAddr> {
        lock(&self.mesh.listener)
            .as_ref()
            .map(|listener| listener.addr)
    }

    /// The mesh listener's certificate fingerprint, while it runs.
    pub fn mesh_fingerprint(&self) -> Option<String> {
        self.mesh_addr()?;
        lock(&self.mesh.fingerprint).clone()
    }

    /// Stops the mesh listener and closes every `account-device` connection
    /// and every phone or browser served on it (sign-out, account switch,
    /// shutdown).
    pub fn stop_mesh(&self) {
        if let Some(mut listener) = lock(&self.mesh.listener).take() {
            listener.stop();
            log::info!("OBP mesh listener stopped");
        }
        *lock(&self.mesh.authority) = None;
        for entry in lock(&self.connections).values() {
            if entry.via_mesh {
                entry.stop.send_replace(Some(StopReason::Shutdown));
            }
        }
    }

    fn mesh_info(&self) -> Option<MeshInfo> {
        let authority = lock(&self.mesh.authority).clone()?;
        Some(MeshInfo {
            device_id: authority.local_device_id()?,
            protocol: OBP_PROTOCOL_VERSION,
            capabilities: MESH_SERVER_CAPABILITIES
                .iter()
                .map(|capability| capability.to_string())
                .collect(),
            backend_version: self.backend.info()["version"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
            fingerprint: lock(&self.mesh.fingerprint).clone()?,
        })
    }

    /// Records `nonce` as used; false when it was already used.
    pub(super) fn consume_mesh_nonce(&self, nonce: &str, now: u64) -> bool {
        let mut nonces = lock(&self.mesh.nonces);
        nonces.retain(|_, expires| *expires > now);
        if nonces.contains_key(nonce) {
            return false;
        }
        nonces.insert(
            nonce.to_string(),
            now + 2 * handshake::MAX_CLOCK_SKEW_MS + 1_000,
        );
        true
    }
}

fn refusal(status: StatusCode, code: &str, message: &str) -> Response {
    let mut response = (
        status,
        Json(serde_json::json!({ "error": code, "message": message })),
    )
        .into_response();
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

/// `/obp/mesh/info` (mounted by `http::router` for the mesh listener).
pub(super) fn mesh_info_response(server: &ObpServer) -> Response {
    match server.mesh_info() {
        Some(info) => Json(info).into_response(),
        None => refusal(
            StatusCode::SERVICE_UNAVAILABLE,
            "mesh_signed_out",
            "this device is not signed in to an account mesh",
        ),
    }
}

fn header_text<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

/// The verified client device and the server proof for its `101`.
async fn authenticate(
    server: &ObpServer,
    headers: &HeaderMap,
) -> Result<(String, String), Response> {
    if headers.contains_key(header::ORIGIN) {
        // Only native clients speak the device handshake; a browser page
        // must never reach this listener.
        return Err(refusal(
            StatusCode::FORBIDDEN,
            "bad_origin",
            "browser requests are refused on the mesh listener",
        ));
    }
    let unauthorized = |message: &str| refusal(StatusCode::UNAUTHORIZED, "unauthorized", message);
    let proof = header_text(headers, header::AUTHORIZATION.as_str())
        .and_then(|value| value.strip_prefix(handshake::AUTH_SCHEME))
        .map(str::trim)
        .ok_or_else(|| unauthorized("the account-device handshake is required"))?;
    let device = header_text(headers, handshake::HEADER_DEVICE)
        .filter(|id| handshake::valid_device_id(id))
        .ok_or_else(|| unauthorized("missing or invalid client device id"))?;
    let target = header_text(headers, handshake::HEADER_TARGET)
        .ok_or_else(|| unauthorized("missing target device id"))?;
    let time_ms: u64 = header_text(headers, handshake::HEADER_TIME)
        .and_then(|value| value.parse().ok())
        .ok_or_else(|| unauthorized("missing handshake time"))?;
    let nonce = header_text(headers, handshake::HEADER_NONCE)
        .filter(|nonce| handshake::valid_nonce(nonce))
        .ok_or_else(|| unauthorized("missing or invalid handshake nonce"))?;

    let authority = lock(&server.mesh.authority).clone().ok_or_else(|| {
        refusal(
            StatusCode::SERVICE_UNAVAILABLE,
            "mesh_signed_out",
            "this device is not signed in to an account mesh",
        )
    })?;
    let local = authority.local_device_id().ok_or_else(|| {
        refusal(
            StatusCode::SERVICE_UNAVAILABLE,
            "mesh_signed_out",
            "this device is not signed in to an account mesh",
        )
    })?;
    if target != local {
        return Err(refusal(
            StatusCode::MISDIRECTED_REQUEST,
            "wrong_device",
            "this mesh address belongs to another device",
        ));
    }
    let now = super::store::now_ms();
    if now.abs_diff(time_ms) > handshake::MAX_CLOCK_SKEW_MS {
        return Err(unauthorized(
            "the handshake time is too far from this device's clock; check the system time",
        ));
    }
    let fingerprint = lock(&server.mesh.fingerprint)
        .clone()
        .ok_or_else(|| unauthorized("the mesh listener is not ready"))?;
    let pair_key = authority.pair_key(device).await.map_err(|error| {
        log::warn!(
            "OBP mesh handshake refused: device={}, error={}",
            device,
            error
        );
        refusal(
            StatusCode::FORBIDDEN,
            "not_account_device",
            "the device is not part of this account",
        )
    })?;
    let key = handshake::handshake_key(&pair_key);
    let claims = Claims {
        client_device_id: device.to_string(),
        server_device_id: local,
        cert_fingerprint: fingerprint,
        time_ms,
        nonce: nonce.to_string(),
    };
    if !handshake::verify(&key, Role::Client, &claims, proof) {
        log::warn!("OBP mesh handshake proof rejected: device={}", device);
        return Err(unauthorized("the account-device proof is invalid"));
    }
    if !server.consume_mesh_nonce(nonce, now) {
        return Err(unauthorized("the handshake was already used"));
    }
    Ok((
        device.to_string(),
        handshake::prove(&key, Role::Server, &claims),
    ))
}

/// The `account-device` upgrade (`http::upgrade` routes requests carrying
/// `Authorization: ObpMesh …` here).
pub(super) async fn account_device_upgrade(
    server: Arc<ObpServer>,
    headers: HeaderMap,
    upgrade: WebSocketUpgrade,
) -> Response {
    let (device_id, server_proof) = match authenticate(&server, &headers).await {
        Ok(verified) => verified,
        Err(response) => return response,
    };
    let scope = Scope::AccountDevice {
        device_id: device_id.clone(),
    };
    let (id, stop) = server.register_connection(scope.clone());
    let context = ConnectionContext {
        backend: Arc::clone(&server.backend),
        scope,
        instance_id: server.instance_id.clone(),
        registry_digest: server.registry_digest.clone(),
        limits: server.options.limits.clone(),
        stop,
    };
    log::info!("OBP mesh connection accepted: device={}", device_id);
    let served = Arc::clone(&server);
    let mut response =
        upgrade
            .max_message_size(32 * 1024 * 1024)
            .on_upgrade(move |socket| async move {
                connection::serve(socket, context).await;
                served.unregister_connection(id);
            });
    if let Ok(value) = HeaderValue::from_str(&server_proof) {
        response
            .headers_mut()
            .insert(handshake::HEADER_SERVER_PROOF, value);
    }
    response
}

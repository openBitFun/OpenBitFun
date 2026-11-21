//! OBP over the account device network (OpenBitFun Link): the
//! `account-device` listener.
//!
//! Link runs in this process (`openbitfun-link`): inbound virtual TCP streams
//! for this device's OBP port arrive from the node's userspace stack; nothing
//! listens on a host socket. The listener speaks TLS with the backend's
//! self-signed identity over those streams, and accepts a WebSocket upgrade
//! only with a valid account-device handshake
//! (`openbitfun_link::handshake`): the client proves it holds the private key
//! of a device in this account's directory, bound to the TLS certificate it
//! saw, and the `101` response carries the server's proof. Connections get
//! the `account-device` scope (registry-driven allowlist, owner-only events
//! withheld) and the same credit/ack, coalescing and resume as every other
//! OBP connection.
//!
//! Requests without the device handshake get the paired-client routes
//! (`http::ListenerKind::Mesh`: the web UI bundle, QR pairing and the
//! `paired-client` scope) for phones and browsers on the device network.
//!
//! A stream's first byte picks one of three openings on the same port: 0x16
//! (a TLS `ClientHello`: everything above), `O` (the end-to-end channel of
//! browsers behind the server gateway, `e2e`), `G` (a plain
//! `GET /obp-ui/v1/<sha256>`: the server's pool fetching web UI bundle files
//! by hash, `ui_fetch`).

use std::collections::HashMap;
use std::future::Future;
#[cfg(any(test, feature = "test-support"))]
use std::net::Ipv4Addr;
use std::net::SocketAddr;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use axum::extract::WebSocketUpgrade;
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use openbitfun_link::handshake::{self, Claims, Role};
use tokio::sync::mpsc;
use tokio_rustls::server::TlsStream;
use tokio_rustls::TlsAcceptor;

use super::connection::{self, ConnectionContext};
use super::e2e;
use super::scope::Scope;
use super::{lock, ObpServer, RunningListener, StopReason, OBP_PROTOCOL_VERSION};
use crate::authority::{MeshAuthority, MeshInfo, MeshIo};

/// A boxed future yielding the next inbound mesh stream.
pub type MeshAcceptFuture<'a> =
    Pin<Box<dyn Future<Output = Option<(Box<dyn MeshIo>, SocketAddr)>> + Send + 'a>>;

/// Where inbound OBP streams of the device network come from.
pub trait MeshIncoming: Send + Sync + 'static {
    /// The next inbound stream and its peer's (virtual) address; `None` once
    /// the network stopped for good.
    fn accept(&self) -> MeshAcceptFuture<'_>;
    /// The OBP port this device listens on in the network, once bound.
    fn port(&self) -> Option<u16>;
}

/// How long a client may take to finish the TLS handshake.
pub(super) const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);
/// Handshaken connections waiting for the HTTP server to take them.
const ACCEPT_QUEUE: usize = 64;

/// An axum listener over a [`MeshIncoming`] source: TLS handshakes finish
/// concurrently (a slow client never blocks others).
struct MeshTlsListener {
    local: SocketAddr,
    ready: mpsc::Receiver<(TlsStream<Box<dyn MeshIo>>, SocketAddr)>,
    accept_task: tokio::task::JoinHandle<()>,
}

/// Takes the streams that open with the end-to-end channel's magic instead of
/// a TLS `ClientHello` (browser controllers through the server gateway), and
/// the plain web UI fetches by hash (the server's pool).
type E2eHandler = Arc<dyn Fn(Box<dyn MeshIo>, SocketAddr) + Send + Sync>;

/// The non-TLS openings of a mesh stream.
#[derive(Clone)]
struct PlainHandlers {
    e2e: E2eHandler,
    ui_fetch: E2eHandler,
}

impl MeshTlsListener {
    fn new(
        incoming: Arc<dyn MeshIncoming>,
        local: SocketAddr,
        config: Arc<rustls::ServerConfig>,
        plain: PlainHandlers,
    ) -> Self {
        let acceptor = TlsAcceptor::from(config);
        let (sender, ready) = mpsc::channel(ACCEPT_QUEUE);
        let accept_task = tokio::spawn(async move {
            while let Some((stream, peer)) = incoming.accept().await {
                if sender.is_closed() {
                    return;
                }
                let acceptor = acceptor.clone();
                let sender = sender.clone();
                let plain = plain.clone();
                tokio::spawn(async move {
                    let stream =
                        match tokio::time::timeout(HANDSHAKE_TIMEOUT, e2e::sniff(stream)).await {
                            Ok(Ok(e2e::Sniffed::E2e(stream))) => {
                                (plain.e2e)(stream, peer);
                                return;
                            }
                            Ok(Ok(e2e::Sniffed::UiFetch(stream))) => {
                                (plain.ui_fetch)(stream, peer);
                                return;
                            }
                            Ok(Ok(e2e::Sniffed::Tls(stream))) => stream,
                            Ok(Err(error)) => {
                                log::debug!(
                                "OBP mesh stream closed before its first bytes: peer={}, error={}",
                                peer,
                                error
                            );
                                return;
                            }
                            Err(_) => {
                                log::debug!("OBP mesh stream sent nothing: peer={}", peer);
                                return;
                            }
                        };
                    match tokio::time::timeout(HANDSHAKE_TIMEOUT, acceptor.accept(stream)).await {
                        Ok(Ok(tls)) => {
                            let _ = sender.send((tls, peer)).await;
                        }
                        Ok(Err(error)) => log::debug!(
                            "OBP mesh TLS handshake failed: peer={}, error={}",
                            peer,
                            error
                        ),
                        Err(_) => log::debug!("OBP mesh TLS handshake timed out: peer={}", peer),
                    }
                });
            }
        });
        Self {
            local,
            ready,
            accept_task,
        }
    }
}

impl Drop for MeshTlsListener {
    fn drop(&mut self) {
        self.accept_task.abort();
    }
}

impl axum::serve::Listener for MeshTlsListener {
    type Io = TlsStream<Box<dyn MeshIo>>;
    type Addr = SocketAddr;

    async fn accept(&mut self) -> (Self::Io, Self::Addr) {
        match self.ready.recv().await {
            Some(accepted) => accepted,
            // The source ended (the network stopped); wait to be dropped.
            None => std::future::pending().await,
        }
    }

    fn local_addr(&self) -> std::io::Result<Self::Addr> {
        Ok(self.local)
    }
}

/// Loopback TCP as a mesh source (tests: stands in for the device network).
#[cfg(any(test, feature = "test-support"))]
pub struct LoopbackIncoming {
    listener: tokio::net::TcpListener,
    port: u16,
}

#[cfg(any(test, feature = "test-support"))]
impl LoopbackIncoming {
    /// Binds the first free port of the OBP mesh range on loopback.
    pub async fn bind() -> Result<Self, String> {
        for port in openbitfun_link::MESH_OBP_PORT_FIRST..=openbitfun_link::MESH_OBP_PORT_LAST {
            if let Ok(listener) = tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, port)).await {
                return Ok(Self { listener, port });
            }
        }
        Err("mesh_ports_busy: every OBP mesh port is in use on this machine".to_string())
    }
}

#[cfg(any(test, feature = "test-support"))]
impl MeshIncoming for LoopbackIncoming {
    fn accept(&self) -> MeshAcceptFuture<'_> {
        Box::pin(async move {
            loop {
                match self.listener.accept().await {
                    Ok((stream, peer)) => return Some((Box::new(stream) as Box<dyn MeshIo>, peer)),
                    Err(_) => tokio::time::sleep(Duration::from_millis(50)).await,
                }
            }
        })
    }

    fn port(&self) -> Option<u16> {
        Some(self.port)
    }
}

/// Mesh listener state kept on the server.
#[derive(Default)]
pub(super) struct MeshListenerState {
    listener: std::sync::Mutex<Option<RunningListener>>,
    incoming: std::sync::Mutex<Option<Arc<dyn MeshIncoming>>>,
    authority: std::sync::Mutex<Option<Arc<dyn MeshAuthority>>>,
    fingerprint: std::sync::Mutex<Option<String>>,
    /// Accepted handshake nonces until they can no longer pass the clock check.
    nonces: std::sync::Mutex<HashMap<String, u64>>,
}

impl ObpServer {
    /// Starts the mesh listener on loopback TCP (tests: stands in for the
    /// device network). Returns its address.
    #[cfg(any(test, feature = "test-support"))]
    pub async fn start_mesh(
        self: &Arc<Self>,
        authority: Arc<dyn MeshAuthority>,
    ) -> Result<SocketAddr, String> {
        if let Some(addr) = self.mesh_addr() {
            *lock(&self.mesh.authority) = Some(authority);
            return Ok(addr);
        }
        let incoming = LoopbackIncoming::bind().await?;
        let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, incoming.port));
        self.start_mesh_with(authority, Arc::new(incoming), addr)
            .await
    }

    /// Starts the mesh listener over the device network's inbound streams
    /// (idempotent: a running listener keeps its source and only takes the
    /// new authority). `local` is reported until the source names its port.
    pub async fn start_mesh_with(
        self: &Arc<Self>,
        authority: Arc<dyn MeshAuthority>,
        incoming: Arc<dyn MeshIncoming>,
        local: SocketAddr,
    ) -> Result<SocketAddr, String> {
        *lock(&self.mesh.authority) = Some(authority);
        if let Some(addr) = self.mesh_addr() {
            return Ok(addr);
        }
        let identity = lock(&self.store).lan_identity()?;
        let config = super::tls::server_config(&identity)?;
        let weak = Arc::downgrade(self);
        let e2e: E2eHandler = Arc::new(move |stream, peer| {
            if let Some(server) = weak.upgrade() {
                tokio::spawn(e2e::serve(server, stream, peer));
            }
        });
        let weak = Arc::downgrade(self);
        let ui_fetch: E2eHandler = Arc::new(move |stream, peer| {
            if let Some(server) = weak.upgrade() {
                tokio::spawn(super::ui_fetch::serve(server, stream, peer));
            }
        });
        // Load (and check) the web UI bundle now, so the first `hello`
        // already carries its id and the first fetch does not wait.
        let source = Arc::clone(&self.ui_bundle);
        tokio::task::spawn_blocking(move || {
            let _ = source.current();
        });
        let listener = MeshTlsListener::new(
            Arc::clone(&incoming),
            local,
            config,
            PlainHandlers { e2e, ui_fetch },
        );
        let (shutdown, stopped) = tokio::sync::oneshot::channel::<()>();
        let router = super::http::router(
            Arc::clone(self),
            super::http::ListenerKind::Mesh { port: local.port() },
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
        *lock(&self.mesh.incoming) = Some(incoming);
        *lock(&self.mesh.listener) = Some(RunningListener {
            addr: local,
            shutdown: Some(shutdown),
        });
        log::info!(
            "OBP mesh listener started: port={}, fingerprint={}",
            local.port(),
            identity.fingerprint
        );
        Ok(local)
    }

    /// The mesh listener's address, while it runs (its port is the one the
    /// device network bound).
    pub fn mesh_addr(&self) -> Option<SocketAddr> {
        let addr = lock(&self.mesh.listener)
            .as_ref()
            .map(|listener| listener.addr)?;
        let port = lock(&self.mesh.incoming)
            .as_ref()
            .and_then(|incoming| incoming.port())
            .unwrap_or(addr.port());
        Some(SocketAddr::new(addr.ip(), port))
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
        *lock(&self.mesh.incoming) = None;
        *lock(&self.mesh.authority) = None;
        for entry in lock(&self.connections).values() {
            if entry.via_mesh {
                entry.stop.send_replace(Some(StopReason::Shutdown));
            }
        }
    }

    pub(super) fn mesh_info(&self) -> Option<MeshInfo> {
        let authority = lock(&self.mesh.authority).clone()?;
        Some(MeshInfo {
            device_id: authority.local_device_id()?,
            protocol: OBP_PROTOCOL_VERSION,
            capabilities: connection::mesh_capabilities(self.backend.as_ref())
                .iter()
                .map(|capability| capability.to_string())
                .collect(),
            backend_version: self.backend.info()["version"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
            fingerprint: lock(&self.mesh.fingerprint).clone()?,
            fleet_load: self
                .serves_fleet()
                .then(|| u32::try_from(self.fleet_load()).unwrap_or(u32::MAX)),
        })
    }

    /// Whether this host attaches fleet clients (a fleet mux; feature
    /// `fleet`).
    fn serves_fleet(&self) -> bool {
        #[cfg(feature = "fleet")]
        {
            self.backend.fleet_mux().is_some()
        }
        #[cfg(not(feature = "fleet"))]
        {
            false
        }
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

/// Why a device handshake was refused (HTTP status, stable code, sentence).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct HandshakeRefusal {
    pub status: StatusCode,
    pub code: &'static str,
    pub message: &'static str,
}

impl HandshakeRefusal {
    const fn new(status: StatusCode, code: &'static str, message: &'static str) -> Self {
        Self {
            status,
            code,
            message,
        }
    }

    fn unauthorized(message: &'static str) -> Self {
        Self::new(StatusCode::UNAUTHORIZED, "unauthorized", message)
    }

    fn signed_out() -> Self {
        Self::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "mesh_signed_out",
            "this device is not signed in to an account mesh",
        )
    }

    fn into_response(self) -> Response {
        refusal(self.status, self.code, self.message)
    }
}

/// What a client claims in its device handshake (the upgrade headers, or the
/// end-to-end channel's hello). `fingerprint` is what the proof binds the
/// session to: the TLS certificate the client saw (`None`: this listener's),
/// or the end-to-end channel's ephemeral key.
pub(super) struct ClientClaims<'a> {
    pub device: &'a str,
    pub target: &'a str,
    pub time_ms: u64,
    pub nonce: &'a str,
    pub fingerprint: Option<String>,
    pub proof: &'a str,
}

/// A verified client: its device id, the handshake key, the claims both
/// proofs cover, and the scope its directory row kind selects.
pub(super) struct VerifiedClient {
    pub device: String,
    pub key: [u8; 32],
    pub claims: Claims,
    pub scope: Scope,
}

/// Verifies a client's device proof against this account's directory.
pub(super) async fn verify_client(
    server: &ObpServer,
    claims: ClientClaims<'_>,
) -> Result<VerifiedClient, HandshakeRefusal> {
    if !handshake::valid_device_id(claims.device) {
        return Err(HandshakeRefusal::unauthorized(
            "missing or invalid client device id",
        ));
    }
    if !handshake::valid_nonce(claims.nonce) {
        return Err(HandshakeRefusal::unauthorized(
            "missing or invalid handshake nonce",
        ));
    }
    let authority = lock(&server.mesh.authority)
        .clone()
        .ok_or_else(HandshakeRefusal::signed_out)?;
    let local = authority
        .local_device_id()
        .ok_or_else(HandshakeRefusal::signed_out)?;
    if claims.target != local {
        return Err(HandshakeRefusal::new(
            StatusCode::MISDIRECTED_REQUEST,
            "wrong_device",
            "this mesh address belongs to another device",
        ));
    }
    let now = crate::now_ms();
    if now.abs_diff(claims.time_ms) > handshake::MAX_CLOCK_SKEW_MS {
        return Err(HandshakeRefusal::unauthorized(
            "the handshake time is too far from this device's clock; check the system time",
        ));
    }
    let fingerprint = match claims.fingerprint {
        Some(fingerprint) => fingerprint,
        None => lock(&server.mesh.fingerprint)
            .clone()
            .ok_or_else(|| HandshakeRefusal::unauthorized("the mesh listener is not ready"))?,
    };
    let pair_key = authority.pair_key(claims.device).await.map_err(|error| {
        log::warn!(
            "OBP mesh handshake refused: device={}, error={}",
            claims.device,
            error
        );
        HandshakeRefusal::new(
            StatusCode::FORBIDDEN,
            "not_account_device",
            "the device is not part of this account",
        )
    })?;
    let key = handshake::handshake_key(&pair_key);
    let verified = Claims {
        client_device_id: claims.device.to_string(),
        server_device_id: local,
        cert_fingerprint: fingerprint,
        time_ms: claims.time_ms,
        nonce: claims.nonce.to_string(),
    };
    if !handshake::verify(&key, Role::Client, &verified, claims.proof) {
        log::warn!(
            "OBP mesh handshake proof rejected: device={}",
            claims.device
        );
        return Err(HandshakeRefusal::unauthorized(
            "the account-device proof is invalid",
        ));
    }
    // The directory row kind picks the scope: the account's cloud agent
    // (`cloud_agent`) gets its closed allowlist, never the account-device
    // set. A directory that cannot answer refuses rather than guessing.
    let kind = authority
        .device_kind(claims.device)
        .await
        .map_err(|error| {
            log::warn!(
                "OBP mesh handshake refused: device kind lookup failed: device={}, error={}",
                claims.device,
                error
            );
            HandshakeRefusal::new(
                StatusCode::SERVICE_UNAVAILABLE,
                "directory_unavailable",
                "the account device directory could not be read; try again shortly",
            )
        })?;
    if !server.consume_mesh_nonce(claims.nonce, now) {
        return Err(HandshakeRefusal::unauthorized(
            "the handshake was already used",
        ));
    }
    Ok(VerifiedClient {
        device: claims.device.to_string(),
        key,
        claims: verified,
        scope: super::scope::scope_for_device(claims.device.to_string(), kind.as_deref()),
    })
}

/// The verified client's scope and the server proof for its `101`.
async fn authenticate(
    server: &ObpServer,
    headers: &HeaderMap,
) -> Result<(Scope, String), Response> {
    if headers.contains_key(header::ORIGIN) {
        // Only native clients speak the device handshake; a browser page
        // must never reach this listener (browsers come through the server
        // gateway and speak the end-to-end channel, `e2e`).
        return Err(refusal(
            StatusCode::FORBIDDEN,
            "bad_origin",
            "browser requests are refused on the mesh listener",
        ));
    }
    let unauthorized =
        |message: &'static str| HandshakeRefusal::unauthorized(message).into_response();
    let proof = header_text(headers, header::AUTHORIZATION.as_str())
        .and_then(|value| value.strip_prefix(handshake::AUTH_SCHEME))
        .map(str::trim)
        .ok_or_else(|| unauthorized("the account-device handshake is required"))?;
    let device = header_text(headers, handshake::HEADER_DEVICE)
        .ok_or_else(|| unauthorized("missing or invalid client device id"))?;
    let target = header_text(headers, handshake::HEADER_TARGET)
        .ok_or_else(|| unauthorized("missing target device id"))?;
    let time_ms: u64 = header_text(headers, handshake::HEADER_TIME)
        .and_then(|value| value.parse().ok())
        .ok_or_else(|| unauthorized("missing handshake time"))?;
    let nonce = header_text(headers, handshake::HEADER_NONCE)
        .ok_or_else(|| unauthorized("missing or invalid handshake nonce"))?;
    let verified = verify_client(
        server,
        ClientClaims {
            device,
            target,
            time_ms,
            nonce,
            fingerprint: None,
            proof,
        },
    )
    .await
    .map_err(HandshakeRefusal::into_response)?;
    Ok((
        verified.scope,
        handshake::prove(&verified.key, Role::Server, &verified.claims),
    ))
}

/// The `account-device` upgrade (`http::upgrade` routes requests carrying
/// `Authorization: ObpMesh …` here).
pub(super) async fn account_device_upgrade(
    server: Arc<ObpServer>,
    headers: HeaderMap,
    upgrade: WebSocketUpgrade,
) -> Response {
    let (scope, server_proof) = match authenticate(&server, &headers).await {
        Ok(verified) => verified,
        Err(response) => return response,
    };
    let device_id = match &scope {
        Scope::AccountDevice { device_id } | Scope::CloudAgent { device_id } => device_id.clone(),
        Scope::Owner | Scope::PairedClient { .. } => String::new(),
    };
    let (id, stop) = server.register_connection(scope.clone());
    let context = ConnectionContext {
        backend: Arc::clone(&server.backend),
        scope,
        instance_id: server.instance_id.clone(),
        registry_digest: server.registry_digest.clone(),
        limits: server.options.limits.clone(),
        ui_bundle_id: server.ui_bundle.cached_bundle_id(),
        fleet_clients: Arc::clone(&server.fleet_clients),
        stop,
    };
    log::info!(
        "OBP mesh connection accepted: device={}, scope={}",
        device_id,
        context.scope.wire_name()
    );
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

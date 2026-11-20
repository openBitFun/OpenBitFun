//! The desktop backend's OBP listeners: a thin adapter over the shared
//! protocol crate (`openbitfun-obp`, `src/crates/adapters/obp`).
//!
//! The crate owns the wire (JSON-RPC framing, scopes, credit/ack, resume,
//! the loopback and Link listeners, the account-device handshake, the
//! `obp-e2e-v1` channel, pairing records). This module plugs the desktop's
//! [`BackendService`] into it ([`ObpBackend`]: the generated dispatcher, the
//! event hub, the desktop's same-account host verbs in `mesh_verbs`), runs
//! the process's server, and keeps the owner commands of the Devices scene
//! (`obp_api`). See `docs/architecture/unified-client-architecture.md`.

pub mod mesh_client;
#[cfg(test)]
mod mesh_tests;
mod mesh_verbs;
mod obp_api;

pub use obp_api::*;
pub use openbitfun_obp::server::{
    check_command, event_visible, ConnectionLimits, MeshAcceptFuture, MeshAuthority, MeshIncoming,
    MeshInfo, MeshIo, ObpBackend, ObpDispatchFuture, ObpServer, ObpServerOptions, ObpStatus,
    PairKeyFuture, PairedClientStatus, PairingOffer, PeerHostKind, Scope, StopReason,
    DEFAULT_LOOPBACK_PORT, OBP_PROTOCOL_VERSION,
};

use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};

use serde_json::Value;

use super::{BackendService, EventHub};

impl ObpBackend for BackendService {
    fn dispatch(&self, command: String, args: Value) -> ObpDispatchFuture {
        // Same-account host verbs (dispatch targets, the bot lane); the
        // scope check admits them for `account-device` (and the owner) only.
        if mesh_verbs::is_account_device_host_verb(&command) {
            if let Some(future) = mesh_verbs::route(&command, args) {
                return future;
            }
            return Box::pin(async move { Err(format!("unknown host verb {command}")) });
        }
        Box::pin(self.dispatch_owned(command, args))
    }

    fn events(&self) -> Arc<EventHub> {
        Arc::clone(BackendService::events(self))
    }

    fn info(&self) -> Value {
        serde_json::to_value(BackendService::info(self)).unwrap_or_default()
    }

    fn host_kind(&self) -> PeerHostKind {
        PeerHostKind::Desktop
    }

    fn is_account_device_host_verb(&self, command: &str) -> bool {
        mesh_verbs::is_account_device_host_verb(command)
    }

    fn mesh_capabilities(&self) -> Vec<&'static str> {
        mesh_verbs::CAPABILITIES.to_vec()
    }
}

static GLOBAL_SERVER: OnceLock<Arc<ObpServer>> = OnceLock::new();

/// The running server of this process, if the host started one.
pub fn global_server() -> Option<Arc<ObpServer>> {
    GLOBAL_SERVER.get().cloned()
}

/// The NSH web bundle: `OPENBITFUN_WEB_UI_DIR`, the packaged app's resources,
/// next to the executable, or the repository build output in development
/// builds (`pnpm run desktop-nsh:web`).
pub fn default_web_root() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(dir) = std::env::var_os("OPENBITFUN_WEB_UI_DIR") {
        candidates.push(PathBuf::from(dir));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(contents) = exe.parent().and_then(|dir| dir.parent()) {
            candidates.push(contents.join("Resources/nsh-web"));
        }
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("nsh-web"));
        }
    }
    if cfg!(debug_assertions) {
        candidates.push(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../../../target/desktop-nsh/web/OpenBitFun"),
        );
    }
    candidates
        .into_iter()
        .find(|dir| dir.join("index.html").is_file())
        .and_then(|dir| dir.canonicalize().ok())
}

fn env_port(name: &str, default: u16) -> u16 {
    std::env::var(name)
        .ok()
        .and_then(|value| value.trim().parse().ok())
        .unwrap_or(default)
}

/// Starts the loopback listener for the native host (unless
/// `OPENBITFUN_OBP_LISTENER=off`); the mesh listener starts with the device
/// mesh (`crate::mesh`).
pub async fn start_for_native_host(service: BackendService, data_dir: &Path) {
    if std::env::var("OPENBITFUN_OBP_LISTENER")
        .map(|value| value.eq_ignore_ascii_case("off") || value == "0")
        .unwrap_or(false)
    {
        log::info!("OBP listener disabled by OPENBITFUN_OBP_LISTENER");
        return;
    }
    let mut options = ObpServerOptions::new(data_dir.join("obp"));
    options.web_root = default_web_root();
    options.loopback_port = env_port("OPENBITFUN_OBP_PORT", DEFAULT_LOOPBACK_PORT);
    match &options.web_root {
        Some(root) => log::info!("OBP serves the web UI from: {}", root.display()),
        None => log::info!(
            "OBP has no web UI bundle; `/` explains how to build it (pnpm run desktop-nsh:web)"
        ),
    }
    let server = match ObpServer::new(Arc::new(service), options) {
        Ok(server) => server,
        Err(error) => {
            log::warn!("OBP listener unavailable: {}", error);
            return;
        }
    };
    if let Err(error) = server.start_loopback().await {
        log::warn!("OBP loopback listener failed to start: {}", error);
    }
    if GLOBAL_SERVER.set(server).is_err() {
        log::warn!("OBP listener was already started in this process");
    }
}

/// Stops the process's listeners (backend shutdown).
pub fn shutdown_global() {
    if let Some(server) = GLOBAL_SERVER.get() {
        server.shutdown();
    }
}

/// Status for hosts that never start the listener (the Tauri host).
pub fn unavailable_status() -> ObpStatus {
    openbitfun_obp::server::unavailable_status(
        "obp_unavailable: this desktop host does not run the browser/phone listener; use the native desktop app",
    )
}

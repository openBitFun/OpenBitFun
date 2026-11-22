//! The fleet layer of a runtime host (feature `fleet`).
//!
//! Every desktop and CLI host runs the same fleet layer, so any of them can
//! be the host a frontend connects through (see
//! `docs/architecture/unified-client-architecture.md` and the contract in
//! `openbitfun_product_domains::fleet`):
//!
//! - [`index`]: one single-writer partition per device, keyed by the owner's
//!   `(instanceId, revision)`, cached at `<data>/fleet/index.json`, with
//!   stale marking and every bound applied on write;
//! - [`sync`]: the digest subscription to each peer, pull on hint,
//!   reconnect or instance change, anti-entropy, and polling of mesh peers
//!   without `fleet_v1`;
//! - [`router`]: `fleet_call` (run here or forward as a plain call),
//!   `fleet_navigator`, `fleet_prompts` and the owner verb `fleet_digest`;
//! - [`mux`]: the per-client event stream with origin tags and the vector
//!   cursor;
//! - [`attention`] and [`views`]: the Inbox (`fleet_attention`) and the view
//!   models (`fleet_recent_sessions`, `fleet_device_detail`) projected from
//!   the index;
//! - [`replica`]: the account replica (records with hybrid-clock revisions
//!   and tombstones, content-addressed blobs) every runtime device keeps and
//!   exchanges with its peers (`fleet_replica_*`), first used by settings
//!   sync.
//!
//! Hosts plug in through [`router::FleetBackend`] (the local digest and
//! dispatcher) and [`sync::FleetPeerTransport`] (links to other devices).
//! No partition is ever gossiped: it comes from its owner only.

use std::future::Future;
use std::pin::Pin;

use serde_json::Value;

pub mod account_port;
pub mod attention;
pub mod host;
pub mod index;
pub mod mux;
pub mod replica;
pub mod router;
pub mod superagent_archive;
pub mod sync;
pub mod views;

#[cfg(test)]
mod tests;

/// A boxed future borrowing its receiver.
pub type FleetFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// A failed call: the owner's JSON-RPC error passed through unchanged, a
/// fleet refusal (`code` [`FLEET_REFUSAL_CODE`], message
/// `"<fleet prefix>: <detail>"`), or a transport failure (`code` 0).
#[derive(Debug, Clone, PartialEq)]
pub struct FleetCallError {
    pub code: i64,
    pub message: String,
    pub data: Option<Value>,
}

/// JSON-RPC code of a fleet refusal (the server error range).
pub const FLEET_REFUSAL_CODE: i64 = -32010;

impl FleetCallError {
    /// A transport failure on the link to a device.
    pub fn transport(message: impl Into<String>) -> Self {
        Self {
            code: 0,
            message: message.into(),
            data: None,
        }
    }

    /// A refusal decided by the fleet layer; `prefix` is one of the
    /// `fleet_*` error prefixes of the contract.
    pub fn refusal(prefix: &str, message: String) -> Self {
        Self {
            code: FLEET_REFUSAL_CODE,
            message,
            data: Some(serde_json::json!({ "kind": prefix })),
        }
    }

    /// A command error of this host (its text, unchanged).
    pub fn command(message: impl Into<String>) -> Self {
        Self {
            code: -32000,
            message: message.into(),
            data: None,
        }
    }

    /// The link failed, not the command.
    pub fn is_transport(&self) -> bool {
        self.code == 0
    }

    /// The error text a host returns from its dispatcher.
    pub fn into_message(self) -> String {
        self.message
    }
}

impl std::fmt::Display for FleetCallError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for FleetCallError {}

impl From<String> for FleetCallError {
    fn from(message: String) -> Self {
        Self::command(message)
    }
}

impl From<crate::client::MeshCallError> for FleetCallError {
    fn from(error: crate::client::MeshCallError) -> Self {
        Self {
            code: error.code,
            message: error.message,
            data: error.data,
        }
    }
}

/// Where the fleet layer publishes its own events (`fleet://index-changed`,
/// `fleet://prompts-changed`): the host's event stream.
pub trait FleetEventSink: Send + Sync + 'static {
    fn emit(&self, event: &str, payload: Value);
}

impl FleetEventSink for crate::events::EventHub {
    fn emit(&self, event: &str, payload: Value) {
        self.publish(event, payload);
    }
}

static NEXT_ATOMIC_TMP: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

/// Atomically writes `bytes` to `path` via a unique sibling temp file, so
/// concurrent writers or an earlier crash never collide on a fixed `.tmp` name.
pub(crate) fn atomic_write_bytes(path: &std::path::Path, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("file");
    let seq = NEXT_ATOMIC_TMP.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let tmp = path.with_file_name(format!("{file_name}.{}.{seq}.tmp", std::process::id()));
    if let Err(error) = std::fs::write(&tmp, bytes) {
        let _ = std::fs::remove_file(&tmp);
        return Err(error);
    }
    if let Err(error) = std::fs::rename(&tmp, path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(error);
    }
    Ok(())
}

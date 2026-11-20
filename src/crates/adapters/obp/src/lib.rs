//! The OpenBitFun backend protocol (OBP), host-neutral.
//!
//! One copy of the wire every client and host speaks (see
//! `docs/architecture/unified-client-architecture.md`):
//!
//! - [`events`]: the ordered event stream with `seq` numbers, a bounded
//!   replay ring and independent subscriber cursors;
//! - `server` (feature `server`): JSON-RPC 2.0 over WebSocket on a loopback
//!   listener (owner scope) and on the account device network (OpenBitFun
//!   Link: TLS with the account-device handshake, QR-paired clients, and the
//!   `obp-e2e-v1` end-to-end channel for browsers behind the server gateway),
//!   with registry-driven scopes, credit/ack backpressure, text coalescing
//!   and resume. A host plugs in its dispatcher and event source through
//!   [`server::ObpBackend`];
//! - `client` (feature `client`): the controller side of the account-device
//!   handshake and the connection (`hello`, `call`, `ack`, events), used by
//!   the desktop's Peer Device Mode and by the phone app.
//!
//! Nothing here knows a UI toolkit, a product command, or how a host signs
//! in: hosts provide [`MeshAuthority`] (who this device is, the pair key with
//! another device) and byte streams ([`MeshIo`]).

mod authority;
pub mod events;

#[cfg(feature = "client")]
pub mod client;
#[cfg(feature = "server")]
pub mod server;

pub use authority::{MeshAuthority, MeshInfo, MeshIo, PairKeyFuture};
pub use events::{
    BackendEvent, EventBatch, EventHub, EventSubscription, DEFAULT_EVENT_REPLAY_CAPACITY,
    EVENTS_DROPPED_EVENT,
};

/// The protocol version this crate speaks.
pub const OBP_PROTOCOL_VERSION: u32 = 1;

/// The error-text prefix of a command a host does not run (registered
/// nowhere, retired, or not available on this kind of host). The server types
/// such errors `data.kind = "unsupported"`; UIs degrade on it.
pub const UNSUPPORTED_IN_NATIVE_HOST: &str = "unsupported_in_native_host";

/// Lowercase hex SHA-256 of `data`.
pub fn sha256_hex(data: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(data);
    let mut out = String::with_capacity(64);
    for byte in digest {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

/// Milliseconds since the Unix epoch.
pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

/// Installs the process TLS provider (ring) once.
#[cfg(feature = "client")]
pub(crate) fn ensure_tls_provider() {
    openbitfun_services_core::tls_provider::ensure_ring_crypto_provider();
}

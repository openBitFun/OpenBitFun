//! Peer Device Mode over OBP on the account mesh (controller side).
//!
//! A UI that drives another device of the account keeps its own backend for
//! controller-local work (account, window, mesh, updater) and sends every
//! registry-`Proxied` command to the selected device's backend. This module
//! is that link: the local (owner) backend opens one authenticated
//! `account-device` OBP connection per driven device through
//! [`super::connect_device`] and exposes it to its own UIs with four
//! `ControllerLocal` commands:
//!
//! - `peer_link_connect {deviceId}`: open (or reuse) the link; returns the
//!   peer's `hello` (scope, capabilities, backend identity, `lastSeq`) and the
//!   mesh path (p2p or relayed).
//! - `peer_link_call {deviceId, command, args}`: run one command on the peer.
//!   `args` is exactly the Tauri args object the UI built and the result is
//!   the peer's own JSON: nothing is wrapped, projected or re-encoded.
//! - `peer_link_events {deviceId, afterSeq?, instanceId?, waitMs?}`: a long
//!   poll over the peer's event stream. Items are the peer's own
//!   `{seq, event, payload}` (the peer's `seq`), so the UI resumes after the
//!   last peer `seq` it applied, exactly like the in-process stream.
//! - `peer_link_disconnect {deviceId}`.
//!
//! The UI could not speak to the peer itself: the device handshake needs this
//! device's X25519 key, which stays in the backend. Going through the local
//! backend costs one in-process hop (a function call for the native UI); the
//! payload crosses it unchanged and token chunks are delivered as the peer
//! emits them.
//!
//! Resume: the link keeps the peer events it took in a bounded ring and, when
//! the mesh connection drops, reconnects with `lastSeq` + `instanceId`, so the
//! peer replays the gap. A UI cursor that fell out of the ring, or that
//! belongs to an earlier instance of the peer backend, gets a synthetic
//! `backend://events-dropped` first and re-hydrates through commands.
//!
//! Remote scenarios: this is the Peer Device Mode data plane. It never uses
//! the old relay transport (`account_device_rpc`, relay `rpc-call`,
//! `machine-event`, `HostStream`); a device that is not on the mesh is driven
//! by the legacy path in the UI instead (negotiated per device).

use std::sync::Arc;
use std::time::Duration;

use serde::Deserialize;
use serde_json::{json, Value};

use crate::backend_protocol::ws::mesh_client::MeshConnectOptions;

/// The link pool itself is shared with the CLI host and the fleet layer
/// (`openbitfun_obp::client::links`); this module keeps the desktop's
/// connector, the process-wide pool and the `peer_link_*` commands.
pub use openbitfun_obp::client::links::{
    ConnectFuture, LinkState, PeerConnector, PeerEventsBatch, PeerLinkInfo, PeerLinks,
};

/// Longest long poll (`peer_link_events`).
const MAX_WAIT: Duration = Duration::from_secs(25);

/// The production connector: the mesh runtime of this process, and the
/// account's cloud node (`cloud-…`, reached at the account server rather
/// than on the device network).
struct RuntimeConnector;

impl PeerConnector for RuntimeConnector {
    fn connect(&self, device_id: String, options: MeshConnectOptions) -> ConnectFuture {
        if openbitfun_obp::client::cloud::is_cloud_device_id(&device_id) {
            return Box::pin(async move { super::connect_cloud_node(&device_id, options).await });
        }
        Box::pin(async move { super::connect_device(&device_id, options).await })
    }

    fn route(&self, device_id: &str) -> Option<(String, Option<f64>)> {
        if openbitfun_obp::client::cloud::is_cloud_device_id(device_id) {
            return None;
        }
        let status = super::global()?.status();
        let peer = status.peer(device_id)?;
        let path = serde_json::to_value(peer.path)
            .ok()?
            .as_str()
            .map(str::to_string)?;
        Some((path, peer.latency_ms))
    }
}

static LINKS: std::sync::OnceLock<Arc<PeerLinks>> = std::sync::OnceLock::new();

/// The peer links of this process (created on first use).
pub fn global() -> Arc<PeerLinks> {
    Arc::clone(LINKS.get_or_init(|| PeerLinks::new(Arc::new(RuntimeConnector))))
}

/// Closes every link if any was opened (sign-out, shutdown).
pub async fn shutdown_global() {
    if let Some(links) = LINKS.get() {
        links.disconnect_all().await;
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerLinkConnectRequest {
    pub device_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerLinkCallRequest {
    pub device_id: String,
    pub command: String,
    /// The Tauri args object (`{request}` or positional arguments).
    #[serde(default)]
    pub args: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerLinkEventsRequest {
    pub device_id: String,
    #[serde(default)]
    pub after_seq: Option<u64>,
    #[serde(default)]
    pub instance_id: Option<String>,
    /// Longest wait for the first event, in ms (default and cap 25 000).
    #[serde(default)]
    pub wait_ms: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerLinkDisconnectRequest {
    pub device_id: String,
}

/// Opens (or reuses) the OBP-on-mesh link to another device of the account.
// @backend-command
pub async fn peer_link_connect(request: PeerLinkConnectRequest) -> Result<PeerLinkInfo, String> {
    global().connect(request.device_id.trim()).await
}

/// Runs one product command on a linked device.
// @backend-command
pub async fn peer_link_call(request: PeerLinkCallRequest) -> Result<Value, String> {
    let args = if request.args.is_null() {
        Value::Object(Default::default())
    } else {
        request.args
    };
    global()
        .call(request.device_id.trim(), &request.command, args)
        .await
}

/// Long-polls a linked device's event stream.
// @backend-command
pub async fn peer_link_events(request: PeerLinkEventsRequest) -> Result<PeerEventsBatch, String> {
    let wait = Duration::from_millis(request.wait_ms.unwrap_or(MAX_WAIT.as_millis() as u64));
    global()
        .events(
            request.device_id.trim(),
            request.after_seq,
            request.instance_id.as_deref(),
            wait,
        )
        .await
}

/// Closes the link to a device.
// @backend-command
pub async fn peer_link_disconnect(request: PeerLinkDisconnectRequest) -> Result<Value, String> {
    let closed = global().disconnect(request.device_id.trim()).await;
    Ok(json!({ "closed": closed }))
}

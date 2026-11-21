//! JSON-RPC 2.0 framing of the backend protocol over WebSocket.
//!
//! Client to server (text frames, one JSON-RPC message each):
//!
//! - `hello` (request, first message): `{protocol, client?, lastSeq?,
//!   instanceId?, ack?, creditBytes?, events?: {prefixes}, fleet?: {protocol,
//!   cursor}}` → `{protocol, scope, capabilities, registryDigest, backend:
//!   {version, platform, instanceId, dataDir?}, lastSeq, creditBytes,
//!   hostCapabilities, hostKind, uiBundleId?, events?: {prefixes}, fleet?:
//!   {protocol, deviceId, cursorState}}`;
//! - `call` (request): `{command, args}` → the command's JSON value;
//! - `ack` (notification): `{seq}`, grants event credit back.
//!
//! Server to client: responses, and `event` notifications
//! `{seq, event, payload}` with payloads byte-identical to the in-process
//! stream.
//!
//! Additive members (older peers ignore them, older clients never send them):
//!
//! - `events: {prefixes}` on the hello keeps only events whose name starts
//!   with one of the prefixes (`backend://events-dropped` always passes); the
//!   answer echoes the applied filter, so a client can tell an older server
//!   that ignored it.
//! - `fleet: {protocol, cursor}` on the hello asks a fleet entry for the
//!   merged stream of every device the client follows: frames then carry
//!   `origin` and `originInstance` and `seq` is the origin's own. A server
//!   without the fleet layer answers without `fleet` and its frames are
//!   unchanged.

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub(crate) use crate::OBP_PROTOCOL_VERSION;

/// Capabilities the server advertises in its `hello` result.
pub const SERVER_CAPABILITIES: &[&str] = &["obp_v1", "resume", "credit_ack", "coalesce_text"];

/// Capabilities of a connection over the account mesh (`account-device`),
/// before the host's own host-verb capabilities
/// (`ObpBackend::mesh_capabilities`).
pub const BASE_MESH_CAPABILITIES: &[&str] = &[
    "obp_v1",
    "resume",
    "credit_ack",
    "coalesce_text",
    openbitfun_link::MESH_CAPABILITY,
];

/// JSON-RPC: invalid JSON.
pub(crate) const PARSE_ERROR: i64 = -32700;
/// JSON-RPC: not a valid request object.
pub(crate) const INVALID_REQUEST: i64 = -32600;
/// JSON-RPC: unknown method.
pub(crate) const METHOD_NOT_FOUND: i64 = -32601;
/// JSON-RPC: invalid method parameters.
pub(crate) const INVALID_PARAMS: i64 = -32602;
/// JSON-RPC: internal error (a command task panicked).
pub(crate) const INTERNAL_ERROR: i64 = -32603;
/// The command ran and failed; `message` is the backend's own error text.
pub(crate) const COMMAND_FAILED: i64 = -32000;
/// A method other than `hello` arrived before the handshake.
pub(crate) const HELLO_REQUIRED: i64 = -32002;
/// The connection's scope may not run this command.
pub(crate) const FORBIDDEN: i64 = -32003;
/// The client and server share no protocol version.
pub(crate) const PROTOCOL_MISMATCH: i64 = -32005;

/// One inbound JSON-RPC message (request or notification).
#[derive(Debug, Deserialize)]
pub(crate) struct Incoming {
    #[serde(default)]
    pub jsonrpc: Option<String>,
    /// Absent for notifications.
    #[serde(default)]
    pub id: Option<Value>,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HelloParams {
    #[serde(default)]
    pub protocol: Option<u32>,
    #[serde(default)]
    pub client: Option<String>,
    /// The last event `seq` the client rendered (resume after it).
    #[serde(default)]
    pub last_seq: Option<u64>,
    /// The backend instance the `last_seq` belongs to.
    #[serde(default)]
    pub instance_id: Option<String>,
    /// The client acknowledges events (`ack`), enabling credit flow control.
    #[serde(default)]
    pub ack: bool,
    /// The client's event window in bytes (clamped by the server).
    #[serde(default)]
    pub credit_bytes: Option<u64>,
    /// `{prefixes}`: an event-name prefix filter. Read tolerantly: an
    /// unreadable value is no filter.
    #[serde(default)]
    pub events: Option<Value>,
    /// `{protocol, cursor}`: the client speaks the fleet stream. Read
    /// tolerantly: an unreadable value is an old client.
    #[serde(default)]
    #[cfg_attr(not(feature = "fleet"), allow(dead_code))]
    pub fleet: Option<Value>,
}

impl HelloParams {
    /// The prefix filter the client asked for (`None`: every event).
    pub(crate) fn event_prefixes(&self) -> Option<Vec<String>> {
        let filter: openbitfun_product_domains::fleet::FleetEventFilter =
            serde_json::from_value(self.events.clone()?).ok()?;
        let prefixes: Vec<String> = filter
            .prefixes
            .into_iter()
            .map(|prefix| prefix.trim().to_string())
            .filter(|prefix| !prefix.is_empty())
            .take(MAX_EVENT_PREFIXES)
            .collect();
        (!prefixes.is_empty()).then_some(prefixes)
    }

    /// The fleet member, when the client speaks the fleet stream.
    #[cfg_attr(not(feature = "fleet"), allow(dead_code))]
    pub(crate) fn fleet_hello(&self) -> Option<openbitfun_product_domains::fleet::FleetHello> {
        let fleet = self.fleet.clone()?;
        if !fleet.is_object() {
            return None;
        }
        serde_json::from_value(fleet).ok()
    }
}

/// Most prefixes one filter keeps.
const MAX_EVENT_PREFIXES: usize = 32;

/// Whether `event` passes a prefix filter (`None`: no filter). The synthetic
/// `backend://events-dropped` always passes: it is how a client learns it
/// must re-hydrate.
pub(crate) fn passes_prefixes(prefixes: Option<&[String]>, event: &str) -> bool {
    match prefixes {
        None => true,
        Some(prefixes) => {
            event == crate::EVENTS_DROPPED_EVENT
                || prefixes
                    .iter()
                    .any(|prefix| event.starts_with(prefix.as_str()))
        }
    }
}

#[derive(Debug, Deserialize)]
pub(crate) struct CallParams {
    pub command: String,
    #[serde(default)]
    pub args: Value,
}

#[derive(Debug, Deserialize)]
pub(crate) struct AckParams {
    pub seq: u64,
    /// On a fleet stream: the client's vector cursor
    /// (`{[origin]: {instanceId, seq}}`), which names exactly the frames it
    /// applied (`seq` alone is ambiguous across origins). Read tolerantly.
    #[serde(default)]
    pub cursor: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BackendIdentity {
    pub version: String,
    pub platform: String,
    pub instance_id: String,
    /// Only the owner scope learns the data directory.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_dir: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HelloResult {
    pub protocol: u32,
    pub scope: &'static str,
    pub capabilities: Vec<&'static str>,
    pub registry_digest: String,
    pub backend: BackendIdentity,
    /// The newest event `seq` at the time of the handshake.
    pub last_seq: u64,
    /// The negotiated event window (`null`: no credit flow control).
    pub credit_bytes: Option<u64>,
    /// The Product Operation Registry's peer-host capabilities this backend
    /// serves (what `peer_mode_ping` advertised on the legacy path), so a
    /// controller driving it over OBP gates the same features. Additive:
    /// clients that do not know the field ignore it.
    pub host_capabilities: Vec<&'static str>,
    /// The kind of host behind this backend (`desktop`, `cli`), for display:
    /// features are gated on `hostCapabilities`. Additive.
    pub host_kind: &'static str,
    /// The id of the web UI bundle this host ships, as a hint (additive,
    /// absent when the host has none or has not loaded it yet). Browsers
    /// trust only the manifest from `ui_bundle_manifest`, recomputing its id.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ui_bundle_id: Option<String>,
    /// The prefix filter applied to this connection (`{prefixes}`), echoed
    /// only when the client asked for one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub events: Option<Value>,
    /// The fleet answer (`{protocol, deviceId, cursorState}`), only when the
    /// client sent `fleet` and this host serves the fleet stream.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fleet: Option<Value>,
}

#[derive(Debug, Serialize)]
pub(crate) struct RpcError {
    pub code: i64,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

impl RpcError {
    pub(crate) fn new(code: i64, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            data: None,
        }
    }

    pub(crate) fn with_data(mut self, data: Value) -> Self {
        self.data = Some(data);
        self
    }
}

/// A success response frame.
pub(crate) fn result_frame(id: &Value, result: &impl Serialize) -> String {
    #[derive(Serialize)]
    struct Frame<'a, T: Serialize> {
        jsonrpc: &'static str,
        id: &'a Value,
        result: &'a T,
    }
    serde_json::to_string(&Frame {
        jsonrpc: "2.0",
        id,
        result,
    })
    .unwrap_or_else(|error| {
        error_frame(
            id,
            &RpcError::new(
                INTERNAL_ERROR,
                format!("failed to encode the result: {error}"),
            ),
        )
    })
}

/// An error response frame (`id: null` when the request had none readable).
pub(crate) fn error_frame(id: &Value, error: &RpcError) -> String {
    serde_json::json!({ "jsonrpc": "2.0", "id": id, "error": error }).to_string()
}

/// An `event` notification frame.
pub(crate) fn event_frame(seq: u64, event: &str, payload: &Value) -> String {
    #[derive(Serialize)]
    struct Params<'a> {
        seq: u64,
        event: &'a str,
        payload: &'a Value,
    }
    #[derive(Serialize)]
    struct Frame<'a> {
        jsonrpc: &'static str,
        method: &'static str,
        params: Params<'a>,
    }
    serde_json::to_string(&Frame {
        jsonrpc: "2.0",
        method: "event",
        params: Params {
            seq,
            event,
            payload,
        },
    })
    .unwrap_or_else(|error| {
        log::error!(
            "Failed to encode OBP event frame: event={}, error={}",
            event,
            error
        );
        String::new()
    })
}

/// An `event` notification frame of a fleet stream: the origin's own `seq`,
/// its event and payload unchanged, tagged with the origin device and its
/// backend instance.
#[cfg_attr(not(feature = "fleet"), allow(dead_code))]
pub(crate) fn fleet_event_frame(
    origin: &str,
    origin_instance: &str,
    seq: u64,
    event: &str,
    payload: &Value,
) -> String {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Params<'a> {
        seq: u64,
        event: &'a str,
        payload: &'a Value,
        origin: &'a str,
        origin_instance: &'a str,
    }
    #[derive(Serialize)]
    struct Frame<'a> {
        jsonrpc: &'static str,
        method: &'static str,
        params: Params<'a>,
    }
    serde_json::to_string(&Frame {
        jsonrpc: "2.0",
        method: "event",
        params: Params {
            seq,
            event,
            payload,
            origin,
            origin_instance,
        },
    })
    .unwrap_or_else(|error| {
        log::error!(
            "Failed to encode OBP fleet event frame: event={}, error={}",
            event,
            error
        );
        String::new()
    })
}

/// The error a failed command reports: its own text, typed by kind
/// (`unsupported` when the host does not run the command here).
pub(crate) fn command_error(command: &str, message: String, unsupported: bool) -> RpcError {
    let kind = if unsupported {
        "unsupported"
    } else {
        "command"
    };
    RpcError::new(COMMAND_FAILED, message)
        .with_data(serde_json::json!({ "kind": kind, "command": command }))
}

//! JSON-RPC 2.0 framing of the backend protocol over WebSocket.
//!
//! Client to server (text frames, one JSON-RPC message each):
//!
//! - `hello` (request, first message): `{protocol, client?, lastSeq?,
//!   instanceId?, ack?, creditBytes?}` → `{protocol, scope, capabilities,
//!   registryDigest, backend: {version, platform, instanceId, dataDir?},
//!   lastSeq, creditBytes}`;
//! - `call` (request): `{command, args}` → the command's JSON value;
//! - `ack` (notification): `{seq}`, grants event credit back.
//!
//! Server to client: responses, and `event` notifications
//! `{seq, event, payload}` with payloads byte-identical to the in-process
//! stream.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// The protocol version this server speaks.
pub const OBP_PROTOCOL_VERSION: u32 = 1;

/// Capabilities the server advertises in its `hello` result.
pub(crate) const SERVER_CAPABILITIES: &[&str] =
    &["obp_v1", "resume", "credit_ack", "coalesce_text"];

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
    pub capabilities: &'static [&'static str],
    pub registry_digest: String,
    pub backend: BackendIdentity,
    /// The newest event `seq` at the time of the handshake.
    pub last_seq: u64,
    /// The negotiated event window (`null`: no credit flow control).
    pub credit_bytes: Option<u64>,
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

/// The error a failed command reports: its own text, typed by kind.
pub(crate) fn command_error(command: &str, message: String) -> RpcError {
    let kind = if message.starts_with(crate::host::UNSUPPORTED_IN_NATIVE_HOST) {
        "unsupported"
    } else {
        "command"
    };
    RpcError::new(COMMAND_FAILED, message)
        .with_data(serde_json::json!({ "kind": kind, "command": command }))
}

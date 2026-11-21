//! The `fleet_model_*` wire (`fleet_model_v1`). Requests reject unknown
//! fields: a newer superagent that needs a new field negotiates a new
//! capability instead of having it silently ignored.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// `fleet_model_start`: one completion, run through this device's provider.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FleetModelStartRequest {
    /// Caller-chosen id; a repeated start with the same id and body resumes.
    pub request_id: String,
    /// A configured model id or `primary` / `fast`; absent: `primary`.
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub system: String,
    pub messages: Vec<RelayMessage>,
    /// Tool definitions the model may call; calls come back, nothing runs.
    #[serde(default)]
    pub tools: Vec<RelayTool>,
    #[serde(default)]
    pub max_output_tokens: Option<u32>,
}

/// One conversation message: `user`, `assistant` (with optional tool calls)
/// or `tool` (a tool result for `toolCallId`).
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RelayMessage {
    pub role: String,
    #[serde(default)]
    pub content: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tool_calls: Vec<RelayToolCall>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_error: Option<bool>,
}

/// A tool call the model made (arguments are the raw JSON text).
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RelayToolCall {
    pub id: String,
    pub name: String,
    pub arguments: String,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RelayTool {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub parameters: Value,
}

/// `fleet_model_poll`: chunks after `afterSeq`, waiting up to `waitMs`
/// (≤ 25 000) for the first new one.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FleetModelPollRequest {
    pub request_id: String,
    #[serde(default)]
    pub after_seq: u64,
    #[serde(default)]
    pub wait_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FleetModelCancelRequest {
    pub request_id: String,
}

/// One streamed delta, numbered from 1.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayChunk {
    pub seq: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_call: Option<RelayToolCallDelta>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayToolCallDelta {
    pub index: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub arguments_delta: Option<String>,
}

/// The finished round.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RelayResult {
    pub text: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub reasoning: String,
    #[serde(default)]
    pub tool_calls: Vec<RelayToolCall>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finish_reason: Option<String>,
    /// The model that answered (the provider's model name).
    #[serde(default)]
    pub model: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub usage: Option<RelayUsage>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<RelayError>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RelayUsage {
    pub input_tokens: u32,
    pub output_tokens: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cached_tokens: Option<u32>,
}

/// Why a round failed: a stable code and an English sentence.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayError {
    pub code: String,
    pub message: String,
}

impl RelayError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.to_string(),
            message: message.into(),
        }
    }
}

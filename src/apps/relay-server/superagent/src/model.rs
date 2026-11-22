//! Model rounds relayed to an account device: the server holds no model
//! credentials. A [`ModelHolder`] runs one round on one device; the turn
//! loop picks the device (`policy::rank_model_holders`) and retries a round
//! on the next holder when one is lost.
//!
//! The relay wire (owner verbs on desktop and CLI, admitted only for the
//! `CloudAgent` scope, advertised as `fleet_model_v1`):
//!
//! - `fleet_model_start {requestId, model?, system, messages, tools,
//!   maxOutputTokens}` -> `{requestId}` (idempotent on `requestId`);
//! - `fleet_model_poll {requestId, afterSeq, waitMs <= 25000}` ->
//!   `{chunks: [{seq, text}], done, result?: {text, toolCalls: [{id, name,
//!   arguments}], usage?, stopReason?}, error?}` (resumable: a lost poll is
//!   repeated with the same `afterSeq`);
//! - `fleet_model_cancel {requestId}`.

use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::device::{BoxFuture, DeviceRpc, RpcError};

/// Longest a single poll waits on the device.
pub const POLL_WAIT_MS: u64 = 25_000;
/// Consecutive transport failures before the holder counts as lost.
const POLL_RETRIES: u32 = 3;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelRequest {
    pub request_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    pub system: String,
    pub messages: Vec<Value>,
    pub tools: Vec<Value>,
    pub max_output_tokens: u32,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ModelToolCall {
    pub id: String,
    pub name: String,
    pub arguments: Value,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ModelReply {
    pub text: String,
    pub tool_calls: Vec<ModelToolCall>,
    pub usage: Value,
    pub stop_reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ModelError {
    /// The holder went away mid-round; try the next one.
    HolderLost(String),
    /// The holder answered with a model error (bad request, quota): the
    /// round fails instead of moving to another device.
    Failed(String),
}

impl std::fmt::Display for ModelError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::HolderLost(m) | Self::Failed(m) => f.write_str(m),
        }
    }
}

/// Streamed text of a round, as it arrives.
pub type DeltaSink = Arc<dyn Fn(&str) + Send + Sync>;

pub trait ModelHolder: Send + Sync + 'static {
    fn run<'a>(
        &'a self,
        account_id: &'a str,
        holder: &'a str,
        request: &'a ModelRequest,
        deltas: DeltaSink,
    ) -> BoxFuture<'a, Result<ModelReply, ModelError>>;

    fn cancel<'a>(
        &'a self,
        account_id: &'a str,
        holder: &'a str,
        request_id: &'a str,
    ) -> BoxFuture<'a, ()>;
}

/// The real holder: `fleet_model_*` over the device RPC.
pub struct RelayModel {
    rpc: Arc<dyn DeviceRpc>,
}

impl RelayModel {
    pub fn new(rpc: Arc<dyn DeviceRpc>) -> Self {
        Self { rpc }
    }
}

/// A tool call as the relay carries it (arguments are JSON text).
pub fn relay_tool_call(call: &ModelToolCall) -> Value {
    let arguments = match &call.arguments {
        Value::Null => "{}".to_string(),
        Value::String(text) => text.clone(),
        other => other.to_string(),
    };
    json!({ "id": call.id, "name": call.name, "arguments": arguments })
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct PollChunk {
    seq: u64,
    text: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct RelayToolCallWire {
    id: String,
    name: String,
    arguments: String,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct RelayErrorWire {
    code: String,
    message: String,
}

/// `RelayResult` of the device side (`superagent_relay::dto`).
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct RelayResultWire {
    text: String,
    tool_calls: Vec<RelayToolCallWire>,
    finish_reason: Option<String>,
    usage: Option<Value>,
    error: Option<RelayErrorWire>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct PollAnswer {
    chunks: Vec<PollChunk>,
    done: bool,
    result: Option<RelayResultWire>,
}

fn is_holder_lost_refusal(code_or_message: &str) -> bool {
    code_or_message.starts_with("fleet_model_unknown_request")
        || code_or_message.starts_with("fleet_model_busy")
        || code_or_message.starts_with("fleet_model_unavailable")
}

impl RelayResultWire {
    fn into_reply(self) -> Result<ModelReply, ModelError> {
        if let Some(error) = self.error {
            let formatted = format!("{}: {}", error.code, error.message);
            return Err(if is_holder_lost_refusal(&error.code) {
                ModelError::HolderLost(formatted)
            } else {
                ModelError::Failed(formatted)
            });
        }
        Ok(ModelReply {
            text: self.text,
            tool_calls: self
                .tool_calls
                .into_iter()
                .map(|call| ModelToolCall {
                    // Unparseable arguments reach the tool parser as text and
                    // come back to the model as invalid_arguments.
                    arguments: serde_json::from_str(&call.arguments)
                        .unwrap_or(Value::String(call.arguments)),
                    id: call.id,
                    name: call.name,
                })
                .collect(),
            usage: self.usage.unwrap_or(Value::Null),
            stop_reason: self.finish_reason,
        })
    }
}

fn lost(error: RpcError) -> ModelError {
    match error {
        // The holder forgot the request (it restarted), is busy, or its model
        // relay is unavailable: another holder runs the round.
        RpcError::Refused(message) if is_holder_lost_refusal(&message) => {
            ModelError::HolderLost(message)
        }
        RpcError::Refused(message) => ModelError::Failed(message),
        other => ModelError::HolderLost(other.message().to_string()),
    }
}

impl ModelHolder for RelayModel {
    fn run<'a>(
        &'a self,
        account_id: &'a str,
        holder: &'a str,
        request: &'a ModelRequest,
        deltas: DeltaSink,
    ) -> BoxFuture<'a, Result<ModelReply, ModelError>> {
        Box::pin(async move {
            let args =
                serde_json::to_value(request).map_err(|e| ModelError::Failed(e.to_string()))?;
            self.rpc
                .call(
                    account_id,
                    holder,
                    "fleet_model_start",
                    json!({ "request": args }),
                )
                .await
                .map_err(lost)?;
            let mut after = 0u64;
            let mut failures = 0u32;
            loop {
                let answer = self
                    .rpc
                    .call(
                        account_id,
                        holder,
                        "fleet_model_poll",
                        json!({ "request": {
                            "requestId": request.request_id,
                            "afterSeq": after,
                            "waitMs": POLL_WAIT_MS,
                        }}),
                    )
                    .await;
                let answer = match answer {
                    Ok(answer) => {
                        failures = 0;
                        answer
                    }
                    Err(RpcError::Transport(message)) if failures + 1 < POLL_RETRIES => {
                        failures += 1;
                        log::debug!("Model poll retry: holder={}, error={}", holder, message);
                        tokio::time::sleep(Duration::from_millis(200)).await;
                        continue;
                    }
                    Err(error) => return Err(lost(error)),
                };
                let answer: PollAnswer = serde_json::from_value(answer)
                    .map_err(|e| ModelError::HolderLost(format!("unreadable model poll: {e}")))?;
                for chunk in answer.chunks {
                    if chunk.seq > after {
                        after = chunk.seq;
                        if let Some(text) = chunk.text.filter(|text| !text.is_empty()) {
                            deltas(&text);
                        }
                    }
                }
                if answer.done {
                    return answer
                        .result
                        .ok_or_else(|| {
                            ModelError::HolderLost("the model round ended without a result".into())
                        })?
                        .into_reply();
                }
            }
        })
    }

    fn cancel<'a>(
        &'a self,
        account_id: &'a str,
        holder: &'a str,
        request_id: &'a str,
    ) -> BoxFuture<'a, ()> {
        Box::pin(async move {
            let _ = self
                .rpc
                .call(
                    account_id,
                    holder,
                    "fleet_model_cancel",
                    json!({ "request": { "requestId": request_id } }),
                )
                .await;
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::device::DeviceSnapshot;

    #[test]
    fn busy_and_unavailable_refusals_trigger_failover() {
        assert!(matches!(
            lost(RpcError::Refused(
                "fleet_model_busy: already running 4 rounds".into()
            )),
            ModelError::HolderLost(_)
        ));
        assert!(matches!(
            lost(RpcError::Refused(
                "fleet_model_unavailable: provider not ready".into()
            )),
            ModelError::HolderLost(_)
        ));
        assert!(matches!(
            lost(RpcError::Refused(
                "fleet_model_unknown_request: gone".into()
            )),
            ModelError::HolderLost(_)
        ));
        assert!(matches!(
            lost(RpcError::Refused(
                "fleet_model_invalid_request: bad prompt".into()
            )),
            ModelError::Failed(_)
        ));
        assert!(matches!(
            lost(RpcError::Refused(
                "fleet_model_provider_error: quota exceeded".into()
            )),
            ModelError::Failed(_)
        ));
    }

    #[test]
    fn relay_result_unavailable_and_busy_map_to_holder_lost() {
        let unavailable = RelayResultWire {
            error: Some(RelayErrorWire {
                code: "fleet_model_unavailable".into(),
                message: "no provider".into(),
            }),
            ..RelayResultWire::default()
        };
        assert!(matches!(
            unavailable.into_reply(),
            Err(ModelError::HolderLost(_))
        ));

        let busy = RelayResultWire {
            error: Some(RelayErrorWire {
                code: "fleet_model_busy".into(),
                message: "saturated".into(),
            }),
            ..RelayResultWire::default()
        };
        assert!(matches!(busy.into_reply(), Err(ModelError::HolderLost(_))));

        let provider_err = RelayResultWire {
            error: Some(RelayErrorWire {
                code: "fleet_model_provider_error".into(),
                message: "rate limited".into(),
            }),
            ..RelayResultWire::default()
        };
        assert!(matches!(
            provider_err.into_reply(),
            Err(ModelError::Failed(_))
        ));
    }

    struct StubRpc(Result<Value, RpcError>);

    impl DeviceRpc for StubRpc {
        fn devices<'a>(
            &'a self,
            _account_id: &'a str,
        ) -> BoxFuture<'a, Result<Vec<DeviceSnapshot>, RpcError>> {
            Box::pin(async { Ok(Vec::new()) })
        }

        fn call<'a>(
            &'a self,
            _account_id: &'a str,
            _device_id: &'a str,
            _command: &'a str,
            _args: Value,
        ) -> BoxFuture<'a, Result<Value, RpcError>> {
            let outcome = self.0.clone();
            Box::pin(async move { outcome })
        }
    }

    #[tokio::test]
    async fn relay_model_run_maps_busy_start_to_holder_lost() {
        let model = RelayModel::new(Arc::new(StubRpc(Err(RpcError::Refused(
            "fleet_model_busy: busy".into(),
        )))));
        let request = ModelRequest {
            request_id: "r1".into(),
            model: None,
            system: String::new(),
            messages: Vec::new(),
            tools: Vec::new(),
            max_output_tokens: 128,
        };
        let sink: DeltaSink = Arc::new(|_| {});
        let err = model
            .run("acct", "dev-1", &request, sink)
            .await
            .unwrap_err();
        assert!(matches!(err, ModelError::HolderLost(_)), "{err:?}");
    }
}

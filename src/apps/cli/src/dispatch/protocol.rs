use serde::{Deserialize, Serialize};

use openbitfun_agent_runtime::sdk::{PermissionReply, PermissionRequest};
use openbitfun_core::AIModelCatalog;

// The wire contract (version, capability names, attachment shape and
// limits) has one source of truth shared with the controller side.
pub(crate) use openbitfun_services_core::dispatch_contract::{
    validate_dispatch_attachments, DispatchAttachment, DISPATCH_PROTOCOL_VERSION,
};
// The request and plain response DTOs live with the contract so every
// controller (including the cloud superagent) builds the same shapes.
pub(crate) use openbitfun_services_core::dispatch_contract::wire::{
    DispatchAnswerResponse, DispatchAppendRequest, DispatchAppendResponse, DispatchApprovalPolicy,
    DispatchCancelRequest, DispatchCancelResponse, DispatchContinueRequest,
    DispatchContinueResponse, DispatchDiffStat, DispatchDiffStatFile, DispatchJobListEntry,
    DispatchJobState, DispatchListRequest, DispatchPendingPromptSummary, DispatchProbeRequest,
    DispatchProvisionSource, DispatchQueryKind, DispatchQueryRequest, DispatchResultSummary,
    DispatchSetupAuditEvent, DispatchStatusRequest, DispatchStatusSummaryResponse,
    DispatchSubmitRequest, DispatchSubmitResponse, DispatchTurnKind,
    DispatchWorkspaceBundleBeginRequest, DispatchWorkspaceBundleBeginResponse,
    DispatchWorkspaceBundleChunkRequest, DispatchWorkspaceBundleChunkResponse,
    DispatchWorkspaceBundleCommitRequest, DispatchWorkspaceBundleCommitResponse,
    DispatchWorkspaceProbe, DispatchWorkspaceProvisionRequest, DispatchWorkspaceProvisionResponse,
    DispatchWorkspaceProvisionSourceRequest, DispatchWorkspaceProvisionSourceResponse,
    DispatchWorkspaceSyncChunkRequest, DispatchWorkspaceSyncChunkResponse,
    DispatchWorkspaceSyncRequest, DispatchWorkspaceSyncResponse, DispatchWorkspaceSyncedChange,
};
// Dispatch phase two: peer import, publish and the question mailbox.
pub(crate) use openbitfun_services_core::dispatch_contract::wire::{
    DispatchPeerImportCommitRequest, DispatchPeerImportCommitResponse, DispatchPeerImportNeed,
    DispatchPendingQuestion, DispatchWorkspacePublishRequest, DispatchWorkspacePublishResponse,
};

pub(crate) const MAX_DISPATCH_TEXT_BYTES: usize = 32 * 1024;

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DispatchProbeResponse {
    pub(crate) product_id: String,
    pub(crate) data_namespace: String,
    pub(crate) protocol_version: u32,
    pub(crate) cli_version: String,
    pub(crate) os: String,
    pub(crate) arch: String,
    pub(crate) capabilities: Vec<String>,
    pub(crate) model_configured: bool,
    pub(crate) available_models: Vec<String>,
    pub(crate) model_catalog: AIModelCatalog,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) default_model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) model_diagnostic: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) workspace: Option<DispatchWorkspaceProbe>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(try_from = "DispatchAnswerWireRequest")]
pub(crate) struct DispatchAnswerRequest {
    pub(crate) job_id: String,
    pub(crate) request_id: String,
    pub(crate) reply: PermissionReply,
}

/// `answer` for a waiting `AskUserQuestion` (`user_question_mailbox_v1`):
/// `answers` replaces `reply`. The answers are the Runtime's own shape
/// (question index to the chosen label or labels).
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DispatchQuestionAnswerRequest {
    pub(crate) job_id: String,
    pub(crate) request_id: String,
    pub(crate) answers: serde_json::Value,
}

// `deny_unknown_fields` cannot recognize the fields consumed by a flattened,
// internally tagged enum. Keep the existing flat wire shape strict, then let
// the shared permission contract validate the reply itself.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DispatchAnswerWireRequest {
    job_id: String,
    request_id: String,
    reply: String,
    #[serde(default)]
    feedback: Option<String>,
}

impl TryFrom<DispatchAnswerWireRequest> for DispatchAnswerRequest {
    type Error = serde_json::Error;

    fn try_from(request: DispatchAnswerWireRequest) -> Result<Self, Self::Error> {
        let reply = serde_json::from_value(serde_json::json!({
            "reply": request.reply,
            "feedback": request.feedback,
        }))?;
        Ok(Self {
            job_id: request.job_id,
            request_id: request.request_id,
            reply,
        })
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub(crate) enum DispatchEvent {
    Audit {
        timestamp: String,
        action: String,
        details: serde_json::Value,
    },
    JobState {
        timestamp: String,
        state: DispatchJobState,
        #[serde(skip_serializing_if = "Option::is_none")]
        message: Option<String>,
    },
    AgentEvent {
        timestamp: String,
        event: serde_json::Value,
        #[serde(rename = "frontendEventName", skip_serializing_if = "Option::is_none")]
        frontend_event_name: Option<String>,
        #[serde(rename = "frontendPayload", skip_serializing_if = "Option::is_none")]
        frontend_payload: Option<serde_json::Value>,
    },
    PermissionRejected {
        timestamp: String,
        request: serde_json::Value,
        reason: String,
    },
}

impl DispatchEvent {
    pub(crate) fn setup_audit(event: DispatchSetupAuditEvent) -> Self {
        Self::Audit {
            timestamp: event.timestamp,
            action: event.action,
            details: event.details,
        }
    }

    pub(crate) fn approval_policy_selected(policy: DispatchApprovalPolicy) -> Self {
        Self::Audit {
            timestamp: chrono::Utc::now().to_rfc3339(),
            action: "approvalPolicySelected".to_string(),
            details: serde_json::json!({ "approvalPolicy": policy }),
        }
    }

    pub(crate) fn model_selected(model: Option<&str>) -> Self {
        Self::Audit {
            timestamp: chrono::Utc::now().to_rfc3339(),
            action: "modelSelected".to_string(),
            details: serde_json::json!({ "model": model }),
        }
    }

    pub(crate) fn cancel_requested() -> Self {
        Self::Audit {
            timestamp: chrono::Utc::now().to_rfc3339(),
            action: "cancelRequested".to_string(),
            details: serde_json::json!({}),
        }
    }

    pub(crate) fn permission_pending(request_id: &str) -> Self {
        Self::Audit {
            timestamp: chrono::Utc::now().to_rfc3339(),
            action: "permissionPending".to_string(),
            details: serde_json::json!({ "requestId": request_id }),
        }
    }

    pub(crate) fn permission_resolved(request_id: &str) -> Self {
        Self::Audit {
            timestamp: chrono::Utc::now().to_rfc3339(),
            action: "permissionResolved".to_string(),
            details: serde_json::json!({ "requestId": request_id }),
        }
    }

    pub(crate) fn question_pending(request_id: &str) -> Self {
        Self::Audit {
            timestamp: chrono::Utc::now().to_rfc3339(),
            action: "questionPending".to_string(),
            details: serde_json::json!({ "requestId": request_id }),
        }
    }

    pub(crate) fn question_resolved(request_id: &str, outcome: &str) -> Self {
        Self::Audit {
            timestamp: chrono::Utc::now().to_rfc3339(),
            action: "questionResolved".to_string(),
            details: serde_json::json!({ "requestId": request_id, "outcome": outcome }),
        }
    }

    pub(crate) fn branch_published(response: &DispatchWorkspacePublishResponse) -> Self {
        Self::Audit {
            timestamp: chrono::Utc::now().to_rfc3339(),
            action: "branchPublished".to_string(),
            details: serde_json::to_value(response).unwrap_or_default(),
        }
    }

    pub(crate) fn message_appended(message_id: &str) -> Self {
        Self::Audit {
            timestamp: chrono::Utc::now().to_rfc3339(),
            action: "messageAppended".to_string(),
            details: serde_json::json!({ "messageId": message_id }),
        }
    }

    pub(crate) fn oversized_event_omitted(encoded_bytes: usize, max_bytes: usize) -> Self {
        Self::Audit {
            timestamp: chrono::Utc::now().to_rfc3339(),
            action: "eventOmitted".to_string(),
            details: serde_json::json!({
                "reason": "eventTooLarge",
                "encodedBytes": encoded_bytes,
                "maxBytes": max_bytes,
            }),
        }
    }

    pub(crate) fn job_state(state: DispatchJobState, message: impl Into<Option<String>>) -> Self {
        Self::JobState {
            timestamp: chrono::Utc::now().to_rfc3339(),
            state,
            message: message.into(),
        }
    }

    pub(crate) fn agent_event(
        event: serde_json::Value,
        frontend_projection: Option<(String, serde_json::Value)>,
    ) -> Self {
        let (frontend_event_name, frontend_payload) = frontend_projection
            .map(|(name, payload)| (Some(name), Some(payload)))
            .unwrap_or((None, None));
        Self::AgentEvent {
            timestamp: chrono::Utc::now().to_rfc3339(),
            event,
            frontend_event_name,
            frontend_payload,
        }
    }

    pub(crate) fn permission_rejected(
        request: serde_json::Value,
        reason: impl Into<String>,
    ) -> Self {
        Self::PermissionRejected {
            timestamp: chrono::Utc::now().to_rfc3339(),
            request,
            reason: reason.into(),
        }
    }
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DispatchStatusResponse {
    pub(crate) state: DispatchJobState,
    pub(crate) cursor: u64,
    pub(crate) events: Vec<DispatchEvent>,
    pub(crate) pending_permissions: Vec<PermissionRequest>,
    /// Waiting `AskUserQuestion` calls (`user_question_mailbox_v1`).
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub(crate) pending_questions: Vec<DispatchPendingQuestion>,
    pub(crate) cursor_reset: bool,
    pub(crate) history_truncated: bool,
    pub(crate) event_log_complete: bool,
    pub(crate) omitted_event_count: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) last_error: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn permission_answers_accept_existing_flat_controller_payloads() {
        for reply in [
            PermissionReply::Once,
            PermissionReply::Always,
            PermissionReply::Reject { feedback: None },
            PermissionReply::Reject {
                feedback: Some("Use a read-only command".to_string()),
            },
        ] {
            let mut payload = serde_json::to_value(&reply).expect("serialize shared reply");
            payload["jobId"] = "job-1".into();
            payload["requestId"] = "request-1".into();
            assert_eq!(
                serde_json::from_value::<DispatchAnswerRequest>(payload)
                    .expect("decode existing flat answer"),
                DispatchAnswerRequest {
                    job_id: "job-1".to_string(),
                    request_id: "request-1".to_string(),
                    reply,
                }
            );
        }
    }

    #[test]
    fn permission_answers_reject_unknown_fields_and_invalid_replies() {
        let base = serde_json::json!({
            "jobId": "job-1", "requestId": "request-1", "reply": "once"
        });
        for (field, value) in [
            ("unexpected", serde_json::json!(true)),
            ("reply", serde_json::json!("approve")),
            ("reply", serde_json::json!({"reply": "once"})),
            ("feedback", serde_json::json!(false)),
            ("jobId", serde_json::Value::Null),
            ("requestId", serde_json::Value::Null),
        ] {
            let mut payload = base.clone();
            payload[field] = value;
            assert!(serde_json::from_value::<DispatchAnswerRequest>(payload).is_err());
        }
    }

    #[test]
    fn wire_names_are_camel_case_and_policy_values_are_explicit() {
        let event = DispatchEvent::AgentEvent {
            timestamp: "2026-01-01T00:00:00Z".to_string(),
            event: serde_json::json!({"id": "event-1"}),
            frontend_event_name: Some("agentic://text-chunk".to_string()),
            frontend_payload: Some(serde_json::json!({"sessionId": "session-1"})),
        };
        let value = serde_json::to_value(event).expect("serialize event");
        assert_eq!(value["type"], "agentEvent");
        assert_eq!(value["frontendEventName"], "agentic://text-chunk");
        assert_eq!(value["frontendPayload"]["sessionId"], "session-1");

        assert_eq!(
            serde_json::to_value(DispatchApprovalPolicy::RejectAndReport)
                .expect("serialize policy"),
            "reject-and-report"
        );
        assert_eq!(
            serde_json::to_value(DispatchJobState::Running).expect("serialize state"),
            "running"
        );

        let list_entry = DispatchJobListEntry {
            job_id: "job-1".to_string(),
            session_id: "session-1".to_string(),
            state: DispatchJobState::Running,
            started_at: None,
            workspace_path: "/repo".to_string(),
            title: "Reasoning job".to_string(),
            agent_type: "Standard".to_string(),
            approval_policy: DispatchApprovalPolicy::Remote,
            model: Some("model-1".to_string()),
            reasoning_preset: Some("high".to_string()),
            submitter: None,
        };
        let value = serde_json::to_value(list_entry).expect("serialize list entry");
        assert_eq!(value["reasoningPreset"], "high");
    }
}

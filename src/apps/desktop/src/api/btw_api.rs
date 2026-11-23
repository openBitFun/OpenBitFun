//! BTW (side question) API
//!
//! Desktop adapter for the core `/btw` feature.
//!
//! `/btw` runs as an ephemeral child session that reuses the parent session's
//! full context snapshot while still flowing through the normal agentic event
//! pipeline.

use crate::api::agentic_api::desktop_session_scope;
use crate::api::app_state::AppState;
use crate::host::State;
use crate::runtime::DesktopRuntimeContext;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::Arc;

use openbitfun_core::agentic::coordination::{
    ConversationCoordinator, DialogSubmissionPolicy, DialogTriggerSource,
};
use openbitfun_core::agentic::image_analysis::ImageContextData;
use openbitfun_core::agentic::side_question::{BtwTurnWatch, BTW_TURN_POLL_INTERVAL};
use openbitfun_core::service::workspace::WorkspaceKind;

fn desktop_btw_submission_policy() -> DialogSubmissionPolicy {
    DialogSubmissionPolicy::for_source(DialogTriggerSource::DesktopUi)
}

fn trimmed_opt(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BtwAskStreamRequest {
    pub request_id: String,
    pub session_id: String,
    #[serde(default)]
    pub workspace_id: Option<String>,
    #[serde(default)]
    pub workspace_path: Option<String>,
    #[serde(default)]
    pub remote_connection_id: Option<String>,
    #[serde(default)]
    pub remote_ssh_host: Option<String>,
    pub question: String,
    pub child_session_id: String,
    pub child_session_name: Option<String>,
    pub parent_dialog_turn_id: Option<String>,
    pub parent_turn_index: Option<usize>,
    /// Optional model id override. Supports "fast"/"primary" aliases.
    pub model_id: Option<String>,
    #[serde(default)]
    pub image_contexts: Option<Vec<ImageContextData>>,
    /// Optional presentation metadata. The question remains readable by older hosts.
    #[serde(default)]
    pub user_message_metadata: Option<serde_json::Value>,
    #[serde(default)]
    pub initial_model_selection: Option<openbitfun_runtime_ports::AgentSessionModelSelection>,
    /// Requires btw_model_pool_selection_v1; omitted uses the host BTW default.
    #[serde(default)]
    pub initial_model_target: Option<openbitfun_runtime_ports::AgentSessionModelTargetSelection>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BtwAskStreamResponse {
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_target: Option<openbitfun_core_types::model_pool::SessionModelTarget>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BtwCancelRequest {
    pub request_id: String,
}

// @backend-command
pub async fn btw_cancel(
    state: State<'_, AppState>,
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    request: BtwCancelRequest,
) -> Result<(), String> {
    if request.request_id.trim().is_empty() {
        return Err("requestId is required".to_string());
    }

    state
        .side_question_runtime
        .cancel(&request.request_id)
        .await;
    if let Some(active_turn) = state
        .side_question_runtime
        .get_btw_turn(&request.request_id)
        .await
    {
        coordinator
            .cancel_dialog_turn(&active_turn.session_id, &active_turn.turn_id)
            .await
            .map_err(|e| e.to_string())?;
        state
            .side_question_runtime
            .remove(&request.request_id)
            .await;
    }
    Ok(())
}

async fn ensure_btw_parent_session_loaded(
    state: &AppState,
    runtime: &DesktopRuntimeContext,
    coordinator: &ConversationCoordinator,
    request: &BtwAskStreamRequest,
) -> Result<(), String> {
    if coordinator
        .get_session_manager()
        .get_session(&request.session_id)
        .is_some()
    {
        return Ok(());
    }

    let workspace_id = trimmed_opt(request.workspace_id.as_deref());
    let workspace_path = trimmed_opt(request.workspace_path.as_deref());
    if workspace_id.is_some() || workspace_path.is_some() {
        let scope = desktop_session_scope(
            workspace_id.clone(),
            workspace_path.unwrap_or_default(),
            trimmed_opt(request.remote_connection_id.as_deref()),
            trimmed_opt(request.remote_ssh_host.as_deref()),
        );
        match runtime
            .session_application()
            .ensure_session_loaded(scope, &request.session_id, false)
            .await
        {
            Ok(()) => return Ok(()),
            Err(error) => {
                // Fall through to opened/assistant workspace scan if the caller
                // supplied a stale or mismatched workspace hint; otherwise keep
                // the original error when no fallback workspace owns the session.
                if coordinator
                    .get_session_manager()
                    .get_session(&request.session_id)
                    .is_some()
                {
                    return Ok(());
                }
                let _ = error;
            }
        }
    }

    let mut candidates = Vec::new();
    let mut seen = HashSet::new();
    if let Some(current) = state.workspace_service.get_current_workspace().await {
        if seen.insert(current.id.clone()) {
            candidates.push(current);
        }
    }
    let mut opened = state.workspace_service.get_opened_workspaces().await;
    opened.sort_by_key(|ws| std::cmp::Reverse(ws.last_accessed));
    for ws in opened {
        if seen.insert(ws.id.clone()) {
            candidates.push(ws);
        }
    }
    for ws in state.workspace_service.get_assistant_workspaces().await {
        if seen.insert(ws.id.clone()) {
            candidates.push(ws);
        }
    }

    for workspace in candidates {
        let is_remote = workspace.workspace_kind == WorkspaceKind::Remote;
        let remote_connection_id = if is_remote {
            workspace.remote_ssh_connection_id().map(ToOwned::to_owned)
        } else {
            None
        };
        let remote_ssh_host = if is_remote {
            workspace
                .metadata
                .get("sshHost")
                .and_then(serde_json::Value::as_str)
                .map(ToOwned::to_owned)
        } else {
            None
        };
        let scope = desktop_session_scope(
            Some(workspace.id),
            workspace.root_path.to_string_lossy().into_owned(),
            remote_connection_id,
            remote_ssh_host,
        );
        if runtime
            .session_application()
            .ensure_session_loaded(scope, &request.session_id, false)
            .await
            .is_ok()
            && coordinator
                .get_session_manager()
                .get_session(&request.session_id)
                .is_some()
        {
            return Ok(());
        }
    }

    Ok(())
}

// @backend-command
pub async fn btw_ask_stream(
    state: State<'_, AppState>,
    runtime: State<'_, DesktopRuntimeContext>,
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    request: BtwAskStreamRequest,
) -> Result<BtwAskStreamResponse, String> {
    if request.request_id.trim().is_empty() {
        return Err("requestId is required".to_string());
    }
    if request.session_id.trim().is_empty() {
        return Err("sessionId is required".to_string());
    }
    if request.question.trim().is_empty() {
        return Err("question is required".to_string());
    }
    let child_session_id = request.child_session_id.trim();
    if child_session_id.is_empty() {
        return Err("childSessionId is required".to_string());
    }

    ensure_btw_parent_session_loaded(
        state.inner(),
        runtime.inner(),
        coordinator.inner(),
        &request,
    )
    .await?;

    let child_session_id = child_session_id.to_string();
    let child_session_name = request.child_session_name.clone();
    let model_id = request.model_id.clone();
    let image_contexts = request.image_contexts;

    let turn_id = coordinator
        .start_btw_turn(
            &request.request_id,
            &request.session_id,
            &child_session_id,
            child_session_name.as_deref(),
            &request.question,
            desktop_btw_submission_policy(),
            model_id.as_deref(),
            image_contexts,
            request.parent_dialog_turn_id.as_deref(),
            request.parent_turn_index,
            request.user_message_metadata,
            request.initial_model_selection,
            request.initial_model_target,
        )
        .await
        .map_err(|e| e.to_string())?;

    let model_target = coordinator
        .get_session_manager()
        .get_session(&child_session_id)
        .map(openbitfun_core::agentic::session::session_model_target);
    state
        .side_question_runtime
        .register_btw_turn(
            request.request_id.clone(),
            child_session_id.clone(),
            turn_id.clone(),
        )
        .await;
    let runtime = state.side_question_runtime.clone();
    let request_id = request.request_id.clone();
    let coordinator = coordinator.inner().clone();
    tokio::spawn(async move {
        let mut watch = BtwTurnWatch::new();
        loop {
            let processing = matches!(
                coordinator.get_session_manager().get_session_state(&child_session_id),
                Some(openbitfun_core::agentic::core::SessionState::Processing {
                    current_turn_id,
                    ..
                }) if current_turn_id == turn_id
            );
            if watch.should_release(processing) {
                runtime.remove(&request_id).await;
                break;
            }
            tokio::time::sleep(BTW_TURN_POLL_INTERVAL).await;
        }
    });

    Ok(BtwAskStreamResponse {
        ok: true,
        model_target,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn btw_admission_response_reads_legacy_and_keeps_new_target_optional_for_old_readers() {
        let legacy: BtwAskStreamResponse =
            serde_json::from_value(serde_json::json!({"ok":true})).unwrap();
        assert!(legacy.model_target.is_none());
        assert_eq!(
            serde_json::to_value(legacy).unwrap(),
            serde_json::json!({"ok":true})
        );
        let current: BtwAskStreamResponse = serde_json::from_value(serde_json::json!({
            "ok":true, "modelTarget": { "sessionId":"child", "selection":{"kind":"model","model_ref":"side-model"}, "reasoningPreset":null },
        })).unwrap();
        #[derive(Deserialize)]
        struct LegacyResponse {
            ok: bool,
        }
        let old_reader: LegacyResponse =
            serde_json::from_value(serde_json::to_value(current).unwrap()).unwrap();
        assert!(old_reader.ok);
    }

    #[test]
    fn btw_request_reads_legacy_payloads_and_round_trips_optional_metadata() {
        let legacy = serde_json::json!({
            "requestId": "request-1",
            "sessionId": "parent-1",
            "childSessionId": "child-1",
            "question": "A readable quote and question"
        });
        let request: BtwAskStreamRequest = serde_json::from_value(legacy.clone()).unwrap();
        assert!(request.user_message_metadata.is_none());
        assert!(request.initial_model_selection.is_none());
        assert!(request.initial_model_target.is_none());
        let round_trip: BtwAskStreamRequest =
            serde_json::from_value(serde_json::to_value(request).unwrap()).unwrap();
        assert_eq!(round_trip.question, legacy["question"]);

        let metadata = serde_json::json!({
            "composerPresentation": { "version": 1, "segments": [] },
            "sessionReferences": [{ "sessionId": "reference-1" }],
            "permission_mode": "default"
        });
        let mut current = legacy;
        current["userMessageMetadata"] = metadata.clone();
        current["initialModelSelection"] = serde_json::json!({
            "modelId": "primary", "reasoningPreset": "high"
        });
        current["futureField"] = serde_json::json!(true);
        let request: BtwAskStreamRequest = serde_json::from_value(current).unwrap();
        let round_trip: BtwAskStreamRequest =
            serde_json::from_value(serde_json::to_value(request).unwrap()).unwrap();
        assert_eq!(round_trip.user_message_metadata, Some(metadata));
        assert_eq!(
            round_trip
                .initial_model_selection
                .unwrap()
                .reasoning_preset
                .as_deref(),
            Some("high")
        );
        let auto: openbitfun_runtime_ports::AgentSessionModelSelection =
            serde_json::from_value(serde_json::json!({ "modelId": "primary" })).unwrap();
        assert!(auto.reasoning_preset.is_none());
    }

    #[test]
    fn btw_request_round_trips_typed_pool_and_model_choices() {
        for target in [
            serde_json::json!({ "selection": { "kind": "pool", "pool_id": "pool-a" } }),
            serde_json::json!({ "selection": { "kind": "model", "model_ref": "model-b" }, "reasoningPreset": "high" }),
        ] {
            let request: BtwAskStreamRequest = serde_json::from_value(serde_json::json!({
                "requestId": "request-1", "sessionId": "parent", "childSessionId": "child",
                "question": "Why?", "initialModelTarget": target,
            }))
            .unwrap();
            assert!(request.model_id.is_none());
            assert!(request.initial_model_selection.is_none());
            assert_eq!(
                serde_json::to_value(request).unwrap()["initialModelTarget"],
                target
            );
        }
    }

    #[test]
    fn btw_turns_use_the_desktop_chat_output_surface() {
        assert_eq!(
            desktop_btw_submission_policy(),
            DialogSubmissionPolicy::for_source(DialogTriggerSource::DesktopUi)
        );
    }
}

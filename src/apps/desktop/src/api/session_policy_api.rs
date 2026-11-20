//! Turn and session policy commands (logic batch 3).
//!
//! Every client used to decide these rules on its own: whether a message written
//! during a turn steers or queues, which modes a session may switch to, which
//! slash commands exist, how a turn is stopped and which sessions are unread.
//! These commands answer them from the backend owners so the NSH UI, mobile and
//! IM bots (which reach the same core functions through remote-connect) agree.

use crate::api::agentic_api::{
    desktop_image_attachment, desktop_session_scope, desktop_user_message_metadata,
    resolve_missing_image_payloads,
};
use crate::api::app_state::AppState;
use crate::host::{HostHandle, State};
use crate::runtime::DesktopRuntimeContext;
use log::{error, warn};
use openbitfun_agent_runtime::sdk::{
    AgentDialogTurnExecution, AgentDialogTurnRequest, AgentSubmissionSource,
    AgentTurnCancellationRequest, AgentTurnInterruptionRequest,
};
use openbitfun_core::agentic::coordination::{
    submit_user_message_with_runtime, ConversationCoordinator, DialogScheduler,
    DialogSubmissionPolicy, DialogTriggerSource, SessionCommandOutcome, UserMessageSubmitOutcome,
};
use openbitfun_core::agentic::image_analysis::ImageContextData;
use openbitfun_core::agentic::session_policy::{
    build_session_mode_catalog, session_commands, SessionCommandDescriptor, SessionCommandId,
    SessionModeCatalog, SessionModeFacts, SessionModePreference, SessionModeSource,
};
use openbitfun_core::service::config::types::{AppFlowChatConfig, ChatInputSendDuringTurn};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

// ── submit_user_message ─────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitUserMessageRequest {
    pub session_id: String,
    /// The session's own workspace. Optional: a session that is not loaded is
    /// restored from its persisted binding, never from the caller's open UI.
    #[serde(default)]
    pub workspace_id: Option<String>,
    #[serde(default)]
    pub workspace_path: Option<String>,
    #[serde(default)]
    pub remote_connection_id: Option<String>,
    #[serde(default)]
    pub remote_ssh_host: Option<String>,
    pub text: String,
    #[serde(default)]
    pub display_text: Option<String>,
    /// Defaults to the agent the session is bound to.
    #[serde(default)]
    pub agent_type: Option<String>,
    #[serde(default)]
    pub attachments: Vec<ImageContextData>,
    /// Client-chosen id, so a retried submission is recognized.
    #[serde(default)]
    pub turn_id: Option<String>,
    #[serde(default)]
    pub user_message_metadata: Option<serde_json::Value>,
    /// An explicit choice for this one message (`immediate` steers, `queue`
    /// waits); omitted, the stored `app.flow_chat.send_during_turn` applies.
    #[serde(default)]
    pub send_during_turn: Option<ChatInputSendDuringTurn>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SubmitUserMessageResponse {
    /// `started`, `steered` or `queued`.
    pub outcome: &'static str,
    /// The turn the message started, steered or will start.
    pub turn_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub queue_item_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub steering_id: Option<String>,
}

impl From<UserMessageSubmitOutcome> for SubmitUserMessageResponse {
    fn from(outcome: UserMessageSubmitOutcome) -> Self {
        match outcome {
            UserMessageSubmitOutcome::Started { turn_id, .. } => Self {
                outcome: "started",
                turn_id,
                queue_item_id: None,
                steering_id: None,
            },
            UserMessageSubmitOutcome::Steered {
                turn_id,
                steering_id,
                ..
            } => Self {
                outcome: "steered",
                turn_id,
                queue_item_id: None,
                steering_id: Some(steering_id),
            },
            UserMessageSubmitOutcome::Queued { turn_id, .. } => Self {
                outcome: "queued",
                queue_item_id: Some(turn_id.clone()),
                turn_id,
                steering_id: None,
            },
        }
    }
}

fn trimmed(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// The composer's send: the backend applies `app.flow_chat.send_during_turn`
/// and reports whether the message started a turn, steered the running one or
/// waits in the host queue. Remote `send_message` and IM bots run the same
/// core function.
// @backend-command
pub async fn submit_user_message(
    runtime: State<'_, DesktopRuntimeContext>,
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    scheduler: State<'_, Arc<DialogScheduler>>,
    request: SubmitUserMessageRequest,
) -> Result<SubmitUserMessageResponse, String> {
    let session_id = request.session_id.trim().to_string();
    if session_id.is_empty() {
        return Err("session_id is required".to_string());
    }
    let workspace_id = trimmed(request.workspace_id);
    let workspace_path = trimmed(request.workspace_path);
    if workspace_id.is_some() || workspace_path.is_some() {
        runtime
            .session_application()
            .ensure_session_loaded(
                desktop_session_scope(
                    workspace_id.clone(),
                    workspace_path.clone().unwrap_or_default(),
                    request.remote_connection_id.clone(),
                    request.remote_ssh_host.clone(),
                ),
                &session_id,
                false,
            )
            .await
            .map_err(|error| error.to_string())?;
    }
    let attachments = if request.attachments.is_empty() {
        Vec::new()
    } else {
        resolve_missing_image_payloads(request.attachments)?
            .into_iter()
            .map(desktop_image_attachment)
            .collect()
    };
    let agent_type = match trimmed(request.agent_type) {
        Some(agent_type) => agent_type,
        None => coordinator
            .get_session_manager()
            .get_session(&session_id)
            .map(|session| session.agent_type.clone())
            .unwrap_or_default(),
    };
    let outcome = submit_user_message_with_runtime(
        runtime.agent_runtime(),
        scheduler.inner(),
        AgentDialogTurnRequest {
            session_id,
            message: request.text,
            output_schema: None,
            original_message: trimmed(request.display_text),
            turn_id: trimmed(request.turn_id),
            execution: AgentDialogTurnExecution::default(),
            agent_type,
            workspace_path,
            workspace_id,
            remote_connection_id: request.remote_connection_id,
            remote_ssh_host: request.remote_ssh_host,
            policy: DialogSubmissionPolicy::for_source(DialogTriggerSource::DesktopUi),
            reply_route: None,
            prepended_reminders: Vec::new(),
            attachments,
            metadata: desktop_user_message_metadata(request.user_message_metadata),
        },
        request.send_during_turn,
    )
    .await
    .map_err(|error| format!("Failed to submit message: {}", error.message))?;
    Ok(outcome.into())
}

// ── Mode catalog ────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetSessionModeCatalogRequest {
    #[serde(default)]
    pub workspace_id: Option<String>,
    #[serde(default)]
    pub workspace_path: Option<String>,
    #[serde(default)]
    pub remote_connection_id: Option<String>,
    #[serde(default)]
    pub remote_ssh_host: Option<String>,
    #[serde(default)]
    pub session_id: Option<String>,
}

async fn flow_chat_preference(app_state: &AppState) -> SessionModePreference {
    let config = app_state
        .config_service
        .get_config::<AppFlowChatConfig>(Some("app.flow_chat"))
        .await
        .unwrap_or_default();
    SessionModePreference {
        strategy: config.default_mode_strategy,
        default_mode_id: config.default_mode_id,
        last_mode_id: config.last_mode_id,
    }
}

/// A started session is one that already ran a turn; its binding is fixed.
fn session_mode_facts(
    coordinator: &ConversationCoordinator,
    session_id: &str,
) -> Option<SessionModeFacts> {
    coordinator
        .get_session_manager()
        .get_session(session_id)
        .map(|session| SessionModeFacts {
            mode_id: session.agent_type.clone(),
            started: !session.dialog_turn_ids.is_empty(),
        })
}

/// The modes a composer offers for a workspace (and optionally a session), in
/// display order, with which entries the session can switch to and the default
/// a new session starts as.
// @backend-command
pub async fn get_session_mode_catalog(
    state: State<'_, AppState>,
    runtime: State<'_, DesktopRuntimeContext>,
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    startup_trace: State<'_, crate::startup_trace::DesktopStartupTrace>,
    request: GetSessionModeCatalogRequest,
) -> Result<SessionModeCatalog, String> {
    let session_id = trimmed(request.session_id);
    let modes = crate::api::agentic_api::get_available_modes(
        state.clone(),
        runtime.clone(),
        startup_trace,
        Some(crate::api::agentic_api::GetAvailableModesRequest {
            include_subagent_counts: None,
            workspace_id: request.workspace_id.clone(),
            workspace_path: request.workspace_path.clone(),
            remote_connection_id: request.remote_connection_id.clone(),
            remote_ssh_host: request.remote_ssh_host.clone(),
        }),
    )
    .await?;
    let rows: Vec<SessionModeSource> = modes
        .into_iter()
        .map(|mode| SessionModeSource {
            id: mode.id,
            name: mode.name,
            description: mode.description,
        })
        .collect();
    let facts = match session_id.as_deref() {
        Some(session_id) => {
            if session_mode_facts(&coordinator, session_id).is_none() {
                let workspace_id = trimmed(request.workspace_id);
                let workspace_path = trimmed(request.workspace_path);
                if workspace_id.is_some() || workspace_path.is_some() {
                    if let Err(error) = runtime
                        .session_application()
                        .ensure_session_loaded(
                            desktop_session_scope(
                                workspace_id,
                                workspace_path.unwrap_or_default(),
                                request.remote_connection_id,
                                request.remote_ssh_host,
                            ),
                            session_id,
                            false,
                        )
                        .await
                    {
                        warn!(
                            "Mode catalog could not load its session: session_id={}, error={}",
                            session_id, error
                        );
                    }
                }
            }
            session_mode_facts(&coordinator, session_id)
        }
        None => None,
    };
    let preference = flow_chat_preference(&state).await;
    Ok(build_session_mode_catalog(
        &rows,
        &preference,
        facts.as_ref(),
    ))
}

/// Records the user's explicit mode choice the way the desktop harness control
/// does, so every client starts the next session there.
pub(crate) async fn remember_last_mode(app: &HostHandle, mode_id: &str) {
    let Some(id) =
        openbitfun_core::agentic::session_policy::eligible_default_mode_id(Some(mode_id))
    else {
        return;
    };
    if let Err(error) = crate::openbitfun_control_host::set_config_from_gui(
        app,
        "app.flow_chat.last_mode_id",
        serde_json::Value::String(id),
        None,
    )
    .await
    {
        warn!("Failed to record last mode choice: error={}", error);
    }
}

// ── Session commands ────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListSessionCommandsRequest {
    #[serde(default)]
    pub session_id: Option<String>,
}

/// The slash commands a session offers right now, shared with the bot router.
// @backend-command
pub async fn list_session_commands(
    scheduler: State<'_, Arc<DialogScheduler>>,
    request: ListSessionCommandsRequest,
) -> Result<Vec<SessionCommandDescriptor>, String> {
    let running = trimmed(request.session_id)
        .is_some_and(|session_id| scheduler.is_session_busy_or_queued(&session_id));
    Ok(session_commands(running))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteSessionCommandRequest {
    pub session_id: String,
    pub id: String,
    #[serde(default)]
    pub arg: Option<String>,
    #[serde(default)]
    pub workspace_id: Option<String>,
    #[serde(default)]
    pub workspace_path: Option<String>,
    #[serde(default)]
    pub remote_connection_id: Option<String>,
    #[serde(default)]
    pub remote_ssh_host: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteSessionCommandResponse {
    pub id: SessionCommandId,
    /// `compaction_started`, `init_started` or `reloaded`.
    pub outcome: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
}

// @backend-command
pub async fn execute_session_command(
    runtime: State<'_, DesktopRuntimeContext>,
    scheduler: State<'_, Arc<DialogScheduler>>,
    request: ExecuteSessionCommandRequest,
) -> Result<ExecuteSessionCommandResponse, String> {
    let id = SessionCommandId::parse(&request.id)
        .ok_or_else(|| format!("unknown_session_command: {}", request.id.trim()))?;
    let session_id = request.session_id.trim().to_string();
    let workspace_id = trimmed(request.workspace_id);
    let workspace_path = trimmed(request.workspace_path);
    if workspace_id.is_some() || workspace_path.is_some() {
        runtime
            .session_application()
            .ensure_session_loaded(
                desktop_session_scope(
                    workspace_id,
                    workspace_path.unwrap_or_default(),
                    request.remote_connection_id,
                    request.remote_ssh_host,
                ),
                &session_id,
                false,
            )
            .await
            .map_err(|error| error.to_string())?;
    }
    let outcome = scheduler
        .execute_session_command(
            &session_id,
            id,
            request.arg.as_deref(),
            DialogTriggerSource::DesktopUi,
        )
        .await
        .map_err(|error| error.to_string())?;
    Ok(ExecuteSessionCommandResponse {
        id,
        turn_id: outcome.turn_id().map(str::to_string),
        outcome: match outcome {
            SessionCommandOutcome::CompactionStarted { .. } => "compaction_started",
            SessionCommandOutcome::InitStarted { .. } => "init_started",
            SessionCommandOutcome::Reloaded { .. } => "reloaded",
        },
    })
}

// ── stop_dialog_turn ────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StopDialogTurnRequest {
    pub session_id: String,
    /// The turn the client saw running; the host's own active turn otherwise.
    #[serde(default)]
    pub dialog_turn_id: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StopDialogTurnResponse {
    pub turn_id: String,
    /// `interrupted` (recoverable) or `cancelled` (the fallback).
    pub method: &'static str,
}

/// Stops a running turn: a recoverable interruption first, hard cancellation
/// when the runtime cannot interrupt this session. Every client gets the same
/// stop, whatever it knows about interruption support.
// @backend-command
pub async fn stop_dialog_turn(
    runtime: State<'_, DesktopRuntimeContext>,
    app_state: State<'_, AppState>,
    scheduler: State<'_, Arc<DialogScheduler>>,
    request: StopDialogTurnRequest,
) -> Result<StopDialogTurnResponse, String> {
    let session_id = request.session_id.trim().to_string();
    if session_id.is_empty() {
        return Err("session_id is required".to_string());
    }
    let turn_id = trimmed(request.dialog_turn_id)
        .or_else(|| scheduler.active_dialog_turn_id(&session_id))
        .ok_or_else(|| format!("No running turn to stop for session: {session_id}"))?;

    if let Some(acp_client_service) = app_state.acp_client_service.as_ref() {
        match acp_client_service
            .cancel_openbitfun_session(&session_id)
            .await
        {
            Ok(true) => {
                return Ok(StopDialogTurnResponse {
                    turn_id,
                    method: "cancelled",
                })
            }
            Ok(false) => {}
            Err(error) => return Err(format!("Failed to cancel ACP dialog turn: {error}")),
        }
    }

    let interruption = runtime
        .agent_runtime()
        .interrupt_turn(AgentTurnInterruptionRequest {
            session_id: session_id.clone(),
            turn_id: turn_id.clone(),
            source: Some(AgentSubmissionSource::DesktopUi),
            wait_timeout_ms: Some(30_000),
        })
        .await;
    let reason = match interruption {
        Ok(_) => {
            return Ok(StopDialogTurnResponse {
                turn_id,
                method: "interrupted",
            })
        }
        Err(error) => error.into_message(),
    };
    runtime
        .agent_runtime()
        .cancel_turn(AgentTurnCancellationRequest {
            session_id: session_id.clone(),
            turn_id: Some(turn_id.clone()),
            source: Some(AgentSubmissionSource::DesktopUi),
            requester_session_id: None,
            reason: Some(format!("recoverable interruption unavailable: {reason}")),
            wait_timeout_ms: None,
            cancel_descendants: true,
        })
        .await
        .map_err(|error| {
            error!(
                "Failed to stop dialog turn: session_id={}, turn_id={}, error={}",
                session_id, turn_id, error
            );
            format!("Failed to stop dialog turn: {}", error.into_message())
        })?;
    Ok(StopDialogTurnResponse {
        turn_id,
        method: "cancelled",
    })
}

// ── mark_session_seen ───────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkSessionSeenRequest {
    pub session_id: String,
    #[serde(default)]
    pub workspace_id: Option<String>,
    #[serde(default)]
    pub workspace_path: Option<String>,
    #[serde(default)]
    pub remote_connection_id: Option<String>,
    #[serde(default)]
    pub remote_ssh_host: Option<String>,
    /// The newest activity the reader saw (ms). Omitted for a live read, which
    /// acknowledges the current result; a migrated client mark sends it.
    #[serde(default)]
    pub seen_through_ms: Option<u64>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MarkSessionSeenResponse {
    pub changed: bool,
}

/// Acknowledges a session's unread result on the host, so every client stops
/// marking it unread.
// @backend-command
pub async fn mark_session_seen(
    runtime: State<'_, DesktopRuntimeContext>,
    request: MarkSessionSeenRequest,
) -> Result<MarkSessionSeenResponse, String> {
    let session_id = request.session_id.trim().to_string();
    if session_id.is_empty() {
        return Err("session_id is required".to_string());
    }
    let changed = runtime
        .session_application()
        .mark_session_seen(
            desktop_session_scope(
                trimmed(request.workspace_id),
                trimmed(request.workspace_path).unwrap_or_default(),
                request.remote_connection_id,
                request.remote_ssh_host,
            ),
            &session_id,
            request.seen_through_ms,
        )
        .await
        .map_err(|error| format!("Failed to mark session seen: {error}"))?;
    Ok(MarkSessionSeenResponse { changed })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn submit_outcomes_project_to_the_wire_shape() {
        let queued: SubmitUserMessageResponse = UserMessageSubmitOutcome::Queued {
            session_id: "s".into(),
            turn_id: "t".into(),
        }
        .into();
        assert_eq!(
            serde_json::to_value(&queued).unwrap(),
            serde_json::json!({"outcome": "queued", "turnId": "t", "queueItemId": "t"})
        );
        let steered: SubmitUserMessageResponse = UserMessageSubmitOutcome::Steered {
            session_id: "s".into(),
            turn_id: "running".into(),
            steering_id: "steer".into(),
        }
        .into();
        assert_eq!(
            serde_json::to_value(&steered).unwrap(),
            serde_json::json!({"outcome": "steered", "turnId": "running", "steeringId": "steer"})
        );
        let started: SubmitUserMessageResponse = UserMessageSubmitOutcome::Started {
            session_id: "s".into(),
            turn_id: "t".into(),
        }
        .into();
        assert_eq!(
            serde_json::to_value(&started).unwrap(),
            serde_json::json!({"outcome": "started", "turnId": "t"})
        );
    }

    #[test]
    fn requests_accept_the_client_shapes() {
        let submit: SubmitUserMessageRequest = serde_json::from_value(serde_json::json!({
            "sessionId": "s", "text": "hi", "attachments": []
        }))
        .unwrap();
        assert!(submit.workspace_id.is_none());
        assert!(submit.agent_type.is_none());
        assert!(submit.send_during_turn.is_none());
        let explicit: SubmitUserMessageRequest = serde_json::from_value(serde_json::json!({
            "sessionId": "s", "text": "hi", "sendDuringTurn": "queue"
        }))
        .unwrap();
        assert_eq!(
            explicit.send_during_turn,
            Some(ChatInputSendDuringTurn::Queue)
        );
        let seen: MarkSessionSeenRequest = serde_json::from_value(serde_json::json!({
            "sessionId": "s", "workspaceId": "w", "seenThroughMs": 12
        }))
        .unwrap();
        assert_eq!(seen.seen_through_ms, Some(12));
        let stop: StopDialogTurnRequest =
            serde_json::from_value(serde_json::json!({"sessionId": "s"})).unwrap();
        assert!(stop.dialog_turn_id.is_none());
        let command: ExecuteSessionCommandRequest = serde_json::from_value(
            serde_json::json!({"sessionId": "s", "id": "reload", "arg": "skills"}),
        )
        .unwrap();
        assert_eq!(
            SessionCommandId::parse(&command.id),
            Some(SessionCommandId::Reload)
        );
    }
}

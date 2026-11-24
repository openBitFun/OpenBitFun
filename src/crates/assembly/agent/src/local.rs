use crate::{
    permissions,
    read::{self, Reads},
    storage::Records,
};
use anyhow::{anyhow, bail, ensure, Result};
use openbitfun_agent_runtime::{
    event_queue::{EventQueue, SessionEventReceiver},
    message::{Message, MessageSemanticKind},
    model_round::{
        run_model_attempt, run_round_tools, ModelAttempt, ModelAttempts, ModelRoundLifecycle,
        StreamDisposition, StreamObservation,
    },
    permission::{PermissionRequestEventReceiver, PermissionRequestManager},
    scheduler::{execution::DialogExecution, ActiveDialogTurn},
    session::residency::SessionResidency,
    turn_execution::{RoundOutput, ToolFailureRecovery, TurnBoundary, TurnExecution},
};
use openbitfun_agent_stream::StreamProcessor;
use openbitfun_ai_adapters::{AIClient, AIConfig};
use openbitfun_runtime_ports::{
    AgentSubmissionSource, DialogSubmissionPolicy, PermissionReply, PermissionReplySource,
};
use openbitfun_services_core::{
    session::{
        DialogTurnData, DialogTurnKind, SessionMetadata, SessionWriteLock, TurnStatus,
        UserMessageData,
    },
    workspace_identity::{
        canonicalize_local_workspace_root, local_workspace_runtime_key,
        local_workspace_stable_storage_id,
    },
};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// Local text-model and file provider configuration. State and credentials are
/// scoped to this application instance. File and session operations run here.
#[derive(Clone)]
pub struct LocalAgent(Arc<LocalProviders>);
struct LocalProviders {
    workspace: PathBuf,
    sessions: PathBuf,
    project: String,
    client: AIClient,
    stream: StreamProcessor,
    events: Arc<EventQueue>,
    reader: openbitfun_services_core::workspace_reader::WorkspaceReader,
    permissions: Arc<PermissionRequestManager>,
    execution: DialogExecution<()>,
    residents: Arc<SessionResidency<SessionWriteLock>>,
}

impl LocalAgent {
    pub fn open(workspace: &Path, data_root: &Path, model: AIConfig) -> Result<Self> {
        ensure!(data_root.is_absolute(), "data root must be absolute");
        let (workspace, normalized) =
            canonicalize_local_workspace_root(workspace).map_err(anyhow::Error::msg)?;
        ensure!(workspace.is_dir(), "workspace must be a directory");
        openbitfun_services_core::tls_provider::ensure_ring_crypto_provider();
        let project = local_workspace_stable_storage_id(&normalized);
        let reader = openbitfun_services_core::workspace_reader::WorkspaceReader::open(&workspace)?;
        let events = Arc::new(EventQueue::new(Default::default()));
        Ok(Self(Arc::new(LocalProviders {
            sessions: data_root
                .join("projects")
                .join(local_workspace_runtime_key(&normalized))
                .join("sessions"),
            project,
            workspace,
            client: AIClient::new(model),
            stream: StreamProcessor::new(events.clone()),
            events,
            reader,
            permissions: permissions::request_manager(data_root.join("permissions")),
            execution: Default::default(),
            residents: Arc::new(SessionResidency::new(tokio::sync::Semaphore::MAX_PERMITS)),
        })))
    }

    pub fn subscribe_permissions(&self) -> PermissionRequestEventReceiver {
        self.0.permissions.subscribe()
    }

    pub async fn reply(&self, request_id: &str, reply: PermissionReply) -> Result<()> {
        ensure!(
            matches!(
                reply,
                PermissionReply::Once | PermissionReply::Reject { .. }
            ),
            "local Read supports one-time approval or rejection"
        );
        self.0
            .permissions
            .reply(request_id, reply, PermissionReplySource::User)
            .await?;
        Ok(())
    }

    pub async fn create_session(&self, name: &str) -> Result<LocalSession> {
        let id = Uuid::new_v4().to_string();
        let metadata = SessionMetadata::new(
            id.clone(),
            name.to_owned(),
            "agent".into(),
            self.0.client.config.model.clone(),
        );
        self.session(&id, Some(metadata)).await
    }
    pub async fn restore_session(&self, id: &str) -> Result<LocalSession> {
        self.session(id, None).await
    }
    async fn session(&self, id: &str, new: Option<SessionMetadata>) -> Result<LocalSession> {
        let records = Records::open(
            self.0.residents.clone(),
            &self.0.sessions,
            &self.0.workspace,
            &self.0.project,
            id,
            new,
        )
        .await?;
        Ok(LocalSession {
            id: id.into(),
            agent: self.clone(),
            records: Arc::new(Mutex::new(records)),
        })
    }
}

pub struct LocalSession {
    id: String,
    agent: LocalAgent,
    records: Arc<Mutex<Records>>,
}
impl LocalSession {
    pub fn subscribe_events(&self) -> SessionEventReceiver {
        self.agent.0.events.subscribe_session(&self.id)
    }

    pub fn id(&self) -> &str {
        &self.id
    }

    /// Dropping this future cancels the turn. The task retains the session's
    /// writer through permission cleanup and durable settlement.
    pub async fn run(
        &self,
        prompt: impl Into<String>,
        cancel: CancellationToken,
    ) -> Result<String> {
        let providers = self.agent.0.clone();
        let records = self.records.clone();
        let id = self.id.clone();
        let prompt = prompt.into();
        let token = cancel.child_token();
        let _on_drop = token.clone().drop_guard();
        tokio::spawn(async move {
            let _admission = tokio::select! {biased;
                _=token.cancelled()=>bail!("turn cancelled"),
                lock=providers.execution.lock_session(&id)=>lock,
            };
            let mut records = records.lock().await;
            ensure!(
                !records.write_failed,
                "session checkpoint failed; reopen the session before continuing"
            );
            let turn_id = Uuid::new_v4().to_string();
            let ts = now();
            let user_message = Message::user(prompt.clone())
                .with_turn_id(turn_id.clone())
                .with_semantic_kind(MessageSemanticKind::ActualUserInput);
            let mut turn = DialogTurnData::new_with_kind(
                DialogTurnKind::UserDialog,
                turn_id.clone(),
                records.turns.len(),
                id.clone(),
                Some(records.metadata.agent_type.clone()),
                UserMessageData {
                    id: user_message.id.clone(),
                    content: prompt.clone(),
                    timestamp: ts,
                    metadata: None,
                },
            );
            ensure!(
                records
                    .turns
                    .last()
                    .map_or(true, |t| t.status != TurnStatus::InProgress),
                "previous turn requires recovery"
            );
            let mut admission = providers.execution.admit_turn(
                &id,
                ActiveDialogTurn::new(
                    turn_id.clone(),
                    records.metadata.workspace_path.clone(),
                    None,
                    None,
                    records.metadata.agent_type.clone(),
                    prompt.clone(),
                    None,
                    DialogSubmissionPolicy::for_source(AgentSubmissionSource::SdkHost),
                    None,
                ),
            );
            records.messages.push(user_message);
            let result = providers.execute_turn(&mut records, &turn, &token).await;
            match &result {
                Ok(_) => turn.mark_completed(),
                Err(error) => {
                    records.close_incomplete_tools();
                    turn.status = if token.is_cancelled() {
                        TurnStatus::Cancelled
                    } else {
                        TurnStatus::Error
                    };
                    turn.end_time = Some(now());
                    turn.error = Some(error.to_string());
                }
            }
            let saved = if records.write_failed {
                Ok(())
            } else {
                records.checkpoint(&turn).await
            };
            providers.execution.take_outcome(&id, &turn_id);
            admission.disarm();
            saved?;
            result
        })
        .await?
    }
}

impl LocalProviders {
    async fn execute_turn(
        &self,
        records: &mut Records,
        turn: &DialogTurnData,
        token: &CancellationToken,
    ) -> Result<String> {
        records.checkpoint(turn).await?;
        let mut lifecycle = TurnExecution::new(0, 0);
        let mut final_text = String::new();
        openbitfun_agent_runtime::drive_turn_rounds!(
            lifecycle,
            || if token.is_cancelled() {
                Err(anyhow!("turn cancelled"))
            } else {
                Ok(())
            },
            |_round_index| {
                let (boundary, text) = self
                    .execute_round(records, turn, token, &mut lifecycle)
                    .await?;
                final_text = text;
                boundary
            },
            |kind, text| {
                records.messages.push(
                    Message::internal_reminder(kind, text).with_turn_id(turn.turn_id.clone()),
                );
            },
            {
                ensure!(!token.is_cancelled(), "turn cancelled");
            }
        );
        let (_, reason) = lifecycle.into_result();
        if let Some(reason) = reason {
            bail!("turn ended: {reason}")
        }
        Ok(final_text)
    }

    async fn execute_round(
        &self,
        records: &mut Records,
        turn: &DialogTurnData,
        token: &CancellationToken,
        lifecycle: &mut TurnExecution,
    ) -> Result<(TurnBoundary, String)> {
        let mut round = ModelRoundLifecycle::new();
        let mut attempts = ModelAttempts::new(1);
        let (attempt, _) = attempts.start(&mut round);
        let input = records
            .messages
            .iter()
            .map(openbitfun_core_types::Message::from)
            .collect();
        let stream = run_model_attempt(
            token,
            self.client
                .send_message_stream_once(input, Some(vec![read::definition()]), None),
            |response| {
                self.stream.process_stream(
                    response.stream,
                    StreamProcessor::derive_watchdog_timeout(self.client.stream_idle_timeout()),
                    response.raw_sse_rx,
                    turn.session_id.clone(),
                    turn.turn_id.clone(),
                    round.round_id.clone(),
                    format!("{}-{}", round.round_id, attempt),
                    attempt,
                    token,
                )
            },
        )
        .await;
        let output = match stream {
            ModelAttempt::Stream(output) => output.map_err(|e| anyhow!(e.error))?,
            ModelAttempt::OpenFailed(e) => return Err(e),
            ModelAttempt::Cancelled | ModelAttempt::CancelledAfterOpen(_) => {
                bail!("turn cancelled")
            }
        };
        let text = !output.full_text.trim().is_empty();
        let thinking = !output.full_thinking.is_empty();
        let disposition = attempts.resolve_stream(
            &mut round,
            StreamObservation {
                partial: output.partial_recovery_reason.as_deref(),
                visible_text: text,
                thinking,
                effective_output: output.has_effective_output,
                valid_calls: output.tool_calls.iter().any(|c| c.is_valid()),
                invalid_calls: output.tool_calls.iter().any(|c| !c.is_valid()),
            },
        );
        if let StreamDisposition::Fail { message, .. } | StreamDisposition::Retry { message, .. } =
            disposition
        {
            bail!("{message}")
        }
        let calls: Vec<_> = output
            .tool_calls
            .into_iter()
            .filter(|c| c.is_valid())
            .map(Into::into)
            .collect();
        let mut assistant = Message::assistant_with_reasoning(
            output
                .reasoning_content_present
                .then_some(output.full_thinking),
            output.full_text.clone(),
            calls.clone(),
        )
        .with_turn_id(turn.turn_id.clone())
        .with_round_id(round.round_id.clone());
        assistant.metadata.reasoning_content_kind = output.reasoning_content_kind;
        assistant.metadata.thinking_signature = output.thinking_signature;
        let reads = Reads {
            calls: &calls,
            reader: &self.reader,
            workspace: &self.workspace,
            project: &self.project,
            agent_id: turn.agent_type.as_deref().unwrap_or("agent"),
            session: &turn.session_id,
            turn: &turn.turn_id,
            round: &round.round_id,
            permissions: &self.permissions,
            cancel: token,
        };
        let phase = run_round_tools(
            !calls.is_empty(),
            token,
            || anyhow!("turn cancelled"),
            async {
                records.messages.push(assistant.clone());
                records.checkpoint(turn).await?;
                Ok(true)
            },
            reads.execute(),
        )
        .await?;
        if !phase.assistant_committed {
            records.messages.push(assistant)
        }
        lifecycle.observe_tool_results(&calls, &phase.messages);
        records.messages.extend(phase.messages);
        use openbitfun_agent_runtime::message::InternalReminderKind;
        let reminder = match lifecycle
            .tool_failure_recovery(TurnExecution::DEFAULT_FAILURE_THRESHOLD)
        {
            ToolFailureRecovery::None => None,
            ToolFailureRecovery::Repeated(text) => Some((InternalReminderKind::LoopRecovery, text)),
            ToolFailureRecovery::Periodic(text) => {
                Some((InternalReminderKind::PeriodicLoopRecovery, text))
            }
            ToolFailureRecovery::Exhausted => {
                return Ok((
                    TurnBoundary::Finish(Some("repeated_tool_failures")),
                    output.full_text,
                ))
            }
        };
        if let Some((kind, text)) = reminder {
            records
                .messages
                .push(Message::internal_reminder(kind, text).with_turn_id(turn.turn_id.clone()));
        }
        records.checkpoint(turn).await?;
        ensure!(!token.is_cancelled(), "turn cancelled");
        lifecycle.round_completed();
        let boundary = lifecycle
            .after_round(
                RoundOutput {
                    injected: false,
                    tool_results: !calls.is_empty(),
                    assistant_text: text,
                    quiet_end: false,
                    thinking,
                    partial_reason: output.partial_recovery_reason.as_deref(),
                    top_level: true,
                },
                |_| async { None },
            )
            .await;
        Ok((boundary, output.full_text))
    }
}

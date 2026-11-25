//! One entry point for a user message, whichever surface wrote it.
//!
//! The NSH composer, the remote-connect `SendMessage` command and the IM bots
//! used to decide on their own what a message written during a running turn
//! does (the composer steered, mobile and bots always queued). They now all
//! call [`submit_user_message`], which applies `app.flow_chat.send_during_turn`:
//! `immediate` steers the running turn, `queue` admits the message through the
//! host queue, and an idle session simply starts a turn.
use super::*;
use crate::agentic::session_policy::{resolve_user_message_route, UserMessageRoute};
use openbitfun_agent_runtime::sdk::{AgentRuntime, RuntimeError};
use openbitfun_config_contracts::ChatInputSendDuringTurn;
use openbitfun_runtime_ports::{DialogQueueSnapshot, DialogQueueStatus};

/// What became of a submitted user message.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UserMessageSubmitOutcome {
    /// A new turn started with this message.
    Started { session_id: String, turn_id: String },
    /// The message was injected into the running turn `turn_id`.
    Steered {
        session_id: String,
        turn_id: String,
        steering_id: String,
    },
    /// The message waits in the host queue; `turn_id` is its queue item id and
    /// the id of the turn it will start.
    Queued { session_id: String, turn_id: String },
}

/// The owners a submission needs. The scheduler provides the live facts and the
/// host queue; steering and fresh turns go through the Agent Runtime so the
/// configured plugin gates still apply.
#[async_trait::async_trait]
pub trait UserMessageSubmissionTarget: Send + Sync {
    fn active_turn_id(&self, session_id: &str) -> Option<String>;
    fn is_busy(&self, session_id: &str) -> bool;
    async fn steer(&self, request: AgentDialogSteerRequest) -> PortResult<DialogSteerOutcome>;
    async fn submit(&self, request: AgentDialogTurnRequest) -> PortResult<DialogSubmitOutcome>;
    async fn enqueue(&self, request: AgentDialogTurnRequest) -> PortResult<DialogQueueSnapshot>;
}

fn generated_turn_id() -> String {
    format!("turn_{}", Uuid::new_v4())
}

/// Applies the mid-turn policy to one user message.
///
/// A steering attempt that finds the target turn already settled
/// (`SessionInUse`) falls through to an ordinary submission, so the message is
/// never lost between the check and the injection.
pub async fn submit_user_message<T>(
    target: &T,
    policy: ChatInputSendDuringTurn,
    mut request: AgentDialogTurnRequest,
) -> PortResult<UserMessageSubmitOutcome>
where
    T: UserMessageSubmissionTarget + ?Sized,
{
    let session_id = request.session_id.trim().to_string();
    if session_id.is_empty() {
        return Err(PortError::new(
            PortErrorKind::InvalidRequest,
            "session_id is required",
        ));
    }
    if request.message.trim().is_empty() && request.attachments.is_empty() {
        return Err(PortError::new(
            PortErrorKind::InvalidRequest,
            "A message or an attachment is required",
        ));
    }
    request.session_id = session_id.clone();
    if request
        .turn_id
        .as_deref()
        .is_none_or(|id| id.trim().is_empty())
    {
        request.turn_id = Some(generated_turn_id());
    }

    let active = target.active_turn_id(&session_id);
    if let UserMessageRoute::Steer { turn_id } =
        resolve_user_message_route(policy, active.as_deref())
    {
        let steering = target
            .steer(AgentDialogSteerRequest {
                session_id: session_id.clone(),
                turn_id: turn_id.clone(),
                content: request.message.clone(),
                display_content: request.original_message.clone(),
                attachments: request.attachments.clone(),
                metadata: request.metadata.clone(),
            })
            .await;
        match steering {
            Ok(DialogSteerOutcome::Buffered { steering_id, .. }) => {
                return Ok(UserMessageSubmitOutcome::Steered {
                    session_id,
                    turn_id,
                    steering_id,
                });
            }
            Err(error) if error.kind == PortErrorKind::SessionInUse => {
                debug!(
                    "Steering target settled before injection; submitting instead: session_id={}, turn_id={}",
                    session_id, turn_id
                );
            }
            Err(error) => return Err(error),
        }
    }

    if active.is_some() || target.is_busy(&session_id) {
        let turn_id = request.turn_id.clone().unwrap_or_default();
        let snapshot = target.enqueue(request).await?;
        let started = snapshot
            .receipt
            .as_ref()
            .filter(|receipt| receipt.turn_id == turn_id)
            .is_some_and(|receipt| {
                !matches!(
                    receipt.status,
                    DialogQueueStatus::Queued
                        | DialogQueueStatus::Blocked
                        | DialogQueueStatus::SteeringPending
                )
            });
        return Ok(if started {
            UserMessageSubmitOutcome::Started {
                session_id,
                turn_id,
            }
        } else {
            UserMessageSubmitOutcome::Queued {
                session_id,
                turn_id,
            }
        });
    }

    Ok(match target.submit(request).await? {
        DialogSubmitOutcome::Started {
            session_id,
            turn_id,
        } => UserMessageSubmitOutcome::Started {
            session_id,
            turn_id,
        },
        DialogSubmitOutcome::Queued {
            session_id,
            turn_id,
        } => UserMessageSubmitOutcome::Queued {
            session_id,
            turn_id,
        },
    })
}

/// Reads `app.flow_chat.send_during_turn`; a host that cannot read its config
/// applies the default (`immediate`), the same value an absent field means.
pub async fn configured_send_during_turn() -> ChatInputSendDuringTurn {
    let Ok(service) = crate::service::config::GlobalConfigManager::get_service().await else {
        return ChatInputSendDuringTurn::default();
    };
    service
        .get_config::<ChatInputSendDuringTurn>(Some("app.flow_chat.send_during_turn"))
        .await
        .unwrap_or_default()
}

impl DialogScheduler {
    /// The turn the session is running right now, as steering would see it.
    pub fn active_dialog_turn_id(&self, session_id: &str) -> Option<String> {
        match self
            .session_manager
            .get_session(session_id)
            .map(|session| session.state.clone())
        {
            Some(SessionState::Processing {
                current_turn_id, ..
            }) if self
                .execution
                .active_turns
                .matches_turn(session_id, &current_turn_id) =>
            {
                Some(current_turn_id)
            }
            _ => None,
        }
    }
}

/// The production target: live facts and the host queue from the scheduler,
/// steering and fresh turns through the Agent Runtime.
pub struct RuntimeUserMessageTarget<'a> {
    pub runtime: &'a AgentRuntime,
    pub scheduler: &'a DialogScheduler,
}

#[async_trait::async_trait]
impl UserMessageSubmissionTarget for RuntimeUserMessageTarget<'_> {
    fn active_turn_id(&self, session_id: &str) -> Option<String> {
        self.scheduler.active_dialog_turn_id(session_id)
    }

    fn is_busy(&self, session_id: &str) -> bool {
        self.scheduler.is_session_busy_or_queued(session_id)
    }

    async fn steer(&self, request: AgentDialogSteerRequest) -> PortResult<DialogSteerOutcome> {
        self.runtime
            .steer_dialog_turn(request)
            .await
            .map_err(runtime_port_error)
    }

    async fn submit(&self, request: AgentDialogTurnRequest) -> PortResult<DialogSubmitOutcome> {
        self.runtime
            .submit_dialog_turn(request)
            .await
            .map_err(runtime_port_error)
    }

    async fn enqueue(&self, request: AgentDialogTurnRequest) -> PortResult<DialogQueueSnapshot> {
        self.scheduler.admit_user_message(request).await
    }
}

fn runtime_port_error(error: RuntimeError) -> PortError {
    match error {
        RuntimeError::Port(error) => error,
        other => PortError::new(PortErrorKind::Backend, other.into_message()),
    }
}

/// Submits one user message with the stored mid-turn policy, or the policy the
/// user picked for this message.
///
/// A session that is not loaded is restored from its own persisted binding
/// first, so a message for a background session runs where that session lives
/// rather than wherever the caller's UI happens to be.
pub async fn submit_user_message_with_runtime(
    runtime: &AgentRuntime,
    scheduler: &DialogScheduler,
    request: AgentDialogTurnRequest,
    explicit_policy: Option<ChatInputSendDuringTurn>,
) -> PortResult<UserMessageSubmitOutcome> {
    let session_id = request.session_id.trim();
    if !session_id.is_empty() && scheduler.session_manager.get_session(session_id).is_none() {
        scheduler
            .coordinator
            .restore_unloaded_session_for_admission(session_id)
            .await
            .map_err(|error| PortError::new(PortErrorKind::NotFound, error.to_string()))?;
    }
    // An explicit per-message choice (the composer's "Steer" / "Queue" button)
    // wins over the stored default.
    let policy = match explicit_policy {
        Some(policy) => policy,
        None => configured_send_during_turn().await,
    };
    submit_user_message(
        &RuntimeUserMessageTarget { runtime, scheduler },
        policy,
        request,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use openbitfun_runtime_ports::DialogQueueItem;
    use std::sync::Mutex;

    #[derive(Default)]
    struct FakeTarget {
        active: Option<String>,
        busy: bool,
        steer_error: Option<PortErrorKind>,
        calls: Mutex<Vec<String>>,
    }

    #[async_trait::async_trait]
    impl UserMessageSubmissionTarget for FakeTarget {
        fn active_turn_id(&self, _session_id: &str) -> Option<String> {
            self.active.clone()
        }
        fn is_busy(&self, _session_id: &str) -> bool {
            self.busy
        }
        async fn steer(&self, request: AgentDialogSteerRequest) -> PortResult<DialogSteerOutcome> {
            self.calls
                .lock()
                .unwrap()
                .push(format!("steer:{}", request.turn_id));
            if let Some(kind) = self.steer_error.clone() {
                return Err(PortError::new(kind, "steer refused"));
            }
            Ok(DialogSteerOutcome::Buffered {
                session_id: request.session_id,
                turn_id: request.turn_id,
                steering_id: "steer-1".into(),
            })
        }
        async fn submit(&self, request: AgentDialogTurnRequest) -> PortResult<DialogSubmitOutcome> {
            self.calls.lock().unwrap().push("submit".into());
            Ok(DialogSubmitOutcome::Started {
                session_id: request.session_id,
                turn_id: request.turn_id.unwrap(),
            })
        }
        async fn enqueue(
            &self,
            request: AgentDialogTurnRequest,
        ) -> PortResult<DialogQueueSnapshot> {
            self.calls.lock().unwrap().push("enqueue".into());
            let turn_id = request.turn_id.unwrap();
            Ok(DialogQueueSnapshot {
                session_id: request.session_id,
                queue_epoch: "epoch".into(),
                revision: 1,
                active_turn_id: self.active.clone(),
                items: Vec::new(),
                supports_reorder: Some(true),
                capacity: 20,
                used: 1,
                receipt: Some(DialogQueueItem {
                    turn_id,
                    display_content: String::new(),
                    preview_truncated: false,
                    attachment_count: 0,
                    agent_type: "Standard".into(),
                    created_at_ms: 0,
                    status: if self.active.is_some() {
                        DialogQueueStatus::Queued
                    } else {
                        DialogQueueStatus::Started
                    },
                    reason: None,
                    target_turn_id: None,
                    steering_id: None,
                    steering_display: None,
                }),
            })
        }
    }

    fn request(turn_id: Option<&str>) -> AgentDialogTurnRequest {
        AgentDialogTurnRequest {
            session_id: " session-1 ".into(),
            message: "hello".into(),
            output_schema: None,
            original_message: None,
            turn_id: turn_id.map(str::to_string),
            execution: Default::default(),
            agent_type: "Standard".into(),
            workspace_path: None,
            workspace_id: None,
            remote_connection_id: None,
            remote_ssh_host: None,
            policy: DialogSubmissionPolicy::for_source(DialogTriggerSource::DesktopUi),
            reply_route: None,
            prepended_reminders: Vec::new(),
            attachments: Vec::new(),
            metadata: serde_json::Map::new(),
        }
    }

    #[tokio::test]
    async fn idle_session_starts_a_turn_whatever_the_policy() {
        for policy in [
            ChatInputSendDuringTurn::Immediate,
            ChatInputSendDuringTurn::Queue,
        ] {
            let target = FakeTarget::default();
            let outcome = submit_user_message(&target, policy, request(Some("t1")))
                .await
                .unwrap();
            assert_eq!(
                outcome,
                UserMessageSubmitOutcome::Started {
                    session_id: "session-1".into(),
                    turn_id: "t1".into()
                }
            );
            assert_eq!(*target.calls.lock().unwrap(), ["submit"]);
        }
    }

    #[tokio::test]
    async fn immediate_policy_steers_the_running_turn() {
        let target = FakeTarget {
            active: Some("running".into()),
            busy: true,
            ..Default::default()
        };
        let outcome = submit_user_message(
            &target,
            ChatInputSendDuringTurn::Immediate,
            request(Some("t2")),
        )
        .await
        .unwrap();
        assert_eq!(
            outcome,
            UserMessageSubmitOutcome::Steered {
                session_id: "session-1".into(),
                turn_id: "running".into(),
                steering_id: "steer-1".into()
            }
        );
        assert_eq!(*target.calls.lock().unwrap(), ["steer:running"]);
    }

    #[tokio::test]
    async fn queue_policy_admits_through_the_host_queue() {
        let target = FakeTarget {
            active: Some("running".into()),
            busy: true,
            ..Default::default()
        };
        let outcome =
            submit_user_message(&target, ChatInputSendDuringTurn::Queue, request(Some("t3")))
                .await
                .unwrap();
        assert_eq!(
            outcome,
            UserMessageSubmitOutcome::Queued {
                session_id: "session-1".into(),
                turn_id: "t3".into()
            }
        );
        assert_eq!(*target.calls.lock().unwrap(), ["enqueue"]);
    }

    #[tokio::test]
    async fn settled_steering_target_falls_back_to_the_queue() {
        let target = FakeTarget {
            active: Some("running".into()),
            busy: true,
            steer_error: Some(PortErrorKind::SessionInUse),
            ..Default::default()
        };
        let outcome =
            submit_user_message(&target, ChatInputSendDuringTurn::Immediate, request(None))
                .await
                .unwrap();
        let UserMessageSubmitOutcome::Queued { turn_id, .. } = outcome else {
            panic!("expected a queued fallback, got {outcome:?}");
        };
        assert!(turn_id.starts_with("turn_"), "generated id: {turn_id}");
        assert_eq!(*target.calls.lock().unwrap(), ["steer:running", "enqueue"]);
    }

    #[tokio::test]
    async fn other_steering_errors_are_reported_not_resubmitted() {
        let target = FakeTarget {
            active: Some("running".into()),
            busy: true,
            steer_error: Some(PortErrorKind::InvalidRequest),
            ..Default::default()
        };
        let error = submit_user_message(&target, ChatInputSendDuringTurn::Immediate, request(None))
            .await
            .unwrap_err();
        assert_eq!(error.kind, PortErrorKind::InvalidRequest);
        assert_eq!(*target.calls.lock().unwrap(), ["steer:running"]);
    }

    #[tokio::test]
    async fn busy_session_without_a_running_turn_queues_and_empty_input_is_refused() {
        let target = FakeTarget {
            busy: true,
            ..Default::default()
        };
        let outcome = submit_user_message(
            &target,
            ChatInputSendDuringTurn::Immediate,
            request(Some("t4")),
        )
        .await
        .unwrap();
        // The fake host started it at once because nothing was running.
        assert!(matches!(outcome, UserMessageSubmitOutcome::Started { .. }));
        assert_eq!(*target.calls.lock().unwrap(), ["enqueue"]);

        let mut empty = request(None);
        empty.message = "   ".into();
        let error = submit_user_message(&target, ChatInputSendDuringTurn::Queue, empty)
            .await
            .unwrap_err();
        assert_eq!(error.kind, PortErrorKind::InvalidRequest);
    }
}

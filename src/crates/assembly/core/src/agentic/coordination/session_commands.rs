//! Session commands (`/compact`, `/init`, `/reload`) every surface offers.
//!
//! The NSH slash menu and the IM bot router list the same commands from
//! [`crate::agentic::session_policy::session_commands`] and run them here, so a
//! command means the same thing whichever client typed it.
use super::*;
use crate::agentic::session::PromptCacheScope;
use crate::agentic::session_policy::SessionCommandId;
use crate::agentic::tools::implementations::skills::SkillRegistry;
use openbitfun_runtime_ports::AgentContextReloadTarget;

/// Refusal code for an idle-only command sent while a turn runs.
pub const SESSION_COMMAND_BUSY_CODE: &str = "session_busy";

/// What a session command started or changed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionCommandOutcome {
    /// Manual compaction was accepted and runs as `turn_id`.
    CompactionStarted { turn_id: String },
    /// The AGENTS.md generation turn was submitted as `turn_id`.
    InitStarted { turn_id: String },
    /// Skills and/or project instructions were reloaded.
    Reloaded { target: AgentContextReloadTarget },
}

impl SessionCommandOutcome {
    pub fn turn_id(&self) -> Option<&str> {
        match self {
            Self::CompactionStarted { turn_id } | Self::InitStarted { turn_id } => Some(turn_id),
            Self::Reloaded { .. } => None,
        }
    }
}

/// The `/reload` argument; anything else reloads both.
pub fn reload_target_of(arg: Option<&str>) -> AgentContextReloadTarget {
    match arg.map(str::trim).map(str::to_ascii_lowercase).as_deref() {
        Some("skills") => AgentContextReloadTarget::Skills,
        Some("instructions") => AgentContextReloadTarget::Instructions,
        _ => AgentContextReloadTarget::All,
    }
}

/// Refreshes user-visible declarative context for a loaded session. Skill
/// discovery and prompt caching keep their owners; this only coordinates.
pub(crate) async fn reload_loaded_session_context(
    session_manager: &SessionManager,
    session_id: &str,
    target: AgentContextReloadTarget,
) -> OpenBitFunResult<()> {
    if session_manager.get_session(session_id).is_none() {
        return Err(OpenBitFunError::NotFound(format!(
            "Session '{session_id}' is not loaded"
        )));
    }
    if target.includes_skills() {
        SkillRegistry::global().refresh().await;
    }
    if target.includes_instructions() {
        session_manager
            .invalidate_prompt_cache(
                session_id,
                PromptCacheScope::UserContext,
                "user_requested_instruction_reload",
            )
            .await;
    }
    Ok(())
}

impl DialogScheduler {
    /// Runs one session command for any surface. The session is restored first
    /// when it is not loaded; idle-only commands are refused with a stable code
    /// while a turn runs or messages wait, instead of racing the running turn.
    pub async fn execute_session_command(
        &self,
        session_id: &str,
        command: SessionCommandId,
        arg: Option<&str>,
        source: DialogTriggerSource,
    ) -> OpenBitFunResult<SessionCommandOutcome> {
        let session_id = session_id.trim();
        openbitfun_core_types::validate_session_id(session_id)
            .map_err(|message| OpenBitFunError::Validation(message.to_string()))?;
        self.coordinator
            .restore_unloaded_session_for_admission(session_id)
            .await?;
        if command.idle_only() && self.is_session_busy_or_queued(session_id) {
            return Err(OpenBitFunError::Validation(format!(
                "{SESSION_COMMAND_BUSY_CODE}: /{} waits until the running turn finishes",
                command.as_str()
            )));
        }
        match command {
            SessionCommandId::Compact => {
                let turn_id = self
                    .coordinator
                    .start_manual_compaction_detached(session_id.to_string(), None)
                    .await?;
                Ok(SessionCommandOutcome::CompactionStarted { turn_id })
            }
            SessionCommandId::Init => {
                // The loaded session's own binding locates the workspace.
                let outcome = self
                    .submit_init_agents_md(
                        session_id.to_string(),
                        None,
                        None,
                        None,
                        DialogSubmissionPolicy::for_source(source),
                    )
                    .await
                    .map_err(OpenBitFunError::Service)?;
                let turn_id = match outcome {
                    DialogSubmitOutcome::Started { turn_id, .. }
                    | DialogSubmitOutcome::Queued { turn_id, .. } => turn_id,
                };
                Ok(SessionCommandOutcome::InitStarted { turn_id })
            }
            SessionCommandId::Reload => {
                let target = reload_target_of(arg);
                reload_loaded_session_context(&self.session_manager, session_id, target).await?;
                Ok(SessionCommandOutcome::Reloaded { target })
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reload_argument_selects_the_target() {
        assert_eq!(reload_target_of(None), AgentContextReloadTarget::All);
        assert_eq!(
            reload_target_of(Some(" Skills ")),
            AgentContextReloadTarget::Skills
        );
        assert_eq!(
            reload_target_of(Some("instructions")),
            AgentContextReloadTarget::Instructions
        );
        assert_eq!(
            reload_target_of(Some("everything")),
            AgentContextReloadTarget::All
        );
    }

    #[test]
    fn outcome_reports_the_turn_it_started() {
        assert_eq!(
            SessionCommandOutcome::CompactionStarted {
                turn_id: "t1".into()
            }
            .turn_id(),
            Some("t1")
        );
        assert_eq!(
            SessionCommandOutcome::Reloaded {
                target: AgentContextReloadTarget::All
            }
            .turn_id(),
            None
        );
    }
}

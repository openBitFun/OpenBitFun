//! Live state shared by submit, dispatch, recovery, maintenance and cancellation.
use super::{
    ActiveDialogTurn, ActiveDialogTurnStore, ActiveDialogTurnTakeResult, DialogReplySuppressionSet,
    DialogTurnQueue, SessionAbortFlags, SessionRoundInjectionBuffer,
};
use crate::session::keyed_lock::{KeyedAsyncLock, KeyedAsyncLockGuard};
use std::{collections::HashSet, sync::Arc};
use tokio::sync::Notify;

pub struct DialogExecution<T> {
    operations: KeyedAsyncLock,
    internal_sessions: dashmap::DashSet<String>,
    draining_children: dashmap::DashMap<String, HashSet<String>>,
    pub queues: DialogTurnQueue<T>,
    pub active_turns: Arc<ActiveDialogTurnStore>,
    pub retired_maintenance_outcomes: DialogReplySuppressionSet,
    pub suppressed_cancelled_replies: DialogReplySuppressionSet,
    pub goal_continuation_abort: SessionAbortFlags,
    pub active_turn_retired: Arc<Notify>,
    pub round_injection_buffer: Arc<SessionRoundInjectionBuffer>,
}

impl<T> Default for DialogExecution<T> {
    fn default() -> Self {
        Self {
            operations: Default::default(),
            internal_sessions: Default::default(),
            draining_children: Default::default(),
            queues: Default::default(),
            active_turns: Default::default(),
            retired_maintenance_outcomes: Default::default(),
            suppressed_cancelled_replies: Default::default(),
            goal_continuation_abort: Default::default(),
            active_turn_retired: Default::default(),
            round_injection_buffer: Default::default(),
        }
    }
}

/// Effects performed under the same session operation lock as dequeue-to-start.
#[async_trait::async_trait]
pub trait CancellationEffects<T>: Sync {
    async fn finish_queued(&self, session_id: &str, turn: T);
    async fn stop_active(
        &self,
        session_id: &str,
        turn_id: &str,
        descendants: bool,
    ) -> Result<(), String>;
    async fn abandon_interrupted(&self, session_id: &str, turn_id: &str) -> Result<(), String>;
}

impl<T: Send + Sync> DialogExecution<T> {
    pub async fn lock_session(&self, session_id: &str) -> KeyedAsyncLockGuard {
        self.operations.lock(session_id).await
    }

    pub async fn cancel(
        &self,
        effects: &impl CancellationEffects<T>,
        session_id: &str,
        turn_id: &str,
        descendants: bool,
        matches: impl FnMut(&T) -> bool + Send,
    ) -> Result<bool, String> {
        let _guard = self.lock_session(session_id).await;
        if let Some(turn) = self.queues.remove_first_matching(session_id, matches) {
            effects.finish_queued(session_id, turn).await;
            return Ok(true);
        }
        if self.active_turns.matches_turn(session_id, turn_id) {
            effects
                .stop_active(session_id, turn_id, descendants)
                .await?;
        }
        // The execution may have persisted an interruption while stop_active
        // drained it. The provider checks the exact generation before removal.
        effects.abandon_interrupted(session_id, turn_id).await?;
        Ok(false)
    }

    pub fn mark_internal(&self, session_id: &str) {
        self.internal_sessions.insert(session_id.to_owned());
    }

    pub fn take_internal(&self, session_id: &str) -> bool {
        self.internal_sessions.remove(session_id).is_some()
    }

    /// Preserve child identities across retryable maintenance timeouts, after
    /// their one-shot cancellation handles have already been claimed.
    pub fn track_draining_children(
        &self,
        session_id: &str,
        children: Vec<String>,
    ) -> HashSet<String> {
        if children.is_empty() {
            return self
                .draining_children
                .get(session_id)
                .map(|set| set.clone())
                .unwrap_or_default();
        }
        let mut tracked = self
            .draining_children
            .entry(session_id.to_owned())
            .or_default();
        tracked.extend(children);
        tracked.clone()
    }

    pub fn finish_child_drain(&self, session_id: &str) {
        self.draining_children.remove(session_id);
    }

    pub fn retire_for_maintenance(&self, session_id: &str) -> Option<String> {
        let turn_id = self.active_turns.remove(session_id)?.turn_id().to_owned();
        self.retired_maintenance_outcomes.mark(session_id, &turn_id);
        self.active_turn_retired.notify_waiters();
        self.take_internal(session_id);
        self.round_injection_buffer
            .drain_for_turn(session_id, &turn_id);
        self.suppressed_cancelled_replies.take(session_id, &turn_id);
        Some(turn_id)
    }

    pub fn take_outcome(
        &self,
        session_id: &str,
        turn_id: &str,
    ) -> Option<ActiveDialogTurnTakeResult> {
        if self.retired_maintenance_outcomes.take(session_id, turn_id) {
            None
        } else {
            Some(self.active_turns.take_for_outcome(session_id, turn_id))
        }
    }

    /// Called under the session lock after the prior execution has retired.
    pub fn admit_recovery(&self, session_id: &str, turn: ActiveDialogTurn) -> RecoveryAdmission {
        self.admit_turn(session_id, turn)
    }

    /// Publish under the session admission lock. Until dispatch hands ownership
    /// to the settlement path, dropping the guard retires exactly this turn.
    pub fn admit_turn(&self, session_id: &str, turn: ActiveDialogTurn) -> RecoveryAdmission {
        let turn_id = turn.turn_id().to_owned();
        self.active_turns.insert(session_id, turn);
        RecoveryAdmission {
            active: self.active_turns.clone(),
            retired: self.active_turn_retired.clone(),
            session_id: session_id.to_owned(),
            turn_id,
            armed: true,
        }
    }
}

pub struct RecoveryAdmission {
    active: Arc<ActiveDialogTurnStore>,
    retired: Arc<Notify>,
    session_id: String,
    turn_id: String,
    armed: bool,
}

impl RecoveryAdmission {
    pub fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for RecoveryAdmission {
    fn drop(&mut self) {
        if self.armed {
            self.active
                .take_for_outcome(&self.session_id, &self.turn_id);
            self.retired.notify_waiters();
        }
    }
}

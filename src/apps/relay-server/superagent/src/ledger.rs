//! The write-ahead job ledger of one account.
//!
//! A job id is written here (phase `pending`) before its submit leaves the
//! agent, so a crash between the two is reconciled through the target's
//! status/list instead of a second submit; the target is idempotent on the
//! job id. Jobs for offline devices wait here (the relay never queues) and
//! are submitted once, with the same id, when the device comes back.
//!
//! The record is versioned and read tolerantly: every field has a default
//! and unknown fields are ignored, so older and newer builds read each
//! other's ledgers.

use std::collections::BTreeMap;

use openbitfun_product_domains::superagent::{
    DiffStat, JobAnswerNote, JobPendingPrompt, LedgerJobPhase, SuperagentJobState, TargetJobState,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const LEDGER_VERSION: u32 = 1;
/// Jobs kept after they ended (the oldest terminal jobs are dropped first).
pub const MAX_LEDGER_JOBS: usize = 512;
/// How long a job waits for an offline device by default.
pub const DEFAULT_QUEUE_TTL_MS: u64 = 24 * 60 * 60 * 1000;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct JobRecord {
    pub job_id: String,
    pub device_id: String,
    pub session_id: String,
    pub conversation_id: String,
    pub turn_id: String,
    pub title: String,
    pub group_id: Option<String>,
    pub label: Option<String>,
    /// The tool input source, as the model gave it.
    pub source: Value,
    pub instructions: String,
    pub agent: Option<String>,
    pub model: Option<String>,
    pub reasoning_preset: Option<String>,
    /// `remote`, `reject-and-report` or `auto`.
    pub approval: String,
    pub phase: LedgerJobPhase,
    /// A queued job waits for its device until then (Unix ms); `None`: the
    /// submit went out right away.
    pub queued_until_ms: Option<u64>,
    /// Submits sent for this id (at most one per presence change; the target
    /// dedupes on the id).
    pub submit_attempts: u32,
    pub target_state: TargetJobState,
    pub state: SuperagentJobState,
    pub state_reason: Option<String>,
    pub status_cursor: u64,
    pub branch: Option<String>,
    pub base_commit: Option<String>,
    pub workspace_path: Option<String>,
    pub pending_prompt: Option<JobPendingPrompt>,
    /// The last answer given to one of the job's prompts (by the agent or
    /// the user), shown on the card.
    pub last_answer: Option<JobAnswerNote>,
    /// What the waiting prompt asks for (command or input summary).
    pub pending_prompt_summary: Option<crate::wire::PromptSummary>,
    pub diff_stat: Option<DiffStat>,
    pub summary: Option<String>,
    pub last_error: Option<String>,
    pub created_ms: u64,
    pub submitted_ms: Option<u64>,
    pub finished_ms: Option<u64>,
    pub updated_ms: u64,
}

impl JobRecord {
    pub fn is_live(&self) -> bool {
        !self.state.is_terminal() && self.phase != LedgerJobPhase::Expired
    }

    pub fn duration_ms(&self) -> Option<u64> {
        Some(self.finished_ms?.saturating_sub(self.submitted_ms?))
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Ledger {
    pub version: u32,
    pub jobs: BTreeMap<String, JobRecord>,
}

impl Default for Ledger {
    fn default() -> Self {
        Self {
            version: LEDGER_VERSION,
            jobs: BTreeMap::new(),
        }
    }
}

impl Ledger {
    pub fn live_jobs(&self) -> impl Iterator<Item = &JobRecord> {
        self.jobs.values().filter(|job| job.is_live())
    }

    pub fn has_live_jobs(&self) -> bool {
        self.live_jobs().next().is_some()
    }

    pub fn group(&self, group_id: &str) -> Vec<&JobRecord> {
        let mut jobs: Vec<&JobRecord> = self
            .jobs
            .values()
            .filter(|job| job.group_id.as_deref() == Some(group_id))
            .collect();
        jobs.sort_by(|a, b| {
            a.created_ms
                .cmp(&b.created_ms)
                .then(a.job_id.cmp(&b.job_id))
        });
        jobs
    }

    /// Drops the oldest finished jobs past the bound (live jobs stay).
    pub fn prune(&mut self) {
        if self.jobs.len() <= MAX_LEDGER_JOBS {
            return;
        }
        let mut finished: Vec<(u64, String)> = self
            .jobs
            .values()
            .filter(|job| !job.is_live())
            .map(|job| (job.updated_ms, job.job_id.clone()))
            .collect();
        finished.sort();
        let excess = self.jobs.len() - MAX_LEDGER_JOBS;
        for (_, id) in finished.into_iter().take(excess) {
            self.jobs.remove(&id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_and_newer_ledgers_read_tolerantly() {
        // An older record without most fields, and a newer one with a field
        // and an enum value this build does not know.
        let text = r#"{
            "jobs": {
                "a": {"jobId": "a", "deviceId": "d1", "state": "working"},
                "b": {"jobId": "b", "deviceId": "d2", "state": "paused_by_future_build",
                      "phase": "migrated", "futureField": {"x": 1}}
            },
            "futureTopLevel": true
        }"#;
        let ledger: Ledger = serde_json::from_str(text).unwrap();
        assert_eq!(ledger.version, LEDGER_VERSION);
        assert_eq!(ledger.jobs["a"].state, SuperagentJobState::Working);
        assert_eq!(ledger.jobs["a"].phase, LedgerJobPhase::Pending);
        assert_eq!(ledger.jobs["b"].state, SuperagentJobState::Unknown);
        assert_eq!(ledger.jobs["b"].phase, LedgerJobPhase::Unknown);
        // Round trip keeps what this build knows.
        let again: Ledger = serde_json::from_str(&serde_json::to_string(&ledger).unwrap()).unwrap();
        assert_eq!(again.jobs["a"], ledger.jobs["a"]);
    }

    #[test]
    fn prune_keeps_live_jobs() {
        let mut ledger = Ledger::default();
        for index in 0..(MAX_LEDGER_JOBS + 10) {
            let id = format!("j{index:04}");
            ledger.jobs.insert(
                id.clone(),
                JobRecord {
                    job_id: id,
                    state: if index < 20 {
                        SuperagentJobState::Working
                    } else {
                        SuperagentJobState::Done
                    },
                    phase: LedgerJobPhase::Submitted,
                    updated_ms: index as u64,
                    ..JobRecord::default()
                },
            );
        }
        ledger.prune();
        assert_eq!(ledger.jobs.len(), MAX_LEDGER_JOBS);
        assert_eq!(ledger.live_jobs().count(), 20);
    }
}

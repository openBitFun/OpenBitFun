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
/// Serialized bytes the ledger record may take: the oldest finished jobs
/// are dropped first until it fits (well under the store's record cap, so
/// the ledger always stays readable).
pub const MAX_LEDGER_BYTES: usize = 2 * 1024 * 1024;
/// How long a finished job stays in the ledger (its card lives on in the
/// conversation; the target keeps the job, session and event log).
pub const FINISHED_JOB_TTL_MS: u64 = 7 * 24 * 60 * 60 * 1000;
/// A live job with no status from its device for this long is marked lost.
pub const LOST_JOB_AFTER_MS: u64 = 30 * 24 * 60 * 60 * 1000;
/// The card text of a job marked lost.
pub const LOST_JOB_REASON: &str = "No status from the device for 30 days; this job is marked lost.";
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
    /// When the device last answered a status for this job (Unix ms; 0 in
    /// records of earlier builds, which then count from `updated_ms`).
    pub status_seen_ms: u64,
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

    /// Time to live: a live job with no status for [`LOST_JOB_AFTER_MS`] is
    /// marked lost (failed), and a finished job goes after
    /// [`FINISHED_JOB_TTL_MS`]. Returns the jobs marked lost and how many
    /// went.
    pub fn expire(&mut self, now: u64) -> (Vec<String>, usize) {
        let mut lost = Vec::new();
        for job in self.jobs.values_mut().filter(|job| job.is_live()) {
            let last = job
                .status_seen_ms
                .max(job.updated_ms)
                .max(job.submitted_ms.unwrap_or(0))
                .max(job.created_ms);
            if now.saturating_sub(last) >= LOST_JOB_AFTER_MS {
                job.state = SuperagentJobState::Failed;
                job.state_reason = Some(LOST_JOB_REASON.to_string());
                job.finished_ms = Some(now);
                job.updated_ms = now;
                lost.push(job.job_id.clone());
            }
        }
        let before = self.jobs.len();
        self.jobs.retain(|_, job| {
            job.is_live()
                || now.saturating_sub(job.finished_ms.unwrap_or(job.updated_ms))
                    < FINISHED_JOB_TTL_MS
        });
        (lost, before - self.jobs.len())
    }

    /// Drops the oldest finished jobs past the bounds: at most
    /// [`MAX_LEDGER_JOBS`] jobs and [`MAX_LEDGER_BYTES`] serialized bytes.
    /// Live jobs always stay.
    pub fn prune(&mut self) {
        self.prune_to(MAX_LEDGER_JOBS, MAX_LEDGER_BYTES);
    }

    fn prune_to(&mut self, max_jobs: usize, max_bytes: usize) {
        let sizes: BTreeMap<&str, usize> = self
            .jobs
            .iter()
            .map(|(id, job)| {
                // Key, quotes, colon and comma around each serialized job.
                let bytes = serde_json::to_vec(job).map(|v| v.len()).unwrap_or(0) + id.len() + 4;
                (id.as_str(), bytes)
            })
            .collect();
        let mut total: usize = sizes.values().sum::<usize>() + 32;
        let mut count = self.jobs.len();
        if count <= max_jobs && total <= max_bytes {
            return;
        }
        let mut finished: Vec<(u64, String)> = self
            .jobs
            .values()
            .filter(|job| !job.is_live())
            .map(|job| (job.updated_ms, job.job_id.clone()))
            .collect();
        finished.sort();
        let mut drop = Vec::new();
        for (_, id) in finished {
            if count <= max_jobs && total <= max_bytes {
                break;
            }
            total = total.saturating_sub(sizes.get(id.as_str()).copied().unwrap_or(0));
            count -= 1;
            drop.push(id);
        }
        for id in drop {
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
    fn expire_marks_silent_live_jobs_lost_and_drops_old_finished_ones() {
        const DAY: u64 = 24 * 60 * 60 * 1000;
        let mut ledger = Ledger::default();
        let job =
            |id: &str, state: SuperagentJobState, updated: u64, finished: Option<u64>| JobRecord {
                job_id: id.into(),
                state,
                updated_ms: updated,
                finished_ms: finished,
                ..JobRecord::default()
            };
        let now = 100 * DAY;
        ledger.jobs.insert(
            "live".into(),
            job("live", SuperagentJobState::Working, now - 29 * DAY, None),
        );
        let mut polled = job("polled", SuperagentJobState::Working, now - 40 * DAY, None);
        polled.status_seen_ms = now - DAY;
        ledger.jobs.insert("polled".into(), polled);
        ledger.jobs.insert(
            "silent".into(),
            job("silent", SuperagentJobState::Blocked, now - 31 * DAY, None),
        );
        ledger.jobs.insert(
            "fresh-done".into(),
            job(
                "fresh-done",
                SuperagentJobState::Done,
                now - 6 * DAY,
                Some(now - 6 * DAY),
            ),
        );
        ledger.jobs.insert(
            "old-done".into(),
            job(
                "old-done",
                SuperagentJobState::Done,
                now - DAY,
                Some(now - 8 * DAY),
            ),
        );
        let (lost, dropped) = ledger.expire(now);
        assert_eq!(lost, vec!["silent".to_string()]);
        assert_eq!(dropped, 1);
        assert!(!ledger.jobs.contains_key("old-done"));
        assert_eq!(ledger.jobs["silent"].state, SuperagentJobState::Failed);
        assert!(ledger.jobs["live"].is_live() && ledger.jobs["polled"].is_live());
        // The lost job goes once it has been finished for the TTL.
        let (_, dropped) = ledger.expire(now + 7 * DAY);
        assert_eq!(dropped, 2);
        assert!(ledger.jobs.contains_key("live") || ledger.jobs.contains_key("polled"));
        // A ledger of an earlier build (no status time) reads.
        let old: JobRecord = serde_json::from_str(r#"{"jobId":"x","state":"working"}"#).unwrap();
        assert_eq!(old.status_seen_ms, 0);
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

    #[test]
    fn a_full_ledger_of_large_jobs_is_pruned_by_bytes_and_stays_readable() {
        // 512 jobs with 32 KiB instructions each (about 16 MiB before the
        // byte budget, twice the store's record cap).
        let mut ledger = Ledger::default();
        for index in 0..MAX_LEDGER_JOBS {
            let id = format!("j{index:04}");
            ledger.jobs.insert(
                id.clone(),
                JobRecord {
                    job_id: id,
                    instructions: "i".repeat(32 * 1024),
                    state: if index % 64 == 0 {
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
        let bytes = serde_json::to_vec(&ledger).unwrap().len();
        assert!(bytes <= MAX_LEDGER_BYTES, "{bytes}");
        assert!(bytes <= crate::store::MAX_RECORD_BYTES);
        // Every live job stays; the newest finished jobs are the ones kept.
        assert_eq!(ledger.live_jobs().count(), MAX_LEDGER_JOBS / 64);
        assert!(ledger.jobs.contains_key("j0511"));
        assert!(!ledger.jobs.contains_key("j0001"));
        // And the store takes it and reads it back.
        let temp = tempfile::tempdir().unwrap();
        let store = crate::store::Store::open(temp.path(), [3u8; 32]).unwrap();
        let account = store.account("email-alice", true).unwrap();
        account.write_json("ledger", &ledger).unwrap();
        let back: Ledger = account.read_json("ledger").unwrap().unwrap();
        assert_eq!(back.jobs.len(), ledger.jobs.len());
    }

    #[test]
    fn a_small_ledger_is_left_alone() {
        let mut ledger = Ledger::default();
        for index in 0..10 {
            let id = format!("j{index}");
            ledger.jobs.insert(
                id.clone(),
                JobRecord {
                    job_id: id,
                    state: SuperagentJobState::Done,
                    ..JobRecord::default()
                },
            );
        }
        ledger.prune();
        assert_eq!(ledger.jobs.len(), 10);
    }
}

//! Summary-only answers for controllers that must not read transcripts:
//! `status` with `summaryOnly` (`status_summary_only_v1`) and the
//! `resultSummary` query (`query_result_summary_v1`).
//!
//! Both answer from the job's persisted state and its worktree's Git
//! metadata. Neither returns event payloads or file contents; the result
//! summary's text is the job's last assistant reply, which is what the job
//! reports back, bounded.

use std::path::{Path, PathBuf};

use anyhow::Result;
use openbitfun_services_core::dispatch_contract::{
    DISPATCH_RESULT_SUMMARY_MAX_FILES, DISPATCH_RESULT_SUMMARY_MAX_TEXT_BYTES,
};
use serde::Deserialize;

use super::protocol::{
    DispatchDiffStat, DispatchDiffStatFile, DispatchEvent, DispatchPendingPromptSummary,
    DispatchResultSummary, DispatchStatusSummaryResponse,
};
use super::store::{read_json, DispatchStateRecord, DispatchStore};
use super::workspace::git;

const PROVISION_RECORD_FILE: &str = "provision.json";
/// Pages of the event log read while looking for the last reply.
const MAX_SUMMARY_EVENT_PAGES: usize = 4096;

/// The fields of the workspace layer's provision record a summary needs.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProvisionFacts {
    #[serde(default)]
    base_commit: Option<String>,
    #[serde(default)]
    branch: Option<String>,
    #[serde(default)]
    workspace_path: Option<String>,
}

pub(super) fn status_summary(
    store: &DispatchStore,
    job_id: &str,
    state: &DispatchStateRecord,
) -> Result<DispatchStatusSummaryResponse> {
    let pending_permissions = if state.state.is_terminal() {
        Vec::new()
    } else {
        store
            .list_pending_permissions(job_id)?
            .into_iter()
            .map(|request| DispatchPendingPromptSummary {
                request_id: request.request_id,
                tool_name: Some(request.action).filter(|action| !action.trim().is_empty()),
            })
            .collect()
    };
    Ok(DispatchStatusSummaryResponse {
        summary_only: true,
        state: state.state,
        cursor: store.event_log_end_cursor(job_id)?,
        pending_permissions,
        turn_id: state.turn_id.clone(),
        started_at: state.started_at.clone(),
        finished_at: state.finished_at.clone(),
        last_error: state.last_error.clone(),
    })
}

pub(super) fn result_summary(
    store: &DispatchStore,
    job_id: &str,
    state: &DispatchStateRecord,
) -> Result<DispatchResultSummary> {
    let job = store.load_job(job_id)?;
    let provision: ProvisionFacts = store
        .workspace_upload_dir(job_id)
        .ok()
        .map(|dir| dir.join(PROVISION_RECORD_FILE))
        .filter(|path| path.is_file())
        .and_then(|path| read_json(&path).ok())
        .unwrap_or_default();
    let worktree = provision
        .workspace_path
        .clone()
        .unwrap_or_else(|| job.request.workspace_path.clone());
    let worktree = PathBuf::from(worktree);
    let git_facts = worktree
        .is_dir()
        .then(|| git_facts(&worktree, provision.base_commit.as_deref()));
    let (summary, summary_truncated) = last_reply(store, job_id, &job.request.session_id)?
        .map(|text| bound_tail(&text, DISPATCH_RESULT_SUMMARY_MAX_TEXT_BYTES))
        .map_or((None, false), |(text, cut)| (Some(text), cut));
    let duration_ms = match (&state.started_at, &state.finished_at) {
        (Some(started), Some(finished)) => duration_between(started, finished),
        _ => None,
    };
    let git_facts = git_facts.unwrap_or_default();
    Ok(DispatchResultSummary {
        kind: "resultSummary".to_string(),
        job_id: job_id.to_string(),
        session_id: job.request.session_id,
        state: state.state,
        branch: provision.branch.or(git_facts.branch),
        base_commit: provision.base_commit,
        head_commit: git_facts.head,
        commit_count: git_facts.commit_count,
        uncommitted_changes: git_facts.uncommitted,
        diff_stat: git_facts.diff_stat,
        started_at: state.started_at.clone(),
        finished_at: state.finished_at.clone(),
        duration_ms,
        last_error: state.last_error.clone(),
        summary,
        summary_truncated,
    })
}

#[derive(Default)]
struct GitFacts {
    branch: Option<String>,
    head: Option<String>,
    commit_count: u64,
    uncommitted: bool,
    diff_stat: Option<DispatchDiffStat>,
}

fn git_facts(worktree: &Path, base_commit: Option<&str>) -> GitFacts {
    let trimmed = |args: &[&str]| {
        git(worktree, args)
            .ok()
            .map(|output| output.trim().to_string())
            .filter(|output| !output.is_empty())
    };
    let head = trimmed(&["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]);
    let branch = trimmed(&["branch", "--show-current"]);
    let commit_count = base_commit
        .and_then(|base| trimmed(&["rev-list", "--count", &format!("{base}..HEAD")]))
        .and_then(|count| count.parse().ok())
        .unwrap_or(0);
    let uncommitted = trimmed(&["status", "--porcelain"]).is_some();
    // Against the base when the job has one (its commits plus uncommitted
    // work), otherwise only the uncommitted work against HEAD.
    let against = base_commit.unwrap_or("HEAD");
    let diff_stat = git(
        worktree,
        &["diff", "--numstat", "-z", "--no-renames", against],
    )
    .ok()
    .map(|numstat| {
        let untracked = git(
            worktree,
            &["ls-files", "--others", "--exclude-standard", "-z"],
        )
        .unwrap_or_default();
        diff_stat_from(&numstat, &untracked)
    });
    GitFacts {
        branch,
        head,
        commit_count,
        uncommitted,
        diff_stat,
    }
}

/// Build a diff stat from `git diff --numstat -z --no-renames` and
/// `git ls-files --others -z`. Totals count every file; `files` keeps the
/// largest changes first, bounded.
pub(super) fn diff_stat_from(numstat: &str, untracked: &str) -> DispatchDiffStat {
    let mut files: Vec<DispatchDiffStatFile> = numstat
        .split('\0')
        .filter(|entry| !entry.trim().is_empty())
        .filter_map(|entry| {
            let mut parts = entry.splitn(3, '\t');
            let added = parts.next()?.trim();
            let deleted = parts.next()?.trim();
            let path = parts.next()?.trim_end_matches('\n');
            if path.is_empty() {
                return None;
            }
            let binary = added == "-" || deleted == "-";
            Some(DispatchDiffStatFile {
                path: path.to_string(),
                added: added.parse().ok(),
                deleted: deleted.parse().ok(),
                binary,
                untracked: false,
            })
        })
        .collect();
    files.extend(
        untracked
            .split('\0')
            .filter(|path| !path.is_empty())
            .map(|path| DispatchDiffStatFile {
                path: path.to_string(),
                added: None,
                deleted: None,
                binary: false,
                untracked: true,
            }),
    );
    let insertions = files.iter().filter_map(|file| file.added).sum();
    let deletions = files.iter().filter_map(|file| file.deleted).sum();
    let files_changed = files.len() as u64;
    let weight = |file: &DispatchDiffStatFile| {
        file.added
            .unwrap_or(0)
            .saturating_add(file.deleted.unwrap_or(0))
    };
    files.sort_by(|a, b| weight(b).cmp(&weight(a)).then_with(|| a.path.cmp(&b.path)));
    let truncated = files.len() > DISPATCH_RESULT_SUMMARY_MAX_FILES;
    files.truncate(DISPATCH_RESULT_SUMMARY_MAX_FILES);
    DispatchDiffStat {
        files_changed,
        insertions,
        deletions,
        files,
        truncated,
    }
}

/// The text of the last assistant round of the job's own session (child
/// sessions are excluded), from the durable event log.
fn last_reply(store: &DispatchStore, job_id: &str, session_id: &str) -> Result<Option<String>> {
    let mut cursor = 0;
    let mut round: Option<(String, String)> = None;
    let mut text = String::new();
    for _ in 0..MAX_SUMMARY_EVENT_PAGES {
        let page = store.read_events(job_id, cursor)?;
        for event in &page.events {
            let DispatchEvent::AgentEvent { event, .. } = event else {
                continue;
            };
            let inner = event.get("event").unwrap_or(event);
            if inner.get("type").and_then(serde_json::Value::as_str) != Some("TextChunk")
                || inner.get("session_id").and_then(serde_json::Value::as_str) != Some(session_id)
            {
                continue;
            }
            let key = (
                string_field(inner, "turn_id"),
                string_field(inner, "round_id"),
            );
            if round.as_ref() != Some(&key) {
                round = Some(key);
                text.clear();
            }
            text.push_str(
                inner
                    .get("text")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or_default(),
            );
            // Only the tail is ever returned; keep the buffer bounded.
            if text.len() > DISPATCH_RESULT_SUMMARY_MAX_TEXT_BYTES * 2 {
                text = bound_tail(&text, DISPATCH_RESULT_SUMMARY_MAX_TEXT_BYTES + 1).0;
            }
        }
        if page.events.is_empty() || page.cursor <= cursor {
            break;
        }
        cursor = page.cursor;
    }
    Ok(Some(text).filter(|text| !text.trim().is_empty()))
}

fn string_field(value: &serde_json::Value, field: &str) -> String {
    value
        .get(field)
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default()
        .to_string()
}

/// Keep the last `max` bytes on a character boundary; true when cut.
pub(super) fn bound_tail(text: &str, max: usize) -> (String, bool) {
    if text.len() <= max {
        return (text.to_string(), false);
    }
    let mut start = text.len() - max;
    while !text.is_char_boundary(start) {
        start += 1;
    }
    (text[start..].to_string(), true)
}

fn duration_between(started: &str, finished: &str) -> Option<u64> {
    let started = chrono::DateTime::parse_from_rfc3339(started).ok()?;
    let finished = chrono::DateTime::parse_from_rfc3339(finished).ok()?;
    u64::try_from((finished - started).num_milliseconds()).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numstat_is_parsed_counted_and_bounded() {
        let mut numstat = String::from("3\t1\tsrc/a.rs\0-\t-\tlogo.png\0");
        for index in 0..60 {
            numstat.push_str(&format!("1\t0\tfile-{index:02}.txt\0"));
        }
        let stat = diff_stat_from(&numstat, "new.txt\0dir/other.md\0");
        assert_eq!(stat.files_changed, 64);
        assert_eq!(stat.insertions, 63);
        assert_eq!(stat.deletions, 1);
        assert!(stat.truncated);
        assert_eq!(stat.files.len(), DISPATCH_RESULT_SUMMARY_MAX_FILES);
        assert_eq!(stat.files[0].path, "src/a.rs");
        let stat = diff_stat_from("-\t-\tlogo.png\0", "new.txt\0");
        assert!(stat
            .files
            .iter()
            .any(|file| file.binary && file.added.is_none()));
        assert!(stat
            .files
            .iter()
            .any(|file| file.untracked && file.path == "new.txt"));
        assert!(!stat.truncated);
    }

    #[test]
    fn tails_cut_on_character_boundaries() {
        assert_eq!(bound_tail("short", 10), ("short".to_string(), false));
        let (tail, cut) = bound_tail("ééééé", 3);
        assert!(cut);
        assert_eq!(tail, "é");
        assert_eq!(
            duration_between("2026-01-01T00:00:00Z", "2026-01-01T00:01:05Z"),
            Some(65_000)
        );
        assert_eq!(
            duration_between("2026-01-01T00:01:00Z", "2026-01-01T00:00:00Z"),
            None
        );
    }
}

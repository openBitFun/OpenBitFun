//! The dispatch-target wire as the cloud agent speaks it.
//!
//! Requests are built from the shared target DTOs
//! (`services-core::dispatch_contract::wire`, feature `dispatch-wire`), which
//! reject unknown fields on the target. A field the base protocol lacks is
//! only sent when the target advertised the capability that adds it
//! (`status_summary_only_v1` for `summaryOnly`, `job_submitter_v1` for
//! `submitter`, `workspace_target_source_v1` for the provision-source verb).
//! Answers are read tolerantly.

use std::time::Duration;

use openbitfun_product_domains::superagent::{
    DiffStat, DispatchSourceInput, JobPendingPrompt, TargetJobState, CLOUD_SUBMITTER,
};
use openbitfun_services_core::dispatch_contract::wire::{
    DispatchApprovalPolicy, DispatchProvisionSource, DispatchQueryKind, DispatchQueryRequest,
    DispatchResultSummary, DispatchStatusRequest, DispatchSubmitRequest,
    DispatchWorkspaceProvisionSourceRequest, DispatchWorkspaceProvisionSourceResponse,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::ledger::JobRecord;

pub use openbitfun_services_core::dispatch_contract::DISPATCH_PROTOCOL_VERSION;

/// Polls of a pending source provision before the watcher retries the
/// submit instead.
pub const PROVISION_POLLS: usize = 30;
pub const PROVISION_POLL_INTERVAL: Duration = Duration::from_millis(500);
/// The agent the target runs when the model names none.
pub const DEFAULT_AGENT: &str = "agentic";

fn to_value<T: serde::Serialize>(value: &T) -> Value {
    serde_json::to_value(value).unwrap_or(Value::Null)
}

pub fn status_args(job_id: &str, cursor: u64, summary_only: bool) -> Value {
    to_value(&DispatchStatusRequest {
        job_id: job_id.to_string(),
        cursor,
        summary_only,
    })
}

#[derive(Debug, Clone, Default)]
pub struct StatusView {
    pub state: TargetJobState,
    pub cursor: u64,
    pub pending: Vec<JobPendingPrompt>,
    /// Per pending prompt: what it asks for (a command or an input summary),
    /// when the answer carried it (full status pages do; summary-only
    /// answers do not).
    pub pending_summaries: Vec<Option<PromptSummary>>,
    pub last_error: Option<String>,
}

/// What a waiting prompt asks for, at most [`PROMPT_SUMMARY_MAX`] chars.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PromptSummary {
    pub request_id: String,
    /// Set when the prompt runs a command.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    pub summary: String,
}

pub const PROMPT_SUMMARY_MAX: usize = 512;

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct PendingWire {
    request_id: String,
    action: Option<String>,
    tool_name: Option<String>,
    title: Option<String>,
    resources: Vec<String>,
    display_metadata: serde_json::Map<String, Value>,
}

fn clip(text: &str) -> String {
    let text = text.trim();
    if text.chars().count() <= PROMPT_SUMMARY_MAX {
        return text.to_string();
    }
    let mut out: String = text.chars().take(PROMPT_SUMMARY_MAX - 1).collect();
    out.push('…');
    out
}

fn prompt_summary(item: &PendingWire) -> Option<PromptSummary> {
    let meta = |key: &str| {
        item.display_metadata
            .get(key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|v| !v.is_empty())
    };
    let tool = item
        .tool_name
        .as_deref()
        .or(item.action.as_deref())
        .unwrap_or("");
    let shell = matches!(
        tool.to_ascii_lowercase().as_str(),
        "bash" | "shell" | "terminal" | "run_command" | "execute_command" | "powershell"
    );
    let resources = item
        .resources
        .iter()
        .map(|r| r.trim())
        .filter(|r| !r.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    let command = meta("command")
        .map(str::to_string)
        .or_else(|| (shell && !resources.is_empty()).then(|| resources.clone()))
        .map(|c| clip(&c));
    let summary = command
        .clone()
        .or_else(|| meta("summary").or_else(|| meta("description")).map(clip))
        .or_else(|| (!resources.is_empty()).then(|| clip(&resources)))?;
    Some(PromptSummary {
        request_id: item.request_id.clone(),
        command,
        summary,
    })
}

/// A full status page or a summary-only answer (same field names).
pub fn parse_status(value: &Value) -> StatusView {
    let state = value
        .get("state")
        .cloned()
        .and_then(|state| serde_json::from_value(state).ok())
        .unwrap_or_default();
    let items: Vec<PendingWire> = value
        .get("pendingPermissions")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| serde_json::from_value::<PendingWire>(item.clone()).ok())
                .filter(|item| !item.request_id.is_empty())
                .collect()
        })
        .unwrap_or_default();
    let pending_summaries = items.iter().map(prompt_summary).collect();
    let pending = items
        .into_iter()
        .map(|item| JobPendingPrompt {
            request_id: item.request_id,
            tool_name: item.tool_name.or(item.action),
            title: item.title,
            more: 0,
        })
        .collect();
    StatusView {
        state,
        cursor: value.get("cursor").and_then(Value::as_u64).unwrap_or(0),
        pending,
        pending_summaries,
        last_error: value
            .get("lastError")
            .and_then(Value::as_str)
            .map(str::to_string),
    }
}

/// The job's result branch on its target.
pub fn job_branch(job_id: &str) -> String {
    format!("openbitfun/dispatch/{job_id}")
}

/// The provision-source request. A `job` source (peer import,
/// `workspace_peer_import_v1`, phase S2) has no shared DTO yet; it is only
/// sent to targets that advertise that capability.
pub fn provision_args(
    job_id: &str,
    source: &DispatchSourceInput,
    origin: Option<&JobRecord>,
) -> Value {
    let branch = job_branch(job_id);
    let source = match source {
        DispatchSourceInput::Workspace {
            workspace_id,
            git_ref,
        } => DispatchProvisionSource::Workspace {
            workspace_id: workspace_id.clone(),
            git_ref: git_ref.clone(),
        },
        DispatchSourceInput::Remote {
            remote_url,
            git_ref,
        } => DispatchProvisionSource::Remote {
            remote_url: remote_url.clone(),
            git_ref: git_ref.clone(),
        },
        DispatchSourceInput::Job { job_id: origin_id } => {
            return json!({
                "protocolVersion": DISPATCH_PROTOCOL_VERSION,
                "jobId": job_id,
                "source": {
                    "kind": "job",
                    "jobId": origin_id,
                    "sourceDeviceId": origin.map(|o| o.device_id.clone()),
                    "branch": origin.and_then(|o| o.branch.clone()),
                    "baseCommit": origin.and_then(|o| o.base_commit.clone()),
                },
                "branch": branch,
            })
        }
    };
    to_value(&DispatchWorkspaceProvisionSourceRequest {
        protocol_version: DISPATCH_PROTOCOL_VERSION,
        job_id: job_id.to_string(),
        source,
        branch,
    })
}

#[derive(Debug, Clone, Default)]
pub struct ProvisionView {
    pub pending: bool,
    pub provisioned: bool,
    pub workspace_path: String,
    pub branch: Option<String>,
    pub base_commit: Option<String>,
    pub fetch_error: Option<String>,
}

pub fn parse_provision(value: &Value) -> Result<ProvisionView, String> {
    let answer: DispatchWorkspaceProvisionSourceResponse = serde_json::from_value(value.clone())
        .map_err(|error| format!("unreadable provision answer: {error}"))?;
    let workspace_path = answer.workspace_path.unwrap_or_default();
    if answer.provisioned && workspace_path.is_empty() {
        return Err("the target answered without a workspace".into());
    }
    Ok(ProvisionView {
        pending: answer.pending,
        provisioned: answer.provisioned,
        workspace_path,
        branch: Some(answer.branch).filter(|b| !b.is_empty()),
        base_commit: Some(answer.base_commit).filter(|c| !c.is_empty()),
        fetch_error: answer.fetch_error,
    })
}

fn approval_policy(value: &str) -> DispatchApprovalPolicy {
    match value {
        "remote" => DispatchApprovalPolicy::Remote,
        "reject-and-report" => DispatchApprovalPolicy::RejectAndReport,
        _ => DispatchApprovalPolicy::Auto,
    }
}

/// `submitter` only for targets with `job_submitter_v1` (older targets
/// reject the field).
pub fn submit_args(job: &JobRecord, workspace_path: &str, submitter: bool) -> Value {
    let non_empty = |value: &Option<String>| value.clone().filter(|v| !v.trim().is_empty());
    to_value(&DispatchSubmitRequest {
        protocol_version: DISPATCH_PROTOCOL_VERSION,
        job_id: job.job_id.clone(),
        session_id: job.session_id.clone(),
        workspace_path: workspace_path.to_string(),
        agent_type: job
            .agent
            .clone()
            .unwrap_or_else(|| DEFAULT_AGENT.to_string()),
        prompt: job.instructions.clone(),
        approval_policy: approval_policy(&job.approval),
        model: non_empty(&job.model),
        reasoning_preset: non_empty(&job.reasoning_preset),
        title: Some(job.title.clone()).filter(|t| !t.trim().is_empty()),
        attachments: Vec::new(),
        setup_audit: Vec::new(),
        submitter: submitter.then(|| CLOUD_SUBMITTER.to_string()),
    })
}

pub fn parse_submit(value: &Value) -> TargetJobState {
    value
        .get("state")
        .cloned()
        .and_then(|state| serde_json::from_value(state).ok())
        .unwrap_or(TargetJobState::Queued)
}

pub fn result_summary_args(job_id: &str) -> Value {
    to_value(&DispatchQueryRequest {
        job_id: job_id.to_string(),
        kind: DispatchQueryKind::ResultSummary,
        file_path: None,
        file_chunk: None,
    })
}

#[derive(Debug, Clone, Default)]
pub struct ResultSummaryView {
    pub summary: Option<String>,
    pub branch: Option<String>,
    pub diff_stat: Option<DiffStat>,
}

pub fn parse_result_summary(value: &Value) -> ResultSummaryView {
    match serde_json::from_value::<DispatchResultSummary>(value.clone()) {
        Ok(summary) => ResultSummaryView {
            summary: summary.summary,
            branch: summary.branch,
            // Same field names on both sides.
            diff_stat: summary
                .diff_stat
                .and_then(|stat| serde_json::to_value(stat).ok())
                .and_then(|stat| serde_json::from_value(stat).ok()),
        },
        Err(error) => {
            // A newer or older target: read the fields this build knows.
            log::debug!("Result summary read tolerantly: {}", error);
            ResultSummaryView {
                summary: value
                    .get("summary")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                branch: value
                    .get("branch")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                diff_stat: value
                    .get("diffStat")
                    .cloned()
                    .and_then(|stat| serde_json::from_value(stat).ok()),
            }
        }
    }
}

/// A bounded plain-text rendering of a job's events (an explicit,
/// user-visible transcript read).
pub fn transcript_text(status: &Value, max: usize) -> String {
    let mut out = String::new();
    for event in status
        .get("events")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let line = match event.get("type").and_then(Value::as_str) {
            Some("jobState") => format!(
                "[state] {}{}",
                event.get("state").and_then(Value::as_str).unwrap_or(""),
                event
                    .get("message")
                    .and_then(Value::as_str)
                    .map(|m| format!(": {m}"))
                    .unwrap_or_default()
            ),
            Some("agentEvent") => {
                let payload = event.get("frontendPayload").or_else(|| event.get("event"));
                let text = payload
                    .and_then(|p| p.get("text").or_else(|| p.get("content")))
                    .and_then(Value::as_str)
                    .unwrap_or("");
                if text.is_empty() {
                    continue;
                }
                text.to_string()
            }
            Some("permissionRejected") => format!(
                "[permission rejected] {}",
                event.get("reason").and_then(Value::as_str).unwrap_or("")
            ),
            _ => continue,
        };
        if out.len() + line.len() + 1 > max {
            out.push_str("…");
            break;
        }
        out.push_str(&line);
        out.push('\n');
    }
    out
}

pub fn append_args(job_id: &str, message_id: &str, content: &str) -> Value {
    json!({ "jobId": job_id, "messageId": message_id, "content": content })
}

pub fn continue_args(job_id: &str, turn_id: &str, prompt: &str) -> Value {
    json!({
        "protocolVersion": DISPATCH_PROTOCOL_VERSION,
        "jobId": job_id,
        "turnId": turn_id,
        "prompt": prompt,
    })
}

/// `feedback` only on a reject.
pub fn answer_args(job_id: &str, request_id: &str, reply: &str, feedback: Option<&str>) -> Value {
    let mut args = json!({ "jobId": job_id, "requestId": request_id, "reply": reply });
    if reply == "reject" {
        if let Some(feedback) = feedback.filter(|f| !f.trim().is_empty()) {
            args["feedback"] = Value::String(feedback.to_string());
        }
    }
    args
}

/// Publish (`workspace_publish_v1`, phase S2): only called on targets that
/// advertise it.
pub fn publish_args(job_id: &str, remote: Option<&str>) -> Value {
    let mut args = json!({ "protocolVersion": DISPATCH_PROTOCOL_VERSION, "jobId": job_id });
    if let Some(remote) = remote {
        args["remote"] = Value::String(remote.to_string());
    }
    args
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_reads_tolerantly_and_summary_only_is_negotiated() {
        assert!(status_args("j", 3, false).get("summaryOnly").is_none());
        assert_eq!(status_args("j", 3, true)["summaryOnly"], true);
        let view = parse_status(&json!({
            "summaryOnly": true, "state": "running", "cursor": 7, "futureField": 1,
            "pendingPermissions": [{"requestId": "p1", "toolName": "bash"}]
        }));
        assert_eq!(view.state, TargetJobState::Running);
        assert_eq!(view.cursor, 7);
        assert_eq!(view.pending[0].request_id, "p1");
        assert_eq!(view.pending[0].tool_name.as_deref(), Some("bash"));
        assert_eq!(
            parse_status(&json!({"state": "paused"})).state,
            TargetJobState::Unknown
        );
    }

    #[test]
    fn requests_match_the_target_dtos() {
        let job = JobRecord {
            job_id: "sa-1".into(),
            session_id: "s".into(),
            instructions: "do it".into(),
            approval: "auto".into(),
            ..JobRecord::default()
        };
        // The target's own request types read them back (deny_unknown_fields).
        let submit: DispatchSubmitRequest =
            serde_json::from_value(submit_args(&job, "/w", true)).unwrap();
        assert_eq!(submit.submitter.as_deref(), Some("cloud"));
        assert!(submit_args(&job, "/w", false).get("submitter").is_none());
        let source = DispatchSourceInput::Workspace {
            workspace_id: "w1".into(),
            git_ref: None,
        };
        let provision: DispatchWorkspaceProvisionSourceRequest =
            serde_json::from_value(provision_args("sa-1", &source, None)).unwrap();
        assert_eq!(provision.branch, "openbitfun/dispatch/sa-1");
        let _: DispatchQueryRequest = serde_json::from_value(result_summary_args("sa-1")).unwrap();
        let _: DispatchStatusRequest =
            serde_json::from_value(status_args("sa-1", 0, true)).unwrap();
        assert!(answer_args("j", "p", "once", Some("x"))
            .get("feedback")
            .is_none());
        assert_eq!(
            answer_args("j", "p", "reject", Some("no"))["feedback"],
            "no"
        );
        let parsed = parse_provision(
            &json!({"pending": false, "provisioned": true, "workspacePath": "/w",
            "baseCommit": "abc", "branch": "openbitfun/dispatch/sa-1", "sourceDirty": true}),
        )
        .unwrap();
        assert_eq!(parsed.workspace_path, "/w");
        assert!(
            parse_provision(&json!({"provisioned": true, "baseCommit": "a", "branch": "b"}))
                .is_err()
        );
    }
}

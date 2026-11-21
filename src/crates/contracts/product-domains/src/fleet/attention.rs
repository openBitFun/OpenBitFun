//! The Inbox: everything that waits on the user, from every device
//! (`fleet_attention`), projected by the entry from its fleet index.
//!
//! Three sources, merged and ordered here so every frontend draws the same
//! groups and badge:
//!
//! - **Needs you**: the pending prompts of every device (the prompt tray),
//!   then the account's cloud-agent jobs blocked on the user whose prompt the
//!   index does not hold yet;
//! - **Done**: cloud-agent jobs that finished, until marked read;
//! - **Failed**: cloud-agent jobs that failed and sessions that ended in an
//!   error, until marked read.
//!
//! Read state lives with the entry (`fleet_attention_mark_read`): a Done or
//! Failed item is read through its stamp (the session's last activity, the
//! job's update time), so a newer failure of the same session shows again.
//! Prompts are never "read"; they leave when they are answered.

use std::collections::{BTreeMap, HashSet};

use serde::{Deserialize, Serialize};

use super::dto::{
    null_default, FleetActionGate, FleetDevice, FleetHostKind, FleetPrompt, FleetPromptKind,
    FleetSessionStatus,
};
use crate::superagent::{JobCard, SuperagentJobState};

/// Published by the entry when the projection changed (`{revision}`).
pub const FLEET_ATTENTION_CHANGED_EVENT: &str = "fleet://attention-changed";

/// Group ids, in display order.
pub const ATTENTION_GROUP_NEEDS_YOU: &str = "needs_you";
pub const ATTENTION_GROUP_DONE: &str = "done";
pub const ATTENTION_GROUP_FAILED: &str = "failed";

/// `fleet_attention {sinceRevision?}`. The answer is always the whole view.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FleetAttentionRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub since_revision: Option<u64>,
}

/// `fleet_attention_mark_read {revision}`: marks the Done and Failed items
/// of the view the client saw at `revision` read.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FleetAttentionMarkReadRequest {
    #[serde(deserialize_with = "null_default")]
    pub revision: u64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FleetAttentionMarkReadResponse {
    /// The view's revision after marking.
    #[serde(deserialize_with = "null_default")]
    pub revision: u64,
    /// Items marked read now.
    #[serde(deserialize_with = "null_default")]
    pub marked: u32,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AttentionKind {
    Permission,
    Question,
    Failure,
    Done,
    #[default]
    #[serde(other)]
    Unknown,
}

/// Where an item comes from: a device's session or job, or a cloud-agent
/// conversation.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AttentionSource {
    #[serde(deserialize_with = "null_default")]
    pub device_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conversation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub job_id: Option<String>,
}

/// One Inbox item (`AttentionEntry` in the UI).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AttentionItem {
    #[serde(deserialize_with = "null_default")]
    pub item_id: String,
    #[serde(deserialize_with = "null_default")]
    pub kind: AttentionKind,
    #[serde(deserialize_with = "null_default")]
    pub source: AttentionSource,
    #[serde(deserialize_with = "null_default")]
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host_kind: Option<FleetHostKind>,
    /// A prompt item carries its prompt (answered on its device).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt: Option<FleetPrompt>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub answerable: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub age_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unread: Option<bool>,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub actions: BTreeMap<String, FleetActionGate>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AttentionGroup {
    #[serde(deserialize_with = "null_default")]
    pub id: String,
    #[serde(deserialize_with = "null_default")]
    pub items: Vec<AttentionItem>,
}

/// `fleet_attention` answer.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FleetAttentionView {
    #[serde(deserialize_with = "null_default")]
    pub revision: u64,
    /// Non-empty groups, in display order.
    #[serde(deserialize_with = "null_default")]
    pub groups: Vec<AttentionGroup>,
    /// The needs-you count (sidebar pill, phone tab badge).
    #[serde(deserialize_with = "null_default")]
    pub badge: u32,
}

/// A cloud-agent job as the projection reads it: its card plus the card's
/// optional conversation and update time.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct AttentionJob {
    pub card: JobCard,
    pub conversation_id: Option<String>,
    pub updated_ms: Option<u64>,
}

impl AttentionJob {
    /// Reads one card as the cloud node answers it (tolerant: an unreadable
    /// card or one without a job id is `None`).
    pub fn from_value(value: &serde_json::Value) -> Option<Self> {
        let card: JobCard = serde_json::from_value(value.clone()).ok()?;
        if card.job_id.is_empty() {
            return None;
        }
        Some(Self {
            card,
            conversation_id: value
                .get("conversationId")
                .and_then(serde_json::Value::as_str)
                .filter(|id| !id.is_empty())
                .map(str::to_string),
            updated_ms: value.get("updatedMs").and_then(serde_json::Value::as_u64),
        })
    }
}

/// What the projection reads.
pub struct AttentionInputs<'a> {
    /// The navigator devices, in navigator order.
    pub devices: &'a [FleetDevice],
    /// The prompt tray, in tray order.
    pub prompts: &'a [FleetPrompt],
    /// The cloud agent's jobs that need the user, and its recent terminal
    /// ones (empty when the cloud node is not indexed).
    pub jobs: &'a [AttentionJob],
    pub now_ms: u64,
}

/// The projection: the view's groups and badge, and every readable (Done or
/// Failed) item with its stamp, for `fleet_attention_mark_read`.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct AttentionProjection {
    pub groups: Vec<AttentionGroup>,
    pub badge: u32,
    pub readable: Vec<(String, u64)>,
}

fn gate(allowed: bool, reason: Option<&str>) -> FleetActionGate {
    FleetActionGate {
        allowed,
        reason: if allowed {
            None
        } else {
            reason.map(str::to_string)
        },
    }
}

/// Projects the Inbox. `is_read(itemId, stamp)` says whether the user marked
/// that item read at (or after) that stamp.
pub fn project_attention(
    inputs: &AttentionInputs<'_>,
    is_read: &dyn Fn(&str, u64) -> bool,
) -> AttentionProjection {
    let device = |id: &str| inputs.devices.iter().find(|device| device.device_id == id);
    let session = |device_id: &str, session_id: &str| {
        device(device_id).and_then(|device| {
            device
                .workspaces
                .iter()
                .flat_map(|workspace| workspace.sessions.iter())
                .find(|session| session.session_id == session_id)
        })
    };
    let age = |stamp: u64| (stamp > 0).then(|| inputs.now_ms.saturating_sub(stamp));

    // Needs you: every pending prompt, in tray order.
    let mut needs_you = Vec::new();
    let mut prompted_jobs = HashSet::new();
    for prompt in inputs.prompts {
        if let Some(job) = prompt.job_id.as_deref().filter(|job| !job.is_empty()) {
            prompted_jobs.insert(job.to_string());
        }
        let row = session(&prompt.device_id, &prompt.session_id);
        let session_title = row.map(|row| row.title.trim()).filter(|t| !t.is_empty());
        let title = session_title.unwrap_or(prompt.title.as_str()).to_string();
        let detail = session_title
            .map(|_| prompt.title.clone())
            .filter(|detail| !detail.is_empty() && *detail != title);
        let kind = match prompt.kind {
            FleetPromptKind::Question => AttentionKind::Question,
            _ => AttentionKind::Permission,
        };
        let owner = device(&prompt.device_id);
        let mut actions = BTreeMap::new();
        actions.insert(
            "answer".to_string(),
            gate(prompt.answerable, prompt.unanswerable_reason.as_deref()),
        );
        actions.insert("open".to_string(), gate(true, None));
        needs_you.push(AttentionItem {
            item_id: format!("{}/{}", prompt.device_id, prompt.prompt_id),
            kind,
            source: AttentionSource {
                device_id: prompt.device_id.clone(),
                workspace_id: Some(prompt.workspace_id.clone()).filter(|id| !id.is_empty()),
                session_id: Some(prompt.session_id.clone()).filter(|id| !id.is_empty()),
                conversation_id: None,
                job_id: prompt.job_id.clone().filter(|id| !id.is_empty()),
            },
            title,
            detail,
            device_name: owner.map(|device| device.name.clone()),
            host_kind: owner.map(|device| device.host_kind),
            prompt: Some(prompt.clone()),
            answerable: Some(prompt.answerable),
            reason: prompt.unanswerable_reason.clone(),
            age_ms: row.and_then(|row| age(row.last_activity_ms)),
            unread: None,
            actions,
        });
    }

    // Cloud jobs: blocked ones the tray does not hold, then terminal ones.
    let mut jobs: Vec<&AttentionJob> = inputs.jobs.iter().collect();
    jobs.sort_by(|a, b| b.updated_ms.unwrap_or(0).cmp(&a.updated_ms.unwrap_or(0)));
    let mut seen_jobs = HashSet::new();
    let mut done = Vec::new();
    let mut failed: Vec<(u64, AttentionItem)> = Vec::new();
    let mut readable = Vec::new();
    for job in jobs {
        let card = &job.card;
        if !seen_jobs.insert(card.job_id.clone()) {
            continue;
        }
        let stamp = job.updated_ms.unwrap_or(0);
        let item_id = format!("job:{}", card.job_id);
        let mut actions = BTreeMap::new();
        actions.insert("open".to_string(), card.actions.open_transcript.clone());
        let item = |kind: AttentionKind| AttentionItem {
            item_id: item_id.clone(),
            kind,
            source: AttentionSource {
                device_id: card.device_id.clone(),
                workspace_id: None,
                session_id: None,
                conversation_id: job.conversation_id.clone(),
                job_id: Some(card.job_id.clone()),
            },
            title: card.title.clone(),
            detail: card.state_reason.clone(),
            device_name: Some(card.device_name.clone()).filter(|name| !name.is_empty()),
            host_kind: Some(card.host_kind),
            prompt: None,
            answerable: None,
            reason: None,
            age_ms: age(stamp),
            unread: None,
            actions: actions.clone(),
        };
        match card.state {
            SuperagentJobState::Blocked => {
                if prompted_jobs.contains(&card.job_id) {
                    // Its prompt is in the tray, answerable on its device.
                    continue;
                }
                let mut entry = item(AttentionKind::Permission);
                entry.detail = card
                    .pending_prompt
                    .as_ref()
                    .and_then(|prompt| prompt.title.clone().or_else(|| prompt.tool_name.clone()))
                    .or(entry.detail);
                entry.answerable = Some(false);
                entry.reason = Some("prompt_not_indexed".to_string());
                entry.actions.insert(
                    "answer".to_string(),
                    gate(false, Some("prompt_not_indexed")),
                );
                needs_you.push(entry);
            }
            SuperagentJobState::Done if !is_read(&item_id, stamp) => {
                readable.push((item_id.clone(), stamp));
                let mut entry = item(AttentionKind::Done);
                entry.unread = Some(true);
                done.push(entry);
            }
            SuperagentJobState::Failed if !is_read(&item_id, stamp) => {
                readable.push((item_id.clone(), stamp));
                let mut entry = item(AttentionKind::Failure);
                entry.unread = Some(true);
                failed.push((stamp, entry));
            }
            _ => {}
        }
    }

    // Sessions that ended in an error, on every device.
    for device in inputs.devices {
        for workspace in &device.workspaces {
            for row in &workspace.sessions {
                if row.status != FleetSessionStatus::Error {
                    continue;
                }
                let item_id = format!("session:{}/{}", device.device_id, row.session_id);
                let stamp = row.last_activity_ms;
                if is_read(&item_id, stamp) {
                    continue;
                }
                readable.push((item_id.clone(), stamp));
                let mut actions = BTreeMap::new();
                actions.insert(
                    "open".to_string(),
                    gate(device.state.accepts_calls(), Some("device_unavailable")),
                );
                failed.push((
                    stamp,
                    AttentionItem {
                        item_id,
                        kind: AttentionKind::Failure,
                        source: AttentionSource {
                            device_id: device.device_id.clone(),
                            workspace_id: Some(workspace.workspace_id.clone()),
                            session_id: Some(row.session_id.clone()),
                            conversation_id: None,
                            job_id: None,
                        },
                        title: if row.title.trim().is_empty() {
                            workspace.name.clone()
                        } else {
                            row.title.clone()
                        },
                        detail: Some(workspace.name.clone()).filter(|name| !name.is_empty()),
                        device_name: Some(device.name.clone()),
                        host_kind: Some(device.host_kind),
                        prompt: None,
                        answerable: None,
                        reason: None,
                        age_ms: age(stamp),
                        unread: Some(true),
                        actions,
                    },
                ));
            }
        }
    }
    // Newest failure first; a stable order for equal stamps.
    failed.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.item_id.cmp(&b.1.item_id)));

    let badge = u32::try_from(needs_you.len()).unwrap_or(u32::MAX);
    let mut groups = Vec::new();
    for (id, items) in [
        (ATTENTION_GROUP_NEEDS_YOU, needs_you),
        (ATTENTION_GROUP_DONE, done),
        (
            ATTENTION_GROUP_FAILED,
            failed.into_iter().map(|(_, item)| item).collect(),
        ),
    ] {
        if !items.is_empty() {
            groups.push(AttentionGroup {
                id: id.to_string(),
                items,
            });
        }
    }
    AttentionProjection {
        groups,
        badge,
        readable,
    }
}

#[cfg(test)]
#[path = "attention_tests.rs"]
mod tests;

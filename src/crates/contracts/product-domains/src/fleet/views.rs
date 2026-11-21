//! Fleet view models the entry projects from its index, so a frontend only
//! draws them (ux-redesign §7):
//!
//! - `fleet_recent_sessions {limit?, cursor?}`: the flat Recent list of All
//!   sessions, every runtime device's top-level sessions, most recent first,
//!   each with its device and workspace labels;
//! - `fleet_device_detail {deviceId}`: one device page: the navigator row
//!   (facts, route, version, workspaces), what runs there now, the jobs that
//!   wait to start or wait on the user, the user-facing capabilities, and how
//!   to update a device that needs it.
//!
//! Both are pure projections over the navigator projection
//! ([`super::project_navigator`]), the prompt tray ([`super::project_prompts`])
//! and, for the device page, the cloud agent's job cards the entry holds.
//! They are bounded by the index (the navigator window per workspace), so a
//! session beyond the window is paged from its owner, never invented here.

use serde::{Deserialize, Serialize};

use super::dto::{
    null_default, FleetActionGate, FleetAnswerRoute, FleetDevice, FleetDeviceState, FleetHostKind,
    FleetPrompt, FleetSession, FleetSessionOrigin, FleetSessionStatus,
};
use crate::superagent::{JobCard, SuperagentJobState};

/// Recent rows per page when the request names no limit.
pub const RECENT_SESSIONS_DEFAULT_LIMIT: usize = 50;
/// The largest Recent page.
pub const RECENT_SESSIONS_MAX_LIMIT: usize = 200;

/// The update line of a device that runs a CLI host.
pub const CLI_UPDATE_COMMAND: &str = "openbitfun update";

/// User-facing capability ids of a device page (`capabilities`); frontends
/// localize them.
pub const DEVICE_CAPABILITY_TERMINAL: &str = "terminal";
pub const DEVICE_CAPABILITY_GIT: &str = "git";
pub const DEVICE_CAPABILITY_BROWSER: &str = "browser";
pub const DEVICE_CAPABILITY_DESKTOP: &str = "desktop";
pub const DEVICE_CAPABILITY_JOBS: &str = "jobs";

/// Reason codes of the device page.
pub const REASON_WAITING_FOR_DEVICE: &str = "waiting_for_device";
pub const REASON_NEEDS_ANSWER: &str = "needs_answer";
pub const REASON_PROMPT_NOT_INDEXED: &str = "prompt_not_indexed";

// ---------------------------------------------------------------------------
// Recent sessions (`fleet_recent_sessions`)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FleetRecentSessionsRequest {
    /// Rows per page (default 50, at most 200).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<u32>,
    /// The `nextCursor` of the previous page; absent for the first page.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cursor: Option<String>,
}

/// One Recent row: the session as the navigator lists it, with the labels
/// of the device and workspace it belongs to.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FleetRecentSession {
    #[serde(flatten)]
    pub session: FleetSession,
    #[serde(deserialize_with = "null_default")]
    pub device_name: String,
    #[serde(deserialize_with = "null_default")]
    pub host_kind: FleetHostKind,
    #[serde(deserialize_with = "null_default")]
    pub device_state: FleetDeviceState,
    /// The machine the client itself runs on.
    #[serde(deserialize_with = "null_default")]
    pub is_client_device: bool,
    #[serde(deserialize_with = "null_default")]
    pub workspace_name: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FleetRecentSessions {
    /// The index revision the page was projected at.
    #[serde(deserialize_with = "null_default")]
    pub revision: u64,
    #[serde(deserialize_with = "null_default")]
    pub sessions: Vec<FleetRecentSession>,
    /// The cursor of the next page; absent on the last one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
    /// Some device lists more sessions than the index holds (page them from
    /// the owner through its workspace).
    #[serde(deserialize_with = "null_default")]
    pub truncated: bool,
}

/// The sort key of one Recent row: newest activity first, then device id,
/// then session id (a total order, so pages never repeat or skip a row).
fn recent_key(session: &FleetSession) -> (std::cmp::Reverse<u64>, &str, &str) {
    (
        std::cmp::Reverse(session.last_activity_ms),
        session.device_id.as_str(),
        session.session_id.as_str(),
    )
}

/// `<lastActivityMs>.<deviceId byte length>.<deviceId><sessionId>`: opaque to
/// clients, and safe for ids with any characters.
fn encode_cursor(session: &FleetSession) -> String {
    format!(
        "{}.{}.{}{}",
        session.last_activity_ms,
        session.device_id.len(),
        session.device_id,
        session.session_id
    )
}

fn decode_cursor(cursor: &str) -> Option<(u64, String, String)> {
    let (ms, rest) = cursor.split_once('.')?;
    let (len, ids) = rest.split_once('.')?;
    let len: usize = len.parse().ok()?;
    if !ids.is_char_boundary(len) || len > ids.len() {
        return None;
    }
    let (device, session) = ids.split_at(len);
    Some((ms.parse().ok()?, device.to_string(), session.to_string()))
}

/// Whether a device's sessions belong in All sessions: runtime devices only
/// (the cloud node's sessions are OpenBitFun conversations).
fn lists_sessions(device: &FleetDevice) -> bool {
    device.host_kind != FleetHostKind::Cloud
}

/// The Recent page. `devices` is the navigator projection (bounded and
/// windowed). Child sessions stay under their parent and are not listed. An
/// unreadable cursor starts from the first page.
pub fn project_recent_sessions(
    revision: u64,
    devices: &[FleetDevice],
    request: &FleetRecentSessionsRequest,
) -> FleetRecentSessions {
    let limit = request
        .limit
        .map_or(RECENT_SESSIONS_DEFAULT_LIMIT, |limit| limit as usize)
        .clamp(1, RECENT_SESSIONS_MAX_LIMIT);
    let mut rows: Vec<FleetRecentSession> = Vec::new();
    let mut truncated = false;
    for device in devices.iter().filter(|device| lists_sessions(device)) {
        truncated |= device.sessions_truncated;
        for workspace in &device.workspaces {
            truncated |= workspace.has_more;
            for session in &workspace.sessions {
                if session.parent_session_id.is_some() || session.session_id.is_empty() {
                    continue;
                }
                rows.push(FleetRecentSession {
                    session: FleetSession {
                        device_id: device.device_id.clone(),
                        workspace_id: workspace.workspace_id.clone(),
                        ..session.clone()
                    },
                    device_name: device.name.clone(),
                    host_kind: device.host_kind,
                    device_state: device.state,
                    is_client_device: device.is_client_device,
                    workspace_name: workspace.name.clone(),
                });
            }
        }
    }
    rows.sort_by(|a, b| recent_key(&a.session).cmp(&recent_key(&b.session)));
    rows.dedup_by(|a, b| {
        a.session.device_id == b.session.device_id && a.session.session_id == b.session.session_id
    });
    let start = match request.cursor.as_deref().and_then(decode_cursor) {
        Some((ms, device, session)) => {
            let after = (std::cmp::Reverse(ms), device.as_str(), session.as_str());
            rows.partition_point(|row| recent_key(&row.session) <= after)
        }
        None => 0,
    };
    let mut page: Vec<FleetRecentSession> = rows.into_iter().skip(start).collect();
    let next_cursor = if page.len() > limit {
        page.truncate(limit);
        page.last().map(|row| encode_cursor(&row.session))
    } else {
        None
    };
    FleetRecentSessions {
        revision,
        sessions: page,
        next_cursor,
        truncated,
    }
}

// ---------------------------------------------------------------------------
// Device page (`fleet_device_detail`)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FleetDeviceDetailRequest {
    /// The device; empty means the serving runtime host itself.
    #[serde(deserialize_with = "null_default")]
    pub device_id: String,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FleetDeviceJobState {
    /// Not started on the device yet (the device is offline, or the job is
    /// being submitted).
    Queued,
    Running,
    /// Waiting on the user (a permission or a question).
    Blocked,
    #[default]
    #[serde(other)]
    Unknown,
}

/// Where the entry learned of a job.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FleetDeviceJobSource {
    /// The device's own partition: a Detached Dispatch session or prompt.
    Device,
    /// The account's cloud agent (its ledger), for jobs the device does not
    /// hold yet.
    Cloud,
    #[default]
    #[serde(other)]
    Unknown,
}

/// One job on the device page.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FleetDeviceJob {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub job_id: Option<String>,
    #[serde(deserialize_with = "null_default")]
    pub device_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conversation_id: Option<String>,
    #[serde(deserialize_with = "null_default")]
    pub title: String,
    #[serde(deserialize_with = "null_default")]
    pub state: FleetDeviceJobState,
    /// A stable snake_case code the UI localizes.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state_reason: Option<String>,
    #[serde(deserialize_with = "null_default")]
    pub source: FleetDeviceJobSource,
    /// The prompt a blocked job waits on, when the index holds it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt_id: Option<String>,
    #[serde(deserialize_with = "null_default")]
    pub last_activity_ms: u64,
    /// Open the job's session on its device.
    #[serde(deserialize_with = "null_default")]
    pub open: FleetActionGate,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FleetDeviceRunning {
    /// Sessions started by a user (running, or waiting on the user).
    #[serde(deserialize_with = "null_default")]
    pub sessions: Vec<FleetSession>,
    /// Jobs from OpenBitFun or another controller running now.
    #[serde(deserialize_with = "null_default")]
    pub jobs: Vec<FleetDeviceJob>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FleetDeviceWaiting {
    /// Jobs not started yet, then jobs waiting on the user.
    #[serde(deserialize_with = "null_default")]
    pub jobs: Vec<FleetDeviceJob>,
}

/// How a device that needs a newer OpenBitFun is updated.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FleetDeviceUpdate {
    #[serde(deserialize_with = "null_default")]
    pub available: bool,
    /// The lowest version that works with this entry, when known.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(deserialize_with = "null_default")]
    pub can_update_remotely: bool,
    /// The line to run on the device (CLI hosts).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// `fleet_device_detail` answer.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FleetDeviceDetail {
    #[serde(deserialize_with = "null_default")]
    pub revision: u64,
    /// The navigator row: facts, state, route, version, workspaces.
    #[serde(deserialize_with = "null_default")]
    pub device: FleetDevice,
    /// `running.sessions.len()`.
    #[serde(deserialize_with = "null_default")]
    pub running_sessions: u32,
    /// `running.jobs.len()`.
    #[serde(deserialize_with = "null_default")]
    pub running_jobs: u32,
    /// `waiting.jobs.len()`.
    #[serde(deserialize_with = "null_default")]
    pub waiting_jobs: u32,
    #[serde(deserialize_with = "null_default")]
    pub running: FleetDeviceRunning,
    #[serde(deserialize_with = "null_default")]
    pub waiting: FleetDeviceWaiting,
    /// User-facing capability ids (`DEVICE_CAPABILITY_*`), in display order.
    #[serde(deserialize_with = "null_default")]
    pub capabilities: Vec<String>,
    /// Set only for a device that needs updating.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub update: Option<FleetDeviceUpdate>,
}

/// What a device can do for the user, decided from its kind, its fleet
/// layer and its advertised host capabilities.
pub fn device_capabilities(device: &FleetDevice) -> Vec<String> {
    let runtime = matches!(
        device.host_kind,
        FleetHostKind::Desktop | FleetHostKind::Cli
    );
    if !runtime {
        return Vec::new();
    }
    let has = |key: &str| device.host_capabilities.iter().any(|held| held == key);
    let mut out = vec![
        DEVICE_CAPABILITY_TERMINAL.to_string(),
        DEVICE_CAPABILITY_GIT.to_string(),
    ];
    if device.host_kind == FleetHostKind::Desktop {
        out.push(DEVICE_CAPABILITY_BROWSER.to_string());
        if has(crate::remote_surface::PeerHostCapability::ComputerUseSharingV1.key()) {
            out.push(DEVICE_CAPABILITY_DESKTOP.to_string());
        }
    }
    if device.fleet_protocol.is_some() {
        out.push(DEVICE_CAPABILITY_JOBS.to_string());
    }
    out
}

/// The update line of a device in `update_required`.
pub fn device_update(device: &FleetDevice) -> Option<FleetDeviceUpdate> {
    if device.state != FleetDeviceState::UpdateRequired {
        return None;
    }
    Some(FleetDeviceUpdate {
        available: true,
        version: None,
        can_update_remotely: false,
        command: (device.host_kind == FleetHostKind::Cli).then(|| CLI_UPDATE_COMMAND.to_string()),
        reason: device.state_reason.clone(),
    })
}

fn open_gate(device: &FleetDevice, session: bool) -> FleetActionGate {
    if !session {
        return FleetActionGate {
            allowed: false,
            reason: Some(REASON_WAITING_FOR_DEVICE.to_string()),
        };
    }
    if device.state.accepts_calls() {
        FleetActionGate {
            allowed: true,
            reason: None,
        }
    } else {
        FleetActionGate {
            allowed: false,
            reason: Some(super::device_state_reason(device.state).to_string()),
        }
    }
}

/// The device page. `device` is its navigator row, `prompts` the prompt tray
/// (any device; this device's are used), `cloud_jobs` the cloud agent's job
/// cards the entry holds (any device; queued and blocked ones of this device
/// the index does not cover are added).
pub fn project_device_detail(
    revision: u64,
    device: &FleetDevice,
    prompts: &[FleetPrompt],
    cloud_jobs: &[JobCard],
) -> FleetDeviceDetail {
    let top_level = device
        .workspaces
        .iter()
        .flat_map(|workspace| workspace.sessions.iter())
        .filter(|session| session.parent_session_id.is_none());
    let mut sessions: Vec<FleetSession> = Vec::new();
    let mut running_jobs: Vec<FleetDeviceJob> = Vec::new();
    let mut blocked: Vec<FleetDeviceJob> = Vec::new();
    let own_prompts: Vec<&FleetPrompt> = prompts
        .iter()
        .filter(|prompt| prompt.device_id == device.device_id)
        .collect();
    let job_of_session = |session_id: &str| {
        own_prompts
            .iter()
            .filter(|prompt| prompt.session_id == session_id)
            .find_map(|prompt| prompt.job_id.clone().filter(|id| !id.is_empty()))
    };
    let prompt_of_session = |session_id: &str| {
        own_prompts
            .iter()
            .find(|prompt| prompt.session_id == session_id)
            .map(|prompt| prompt.prompt_id.clone())
    };
    for session in top_level {
        let active = matches!(
            session.status,
            FleetSessionStatus::Running | FleetSessionStatus::Waiting
        );
        if !active {
            continue;
        }
        if session.origin != Some(FleetSessionOrigin::Dispatch) {
            sessions.push(FleetSession {
                device_id: device.device_id.clone(),
                ..session.clone()
            });
            continue;
        }
        let waiting = session.status == FleetSessionStatus::Waiting;
        let job = FleetDeviceJob {
            job_id: job_of_session(&session.session_id),
            device_id: device.device_id.clone(),
            workspace_id: Some(session.workspace_id.clone()).filter(|id| !id.is_empty()),
            session_id: Some(session.session_id.clone()),
            conversation_id: None,
            title: session.title.clone(),
            state: if waiting {
                FleetDeviceJobState::Blocked
            } else {
                FleetDeviceJobState::Running
            },
            state_reason: waiting.then(|| REASON_NEEDS_ANSWER.to_string()),
            source: FleetDeviceJobSource::Device,
            prompt_id: if waiting {
                prompt_of_session(&session.session_id)
            } else {
                None
            },
            last_activity_ms: session.last_activity_ms,
            open: open_gate(device, true),
        };
        if waiting {
            blocked.push(job);
        } else {
            running_jobs.push(job);
        }
    }
    // Sessions and their jobs newest first; the jobs the window does not
    // list follow in tray order, then the cloud agent's.
    sessions.sort_by(|a, b| {
        b.last_activity_ms
            .cmp(&a.last_activity_ms)
            .then_with(|| a.session_id.cmp(&b.session_id))
    });
    let by_recency = |a: &FleetDeviceJob, b: &FleetDeviceJob| {
        b.last_activity_ms
            .cmp(&a.last_activity_ms)
            .then_with(|| a.session_id.cmp(&b.session_id))
    };
    running_jobs.sort_by(by_recency);
    blocked.sort_by(by_recency);
    // Dispatch prompts whose session the navigator window does not list.
    let listed: std::collections::BTreeSet<String> = blocked
        .iter()
        .chain(running_jobs.iter())
        .filter_map(|job| job.session_id.clone())
        .collect();
    let mut seen_jobs: std::collections::BTreeSet<String> = blocked
        .iter()
        .chain(running_jobs.iter())
        .filter_map(|job| job.job_id.clone())
        .collect();
    for prompt in &own_prompts {
        if prompt.answer_route != FleetAnswerRoute::Dispatch {
            continue;
        }
        let job_id = prompt.job_id.clone().filter(|id| !id.is_empty());
        if listed.contains(&prompt.session_id)
            || job_id.as_ref().is_some_and(|id| seen_jobs.contains(id))
        {
            continue;
        }
        if let Some(id) = &job_id {
            seen_jobs.insert(id.clone());
        }
        let has_session = !prompt.session_id.is_empty();
        blocked.push(FleetDeviceJob {
            job_id,
            device_id: device.device_id.clone(),
            workspace_id: Some(prompt.workspace_id.clone()).filter(|id| !id.is_empty()),
            session_id: Some(prompt.session_id.clone()).filter(|id| !id.is_empty()),
            conversation_id: None,
            title: prompt.title.clone(),
            state: FleetDeviceJobState::Blocked,
            state_reason: Some(REASON_NEEDS_ANSWER.to_string()),
            source: FleetDeviceJobSource::Device,
            prompt_id: Some(prompt.prompt_id.clone()),
            last_activity_ms: 0,
            open: open_gate(device, has_session),
        });
    }
    // The cloud agent's jobs of this device that the device does not hold:
    // queued ones (not on the device yet), and blocked ones whose prompt the
    // index does not hold.
    let mut queued: Vec<FleetDeviceJob> = Vec::new();
    for card in cloud_jobs
        .iter()
        .filter(|card| card.device_id == device.device_id && !card.job_id.is_empty())
    {
        if seen_jobs.contains(&card.job_id) {
            continue;
        }
        let (state, reason) = match card.state {
            SuperagentJobState::Queued => (
                FleetDeviceJobState::Queued,
                card.state_reason
                    .clone()
                    .unwrap_or_else(|| REASON_WAITING_FOR_DEVICE.to_string()),
            ),
            SuperagentJobState::Blocked => (
                FleetDeviceJobState::Blocked,
                REASON_PROMPT_NOT_INDEXED.to_string(),
            ),
            _ => continue,
        };
        seen_jobs.insert(card.job_id.clone());
        let job = FleetDeviceJob {
            job_id: Some(card.job_id.clone()),
            device_id: device.device_id.clone(),
            workspace_id: None,
            session_id: None,
            conversation_id: None,
            title: card.title.clone(),
            state,
            state_reason: Some(reason),
            source: FleetDeviceJobSource::Cloud,
            prompt_id: None,
            last_activity_ms: 0,
            open: card.actions.open_transcript.clone(),
        };
        if state == FleetDeviceJobState::Queued {
            queued.push(job);
        } else {
            blocked.push(job);
        }
    }
    let mut waiting = queued;
    waiting.extend(blocked);
    let count = |n: usize| u32::try_from(n).unwrap_or(u32::MAX);
    FleetDeviceDetail {
        revision,
        device: device.clone(),
        running_sessions: count(sessions.len()),
        running_jobs: count(running_jobs.len()),
        waiting_jobs: count(waiting.len()),
        running: FleetDeviceRunning {
            sessions,
            jobs: running_jobs,
        },
        waiting: FleetDeviceWaiting { jobs: waiting },
        capabilities: device_capabilities(device),
        update: device_update(device),
    }
}

#[cfg(test)]
#[path = "views_tests.rs"]
mod tests;

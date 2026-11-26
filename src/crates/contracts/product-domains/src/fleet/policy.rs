//! Fleet decisions every runtime host applies the same way.
//!
//! These are pure functions over owner partitions and link facts. Ordering,
//! counting, bounds and action gating live here so that every frontend only
//! displays what the backend projected (no merging, sorting or counting in a
//! client). Reason codes are stable snake_case strings the frontends localize.

use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet};

use super::dto::*;
use crate::remote_surface::{
    fleet_route, is_fleet_verb, owner_key_value, FleetEntity, FleetRoute, PeerHostCapability,
};
use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/// What the serving runtime host knows about one device apart from its
/// partition: identity, link and presence facts, decided by the backend.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct FleetDeviceFacts {
    pub device_id: String,
    pub name: String,
    pub host_kind: FleetHostKind,
    pub is_client_device: bool,
    pub state: FleetDeviceState,
    pub state_reason: Option<String>,
    pub as_of_ms: u64,
    pub version: Option<String>,
    pub fleet_protocol: Option<u32>,
    pub host_capabilities: Vec<String>,
    pub route: Option<FleetDeviceRoute>,
}

/// One device of the index: its facts, its owner partition (if any was ever
/// received), and the index revision at which its projection last changed.
#[derive(Debug, Clone, Copy)]
pub struct FleetDeviceInput<'a> {
    pub facts: &'a FleetDeviceFacts,
    pub partition: Option<&'a FleetDigest>,
    pub changed_revision: u64,
}

/// The index as the navigator projection sees it.
#[derive(Debug, Clone, Default)]
pub struct FleetNavigatorInput<'a> {
    pub revision: u64,
    pub devices: Vec<FleetDeviceInput<'a>>,
    /// Devices removed from the index, with the revision of the removal.
    pub removed: Vec<(String, u64)>,
    /// The oldest `sinceRevision` a delta can still be computed from; older
    /// (or unknown, or future) revisions get a full answer.
    pub delta_floor: u64,
}

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

/// Navigator device order: the account's cloud runtime node when present,
/// then the client's own machine, then by state (online first), then name
/// (case-insensitive), then id. The order is a display fact; no device is
/// special for routing.
pub fn compare_devices(a: &FleetDeviceFacts, b: &FleetDeviceFacts) -> Ordering {
    let cloud = |facts: &FleetDeviceFacts| facts.host_kind == FleetHostKind::Cloud;
    cloud(b)
        .cmp(&cloud(a))
        .then_with(|| b.is_client_device.cmp(&a.is_client_device))
        .then_with(|| a.state.display_rank().cmp(&b.state.display_rank()))
        .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        .then_with(|| a.device_id.cmp(&b.device_id))
}

/// Session order inside a workspace: most recent activity first, then id.
fn compare_sessions(a: &FleetSession, b: &FleetSession) -> Ordering {
    b.last_activity_ms
        .cmp(&a.last_activity_ms)
        .then_with(|| a.session_id.cmp(&b.session_id))
}

/// Workspace order inside a device: assistant workspaces first (the device's
/// primary assistant ahead of any other assistant), then the host's current
/// workspace, then the most recent session activity, then name, then id.
pub fn compare_workspaces_with_activity(
    a: &FleetWorkspace,
    a_latest: u64,
    b: &FleetWorkspace,
    b_latest: u64,
) -> Ordering {
    let is_assistant = |workspace: &FleetWorkspace| workspace.kind == FleetWorkspaceKind::Assistant;
    let is_primary =
        |workspace: &FleetWorkspace| is_assistant(workspace) && workspace.is_primary_assistant;
    is_assistant(b)
        .cmp(&is_assistant(a))
        .then_with(|| is_primary(b).cmp(&is_primary(a)))
        .then_with(|| b.is_host_current.cmp(&a.is_host_current))
        .then_with(|| b_latest.cmp(&a_latest))
        .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        .then_with(|| a.workspace_id.cmp(&b.workspace_id))
}

fn compare_workspaces(a: &FleetWorkspace, b: &FleetWorkspace) -> Ordering {
    let latest = |workspace: &FleetWorkspace| {
        workspace
            .sessions
            .iter()
            .map(|session| session.last_activity_ms)
            .max()
            .unwrap_or(0)
    };
    compare_workspaces_with_activity(a, latest(a), b, latest(b))
}

// ---------------------------------------------------------------------------
// Action gates
// ---------------------------------------------------------------------------

/// Reason code for a device that cannot take a call right now.
pub fn device_state_reason(state: FleetDeviceState) -> &'static str {
    match state {
        FleetDeviceState::Online => "device_online",
        FleetDeviceState::Offline => "device_offline",
        FleetDeviceState::Stale => "device_stale",
        FleetDeviceState::Unreachable => "device_unreachable",
        FleetDeviceState::UpdateRequired => "update_required",
        FleetDeviceState::NotIndexed => "device_not_indexed",
        FleetDeviceState::Unknown => "device_state_unknown",
    }
}

/// Whether a workspace may be created (opened) on the device. Only an
/// online, indexed device: the new workspace must appear in the navigator.
pub fn create_workspace_gate(facts: &FleetDeviceFacts) -> FleetActionGate {
    match facts.state {
        FleetDeviceState::Online => FleetActionGate {
            allowed: true,
            reason: None,
        },
        state => FleetActionGate {
            allowed: false,
            reason: Some(device_state_reason(state).to_string()),
        },
    }
}

// ---------------------------------------------------------------------------
// Navigator projection
// ---------------------------------------------------------------------------

/// Apply the per-workspace window (newest top-level sessions plus every
/// running, waiting, unread or attention-needing one) and sort.
fn window_sessions(workspace: &mut FleetWorkspace) {
    workspace.sessions.sort_by(compare_sessions);
    let mut top_level = 0usize;
    let mut dropped = false;
    workspace.sessions.retain(|session| {
        let is_top_level = session.parent_session_id.is_none();
        let keep = session.is_pinned_by_activity()
            || (is_top_level && top_level < MAX_TOP_LEVEL_SESSIONS_PER_WORKSPACE);
        if is_top_level && keep && !session.is_pinned_by_activity() {
            top_level += 1;
        }
        dropped |= !keep;
        keep
    });
    let listed_top_level = workspace
        .sessions
        .iter()
        .filter(|session| session.parent_session_id.is_none())
        .count() as u32;
    workspace.session_total = workspace.session_total.max(listed_top_level);
    workspace.has_more |= dropped || workspace.session_total > listed_top_level;
}

/// Keep at most `MAX_SESSIONS_PER_DEVICE` sessions on a device: drop the
/// oldest unpinned sessions first, then the oldest pinned ones.
fn bound_device_sessions(workspaces: &mut [FleetWorkspace]) -> bool {
    let total: usize = workspaces.iter().map(|w| w.sessions.len()).sum();
    if total <= MAX_SESSIONS_PER_DEVICE {
        return false;
    }
    let mut all: Vec<(bool, u64, String, String)> = workspaces
        .iter()
        .flat_map(|workspace| {
            workspace.sessions.iter().map(|session| {
                (
                    session.is_pinned_by_activity(),
                    session.last_activity_ms,
                    workspace.workspace_id.clone(),
                    session.session_id.clone(),
                )
            })
        })
        .collect();
    // Drop order: unpinned before pinned, oldest first.
    all.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(&b.1)).then(a.3.cmp(&b.3)));
    let drop: BTreeSet<(String, String)> = all
        .into_iter()
        .take(total - MAX_SESSIONS_PER_DEVICE)
        .map(|(_, _, workspace, session)| (workspace, session))
        .collect();
    for workspace in workspaces.iter_mut() {
        let before = workspace.sessions.len();
        let workspace_id = workspace.workspace_id.clone();
        workspace
            .sessions
            .retain(|session| !drop.contains(&(workspace_id.clone(), session.session_id.clone())));
        if workspace.sessions.len() != before {
            workspace.has_more = true;
        }
    }
    true
}

/// Project one device: owner ids are forced from the partition key, ids are
/// de-duplicated, sessions are grouped into their workspaces, and every
/// bound is applied (a partition from a peer is never trusted to be bounded).
pub fn project_device(facts: &FleetDeviceFacts, partition: Option<&FleetDigest>) -> FleetDevice {
    let device_id = facts.device_id.clone();
    let mut sessions_truncated = false;
    let mut workspaces: Vec<FleetWorkspace> = Vec::new();
    if let (Some(partition), true) = (partition, facts.state != FleetDeviceState::NotIndexed) {
        sessions_truncated = partition.sessions_truncated;
        let mut seen = BTreeSet::new();
        for workspace in &partition.workspaces {
            if workspace.workspace_id.is_empty() || !seen.insert(workspace.workspace_id.clone()) {
                continue;
            }
            workspaces.push(FleetWorkspace {
                device_id: device_id.clone(),
                sessions: Vec::new(),
                ..workspace.clone()
            });
        }
        let positions: BTreeMap<String, usize> = workspaces
            .iter()
            .enumerate()
            .map(|(index, workspace)| (workspace.workspace_id.clone(), index))
            .collect();
        let mut seen_sessions = BTreeSet::new();
        let nested = partition.workspaces.iter().flat_map(|w| w.sessions.iter());
        for session in partition.sessions.iter().chain(nested) {
            if session.session_id.is_empty() || !seen_sessions.insert(session.session_id.clone()) {
                continue;
            }
            // A session whose workspace is not in the partition is not
            // listed (and not counted): it cannot be displayed in place.
            let Some(&index) = positions.get(&session.workspace_id) else {
                continue;
            };
            workspaces[index].sessions.push(FleetSession {
                device_id: device_id.clone(),
                ..session.clone()
            });
        }
        for workspace in &mut workspaces {
            window_sessions(workspace);
        }
        workspaces.sort_by(compare_workspaces);
        if workspaces.len() > MAX_WORKSPACES_PER_DEVICE {
            workspaces.truncate(MAX_WORKSPACES_PER_DEVICE);
            sessions_truncated = true;
        }
        sessions_truncated |= bound_device_sessions(&mut workspaces);
    }
    FleetDevice {
        device_id,
        name: facts.name.clone(),
        host_kind: facts.host_kind,
        is_client_device: facts.is_client_device,
        state: facts.state,
        state_reason: facts.state_reason.clone(),
        as_of_ms: facts.as_of_ms,
        version: facts.version.clone(),
        fleet_protocol: facts.fleet_protocol,
        host_capabilities: facts.host_capabilities.clone(),
        route: facts.route.clone(),
        actions: FleetDeviceActions {
            create_workspace: create_workspace_gate(facts),
        },
        workspaces,
        sessions_truncated,
    }
}

/// Totals over projected devices.
pub fn fleet_totals<'a>(devices: impl IntoIterator<Item = &'a FleetDevice>) -> FleetTotals {
    let mut totals = FleetTotals::default();
    for session in devices
        .into_iter()
        .flat_map(|device| device.workspaces.iter())
        .flat_map(|workspace| workspace.sessions.iter())
    {
        match session.status {
            FleetSessionStatus::Running => totals.running += 1,
            FleetSessionStatus::Waiting => totals.waiting += 1,
            _ => {}
        }
        if session.unread {
            totals.unread += 1;
        }
    }
    totals
}

/// Apply the indexed-device bound in display order: devices with a partition
/// beyond `MAX_INDEXED_DEVICES` are listed as `not_indexed` without content.
fn bound_indexed_devices(devices: &mut [(FleetDeviceFacts, Option<&FleetDigest>, u64)]) {
    let mut indexed = 0usize;
    for (facts, partition, _) in devices.iter_mut() {
        if partition.is_none() || facts.state == FleetDeviceState::NotIndexed {
            continue;
        }
        indexed += 1;
        if indexed > MAX_INDEXED_DEVICES {
            facts.state = FleetDeviceState::NotIndexed;
            facts.state_reason = Some("device_limit".to_string());
            *partition = None;
        }
    }
}

/// The `fleet_navigator` answer. With a `since_revision` inside the delta
/// window the answer lists only devices changed after it (`full: false`)
/// plus `removedDeviceIds`; otherwise the whole fleet (`full: true`). Totals
/// always cover the whole fleet.
pub fn project_navigator(
    input: &FleetNavigatorInput<'_>,
    since_revision: Option<u64>,
) -> FleetNavigator {
    let mut ordered: Vec<(FleetDeviceFacts, Option<&FleetDigest>, u64)> = input
        .devices
        .iter()
        .map(|device| {
            (
                device.facts.clone(),
                device.partition,
                device.changed_revision,
            )
        })
        .collect();
    ordered.sort_by(|a, b| compare_devices(&a.0, &b.0));
    bound_indexed_devices(&mut ordered);
    ordered.sort_by(|a, b| compare_devices(&a.0, &b.0));

    let projected: Vec<(FleetDevice, u64)> = ordered
        .iter()
        .map(|(facts, partition, changed)| (project_device(facts, *partition), *changed))
        .collect();
    let totals = fleet_totals(projected.iter().map(|(device, _)| device));

    let delta_from =
        since_revision.filter(|since| *since >= input.delta_floor && *since <= input.revision);
    match delta_from {
        Some(since) => FleetNavigator {
            revision: input.revision,
            full: false,
            devices: projected
                .into_iter()
                .filter(|(_, changed)| *changed > since)
                .map(|(device, _)| device)
                .collect(),
            removed_device_ids: {
                let mut removed: Vec<String> = input
                    .removed
                    .iter()
                    .filter(|(_, revision)| *revision > since)
                    .map(|(id, _)| id.clone())
                    .collect();
                removed.sort();
                removed.dedup();
                removed
            },
            totals,
        },
        None => FleetNavigator {
            revision: input.revision,
            full: true,
            devices: projected.into_iter().map(|(device, _)| device).collect(),
            removed_device_ids: Vec::new(),
            totals,
        },
    }
}

// ---------------------------------------------------------------------------
// Prompt projection
// ---------------------------------------------------------------------------

/// Whether a device can answer a prompt of this kind, with the reason code.
fn prompt_answerability(
    facts: &FleetDeviceFacts,
    prompt: &FleetPrompt,
) -> Result<(), &'static str> {
    if !facts.state.accepts_calls() {
        return Err(device_state_reason(facts.state));
    }
    match prompt.answer_route {
        FleetAnswerRoute::Runtime => {}
        // Answered through the dispatch job's permission mailbox.
        FleetAnswerRoute::Dispatch => {
            return match prompt.job_id.as_deref() {
                Some(job) if !job.is_empty() => Ok(()),
                _ => Err("dispatch_job_missing"),
            };
        }
        FleetAnswerRoute::Unknown => return Err("answer_route_unsupported"),
    }
    match prompt.kind {
        FleetPromptKind::Permission => Ok(()),
        FleetPromptKind::Question => {
            let key = PeerHostCapability::UserQuestionResponse.key();
            if facts
                .host_capabilities
                .iter()
                .any(|capability| capability == key)
            {
                Ok(())
            } else {
                Err("question_answer_unsupported")
            }
        }
        FleetPromptKind::Unknown => Err("prompt_kind_unsupported"),
    }
}

/// Enforce the payload bound: a payload over `MAX_PROMPT_PAYLOAD_BYTES` of
/// JSON is dropped and flagged for an on-demand fetch from the owner.
fn bound_prompt_payload(prompt: &mut FleetPrompt) {
    let oversized = prompt.payload.as_ref().is_some_and(|payload| {
        serde_json::to_vec(payload).map_or(true, |bytes| bytes.len() > MAX_PROMPT_PAYLOAD_BYTES)
    });
    if oversized {
        prompt.payload = None;
        prompt.payload_truncated = true;
    }
}

/// The `fleet_prompts` answer: every pending prompt of every indexed device
/// in one tray, grouped in navigator device order, oldest revision first.
pub fn project_prompts(revision: u64, devices: &[FleetDeviceInput<'_>]) -> FleetPromptsResponse {
    let mut ordered: Vec<&FleetDeviceInput<'_>> = devices.iter().collect();
    ordered.sort_by(|a, b| compare_devices(a.facts, b.facts));
    let mut prompts = Vec::new();
    for device in ordered {
        let (Some(partition), true) = (
            device.partition,
            device.facts.state != FleetDeviceState::NotIndexed,
        ) else {
            continue;
        };
        let mut seen = BTreeSet::new();
        let mut own: Vec<FleetPrompt> = partition
            .prompts
            .iter()
            .filter(|prompt| !prompt.prompt_id.is_empty())
            .filter(|prompt| seen.insert((prompt.kind, prompt.prompt_id.clone())))
            .cloned()
            .collect();
        own.sort_by(|a, b| {
            a.revision
                .cmp(&b.revision)
                .then_with(|| a.prompt_id.cmp(&b.prompt_id))
        });
        own.truncate(MAX_PROMPTS_PER_DEVICE);
        for mut prompt in own {
            prompt.device_id = device.facts.device_id.clone();
            bound_prompt_payload(&mut prompt);
            if prompt.answerable {
                if let Err(reason) = prompt_answerability(device.facts, &prompt) {
                    prompt.answerable = false;
                    prompt.unanswerable_reason = Some(reason.to_string());
                }
            }
            if prompt.answerable {
                prompt.unanswerable_reason = None;
            } else if prompt.unanswerable_reason.is_none() {
                prompt.unanswerable_reason = Some("owner_declined".to_string());
            }
            prompts.push(prompt);
        }
    }
    FleetPromptsResponse { revision, prompts }
}

// ---------------------------------------------------------------------------
// Routing verdict (`fleet_call`)
// ---------------------------------------------------------------------------

/// What the fleet index knows about owners, for the routing verdict.
pub trait FleetOwnerIndex {
    /// The device's state, or `None` for a device the index does not know.
    fn device_state(&self, device_id: &str) -> Option<FleetDeviceState>;
    /// The indexed devices that list `id` (an id may exist on several
    /// devices: workspace ids are per device and imports keep session ids).
    fn owners(&self, entity: FleetEntity, id: &str) -> Vec<String>;
    /// Whether the device may hold `entity` ids its partition does not list
    /// (a truncated partition, sessions beyond the window, terminals, or a
    /// device the index cannot read).
    fn may_hold_unlisted(&self, device_id: &str, entity: FleetEntity) -> bool;
}

/// Why a `fleet_call` is refused before it reaches any owner.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FleetCallRefusal {
    TargetRequired {
        command: String,
        detail: &'static str,
    },
    OwnerMismatch {
        command: String,
        owners: Vec<String>,
    },
    DeviceOffline {
        device_id: String,
        reason: &'static str,
    },
    DeviceOutdated {
        device_id: String,
    },
    NestedCall {
        command: String,
    },
}

impl FleetCallRefusal {
    pub fn prefix(&self) -> &'static str {
        match self {
            Self::TargetRequired { .. } => FLEET_TARGET_REQUIRED,
            Self::OwnerMismatch { .. } => FLEET_OWNER_MISMATCH,
            Self::DeviceOffline { .. } => FLEET_DEVICE_OFFLINE,
            Self::DeviceOutdated { .. } => FLEET_DEVICE_OUTDATED,
            Self::NestedCall { .. } => FLEET_NESTED_CALL,
        }
    }

    /// The error string: `"<prefix>: <detail>"`. `fleet_owner_mismatch`
    /// carries the owner device id(s) right after the prefix.
    pub fn message(&self) -> String {
        let detail = match self {
            Self::TargetRequired { command, detail } => {
                format!("'{command}' needs a target device: {detail}")
            }
            Self::OwnerMismatch { owners, .. } => owners.join(","),
            Self::DeviceOffline { device_id, reason } => format!("{device_id} ({reason})"),
            Self::DeviceOutdated { device_id } => {
                format!("{device_id} must be updated before it can be operated from here")
            }
            Self::NestedCall { command } => {
                format!("'{command}' is a fleet verb and cannot be wrapped in fleet_call")
            }
        };
        format!("{}: {detail}", self.prefix())
    }
}

/// Where a `fleet_call` goes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FleetCallVerdict {
    /// Execute on this runtime host.
    Local,
    /// Make a plain call with the unchanged args on the link to the target.
    Forward {
        target: String,
    },
    Refuse(FleetCallRefusal),
}

/// Decide a `fleet_call` on the runtime host `self_device_id`.
///
/// Order: fleet verbs are refused (`fleet_nested_call`); `EntryLocal`
/// commands without a foreign target run here; the target is the given one
/// (checked against the owner of a `ByOwner` id, never silently replaced) or
/// the single indexed owner; a target that is this host runs here; any other
/// target must be known and accept calls.
pub fn fleet_call_verdict(
    self_device_id: &str,
    request: &FleetCallRequest,
    index: &dyn FleetOwnerIndex,
) -> FleetCallVerdict {
    let command = request.command.as_str();
    if is_fleet_verb(command) {
        return FleetCallVerdict::Refuse(FleetCallRefusal::NestedCall {
            command: command.to_string(),
        });
    }
    let given = request
        .target
        .as_deref()
        .filter(|target| !target.is_empty());
    let target = match fleet_route(command) {
        FleetRoute::EntryLocal => match given {
            None => return FleetCallVerdict::Local,
            // A controller-local command aimed at another device is forwarded
            // so that device answers with its own explicit refusal.
            Some(target) => target.to_string(),
        },
        FleetRoute::ByTarget { .. } => match given {
            Some(target) => target.to_string(),
            None => {
                return FleetCallVerdict::Refuse(FleetCallRefusal::TargetRequired {
                    command: command.to_string(),
                    detail: "the command is device-scoped",
                })
            }
        },
        FleetRoute::ByOwner { entity, path } => {
            match (owner_key_value(&request.args, path), given) {
                (None, Some(target)) => target.to_string(),
                (None, None) => {
                    return FleetCallVerdict::Refuse(FleetCallRefusal::TargetRequired {
                        command: command.to_string(),
                        detail: "the request names no owner id",
                    })
                }
                (Some(id), Some(target)) => {
                    let mut owners = index.owners(entity, id);
                    owners.sort();
                    owners.dedup();
                    let consistent = owners.is_empty()
                        || owners.iter().any(|owner| owner == target)
                        || index.may_hold_unlisted(target, entity);
                    if !consistent {
                        return FleetCallVerdict::Refuse(FleetCallRefusal::OwnerMismatch {
                            command: command.to_string(),
                            owners,
                        });
                    }
                    target.to_string()
                }
                (Some(id), None) => {
                    let mut owners = index.owners(entity, id);
                    owners.sort();
                    owners.dedup();
                    match owners.as_slice() {
                        [owner] => owner.clone(),
                        [] => {
                            return FleetCallVerdict::Refuse(FleetCallRefusal::TargetRequired {
                                command: command.to_string(),
                                detail: "the owner id is not in the fleet index",
                            })
                        }
                        _ => {
                            return FleetCallVerdict::Refuse(FleetCallRefusal::TargetRequired {
                                command: command.to_string(),
                                detail: "the owner id exists on several devices",
                            })
                        }
                    }
                }
            }
        }
    };
    if target == self_device_id {
        return FleetCallVerdict::Local;
    }
    match index.device_state(&target) {
        None => FleetCallVerdict::Refuse(FleetCallRefusal::DeviceOffline {
            device_id: target,
            reason: "device_unknown",
        }),
        Some(FleetDeviceState::UpdateRequired) => {
            FleetCallVerdict::Refuse(FleetCallRefusal::DeviceOutdated { device_id: target })
        }
        Some(state) if !state.accepts_calls() => {
            FleetCallVerdict::Refuse(FleetCallRefusal::DeviceOffline {
                device_id: target,
                reason: device_state_reason(state),
            })
        }
        Some(_) => FleetCallVerdict::Forward { target },
    }
}

// ---------------------------------------------------------------------------
// Connection candidates (phone and browser)
// ---------------------------------------------------------------------------

/// One runtime host a frontend-only client may connect through.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FleetEntryCandidate {
    #[serde(deserialize_with = "null_default")]
    pub device_id: String,
    #[serde(deserialize_with = "null_default")]
    pub online: bool,
    /// The fleet protocol it advertises (`fleet_v1` → 1); `None` without.
    pub fleet_protocol: Option<u32>,
    /// Serves the whole product surface (a desktop host); a CLI host lacks
    /// some desktop subsystems.
    #[serde(deserialize_with = "null_default")]
    pub full_host: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latency_ms: Option<u32>,
    /// Attached clients (`fleetLoad` on `/obp/mesh/info`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fleet_load: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
}

fn compare_versions(a: Option<&str>, b: Option<&str>) -> Ordering {
    let parse = |version: Option<&str>| {
        version.and_then(|v| semver::Version::parse(v.trim().trim_start_matches('v')).ok())
    };
    // Newest first; an unparsable or missing version sorts last.
    match (parse(a), parse(b)) {
        (Some(a), Some(b)) => b.cmp(&a),
        (Some(_), None) => Ordering::Less,
        (None, Some(_)) => Ordering::Greater,
        (None, None) => Ordering::Equal,
    }
}

/// Lower first; unknown last.
fn compare_known_ascending(a: Option<u32>, b: Option<u32>) -> Ordering {
    match (a, b) {
        (Some(a), Some(b)) => a.cmp(&b),
        (Some(_), None) => Ordering::Less,
        (None, Some(_)) => Ordering::Greater,
        (None, None) => Ordering::Equal,
    }
}

/// Order the runtime hosts a phone or browser tries, best first: online,
/// then with the fleet layer, then a full host, then lowest latency, then
/// fewest attached clients, then newest version, then device id. The client
/// walks the list on failure and tells the user only when all fail.
pub fn rank_entry_candidates(candidates: &[FleetEntryCandidate]) -> Vec<FleetEntryCandidate> {
    let mut ranked = candidates.to_vec();
    ranked.sort_by(|a, b| {
        b.online
            .cmp(&a.online)
            .then_with(|| {
                let fleet = |c: &FleetEntryCandidate| c.fleet_protocol.is_some_and(|p| p >= 1);
                fleet(b).cmp(&fleet(a))
            })
            .then_with(|| b.full_host.cmp(&a.full_host))
            .then_with(|| compare_known_ascending(a.latency_ms, b.latency_ms))
            .then_with(|| compare_known_ascending(a.fleet_load, b.fleet_load))
            .then_with(|| compare_versions(a.version.as_deref(), b.version.as_deref()))
            .then_with(|| a.device_id.cmp(&b.device_id))
    });
    ranked
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    fn facts(id: &str, name: &str, state: FleetDeviceState) -> FleetDeviceFacts {
        FleetDeviceFacts {
            device_id: id.into(),
            name: name.into(),
            host_kind: FleetHostKind::Desktop,
            state,
            fleet_protocol: Some(1),
            ..FleetDeviceFacts::default()
        }
    }

    fn workspace(id: &str, name: &str) -> FleetWorkspace {
        FleetWorkspace {
            workspace_id: id.into(),
            name: name.into(),
            root_path: format!("/w/{id}"),
            kind: FleetWorkspaceKind::Local,
            ..FleetWorkspace::default()
        }
    }

    fn session(workspace: &str, id: &str, activity: u64) -> FleetSession {
        FleetSession {
            workspace_id: workspace.into(),
            session_id: id.into(),
            title: id.into(),
            agent_type: "agentic".into(),
            last_activity_ms: activity,
            ..FleetSession::default()
        }
    }

    fn digest(
        device: &str,
        workspaces: Vec<FleetWorkspace>,
        sessions: Vec<FleetSession>,
    ) -> FleetDigest {
        FleetDigest {
            device_id: device.into(),
            instance_id: "i".into(),
            revision: 1,
            full: true,
            workspaces,
            sessions,
            ..FleetDigest::default()
        }
    }

    #[test]
    fn navigator_orders_devices_workspaces_and_sessions_and_counts_totals() {
        let a = facts("a", "zeta", FleetDeviceState::Online);
        let b = FleetDeviceFacts {
            is_client_device: true,
            ..facts("b", "Yak", FleetDeviceState::Offline)
        };
        let c = facts("c", "alpha", FleetDeviceState::Online);
        let mut running = session("w1", "s-run", 5);
        running.status = FleetSessionStatus::Running;
        let mut waiting = session("w2", "s-wait", 9);
        waiting.status = FleetSessionStatus::Waiting;
        waiting.unread = true;
        let partition_a = digest(
            "ignored-by-projection",
            vec![workspace("w1", "one"), workspace("w2", "two")],
            vec![running, waiting, session("w1", "s-old", 1)],
        );
        let input = FleetNavigatorInput {
            revision: 3,
            devices: vec![
                FleetDeviceInput {
                    facts: &a,
                    partition: Some(&partition_a),
                    changed_revision: 3,
                },
                FleetDeviceInput {
                    facts: &b,
                    partition: None,
                    changed_revision: 1,
                },
                FleetDeviceInput {
                    facts: &c,
                    partition: None,
                    changed_revision: 2,
                },
            ],
            ..FleetNavigatorInput::default()
        };
        let navigator = project_navigator(&input, None);
        assert!(navigator.full);
        let order: Vec<&str> = navigator
            .devices
            .iter()
            .map(|d| d.device_id.as_str())
            .collect();
        assert_eq!(order, ["b", "c", "a"], "client device, then online by name");
        let device_a = &navigator.devices[2];
        assert_eq!(
            device_a.workspaces[0].workspace_id, "w2",
            "most recent activity first"
        );
        let w1: Vec<&str> = device_a.workspaces[1]
            .sessions
            .iter()
            .map(|s| s.session_id.as_str())
            .collect();
        assert_eq!(w1, ["s-run", "s-old"]);
        for workspace in &device_a.workspaces {
            assert_eq!(
                workspace.device_id, "a",
                "owner ids come from the partition key"
            );
            assert!(workspace.sessions.iter().all(|s| s.device_id == "a"));
        }
        assert_eq!(
            navigator.totals,
            FleetTotals {
                running: 1,
                waiting: 1,
                unread: 1
            }
        );
        assert!(device_a.actions.create_workspace.allowed);
        let offline = &navigator.devices[0];
        assert!(!offline.actions.create_workspace.allowed);
        assert_eq!(
            offline.actions.create_workspace.reason.as_deref(),
            Some("device_offline")
        );
    }

    #[test]
    fn the_cloud_runtime_node_is_always_listed_first() {
        let client = FleetDeviceFacts {
            is_client_device: true,
            ..facts("laptop", "Aardvark", FleetDeviceState::Online)
        };
        let other = facts("desk", "Able", FleetDeviceState::Online);
        // Even offline, the cloud node leads; a newer state never demotes it.
        let cloud = FleetDeviceFacts {
            host_kind: FleetHostKind::Cloud,
            ..facts("cloud-3f2a", "OpenBitFun", FleetDeviceState::Offline)
        };
        let input = FleetNavigatorInput {
            revision: 1,
            devices: vec![
                FleetDeviceInput {
                    facts: &other,
                    partition: None,
                    changed_revision: 1,
                },
                FleetDeviceInput {
                    facts: &client,
                    partition: None,
                    changed_revision: 1,
                },
                FleetDeviceInput {
                    facts: &cloud,
                    partition: None,
                    changed_revision: 1,
                },
            ],
            ..FleetNavigatorInput::default()
        };
        let order: Vec<String> = project_navigator(&input, None)
            .devices
            .into_iter()
            .map(|device| device.device_id)
            .collect();
        assert_eq!(order, ["cloud-3f2a", "laptop", "desk"]);
        // Without a cloud node the client device leads.
        let input = FleetNavigatorInput {
            devices: input.devices[..2].to_vec(),
            ..input
        };
        assert_eq!(
            project_navigator(&input, None).devices[0].device_id,
            "laptop"
        );
        // The prompt tray follows the same device order.
        let prompt = FleetPrompt {
            prompt_id: "p".into(),
            kind: FleetPromptKind::Permission,
            answerable: true,
            ..FleetPrompt::default()
        };
        let mut pc = digest("cloud-3f2a", vec![], vec![]);
        pc.prompts = vec![prompt.clone()];
        let mut pl = digest("laptop", vec![], vec![]);
        pl.prompts = vec![prompt];
        let online_cloud = FleetDeviceFacts {
            state: FleetDeviceState::Online,
            ..cloud.clone()
        };
        let tray = project_prompts(
            1,
            &[
                FleetDeviceInput {
                    facts: &client,
                    partition: Some(&pl),
                    changed_revision: 1,
                },
                FleetDeviceInput {
                    facts: &online_cloud,
                    partition: Some(&pc),
                    changed_revision: 1,
                },
            ],
        );
        assert_eq!(tray.prompts[0].device_id, "cloud-3f2a");
    }

    #[test]
    fn legacy_prompts_without_an_answer_route_answer_through_the_runtime() {
        let desktop = facts("d", "desk", FleetDeviceState::Online);
        let legacy: FleetPrompt = serde_json::from_value(json!({
            "deviceId": "d",
            "workspaceId": "w",
            "sessionId": "s",
            "kind": "permission",
            "promptId": "p1",
            "revision": 1,
            "title": "Run a command",
            "answerable": true
        }))
        .unwrap();
        assert_eq!(legacy.answer_route, FleetAnswerRoute::Runtime);
        assert_eq!(legacy.job_id, None);
        let dispatch = FleetPrompt {
            prompt_id: "p2".into(),
            revision: 2,
            answer_route: FleetAnswerRoute::Dispatch,
            job_id: Some("job-7".into()),
            ..legacy.clone()
        };
        let orphan = FleetPrompt {
            prompt_id: "p3".into(),
            revision: 3,
            answer_route: FleetAnswerRoute::Dispatch,
            job_id: None,
            ..legacy.clone()
        };
        let newer = FleetPrompt {
            prompt_id: "p4".into(),
            revision: 4,
            answer_route: FleetAnswerRoute::Unknown,
            ..legacy.clone()
        };
        let mut partition = digest("d", vec![], vec![]);
        partition.prompts = vec![legacy, dispatch, orphan, newer];
        let tray = project_prompts(
            1,
            &[FleetDeviceInput {
                facts: &desktop,
                partition: Some(&partition),
                changed_revision: 1,
            }],
        );
        let reasons: Vec<(bool, Option<&str>)> = tray
            .prompts
            .iter()
            .map(|p| (p.answerable, p.unanswerable_reason.as_deref()))
            .collect();
        assert_eq!(
            reasons,
            [
                (true, None),
                (true, None),
                (false, Some("dispatch_job_missing")),
                (false, Some("answer_route_unsupported")),
            ]
        );
        assert_eq!(
            serde_json::to_value(&tray.prompts[0]).unwrap()["answerRoute"],
            "runtime"
        );
    }

    #[test]
    fn navigator_deltas_list_changed_devices_and_removals() {
        let a = facts("a", "a", FleetDeviceState::Online);
        let b = facts("b", "b", FleetDeviceState::Online);
        let pa = digest("a", vec![workspace("w", "w")], vec![session("w", "s", 1)]);
        let input = FleetNavigatorInput {
            revision: 10,
            devices: vec![
                FleetDeviceInput {
                    facts: &a,
                    partition: Some(&pa),
                    changed_revision: 9,
                },
                FleetDeviceInput {
                    facts: &b,
                    partition: None,
                    changed_revision: 4,
                },
            ],
            removed: vec![("gone".into(), 8), ("older".into(), 2)],
            delta_floor: 3,
        };
        let delta = project_navigator(&input, Some(5));
        assert!(!delta.full);
        assert_eq!(delta.devices.len(), 1);
        assert_eq!(delta.devices[0].device_id, "a");
        assert_eq!(delta.removed_device_ids, ["gone"]);
        assert_eq!(delta.totals.running + delta.totals.waiting, 0);
        // Before the floor, or a revision from another instance (future): full.
        assert!(project_navigator(&input, Some(2)).full);
        assert!(project_navigator(&input, Some(11)).full);
        let full = project_navigator(&input, None);
        assert_eq!(full.devices.len(), 2);
        assert!(full.removed_device_ids.is_empty());
        let current = project_navigator(&input, Some(10));
        assert!(!current.full && current.devices.is_empty());
    }

    #[test]
    fn same_workspace_id_on_two_devices_stays_distinct() {
        let a = facts("a", "a", FleetDeviceState::Online);
        let b = facts("b", "b", FleetDeviceState::Online);
        let pa = digest(
            "a",
            vec![workspace("local_x", "proj")],
            vec![session("local_x", "s1", 1)],
        );
        let pb = digest(
            "b",
            vec![workspace("local_x", "proj")],
            vec![session("local_x", "s1", 2)],
        );
        let input = FleetNavigatorInput {
            revision: 1,
            devices: vec![
                FleetDeviceInput {
                    facts: &a,
                    partition: Some(&pa),
                    changed_revision: 1,
                },
                FleetDeviceInput {
                    facts: &b,
                    partition: Some(&pb),
                    changed_revision: 1,
                },
            ],
            ..FleetNavigatorInput::default()
        };
        let navigator = project_navigator(&input, None);
        let keys: Vec<(String, String)> = navigator
            .devices
            .iter()
            .flat_map(|d| d.workspaces.iter())
            .map(|w| (w.device_id.clone(), w.workspace_id.clone()))
            .collect();
        assert_eq!(
            keys,
            [
                ("a".into(), "local_x".into()),
                ("b".into(), "local_x".into())
            ]
        );
        assert_eq!(navigator.totals, FleetTotals::default());
    }

    #[test]
    fn bounds_truncate_sessions_workspaces_and_devices() {
        let a = facts("a", "a", FleetDeviceState::Online);
        // 60 idle top-level sessions plus a running one and a child.
        let mut sessions: Vec<FleetSession> = (0..60)
            .map(|i| session("w", &format!("s{i:02}"), i))
            .collect();
        let mut old_running = session("w", "old-running", 0);
        old_running.status = FleetSessionStatus::Running;
        sessions.push(old_running);
        let mut child = session("w", "child", 100);
        child.parent_session_id = Some("s59".into());
        sessions.push(child);
        sessions.push(session("w", "s00", 999)); // duplicate id: first wins
        sessions.push(session("missing-workspace", "orphan", 5));
        let partition = digest(
            "a",
            vec![workspace("w", "w"), workspace("w", "dup")],
            sessions,
        );
        let device = project_device(&a, Some(&partition));
        assert_eq!(device.workspaces.len(), 1);
        let listed = &device.workspaces[0];
        let top_level_idle = listed
            .sessions
            .iter()
            .filter(|s| s.parent_session_id.is_none() && !s.is_pinned_by_activity())
            .count();
        assert_eq!(top_level_idle, MAX_TOP_LEVEL_SESSIONS_PER_WORKSPACE);
        assert!(listed
            .sessions
            .iter()
            .any(|s| s.session_id == "old-running"));
        assert!(
            !listed.sessions.iter().any(|s| s.session_id == "child"),
            "children are kept only when active"
        );
        assert!(!listed.sessions.iter().any(|s| s.session_id == "orphan"));
        assert!(listed.has_more);
        assert!(listed.session_total >= 51);
        assert_eq!(
            listed
                .sessions
                .iter()
                .find(|s| s.session_id == "s00")
                .map(|s| s.last_activity_ms),
            None
        );

        // Device bound: 600 running sessions over 3 workspaces.
        let workspaces = vec![
            workspace("x", "x"),
            workspace("y", "y"),
            workspace("z", "z"),
        ];
        let many: Vec<FleetSession> = (0..600)
            .map(|i| {
                let mut s = session(["x", "y", "z"][i % 3], &format!("r{i:03}"), i as u64);
                s.status = FleetSessionStatus::Running;
                s
            })
            .collect();
        let device = project_device(&a, Some(&digest("a", workspaces, many)));
        let total: usize = device.workspaces.iter().map(|w| w.sessions.len()).sum();
        assert_eq!(total, MAX_SESSIONS_PER_DEVICE);
        assert!(device.sessions_truncated);
        assert!(device
            .workspaces
            .iter()
            .all(|w| !w.sessions.iter().any(|s| s.session_id == "r000")));

        // Workspace bound.
        let wide: Vec<FleetWorkspace> = (0..300)
            .map(|i| workspace(&format!("w{i:03}"), "n"))
            .collect();
        let device = project_device(&a, Some(&digest("a", wide, vec![])));
        assert_eq!(device.workspaces.len(), MAX_WORKSPACES_PER_DEVICE);
        assert!(device.sessions_truncated);

        // Indexed-device bound.
        let all: Vec<FleetDeviceFacts> = (0..40)
            .map(|i| {
                facts(
                    &format!("d{i:02}"),
                    &format!("d{i:02}"),
                    FleetDeviceState::Online,
                )
            })
            .collect();
        let partitions: Vec<FleetDigest> = all
            .iter()
            .map(|f| digest(&f.device_id, vec![workspace("w", "w")], vec![]))
            .collect();
        let input = FleetNavigatorInput {
            revision: 1,
            devices: all
                .iter()
                .zip(&partitions)
                .map(|(facts, partition)| FleetDeviceInput {
                    facts,
                    partition: Some(partition),
                    changed_revision: 1,
                })
                .collect(),
            ..FleetNavigatorInput::default()
        };
        let navigator = project_navigator(&input, None);
        let not_indexed: Vec<&FleetDevice> = navigator
            .devices
            .iter()
            .filter(|d| d.state == FleetDeviceState::NotIndexed)
            .collect();
        assert_eq!(not_indexed.len(), 40 - MAX_INDEXED_DEVICES);
        assert!(not_indexed.iter().all(|d| d.workspaces.is_empty()
            && d.state_reason.as_deref() == Some("device_limit")
            && !d.actions.create_workspace.allowed));
    }

    #[test]
    fn offline_partition_is_kept_stale_with_its_age() {
        let stale = FleetDeviceFacts {
            as_of_ms: 1234,
            ..facts("a", "a", FleetDeviceState::Stale)
        };
        let partition = digest("a", vec![workspace("w", "w")], vec![session("w", "s", 1)]);
        let device = project_device(&stale, Some(&partition));
        assert_eq!(device.state, FleetDeviceState::Stale);
        assert_eq!(device.as_of_ms, 1234);
        assert_eq!(device.workspaces[0].sessions.len(), 1);
        assert_eq!(
            device.actions.create_workspace.reason.as_deref(),
            Some("device_stale")
        );
    }

    #[test]
    fn prompts_are_one_tray_with_bounds_and_answerability() {
        let mut desktop = facts("d", "desk", FleetDeviceState::Online);
        desktop.host_capabilities = vec![PeerHostCapability::UserQuestionResponse.key().into()];
        let old_cli = FleetDeviceFacts {
            host_kind: FleetHostKind::Cli,
            ..facts("c", "cli", FleetDeviceState::Online)
        };
        let offline = facts("o", "off", FleetDeviceState::Offline);
        let prompt = |id: &str, kind: FleetPromptKind, revision: u64| FleetPrompt {
            device_id: "spoofed".into(),
            workspace_id: "w".into(),
            session_id: "s".into(),
            kind,
            prompt_id: id.into(),
            revision,
            title: id.into(),
            answerable: true,
            ..FleetPrompt::default()
        };
        let mut big = prompt("big", FleetPromptKind::Permission, 1);
        big.payload = Some(json!({"blob": "x".repeat(MAX_PROMPT_PAYLOAD_BYTES)}));
        let mut pd = digest("d", vec![], vec![]);
        pd.prompts = vec![prompt("q", FleetPromptKind::Question, 2), big];
        let mut pc = digest("c", vec![], vec![]);
        pc.prompts = vec![
            prompt("q2", FleetPromptKind::Question, 1),
            prompt("p2", FleetPromptKind::Permission, 1),
        ];
        let mut po = digest("o", vec![], vec![]);
        po.prompts = vec![prompt("p3", FleetPromptKind::Permission, 1)];
        let devices = [
            FleetDeviceInput {
                facts: &offline,
                partition: Some(&po),
                changed_revision: 1,
            },
            FleetDeviceInput {
                facts: &desktop,
                partition: Some(&pd),
                changed_revision: 1,
            },
            FleetDeviceInput {
                facts: &old_cli,
                partition: Some(&pc),
                changed_revision: 1,
            },
        ];
        let tray = project_prompts(4, &devices);
        assert_eq!(tray.revision, 4);
        let ids: Vec<(&str, &str)> = tray
            .prompts
            .iter()
            .map(|p| (p.device_id.as_str(), p.prompt_id.as_str()))
            .collect();
        assert_eq!(
            ids,
            [
                ("c", "p2"),
                ("c", "q2"),
                ("d", "big"),
                ("d", "q"),
                ("o", "p3")
            ]
        );
        let by_id = |id: &str| tray.prompts.iter().find(|p| p.prompt_id == id).unwrap();
        assert!(by_id("big").payload.is_none() && by_id("big").payload_truncated);
        assert!(by_id("q").answerable);
        assert!(!by_id("q2").answerable);
        assert_eq!(
            by_id("q2").unanswerable_reason.as_deref(),
            Some("question_answer_unsupported")
        );
        assert!(by_id("p2").answerable);
        assert_eq!(
            by_id("p3").unanswerable_reason.as_deref(),
            Some("device_offline")
        );

        let mut flood = digest("d", vec![], vec![]);
        flood.prompts = (0..300)
            .map(|i| prompt(&format!("p{i:03}"), FleetPromptKind::Permission, i))
            .collect();
        let tray = project_prompts(
            1,
            &[FleetDeviceInput {
                facts: &desktop,
                partition: Some(&flood),
                changed_revision: 1,
            }],
        );
        assert_eq!(tray.prompts.len(), MAX_PROMPTS_PER_DEVICE);
        assert_eq!(tray.prompts[0].prompt_id, "p000", "oldest first");
    }

    struct Index {
        states: BTreeMap<String, FleetDeviceState>,
        owners: BTreeMap<(FleetEntity, String), Vec<String>>,
        open_ended: BTreeSet<String>,
    }

    impl FleetOwnerIndex for Index {
        fn device_state(&self, device_id: &str) -> Option<FleetDeviceState> {
            self.states.get(device_id).copied()
        }
        fn owners(&self, entity: FleetEntity, id: &str) -> Vec<String> {
            self.owners
                .get(&(entity, id.to_string()))
                .cloned()
                .unwrap_or_default()
        }
        fn may_hold_unlisted(&self, device_id: &str, _entity: FleetEntity) -> bool {
            self.open_ended.contains(device_id)
        }
    }

    fn index() -> Index {
        Index {
            states: BTreeMap::from([
                ("a".into(), FleetDeviceState::Online),
                ("b".into(), FleetDeviceState::Online),
                ("old".into(), FleetDeviceState::UpdateRequired),
                ("off".into(), FleetDeviceState::Offline),
                ("stale".into(), FleetDeviceState::Stale),
            ]),
            owners: BTreeMap::from([
                ((FleetEntity::Session, "s-on-b".into()), vec!["b".into()]),
                (
                    (FleetEntity::Workspace, "local_x".into()),
                    vec!["a".into(), "b".into()],
                ),
            ]),
            open_ended: BTreeSet::new(),
        }
    }

    fn call(target: Option<&str>, command: &str, args: Value) -> FleetCallRequest {
        FleetCallRequest {
            target: target.map(str::to_string),
            command: command.into(),
            args,
        }
    }

    #[test]
    fn owner_mismatch_is_refused_never_rerouted() {
        let index = index();
        let turn = |target| {
            call(
                target,
                "start_dialog_turn",
                json!({"request": {"sessionId": "s-on-b"}}),
            )
        };
        let verdict = fleet_call_verdict("a", &turn(Some("a")), &index);
        let FleetCallVerdict::Refuse(refusal) = verdict else {
            panic!("{verdict:?}")
        };
        assert_eq!(refusal.message(), "fleet_owner_mismatch: b");
        assert_eq!(
            fleet_call_verdict("a", &turn(Some("b")), &index),
            FleetCallVerdict::Forward { target: "b".into() }
        );
        assert_eq!(
            fleet_call_verdict("a", &turn(None), &index),
            FleetCallVerdict::Forward { target: "b".into() },
            "an unambiguous owner resolves a missing target"
        );
        assert_eq!(
            fleet_call_verdict("b", &turn(None), &index),
            FleetCallVerdict::Local
        );
        // A target whose partition may hold unlisted sessions is trusted.
        let mut open = index;
        open.open_ended.insert("a".into());
        assert_eq!(
            fleet_call_verdict("a", &turn(Some("a")), &open),
            FleetCallVerdict::Local
        );
    }

    #[test]
    fn ambiguous_or_unknown_owners_need_a_target() {
        let index = index();
        let shared = call(
            None,
            "list_persisted_sessions_page",
            json!({"request": {"workspace_id": "local_x"}}),
        );
        let verdict = fleet_call_verdict("a", &shared, &index);
        assert!(
            matches!(&verdict, FleetCallVerdict::Refuse(r) if r.prefix() == FLEET_TARGET_REQUIRED),
            "{verdict:?}"
        );
        let shared_on_b = FleetCallRequest {
            target: Some("b".into()),
            ..shared
        };
        assert_eq!(
            fleet_call_verdict("a", &shared_on_b, &index),
            FleetCallVerdict::Forward { target: "b".into() }
        );
        let unknown = call(
            None,
            "start_dialog_turn",
            json!({"request": {"sessionId": "nobody"}}),
        );
        assert!(matches!(
            fleet_call_verdict("a", &unknown, &index),
            FleetCallVerdict::Refuse(FleetCallRefusal::TargetRequired { .. })
        ));
        let unknown_on_b = call(
            Some("b"),
            "start_dialog_turn",
            json!({"request": {"sessionId": "nobody"}}),
        );
        assert_eq!(
            fleet_call_verdict("a", &unknown_on_b, &index),
            FleetCallVerdict::Forward { target: "b".into() }
        );
        let no_id = call(Some("b"), "terminal_create", json!({"request": {}}));
        assert_eq!(
            fleet_call_verdict("a", &no_id, &index),
            FleetCallVerdict::Forward { target: "b".into() }
        );
    }

    #[test]
    fn device_scoped_and_local_commands() {
        let index = index();
        let config = |target| call(target, "get_config", json!({"request": {}}));
        assert!(matches!(
            fleet_call_verdict("a", &config(None), &index),
            FleetCallVerdict::Refuse(FleetCallRefusal::TargetRequired { .. })
        ));
        assert_eq!(
            fleet_call_verdict("a", &config(Some("a")), &index),
            FleetCallVerdict::Local
        );
        assert_eq!(
            fleet_call_verdict("a", &config(Some("stale")), &index),
            FleetCallVerdict::Forward {
                target: "stale".into()
            }
        );
        assert_eq!(
            fleet_call_verdict("a", &call(None, "account_login", json!({})), &index),
            FleetCallVerdict::Local
        );
        assert_eq!(
            fleet_call_verdict("a", &call(Some("b"), "account_login", json!({})), &index),
            FleetCallVerdict::Forward { target: "b".into() },
            "the other device answers with its own refusal"
        );
    }

    #[test]
    fn offline_outdated_unknown_and_nested_calls_are_refused() {
        let index = index();
        let config = |target: &str| call(Some(target), "get_config", json!({}));
        let message = |verdict: FleetCallVerdict| match verdict {
            FleetCallVerdict::Refuse(refusal) => refusal.message(),
            other => panic!("{other:?}"),
        };
        assert!(message(fleet_call_verdict("a", &config("off"), &index))
            .starts_with("fleet_device_offline: off"));
        assert!(message(fleet_call_verdict("a", &config("nope"), &index))
            .starts_with("fleet_device_offline: nope (device_unknown)"));
        assert!(message(fleet_call_verdict("a", &config("old"), &index))
            .starts_with("fleet_device_outdated: old"));
        for verb in [
            "fleet_call",
            "fleet_navigator",
            "fleet_digest",
            "fleet_replay",
            "fleet_future_verb",
        ] {
            assert!(
                message(fleet_call_verdict(
                    "a",
                    &call(Some("b"), verb, json!({})),
                    &index
                ))
                .starts_with("fleet_nested_call:"),
                "{verb}"
            );
        }
    }

    #[test]
    fn candidates_rank_by_the_documented_order() {
        let candidate = |id: &str| FleetEntryCandidate {
            device_id: id.into(),
            online: true,
            fleet_protocol: Some(1),
            full_host: true,
            latency_ms: Some(50),
            fleet_load: Some(1),
            version: Some("1.0.0".into()),
        };
        let ranked = rank_entry_candidates(&[
            FleetEntryCandidate {
                online: false,
                ..candidate("offline")
            },
            FleetEntryCandidate {
                fleet_protocol: None,
                ..candidate("legacy")
            },
            FleetEntryCandidate {
                full_host: false,
                ..candidate("cli")
            },
            FleetEntryCandidate {
                latency_ms: Some(90),
                ..candidate("slow")
            },
            FleetEntryCandidate {
                latency_ms: None,
                ..candidate("unmeasured")
            },
            FleetEntryCandidate {
                fleet_load: Some(5),
                ..candidate("busy")
            },
            FleetEntryCandidate {
                version: Some("0.9.9".into()),
                ..candidate("older")
            },
            FleetEntryCandidate {
                version: Some("v1.2.0".into()),
                ..candidate("newer")
            },
            candidate("b-same"),
            candidate("a-same"),
        ]);
        let order: Vec<&str> = ranked.iter().map(|c| c.device_id.as_str()).collect();
        assert_eq!(
            order,
            [
                "newer",
                "a-same",
                "b-same",
                "older",
                "busy",
                "slow",
                "unmeasured",
                "cli",
                "legacy",
                "offline"
            ]
        );
        let wire: FleetEntryCandidate =
            serde_json::from_value(json!({"deviceId": "x", "online": null, "extra": 1})).unwrap();
        assert!(!wire.online);
        assert_eq!(
            serde_json::to_value(candidate("x")).unwrap()["fleetLoad"],
            1
        );
    }

    #[test]
    fn assistant_workspace_always_leads_each_device() {
        let client = FleetDeviceFacts {
            is_client_device: true,
            ..facts("mac", "MacBook", FleetDeviceState::Online)
        };
        let peer = facts("linux", "Linux Box", FleetDeviceState::Online);

        let mut local_current = workspace("proj-alpha", "Alpha");
        local_current.is_host_current = true;
        let mut remote = workspace("remote-beta", "Beta");
        remote.kind = FleetWorkspaceKind::RemoteSsh;
        let mut secondary_asst = workspace("asst-secondary", "A-Helper");
        secondary_asst.kind = FleetWorkspaceKind::Assistant;
        let mut primary_asst = workspace("asst-primary", "Zeta Assistant");
        primary_asst.kind = FleetWorkspaceKind::Assistant;
        primary_asst.is_primary_assistant = true;

        let client_partition = digest(
            "mac",
            vec![local_current, remote, secondary_asst, primary_asst],
            vec![
                session("proj-alpha", "s-proj", 900),
                session("remote-beta", "s-remote", 800),
                session("asst-secondary", "s-sec", 700),
                session("asst-primary", "s-pri", 10),
            ],
        );

        // Older peer digest without `isPrimaryAssistant` still keeps its assistant first.
        let mut peer_current = workspace("peer-repo", "Aardvark");
        peer_current.is_host_current = true;
        let mut peer_asst = workspace("peer-asst", "Zzz Bot");
        peer_asst.kind = FleetWorkspaceKind::Assistant;
        let peer_partition = digest(
            "linux",
            vec![peer_current, peer_asst],
            vec![session("peer-repo", "s-peer-repo", 999)],
        );

        let input = FleetNavigatorInput {
            revision: 1,
            devices: vec![
                FleetDeviceInput {
                    facts: &client,
                    partition: Some(&client_partition),
                    changed_revision: 1,
                },
                FleetDeviceInput {
                    facts: &peer,
                    partition: Some(&peer_partition),
                    changed_revision: 1,
                },
            ],
            ..FleetNavigatorInput::default()
        };
        let navigator = project_navigator(&input, None);
        let mac_ids: Vec<&str> = navigator.devices[0]
            .workspaces
            .iter()
            .map(|w| w.workspace_id.as_str())
            .collect();
        assert_eq!(
            mac_ids,
            [
                "asst-primary",
                "asst-secondary",
                "proj-alpha",
                "remote-beta"
            ]
        );
        let peer_ids: Vec<&str> = navigator.devices[1]
            .workspaces
            .iter()
            .map(|w| w.workspace_id.as_str())
            .collect();
        assert_eq!(peer_ids, ["peer-asst", "peer-repo"]);

        // Truncation beyond `MAX_WORKSPACES_PER_DEVICE` keeps the assistant first.
        let mut wide: Vec<FleetWorkspace> = (0..300)
            .map(|i| workspace(&format!("w{i:03}"), &format!("A-{i:03}")))
            .collect();
        wide[0].is_host_current = true;
        let mut wide_asst = workspace("asst-last", "Z-Assistant");
        wide_asst.kind = FleetWorkspaceKind::Assistant;
        wide_asst.is_primary_assistant = true;
        wide.push(wide_asst);
        let wide_sessions: Vec<FleetSession> = (0..300)
            .map(|i| session(&format!("w{i:03}"), &format!("s{i:03}"), 10_000 + i as u64))
            .collect();
        let bounded = project_device(&client, Some(&digest("mac", wide, wide_sessions)));
        assert_eq!(bounded.workspaces.len(), MAX_WORKSPACES_PER_DEVICE);
        assert_eq!(bounded.workspaces[0].workspace_id, "asst-last");
    }
}

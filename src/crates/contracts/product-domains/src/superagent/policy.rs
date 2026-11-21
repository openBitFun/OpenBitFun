//! Superagent decisions, as pure functions.
//!
//! The cloud node and the device sides apply these the same way, and
//! frontends only display their results. Reason codes are the stable strings
//! in `dto::reason`.

use std::collections::BTreeSet;

use super::dto::*;
use super::tools::{DispatchSourceInput, WaitUntil};
use crate::fleet::{FleetActionGate, FleetHostKind};

// ---------------------------------------------------------------------------
// Job state
// ---------------------------------------------------------------------------

/// What the cloud node knows about one job when it projects its state.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct JobStateFacts {
    pub ledger: LedgerJobPhase,
    /// The last state the target reported, if it was ever observed.
    pub target: Option<TargetJobState>,
    /// Whether the job's device can be observed now.
    pub device_online: bool,
    /// Permissions or questions waiting for the user.
    pub pending_prompts: u32,
}

/// Project one job's state (and the reason, when the state needs one).
///
/// A terminal state the target reported stays while its device is offline:
/// it cannot change without a new instruction. A job still running on an
/// offline device is `queued` with reason
/// `device_offline` rather than its stale last state, because nobody can tell
/// whether it is still working; the job keeps running on its owner.
pub fn project_job_state(facts: &JobStateFacts) -> (SuperagentJobState, Option<&'static str>) {
    match facts.ledger {
        LedgerJobPhase::Expired => return (SuperagentJobState::Failed, Some(reason::EXPIRED)),
        LedgerJobPhase::Pending => {
            let why = if facts.device_online {
                reason::SUBMITTING
            } else {
                reason::WAITING_FOR_DEVICE
            };
            return (SuperagentJobState::Queued, Some(why));
        }
        LedgerJobPhase::Submitted | LedgerJobPhase::Unknown => {}
    }
    let terminal = match facts.target {
        Some(TargetJobState::Succeeded) => Some(SuperagentJobState::Done),
        Some(TargetJobState::Failed) => Some(SuperagentJobState::Failed),
        Some(TargetJobState::Cancelled) => Some(SuperagentJobState::Cancelled),
        _ => None,
    };
    if let Some(state) = terminal {
        return (state, None);
    }
    if !facts.device_online {
        return (SuperagentJobState::Queued, Some(reason::DEVICE_OFFLINE));
    }
    match facts.target {
        Some(TargetJobState::Queued | TargetJobState::Running) if facts.pending_prompts > 0 => {
            (SuperagentJobState::Blocked, Some(reason::PROMPT_PENDING))
        }
        Some(TargetJobState::Running) => (SuperagentJobState::Working, None),
        Some(TargetJobState::Queued) => (SuperagentJobState::Queued, None),
        // Submitted but not observed yet: the target accepted it, so it is
        // queued there until the first status answers.
        None => (SuperagentJobState::Queued, None),
        Some(_) => (
            SuperagentJobState::Unknown,
            Some(reason::UNKNOWN_TARGET_STATE),
        ),
    }
}

/// Whether a parked `fleet_wait` may resume. `before` is the state of each
/// watched job when the wait started, `now` the current one (same order).
pub fn wait_satisfied(
    until: WaitUntil,
    before: &[SuperagentJobState],
    now: &[SuperagentJobState],
) -> bool {
    if now.is_empty() {
        return true;
    }
    match until {
        WaitUntil::StateChange => {
            before.len() != now.len() || before.iter().zip(now).any(|(a, b)| a != b)
        }
        WaitUntil::AnyBlocked => now.contains(&SuperagentJobState::Blocked),
        WaitUntil::AnyTerminal => now.iter().any(|state| state.is_terminal()),
        WaitUntil::AllTerminal => now.iter().all(|state| state.is_terminal()),
    }
}

// ---------------------------------------------------------------------------
// Dispatch gating
// ---------------------------------------------------------------------------

/// The dispatch capabilities a job from `source` needs on its target, on top
/// of the detached worker.
pub fn required_dispatch_capabilities(source: &DispatchSourceInput) -> Vec<&'static str> {
    let mut required = vec![
        WORKSPACE_TARGET_SOURCE_CAPABILITY,
        STATUS_SUMMARY_ONLY_CAPABILITY,
        JOB_SUBMITTER_CAPABILITY,
    ];
    if matches!(source, DispatchSourceInput::Job { .. }) {
        required.push(WORKSPACE_PEER_IMPORT_CAPABILITY);
    }
    required
}

fn is_runtime_host(kind: FleetHostKind) -> bool {
    matches!(kind, FleetHostKind::Desktop | FleetHostKind::Cli)
}

/// Whether the superagent may dispatch to `runtime` now. The order is the
/// order a user can act on: update the device, turn its switch on, bring it
/// online, then the platform and the remaining capabilities.
pub fn dispatch_gate(runtime: &RuntimeFacts, required: &[&str]) -> DispatchGate {
    let refuse = |reason: &str, missing: Vec<String>| DispatchGate {
        allowed: false,
        reason: Some(reason.to_string()),
        missing,
    };
    if !is_runtime_host(runtime.host_kind) {
        return refuse(reason::CAPABILITY_MISSING, vec!["runtime_host".to_string()]);
    }
    if !has(&runtime.host_capabilities, CLOUD_AGENT_SCOPE_CAPABILITY) {
        return refuse(reason::SUPERAGENT_REQUIRES_UPDATE, Vec::new());
    }
    if !runtime.accept_dispatch {
        return refuse(reason::DISPATCH_DISABLED_ON_DEVICE, Vec::new());
    }
    if !runtime.online {
        return refuse(reason::DEVICE_OFFLINE, Vec::new());
    }
    if !has(&runtime.dispatch_capabilities, DETACHED_WORKER_CAPABILITY) {
        return refuse(reason::DETACHED_WORKER_UNSUPPORTED, Vec::new());
    }
    let missing: Vec<String> = required
        .iter()
        .filter(|capability| !has(&runtime.dispatch_capabilities, capability))
        .map(|capability| capability.to_string())
        .collect();
    if !missing.is_empty() {
        return refuse(reason::CAPABILITY_MISSING, missing);
    }
    DispatchGate {
        allowed: true,
        reason: None,
        missing: Vec::new(),
    }
}

/// Whether a job with approval `auto` is accepted on `runtime`. The reason is
/// surfaced to the model so it can pick `remote` or another device.
pub fn auto_approval_gate(runtime: &RuntimeFacts) -> FleetActionGate {
    if runtime.allow_auto_approval {
        allow()
    } else {
        deny(reason::AUTO_APPROVAL_DISABLED_ON_DEVICE)
    }
}

impl DispatchGate {
    /// The only refusal a `queueIfOffline` job may wait out in the ledger.
    pub fn is_queueable(&self) -> bool {
        !self.allowed && self.reason.as_deref() == Some(reason::DEVICE_OFFLINE)
    }
}

fn has(capabilities: &[String], wanted: &str) -> bool {
    capabilities.iter().any(|capability| capability == wanted)
}

// ---------------------------------------------------------------------------
// Model holders
// ---------------------------------------------------------------------------

fn can_hold(candidate: &ModelHolderCandidate) -> bool {
    candidate.online
        && candidate.model_configured
        && is_runtime_host(candidate.host_kind)
        && has(&candidate.host_capabilities, FLEET_MODEL_CAPABILITY)
        && has(&candidate.host_capabilities, CLOUD_AGENT_SCOPE_CAPABILITY)
}

/// Rank the devices that may hold the next model round of an Auto
/// conversation: the last holder (its prompt cache is warm), then desktop
/// over CLI, then the lowest latency (unknown last), then the device id. The
/// holder runs its primary model. Only online devices with a model
/// configured and `fleet_model_v1` qualify; `exclude` drops holders that
/// were just lost so the round retries elsewhere.
pub fn rank_model_holders(
    candidates: &[ModelHolderCandidate],
    last_holder: Option<&str>,
    exclude: &[String],
) -> HolderChoice {
    let mut eligible: Vec<&ModelHolderCandidate> = candidates
        .iter()
        .filter(|candidate| can_hold(candidate))
        .filter(|candidate| !exclude.contains(&candidate.device_id))
        .collect();
    let host_rank = |kind: FleetHostKind| match kind {
        FleetHostKind::Desktop => 0,
        _ => 1,
    };
    eligible.sort_by(|a, b| {
        let key = |c: &ModelHolderCandidate| {
            (
                Some(c.device_id.as_str()) != last_holder,
                host_rank(c.host_kind),
                c.latency_ms.unwrap_or(u32::MAX),
            )
        };
        key(a)
            .cmp(&key(b))
            .then_with(|| a.device_id.cmp(&b.device_id))
    });
    let mut seen = BTreeSet::new();
    let ranked: Vec<String> = eligible
        .into_iter()
        .filter(|candidate| seen.insert(candidate.device_id.as_str()))
        .map(|candidate| candidate.device_id.clone())
        .collect();
    if ranked.is_empty() {
        HolderChoice::NoHolder {
            reason: reason::NO_HOLDER.to_string(),
        }
    } else {
        HolderChoice::Chosen { ranked }
    }
}

/// The holder of a conversation that picked a device and a model: that
/// device only, never another one. A device whose catalog is unknown (an
/// older build) is trusted with the model id; one whose catalog lacks it is
/// refused.
pub fn pinned_model_holder(
    candidates: &[ModelHolderCandidate],
    pick: &SuperagentModelPick,
) -> HolderChoice {
    let refuse = |code: &str| HolderChoice::NoHolder {
        reason: code.to_string(),
    };
    let Some(candidate) = candidates
        .iter()
        .find(|candidate| candidate.device_id == pick.device_id)
    else {
        return refuse(model_reason::PINNED_HOLDER_OFFLINE);
    };
    if !candidate.online {
        return refuse(model_reason::PINNED_HOLDER_OFFLINE);
    }
    let has_model = candidate.models.is_empty()
        || candidate
            .models
            .iter()
            .any(|model| model.model_id == pick.model_id);
    if !can_hold(candidate) || !has_model {
        return refuse(model_reason::PINNED_MODEL_MISSING);
    }
    HolderChoice::Chosen {
        ranked: vec![candidate.device_id.clone()],
    }
}

fn label_of(candidate: &ModelHolderCandidate) -> String {
    if candidate.name.trim().is_empty() {
        candidate.device_id.clone()
    } else {
        candidate.name.clone()
    }
}

fn join_names(names: &[String]) -> String {
    names.join(", ")
}

/// Why no device can run the round, with what to do. Frontends show the
/// card; the turn ends with it (no model round waits on a device).
pub fn no_holder_notice(
    candidates: &[ModelHolderCandidate],
    pick: Option<&SuperagentModelPick>,
) -> NoHolderNotice {
    let mut notice = NoHolderNotice::default();
    for candidate in candidates
        .iter()
        .filter(|candidate| is_runtime_host(candidate.host_kind))
    {
        let name = label_of(candidate);
        if !candidate.online {
            notice.offline.push(name);
        } else if !has(&candidate.host_capabilities, FLEET_MODEL_CAPABILITY)
            || !has(&candidate.host_capabilities, CLOUD_AGENT_SCOPE_CAPABILITY)
        {
            notice.requires_update.push(name);
        } else if !candidate.model_configured {
            notice.no_model.push(name);
        }
    }
    if let Some(pick) = pick {
        let candidate = candidates
            .iter()
            .find(|candidate| candidate.device_id == pick.device_id);
        let device = candidate.map_or_else(|| pick.device_id.clone(), label_of);
        let model = candidate
            .and_then(|candidate| {
                candidate
                    .models
                    .iter()
                    .find(|model| model.model_id == pick.model_id)
            })
            .map(|model| model.display_name.clone())
            .filter(|name| !name.trim().is_empty())
            .unwrap_or_else(|| pick.model_id.clone());
        let online = candidate.is_some_and(|candidate| candidate.online);
        if online {
            notice.reason = model_reason::PINNED_MODEL_MISSING.to_string();
            notice.text = format!(
                "{model} cannot run on {device} now: the device no longer offers it. Pick another model or Auto, then send again."
            );
        } else {
            notice.reason = model_reason::PINNED_HOLDER_OFFLINE.to_string();
            notice.text = format!(
                "{model} lives on {device}, which is offline. Start {device}, or pick Auto or another model, then send again."
            );
        }
        return notice;
    }
    notice.reason = reason::NO_HOLDER.to_string();
    let mut parts = Vec::new();
    if !notice.offline.is_empty() {
        parts.push(format!("offline: {}", join_names(&notice.offline)));
    }
    if !notice.no_model.is_empty() {
        parts.push(format!(
            "no model configured: {}",
            join_names(&notice.no_model)
        ));
    }
    if !notice.requires_update.is_empty() {
        parts.push(format!(
            "needs an update: {}",
            join_names(&notice.requires_update)
        ));
    }
    notice.text = if parts.is_empty() {
        "No device can run a model for this request: no desktop or CLI of this account is signed in. Sign in on one with a model configured, then send again.".to_string()
    } else {
        format!(
            "No device can run a model for this request right now ({}). Start a device, configure a model on an online one, or update it, then send again.",
            parts.join("; ")
        )
    };
    notice
}

/// The Super Agent model picker: every runtime device of the account with
/// its models, online and able to relay rounds first, then by name. A
/// device's models are offered when it can hold a round now.
pub fn project_model_devices(candidates: &[ModelHolderCandidate]) -> Vec<SuperagentModelDevice> {
    let mut devices: Vec<SuperagentModelDevice> = candidates
        .iter()
        .filter(|candidate| is_runtime_host(candidate.host_kind))
        .map(|candidate| {
            let unavailable_reason = if !candidate.online {
                Some(reason::DEVICE_OFFLINE)
            } else if !has(&candidate.host_capabilities, FLEET_MODEL_CAPABILITY)
                || !has(&candidate.host_capabilities, CLOUD_AGENT_SCOPE_CAPABILITY)
            {
                Some(reason::SUPERAGENT_REQUIRES_UPDATE)
            } else if !candidate.model_configured || candidate.models.is_empty() {
                Some(crate::fleet::MODEL_REASON_NO_MODEL)
            } else {
                None
            };
            SuperagentModelDevice {
                device_id: candidate.device_id.clone(),
                name: label_of(candidate),
                host_kind: candidate.host_kind,
                online: candidate.online,
                unavailable_reason: unavailable_reason.map(str::to_string),
                models: candidate.models.clone(),
            }
        })
        .collect();
    devices.sort_by(|a, b| {
        a.unavailable_reason
            .is_some()
            .cmp(&b.unavailable_reason.is_some())
            .then_with(|| b.online.cmp(&a.online))
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
            .then_with(|| a.device_id.cmp(&b.device_id))
    });
    devices
}

/// The conversation's model as frontends show it.
pub fn project_model_selection(
    pick: Option<&SuperagentModelPick>,
    candidates: &[ModelHolderCandidate],
) -> SuperagentModelSelection {
    let Some(pick) = pick else {
        return SuperagentModelSelection {
            mode: "auto".to_string(),
            ..SuperagentModelSelection::default()
        };
    };
    let candidate = candidates
        .iter()
        .find(|candidate| candidate.device_id == pick.device_id);
    let model_name = candidate
        .and_then(|candidate| {
            candidate
                .models
                .iter()
                .find(|model| model.model_id == pick.model_id)
        })
        .map(|model| model.display_name.clone())
        .filter(|name| !name.trim().is_empty());
    let unavailable_reason = match pinned_model_holder(candidates, pick) {
        HolderChoice::Chosen { .. } => None,
        HolderChoice::NoHolder { reason } if reason == model_reason::PINNED_HOLDER_OFFLINE => {
            Some(super::dto::reason::DEVICE_OFFLINE.to_string())
        }
        HolderChoice::NoHolder { reason } => Some(reason),
    };
    SuperagentModelSelection {
        mode: "pinned".to_string(),
        device_id: Some(pick.device_id.clone()),
        device_name: candidate.map(label_of),
        model_id: Some(pick.model_id.clone()),
        model_name,
        unavailable_reason,
    }
}

// ---------------------------------------------------------------------------
// Job cards
// ---------------------------------------------------------------------------

/// Everything a card is projected from.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct JobCardFacts {
    pub job_id: String,
    pub device: RuntimeFacts,
    pub title: String,
    pub state: JobStateFacts,
    pub branch: Option<String>,
    pub group_id: Option<String>,
    pub label: Option<String>,
    pub diff_stat: Option<DiffStat>,
    /// Waiting prompts in arrival order (the first is shown).
    pub pending_prompts: Vec<JobPendingPrompt>,
    pub last_answer: Option<JobAnswerNote>,
}

fn allow() -> FleetActionGate {
    FleetActionGate {
        allowed: true,
        reason: None,
    }
}

fn deny(reason: &str) -> FleetActionGate {
    FleetActionGate {
        allowed: false,
        reason: Some(reason.to_string()),
    }
}

/// Project one job card with its gated actions.
pub fn project_job_card(facts: &JobCardFacts) -> JobCard {
    let mut state_facts = facts.state;
    state_facts.pending_prompts = state_facts
        .pending_prompts
        .max(facts.pending_prompts.len() as u32);
    let (state, state_reason) = project_job_state(&state_facts);
    let on_device = !matches!(
        facts.state.ledger,
        LedgerJobPhase::Pending | LedgerJobPhase::Expired
    );
    let pending_reason = if facts.state.ledger == LedgerJobPhase::Expired {
        reason::EXPIRED
    } else if facts.device.online {
        reason::SUBMITTING
    } else {
        reason::WAITING_FOR_DEVICE
    };
    let offline = !facts.device.online;

    let open_transcript = if !on_device {
        deny(pending_reason)
    } else if offline {
        deny(reason::DEVICE_OFFLINE)
    } else {
        allow()
    };
    let message = if !on_device {
        deny(pending_reason)
    } else if state == SuperagentJobState::Cancelled {
        deny(reason::JOB_CANCELLED)
    } else if offline {
        deny(reason::DEVICE_OFFLINE)
    } else {
        allow()
    };
    let cancel = if state.is_terminal() {
        deny(reason::JOB_TERMINAL)
    } else if on_device && offline {
        deny(reason::DEVICE_OFFLINE)
    } else {
        // A ledger-queued job is cancelled by dropping it from the queue.
        allow()
    };
    let publish = if state != SuperagentJobState::Done {
        deny(reason::JOB_NOT_FINISHED)
    } else if facts.branch.as_deref().is_none_or(str::is_empty) {
        deny(reason::NO_RESULT_BRANCH)
    } else if offline {
        deny(reason::DEVICE_OFFLINE)
    } else if !has(
        &facts.device.dispatch_capabilities,
        WORKSPACE_PUBLISH_CAPABILITY,
    ) {
        deny(reason::CAPABILITY_MISSING)
    } else {
        allow()
    };

    let answer = if state != SuperagentJobState::Blocked {
        deny(reason::NO_PENDING_PROMPT)
    } else if offline {
        deny(reason::DEVICE_OFFLINE)
    } else {
        allow()
    };

    let pending_prompt = if state == SuperagentJobState::Blocked {
        facts.pending_prompts.first().map(|first| JobPendingPrompt {
            more: (facts.pending_prompts.len().saturating_sub(1)) as u32,
            ..first.clone()
        })
    } else {
        None
    };
    JobCard {
        job_id: facts.job_id.clone(),
        device_id: facts.device.device_id.clone(),
        device_name: if facts.device.name.trim().is_empty() {
            facts.device.device_id.clone()
        } else {
            facts.device.name.clone()
        },
        os: facts.device.os.clone(),
        host_kind: facts.device.host_kind,
        title: facts.title.clone(),
        state,
        state_reason: state_reason.map(str::to_string),
        branch: facts.branch.clone(),
        group_id: facts.group_id.clone(),
        label: facts.label.clone(),
        diff_stat: facts.diff_stat.clone(),
        pending_prompt,
        last_answer: facts.last_answer.clone(),
        actions: JobCardActions {
            open_transcript,
            message,
            cancel,
            publish,
            answer,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn caps(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    fn runtime(id: &str, name: &str, kind: FleetHostKind, os: &str, arch: &str) -> RuntimeFacts {
        RuntimeFacts {
            device_id: id.to_string(),
            name: name.to_string(),
            host_kind: kind,
            os: os.to_string(),
            arch: arch.to_string(),
            online: true,
            host_capabilities: caps(&[CLOUD_AGENT_SCOPE_CAPABILITY, FLEET_MODEL_CAPABILITY]),
            dispatch_capabilities: caps(&[
                DETACHED_WORKER_CAPABILITY,
                WORKSPACE_TARGET_SOURCE_CAPABILITY,
                STATUS_SUMMARY_ONLY_CAPABILITY,
                JOB_SUBMITTER_CAPABILITY,
                QUERY_RESULT_SUMMARY_CAPABILITY,
            ]),
            accept_dispatch: true,
            allow_auto_approval: true,
            model_configured: true,
            latency_ms: None,
        }
    }

    #[test]
    fn job_state_table() {
        use LedgerJobPhase::*;
        use SuperagentJobState as S;
        use TargetJobState as T;
        type Case = (
            LedgerJobPhase,
            Option<T>,
            bool,
            u32,
            S,
            Option<&'static str>,
        );
        let cases: &[Case] = &[
            (
                Pending,
                None,
                false,
                0,
                S::Queued,
                Some(reason::WAITING_FOR_DEVICE),
            ),
            (Pending, None, true, 0, S::Queued, Some(reason::SUBMITTING)),
            (Expired, None, true, 0, S::Failed, Some(reason::EXPIRED)),
            (Submitted, None, true, 0, S::Queued, None),
            (Submitted, Some(T::Queued), true, 0, S::Queued, None),
            (Submitted, Some(T::Running), true, 0, S::Working, None),
            (
                Submitted,
                Some(T::Running),
                true,
                2,
                S::Blocked,
                Some(reason::PROMPT_PENDING),
            ),
            (
                Submitted,
                Some(T::Queued),
                true,
                1,
                S::Blocked,
                Some(reason::PROMPT_PENDING),
            ),
            (
                Submitted,
                Some(T::Running),
                false,
                0,
                S::Queued,
                Some(reason::DEVICE_OFFLINE),
            ),
            (
                Submitted,
                Some(T::Running),
                false,
                3,
                S::Queued,
                Some(reason::DEVICE_OFFLINE),
            ),
            (Submitted, Some(T::Succeeded), true, 0, S::Done, None),
            (Submitted, Some(T::Succeeded), false, 0, S::Done, None),
            (Submitted, Some(T::Failed), false, 0, S::Failed, None),
            (Submitted, Some(T::Cancelled), true, 1, S::Cancelled, None),
            (
                Submitted,
                Some(T::Unknown),
                true,
                0,
                S::Unknown,
                Some(reason::UNKNOWN_TARGET_STATE),
            ),
            (
                LedgerJobPhase::Unknown,
                Some(T::Running),
                true,
                0,
                S::Working,
                None,
            ),
        ];
        for (ledger, target, online, prompts, state, why) in cases {
            let facts = JobStateFacts {
                ledger: *ledger,
                target: *target,
                device_online: *online,
                pending_prompts: *prompts,
            };
            assert_eq!(project_job_state(&facts), (*state, *why), "{facts:?}");
        }
    }

    #[test]
    fn target_states_read_tolerantly() {
        let state: TargetJobState = serde_json::from_value(json!("running")).unwrap();
        assert_eq!(state, TargetJobState::Running);
        let newer: TargetJobState = serde_json::from_value(json!("paused")).unwrap();
        assert_eq!(newer, TargetJobState::Unknown);
        let newer: SuperagentJobState = serde_json::from_value(json!("sleeping")).unwrap();
        assert_eq!(newer, SuperagentJobState::Unknown);
        assert_eq!(
            serde_json::to_value(SuperagentJobState::Blocked).unwrap(),
            "blocked"
        );
    }

    #[test]
    fn wait_conditions() {
        use SuperagentJobState as S;
        assert!(!wait_satisfied(
            WaitUntil::StateChange,
            &[S::Working],
            &[S::Working]
        ));
        assert!(wait_satisfied(
            WaitUntil::StateChange,
            &[S::Working],
            &[S::Blocked]
        ));
        assert!(wait_satisfied(
            WaitUntil::AnyBlocked,
            &[],
            &[S::Working, S::Blocked]
        ));
        assert!(!wait_satisfied(
            WaitUntil::AnyTerminal,
            &[],
            &[S::Working, S::Queued]
        ));
        assert!(!wait_satisfied(
            WaitUntil::AnyTerminal,
            &[],
            &[S::Working, S::Idle]
        ));
        assert!(wait_satisfied(
            WaitUntil::AnyTerminal,
            &[],
            &[S::Working, S::Failed]
        ));
        assert!(!wait_satisfied(
            WaitUntil::AllTerminal,
            &[],
            &[S::Done, S::Working]
        ));
        assert!(wait_satisfied(
            WaitUntil::AllTerminal,
            &[],
            &[S::Done, S::Cancelled]
        ));
        assert!(wait_satisfied(WaitUntil::AllTerminal, &[], &[]));
    }

    #[test]
    fn dispatch_gate_order() {
        let required = [WORKSPACE_TARGET_SOURCE_CAPABILITY];
        let mut device = runtime("d", "D", FleetHostKind::Cli, "linux", "x86_64");
        assert!(dispatch_gate(&device, &required).allowed);

        device.dispatch_capabilities.clear();
        device.online = false;
        device.accept_dispatch = false;
        device.host_capabilities.clear();
        let reason_of = |device: &RuntimeFacts| dispatch_gate(device, &required).reason;
        assert_eq!(
            reason_of(&device).as_deref(),
            Some(reason::SUPERAGENT_REQUIRES_UPDATE)
        );
        device.host_capabilities = caps(&[CLOUD_AGENT_SCOPE_CAPABILITY]);
        assert_eq!(
            reason_of(&device).as_deref(),
            Some(reason::DISPATCH_DISABLED_ON_DEVICE)
        );
        device.accept_dispatch = true;
        assert_eq!(reason_of(&device).as_deref(), Some(reason::DEVICE_OFFLINE));
        assert!(dispatch_gate(&device, &required).is_queueable());
        device.online = true;
        assert_eq!(
            reason_of(&device).as_deref(),
            Some(reason::DETACHED_WORKER_UNSUPPORTED)
        );
        device.dispatch_capabilities = caps(&[DETACHED_WORKER_CAPABILITY]);
        let gate = dispatch_gate(&device, &required);
        assert_eq!(gate.reason.as_deref(), Some(reason::CAPABILITY_MISSING));
        assert_eq!(gate.missing, caps(&[WORKSPACE_TARGET_SOURCE_CAPABILITY]));
        assert!(!gate.is_queueable());

        let cloud = runtime("c", "C", FleetHostKind::Cloud, "linux", "x86_64");
        assert!(!dispatch_gate(&cloud, &required).allowed);

        // A peer-import source needs its own capability.
        let job_source = DispatchSourceInput::Job { job_id: "j".into() };
        assert!(
            required_dispatch_capabilities(&job_source).contains(&WORKSPACE_PEER_IMPORT_CAPABILITY)
        );
    }

    #[test]
    fn gate_reads_a_legacy_runtime_record_with_switches_on() {
        let facts: RuntimeFacts = serde_json::from_value(
            json!({"deviceId": "d", "acceptDispatch": null, "allowAutoApproval": null}),
        )
        .unwrap();
        assert!(facts.accept_dispatch && facts.allow_auto_approval);
        let facts: RuntimeFacts = serde_json::from_value(json!({"deviceId": "d"})).unwrap();
        assert!(facts.accept_dispatch && facts.allow_auto_approval);
        assert!(auto_approval_gate(&facts).allowed);
        let off: RuntimeFacts =
            serde_json::from_value(json!({"deviceId": "d", "allowAutoApproval": false})).unwrap();
        assert_eq!(
            auto_approval_gate(&off).reason.as_deref(),
            Some(reason::AUTO_APPROVAL_DISABLED_ON_DEVICE)
        );
    }

    fn holder(id: &str, kind: FleetHostKind, latency: Option<u32>) -> ModelHolderCandidate {
        ModelHolderCandidate {
            device_id: id.to_string(),
            host_kind: kind,
            online: true,
            model_configured: true,
            host_capabilities: caps(&[CLOUD_AGENT_SCOPE_CAPABILITY, FLEET_MODEL_CAPABILITY]),
            latency_ms: latency,
            ..ModelHolderCandidate::default()
        }
    }

    fn ranked(choice: HolderChoice) -> Vec<String> {
        match choice {
            HolderChoice::Chosen { ranked } => ranked,
            HolderChoice::NoHolder { reason } => panic!("no holder: {reason}"),
        }
    }

    #[test]
    fn holder_ranking_order() {
        let candidates = vec![
            holder("cli-fast", FleetHostKind::Cli, Some(5)),
            holder("desk-slow", FleetHostKind::Desktop, Some(90)),
            holder("desk-fast", FleetHostKind::Desktop, Some(10)),
            holder("desk-unknown", FleetHostKind::Desktop, None),
        ];
        assert_eq!(
            ranked(rank_model_holders(&candidates, None, &[])),
            ["desk-fast", "desk-slow", "desk-unknown", "cli-fast"]
        );
        assert_eq!(
            ranked(rank_model_holders(&candidates, Some("cli-fast"), &[]))[0],
            "cli-fast"
        );
        // A lost holder is excluded and the round retries elsewhere.
        assert_eq!(
            ranked(rank_model_holders(
                &candidates,
                Some("desk-fast"),
                &["desk-fast".to_string()]
            ))[0],
            "desk-slow"
        );
    }

    #[test]
    fn holders_need_presence_model_and_capabilities() {
        let mut offline = holder("a", FleetHostKind::Desktop, Some(1));
        offline.online = false;
        let mut no_model = holder("b", FleetHostKind::Desktop, Some(1));
        no_model.model_configured = false;
        let mut old = holder("c", FleetHostKind::Desktop, Some(1));
        old.host_capabilities = caps(&[CLOUD_AGENT_SCOPE_CAPABILITY]);
        let cloud = holder("cloud-x", FleetHostKind::Cloud, Some(1));
        assert_eq!(
            rank_model_holders(&[offline, no_model, old, cloud], Some("a"), &[]),
            HolderChoice::NoHolder {
                reason: reason::NO_HOLDER.to_string()
            }
        );
    }

    fn named(
        mut candidate: ModelHolderCandidate,
        name: &str,
        models: &[&str],
    ) -> ModelHolderCandidate {
        candidate.name = name.to_string();
        candidate.models = models
            .iter()
            .map(|id| crate::fleet::FleetModel {
                model_id: id.to_string(),
                display_name: id.to_uppercase(),
                primary: models.first() == Some(id),
                ..crate::fleet::FleetModel::default()
            })
            .collect();
        candidate
    }

    #[test]
    fn a_pinned_pick_runs_only_on_its_device_and_model() {
        let desk = named(
            holder("desk", FleetHostKind::Desktop, Some(9)),
            "Studio",
            &["big", "fast"],
        );
        let mut cli = named(holder("cli", FleetHostKind::Cli, Some(1)), "Box", &["srv"]);
        let pick = |device: &str, model: &str| SuperagentModelPick {
            device_id: device.to_string(),
            model_id: model.to_string(),
        };
        assert_eq!(
            ranked(pinned_model_holder(
                &[desk.clone(), cli.clone()],
                &pick("cli", "srv")
            )),
            ["cli"]
        );
        // Never another device, even an online one.
        cli.online = false;
        assert_eq!(
            pinned_model_holder(&[desk.clone(), cli.clone()], &pick("cli", "srv")),
            HolderChoice::NoHolder {
                reason: model_reason::PINNED_HOLDER_OFFLINE.to_string()
            }
        );
        assert_eq!(
            pinned_model_holder(&[desk.clone()], &pick("desk", "gone")),
            HolderChoice::NoHolder {
                reason: model_reason::PINNED_MODEL_MISSING.to_string()
            }
        );
        // An unknown catalog (older device) is trusted with the id.
        let mut older = holder("old", FleetHostKind::Desktop, None);
        older.models.clear();
        assert_eq!(
            ranked(pinned_model_holder(&[older], &pick("old", "x"))),
            ["old"]
        );

        let notice = no_holder_notice(&[desk.clone(), cli.clone()], Some(&pick("cli", "srv")));
        assert_eq!(notice.reason, model_reason::PINNED_HOLDER_OFFLINE);
        assert_eq!(
            notice.text,
            "SRV lives on Box, which is offline. Start Box, or pick Auto or another model, then send again."
        );
        let selection =
            project_model_selection(Some(&pick("cli", "srv")), &[desk.clone(), cli.clone()]);
        assert_eq!(selection.mode, "pinned");
        assert_eq!(selection.device_name.as_deref(), Some("Box"));
        assert_eq!(selection.model_name.as_deref(), Some("SRV"));
        assert_eq!(
            selection.unavailable_reason.as_deref(),
            Some(reason::DEVICE_OFFLINE)
        );
        assert_eq!(project_model_selection(None, &[desk]).mode, "auto");
    }

    #[test]
    fn the_no_holder_notice_names_devices_and_what_to_do() {
        let mut offline = named(holder("a", FleetHostKind::Desktop, None), "Laptop", &["m"]);
        offline.online = false;
        let mut no_model = named(holder("b", FleetHostKind::Cli, None), "Build box", &[]);
        no_model.model_configured = false;
        let mut old = named(holder("c", FleetHostKind::Desktop, None), "Old Mac", &[]);
        old.host_capabilities = caps(&[CLOUD_AGENT_SCOPE_CAPABILITY]);
        let notice = no_holder_notice(&[offline.clone(), no_model.clone(), old.clone()], None);
        assert_eq!(notice.reason, reason::NO_HOLDER);
        assert_eq!(notice.offline, ["Laptop"]);
        assert_eq!(notice.no_model, ["Build box"]);
        assert_eq!(notice.requires_update, ["Old Mac"]);
        assert!(notice.text.contains("offline: Laptop"), "{}", notice.text);
        assert!(notice.text.contains("no model configured: Build box"));
        assert!(notice.text.contains("needs an update: Old Mac"));
        assert!(no_holder_notice(&[], None).text.contains("Sign in on one"));

        let picker = project_model_devices(&[
            offline,
            no_model,
            old,
            named(holder("d", FleetHostKind::Desktop, None), "studio", &["x"]),
        ]);
        let ids: Vec<&str> = picker.iter().map(|d| d.device_id.as_str()).collect();
        assert_eq!(ids, ["d", "b", "c", "a"]);
        assert_eq!(picker[0].unavailable_reason, None);
        assert_eq!(
            picker[3].unavailable_reason.as_deref(),
            Some(reason::DEVICE_OFFLINE)
        );
    }

    fn card_facts() -> JobCardFacts {
        let mut device = runtime("lin", "Linux CLI", FleetHostKind::Cli, "linux", "x86_64");
        device
            .dispatch_capabilities
            .push(WORKSPACE_PUBLISH_CAPABILITY.into());
        JobCardFacts {
            job_id: "job-1".into(),
            device,
            title: "Run tests".into(),
            state: JobStateFacts {
                ledger: LedgerJobPhase::Submitted,
                target: Some(TargetJobState::Running),
                device_online: true,
                pending_prompts: 0,
            },
            branch: Some("openbitfun/dispatch/job-1".into()),
            group_id: Some("g".into()),
            label: Some("linux".into()),
            diff_stat: None,
            pending_prompts: Vec::new(),
            last_answer: None,
        }
    }

    #[test]
    fn job_card_actions_follow_the_state() {
        let mut facts = card_facts();
        let card = project_job_card(&facts);
        assert_eq!(card.state, SuperagentJobState::Working);
        assert!(card.actions.cancel.allowed && card.actions.message.allowed);
        assert_eq!(
            card.actions.publish.reason.as_deref(),
            Some(reason::JOB_NOT_FINISHED)
        );

        facts.pending_prompts = vec![
            JobPendingPrompt {
                request_id: "p1".into(),
                tool_name: Some("Bash".into()),
                ..JobPendingPrompt::default()
            },
            JobPendingPrompt {
                request_id: "p2".into(),
                ..JobPendingPrompt::default()
            },
        ];
        let card = project_job_card(&facts);
        assert_eq!(card.state, SuperagentJobState::Blocked);
        assert!(card.actions.answer.allowed);
        let prompt = card.pending_prompt.expect("blocked card shows its prompt");
        assert_eq!((prompt.request_id.as_str(), prompt.more), ("p1", 1));

        // The model answered the first prompt: the card says so.
        facts.pending_prompts.remove(0);
        facts.last_answer = Some(JobAnswerNote {
            prompt_id: "p1".into(),
            answered_by: ANSWERED_BY_SUPERAGENT.into(),
            decision: Some("once".into()),
            at_ms: Some(1),
        });
        let encoded = serde_json::to_value(project_job_card(&facts)).unwrap();
        assert_eq!(encoded["lastAnswer"]["answeredBy"], "superagent");
        assert_eq!(encoded["pendingPrompt"]["requestId"], "p2");
        facts.last_answer = None;

        facts.pending_prompts.clear();
        facts.state.target = Some(TargetJobState::Succeeded);
        let card = project_job_card(&facts);
        assert_eq!(card.state, SuperagentJobState::Done);
        assert!(card.actions.publish.allowed);
        // A done job continues with a new turn when messaged.
        assert!(card.actions.message.allowed);
        assert_eq!(
            card.actions.answer.reason.as_deref(),
            Some(reason::NO_PENDING_PROMPT)
        );
        assert_eq!(
            card.actions.cancel.reason.as_deref(),
            Some(reason::JOB_TERMINAL)
        );

        facts.device.online = false;
        facts.state.device_online = false;
        let card = project_job_card(&facts);
        assert_eq!(
            card.actions.publish.reason.as_deref(),
            Some(reason::DEVICE_OFFLINE)
        );
        assert_eq!(
            card.actions.message.reason.as_deref(),
            Some(reason::DEVICE_OFFLINE)
        );

        facts.state.ledger = LedgerJobPhase::Pending;
        facts.state.target = None;
        let card = project_job_card(&facts);
        assert_eq!(card.state, SuperagentJobState::Queued);
        assert!(
            card.actions.cancel.allowed,
            "a ledger-queued job can be dropped"
        );
        assert_eq!(
            card.actions.open_transcript.reason.as_deref(),
            Some(reason::WAITING_FOR_DEVICE)
        );

        facts.state = JobStateFacts {
            ledger: LedgerJobPhase::Submitted,
            target: Some(TargetJobState::Cancelled),
            device_online: true,
            pending_prompts: 0,
        };
        facts.device.online = true;
        let card = project_job_card(&facts);
        assert_eq!(
            card.actions.message.reason.as_deref(),
            Some(reason::JOB_CANCELLED)
        );
    }

    #[test]
    fn job_cards_read_tolerantly() {
        let card: JobCard = serde_json::from_value(json!({
            "jobId": "j", "state": "teleporting", "hostKind": "phone", "future": 1,
            "actions": null, "diffStat": {"files": null, "filesChanged": 3}
        }))
        .unwrap();
        assert_eq!(card.state, SuperagentJobState::Unknown);
        assert_eq!(card.host_kind, FleetHostKind::Unknown);
        assert_eq!(card.diff_stat.unwrap().files_changed, 3);
        let encoded = serde_json::to_value(project_job_card(&card_facts())).unwrap();
        assert_eq!(encoded["state"], "working");
        assert_eq!(encoded["hostKind"], "cli");
        assert!(encoded.get("pendingPrompt").is_none());
    }

    #[test]
    fn the_cloud_node_reads_as_super_agent_under_its_legacy_default_name() {
        assert_eq!(CLOUD_DEVICE_DISPLAY_NAME, "Super Agent");
        assert_eq!(cloud_node_display_name(""), "Super Agent");
        assert_eq!(cloud_node_display_name("OpenBitFun"), "Super Agent");
        assert_eq!(cloud_node_display_name("Team agent"), "Team agent");
    }
}

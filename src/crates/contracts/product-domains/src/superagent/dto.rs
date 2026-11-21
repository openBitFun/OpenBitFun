//! Superagent wire shapes for frontends and the cloud node's own records.
//!
//! Shapes a frontend reads (`JobCard`) cross a version
//! boundary, so they read tolerantly the way the fleet shapes do: every field
//! has a default, unknown fields are ignored, and every enum has an `Unknown`
//! variant for values a newer build added. Tool inputs are the opposite: they
//! come from a model and are parsed strictly (see `tools`).

use serde::{Deserialize, Serialize};

use crate::fleet::dto::null_default;
use crate::fleet::{FleetActionGate, FleetHostKind};

/// Device id prefix of the per-account cloud node (`cloud-<hash(accountId)>`).
pub const CLOUD_DEVICE_ID_PREFIX: &str = "cloud-";
/// Display name of the cloud node.
pub const CLOUD_DEVICE_DISPLAY_NAME: &str = "Super Agent";
/// The display name cloud nodes registered with before it was "Super Agent";
/// a directory row still carrying it reads as [`CLOUD_DEVICE_DISPLAY_NAME`].
pub const LEGACY_CLOUD_DEVICE_DISPLAY_NAME: &str = "OpenBitFun";

/// The name a cloud node's directory row is shown with: empty and the
/// legacy default read as [`CLOUD_DEVICE_DISPLAY_NAME`].
pub fn cloud_node_display_name(registered: &str) -> &str {
    let trimmed = registered.trim();
    if trimmed.is_empty() || trimmed == LEGACY_CLOUD_DEVICE_DISPLAY_NAME {
        CLOUD_DEVICE_DISPLAY_NAME
    } else {
        registered
    }
}
/// Account-directory kind of the cloud node's key. Older clients never treat
/// a row of this kind as a host.
pub const CLOUD_AGENT_DIRECTORY_KIND: &str = "cloud_agent";

/// A device admits the `CloudAgent` scope (and may be dialed by the cloud
/// node). The superagent never dials a device without it.
pub const CLOUD_AGENT_SCOPE_CAPABILITY: &str = "cloud_agent_scope_v1";
/// A device relays model rounds for the cloud node (`fleet_model_*`).
pub const FLEET_MODEL_CAPABILITY: &str = "fleet_model_v1";
/// Target verbs the superagent needs on top of `dispatch_target_v1` and
/// `detached_worker` (their dispatch-contract names). Kept here as well so
/// the pure policy can gate on them without the services layer.
pub const WORKSPACE_TARGET_SOURCE_CAPABILITY: &str = "workspace_target_source_v1";
pub const QUERY_RESULT_SUMMARY_CAPABILITY: &str = "query_result_summary_v1";
pub const STATUS_SUMMARY_ONLY_CAPABILITY: &str = "status_summary_only_v1";
pub const JOB_SUBMITTER_CAPABILITY: &str = "job_submitter_v1";
pub const WORKSPACE_PEER_IMPORT_CAPABILITY: &str = "workspace_peer_import_v1";
pub const WORKSPACE_PUBLISH_CAPABILITY: &str = "workspace_publish_v1";
/// A job's `AskUserQuestion` waits in the target's question mailbox
/// (answered through `fleet_job_answer {answers}` or the Inbox).
pub const USER_QUESTION_MAILBOX_CAPABILITY: &str = "user_question_mailbox_v1";
pub const DETACHED_WORKER_CAPABILITY: &str = "detached_worker";

/// The submitter tag the cloud node puts on every job it submits.
pub const CLOUD_SUBMITTER: &str = "cloud";

/// Who answered a job prompt.
pub const ANSWERED_BY_SUPERAGENT: &str = "superagent";
pub const ANSWERED_BY_USER: &str = "user";

/// Event names on the cloud node's OBP stream.
pub const SUPERAGENT_TURN_DELTA_EVENT: &str = "superagent://turn-delta";
pub const SUPERAGENT_CARD_CHANGED_EVENT: &str = "superagent://card-changed";

/// Stable reason codes (snake_case; frontends localize them).
pub mod reason {
    /// The device lacks `cloud_agent_scope_v1`; it is never dialed.
    pub const SUPERAGENT_REQUIRES_UPDATE: &str = "superagent_requires_update";
    /// The device cannot run detached workers (Windows today).
    pub const DETACHED_WORKER_UNSUPPORTED: &str = "detached_worker_unsupported";
    /// The device's owner turned `superagent.acceptDispatch` off.
    pub const DISPATCH_DISABLED_ON_DEVICE: &str = "dispatch_disabled_on_device";
    /// The device's owner turned `superagent.allowAutoApproval` off, so a job
    /// with approval `auto` is refused there; `remote` still works.
    pub const AUTO_APPROVAL_DISABLED_ON_DEVICE: &str = "auto_approval_disabled_on_device";
    /// The job has no prompt waiting.
    pub const NO_PENDING_PROMPT: &str = "no_pending_prompt";
    /// The device lacks a capability a tool needs (detail names it).
    pub const CAPABILITY_MISSING: &str = "capability_missing";
    /// The device is not online now.
    pub const DEVICE_OFFLINE: &str = "device_offline";
    /// The job is queued in the ledger until its device comes online.
    pub const WAITING_FOR_DEVICE: &str = "waiting_for_device";
    /// The job's id is written ahead and the submit is in flight.
    pub const SUBMITTING: &str = "submitting";
    /// A queued job's offline window ran out before its device came back.
    pub const EXPIRED: &str = "expired";
    /// The job waits on a permission or question the user must answer.
    pub const PROMPT_PENDING: &str = "prompt_pending";
    /// The target reported a state this build does not know.
    pub const UNKNOWN_TARGET_STATE: &str = "unknown_target_state";
    /// No online device can hold a model round now.
    pub const NO_HOLDER: &str = "no_holder";
    /// The job already finished.
    pub const JOB_TERMINAL: &str = "job_terminal";
    /// The job has not finished yet.
    pub const JOB_NOT_FINISHED: &str = "job_not_finished";
    /// The job produced no branch to publish.
    pub const NO_RESULT_BRANCH: &str = "no_result_branch";
    /// The job was cancelled; it takes no more messages.
    pub const JOB_CANCELLED: &str = "job_cancelled";
}

// ---------------------------------------------------------------------------
// Job state projection
// ---------------------------------------------------------------------------

/// The state a superagent shows for one dispatched job (herdr-like).
///
/// - `queued`: written ahead in the ledger but not on the target yet (device
///   offline, or the submit is in flight), accepted by the target and not
///   started, or submitted to a device that cannot be reached now (reason
///   `device_offline`; the job keeps running on its owner);
/// - `working`: the target is running a turn;
/// - `blocked`: a turn waits on a prompt someone must answer;
/// - `idle`: non-terminal and between turns, should a target ever report
///   that; no target state maps to it today;
/// - `done`, `failed`, `cancelled`: the last turn ended (terminal). A done
///   job can still be messaged; the message continues it with a new turn.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SuperagentJobState {
    Queued,
    Working,
    Blocked,
    Idle,
    Done,
    Failed,
    Cancelled,
    #[default]
    #[serde(other)]
    Unknown,
}

impl SuperagentJobState {
    pub const fn is_terminal(self) -> bool {
        matches!(self, Self::Done | Self::Failed | Self::Cancelled)
    }
}

/// The target's own job state (`DispatchJobState` on the dispatch wire),
/// read tolerantly so a newer target's value parses as `Unknown`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TargetJobState {
    Queued,
    Running,
    Succeeded,
    Failed,
    Cancelled,
    #[default]
    #[serde(other)]
    Unknown,
}

/// Where the ledger says a job is in its own lifecycle.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LedgerJobPhase {
    /// Written ahead; not accepted by the target yet.
    #[default]
    Pending,
    /// The target accepted it.
    Submitted,
    /// Queued for an offline device past its deadline.
    Expired,
    #[serde(other)]
    Unknown,
}

// ---------------------------------------------------------------------------
// Diff stats and job cards
// ---------------------------------------------------------------------------

/// One file of a job's diff stat (`git diff --numstat`; never contents).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DiffStatFile {
    #[serde(deserialize_with = "null_default")]
    pub path: String,
    /// Absent for binary files.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub added: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deleted: Option<u64>,
    #[serde(deserialize_with = "null_default")]
    pub binary: bool,
    /// Not tracked by Git yet (an added file without line counts).
    #[serde(deserialize_with = "null_default", skip_serializing_if = "is_false")]
    pub untracked: bool,
}

/// The diff stat of a job: totals plus the largest files (bounded).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DiffStat {
    #[serde(deserialize_with = "null_default")]
    pub files_changed: u64,
    #[serde(deserialize_with = "null_default")]
    pub insertions: u64,
    #[serde(deserialize_with = "null_default")]
    pub deletions: u64,
    #[serde(deserialize_with = "null_default")]
    pub files: Vec<DiffStatFile>,
    /// True when `files` was cut to the bound.
    #[serde(deserialize_with = "null_default")]
    pub truncated: bool,
}

/// The prompt a blocked job waits on, as the card shows it. The user answers
/// it from the tray, or the superagent with `fleet_job_answer`; either way the
/// answer goes to the owner device (`dispatch_target_answer`).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct JobPendingPrompt {
    #[serde(deserialize_with = "null_default")]
    pub request_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// More prompts wait behind this one.
    #[serde(deserialize_with = "null_default")]
    pub more: u32,
}

/// The last answer given to one of the job's prompts. A card shows
/// `answeredBy: "superagent"` when the model answered it.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct JobAnswerNote {
    #[serde(deserialize_with = "null_default")]
    pub prompt_id: String,
    /// `superagent` or `user`.
    #[serde(deserialize_with = "null_default")]
    pub answered_by: String,
    /// `once`, `always`, `reject`, or `answered` for a question.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub decision: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub at_ms: Option<u64>,
}

/// The actions a card offers, each gated by the backend with a reason.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct JobCardActions {
    #[serde(deserialize_with = "null_default")]
    pub open_transcript: FleetActionGate,
    #[serde(deserialize_with = "null_default")]
    pub message: FleetActionGate,
    #[serde(deserialize_with = "null_default")]
    pub cancel: FleetActionGate,
    #[serde(deserialize_with = "null_default")]
    pub publish: FleetActionGate,
    /// Answer the waiting prompt from the card.
    #[serde(deserialize_with = "null_default")]
    pub answer: FleetActionGate,
}

/// The backend-projected card of one dispatched job.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct JobCard {
    #[serde(deserialize_with = "null_default")]
    pub job_id: String,
    #[serde(deserialize_with = "null_default")]
    pub device_id: String,
    #[serde(deserialize_with = "null_default")]
    pub device_name: String,
    #[serde(deserialize_with = "null_default")]
    pub os: String,
    #[serde(deserialize_with = "null_default")]
    pub host_kind: FleetHostKind,
    #[serde(deserialize_with = "null_default")]
    pub title: String,
    #[serde(deserialize_with = "null_default")]
    pub state: SuperagentJobState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diff_stat: Option<DiffStat>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pending_prompt: Option<JobPendingPrompt>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_answer: Option<JobAnswerNote>,
    #[serde(deserialize_with = "null_default")]
    pub actions: JobCardActions,
}

// ---------------------------------------------------------------------------
// Runtimes and model holders
// ---------------------------------------------------------------------------

/// What the superagent knows about one account runtime host when it plans
/// (from the fleet index and the device's dispatch probe).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RuntimeFacts {
    #[serde(deserialize_with = "null_default")]
    pub device_id: String,
    #[serde(deserialize_with = "null_default")]
    pub name: String,
    #[serde(deserialize_with = "null_default")]
    pub host_kind: FleetHostKind,
    /// `std::env::consts::OS` of the device (`macos`, `linux`, `windows`).
    #[serde(deserialize_with = "null_default")]
    pub os: String,
    /// `std::env::consts::ARCH` of the device (`aarch64`, `x86_64`).
    #[serde(deserialize_with = "null_default")]
    pub arch: String,
    #[serde(deserialize_with = "null_default")]
    pub online: bool,
    /// Mesh capabilities (hello / `/obp/mesh/info`).
    #[serde(deserialize_with = "null_default")]
    pub host_capabilities: Vec<String>,
    /// Dispatch capabilities from the last probe.
    #[serde(deserialize_with = "null_default")]
    pub dispatch_capabilities: Vec<String>,
    /// The owner's `superagent.acceptDispatch` switch (default on).
    #[serde(default = "default_true", deserialize_with = "null_true")]
    pub accept_dispatch: bool,
    /// The owner's `superagent.allowAutoApproval` switch (default on).
    #[serde(default = "default_true", deserialize_with = "null_true")]
    pub allow_auto_approval: bool,
    #[serde(deserialize_with = "null_default")]
    pub model_configured: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latency_ms: Option<u32>,
}

/// The dispatch verdict for one runtime, as `fleet_list_runtimes` reports it.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DispatchGate {
    #[serde(deserialize_with = "null_default")]
    pub allowed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// Missing capability names when `reason` is `capability_missing`.
    #[serde(
        deserialize_with = "null_default",
        skip_serializing_if = "Vec::is_empty"
    )]
    pub missing: Vec<String>,
}

/// One device that may hold a model round.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ModelHolderCandidate {
    #[serde(deserialize_with = "null_default")]
    pub device_id: String,
    #[serde(deserialize_with = "null_default")]
    pub host_kind: FleetHostKind,
    #[serde(deserialize_with = "null_default")]
    pub online: bool,
    #[serde(deserialize_with = "null_default")]
    pub model_configured: bool,
    /// Mesh capabilities; the holder needs `fleet_model_v1` and
    /// `cloud_agent_scope_v1`.
    #[serde(deserialize_with = "null_default")]
    pub host_capabilities: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latency_ms: Option<u32>,
    /// The device's display name (the no-holder notice names devices).
    #[serde(deserialize_with = "null_default")]
    pub name: String,
    /// The device's configured models (its fleet digest catalog, or the
    /// probe's model ids); empty when unknown.
    #[serde(deserialize_with = "null_default")]
    pub models: Vec<crate::fleet::FleetModel>,
}

/// Why no model round can start now (`no_holder` card facts).
pub mod model_reason {
    /// A conversation picked a device that is offline.
    pub const PINNED_HOLDER_OFFLINE: &str = "pinned_holder_offline";
    /// A conversation picked a model its device no longer has (or the
    /// device cannot relay rounds).
    pub const PINNED_MODEL_MISSING: &str = "pinned_model_missing";
}

/// A conversation's model choice: absent is Auto (the backend picks the
/// holder: the last one, then a desktop, then the lowest latency, with that
/// device's primary model); present is that device and that model.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SuperagentModelPick {
    #[serde(deserialize_with = "null_default")]
    pub device_id: String,
    #[serde(deserialize_with = "null_default")]
    pub model_id: String,
}

/// The conversation's model as frontends show it (`model` of
/// `superagent_get_conversation`).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SuperagentModelSelection {
    /// `auto` or `pinned`.
    #[serde(deserialize_with = "null_default")]
    pub mode: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_name: Option<String>,
    /// Why the pick cannot run now (`device_offline`, `pinned_model_missing`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unavailable_reason: Option<String>,
}

/// One device's group in the Super Agent model picker (`models` of
/// `superagent_status`).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SuperagentModelDevice {
    #[serde(deserialize_with = "null_default")]
    pub device_id: String,
    #[serde(deserialize_with = "null_default")]
    pub name: String,
    #[serde(deserialize_with = "null_default")]
    pub host_kind: FleetHostKind,
    #[serde(deserialize_with = "null_default")]
    pub online: bool,
    /// Why this device's models cannot be picked now; absent when they can.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unavailable_reason: Option<String>,
    #[serde(deserialize_with = "null_default")]
    pub models: Vec<crate::fleet::FleetModel>,
}

/// The answer when no device can run the round: the turn ends at once with
/// it (it never parks on model availability).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct NoHolderNotice {
    /// `no_holder`, `pinned_holder_offline` or `pinned_model_missing`.
    #[serde(deserialize_with = "null_default")]
    pub reason: String,
    /// Device names, by why they cannot hold the round.
    #[serde(deserialize_with = "null_default")]
    pub offline: Vec<String>,
    #[serde(deserialize_with = "null_default")]
    pub no_model: Vec<String>,
    #[serde(deserialize_with = "null_default")]
    pub requires_update: Vec<String>,
    /// The English sentence (what failed and what to do).
    #[serde(deserialize_with = "null_default")]
    pub text: String,
}

/// The holder choice for one model round.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "verdict", rename_all = "snake_case")]
pub enum HolderChoice {
    /// `ranked[0]` holds the round; the rest are the retry order.
    Chosen { ranked: Vec<String> },
    /// Nobody can; the turn ends with a [`NoHolderNotice`].
    NoHolder { reason: String },
}

fn is_false(value: &bool) -> bool {
    !*value
}

fn default_true() -> bool {
    true
}

fn null_true<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<bool, D::Error> {
    Ok(Option::<bool>::deserialize(deserializer)?.unwrap_or(true))
}

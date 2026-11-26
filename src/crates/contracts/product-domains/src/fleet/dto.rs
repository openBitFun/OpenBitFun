//! Fleet wire shapes.
//!
//! Every shape here crosses a version boundary: a digest comes from another
//! runtime host that may run an older or newer build, the navigator goes to a
//! client whose UI bundle may be older or newer, and the cached index is read
//! back from disk by a later build. So every shape is tolerant on read:
//!
//! - every field has a default and a JSON `null` reads as that default;
//! - unknown fields are ignored (no `deny_unknown_fields`);
//! - every enum has an `Unknown` variant that absorbs values a newer build
//!   added (`#[serde(other)]`).
//!
//! Field names are camelCase on the wire. Optional fields marked `?` in the
//! shared contract are omitted when absent; `fleetProtocol` is always present
//! (`null` for a host without the fleet layer). All commands take one
//! `{request: …}` object.

use std::collections::BTreeMap;

use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;

/// Fleet protocol version spoken by this build (hello `fleet.protocol`).
pub const FLEET_PROTOCOL_VERSION: u32 = 1;

/// Mesh capability a runtime host advertises (on the OBP hello and
/// `/obp/mesh/info`) once it serves the owner verbs `fleet_digest` and
/// `fleet_replay`. A host without it is indexed by polling as a leaf owner.
pub const FLEET_V1_CAPABILITY: &str = "fleet_v1";

/// Bounds of one replicated partition and of the index (fleet design §1).
pub const MAX_INDEXED_DEVICES: usize = 32;
pub const MAX_WORKSPACES_PER_DEVICE: usize = 250;
pub const MAX_TOP_LEVEL_SESSIONS_PER_WORKSPACE: usize = 50;
pub const MAX_SESSIONS_PER_DEVICE: usize = 500;
pub const MAX_PROMPTS_PER_DEVICE: usize = 256;
pub const MAX_PROMPT_PAYLOAD_BYTES: usize = 16 * 1024;
pub const MAX_PARTITION_BYTES: usize = 1024 * 1024;

/// Entry ring per origin (fleet design §3).
pub const FLEET_RING_MAX_EVENTS: usize = 4096;
pub const FLEET_RING_MAX_BYTES: usize = 16 * 1024 * 1024;

/// Event names.
pub const FLEET_DIGEST_CHANGED_EVENT: &str = "fleet://digest-changed";
pub const FLEET_INDEX_CHANGED_EVENT: &str = "fleet://index-changed";
pub const FLEET_PROMPTS_CHANGED_EVENT: &str = "fleet://prompts-changed";
pub const BACKEND_EVENTS_DROPPED_EVENT: &str = "backend://events-dropped";
/// Prefix of the index-only subscription every runtime host keeps to its peers.
pub const FLEET_EVENT_PREFIX: &str = "fleet://";

/// `backend://events-dropped` reasons.
pub const EVENTS_DROPPED_SLOW_CLIENT: &str = "slow_client";
pub const EVENTS_DROPPED_HISTORY_GONE: &str = "history_gone";
pub const EVENTS_DROPPED_INSTANCE_CHANGED: &str = "instance_changed";

/// `fleet_call` error prefixes. Each error is `"<prefix>: <detail>"`; the
/// owner's own errors pass through unchanged.
pub const FLEET_TARGET_REQUIRED: &str = "fleet_target_required";
pub const FLEET_OWNER_MISMATCH: &str = "fleet_owner_mismatch";
pub const FLEET_DEVICE_OFFLINE: &str = "fleet_device_offline";
pub const FLEET_DEVICE_OUTDATED: &str = "fleet_device_outdated";
pub const FLEET_NESTED_CALL: &str = "fleet_nested_call";
/// The in-flight call failed because the runtime host the client was
/// connected through went away; reads may be retried on the next one.
pub const FLEET_ENTRY_LOST: &str = "entry_lost";

/// Read `null` as the field's default, so an older or newer writer that
/// emits `null` for a value this build treats as required still parses.
pub(crate) fn null_default<'de, D, T>(deserializer: D) -> Result<T, D::Error>
where
    D: Deserializer<'de>,
    T: Default + Deserialize<'de>,
{
    Ok(Option::<T>::deserialize(deserializer)?.unwrap_or_default())
}

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

/// The kind of runtime host (a node that runs an Agent runtime).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FleetHostKind {
    Desktop,
    Cli,
    /// The per-account cloud runtime node (device id `cloud-<hash>`, shown
    /// as "Super Agent"). Its account-directory kind is `cloud_agent`, which
    /// older clients never treat as a host. Older readers see `Unknown`.
    Cloud,
    #[default]
    #[serde(other)]
    Unknown,
}

/// Device state, decided by the backend (never by a frontend), with a reason.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FleetDeviceState {
    /// Reachable, and its partition is current.
    Online,
    /// Signed in elsewhere but not on the account mesh now.
    Offline,
    /// Its partition is kept from an earlier sync (`asOfMs`).
    Stale,
    /// Present on the mesh but no link could be opened.
    Unreachable,
    /// Reachable only through a path older than the fleet layer (relay-only
    /// hosts); the user is asked to update that device.
    UpdateRequired,
    /// Beyond the indexed-device bound; listed without workspaces.
    NotIndexed,
    #[default]
    #[serde(other)]
    Unknown,
}

impl FleetDeviceState {
    /// Display order of states in the navigator (lower first).
    pub const fn display_rank(self) -> u8 {
        match self {
            Self::Online => 0,
            Self::Stale => 1,
            Self::Unreachable => 2,
            Self::Offline => 3,
            Self::UpdateRequired => 4,
            Self::NotIndexed => 5,
            Self::Unknown => 6,
        }
    }

    /// Whether a forwarded call may be attempted.
    pub const fn accepts_calls(self) -> bool {
        matches!(self, Self::Online | Self::Stale | Self::NotIndexed)
    }
}

/// How the serving runtime host reaches a device. The non-local values are
/// the Link route names (`openbitfun_link::status::MeshRoute`).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FleetRouteKind {
    /// The serving runtime host itself.
    Local,
    DirectLan,
    DirectIpv4,
    DirectIpv6,
    RelayedServer,
    RelayedPeer,
    #[default]
    #[serde(other)]
    Unknown,
}

impl FleetRouteKind {
    pub const fn is_relayed(self) -> bool {
        matches!(self, Self::RelayedServer | Self::RelayedPeer)
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FleetWorkspaceKind {
    Local,
    /// Runs on the SSH host named by `sshHost`, driven by the device that
    /// holds the SSH profile.
    RemoteSsh,
    Assistant,
    #[default]
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FleetSessionStatus {
    #[default]
    Idle,
    Running,
    /// Blocked on a prompt (permission or question).
    Waiting,
    Error,
    #[serde(other)]
    Unknown,
}

/// Where a session came from when it was not started by a user in a UI.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FleetSessionOrigin {
    Dispatch,
    Bot,
    #[serde(other)]
    Unknown,
}

#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize,
)]
#[serde(rename_all = "snake_case")]
pub enum FleetPromptKind {
    Permission,
    Question,
    #[default]
    #[serde(other)]
    Unknown,
}

/// Fleet hello answer per origin.
/// Where an answer to a prompt goes: the owner's runtime (`respond_permission`
/// / `submit_user_answers` through `fleet_call`), or the permission mailbox of
/// the Detached Dispatch job named by `jobId`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FleetAnswerRoute {
    #[default]
    Runtime,
    Dispatch,
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FleetCursorState {
    Resumed,
    Dropped,
    #[default]
    #[serde(other)]
    Unknown,
}

// ---------------------------------------------------------------------------
// Navigator (`fleet_navigator`)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FleetDeviceRoute {
    #[serde(deserialize_with = "null_default")]
    pub kind: FleetRouteKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latency_ms: Option<u32>,
    /// The device that relays traffic (`relayed_peer` only).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub relay_via: Option<String>,
}

/// One gated action: whether it is allowed, and the reason code when not.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FleetActionGate {
    #[serde(deserialize_with = "null_default")]
    pub allowed: bool,
    /// A stable snake_case code the UI localizes; set when not allowed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FleetDeviceActions {
    #[serde(deserialize_with = "null_default")]
    pub create_workspace: FleetActionGate,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FleetSession {
    #[serde(deserialize_with = "null_default")]
    pub device_id: String,
    #[serde(deserialize_with = "null_default")]
    pub workspace_id: String,
    #[serde(deserialize_with = "null_default")]
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_session_id: Option<String>,
    #[serde(deserialize_with = "null_default")]
    pub title: String,
    #[serde(deserialize_with = "null_default")]
    pub agent_type: String,
    #[serde(deserialize_with = "null_default")]
    pub status: FleetSessionStatus,
    #[serde(deserialize_with = "null_default")]
    pub unread: bool,
    #[serde(deserialize_with = "null_default")]
    pub needs_attention: bool,
    #[serde(deserialize_with = "null_default")]
    pub last_activity_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin: Option<FleetSessionOrigin>,
}

impl FleetSession {
    /// Whether the session is kept beyond the per-workspace recency window.
    pub fn is_pinned_by_activity(&self) -> bool {
        self.unread
            || self.needs_attention
            || matches!(
                self.status,
                FleetSessionStatus::Running | FleetSessionStatus::Waiting
            )
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FleetWorkspace {
    #[serde(deserialize_with = "null_default")]
    pub device_id: String,
    #[serde(deserialize_with = "null_default")]
    pub workspace_id: String,
    #[serde(deserialize_with = "null_default")]
    pub name: String,
    /// POSIX, on every client OS.
    #[serde(deserialize_with = "null_default")]
    pub root_path: String,
    #[serde(deserialize_with = "null_default")]
    pub kind: FleetWorkspaceKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ssh_host: Option<String>,
    /// Saved remote connection id for an SSH/Docker/WSL workspace.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connection_id: Option<String>,
    /// Display name of the saved remote connection.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connection_name: Option<String>,
    /// The remote link phase of an SSH workspace (owner's wire value).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub link_state: Option<String>,
    /// The workspace the owning host has selected itself.
    #[serde(deserialize_with = "null_default")]
    pub is_host_current: bool,
    /// Whether this assistant workspace holds the device's primary assistant role.
    #[serde(
        default,
        deserialize_with = "null_default",
        skip_serializing_if = "std::ops::Not::not"
    )]
    pub is_primary_assistant: bool,
    #[serde(deserialize_with = "null_default")]
    pub sessions: Vec<FleetSession>,
    /// Top-level sessions the owner holds for this workspace.
    #[serde(deserialize_with = "null_default")]
    pub session_total: u32,
    /// More sessions exist than are listed; page them from the owner.
    #[serde(deserialize_with = "null_default")]
    pub has_more: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FleetDevice {
    #[serde(deserialize_with = "null_default")]
    pub device_id: String,
    #[serde(deserialize_with = "null_default")]
    pub name: String,
    #[serde(deserialize_with = "null_default")]
    pub host_kind: FleetHostKind,
    /// The machine the client itself runs on (native desktop, owner scope).
    #[serde(deserialize_with = "null_default")]
    pub is_client_device: bool,
    #[serde(deserialize_with = "null_default")]
    pub state: FleetDeviceState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state_reason: Option<String>,
    #[serde(deserialize_with = "null_default")]
    pub as_of_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    /// `null` for a host without the fleet layer.
    pub fleet_protocol: Option<u32>,
    #[serde(deserialize_with = "null_default")]
    pub host_capabilities: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub route: Option<FleetDeviceRoute>,
    #[serde(deserialize_with = "null_default")]
    pub actions: FleetDeviceActions,
    #[serde(deserialize_with = "null_default")]
    pub workspaces: Vec<FleetWorkspace>,
    #[serde(deserialize_with = "null_default")]
    pub sessions_truncated: bool,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FleetTotals {
    #[serde(deserialize_with = "null_default")]
    pub running: u32,
    #[serde(deserialize_with = "null_default")]
    pub waiting: u32,
    #[serde(deserialize_with = "null_default")]
    pub unread: u32,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FleetNavigatorRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub since_revision: Option<u64>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FleetNavigator {
    #[serde(deserialize_with = "null_default")]
    pub revision: u64,
    /// `devices` is the whole fleet (replace), not a delta.
    #[serde(deserialize_with = "null_default")]
    pub full: bool,
    #[serde(deserialize_with = "null_default")]
    pub devices: Vec<FleetDevice>,
    #[serde(deserialize_with = "null_default")]
    pub removed_device_ids: Vec<String>,
    /// Always over the whole fleet, also in a delta.
    #[serde(deserialize_with = "null_default")]
    pub totals: FleetTotals,
}

// ---------------------------------------------------------------------------
// Prompts (`fleet_prompts`)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FleetPrompt {
    #[serde(deserialize_with = "null_default")]
    pub device_id: String,
    #[serde(deserialize_with = "null_default")]
    pub workspace_id: String,
    #[serde(deserialize_with = "null_default")]
    pub session_id: String,
    #[serde(deserialize_with = "null_default")]
    pub kind: FleetPromptKind,
    #[serde(deserialize_with = "null_default")]
    pub prompt_id: String,
    #[serde(deserialize_with = "null_default")]
    pub revision: u64,
    #[serde(deserialize_with = "null_default")]
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_name: Option<String>,
    /// At most `MAX_PROMPT_PAYLOAD_BYTES` of JSON; otherwise omitted and
    /// `payloadTruncated` is set (fetch it from the owner).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payload: Option<Value>,
    #[serde(deserialize_with = "null_default")]
    pub payload_truncated: bool,
    #[serde(deserialize_with = "null_default")]
    pub answerable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unanswerable_reason: Option<String>,
    /// `runtime` when absent (every prompt before this field existed).
    #[serde(deserialize_with = "null_default")]
    pub answer_route: FleetAnswerRoute,
    /// The Detached Dispatch job of a `dispatch`-routed prompt.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub job_id: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FleetPromptsRequest {}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FleetPromptsResponse {
    #[serde(deserialize_with = "null_default")]
    pub revision: u64,
    #[serde(deserialize_with = "null_default")]
    pub prompts: Vec<FleetPrompt>,
}

// ---------------------------------------------------------------------------
// Calls, interest, events (`fleet_call`, `fleet_subscribe`, `fleet_events`)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FleetCallRequest {
    /// The device that should execute; resolved from the index when absent
    /// and unambiguous.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    #[serde(deserialize_with = "null_default")]
    pub command: String,
    /// Passed to the target verbatim (normally `{request: …}`).
    #[serde(deserialize_with = "null_default")]
    pub args: Value,
}

/// What a client follows on one device: an open session, terminal or file
/// view. `all` keeps the device's whole event stream.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FleetFollow {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sessions: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub terminals: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub all: Option<bool>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FleetSubscribeRequest {
    #[serde(deserialize_with = "null_default")]
    pub follow: BTreeMap<String, FleetFollow>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FleetSubscribeResponse {
    #[serde(deserialize_with = "null_default")]
    pub applied: bool,
}

/// One origin's position: its backend instance and the last seq delivered.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FleetOriginCursor {
    #[serde(deserialize_with = "null_default")]
    pub instance_id: String,
    #[serde(deserialize_with = "null_default")]
    pub seq: u64,
}

/// The vector cursor: one position per origin device. Events are ordered
/// within an origin only; there is no cross-origin order.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct FleetCursor(pub BTreeMap<String, FleetOriginCursor>);

impl FleetCursor {
    /// Whether a frame was already delivered: same instance and not newer.
    pub fn has_seen(&self, origin: &str, origin_instance: &str, seq: u64) -> bool {
        self.0
            .get(origin)
            .is_some_and(|cursor| cursor.instance_id == origin_instance && seq <= cursor.seq)
    }

    /// Advance an origin after delivering a frame. A new instance restarts
    /// the origin; an older seq of the same instance never moves it back.
    pub fn advance(&mut self, origin: &str, origin_instance: &str, seq: u64) {
        let entry = self.0.entry(origin.to_string()).or_default();
        if entry.instance_id != origin_instance {
            entry.instance_id = origin_instance.to_string();
            entry.seq = seq;
        } else if seq > entry.seq {
            entry.seq = seq;
        }
    }
}

/// The `fleet` member of an OBP hello. Old clients never send it.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FleetHello {
    #[serde(deserialize_with = "null_default")]
    pub protocol: u32,
    #[serde(deserialize_with = "null_default")]
    pub cursor: FleetCursor,
}

/// The `fleet` member of the hello answer.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FleetHelloAnswer {
    #[serde(deserialize_with = "null_default")]
    pub protocol: u32,
    #[serde(deserialize_with = "null_default")]
    pub cursor_state: BTreeMap<String, FleetCursorState>,
}

/// The `events` member of an OBP hello: an event-name prefix filter. The
/// index-only subscription between runtime hosts sends `["fleet://"]`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FleetEventFilter {
    #[serde(deserialize_with = "null_default")]
    pub prefixes: Vec<String>,
}

/// One event frame of a fleet stream; the payload is the origin's, unchanged.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FleetEventFrame {
    #[serde(deserialize_with = "null_default")]
    pub origin: String,
    #[serde(deserialize_with = "null_default")]
    pub origin_instance: String,
    /// The origin's own seq.
    #[serde(deserialize_with = "null_default")]
    pub seq: u64,
    #[serde(deserialize_with = "null_default")]
    pub event: String,
    #[serde(deserialize_with = "null_default")]
    pub payload: Value,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FleetEventsRequest {
    #[serde(deserialize_with = "null_default")]
    pub cursor: FleetCursor,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wait_ms: Option<u64>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FleetEventsResponse {
    #[serde(deserialize_with = "null_default")]
    pub events: Vec<FleetEventFrame>,
}

/// Payload of `backend://events-dropped`: re-hydrate that origin only.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FleetEventsDropped {
    #[serde(deserialize_with = "null_default")]
    pub origin: String,
    #[serde(deserialize_with = "null_default")]
    pub reason: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resume_seq: Option<u64>,
}

/// Payload of `fleet://digest-changed` (owner hub).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FleetDigestChanged {
    #[serde(deserialize_with = "null_default")]
    pub revision: u64,
}

/// Payload of `fleet://index-changed`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FleetIndexChanged {
    #[serde(deserialize_with = "null_default")]
    pub revision: u64,
    #[serde(deserialize_with = "null_default")]
    pub device_ids: Vec<String>,
}

/// Payload of `fleet://prompts-changed`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FleetPromptsChanged {
    #[serde(deserialize_with = "null_default")]
    pub revision: u64,
    #[serde(deserialize_with = "null_default")]
    pub device_id: String,
}

// ---------------------------------------------------------------------------
// Owner verbs (`fleet_v1`): `fleet_digest`, `fleet_replay`
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FleetDigestRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub since_revision: Option<u64>,
    /// The owner instance the caller's `sinceRevision` belongs to; a
    /// different instance answers a full snapshot.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instance_id: Option<String>,
}

/// What a delta digest removed since `sinceRevision`. Absent in a full
/// snapshot (a full snapshot replaces the partition).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FleetDigestRemovals {
    #[serde(deserialize_with = "null_default")]
    pub workspace_ids: Vec<String>,
    #[serde(deserialize_with = "null_default")]
    pub session_ids: Vec<String>,
    #[serde(deserialize_with = "null_default")]
    pub prompt_ids: Vec<String>,
}

impl FleetDigestRemovals {
    pub fn is_empty(&self) -> bool {
        self.workspace_ids.is_empty() && self.session_ids.is_empty() && self.prompt_ids.is_empty()
    }
}

/// One owner's summary partition. `workspaces[].sessions` is empty here;
/// sessions travel in `sessions` and are grouped by the projection.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FleetDigest {
    #[serde(deserialize_with = "null_default")]
    pub device_id: String,
    #[serde(deserialize_with = "null_default")]
    pub instance_id: String,
    #[serde(deserialize_with = "null_default")]
    pub revision: u64,
    #[serde(deserialize_with = "null_default")]
    pub full: bool,
    #[serde(deserialize_with = "null_default")]
    pub workspaces: Vec<FleetWorkspace>,
    #[serde(deserialize_with = "null_default")]
    pub sessions: Vec<FleetSession>,
    #[serde(deserialize_with = "null_default")]
    pub prompts: Vec<FleetPrompt>,
    #[serde(skip_serializing_if = "FleetDigestRemovals::is_empty")]
    pub removed: FleetDigestRemovals,
    /// The owner dropped sessions to stay within the partition bound.
    #[serde(deserialize_with = "null_default")]
    pub sessions_truncated: bool,
    /// The owner's configured models (`models::FleetModel`), in every answer
    /// (full or delta). `None` from a build before the account-wide model
    /// catalog: its models are not offered to other devices.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub models: Option<Vec<super::models::FleetModel>>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FleetReplayRequest {
    #[serde(deserialize_with = "null_default")]
    pub after_seq: u64,
    #[serde(deserialize_with = "null_default")]
    pub instance_id: String,
    #[serde(deserialize_with = "null_default")]
    pub max: u32,
}

/// One replayed owner event (the owner's own seq).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FleetReplayEvent {
    #[serde(deserialize_with = "null_default")]
    pub seq: u64,
    #[serde(deserialize_with = "null_default")]
    pub event: String,
    #[serde(deserialize_with = "null_default")]
    pub payload: Value,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FleetReplayResponse {
    #[serde(deserialize_with = "null_default")]
    pub instance_id: String,
    #[serde(deserialize_with = "null_default")]
    pub events: Vec<FleetReplayEvent>,
    /// The requested history is gone (ring overrun or another instance):
    /// the client is sent `backend://events-dropped` for this origin.
    #[serde(deserialize_with = "null_default")]
    pub history_gone: bool,
}

// ---------------------------------------------------------------------------
// UI bundle (`fleet_ui_bundle`)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FleetUiBundleRequest {}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FleetUiBundleResponse {
    /// The owner's manifest, passed through unchanged (the browser
    /// recomputes the bundle id from it).
    #[serde(deserialize_with = "null_default")]
    pub manifest: Value,
    #[serde(deserialize_with = "null_default")]
    pub bundle_id: String,
    #[serde(deserialize_with = "null_default")]
    pub owner_device_id: String,
    /// Online devices that hold the same bundle.
    #[serde(deserialize_with = "null_default")]
    pub holders: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn navigator_serializes_the_shared_contract_in_camel_case() {
        let navigator = FleetNavigator {
            revision: 7,
            full: true,
            devices: vec![FleetDevice {
                device_id: "d1".into(),
                name: "Laptop".into(),
                host_kind: FleetHostKind::Desktop,
                is_client_device: true,
                state: FleetDeviceState::Online,
                as_of_ms: 10,
                version: Some("0.9.0".into()),
                fleet_protocol: Some(1),
                host_capabilities: vec!["user_question_response".into()],
                route: Some(FleetDeviceRoute {
                    kind: FleetRouteKind::RelayedPeer,
                    latency_ms: Some(42),
                    relay_via: Some("d2".into()),
                }),
                actions: FleetDeviceActions {
                    create_workspace: FleetActionGate {
                        allowed: true,
                        reason: None,
                    },
                },
                workspaces: vec![FleetWorkspace {
                    device_id: "d1".into(),
                    workspace_id: "w1".into(),
                    name: "proj".into(),
                    root_path: "/home/u/proj".into(),
                    kind: FleetWorkspaceKind::RemoteSsh,
                    ssh_host: Some("box".into()),
                    connection_id: Some("conn-box".into()),
                    connection_name: Some("Box".into()),
                    link_state: Some("connected".into()),
                    is_host_current: true,
                    is_primary_assistant: false,
                    sessions: vec![FleetSession {
                        device_id: "d1".into(),
                        workspace_id: "w1".into(),
                        session_id: "s1".into(),
                        parent_session_id: None,
                        title: "t".into(),
                        agent_type: "agentic".into(),
                        status: FleetSessionStatus::Waiting,
                        unread: true,
                        needs_attention: true,
                        last_activity_ms: 5,
                        origin: Some(FleetSessionOrigin::Dispatch),
                    }],
                    session_total: 1,
                    has_more: false,
                }],
                sessions_truncated: false,
                ..FleetDevice::default()
            }],
            removed_device_ids: vec![],
            totals: FleetTotals {
                running: 0,
                waiting: 1,
                unread: 1,
            },
        };
        let wire = serde_json::to_value(&navigator).unwrap();
        assert_eq!(
            wire,
            json!({
                "revision": 7,
                "full": true,
                "devices": [{
                    "deviceId": "d1",
                    "name": "Laptop",
                    "hostKind": "desktop",
                    "isClientDevice": true,
                    "state": "online",
                    "asOfMs": 10,
                    "version": "0.9.0",
                    "fleetProtocol": 1,
                    "hostCapabilities": ["user_question_response"],
                    "route": {"kind": "relayed_peer", "latencyMs": 42, "relayVia": "d2"},
                    "actions": {"createWorkspace": {"allowed": true}},
                    "workspaces": [{
                        "deviceId": "d1",
                        "workspaceId": "w1",
                        "name": "proj",
                        "rootPath": "/home/u/proj",
                        "kind": "remote_ssh",
                        "sshHost": "box",
                        "connectionId": "conn-box",
                        "connectionName": "Box",
                        "linkState": "connected",
                        "isHostCurrent": true,
                        "sessions": [{
                            "deviceId": "d1",
                            "workspaceId": "w1",
                            "sessionId": "s1",
                            "title": "t",
                            "agentType": "agentic",
                            "status": "waiting",
                            "unread": true,
                            "needsAttention": true,
                            "lastActivityMs": 5,
                            "origin": "dispatch"
                        }],
                        "sessionTotal": 1,
                        "hasMore": false
                    }],
                    "sessionsTruncated": false
                }],
                "removedDeviceIds": [],
                "totals": {"running": 0, "waiting": 1, "unread": 1}
            })
        );
        let back: FleetNavigator = serde_json::from_value(wire).unwrap();
        assert_eq!(back, navigator);
    }

    #[test]
    fn a_host_without_the_fleet_layer_serializes_fleet_protocol_as_null() {
        let device = FleetDevice {
            device_id: "old".into(),
            state: FleetDeviceState::UpdateRequired,
            state_reason: Some("relay_only".into()),
            ..FleetDevice::default()
        };
        let wire = serde_json::to_value(&device).unwrap();
        assert_eq!(wire["fleetProtocol"], Value::Null);
        assert_eq!(wire["state"], "update_required");
        assert_eq!(wire["stateReason"], "relay_only");
        assert!(wire.get("route").is_none());
    }

    #[test]
    fn legacy_and_sparse_payloads_read_with_defaults() {
        // A minimal device from an older writer: most fields missing, some null.
        let device: FleetDevice = serde_json::from_value(json!({
            "deviceId": "d1",
            "name": null,
            "workspaces": null,
            "hostCapabilities": null,
            "actions": null
        }))
        .unwrap();
        assert_eq!(device.device_id, "d1");
        assert_eq!(device.name, "");
        assert!(device.workspaces.is_empty());
        assert_eq!(device.state, FleetDeviceState::Unknown);
        assert_eq!(device.host_kind, FleetHostKind::Unknown);
        assert!(!device.actions.create_workspace.allowed);
        assert_eq!(device.fleet_protocol, None);

        let navigator: FleetNavigator = serde_json::from_value(json!({})).unwrap();
        assert_eq!(navigator, FleetNavigator::default());

        let session: FleetSession =
            serde_json::from_value(json!({"sessionId": "s", "status": null})).unwrap();
        assert_eq!(session.status, FleetSessionStatus::Idle);
        assert_eq!(session.origin, None);

        let digest: FleetDigest = serde_json::from_value(json!({
            "deviceId": "d",
            "instanceId": "i",
            "revision": 3,
            "full": true,
            "workspaces": [{"workspaceId": "w"}, {"workspaceId": "a", "kind": "assistant", "isPrimaryAssistant": null}],
            "sessions": [{"sessionId": "s", "workspaceId": "w"}]
        }))
        .unwrap();
        assert!(digest.prompts.is_empty());
        assert!(digest.removed.is_empty());
        assert!(!digest.sessions_truncated);
        assert!(!digest.workspaces[0].is_primary_assistant);
        assert!(!digest.workspaces[1].is_primary_assistant);

        let primary = FleetWorkspace {
            workspace_id: "asst-1".into(),
            kind: FleetWorkspaceKind::Assistant,
            is_primary_assistant: true,
            ..FleetWorkspace::default()
        };
        let wire = serde_json::to_value(&primary).unwrap();
        assert_eq!(wire["isPrimaryAssistant"], true);
        let back: FleetWorkspace = serde_json::from_value(wire).unwrap();
        assert!(back.is_primary_assistant);
        let non_primary = FleetWorkspace {
            workspace_id: "asst-2".into(),
            kind: FleetWorkspaceKind::Assistant,
            ..FleetWorkspace::default()
        };
        assert!(serde_json::to_value(&non_primary)
            .unwrap()
            .get("isPrimaryAssistant")
            .is_none());
    }

    #[test]
    fn unknown_fields_and_enum_values_from_newer_writers_are_tolerated() {
        let device: FleetDevice = serde_json::from_value(json!({
            "deviceId": "d1",
            "hostKind": "watch",
            "state": "hibernating",
            "route": {"kind": "satellite", "hops": 3},
            "futureField": {"a": 1},
            "workspaces": [{
                "workspaceId": "w",
                "kind": "container",
                "sessions": [{
                    "sessionId": "s",
                    "status": "paused",
                    "origin": "schedule",
                    "newFlag": true
                }]
            }]
        }))
        .unwrap();
        assert_eq!(device.host_kind, FleetHostKind::Unknown);
        assert_eq!(device.state, FleetDeviceState::Unknown);
        assert_eq!(device.route.unwrap().kind, FleetRouteKind::Unknown);
        let workspace = &device.workspaces[0];
        assert_eq!(workspace.kind, FleetWorkspaceKind::Unknown);
        assert_eq!(workspace.sessions[0].status, FleetSessionStatus::Unknown);
        assert_eq!(
            workspace.sessions[0].origin,
            Some(FleetSessionOrigin::Unknown)
        );

        let prompt: FleetPrompt = serde_json::from_value(json!({
            "promptId": "p",
            "kind": "approval_v2",
            "payload": {"x": 1}
        }))
        .unwrap();
        assert_eq!(prompt.kind, FleetPromptKind::Unknown);
        assert_eq!(prompt.payload, Some(json!({"x": 1})));

        let cloud: FleetDevice =
            serde_json::from_value(json!({"deviceId": "cloud-1", "hostKind": "cloud"})).unwrap();
        assert_eq!(cloud.host_kind, FleetHostKind::Cloud);
        let routed: FleetPrompt = serde_json::from_value(json!({
            "promptId": "p",
            "answerRoute": "dispatch",
            "jobId": "job-1"
        }))
        .unwrap();
        assert_eq!(routed.answer_route, FleetAnswerRoute::Dispatch);
        assert_eq!(routed.job_id.as_deref(), Some("job-1"));
        let wire = serde_json::to_value(&routed).unwrap();
        assert_eq!(wire["answerRoute"], "dispatch");
        assert_eq!(wire["jobId"], "job-1");
        let newer: FleetPrompt =
            serde_json::from_value(json!({"promptId": "p", "answerRoute": "carrier_pigeon"}))
                .unwrap();
        assert_eq!(newer.answer_route, FleetAnswerRoute::Unknown);

        let answer: FleetHelloAnswer = serde_json::from_value(json!({
            "protocol": 2,
            "cursorState": {"d1": "resumed", "d2": "rewound"}
        }))
        .unwrap();
        assert_eq!(answer.cursor_state["d1"], FleetCursorState::Resumed);
        assert_eq!(answer.cursor_state["d2"], FleetCursorState::Unknown);
    }

    #[test]
    fn requests_take_the_shared_contract_shape() {
        let call: FleetCallRequest = serde_json::from_value(json!({
            "target": "d2",
            "command": "start_dialog_turn",
            "args": {"request": {"sessionId": "s"}}
        }))
        .unwrap();
        assert_eq!(call.target.as_deref(), Some("d2"));
        assert_eq!(call.args["request"]["sessionId"], "s");
        let untargeted: FleetCallRequest = serde_json::from_value(json!({"command": "x"})).unwrap();
        assert_eq!(untargeted.target, None);
        assert_eq!(untargeted.args, Value::Null);

        let subscribe: FleetSubscribeRequest = serde_json::from_value(json!({
            "follow": {"d1": {"sessions": ["s1"]}, "d2": {"all": true}}
        }))
        .unwrap();
        assert_eq!(
            subscribe.follow["d1"].sessions.as_deref(),
            Some(&["s1".to_string()][..])
        );
        assert_eq!(subscribe.follow["d2"].all, Some(true));

        let hello: FleetHello = serde_json::from_value(json!({
            "protocol": 1,
            "cursor": {"d1": {"instanceId": "i1", "seq": 9}}
        }))
        .unwrap();
        assert_eq!(hello.cursor.0["d1"].seq, 9);
        assert_eq!(
            serde_json::to_value(&hello).unwrap(),
            json!({"protocol": 1, "cursor": {"d1": {"instanceId": "i1", "seq": 9}}})
        );

        let digest = FleetDigestRequest {
            since_revision: None,
            instance_id: None,
        };
        assert_eq!(serde_json::to_value(&digest).unwrap(), json!({}));
        let replay: FleetReplayRequest =
            serde_json::from_value(json!({"afterSeq": 4, "instanceId": "i", "max": 100})).unwrap();
        assert_eq!(replay.after_seq, 4);
    }

    #[test]
    fn digest_round_trips_and_omits_empty_removals() {
        let digest = FleetDigest {
            device_id: "d".into(),
            instance_id: "i".into(),
            revision: 2,
            full: false,
            removed: FleetDigestRemovals {
                session_ids: vec!["gone".into()],
                ..FleetDigestRemovals::default()
            },
            ..FleetDigest::default()
        };
        let wire = serde_json::to_value(&digest).unwrap();
        assert_eq!(wire["removed"]["sessionIds"], json!(["gone"]));
        assert_eq!(serde_json::from_value::<FleetDigest>(wire).unwrap(), digest);
        let full = FleetDigest {
            full: true,
            ..FleetDigest::default()
        };
        assert!(serde_json::to_value(&full)
            .unwrap()
            .get("removed")
            .is_none());
    }

    #[test]
    fn cursor_dedups_per_origin_and_restarts_on_a_new_instance() {
        let mut cursor = FleetCursor::default();
        assert!(!cursor.has_seen("a", "i1", 1));
        cursor.advance("a", "i1", 5);
        assert!(cursor.has_seen("a", "i1", 5));
        assert!(cursor.has_seen("a", "i1", 3));
        assert!(!cursor.has_seen("a", "i1", 6));
        assert!(
            !cursor.has_seen("a", "i2", 1),
            "a new instance is never seen"
        );
        assert!(!cursor.has_seen("b", "i1", 1), "origins are independent");
        cursor.advance("a", "i1", 2);
        assert_eq!(cursor.0["a"].seq, 5, "an older seq never moves back");
        cursor.advance("a", "i2", 1);
        assert_eq!(cursor.0["a"].instance_id, "i2");
        assert_eq!(cursor.0["a"].seq, 1);
    }

    #[test]
    fn cached_index_from_an_older_build_round_trips() {
        // A partition cache an older build wrote: no `removed`, no
        // `sessionsTruncated`, a prompt without `answerable`.
        let legacy = json!({
            "deviceId": "d",
            "instanceId": "i",
            "revision": 11,
            "full": true,
            "workspaces": [{"deviceId": "d", "workspaceId": "w", "name": "n", "rootPath": "/r", "kind": "local", "isHostCurrent": false, "sessions": [], "sessionTotal": 0, "hasMore": false}],
            "sessions": [],
            "prompts": [{"promptId": "p", "kind": "permission", "revision": 1}]
        });
        let digest: FleetDigest = serde_json::from_value(legacy).unwrap();
        assert_eq!(digest.workspaces[0].connection_id, None);
        assert_eq!(digest.workspaces[0].connection_name, None);
        assert!(!digest.prompts[0].answerable);
        assert_eq!(digest.prompts[0].answer_route, FleetAnswerRoute::Runtime);
        assert_eq!(digest.prompts[0].job_id, None);
        let rewritten = serde_json::to_value(&digest).unwrap();
        let again: FleetDigest = serde_json::from_value(rewritten).unwrap();
        assert_eq!(again, digest);
    }

    #[test]
    fn device_states_order_and_gate_calls() {
        assert!(FleetDeviceState::Online.display_rank() < FleetDeviceState::Offline.display_rank());
        assert!(FleetDeviceState::Online.accepts_calls());
        assert!(FleetDeviceState::Stale.accepts_calls());
        assert!(!FleetDeviceState::Offline.accepts_calls());
        assert!(!FleetDeviceState::Unreachable.accepts_calls());
        assert!(!FleetDeviceState::UpdateRequired.accepts_calls());
        assert!(FleetRouteKind::RelayedServer.is_relayed());
        assert!(!FleetRouteKind::DirectLan.is_relayed());
    }
}

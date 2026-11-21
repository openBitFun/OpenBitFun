//! Single source of truth for the detached-dispatch wire contract.
//!
//! The target CLI advertises these capabilities, the controller requires
//! them, and the Web UI pins its own copy against this file in
//! `dispatch.contract.test.ts`. A protocol evolution is one edit here plus
//! that cross-language test — never a hunt across advertise/require lists.

use serde::{Deserialize, Serialize};

pub const DISPATCH_PROTOCOL_VERSION: u32 = 6;

/// Capabilities every v6 target advertises unconditionally.
pub const DISPATCH_BASE_TARGET_CAPABILITIES: &[&str] = &[
    "product_identity",
    "persistent_jobs",
    "cursor_events",
    "workspace_serialization",
    "approval_auto",
    "approval_reject_and_report",
    "approval_remote",
    "frontend_event_projection",
    "append_message",
    "event_log_completeness",
    // Git-worktree delivery. A target without these cannot be provisioned at
    // all — there is no snapshot fallback left — so controllers fail
    // preflight rather than degrade.
    "workspace_git_worktree",
    "workspace_git_bundle_upload",
    "workspace_git_sync",
    // A target may share the same package version while predating the
    // dispatch entrypoint's early CLI-profile selection. Such a binary can
    // accept a job but every detached worker then fails before execution.
    // Advertise the behavioral fix explicitly so controllers fail closed.
    "dispatch_worker_cli_profile",
    // v4: follow-up turns may override model and approval policy.
    "per_turn_options",
    // v4: read-only persisted-state queries (usage report) and compact turns
    // delivered through the continue mailbox.
    "session_query",
    // v4: inline image attachments on submit and follow-up turns.
    "inline_attachments",
    // v5: target-owned canonical reasoning catalog and per-turn preset selection.
    "reasoning_presets",
];

/// Advertised only where detached workers can run (Linux/macOS), and
/// required by every controller: a target that cannot detach cannot dispatch.
pub const DISPATCH_DETACHED_WORKER_CAPABILITY: &str = "detached_worker";

/// Optional runtime capabilities for copying explicit subscription bindings.
/// Credentials and account slots remain owned by the target. These do not imply
/// account-management commands, and ordinary API-key dispatch does not require them.
pub const DISPATCH_SUBSCRIPTION_ACCOUNT_BINDINGS_CAPABILITY: &str =
    "subscription_account_bindings_v1";
pub const DISPATCH_SUBSCRIPTION_ACCOUNT_FAILOVER_CAPABILITY: &str =
    "subscription_account_failover_v1";
pub const DISPATCH_SUBSCRIPTION_PROVIDER_ACCOUNTS_CAPABILITY: &str =
    "subscription_provider_accounts_v1";
pub const DISPATCH_MODEL_CHANNEL_ROUTING_CAPABILITY: &str = "model_channel_routing_v1";
pub const DISPATCH_SUBSCRIPTION_ACCOUNT_CAPABILITIES: &[&str] = &[
    DISPATCH_SUBSCRIPTION_ACCOUNT_BINDINGS_CAPABILITY,
    DISPATCH_SUBSCRIPTION_ACCOUNT_FAILOVER_CAPABILITY,
    DISPATCH_SUBSCRIPTION_PROVIDER_ACCOUNTS_CAPABILITY,
];

/// Setup-audit action every target has accepted since the audit channel
/// existed. A target rejects a submission carrying any action it does not
/// know, so this list — not the controller's journal — bounds what may be
/// forwarded to an arbitrary target.
pub const DISPATCH_BASE_SETUP_AUDIT_ACTIONS: &[&str] = &["cli-install"];

/// Audit action for an automatic model-configuration push performed while
/// preparing a submission.
pub const DISPATCH_MODEL_SYNC_SETUP_AUDIT_ACTION: &str = "model-sync";

/// Optional capability: the target accepts [`DISPATCH_MODEL_SYNC_SETUP_AUDIT_ACTION`]
/// rows. Deliberately outside [`dispatch_required_target_capabilities`]: an
/// older CLI still runs the job perfectly well, it just cannot render the
/// controller's model-sync record, so the controller drops those rows instead
/// of failing an otherwise valid submission.
pub const DISPATCH_SETUP_AUDIT_MODEL_SYNC_CAPABILITY: &str = "setup_audit_model_sync";

/// Optional read-only access to files in the target-owned job workspace.
/// Older targets can still execute, resume, and sync jobs without this query.
pub const DISPATCH_READ_FILE_CAPABILITY: &str = "query_file_content";

/// Optional binary output transfer. Kept separate from text queries so older
/// targets keep executing jobs and serving their existing text previews.
pub const DISPATCH_FILE_CHUNKS_CAPABILITY: &str = "query_file_chunks_v1";
/// Fits the bounded encrypted device envelope, including base64 and JSON overhead.
pub const DISPATCH_FILE_CHUNK_MAX_BYTES: u64 = 256 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DispatchFileChunkRequest {
    pub offset: u64,
    pub limit: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_revision: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DispatchFileChunk {
    pub file_path: String,
    pub name: String,
    pub mime_type: String,
    pub total_size: u64,
    pub offset: u64,
    pub chunk_size: u64,
    pub content_base64: String,
    pub revision: String,
}

/// Optional: the target resolves a job's source itself
/// (`dispatch_target_workspace_provision_source`): one of its own workspaces
/// by fleet workspace id, or a Git remote it fetches with its own credentials,
/// pinned to a commit. Never an arbitrary path. Probe also accepts
/// `workspaceId` once this is advertised.
pub const DISPATCH_WORKSPACE_TARGET_SOURCE_CAPABILITY: &str = "workspace_target_source_v1";
/// Optional: `query` kind `resultSummary` (branch, commits and `git diff
/// --numstat` of the job worktree, never file contents).
pub const DISPATCH_QUERY_RESULT_SUMMARY_CAPABILITY: &str = "query_result_summary_v1";
/// Optional: `status` with `summaryOnly: true` answers state and prompt
/// counts without the event log.
pub const DISPATCH_STATUS_SUMMARY_ONLY_CAPABILITY: &str = "status_summary_only_v1";
/// Optional: `submit` takes a `submitter` tag and `list` filters by it.
pub const DISPATCH_JOB_SUBMITTER_CAPABILITY: &str = "job_submitter_v1";
/// The target command of the source-resolving provision verb.
pub const DISPATCH_TARGET_PROVISION_SOURCE_COMMAND: &str =
    "dispatch_target_workspace_provision_source";
/// The superagent's target capabilities, in advertisement order. None is
/// required by an ordinary controller: older targets keep their working path,
/// and a controller that needs one checks for it before sending the new field.
pub const DISPATCH_SUPERAGENT_TARGET_CAPABILITIES: &[&str] = &[
    DISPATCH_WORKSPACE_TARGET_SOURCE_CAPABILITY,
    DISPATCH_QUERY_RESULT_SUMMARY_CAPABILITY,
    DISPATCH_STATUS_SUMMARY_ONLY_CAPABILITY,
    DISPATCH_JOB_SUBMITTER_CAPABILITY,
];
/// Optional (dispatch phase two): `dispatch_target_workspace_provision_source`
/// accepts a `job` source — another account device's job result, which the
/// target's host pulls over Link through that device's full-history
/// `workspace-sync` bundle. Advertised by the *host* (desktop or CLI), not by
/// the bare CLI runner, because only a host holds the Link connection that
/// dials the source device; a host adds it when its runner reports
/// [`DISPATCH_PEER_BUNDLE_CAPABILITY`].
pub const DISPATCH_WORKSPACE_PEER_IMPORT_CAPABILITY: &str = "workspace_peer_import_v1";
/// Runner fact behind peer import: `workspace-sync {fullHistory: true}`
/// exports a job branch with its whole history, and the store imports such a
/// bundle (`peer-import-commit`). Every peer-import source must advertise it.
pub const DISPATCH_PEER_BUNDLE_CAPABILITY: &str = "workspace_peer_bundle_v1";
/// Optional: `dispatch_target_workspace_publish` pushes a job branch to the
/// job workspace's remote, never forced, only under `<prefix>/dispatch/*`.
pub const DISPATCH_WORKSPACE_PUBLISH_CAPABILITY: &str = "workspace_publish_v1";
/// The target command of the publish verb.
pub const DISPATCH_TARGET_PUBLISH_COMMAND: &str = "dispatch_target_workspace_publish";
/// Optional: `AskUserQuestion` inside a job lands in the job's question
/// mailbox (status `pendingQuestions`, `answer {answers}`) instead of
/// failing. A controller opts in per job with `submit {userQuestions: true}`;
/// without it the job keeps failing the tool explicitly, because nobody
/// would answer.
pub const DISPATCH_USER_QUESTION_MAILBOX_CAPABILITY: &str = "user_question_mailbox_v1";
/// Files listed in a result summary's diff stat (the rest is counted only).
pub const DISPATCH_RESULT_SUMMARY_MAX_FILES: usize = 50;
/// Bound of the summary text a result summary carries.
pub const DISPATCH_RESULT_SUMMARY_MAX_TEXT_BYTES: usize = 16 * 1024;
/// A submitter tag: 1-32 bytes of `[a-z0-9_-]`.
pub const DISPATCH_SUBMITTER_MAX_BYTES: usize = 32;

/// Validate a submitter tag (shared by controller and target).
pub fn validate_dispatch_submitter(submitter: &str) -> Result<(), String> {
    if submitter.is_empty()
        || submitter.len() > DISPATCH_SUBMITTER_MAX_BYTES
        || !submitter.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'_' | b'-')
        })
    {
        return Err(format!(
            "dispatch submitter must be 1-{DISPATCH_SUBMITTER_MAX_BYTES} bytes of [a-z0-9_-]"
        ));
    }
    Ok(())
}

/// A Git remote URL with any credential it carries removed, safe to report
/// off the device or to persist.
///
/// `scheme://user:token@host/path` loses its userinfo (a bare user name in
/// such a URL is commonly a token too), and an http(s) URL loses its query
/// and fragment, where tokens also travel. scp-like `git@host:path` keeps its
/// user: that is the SSH login, not a secret. Anything that is not a URL is
/// returned unchanged.
pub fn strip_remote_url_credentials(url: &str) -> String {
    let Some(scheme_end) = url.find("://") else {
        return url.to_string();
    };
    let scheme = &url[..scheme_end];
    if scheme.is_empty()
        || !scheme
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'-' | b'.'))
    {
        return url.to_string();
    }
    let rest = &url[scheme_end + 3..];
    let authority_end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let (authority, tail) = rest.split_at(authority_end);
    let host = authority
        .rsplit_once('@')
        .map_or(authority, |(_, host)| host);
    let web = scheme.eq_ignore_ascii_case("http") || scheme.eq_ignore_ascii_case("https");
    let tail = if web {
        tail.split(['?', '#']).next().unwrap_or_default()
    } else {
        tail
    };
    format!("{scheme}://{host}{tail}")
}

/// Whether a target advertising `capabilities` accepts this audit action.
pub fn dispatch_target_accepts_setup_audit_action(action: &str, capabilities: &[&str]) -> bool {
    DISPATCH_BASE_SETUP_AUDIT_ACTIONS.contains(&action)
        || (action == DISPATCH_MODEL_SYNC_SETUP_AUDIT_ACTION
            && capabilities.contains(&DISPATCH_SETUP_AUDIT_MODEL_SYNC_CAPABILITY))
}

/// Every audit action a target of *this* build accepts, used by the target's
/// own request validation.
pub fn dispatch_supported_setup_audit_actions() -> impl Iterator<Item = &'static str> {
    DISPATCH_BASE_SETUP_AUDIT_ACTIONS
        .iter()
        .copied()
        .chain(std::iter::once(DISPATCH_MODEL_SYNC_SETUP_AUDIT_ACTION))
}

/// Everything a controller refuses to submit without: the unconditional set
/// plus the platform-conditional detached worker.
pub fn dispatch_required_target_capabilities() -> impl Iterator<Item = &'static str> {
    DISPATCH_BASE_TARGET_CAPABILITIES
        .iter()
        .copied()
        .chain(std::iter::once(DISPATCH_DETACHED_WORKER_CAPABILITY))
}

/// Why a probed target cannot run a detached job yet. Stable wire codes; the
/// controller surface localizes them and shows `protocolError` as detail.
pub const DISPATCH_NOT_READY_CLI_MISSING: &str = "cli_missing";
pub const DISPATCH_NOT_READY_CAPABILITIES_MISSING: &str = "capabilities_missing";
pub const DISPATCH_NOT_READY_INCOMPATIBLE: &str = "incompatible";

/// The controller-side readiness verdict for one probed target, derived from
/// this file's protocol version and required capability list so no client
/// keeps its own copy of either.
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DispatchProbeReadiness {
    #[serde(default)]
    pub ready: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(default)]
    pub missing_capabilities: Vec<String>,
    #[serde(default)]
    pub expected_protocol_version: u32,
}

impl DispatchProbeReadiness {
    /// `protocol_error` is the target-side validation the probe already ran
    /// (product, namespace, version and capabilities); it decides readiness.
    pub fn evaluate(
        cli_installed: bool,
        protocol: Option<&serde_json::Value>,
        protocol_error: Option<&str>,
    ) -> Self {
        let advertised: Vec<&str> = protocol
            .and_then(|protocol| protocol.get("capabilities"))
            .and_then(serde_json::Value::as_array)
            .map(|items| items.iter().filter_map(serde_json::Value::as_str).collect())
            .unwrap_or_default();
        let missing_capabilities: Vec<String> = if protocol.is_some() {
            dispatch_required_target_capabilities()
                .filter(|required| !advertised.contains(required))
                .map(str::to_string)
                .collect()
        } else {
            Vec::new()
        };
        let version_matches = protocol
            .and_then(|protocol| protocol.get("protocolVersion"))
            .and_then(serde_json::Value::as_u64)
            == Some(u64::from(DISPATCH_PROTOCOL_VERSION));
        let reason = if !cli_installed {
            Some(DISPATCH_NOT_READY_CLI_MISSING)
        } else if protocol.is_none() || protocol_error.is_some_and(|error| !error.trim().is_empty())
        {
            if version_matches && !missing_capabilities.is_empty() {
                Some(DISPATCH_NOT_READY_CAPABILITIES_MISSING)
            } else {
                Some(DISPATCH_NOT_READY_INCOMPATIBLE)
            }
        } else if !missing_capabilities.is_empty() {
            Some(DISPATCH_NOT_READY_CAPABILITIES_MISSING)
        } else {
            None
        };
        Self {
            ready: reason.is_none(),
            reason: reason.map(str::to_string),
            missing_capabilities,
            expected_protocol_version: DISPATCH_PROTOCOL_VERSION,
        }
    }
}

/// One inline image attachment on a submit/continue turn.
///
/// v4 carries images as data URLs inside the request: SSH stages the request
/// as a file over SFTP so size is a policy choice, while the account-device
/// envelope keeps a much smaller controller-enforced budget. Staged chunked
/// transfer for larger payloads is a follow-up capability.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DispatchAttachment {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    pub mime_type: String,
    pub data_url: String,
}

pub const MAX_DISPATCH_ATTACHMENTS: usize = 8;
pub const MAX_DISPATCH_ATTACHMENT_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_DISPATCH_ATTACHMENTS_TOTAL_BYTES: usize = 16 * 1024 * 1024;
/// Inline budget for the account-device envelope. SSH stages the request as
/// an SFTP file, so only relay-carried requests need this much smaller cap.
pub const MAX_DEVICE_DISPATCH_ATTACHMENTS_TOTAL_BYTES: usize = 192 * 1024;

/// Shared structural validation, used verbatim by the controller (fail fast
/// before a transport round trip) and the target (authoritative).
pub fn validate_dispatch_attachments(attachments: &[DispatchAttachment]) -> Result<(), String> {
    if attachments.len() > MAX_DISPATCH_ATTACHMENTS {
        return Err(format!(
            "dispatch accepts at most {MAX_DISPATCH_ATTACHMENTS} attachments per turn"
        ));
    }
    let mut total = 0usize;
    for attachment in attachments {
        if attachment.id.trim().is_empty() || attachment.id.len() > 128 {
            return Err("dispatch attachment id must contain 1-128 bytes".to_string());
        }
        if !attachment.data_url.starts_with("data:image/") {
            return Err("dispatch attachments must be image data URLs".to_string());
        }
        if attachment.data_url.len() > MAX_DISPATCH_ATTACHMENT_BYTES {
            return Err("a dispatch attachment exceeds the 8 MiB limit".to_string());
        }
        total = total.saturating_add(attachment.data_url.len());
    }
    if total > MAX_DISPATCH_ATTACHMENTS_TOTAL_BYTES {
        return Err("dispatch attachments exceed the 16 MiB total limit".to_string());
    }
    Ok(())
}

/// The target's request and plain response shapes, shared by every
/// controller (desktop, CLI outbound, the cloud superagent) and the target.
///
/// Moved here from the CLI target verbatim (wire names, `deny_unknown_fields`
/// and defaults unchanged); the CLI re-exports them. Requests stay strict, so
/// a field added here reaches only a target that advertises the capability
/// named on the field, and an absent optional field serializes exactly as an
/// older controller's request did. Responses read tolerantly.
#[cfg(feature = "dispatch-wire")]
pub mod wire {
    use serde::{Deserialize, Serialize};

    use super::DispatchAttachment;

    fn is_false(value: &bool) -> bool {
        !*value
    }

    #[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    pub struct DispatchProbeRequest {
        #[serde(default)]
        pub workspace_path: Option<String>,
        /// A fleet workspace id of this target, resolved through its own
        /// workspace catalog (`workspace_target_source_v1`). Exclusive with
        /// `workspacePath`.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub workspace_id: Option<String>,
    }

    #[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
    #[serde(rename_all = "camelCase")]
    pub struct DispatchWorkspaceProbe {
        pub path: String,
        pub exists: bool,
        pub is_directory: bool,
        pub is_git_repository: bool,
        /// Git found the repository but refuses to read it until the current user
        /// trusts the path. Present only when that is the case, so a controller can
        /// say why `branch` and `dirty` are missing instead of showing a blank.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub trust_required: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub branch: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub dirty: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub ahead: Option<u64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub behind: Option<u64>,
        /// Set only for a probe by `workspaceId`.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub workspace_id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub name: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub head_commit: Option<String>,
        /// The `origin` URL with credentials stripped.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub remote_url: Option<String>,
    }

    #[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
    #[serde(rename_all = "kebab-case")]
    pub enum DispatchApprovalPolicy {
        Auto,
        RejectAndReport,
        Remote,
    }

    /// What a queued follow-up turn asks the worker to run.
    #[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
    #[serde(rename_all = "camelCase")]
    pub enum DispatchTurnKind {
        /// An ordinary user prompt submitted as a dialog turn.
        #[default]
        Prompt,
        /// Manual context compaction, run as a turn so its events attribute.
        Compact,
    }

    #[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    pub struct DispatchSubmitRequest {
        pub protocol_version: u32,
        pub job_id: String,
        pub session_id: String,
        pub workspace_path: String,
        #[serde(deserialize_with = "openbitfun_core_types::agent_identity::deserialize_agent_id")]
        pub agent_type: String,
        pub prompt: String,
        pub approval_policy: DispatchApprovalPolicy,
        #[serde(default)]
        pub model: Option<String>,
        /// Explicit canonical preset id. `auto` clears the session override.
        #[serde(default)]
        pub reasoning_preset: Option<String>,
        #[serde(default)]
        pub title: Option<String>,
        #[serde(default)]
        pub attachments: Vec<DispatchAttachment>,
        /// Controller-side setup actions that happened before the target job could
        /// exist (currently the signed CLI auto-install). They are replayed into
        /// the durable job event log at creation time and are deliberately excluded
        /// from submit idempotency.
        #[serde(default)]
        pub setup_audit: Vec<DispatchSetupAuditEvent>,
        /// Who submitted the job (`job_submitter_v1`), e.g. `cloud`. `list`
        /// can filter by it.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub submitter: Option<String>,
        /// The controller answers `AskUserQuestion` through the job's question
        /// mailbox (`user_question_mailbox_v1`). Sent only to a target that
        /// advertised it; absent means the tool stays unavailable.
        #[serde(default, skip_serializing_if = "is_false")]
        pub user_questions: bool,
    }

    #[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    pub struct DispatchSetupAuditEvent {
        pub timestamp: String,
        pub action: String,
        #[serde(default)]
        pub details: serde_json::Value,
    }

    #[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
    #[serde(rename_all = "camelCase")]
    pub enum DispatchJobState {
        Queued,
        Running,
        Succeeded,
        Failed,
        Cancelled,
    }

    impl DispatchJobState {
        pub const fn is_terminal(self) -> bool {
            matches!(self, Self::Succeeded | Self::Failed | Self::Cancelled)
        }
    }

    #[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
    #[serde(rename_all = "camelCase")]
    pub struct DispatchSubmitResponse {
        pub accepted: bool,
        pub job_id: String,
        pub session_id: String,
        pub state: DispatchJobState,
    }

    #[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    pub struct DispatchStatusRequest {
        pub job_id: String,
        #[serde(default)]
        pub cursor: u64,
        /// Answer state and prompt summaries only, without events
        /// (`status_summary_only_v1`).
        #[serde(default, skip_serializing_if = "is_false")]
        pub summary_only: bool,
    }

    /// One waiting permission, without its arguments.
    #[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
    #[serde(rename_all = "camelCase")]
    pub struct DispatchPendingPromptSummary {
        #[serde(default)]
        pub request_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub tool_name: Option<String>,
    }

    /// One waiting `AskUserQuestion` of a job (`user_question_mailbox_v1`).
    /// `requestId` is the tool call id; answer it with
    /// `answer {jobId, requestId, answers}`.
    #[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
    #[serde(rename_all = "camelCase")]
    pub struct DispatchPendingQuestion {
        #[serde(default)]
        pub request_id: String,
        #[serde(default)]
        pub session_id: String,
        /// The first question's text (or header), for lists.
        #[serde(default)]
        pub title: String,
        /// The tool input as asked: `{questions: [{question, header,
        /// options: [{label, description}], multiSelect}]}`.
        #[serde(default)]
        pub questions: serde_json::Value,
        #[serde(default)]
        pub registered_at_ms: u64,
    }

    /// `status` with `summaryOnly: true`.
    #[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
    #[serde(rename_all = "camelCase")]
    pub struct DispatchStatusSummaryResponse {
        /// Always true; tells this answer from a full status page.
        pub summary_only: bool,
        pub state: DispatchJobState,
        /// The end of the event log, so a later full read can start there.
        pub cursor: u64,
        #[serde(default)]
        pub pending_permissions: Vec<DispatchPendingPromptSummary>,
        /// Waiting `AskUserQuestion` calls (`user_question_mailbox_v1`).
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        pub pending_questions: Vec<DispatchPendingQuestion>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub turn_id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub started_at: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub finished_at: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub last_error: Option<String>,
    }

    #[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
    #[serde(rename_all = "camelCase")]
    pub struct DispatchAnswerResponse {
        pub resolved: bool,
    }

    #[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    pub struct DispatchAppendRequest {
        pub job_id: String,
        pub message_id: String,
        pub content: String,
        #[serde(default)]
        pub display_content: Option<String>,
        /// Attachments injected into the running turn with the message. An older
        /// controller omits the field entirely, which decodes to an empty list.
        #[serde(default)]
        pub attachments: Vec<DispatchAttachment>,
    }

    #[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
    #[serde(rename_all = "camelCase")]
    pub struct DispatchAppendResponse {
        pub accepted: bool,
        pub message_id: String,
    }

    /// Ask the target to check out this dispatch's baseline commit.
    ///
    /// The target answers `needsBundle` when it cannot reach `baseCommit` from the
    /// shared Git remote — an unpushed commit, or a repository with no remote at
    /// all. The controller then delivers exactly the missing objects as a bundle
    /// and retries, so the remote stays the fast path without being a requirement.
    #[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    pub struct DispatchWorkspaceProvisionRequest {
        pub protocol_version: u32,
        pub job_id: String,
        /// Hex digest naming the shared clone on the target. Never a user-supplied
        /// path: it becomes a directory name.
        pub repo_key: String,
        #[serde(default)]
        pub remote_url: Option<String>,
        /// Readable name of the controller's project, used to build a worktree path
        /// a human can recognize. Advisory: the target sanitizes it and falls back
        /// to the remote's own basename, so a hostile value cannot shape the path.
        #[serde(default)]
        pub project_label: Option<String>,
        /// Full 40-character commit id. A ref name would be ambiguous — it can move
        /// between the controller resolving it and the target fetching it.
        pub base_commit: String,
        pub branch: String,
    }

    #[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
    #[serde(rename_all = "camelCase")]
    pub struct DispatchWorkspaceProvisionResponse {
        /// True while a detached target-side Git process is still running. The
        /// controller polls the same idempotent verb; no individual RPC owns the
        /// lifetime of clone/fetch/worktree creation.
        #[serde(default)]
        pub pending: bool,
        pub provisioned: bool,
        pub needs_bundle: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub workspace_path: Option<String>,
        pub base_commit: String,
        pub branch: String,
        /// Commits the target already has, so the controller can bundle only the
        /// difference instead of the whole history.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        pub have_tips: Vec<String>,
        /// Why the target could not pull `base_commit` from the project's remote,
        /// when it tried and failed. Absent when the remote served the commit, and
        /// when there is no remote to try. Bundle delivery costs the whole history
        /// on a cold cache, so the reason it was chosen belongs in the record rather
        /// than only in the target's log.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub fetch_error: Option<String>,
    }

    /// Where a target-resolved job source comes from. Never a path.
    #[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
    #[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
    pub enum DispatchProvisionSource {
        /// One of the target's own workspaces, by fleet workspace id. The
        /// commit is `ref` (default `HEAD`) of that checkout; uncommitted
        /// changes are not part of it.
        #[serde(rename_all = "camelCase")]
        Workspace {
            workspace_id: String,
            #[serde(default, rename = "ref", skip_serializing_if = "Option::is_none")]
            git_ref: Option<String>,
        },
        /// A Git remote the target fetches with its own credentials.
        /// Credentials in the URL are stripped before use.
        #[serde(rename_all = "camelCase")]
        Remote {
            remote_url: String,
            #[serde(rename = "ref")]
            git_ref: String,
        },
        /// Another account device's job result (`workspace_peer_import_v1`):
        /// the target's host dials `sourceDeviceId` over Link and pulls the
        /// job branch through its full-history `workspace-sync` bundle. The
        /// imported head is pinned per job like any other source.
        #[serde(rename_all = "camelCase")]
        Job {
            job_id: String,
            source_device_id: String,
            /// A commit the import must contain (the head the controller
            /// saw); any later head of the source branch is accepted.
            #[serde(default, skip_serializing_if = "Option::is_none")]
            head: Option<String>,
            /// Informational: the source job's branch and base, as the
            /// controller recorded them.
            #[serde(default, skip_serializing_if = "Option::is_none")]
            branch: Option<String>,
            #[serde(default, skip_serializing_if = "Option::is_none")]
            base_commit: Option<String>,
        },
    }

    /// `dispatch_target_workspace_provision_source`
    /// (`workspace_target_source_v1`): resolve the source on the target, pin
    /// it to a commit, and provision the job worktree from it. Idempotent per
    /// job: the first resolution is recorded and every poll reuses it.
    #[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    pub struct DispatchWorkspaceProvisionSourceRequest {
        pub protocol_version: u32,
        pub job_id: String,
        pub source: DispatchProvisionSource,
        pub branch: String,
    }

    #[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
    #[serde(rename_all = "camelCase")]
    pub struct DispatchWorkspaceProvisionSourceResponse {
        #[serde(default)]
        pub pending: bool,
        pub provisioned: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub workspace_path: Option<String>,
        /// The pinned commit.
        pub base_commit: String,
        pub branch: String,
        /// The ref the commit was resolved from.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub source_ref: Option<String>,
        /// The source remote with credentials stripped.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub remote_url: Option<String>,
        /// The source checkout had uncommitted changes the job does not see.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub source_dirty: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub fetch_error: Option<String>,
        /// Runner to host only (a `job` source): the job's bundle has not
        /// been imported yet, so the host must pull it from the source device
        /// and feed it through `workspace-bundle-begin/chunk` and
        /// `peer-import-commit`. A host answers its caller `pending` instead.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub peer_import: Option<DispatchPeerImportNeed>,
    }

    /// What a host must import before a `job` source can provision.
    #[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
    #[serde(rename_all = "camelCase")]
    pub struct DispatchPeerImportNeed {
        pub source_device_id: String,
        pub source_job_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub head: Option<String>,
    }

    /// Runner-internal `peer-import-commit` (never a wire command): import the
    /// bundle already uploaded for `jobId` (`workspace-bundle-begin/chunk`)
    /// as the source job's branch, pinned at `headCommit`.
    #[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    pub struct DispatchPeerImportCommitRequest {
        pub protocol_version: u32,
        pub job_id: String,
        pub source_device_id: String,
        pub source_job_id: String,
        /// The branch inside the bundle (the source job's branch).
        pub source_branch: String,
        pub head_commit: String,
    }

    #[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
    #[serde(rename_all = "camelCase")]
    pub struct DispatchPeerImportCommitResponse {
        pub imported: bool,
        pub head_commit: String,
    }

    /// `dispatch_target_workspace_publish` (`workspace_publish_v1`).
    #[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    pub struct DispatchWorkspacePublishRequest {
        pub protocol_version: u32,
        pub job_id: String,
        /// A remote name of the job's source checkout; `origin` when absent.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub remote: Option<String>,
    }

    /// What a publish pushed. Never forced: a diverged remote branch fails.
    #[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
    #[serde(rename_all = "camelCase")]
    pub struct DispatchWorkspacePublishResponse {
        pub published: bool,
        pub remote: String,
        /// The pushed-to URL with credentials stripped.
        pub remote_url: String,
        pub branch: String,
        pub head_commit: String,
        #[serde(default)]
        pub base_commit: String,
        /// Commits on the branch since the job's base.
        #[serde(default)]
        pub commit_count: u64,
        /// The remote branch did not exist before.
        #[serde(default)]
        pub created: bool,
        /// The remote branch already pointed at `headCommit`.
        #[serde(default)]
        pub up_to_date: bool,
        /// The remote head before the push, when the branch existed.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub previous_head: Option<String>,
        /// Git-visible changes were committed before the push.
        #[serde(default)]
        pub committed_changes: bool,
    }

    #[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    pub struct DispatchWorkspaceBundleBeginRequest {
        pub protocol_version: u32,
        pub job_id: String,
        pub sha256: String,
        pub size: u64,
    }

    #[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
    #[serde(rename_all = "camelCase")]
    pub struct DispatchWorkspaceBundleBeginResponse {
        pub accepted: bool,
        /// Bytes the target already holds, so a resumed upload skips them.
        pub offset: u64,
        pub committed: bool,
    }

    #[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    pub struct DispatchWorkspaceBundleChunkRequest {
        pub job_id: String,
        pub offset: u64,
        pub data_base64: String,
    }

    #[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
    #[serde(rename_all = "camelCase")]
    pub struct DispatchWorkspaceBundleChunkResponse {
        pub accepted: bool,
        pub offset: u64,
    }

    #[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    pub struct DispatchWorkspaceBundleCommitRequest {
        pub job_id: String,
    }

    #[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
    #[serde(rename_all = "camelCase")]
    pub struct DispatchWorkspaceBundleCommitResponse {
        pub committed: bool,
        #[serde(default)]
        pub pending: bool,
    }

    /// Commit the worktree and package its new history for the controller.
    ///
    /// Only ever appends commits on this job's own branch, so a controller that
    /// never syncs leaves the target unchanged.
    #[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    pub struct DispatchWorkspaceSyncRequest {
        pub job_id: String,
        /// Identifies one controller-side sync invocation. Every poll for that
        /// invocation reuses this value, while a later user-requested sync gets a
        /// new value even when `knownHead` has not advanced.
        ///
        /// The default keeps operation journals written by older v3 development
        /// builds readable after an upgrade. New requests must still provide a
        /// non-empty validated value.
        #[serde(default)]
        pub operation_id: String,
        #[serde(default)]
        pub message: Option<String>,
        /// Head the controller has already fetched. A later invocation combines
        /// this boundary with a new `operationId` to start a new operation;
        /// transport retries before acknowledgement receive the cached result.
        #[serde(default)]
        pub known_head: Option<String>,
        /// Export the whole branch history (`workspace_peer_bundle_v1`), for a
        /// peer that has none of it. Kept apart from the incremental result:
        /// its own bundle file, and never mixed with `knownHead`.
        #[serde(default, skip_serializing_if = "is_false")]
        pub full_history: bool,
    }

    #[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
    #[serde(rename_all = "camelCase")]
    pub struct DispatchWorkspaceSyncedChange {
        pub status: String,
        pub path: String,
    }

    #[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
    #[serde(rename_all = "camelCase")]
    pub struct DispatchWorkspaceSyncResponse {
        #[serde(default)]
        pub pending: bool,
        /// False when the worktree still matches `baseCommit`; no bundle is built.
        pub changed: bool,
        pub branch: String,
        pub base_commit: String,
        pub head_commit: String,
        pub commit_count: u64,
        pub changes: Vec<DispatchWorkspaceSyncedChange>,
        /// True when the change list was capped; the bundle is still complete.
        pub truncated_changes: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub bundle_path: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub bundle_sha256: Option<String>,
        pub bundle_size: u64,
    }

    /// Read a slice of an already-built result bundle.
    ///
    /// Exists for transports with no file channel of their own: SSH pulls the
    /// bundle over SFTP, but an account device can only carry JSON, so it streams
    /// the same bytes back in chunks — the mirror of the upload path.
    #[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    pub struct DispatchWorkspaceSyncChunkRequest {
        pub job_id: String,
        pub offset: u64,
        pub length: u64,
        /// Read the full-history export instead of the incremental result.
        #[serde(default, skip_serializing_if = "is_false")]
        pub full_history: bool,
    }

    #[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
    #[serde(rename_all = "camelCase")]
    pub struct DispatchWorkspaceSyncChunkResponse {
        pub offset: u64,
        pub data_base64: String,
        /// True once this chunk reaches the end of the bundle.
        pub eof: bool,
    }

    /// Start the next turn in a dispatch session whose previous turn has finished.
    ///
    /// Distinct from `append`, which steers a turn that is still running. This is
    /// what lets a dispatch session hold a conversation: the target session, its
    /// worktree, and its event log all persist, and only the job's run state
    /// rewinds so a new worker can pick it up.
    #[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    pub struct DispatchContinueRequest {
        pub protocol_version: u32,
        pub job_id: String,
        /// Caller-generated identity for this turn, so a retried request cannot
        /// start two.
        pub turn_id: String,
        pub prompt: String,
        #[serde(default)]
        pub display_content: Option<String>,
        /// Per-turn model override. Absent keeps the job's current model; present
        /// it also becomes the job's model for later turns.
        #[serde(default)]
        pub model: Option<String>,
        /// Per-turn preset override. Absent keeps the job's current selection;
        /// `auto` clears it and uses the target model default.
        #[serde(default)]
        pub reasoning_preset: Option<String>,
        /// Per-turn approval-policy override with the same carry-forward rule.
        #[serde(default)]
        pub approval_policy: Option<DispatchApprovalPolicy>,
        /// Operation the worker runs; defaults to an ordinary prompt turn.
        #[serde(default)]
        pub kind: DispatchTurnKind,
        #[serde(default)]
        pub attachments: Vec<DispatchAttachment>,
    }

    #[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
    #[serde(rename_all = "camelCase")]
    pub struct DispatchContinueResponse {
        pub accepted: bool,
        pub job_id: String,
        pub session_id: String,
        pub turn_id: String,
        pub state: DispatchJobState,
    }

    #[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    pub struct DispatchCancelRequest {
        pub job_id: String,
    }

    #[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
    #[serde(rename_all = "camelCase")]
    pub struct DispatchCancelResponse {
        pub cancelled: bool,
    }

    /// Read-only question about a job's persisted session state.
    ///
    /// Served by a short-lived process straight from persistence — no runtime is
    /// initialized and no workspace runtime ownership is taken, so a query is
    /// always safe next to a running detached worker.
    #[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    pub struct DispatchQueryRequest {
        pub job_id: String,
        pub kind: DispatchQueryKind,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub file_path: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub file_chunk: Option<super::DispatchFileChunkRequest>,
    }

    #[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
    #[serde(rename_all = "camelCase")]
    pub enum DispatchQueryKind {
        UsageReport,
        ReadFile,
        ReadFileChunk,
        /// `query_result_summary_v1`.
        ResultSummary,
    }

    /// One file of a result diff stat (`git diff --numstat`).
    #[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
    #[serde(rename_all = "camelCase")]
    pub struct DispatchDiffStatFile {
        #[serde(default)]
        pub path: String,
        /// Absent for binary and untracked files.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub added: Option<u64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub deleted: Option<u64>,
        #[serde(default)]
        pub binary: bool,
        #[serde(default, skip_serializing_if = "is_false")]
        pub untracked: bool,
    }

    #[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
    #[serde(rename_all = "camelCase")]
    pub struct DispatchDiffStat {
        #[serde(default)]
        pub files_changed: u64,
        #[serde(default)]
        pub insertions: u64,
        #[serde(default)]
        pub deletions: u64,
        /// The largest changes first, at most `DISPATCH_RESULT_SUMMARY_MAX_FILES`.
        #[serde(default)]
        pub files: Vec<DispatchDiffStatFile>,
        #[serde(default)]
        pub truncated: bool,
    }

    /// `query` kind `resultSummary`: what a job produced, without contents.
    #[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
    #[serde(rename_all = "camelCase")]
    pub struct DispatchResultSummary {
        pub kind: String,
        pub job_id: String,
        pub session_id: String,
        pub state: DispatchJobState,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub branch: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub base_commit: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub head_commit: Option<String>,
        #[serde(default)]
        pub commit_count: u64,
        /// Uncommitted changes in the worktree are included in `diffStat`.
        #[serde(default)]
        pub uncommitted_changes: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub diff_stat: Option<DispatchDiffStat>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub started_at: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub finished_at: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub duration_ms: Option<u64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub last_error: Option<String>,
        /// The last assistant reply of the job's last turn, bounded to
        /// `DISPATCH_RESULT_SUMMARY_MAX_TEXT_BYTES` (its end is kept).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub summary: Option<String>,
        #[serde(default)]
        pub summary_truncated: bool,
    }

    #[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    pub struct DispatchListRequest {
        /// Only jobs with this submitter (`job_submitter_v1`).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub submitter: Option<String>,
    }

    #[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
    #[serde(rename_all = "camelCase")]
    pub struct DispatchJobListEntry {
        pub job_id: String,
        pub session_id: String,
        pub state: DispatchJobState,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub started_at: Option<String>,
        pub workspace_path: String,
        pub title: String,
        #[serde(deserialize_with = "openbitfun_core_types::agent_identity::deserialize_agent_id")]
        pub agent_type: String,
        pub approval_policy: DispatchApprovalPolicy,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub model: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub reasoning_preset: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub submitter: Option<String>,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn subscription_runtime_capabilities_are_optional_and_do_not_imply_management() {
        let required: Vec<_> = dispatch_required_target_capabilities().collect();
        for capability in DISPATCH_SUBSCRIPTION_ACCOUNT_CAPABILITIES {
            assert!(!DISPATCH_BASE_TARGET_CAPABILITIES.contains(capability));
            assert!(!required.contains(capability));
        }
        assert_eq!(
            DISPATCH_SUBSCRIPTION_ACCOUNT_CAPABILITIES,
            &[
                DISPATCH_SUBSCRIPTION_ACCOUNT_BINDINGS_CAPABILITY,
                DISPATCH_SUBSCRIPTION_ACCOUNT_FAILOVER_CAPABILITY,
                DISPATCH_SUBSCRIPTION_PROVIDER_ACCOUNTS_CAPABILITY,
            ]
        );
        assert!(!DISPATCH_SUBSCRIPTION_ACCOUNT_CAPABILITIES
            .contains(&"subscription_account_management_v1"));
    }

    #[test]
    fn required_capabilities_are_base_plus_detached_worker() {
        let required: Vec<&str> = dispatch_required_target_capabilities().collect();
        assert_eq!(required.len(), DISPATCH_BASE_TARGET_CAPABILITIES.len() + 1);
        assert!(required.contains(&DISPATCH_DETACHED_WORKER_CAPABILITY));
        for capability in DISPATCH_BASE_TARGET_CAPABILITIES {
            assert!(required.contains(capability));
        }
        assert!(!required.contains(&DISPATCH_SETUP_AUDIT_MODEL_SYNC_CAPABILITY));
        assert!(!required.contains(&DISPATCH_READ_FILE_CAPABILITY));
    }

    #[test]
    fn probe_readiness_comes_from_the_shared_contract() {
        let all: Vec<&str> = dispatch_required_target_capabilities().collect();
        let ready =
            serde_json::json!({"protocolVersion": DISPATCH_PROTOCOL_VERSION, "capabilities": all});
        let verdict = DispatchProbeReadiness::evaluate(true, Some(&ready), None);
        assert!(verdict.ready);
        assert_eq!(verdict.reason, None);
        assert_eq!(verdict.expected_protocol_version, DISPATCH_PROTOCOL_VERSION);

        let missing_cli = DispatchProbeReadiness::evaluate(false, None, None);
        assert_eq!(
            missing_cli.reason.as_deref(),
            Some(DISPATCH_NOT_READY_CLI_MISSING)
        );

        let partial = serde_json::json!({"protocolVersion": DISPATCH_PROTOCOL_VERSION, "capabilities": ["product_identity"]});
        let verdict = DispatchProbeReadiness::evaluate(
            true,
            Some(&partial),
            Some("dispatch target is missing required capabilities"),
        );
        assert!(!verdict.ready);
        assert_eq!(
            verdict.reason.as_deref(),
            Some(DISPATCH_NOT_READY_CAPABILITIES_MISSING)
        );
        assert!(verdict
            .missing_capabilities
            .contains(&"persistent_jobs".to_string()));
        assert!(!verdict
            .missing_capabilities
            .contains(&"product_identity".to_string()));

        let old = serde_json::json!({"protocolVersion": 1, "capabilities": all});
        let verdict = DispatchProbeReadiness::evaluate(
            true,
            Some(&old),
            Some("dispatch protocol version is incompatible"),
        );
        assert_eq!(
            verdict.reason.as_deref(),
            Some(DISPATCH_NOT_READY_INCOMPATIBLE)
        );

        // A probe answer from an older controller has none of these fields.
        let legacy: DispatchProbeReadiness = serde_json::from_value(serde_json::json!({})).unwrap();
        assert!(!legacy.ready);
    }

    #[test]
    fn binary_file_queries_are_optional_for_existing_targets() {
        assert!(!dispatch_required_target_capabilities()
            .any(|capability| capability == DISPATCH_FILE_CHUNKS_CAPABILITY));
    }

    #[test]
    fn model_sync_audit_rows_need_the_optional_capability() {
        assert!(dispatch_target_accepts_setup_audit_action(
            "cli-install",
            &[]
        ));
        assert!(!dispatch_target_accepts_setup_audit_action(
            DISPATCH_MODEL_SYNC_SETUP_AUDIT_ACTION,
            &[]
        ));
        assert!(dispatch_target_accepts_setup_audit_action(
            DISPATCH_MODEL_SYNC_SETUP_AUDIT_ACTION,
            &[DISPATCH_SETUP_AUDIT_MODEL_SYNC_CAPABILITY]
        ));
        assert!(!dispatch_target_accepts_setup_audit_action(
            "something-else",
            &[DISPATCH_SETUP_AUDIT_MODEL_SYNC_CAPABILITY]
        ));
        let supported: Vec<&str> = dispatch_supported_setup_audit_actions().collect();
        assert!(supported.contains(&DISPATCH_MODEL_SYNC_SETUP_AUDIT_ACTION));
        for action in DISPATCH_BASE_SETUP_AUDIT_ACTIONS {
            assert!(supported.contains(action));
        }
    }
}

#[cfg(test)]
mod superagent_contract_tests {
    use super::*;

    #[test]
    fn superagent_capabilities_are_optional() {
        let required: Vec<&str> = dispatch_required_target_capabilities().collect();
        for capability in DISPATCH_SUPERAGENT_TARGET_CAPABILITIES {
            assert!(!required.contains(capability), "{capability}");
            assert!(!DISPATCH_BASE_TARGET_CAPABILITIES.contains(capability));
        }
        assert_eq!(DISPATCH_PROTOCOL_VERSION, 6);
    }

    #[test]
    fn remote_url_credentials_are_stripped() {
        for (input, expected) in [
            (
                "https://user:ghp_secret@github.com/acme/app.git",
                "https://github.com/acme/app.git",
            ),
            (
                "https://oauth2:tok@gitlab.com/a/b",
                "https://gitlab.com/a/b",
            ),
            (
                "https://host/a/b.git?private_token=x#frag",
                "https://host/a/b.git",
            ),
            ("http://token@host:8080/r", "http://host:8080/r"),
            ("ssh://git:pw@host:22/r.git", "ssh://host:22/r.git"),
            ("git@github.com:acme/app.git", "git@github.com:acme/app.git"),
            (
                "https://github.com/acme/app.git",
                "https://github.com/acme/app.git",
            ),
            ("/srv/git/app.git", "/srv/git/app.git"),
            ("file:///srv/git/app.git", "file:///srv/git/app.git"),
            ("https://a@b@host/r", "https://host/r"),
        ] {
            assert_eq!(strip_remote_url_credentials(input), expected, "{input}");
        }
    }

    #[test]
    fn submitter_tags_are_narrow() {
        assert!(validate_dispatch_submitter("cloud").is_ok());
        assert!(validate_dispatch_submitter("bot_1-x").is_ok());
        for bad in ["", "Cloud", "a b", "../x", &"x".repeat(33)] {
            assert!(validate_dispatch_submitter(bad).is_err(), "{bad}");
        }
    }

    #[cfg(feature = "dispatch-wire")]
    mod wire_shapes {
        use super::super::wire::*;
        use serde_json::json;

        fn legacy_submit() -> serde_json::Value {
            json!({
                "protocolVersion": 6,
                "jobId": "dispatch-1",
                "sessionId": "session-1",
                "workspacePath": "/repo",
                "agentType": "agentic",
                "prompt": "do it",
                "approvalPolicy": "remote",
                "model": null,
                "reasoningPreset": null,
                "title": null,
                "attachments": [],
                "setupAudit": []
            })
        }

        #[test]
        fn old_submit_shape_round_trips_byte_for_byte() {
            let request: DispatchSubmitRequest =
                serde_json::from_value(legacy_submit()).expect("old submit");
            assert_eq!(request.submitter, None);
            // Re-encoding gives the old bytes back: no new key appears.
            let encoded = serde_json::to_value(&request).unwrap();
            let mut expected = legacy_submit();
            expected["agentType"] = json!(request.agent_type);
            assert_eq!(encoded, expected);

            let mut tagged = legacy_submit();
            tagged["submitter"] = json!("cloud");
            let request: DispatchSubmitRequest = serde_json::from_value(tagged).unwrap();
            assert_eq!(request.submitter.as_deref(), Some("cloud"));

            let mut unknown = legacy_submit();
            unknown["queueIfOffline"] = json!(true);
            assert!(serde_json::from_value::<DispatchSubmitRequest>(unknown).is_err());
        }

        #[test]
        fn old_probe_status_list_and_query_shapes_still_parse_and_encode() {
            let probe: DispatchProbeRequest =
                serde_json::from_value(json!({"workspacePath": "/w"})).unwrap();
            assert_eq!(probe.workspace_id, None);
            assert!(serde_json::from_value::<DispatchProbeRequest>(json!({})).is_ok());
            assert!(serde_json::from_value::<DispatchProbeRequest>(json!({"other": 1})).is_err());

            let status: DispatchStatusRequest =
                serde_json::from_value(json!({"jobId": "j", "cursor": 7})).unwrap();
            assert!(!status.summary_only);
            assert_eq!(
                serde_json::to_value(&status).unwrap(),
                json!({"jobId": "j", "cursor": 7})
            );

            let list: DispatchListRequest = serde_json::from_value(json!({})).unwrap();
            assert_eq!(serde_json::to_value(&list).unwrap(), json!({}));
            assert!(serde_json::from_value::<DispatchListRequest>(json!({"all": true})).is_err());

            let query: DispatchQueryRequest =
                serde_json::from_value(json!({"jobId": "j", "kind": "usageReport"})).unwrap();
            assert_eq!(
                serde_json::to_value(&query).unwrap(),
                json!({"jobId": "j", "kind": "usageReport"})
            );
            let summary: DispatchQueryRequest =
                serde_json::from_value(json!({"jobId": "j", "kind": "resultSummary"})).unwrap();
            assert_eq!(summary.kind, DispatchQueryKind::ResultSummary);
        }

        #[test]
        fn provision_source_is_strict_and_never_a_path() {
            let request: DispatchWorkspaceProvisionSourceRequest = serde_json::from_value(json!({
                "protocolVersion": 6,
                "jobId": "j",
                "source": {"kind": "workspace", "workspaceId": "local_x", "ref": "main"},
                "branch": "openbitfun/dispatch/j"
            }))
            .unwrap();
            assert_eq!(
                request.source,
                DispatchProvisionSource::Workspace {
                    workspace_id: "local_x".into(),
                    git_ref: Some("main".into())
                }
            );
            for source in [
                json!({"kind": "path", "path": "/etc"}),
                json!({"kind": "workspace", "workspaceId": "w", "path": "/etc"}),
                json!({"kind": "remote", "remoteUrl": "https://h/r"}),
            ] {
                let value = json!({
                    "protocolVersion": 6, "jobId": "j", "source": source, "branch": "b"
                });
                assert!(
                    serde_json::from_value::<DispatchWorkspaceProvisionSourceRequest>(value)
                        .is_err()
                );
            }
        }

        #[test]
        fn phase_two_fields_are_additive_and_strict() {
            // A job source reads with or without its informational fields,
            // and a pre-phase-two request (no job kind) still reads.
            let value = json!({
                "protocolVersion": 6, "jobId": "j2", "branch": "openbitfun/dispatch/j2",
                "source": {"kind": "job", "jobId": "j1", "sourceDeviceId": "dev-a",
                    "branch": "openbitfun/dispatch/j1", "baseCommit": null}
            });
            let request: DispatchWorkspaceProvisionSourceRequest =
                serde_json::from_value(value).unwrap();
            assert_eq!(
                request.source,
                DispatchProvisionSource::Job {
                    job_id: "j1".into(),
                    source_device_id: "dev-a".into(),
                    head: None,
                    branch: Some("openbitfun/dispatch/j1".into()),
                    base_commit: None,
                }
            );
            assert!(
                serde_json::from_value::<DispatchWorkspaceProvisionSourceRequest>(json!({
                    "protocolVersion": 6, "jobId": "j2", "branch": "b",
                    "source": {"kind": "job", "jobId": "j1"}
                }))
                .is_err(),
                "a job source names its device"
            );

            // Old submit, sync and chunk requests read with the new flags off,
            // and the flags are never sent when off.
            let submit: DispatchSubmitRequest = serde_json::from_value(legacy_submit()).unwrap();
            assert!(!submit.user_questions);
            assert!(serde_json::to_value(&submit)
                .unwrap()
                .get("userQuestions")
                .is_none());
            let sync: DispatchWorkspaceSyncRequest =
                serde_json::from_value(json!({"jobId": "j", "operationId": "o"})).unwrap();
            assert!(!sync.full_history);
            assert!(serde_json::to_value(&sync)
                .unwrap()
                .get("fullHistory")
                .is_none());
            let chunk: DispatchWorkspaceSyncChunkRequest =
                serde_json::from_value(json!({"jobId": "j", "offset": 0, "length": 1})).unwrap();
            assert!(!chunk.full_history);

            // A summary from an older target has no questions; a newer one's
            // questions read.
            let summary: DispatchStatusSummaryResponse = serde_json::from_value(json!({
                "summaryOnly": true, "state": "running", "cursor": 1
            }))
            .unwrap();
            assert!(summary.pending_questions.is_empty());
            let summary: DispatchStatusSummaryResponse = serde_json::from_value(json!({
                "summaryOnly": true, "state": "running", "cursor": 1,
                "pendingQuestions": [{"requestId": "t", "questions": {"questions": []}, "newer": 1}]
            }))
            .unwrap();
            assert_eq!(summary.pending_questions[0].request_id, "t");

            let publish: DispatchWorkspacePublishRequest =
                serde_json::from_value(json!({"protocolVersion": 6, "jobId": "j"})).unwrap();
            assert_eq!(publish.remote, None);
            assert!(
                serde_json::from_value::<DispatchWorkspacePublishRequest>(
                    json!({"protocolVersion": 6, "jobId": "j", "force": true})
                )
                .is_err(),
                "there is no force"
            );
        }

        #[test]
        fn responses_read_tolerantly() {
            let entry: DispatchJobListEntry = serde_json::from_value(json!({
                "jobId": "j", "sessionId": "s", "state": "running", "workspacePath": "/w",
                "title": "t", "agentType": "agentic", "approvalPolicy": "remote", "newer": 1
            }))
            .unwrap();
            assert_eq!(entry.submitter, None);
            let encoded = serde_json::to_value(&entry).unwrap();
            assert!(encoded.get("submitter").is_none());
            let summary: DispatchResultSummary = serde_json::from_value(json!({
                "kind": "resultSummary", "jobId": "j", "sessionId": "s", "state": "succeeded"
            }))
            .unwrap();
            assert_eq!(summary.commit_count, 0);
        }
    }
}

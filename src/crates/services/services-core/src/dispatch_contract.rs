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

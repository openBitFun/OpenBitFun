//! Connection scopes and the registry-driven allowlist.
//!
//! `owner` (a loopback client holding the per-launch token) runs every command
//! the in-process UI runs and receives every event. `paired-client` (a phone
//! or browser on the account mesh holding a revocable QR credential) and `account-device` (another
//! device of the same account over the mesh, authenticated with the device
//! key handshake) run only commands the Product Operation Registry marks
//! `Proxied`, and never receive owner-only events (account, window, tray,
//! updater, mesh). See
//! `docs/architecture/unified-client-architecture.md` ("Scopes").
//!
//! `cloud-agent` is the account's cloud superagent (directory kind
//! `cloud_agent`). It authenticates with the same device handshake and has
//! the `account-device` allowlist (full access, like any of the user's
//! frontends); the label only tells it apart in logs and adds this device's
//! switches, read per call: `superagent.acceptDispatch` (default on; off
//! fences the device off) and `superagent.allowAutoApproval` (default on;
//! off refuses `approvalPolicy: auto`, answering prompts and loosening
//! approval rules).
//!
//! The model relay `fleet_model_*` serves the cloud agent and the account's
//! other devices (a session on another device running one of this device's
//! models), never a paired client.

use openbitfun_product_domains::remote_surface::{
    event_stance, operation, retired_reason, EventStance, OperationSurface, PeerStance,
};
use serde_json::Value;

/// The authority one connection was granted at its upgrade.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Scope {
    Owner,
    PairedClient {
        client_id: String,
    },
    /// Another device of the signed-in account, over the mesh listener.
    AccountDevice {
        device_id: String,
    },
    /// The account's cloud superagent (directory row kind `cloud_agent`),
    /// over the same device handshake: the `account-device` allowlist plus
    /// the model relay, under this device's superagent switches.
    CloudAgent {
        device_id: String,
    },
}

/// The directory row kind that selects [`Scope::CloudAgent`].
pub const CLOUD_AGENT_DEVICE_KIND: &str = "cloud_agent";
/// Advertised (on `hello` and `/obp/mesh/info`) by a host that serves the
/// cloud agent (its switches and the model relay); the superagent never
/// dials a device without it.
pub const CLOUD_AGENT_SCOPE_CAPABILITY: &str = "cloud_agent_scope_v1";

/// The model relay: completions run on this device for the cloud agent.
pub const FLEET_MODEL_COMMANDS: &[&str] = &[
    "fleet_model_start",
    "fleet_model_poll",
    "fleet_model_cancel",
];
/// What the cloud agent may still call while `superagent.acceptDispatch` is
/// off: enough to show why the device is fenced and to stop what it started
/// (and the model relay, which runs no work on the device).
const CLOUD_AGENT_FENCED_COMMANDS: &[&str] = &[
    "dispatch_target_probe",
    "dispatch_target_status",
    "dispatch_target_list",
    "dispatch_target_cancel",
    "fleet_digest",
    "fleet_replay",
    "fleet_model_start",
    "fleet_model_poll",
    "fleet_model_cancel",
];
/// Calls that answer this device's prompts or loosen its approval rules:
/// refused while `superagent.allowAutoApproval` is off, so the switch
/// cannot be bypassed through the ordinary product commands.
const CLOUD_AGENT_ANSWER_COMMANDS: &[&str] = &[
    "dispatch_target_answer",
    "respond_permission",
    "respond_permission_batch",
    "submit_user_answers",
    "submit_acp_permission_response",
    "set_permission_mode",
    "update_session_permission_mode",
    "update_active_turn_permission_mode",
    "set_approval_settings",
    "set_acp_client_permission_mode",
    "upsert_permission_rule",
    "save_project_permission_rules",
];

/// The device's switches for the cloud agent (`superagent.acceptDispatch`,
/// `superagent.allowAutoApproval`), read per call.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CloudAgentPolicy {
    /// Whether the cloud agent may work on this device at all.
    pub accept_dispatch: bool,
    /// Whether it may submit with `approvalPolicy: auto` and answer prompts.
    pub allow_auto_approval: bool,
}

impl Default for CloudAgentPolicy {
    /// The settings' defaults: both on.
    fn default() -> Self {
        Self {
            accept_dispatch: true,
            allow_auto_approval: true,
        }
    }
}

/// The scope a verified device handshake gets from its directory row kind
/// (`None`: a directory that predates the kind, or a row without one).
pub fn scope_for_device(device_id: String, kind: Option<&str>) -> Scope {
    match kind {
        Some(CLOUD_AGENT_DEVICE_KIND) => Scope::CloudAgent { device_id },
        _ => Scope::AccountDevice { device_id },
    }
}

impl Scope {
    pub fn wire_name(&self) -> &'static str {
        match self {
            Self::Owner => "owner",
            Self::PairedClient { .. } => "paired-client",
            Self::AccountDevice { .. } => "account-device",
            Self::CloudAgent { .. } => "cloud-agent",
        }
    }

    /// A connection over the account device network (closed with it).
    pub fn is_mesh_device(&self) -> bool {
        matches!(self, Self::AccountDevice { .. } | Self::CloudAgent { .. })
    }

    pub fn is_owner(&self) -> bool {
        matches!(self, Self::Owner)
    }
}

/// Whether `scope` may run `command`; the refusal text otherwise.
/// `host_verb` names the same-account host verbs the backend serves
/// (`ObpBackend::is_account_device_host_verb`).
pub fn check_command(
    scope: &Scope,
    command: &str,
    host_verb: &dyn Fn(&str) -> bool,
) -> Result<(), String> {
    if scope.is_owner() {
        return Ok(());
    }
    if command.is_empty() {
        return Err("forbidden_for_scope: the command name is empty".to_string());
    }
    // The model relay serves the account's cloud agent and the account's
    // other devices (a session there running one of this device's models;
    // whatever the registry says about it later), never a paired client, and
    // only on a host that runs it.
    if FLEET_MODEL_COMMANDS.contains(&command) {
        return match scope {
            Scope::CloudAgent { .. } | Scope::AccountDevice { .. } if host_verb(command) => Ok(()),
            Scope::CloudAgent { .. } => Err(format!(
                "superagent_requires_update: command '{command}' is not served by this OpenBitFun host; update it"
            )),
            Scope::AccountDevice { .. } => Err(format!(
                "fleet_model_unavailable: command '{command}' is not served by this OpenBitFun host; update it"
            )),
            _ => Err(format!(
                "forbidden_for_scope: command '{command}' runs only for the account's devices and its cloud agent"
            )),
        };
    }
    if let Some(reason) = retired_reason(command) {
        return Err(format!(
            "command '{command}' is unsupported because {reason}"
        ));
    }
    let Some(definition) = operation(command) else {
        return Err(format!(
            "forbidden_for_scope: command '{command}' is unknown to this OpenBitFun backend version; update the backend or check the command name"
        ));
    };
    // Same-account host verbs (detached dispatch targets, the bot
    // `RemoteCommand` lane, `ws::mesh_verbs`) keep the trust boundary of the
    // legacy relay `host_invoke`: another device of this account only, never
    // a paired client. `obp_remote_command` is `OperatorOnly` in the registry
    // because legacy peer hosts refuse it; only this listener admits it.
    if scope.is_mesh_device()
        && definition.surface == OperationSurface::HostInvokeOnly
        && matches!(
            definition.peer,
            PeerStance::HostControlPlane | PeerStance::OperatorOnly
        )
        && host_verb(command)
    {
        return Ok(());
    }
    // The account's cloud node serves these (`superagent_*`); a desktop or
    // CLI host answers them unsupported, never forbidden, so a frontend that
    // addressed the wrong device learns where the command lives.
    if definition.surface == OperationSurface::CloudNode {
        return Err(format!(
            "{}: command '{command}' is not supported on this device: {}",
            crate::UNSUPPORTED_IN_NATIVE_HOST,
            openbitfun_product_domains::remote_surface::CLOUD_NODE_ONLY_REASON
        ));
    }
    if definition.surface != OperationSurface::TauriCommand {
        return Err(format!(
            "forbidden_for_scope: command '{command}' is not a backend command"
        ));
    }
    match definition.peer {
        PeerStance::Proxied => Ok(()),
        PeerStance::ControllerLocal | PeerStance::OperatorOnly | PeerStance::HostControlPlane => {
            Err(format!(
                "forbidden_for_scope: command '{command}' runs only for the backend owner on that machine"
            ))
        }
        PeerStance::Retired { reason } => Err(format!(
            "command '{command}' is unsupported because {reason}"
        )),
        // Fleet verbs: answered by this host's fleet layer for the owner and
        // the account's own devices and frontends (account-device,
        // cloud-agent); never for a paired client.
        PeerStance::FleetEntry if scope.is_mesh_device() => Ok(()),
        PeerStance::FleetEntry => Err(format!(
            "forbidden_for_scope: command '{command}' is a fleet command and this backend does not serve it for this connection"
        )),
    }
}

/// The cloud agent's per-call verdict from this device's switches and the
/// call's arguments (after [`check_command`] admitted the name).
pub fn check_cloud_agent_call(
    command: &str,
    args: &Value,
    policy: &CloudAgentPolicy,
) -> Result<(), String> {
    if !policy.accept_dispatch && !CLOUD_AGENT_FENCED_COMMANDS.contains(&command) {
        return Err(format!(
            "superagent_dispatch_disabled: this device does not accept work from the cloud agent (superagent.acceptDispatch is off); command '{command}' is refused"
        ));
    }
    if !policy.allow_auto_approval {
        if CLOUD_AGENT_ANSWER_COMMANDS.contains(&command) {
            return Err(format!(
                "superagent_auto_approval_refused: on this device the user answers prompts and sets approval rules (superagent.allowAutoApproval is off); command '{command}' is refused"
            ));
        }
        if command.starts_with("dispatch_target_") && requests_auto_approval(args) {
            return Err(
                "superagent_auto_approval_refused: automatic approval for the cloud agent is off on this device (superagent.allowAutoApproval)"
                    .to_string(),
            );
        }
    }
    Ok(())
}

/// Whether a target call asks for `approvalPolicy: auto` (submit, or a
/// continue that overrides the policy), in the `{request: …}` or the flat
/// form, under either key spelling.
fn requests_auto_approval(args: &Value) -> bool {
    let is_auto = |object: &Value| {
        ["approvalPolicy", "approval_policy"].iter().any(|key| {
            object
                .get(*key)
                .and_then(Value::as_str)
                .is_some_and(|policy| policy.trim().eq_ignore_ascii_case("auto"))
        })
    };
    is_auto(args) || args.get("request").is_some_and(is_auto)
}

/// The account replica verbs (`fleet::replica`) and the collections the
/// cloud agent may use with them: it pushes and reads only the `superagent.`
/// collections (conversation history), never the full replica
/// (`fleet_replica_digest`, `fleet_replica_pull`) and never another
/// collection. A host answers these verbs for a `cloud-agent` connection
/// through [`cloud_agent_replica_verb`] only, never through its dispatcher
/// (which serves the account's runtime devices).
pub const CLOUD_AGENT_REPLICA_COLLECTIONS: &[&str] = &["superagent."];

/// Whether `command` is an account replica verb.
pub fn is_replica_verb(command: &str) -> bool {
    matches!(
        command,
        "fleet_blob_get"
            | "fleet_blob_holders"
            | "fleet_replica_digest"
            | "fleet_replica_list"
            | "fleet_replica_pull"
            | "fleet_replica_push"
    )
}

/// What the cloud agent's call of a replica verb is: `None` for any other
/// command. `fleet_call` wrapping a replica verb is refused (it would reach
/// another device as an account device, with full replica access).
pub fn cloud_agent_replica_verb(command: &str, args: &Value) -> Option<CloudReplicaCall> {
    if command == "fleet_call" {
        let inner = args
            .get("request")
            .unwrap_or(args)
            .get("command")
            .and_then(Value::as_str)
            .unwrap_or("");
        return is_replica_verb(inner).then(|| CloudReplicaCall::Refused(format!(
            "forbidden_for_scope: the cloud agent calls replica verb '{inner}' on each device directly, never through fleet_call"
        )));
    }
    if !is_replica_verb(command) {
        return None;
    }
    if matches!(command, "fleet_replica_digest" | "fleet_replica_pull") {
        return Some(CloudReplicaCall::Refused(format!(
            "forbidden_for_scope: command '{command}' reads the whole account replica and is not served to the cloud agent"
        )));
    }
    Some(CloudReplicaCall::Scoped)
}

/// See [`cloud_agent_replica_verb`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CloudReplicaCall {
    /// Answer it with the replica's restricted access to
    /// [`CLOUD_AGENT_REPLICA_COLLECTIONS`].
    Scoped,
    Refused(String),
}

/// Whether `scope` receives `event`.
pub fn event_visible(scope: &Scope, event: &str) -> bool {
    scope.is_owner() || event_stance(event) == EventStance::Proxied
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The desktop's host verbs (dispatch targets and the bot lane).
    fn desktop_verbs(command: &str) -> bool {
        command == "obp_remote_command" || command.starts_with("dispatch_target_")
    }

    fn check(scope: &Scope, command: &str) -> Result<(), String> {
        check_command(scope, command, &desktop_verbs)
    }

    #[test]
    fn the_cloud_agent_gets_scoped_replica_verbs_only() {
        let empty = serde_json::json!({});
        for verb in [
            "fleet_replica_push",
            "fleet_replica_list",
            "fleet_blob_get",
            "fleet_blob_holders",
        ] {
            assert_eq!(
                cloud_agent_replica_verb(verb, &empty),
                Some(CloudReplicaCall::Scoped)
            );
        }
        for verb in ["fleet_replica_digest", "fleet_replica_pull"] {
            assert!(matches!(
                cloud_agent_replica_verb(verb, &empty),
                Some(CloudReplicaCall::Refused(_))
            ));
        }
        let wrapped =
            serde_json::json!({"request": {"target": "d2", "command": "fleet_replica_pull"}});
        assert!(matches!(
            cloud_agent_replica_verb("fleet_call", &wrapped),
            Some(CloudReplicaCall::Refused(_))
        ));
        let plain =
            serde_json::json!({"request": {"target": "d2", "command": "superagent_status"}});
        assert_eq!(cloud_agent_replica_verb("fleet_call", &plain), None);
        assert_eq!(
            cloud_agent_replica_verb("dispatch_target_probe", &empty),
            None
        );
    }

    #[test]
    fn owner_runs_everything_and_paired_clients_follow_the_registry() {
        let paired = Scope::PairedClient {
            client_id: "c1".into(),
        };
        assert!(check(&Scope::Owner, "account_delete_device").is_ok());
        assert!(check(&Scope::Owner, "anything_at_all").is_ok());
        let error = check(&paired, "account_delete_device").unwrap_err();
        assert!(error.starts_with("forbidden_for_scope:"), "{error}");
        // The pairing commands themselves are owner-only.
        assert!(check(&paired, "obp_create_pairing").is_err());
        assert!(check(&paired, "no_such_command").is_err());
        assert!(check(&paired, "open_workspace").is_ok());
    }

    #[test]
    fn account_devices_follow_the_registry_like_paired_clients() {
        let device = Scope::AccountDevice {
            device_id: "d1".into(),
        };
        assert_eq!(device.wire_name(), "account-device");
        assert!(check(&device, "open_workspace").is_ok());
        assert!(check(&device, "obp_get_status").is_err());
        // The retired LAN switch is refused with its retirement reason.
        let retired = check(&device, "obp_set_lan_enabled").unwrap_err();
        assert!(retired.contains("unsupported because"), "{retired}");
        assert!(check(&device, "mesh_status").is_err());
        assert!(!event_visible(&device, "account://login-state"));
        assert!(!event_visible(&device, "mesh://status-changed"));
        assert!(event_visible(&device, "agentic://text-chunk"));
        // Same-account host verbs: account devices only.
        assert!(check(&device, "dispatch_target_probe").is_ok());
        assert!(check(&device, "obp_remote_command").is_ok());
        assert!(check(&device, "peer_mode_ping").is_err());
        let paired = Scope::PairedClient {
            client_id: "c1".into(),
        };
        assert!(check(&paired, "dispatch_target_probe").is_err());
        assert!(check(&paired, "obp_remote_command").is_err());
    }

    #[test]
    fn owner_only_events_never_reach_paired_clients() {
        let paired = Scope::PairedClient {
            client_id: "c1".into(),
        };
        assert!(event_visible(&Scope::Owner, "account://login-state"));
        assert!(!event_visible(&paired, "account://login-state"));
        assert!(!event_visible(&paired, "window://fullscreen-chrome"));
        assert!(event_visible(&paired, "agentic://text-chunk"));
    }

    /// A host serving the cloud agent: dispatch targets, the bot lane and
    /// the model relay.
    fn cloud_host_verbs(command: &str) -> bool {
        desktop_verbs(command) || FLEET_MODEL_COMMANDS.contains(&command)
    }

    fn cloud() -> Scope {
        Scope::CloudAgent {
            device_id: "cloud-0123".into(),
        }
    }

    #[test]
    fn cloud_scope_has_the_account_device_allowlist_and_the_model_relay() {
        let cloud = cloud();
        let device = Scope::AccountDevice {
            device_id: "d1".into(),
        };
        assert_eq!(cloud.wire_name(), "cloud-agent");
        assert!(cloud.is_mesh_device());
        for command in [
            "open_workspace",
            "get_config",
            "dispatch_target_probe",
            "dispatch_target_submit",
            "dispatch_target_answer",
            "obp_remote_command",
            "obp_set_lan_enabled",
            "mesh_status",
            "account_delete_device",
            "peer_mode_ping",
            "no_such_command",
        ] {
            assert_eq!(
                check_command(&cloud, command, &cloud_host_verbs).is_ok(),
                check_command(&device, command, &cloud_host_verbs).is_ok(),
                "{command}"
            );
        }
        for command in FLEET_MODEL_COMMANDS {
            assert!(
                check_command(&cloud, command, &cloud_host_verbs).is_ok(),
                "{command}"
            );
        }
        // A host that does not run the relay answers with a stable reason.
        let error = check_command(&cloud, "fleet_model_start", &desktop_verbs).unwrap_err();
        assert!(error.starts_with("superagent_requires_update:"), "{error}");
        // The same events as any account device.
        assert!(event_visible(&cloud, "agentic://text-chunk"));
        assert!(!event_visible(&cloud, "account://login-state"));
    }

    #[test]
    fn cloud_scope_answer_and_auto_allowed_by_default_refused_when_the_device_turns_it_off() {
        let policy = CloudAgentPolicy::default();
        assert!(policy.accept_dispatch && policy.allow_auto_approval);
        let submit = |policy_value: &str| serde_json::json!({ "request": { "jobId": "j1", "approvalPolicy": policy_value } });
        let answer = serde_json::json!({ "request": { "jobId": "j1", "promptId": "p" } });
        assert!(check_cloud_agent_call("dispatch_target_submit", &submit("auto"), &policy).is_ok());
        assert!(check_cloud_agent_call("dispatch_target_answer", &answer, &policy).is_ok());

        let off = CloudAgentPolicy {
            allow_auto_approval: false,
            ..policy
        };
        let error =
            check_cloud_agent_call("dispatch_target_submit", &submit("auto"), &off).unwrap_err();
        assert!(
            error.starts_with("superagent_auto_approval_refused:"),
            "{error}"
        );
        for command in [
            "dispatch_target_answer",
            "respond_permission",
            "submit_user_answers",
            "update_session_permission_mode",
        ] {
            let error = check_cloud_agent_call(command, &answer, &off).unwrap_err();
            assert!(
                error.starts_with("superagent_auto_approval_refused:"),
                "{command}: {error}"
            );
            assert!(
                check_cloud_agent_call(command, &answer, &policy).is_ok(),
                "{command}"
            );
        }
        // The flat form and a continue that overrides the policy.
        let flat = serde_json::json!({ "approval_policy": "AUTO" });
        assert!(check_cloud_agent_call("dispatch_target_submit", &flat, &off).is_err());
        assert!(check_cloud_agent_call("dispatch_target_continue", &submit("auto"), &off).is_err());
        for allowed in ["remote", "reject-and-report"] {
            assert!(
                check_cloud_agent_call("dispatch_target_submit", &submit(allowed), &off).is_ok(),
                "{allowed}"
            );
        }
    }

    #[test]
    fn device_switch_off_refuses() {
        let fenced = CloudAgentPolicy {
            accept_dispatch: false,
            allow_auto_approval: true,
        };
        let args = serde_json::json!({ "request": {} });
        for refused in [
            "dispatch_target_submit",
            "dispatch_target_continue",
            "dispatch_target_append",
            "dispatch_target_answer",
            "dispatch_target_query",
            "dispatch_target_workspace_provision",
            "open_workspace",
            "obp_remote_command",
        ] {
            let error = check_cloud_agent_call(refused, &args, &fenced).unwrap_err();
            assert!(
                error.starts_with("superagent_dispatch_disabled:"),
                "{refused}: {error}"
            );
        }
        // The agent can still see why, stop what it started, and relay a
        // model round (no work runs on the device).
        for allowed in [
            "dispatch_target_probe",
            "dispatch_target_status",
            "dispatch_target_list",
            "dispatch_target_cancel",
            "fleet_digest",
            "fleet_model_poll",
        ] {
            assert!(
                check_cloud_agent_call(allowed, &args, &fenced).is_ok(),
                "{allowed}"
            );
        }
    }

    #[test]
    fn legacy_directory_rows_without_a_kind_keep_the_account_device_scope() {
        assert_eq!(
            scope_for_device("d1".into(), None),
            Scope::AccountDevice {
                device_id: "d1".into()
            }
        );
        for kind in ["desktop", "cli", "mobile", "something_newer"] {
            assert!(matches!(
                scope_for_device("d1".into(), Some(kind)),
                Scope::AccountDevice { .. }
            ));
        }
        assert_eq!(
            scope_for_device("cloud-1".into(), Some(CLOUD_AGENT_DEVICE_KIND)),
            Scope::CloudAgent {
                device_id: "cloud-1".into()
            }
        );
    }

    #[test]
    fn the_model_relay_serves_account_devices_and_refuses_paired_clients() {
        let device = Scope::AccountDevice {
            device_id: "d1".into(),
        };
        let paired = Scope::PairedClient {
            client_id: "c1".into(),
        };
        for command in FLEET_MODEL_COMMANDS {
            // A session on another device of the account runs this
            // device's model through the relay.
            assert!(
                check_command(&device, command, &cloud_host_verbs).is_ok(),
                "{command}"
            );
            let error = check_command(&paired, command, &cloud_host_verbs).unwrap_err();
            assert!(
                error.starts_with("forbidden_for_scope:"),
                "{command}: {error}"
            );
        }
        // A host without the relay answers with a stable reason.
        let error = check_command(&device, "fleet_model_start", &desktop_verbs).unwrap_err();
        assert!(error.starts_with("fleet_model_unavailable:"), "{error}");
        assert!(check_command(&Scope::Owner, "fleet_model_start", &cloud_host_verbs).is_ok());
    }

    #[test]
    fn fleet_entry_verbs_admit_account_devices_and_refuse_paired_clients() {
        let no_verbs = |_: &str| false;
        let device = Scope::AccountDevice {
            device_id: "d1".into(),
        };
        let cloud = Scope::CloudAgent {
            device_id: "cloud-1".into(),
        };
        let paired = Scope::PairedClient {
            client_id: "c1".into(),
        };
        for command in openbitfun_product_domains::remote_surface::fleet_entry_commands() {
            assert!(
                check_command(&Scope::Owner, command, &no_verbs).is_ok(),
                "{command}"
            );
            // Admitted once the host registers the row as a backend command.
            let registered = operation(command)
                .is_some_and(|definition| definition.surface == OperationSurface::TauriCommand);
            if registered {
                assert!(
                    check_command(&device, command, &no_verbs).is_ok(),
                    "{command}"
                );
                assert!(
                    check_command(&cloud, command, &no_verbs).is_ok(),
                    "{command}"
                );
            }
            let refused = check_command(&paired, command, &no_verbs).unwrap_err();
            assert!(
                refused.starts_with("forbidden_for_scope:"),
                "{command}: {refused}"
            );
        }
    }

    #[test]
    fn cloud_node_commands_are_unsupported_on_a_device() {
        let device = Scope::AccountDevice {
            device_id: "d1".into(),
        };
        let paired = Scope::PairedClient {
            client_id: "c1".into(),
        };
        for scope in [&device, &paired] {
            let error = check(scope, "superagent_send").unwrap_err();
            assert!(
                error.starts_with(crate::UNSUPPORTED_IN_NATIVE_HOST),
                "{error}"
            );
            assert!(error.contains("cloud node"), "{error}");
        }
    }
}

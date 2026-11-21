//! OBP call dispatch for the CLI Peer Host.

use openbitfun_core_types::agent_identity_wire::{
    translate_agent_identity_command, AgentIdentityDialect,
};

use serde_json::Value;

use super::commands;
use super::state::peer_host_state;
use openbitfun_product_domains::remote_surface::{
    peer_host_verdict, PeerHostKind, PeerHostVerdict,
};

/// One OBP call on this host (an `account-device` connection over
/// OpenBitFun Link, `crate::obp_host`): the registry verdict for
/// `PeerHostKind::Cli`, arguments and results in the canonical agent-identity
/// dialect (what every OBP host answers), and the registry's refusal text for
/// a command this host does not run. There is no attach, detach or ping (the
/// connection is the attachment); the detached-dispatch target verbs run here.
pub(crate) async fn handle_obp_call(command: &str, args: Value) -> Result<Value, String> {
    match peer_host_verdict(command, PeerHostKind::Cli) {
        PeerHostVerdict::Refuse(refusal) => return Err(refusal.message(command)),
        PeerHostVerdict::HostControlPlane => {
            return match dispatch_target_verb(command) {
                Some(verb) => {
                    let workspace_path = args
                        .get("workspacePath")
                        .and_then(Value::as_str)
                        .map(str::to_string);
                    let answer = crate::dispatch::run_dispatch_verb(verb, args)
                        .await
                        .map_err(|error| format!("{error:#}"))?;
                    // The runner is another process: tell this host's
                    // catalog and digest.
                    crate::fleet_host::dispatch_target_answered(command, workspace_path).await;
                    Ok(answer)
                }
                None => Err(format!(
                    "command '{command}' is a peer control-plane command; an OBP connection needs no attach or ping"
                )),
            };
        }
        PeerHostVerdict::Execute => {}
    }
    let state = peer_host_state()?;
    let args = translate_agent_identity_command(command, args, AgentIdentityDialect::Canonical)?;
    commands::dispatch(command, &args, state).await
}

/// Whether `command` is a detached-dispatch target verb this host runs.
pub(crate) fn is_dispatch_target_command(command: &str) -> bool {
    dispatch_target_verb(command).is_some()
}

fn dispatch_target_verb(command: &str) -> Option<&'static str> {
    match command {
        "dispatch_target_probe" => Some("probe"),
        "dispatch_target_submit" => Some("submit"),
        "dispatch_target_status" => Some("status"),
        "dispatch_target_cancel" => Some("cancel"),
        "dispatch_target_list" => Some("list"),
        "dispatch_target_answer" => Some("answer"),
        "dispatch_target_append" => Some("append"),
        "dispatch_target_continue" => Some("continue"),
        "dispatch_target_query" => Some("query"),
        "dispatch_target_workspace_provision" => Some("workspace-provision"),
        "dispatch_target_workspace_provision_source" => Some("workspace-provision-source"),
        "dispatch_target_workspace_bundle_begin" => Some("workspace-bundle-begin"),
        "dispatch_target_workspace_bundle_chunk" => Some("workspace-bundle-chunk"),
        "dispatch_target_workspace_bundle_commit" => Some("workspace-bundle-commit"),
        "dispatch_target_workspace_sync" => Some("workspace-sync"),
        "dispatch_target_workspace_sync_chunk" => Some("workspace-sync-chunk"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::super::deny::{is_cli_unsupported_command, is_local_only_command};
    use super::*;
    use serde_json::json;

    #[tokio::test]
    async fn peer_control_plane_commands_are_not_obp_calls() {
        for command in [
            "peer_mode_ping",
            "peer_control_attach",
            "peer_control_detach",
        ] {
            assert!(
                handle_obp_call(command, json!({})).await.is_err(),
                "{command} must not run over OBP"
            );
        }
    }

    #[tokio::test]
    async fn local_only_commands_are_denied() {
        let err = handle_obp_call("account_logout", json!({}))
            .await
            .expect_err("account_logout stays on the controller");
        assert!(err.contains("local-only"), "{err}");
    }

    #[tokio::test]
    async fn retired_lsp_commands_fail_before_peer_state_or_command_dispatch() {
        let err = handle_obp_call("lsp_open_workspace", json!({}))
            .await
            .expect_err("retired command");
        assert_eq!(
            err,
            "command 'lsp_open_workspace' is unsupported because the OpenBitFun LSP runtime has been retired"
        );
    }

    #[test]
    fn detached_dispatch_uses_a_distinct_target_command_family() {
        assert_eq!(
            dispatch_target_verb("dispatch_target_submit"),
            Some("submit")
        );
        assert_eq!(dispatch_target_verb("dispatch_submit"), None);
        assert_eq!(dispatch_target_verb("dispatch_target_unknown"), None);
    }

    /// The verb table must answer exactly the `dispatch_target_*` family the
    /// registry routes to the host control plane.
    #[test]
    fn dispatch_target_verbs_match_registry() {
        use openbitfun_product_domains::remote_surface::{operations, PeerStance};
        for op in operations() {
            let is_target = op.id.starts_with("dispatch_target_");
            assert_eq!(
                dispatch_target_verb(op.id).is_some(),
                is_target,
                "{} verb table disagrees with the registry",
                op.id
            );
            if is_target {
                assert_eq!(op.peer, PeerStance::HostControlPlane, "{}", op.id);
            }
        }
    }

    #[tokio::test]
    async fn cli_unsupported_commands_keep_the_legacy_prefix_and_add_a_reason() {
        let err = handle_obp_call("worktree_list", json!({}))
            .await
            .expect_err("unsupported on the CLI");
        assert!(
            err.starts_with("command 'worktree_list' is not supported on CLI peer host"),
            "{err}"
        );
        assert!(err.contains(": "), "reason must be appended: {err}");
    }

    #[tokio::test]
    async fn browser_control_is_unsupported_not_local_only_on_cli() {
        let err = handle_obp_call("browser_control_launch", json!({}))
            .await
            .expect_err("unsupported on the CLI");
        assert!(err.contains("is not supported on CLI peer host"), "{err}");
        assert!(!err.contains("local-only"), "{err}");
    }

    #[tokio::test]
    async fn unknown_command_reports_host_version_mismatch() {
        let err = handle_obp_call("not_an_openbitfun_command", json!({}))
            .await
            .expect_err("unknown command");
        assert!(
            err.contains("is unknown to this OpenBitFun CLI peer host version"),
            "{err}"
        );
        assert!(!err.contains("is not supported on CLI peer host"), "{err}");
    }

    /// `cancel_tool` and `get_all_tools_info` were previously unimplemented on
    /// the CLI peer host, so a controller rendering a CLI Peer session saw an
    /// ineffective Interrupt button and an empty tool list. They are now
    /// implemented in `commands::dialog::cancel_tool` and
    /// `commands::tools::get_all_tools_info`; this test pins that neither is
    /// refused by the local-only or CLI-unsupported gate before reaching the
    /// implemented handler. A future regression that removes the handler but
    /// leaves the command routable would land in the unsupported fallthrough
    /// branch, not here — that is caught by the capability advertisement +
    /// frontend gate instead.
    #[test]
    fn interactive_tools_and_tool_catalog_are_not_refused_before_dispatch() {
        for command in ["cancel_tool", "get_all_tools_info", "submit_user_answers"] {
            assert!(
                !is_local_only_command(command),
                "{command} must be routable to the peer host"
            );
            assert!(
                !is_cli_unsupported_command(command),
                "{command} must reach its implemented handler, not the unsupported gate"
            );
        }
    }

    /// The file explorer controller reads the workspace through the
    /// `explorer_*` aliases, while the editor reads metadata, sync hashes and
    /// watch state. These rows used to be refused as "no remote-workspace UI
    /// surface", which broke the file tree, the `@` reference picker and the
    /// editor breadcrumb in every CLI Peer session even though this host
    /// already served the same reads under the historical names.
    #[test]
    fn file_explorer_surface_is_not_refused_before_dispatch() {
        for command in [
            "explorer_get_children",
            "explorer_get_children_paginated",
            "explorer_get_file_tree",
            "get_file_tree",
            "get_file_metadata",
            "get_file_editor_sync_hash",
            "create_file",
            "start_file_watch",
            "stop_file_watch",
            "get_watched_paths",
        ] {
            assert!(
                !is_local_only_command(command),
                "{command} must be routable to the peer host"
            );
            assert!(
                !is_cli_unsupported_command(command),
                "{command} must reach its implemented handler, not the unsupported gate"
            );
        }
    }
}

//! Fleet routing: how `fleet_call` finds the device that executes a command.
//!
//! A frontend sends every product command as `fleet_call {target, command,
//! args}` to the runtime host it is connected through. That host executes it
//! itself when it is the target, and otherwise makes a plain call on its link
//! to the target, which applies its own registry allowlist. This side table
//! of the Product Operation Registry says how the target is found:
//!
//! - `ByOwner { entity, path }`: the command acts on an existing session,
//!   workspace or terminal whose id sits at `path` in `args`. The fleet index
//!   checks the target against the id's owner; a mismatch is refused
//!   (`fleet_owner_mismatch`), never rerouted silently. Without a target the
//!   owner is used when the index knows exactly one.
//! - `ByTarget`: a device-scoped command (settings, models, MCP, skills,
//!   agents, cron, usage, opening a workspace, folder browsing); the frontend
//!   passes its device context. `reason` explains a row whose arguments carry
//!   an id that is not an owner key.
//! - `EntryLocal`: the controller-local and host-control-plane rows, which
//!   run on the client's own backend (native desktop only); phone and browser
//!   hide them by capability.
//!
//! One row per registered backend command (`op(...)` row) and per cloud-node
//! command (`cloud_node(...)`, always `ByTarget`), sorted by id, one per line. The `fleet_*` verbs themselves are never wrapped in a
//! `fleet_call` (`fleet_nested_call`), so they have no row here.
//! `pnpm run desktop-nsh:check-dispatch` proves every `ByOwner` path against
//! the handler's parameters and rejects a forwarded command that carries a
//! session or workspace id without a `ByOwner` row (or a `ByTarget` reason).

use serde::Serialize;

use super::{operation, PeerStance};

/// The kind of entity an owner key names. Ids are unique per device only, so
/// the fleet-wide key is `(deviceId, id)`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FleetEntity {
    Session,
    Workspace,
    Terminal,
}

/// How a `fleet_call` finds its target.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum FleetRoute {
    ByOwner {
        entity: FleetEntity,
        /// Dot-separated path into the call's `args`, with wire key names
        /// (for example `request.sessionId`).
        path: &'static str,
    },
    ByTarget {
        #[serde(skip_serializing_if = "Option::is_none")]
        reason: Option<&'static str>,
    },
    EntryLocal,
}

/// One routing row.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct FleetRouting {
    pub id: &'static str,
    pub route: FleetRoute,
}

/// The route of a command: its row, or `ByTarget` for a name without one (a
/// HostInvoke-only alias, a retired name, or a command a newer client knows
/// and the target may serve).
pub fn fleet_route(command: &str) -> FleetRoute {
    FLEET_ROUTES
        .binary_search_by(|row| row.id.cmp(command))
        .map(|index| FLEET_ROUTES[index].route)
        .unwrap_or(FleetRoute::ByTarget { reason: None })
}

/// Every routing row, sorted by id.
pub fn fleet_routes() -> &'static [FleetRouting] {
    FLEET_ROUTES
}

/// The value at a `ByOwner` path, when it is a non-empty string. The path
/// names the field's serde wire key; the other spelling of its last segment
/// (`sessionId` / `session_id`) is read too, since handlers accept both
/// through serde aliases.
pub fn owner_key_value<'a>(args: &'a serde_json::Value, path: &str) -> Option<&'a str> {
    let (parent_path, leaf) = path.rsplit_once('.').unwrap_or(("", path));
    let mut parent = args;
    if !parent_path.is_empty() {
        for segment in parent_path.split('.') {
            parent = parent.get(segment)?;
        }
    }
    let read = |key: &str| {
        parent
            .get(key)
            .and_then(|value| value.as_str())
            .filter(|id| !id.is_empty())
    };
    read(leaf).or_else(|| read(&other_spelling(leaf)))
}

/// `sessionId` <-> `session_id`.
fn other_spelling(key: &str) -> String {
    if key.contains('_') {
        let mut out = String::with_capacity(key.len());
        let mut upper = false;
        for c in key.chars() {
            if c == '_' {
                upper = true;
            } else if upper {
                out.extend(c.to_uppercase());
                upper = false;
            } else {
                out.push(c);
            }
        }
        out
    } else {
        let mut out = String::with_capacity(key.len() + 2);
        for c in key.chars() {
            if c.is_ascii_uppercase() {
                out.push('_');
                out.push(c.to_ascii_lowercase());
            } else {
                out.push(c);
            }
        }
        out
    }
}

/// Commands answered by the serving runtime host's fleet layer itself
/// (`PeerStance::FleetEntry`), sorted.
pub fn fleet_entry_commands() -> impl Iterator<Item = &'static str> {
    super::operations()
        .iter()
        .filter(|op| op.peer == PeerStance::FleetEntry)
        .map(|op| op.id)
}

/// Whether a command is a fleet verb (the `fleet_` prefix is reserved for
/// them), which a `fleet_call` must not wrap.
pub fn is_fleet_verb(command: &str) -> bool {
    command.starts_with("fleet_")
        || operation(command).is_some_and(|op| op.peer == PeerStance::FleetEntry)
}

const fn owner(id: &'static str, entity: FleetEntity, path: &'static str) -> FleetRouting {
    FleetRouting {
        id,
        route: FleetRoute::ByOwner { entity, path },
    }
}

const fn target(id: &'static str) -> FleetRouting {
    FleetRouting {
        id,
        route: FleetRoute::ByTarget { reason: None },
    }
}

const fn target_because(id: &'static str, reason: &'static str) -> FleetRouting {
    FleetRouting {
        id,
        route: FleetRoute::ByTarget {
            reason: Some(reason),
        },
    }
}

const fn local(id: &'static str) -> FleetRouting {
    FleetRouting {
        id,
        route: FleetRoute::EntryLocal,
    }
}

const OPENS_ON_CHOSEN_DEVICE: &str = "opens or reopens a workspace on the chosen device; workspace ids are per device (the same root on two devices shares one), so the id cannot pick the device";
const LIVE_VIEW_ON_PAGE_DEVICE: &str =
    "a live view reads the page on the device whose window holds it; the conversationId only picks among that device's pages";
const SIGN_IN_FLOW_ID: &str =
    "the sessionId is a sign-in flow id on the chosen device, not an agent session";

use FleetEntity::{Session, Terminal, Workspace};

#[rustfmt::skip]
const FLEET_ROUTES: &[FleetRouting] = &[
    owner("accept_file",                                               Session,   "request.session_id"),
    owner("accept_operation",                                          Workspace, "request.workspace_id"),
    owner("accept_session",                                            Session,   "request.session_id"),
    local("account_delete_device"),
    local("account_email_start"),
    local("account_email_verify"),
    local("account_get_credential_hint"),
    local("account_github_poll"),
    local("account_github_start"),
    local("account_identity"),
    local("account_list_devices"),
    local("account_login"),
    local("account_logout"),
    local("account_settings_sync_set"),
    local("account_settings_sync_status"),
    local("account_status"),
    local("account_token_expired"),
    local("account_update_device_alias"),
    owner("acknowledge_external_ecosystems_command",                   Workspace, "request.workspaceId"),
    owner("activate_session_goal",                                     Session,   "request.sessionId"),
    owner("add_skill",                                                 Workspace, "workspaceId"),
    target("ai_model_delete"),
    target("ai_model_upsert"),
    local("append_flow_chat_diagnostics"),
    owner("apply_external_hook_import_command",                        Workspace, "request.workspaceId"),
    owner("apply_external_mcp_import_command",                         Workspace, "request.workspaceId"),
    owner("apply_external_source_control_action_command",              Workspace, "request.workspaceId"),
    target("apply_patch"),
    owner("archive_all_sessions",                                      Workspace, "request.workspace_id"),
    owner("archive_session",                                           Session,   "request.session_id"),
    target("browser_control_disconnect"),
    target("browser_control_enable_default_cdp"),
    target("browser_control_get_status"),
    target("browser_control_launch"),
    target("browser_control_list_browsers"),
    target("browser_control_restart_with_cdp"),
    local("browser_get_url"),
    target_because("browser_webview_capture_preview",                          LIVE_VIEW_ON_PAGE_DEVICE),
    local("browser_webview_create"),
    local("browser_webview_eval"),
    local("browser_webview_navigate"),
    local("browser_webview_reload"),
    local("browser_webview_report_page_load"),
    local("browser_webview_set_agent_target_state"),
    local("browser_webview_set_bounds"),
    owner("btw_ask_stream",                                            Session,   "request.sessionId"),
    target("btw_cancel"),
    owner("cancel_acp_dialog_turn",                                    Session,   "request.sessionId"),
    local("cancel_app_update_download"),
    owner("cancel_dialog_turn",                                        Session,   "request.sessionId"),
    local("cancel_insights_generation"),
    target("cancel_mcp_remote_oauth"),
    target("cancel_search"),
    owner("cancel_session",                                            Session,   "request.sessionId"),
    target_because("cancel_subscription_login",                                 SIGN_IN_FLOW_ID),
    target("cancel_tool"),
    target("cancel_transfer"),
    target("canonicalize_agent_profile_configs"),
    target("check_command_exists"),
    target("check_commands_exist"),
    local("check_for_updates"),
    owner("check_git_isolation",                                       Workspace, "request.workspace_id"),
    owner("check_path_exists",                                         Workspace, "request.workspaceId"),
    owner("choose_external_mcp_conflict_command",                      Workspace, "request.workspaceId"),
    owner("choose_external_subagent_conflict_command",                 Workspace, "request.workspaceId"),
    local("clean_snapshot_storage"),
    target("cleanup_invalid_workspaces"),
    target("clear_decision_model_credential"),
    target("clear_mcp_remote_auth"),
    owner("clear_project_permission_grants",                           Workspace, "request.workspaceId"),
    owner("clear_session_thread_goal",                                 Session,   "request.sessionId"),
    target("clear_web_search_credential"),
    owner("close_workspace",                                           Workspace, "request.workspaceId"),
    owner("compact_session",                                           Session,   "request.sessionId"),
    owner("compile_workspace_latex",                                   Workspace, "request.workspaceId"),
    owner("compress_path",                                             Workspace, "request.workspaceId"),
    target("compute_diff"),
    target("computer_use_control_preview"),
    target("computer_use_control_status"),
    target("computer_use_control_stop"),
    target("computer_use_get_status"),
    target("computer_use_open_system_settings"),
    target("computer_use_request_permission"),
    target("computer_use_request_permissions"),
    target("computer_use_share_control"),
    target("computer_use_share_forget_grant"),
    target("computer_use_share_grants"),
    target("computer_use_share_input"),
    target("computer_use_share_observe"),
    target("computer_use_share_request"),
    target("computer_use_share_start"),
    target("computer_use_share_targets"),
    target("control_background_command"),
    owner("control_deep_review_queue",                                 Session,   "request.sessionId"),
    owner("copy_session",                                              Session,   "request.source_session_id"),
    owner("create_acp_flow_session",                                   Workspace, "request.workspaceId"),
    target("create_assistant_workspace"),
    target("create_control_conversation"),
    target("create_cron_job"),
    owner("create_custom_agent",                                       Workspace, "request.workspaceId"),
    owner("create_directory",                                          Workspace, "request.workspaceId"),
    owner("create_file",                                               Workspace, "request.workspaceId"),
    target("create_miniapp"),
    owner("create_session",                                            Workspace, "request.workspaceId"),
    owner("create_subagent",                                           Workspace, "request.workspaceId"),
    owner("decompress_path",                                           Workspace, "request.workspaceId"),
    local("delete_agent_companion_pet_package"),
    owner("delete_all_archived_sessions",                              Workspace, "request.workspace_id"),
    owner("delete_assistant_workspace",                                Workspace, "request.workspaceId"),
    target("delete_cron_job"),
    owner("delete_custom_agent",                                       Workspace, "request.workspaceId"),
    owner("delete_directory",                                          Workspace, "request.workspaceId"),
    owner("delete_file",                                               Workspace, "request.workspaceId"),
    target("delete_mcp_server"),
    target("delete_miniapp"),
    target("delete_model_pool"),
    target("delete_permission_rule"),
    owner("delete_persisted_session",                                  Session,   "request.session_id"),
    owner("delete_session",                                            Session,   "request.sessionId"),
    owner("delete_skill",                                              Workspace, "workspaceId"),
    owner("delete_subagent",                                           Workspace, "request.workspaceId"),
    owner("delete_terminal_profile",                                   Workspace, "request.workspaceId"),
    target("desktop_card_delete"),
    target("desktop_card_get"),
    target("desktop_card_list"),
    target("desktop_card_refresh"),
    target("desktop_card_set_always_on_top"),
    target("desktop_card_set_bounds"),
    target("desktop_card_set_checklist_item"),
    target("desktop_card_set_visible"),
    local("desktop_external_control"),
    target("device_records_overview"),
    local("dispatch_answer"),
    local("dispatch_append"),
    local("dispatch_cancel"),
    local("dispatch_continue"),
    local("dispatch_list_jobs"),
    local("dispatch_list_targets"),
    local("dispatch_load_transcript"),
    local("dispatch_probe_target"),
    local("dispatch_query"),
    local("dispatch_save_transcript"),
    local("dispatch_status"),
    local("dispatch_submit"),
    local("dispatch_sync_model_config"),
    local("dispatch_sync_result"),
    owner("download_skill_market",                                     Workspace, "request.workspaceId"),
    local("download_update"),
    target("editor_ai_cancel"),
    target("editor_ai_stream"),
    owner("ensure_assistant_bootstrap",                                Session,   "request.sessionId"),
    target("ensure_control_conversation"),
    owner("ensure_coordinator_session",                                Session,   "request.sessionId"),
    owner("execute_session_command",                                   Session,   "request.sessionId"),
    owner("execute_tool",                                              Workspace, "request.workspaceId"),
    owner("expand_external_prompt_command_command",                    Workspace, "request.workspaceId"),
    owner("explorer_get_children",                                     Workspace, "request.workspaceId"),
    owner("explorer_get_children_paginated",                           Workspace, "request.workspaceId"),
    owner("explorer_get_file_tree",                                    Workspace, "request.workspaceId"),
    target("export_config"),
    target("export_diagnostics_bundle"),
    owner("export_local_file_to_path",                                 Workspace, "request.workspaceId"),
    owner("export_session_transcript",                                 Session,   "request.session_id"),
    target("fetch_mcp_app_resource"),
    owner("fork_session",                                              Session,   "request.source_session_id"),
    target("generate_commit_message"),
    local("generate_insights"),
    owner("generate_session_title",                                    Session,   "request.sessionId"),
    target("get_acp_clients"),
    owner("get_acp_session_commands",                                  Session,   "request.sessionId"),
    owner("get_acp_session_options",                                   Session,   "request.sessionId"),
    target("get_agent_profile_config"),
    target("get_agent_profile_configs"),
    target("get_ai_model_catalog"),
    owner("get_all_modified_files",                                    Workspace, "request.workspace_id"),
    target("get_all_tools_info"),
    target("get_app_state"),
    target("get_app_version"),
    target("get_assistant_workspaces"),
    owner("get_available_modes",                                       Workspace, "request.workspaceId"),
    target("get_available_tools"),
    owner("get_baseline_snapshot_diff",                                Workspace, "request.workspace_id"),
    owner("get_chat_mcp_catalog",                                      Workspace, "request.workspaceId"),
    local("get_clipboard_files"),
    local("get_clipboard_image"),
    target("get_config"),
    target("get_configs"),
    target("get_current_workspace"),
    owner("get_custom_agent_detail",                                   Workspace, "request.workspaceId"),
    target("get_decision_model_credential_status"),
    target("get_default_review_team_definition"),
    owner("get_directory_children",                                    Workspace, "request.workspaceId"),
    owner("get_directory_children_paginated",                          Workspace, "request.workspaceId"),
    owner("get_external_ecosystem_awareness_command",                  Workspace, "request.workspaceId"),
    owner("get_external_hook_catalog",                                 Workspace, "request.workspaceId"),
    owner("get_external_hook_import_snapshot",                         Workspace, "request.workspaceId"),
    owner("get_external_source_control_snapshot",                      Workspace, "request.workspaceId"),
    owner("get_external_source_discovery_snapshot",                    Workspace, "request.workspaceId"),
    owner("get_external_source_snapshot",                              Workspace, "request.workspaceId"),
    owner("get_file_change_history",                                   Workspace, "request.workspace_id"),
    owner("get_file_diff",                                             Session,   "request.session_id"),
    owner("get_file_editor_sync_hash",                                 Workspace, "request.workspaceId"),
    owner("get_file_metadata",                                         Workspace, "request.workspaceId"),
    owner("get_file_tree",                                             Workspace, "request.workspaceId"),
    target("get_file_watch_status"),
    target("get_global_config_health"),
    target("get_global_config_status"),
    owner("get_global_skill_settings",                                 Workspace, "request.workspaceId"),
    target("get_health_status"),
    owner("get_instruction_source_catalog",                            Workspace, "request.workspaceId"),
    local("get_latest_insights"),
    local("get_local_models_dev_catalogs"),
    target("get_mcp_prompt"),
    target("get_mcp_remote_oauth_session"),
    target("get_mcp_server_status"),
    target("get_mcp_servers"),
    target("get_mcp_tool_ui_uri"),
    target("get_memory_paths"),
    target("get_miniapp"),
    target("get_miniapp_draft_storage"),
    target("get_miniapp_storage"),
    target("get_miniapp_versions"),
    owner("get_mode_skill_configs",                                    Workspace, "workspaceId"),
    target("get_model_configs"),
    target("get_model_pool_status"),
    target("get_model_pools"),
    owner("get_model_routing_status",                                  Session,   "request.sessionId"),
    target("get_models_dev_catalog_status"),
    owner("get_native_prompt_command_conflicts_command",               Workspace, "request.workspaceId"),
    target("get_opened_workspaces"),
    owner("get_operation_diff",                                        Workspace, "request.workspace_id"),
    owner("get_operation_summary",                                     Workspace, "request.workspace_id"),
    local("get_pending_update"),
    target("get_permission_settings"),
    target("get_personal_overview"),
    local("get_prevent_sleep_enabled"),
    target("get_primary_assistant_workspace"),
    owner("get_project_permission_rules",                              Workspace, "request.workspaceId"),
    target("get_readonly_tools_info"),
    target("get_recent_workspaces"),
    target("get_runtime_capabilities"),
    target("get_runtime_logging_info"),
    owner("get_session_file_diff_stats",                               Workspace, "request.workspace_id"),
    owner("get_session_files",                                         Session,   "request.session_id"),
    owner("get_session_interaction_mailbox",                           Session,   "request.sessionId"),
    owner("get_session_lineage",                                       Session,   "request.session_id"),
    owner("get_session_mode_catalog",                                  Session,   "request.sessionId"),
    owner("get_session_model_target",                                  Session,   "request.sessionId"),
    owner("get_session_operations",                                    Session,   "request.session_id"),
    owner("get_session_permission_mode",                               Session,   "request.sessionId"),
    owner("get_session_stats",                                         Session,   "request.session_id"),
    owner("get_session_thread_goal",                                   Session,   "request.sessionId"),
    owner("get_session_transcript_view",                               Session,   "request.session_id"),
    owner("get_session_turns",                                         Session,   "request.session_id"),
    owner("get_session_usage_report",                                  Session,   "request.session_id"),
    target("get_settings_schema"),
    owner("get_skill_configs",                                         Workspace, "workspaceId"),
    owner("get_snapshot_sessions",                                     Workspace, "request.workspace_id"),
    owner("get_snapshot_system_stats",                                 Workspace, "request.workspace_id"),
    target("get_startup_native_trace"),
    target("get_statistics"),
    owner("get_subagent_detail",                                       Workspace, "request.workspaceId"),
    target("get_subscription_account_quota"),
    target_because("get_subscription_login_status",                             SIGN_IN_FLOW_ID),
    target("get_system_info"),
    owner("get_terminal_profiles",                                     Workspace, "request.workspaceId"),
    target("get_token_usage_activity"),
    target("get_token_usage_statistics"),
    target("get_tool_info"),
    owner("get_turn_files",                                            Session,   "request.session_id"),
    target("get_watched_paths"),
    target("get_web_search_credential_status"),
    owner("get_workspace_icon",                                        Workspace, "request.workspaceId"),
    target("get_workspace_navigator"),
    owner("get_workspace_reference_snapshot",                          Workspace, "request.workspaceId"),
    owner("git_add_files",                                             Workspace, "request.workspaceId"),
    owner("git_add_worktree",                                          Workspace, "request.workspaceId"),
    owner("git_checkout_branch",                                       Workspace, "request.workspaceId"),
    owner("git_cherry_pick",                                           Workspace, "request.workspaceId"),
    owner("git_cherry_pick_abort",                                     Workspace, "request.workspaceId"),
    owner("git_cherry_pick_continue",                                  Workspace, "request.workspaceId"),
    owner("git_commit",                                                Workspace, "request.workspaceId"),
    owner("git_commit_and_checkout",                                   Workspace, "request.workspaceId"),
    owner("git_create_branch",                                         Workspace, "request.workspaceId"),
    owner("git_delete_branch",                                         Workspace, "request.workspaceId"),
    owner("git_discard_files",                                         Workspace, "request.workspaceId"),
    owner("git_get_branches",                                          Workspace, "request.workspaceId"),
    owner("git_get_changed_files",                                     Workspace, "request.workspaceId"),
    owner("git_get_commits",                                           Workspace, "request.workspaceId"),
    owner("git_get_diff",                                              Workspace, "request.workspaceId"),
    owner("git_get_enhanced_branches",                                 Workspace, "request.workspaceId"),
    owner("git_get_file_content",                                      Workspace, "request.workspaceId"),
    owner("git_get_graph",                                             Workspace, "workspaceId"),
    owner("git_get_repository",                                        Workspace, "request.workspaceId"),
    owner("git_get_repository_basic",                                  Workspace, "request.workspaceId"),
    owner("git_get_repository_trust",                                  Workspace, "request.workspaceId"),
    owner("git_get_status",                                            Workspace, "request.workspaceId"),
    owner("git_get_tracked_change_count",                              Workspace, "request.workspaceId"),
    owner("git_is_repository",                                         Workspace, "request.workspaceId"),
    owner("git_list_worktrees",                                        Workspace, "request.workspaceId"),
    owner("git_pull",                                                  Workspace, "request.workspaceId"),
    owner("git_push",                                                  Workspace, "request.workspaceId"),
    owner("git_remove_worktree",                                       Workspace, "request.workspaceId"),
    owner("git_reset_files",                                           Workspace, "request.workspaceId"),
    owner("git_reset_to_commit",                                       Workspace, "request.workspaceId"),
    owner("git_resolve_revision",                                      Workspace, "request.workspaceId"),
    owner("git_trust_repository",                                      Workspace, "request.workspaceId"),
    owner("git_unwatch_status",                                        Workspace, "request.workspaceId"),
    owner("git_watch_status",                                          Workspace, "request.workspaceId"),
    target("grant_miniapp_path"),
    target("grant_miniapp_workspace"),
    local("has_insights_data"),
    local("hide_agent_companion_desktop_pet"),
    local("hide_main_window_after_close_request"),
    local("host_shell_attach"),
    local("host_shell_respond"),
    local("html_preview_create"),
    owner("html_preview_read_resource",                                Workspace, "request.workspaceId"),
    local("html_preview_release"),
    local("i18n_get_config"),
    local("i18n_get_current_language"),
    local("i18n_get_supported_languages"),
    local("i18n_set_config"),
    local("i18n_set_language"),
    local("import_agent_companion_pet_package"),
    target("import_config"),
    owner("import_terminal_profiles",                                  Workspace, "request.workspaceId"),
    target("initialize_acp_clients"),
    target("initialize_ai"),
    target("initialize_mcp_servers"),
    target("initialize_mcp_servers_non_destructive"),
    local("initialize_tray_after_startup"),
    target("initialize_workspace_startup_state"),
    local("inspect_snapshot_storage"),
    target("install_acp_client_cli"),
    local("install_pending_update"),
    local("install_update"),
    owner("interrupt_dialog_turn",                                     Session,   "request.sessionId"),
    owner("launch_review",                                             Session,   "request.parentSessionId"),
    local("list_agent_companion_pets"),
    target("list_agent_tool_names"),
    target("list_ai_models_by_config"),
    owner("list_archived_sessions",                                    Workspace, "request.workspace_id"),
    owner("list_background_command_activities",                        Session,   "request.agentSessionId"),
    owner("list_cron_jobs",                                            Workspace, "request.workspaceId"),
    owner("list_directory_files",                                      Workspace, "request.workspaceId"),
    owner("list_manageable_subagents",                                 Workspace, "request.workspaceId"),
    target("list_mcp_prompts"),
    target("list_mcp_resources"),
    target("list_miniapps"),
    target("list_pending_permission_requests"),
    owner("list_persisted_sessions",                                   Workspace, "request.workspace_id"),
    owner("list_persisted_sessions_page",                              Workspace, "request.workspace_id"),
    owner("list_project_permission_audit",                             Workspace, "request.workspaceId"),
    owner("list_project_permission_grants",                            Workspace, "request.workspaceId"),
    target("list_removed_external_sessions"),
    owner("list_session_commands",                                     Session,   "request.sessionId"),
    owner("list_sessions",                                             Workspace, "request.workspaceId"),
    target("list_skill_market"),
    owner("list_subagents",                                            Workspace, "request.workspaceId"),
    target("list_subscription_account_instances"),
    target("list_subscription_accounts"),
    owner("list_visible_subagents",                                    Workspace, "request.workspaceId"),
    target("load_acp_json_config"),
    local("load_agent_companion_pet_spritesheet"),
    local("load_agent_companion_pet_still"),
    target("load_git_repo_history"),
    local("load_insights_report"),
    target("load_mcp_json_config"),
    owner("load_persisted_session_metadata",                           Session,   "request.session_id"),
    owner("load_session_event_backfill",                               Session,   "request.sessionId"),
    owner("load_session_trajectory",                                   Session,   "request.sessionId"),
    owner("load_session_turn_window",                                  Session,   "request.sessionId"),
    owner("load_session_turns",                                        Session,   "request.session_id"),
    target("logout_subscription_account"),
    target("logout_subscription_account_instance"),
    owner("manage_dialog_queue",                                       Session,   "request.sessionId"),
    local("mark_miniapp_web_surface_ready"),
    local("mark_openbitfun_control_surface_ready"),
    local("mark_openbitfun_control_surface_unready"),
    owner("mark_session_seen",                                         Session,   "request.sessionId"),
    local("mesh_list_devices"),
    local("mesh_status"),
    target("miniapp_account_catalog"),
    owner("miniapp_agent_cancel",                                      Session,   "request.sessionId"),
    target("miniapp_agent_cancel_stale_runs"),
    owner("miniapp_agent_ensure_session",                              Session,   "request.sessionId"),
    owner("miniapp_agent_run",                                         Session,   "request.sessionId"),
    owner("miniapp_agent_turn_text",                                   Session,   "request.sessionId"),
    target("miniapp_ai_cancel"),
    target("miniapp_ai_chat"),
    target("miniapp_ai_complete"),
    target("miniapp_ai_list_models"),
    target("miniapp_apply_draft"),
    target("miniapp_create_draft"),
    target("miniapp_decline_builtin_update"),
    target("miniapp_dialog_message"),
    target("miniapp_discard_draft"),
    target("miniapp_draft_host_call"),
    target("miniapp_draft_worker_call"),
    target("miniapp_draft_worker_stop"),
    target("miniapp_get_customization_metadata"),
    target("miniapp_get_draft"),
    target("miniapp_host_call"),
    target("miniapp_import_from_path"),
    target("miniapp_inline"),
    target("miniapp_install_deps"),
    target("miniapp_market_browse"),
    target("miniapp_market_get_listing"),
    target("miniapp_market_import_package"),
    target("miniapp_market_inspect_package"),
    target("miniapp_market_install"),
    target("miniapp_market_installed_origins"),
    target("miniapp_market_installed_status"),
    target("miniapp_market_list_submissions"),
    target("miniapp_market_set_favorite"),
    target("miniapp_market_set_rating"),
    target("miniapp_market_withdraw_submission"),
    target("miniapp_permission_diff_for_draft"),
    local("miniapp_presentation"),
    target("miniapp_recompile"),
    target("miniapp_runtime_status"),
    target("miniapp_set_draft_permissions"),
    local("miniapp_shell_call"),
    target("miniapp_sync_draft_from_fs"),
    target("miniapp_sync_from_fs"),
    target("miniapp_worker_call"),
    target("miniapp_worker_list_running"),
    target("miniapp_worker_stop"),
    local("minimize_to_tray"),
    owner("mutate_external_hook_import_command",                       Workspace, "request.workspaceId"),
    target("notify_cron_host_ready"),
    local("obp_create_pairing"),
    local("obp_get_status"),
    local("obp_revoke_paired_client"),
    target("open_html_file_in_browser"),
    target("open_remote_workspace"),
    target_because("open_workspace",                                            OPENS_ON_CHOSEN_DEVICE),
    owner("paste_files",                                               Workspace, "request.workspaceId"),
    local("peer_link_call"),
    local("peer_link_connect"),
    local("peer_link_disconnect"),
    local("peer_link_events"),
    owner("plan_external_hook_import_command",                         Workspace, "request.workspaceId"),
    owner("plan_external_mcp_import_command",                          Workspace, "request.workspaceId"),
    target("predownload_acp_client_adapter"),
    target("preview_commit_message"),
    target("preview_cron_occurrences"),
    target("probe_acp_client_requirements"),
    target("probe_magpie_gateway"),
    target("product_control_invoke"),
    target("project_ai_model_reasoning_catalog"),
    target("quick_commit_message"),
    local("quit_app"),
    target("read_background_command_output"),
    owner("read_file_content",                                         Workspace, "request.workspaceId"),
    target("read_mcp_resource"),
    owner("record_voice_exchange",                                     Session,   "request.sessionId"),
    owner("recover_interrupted_dialog_turn",                           Session,   "request.sessionId"),
    target("refresh_model_client"),
    target("refresh_models_dev_catalog_now"),
    target("refresh_subscription_account"),
    target("refresh_subscription_account_instance"),
    owner("reject_file",                                               Session,   "request.session_id"),
    owner("reject_operation",                                          Workspace, "request.workspace_id"),
    target("reload_config"),
    owner("reload_custom_agents",                                      Workspace, "request.workspaceId"),
    owner("reload_session_context",                                    Session,   "request.sessionId"),
    owner("reload_subagents",                                          Workspace, "request.workspaceId"),
    target("remote_close_workspace"),
    local("remote_connect_configure_bot"),
    local("remote_connect_get_bot_verbose_mode"),
    local("remote_connect_get_device_info"),
    local("remote_connect_get_form_state"),
    local("remote_connect_get_methods"),
    local("remote_connect_set_allowed"),
    local("remote_connect_set_bot_verbose_mode"),
    local("remote_connect_set_form_state"),
    local("remote_connect_start"),
    local("remote_connect_status"),
    local("remote_connect_stop"),
    local("remote_connect_stop_bot"),
    local("remote_connect_weixin_qr_poll"),
    local("remote_connect_weixin_qr_start"),
    target("remote_create_dir"),
    target("remote_download_to_local_path"),
    target("remote_execute"),
    target("remote_exists"),
    target("remote_get_tree"),
    target("remote_get_workspace_info"),
    target("remote_open_workspace"),
    target("remote_read_dir"),
    target("remote_read_file"),
    target("remote_remove"),
    target("remote_remove_workspace"),
    target("remote_rename"),
    target("remote_upload_from_local_path"),
    owner("remote_workspace_ensure_connected",                         Workspace, "request.workspaceId"),
    target("remote_workspace_link_states"),
    target("remote_write_file"),
    owner("remove_project_permission_grant",                           Workspace, "request.workspaceId"),
    owner("remove_recent_workspace",                                   Workspace, "request.workspaceId"),
    owner("rename_file",                                               Workspace, "request.workspaceId"),
    target("reorder_opened_workspaces"),
    owner("replace_mode_skill_selection",                              Workspace, "request.workspaceId"),
    local("report_ide_control_result"),
    local("report_miniapp_web_result"),
    local("report_openbitfun_control_result"),
    target("reset_agent_profile_config"),
    owner("reset_assistant_workspace",                                 Workspace, "request.workspaceId"),
    target("reset_config"),
    target("reset_memory"),
    owner("reset_mode_skill_selection",                                Workspace, "request.workspaceId"),
    owner("reset_workspace_persona_files",                             Workspace, "request.workspaceId"),
    local("resize_agent_companion_desktop_pet"),
    local("resolve_ai_model_request_url"),
    target("respond_permission"),
    target("respond_permission_batch"),
    local("restart_app"),
    target("restart_mcp_server"),
    owner("restore_removed_external_session",                          Session,   "request.sessionId"),
    owner("restore_session",                                           Session,   "request.sessionId"),
    owner("restore_session_view",                                      Session,   "request.sessionId"),
    owner("restore_session_with_turns",                                Session,   "request.sessionId"),
    target("retry_file_watch"),
    target("retry_model_pool_member"),
    owner("reveal_external_source_location",                           Workspace, "request.workspaceId"),
    owner("reveal_in_explorer",                                        Workspace, "request.workspaceId"),
    target("reveal_models_dev_cache_directory"),
    owner("reveal_session_storage_directory",                          Session,   "request.session_id"),
    target("review_platform_clear_auth_token"),
    owner("review_platform_get_issue",                                 Workspace, "request.workspaceId"),
    owner("review_platform_get_pull_request_ci_log",                   Workspace, "request.workspaceId"),
    owner("review_platform_get_pull_request_detail",                   Workspace, "request.workspaceId"),
    owner("review_platform_get_pull_request_detail_page",              Workspace, "request.workspaceId"),
    owner("review_platform_get_pull_request_review_target",            Workspace, "request.workspaceId"),
    owner("review_platform_get_pull_request_review_target_by_identity", Workspace, "request.workspaceId"),
    owner("review_platform_get_workspace_context",                     Workspace, "request.workspaceId"),
    owner("review_platform_get_workspace_snapshot",                    Workspace, "request.workspaceId"),
    target("review_platform_update_auth_token"),
    target("rollback_miniapp"),
    owner("rollback_session",                                          Session,   "request.session_id"),
    owner("rollback_session_to_turn",                                  Session,   "request.sessionId"),
    owner("run_init_agents_md",                                        Session,   "request.sessionId"),
    owner("run_system_command",                                        Workspace, "request.workspaceId"),
    target("save_acp_json_config"),
    target("save_cloud_speech_config"),
    target("save_decision_model_credential"),
    target("save_git_repo_history"),
    target("save_mcp_json_config"),
    owner("save_merged_diff_content",                                  Workspace, "request.workspaceId"),
    target("save_model_pool"),
    owner("save_project_permission_rules",                             Workspace, "request.workspaceId"),
    owner("save_session_metadata",                                     Workspace, "request.workspace_id"),
    owner("save_session_turn",                                         Workspace, "request.workspace_id"),
    target("save_web_search_credential"),
    owner("scan_workspace_info",                                       Workspace, "request.workspaceId"),
    owner("search_build_index",                                        Workspace, "request.workspaceId"),
    owner("search_file_contents",                                      Workspace, "request.workspaceId"),
    owner("search_filenames",                                          Workspace, "request.workspaceId"),
    owner("search_files",                                              Workspace, "request.workspaceId"),
    owner("search_get_repo_status",                                    Workspace, "request.workspaceId"),
    owner("search_rebuild_index",                                      Workspace, "request.workspaceId"),
    target("search_referenceable_sessions"),
    owner("search_session_content",                                    Workspace, "request.workspaceId"),
    target("search_skill_market"),
    target("send_background_command_input"),
    target("send_mcp_app_message"),
    target("send_system_notification"),
    target("set_acp_client_permission_mode"),
    owner("set_acp_session_config_option",                             Session,   "request.sessionId"),
    owner("set_acp_session_model",                                     Session,   "request.sessionId"),
    owner("set_active_workspace",                                      Workspace, "request.workspaceId"),
    target("set_agent_profile_config"),
    target("set_approval_settings"),
    owner("set_assistant_identity",                                    Workspace, "request.workspaceId"),
    target("set_config"),
    owner("set_external_mcp_server_decision_command",                  Workspace, "request.workspaceId"),
    owner("set_external_mcp_servers_enabled_command",                  Workspace, "request.workspaceId"),
    owner("set_external_source_conflict_choice_command",               Workspace, "request.workspaceId"),
    owner("set_external_source_enabled_command",                       Workspace, "request.workspaceId"),
    owner("set_external_subagent_activation_command",                  Workspace, "request.workspaceId"),
    owner("set_external_subagent_model_binding_command",               Workspace, "request.workspaceId"),
    owner("set_external_subagents_enabled_command",                    Workspace, "request.workspaceId"),
    owner("set_external_tool_conflict_choice_command",                 Workspace, "request.workspaceId"),
    owner("set_external_tool_target_decision_command",                 Workspace, "request.workspaceId"),
    owner("set_external_tool_targets_enabled_command",                 Workspace, "request.workspaceId"),
    owner("set_global_skill_disabled",                                 Workspace, "request.workspaceId"),
    target("set_miniapp_draft_storage"),
    target("set_miniapp_storage"),
    owner("set_mode_skill_disabled",                                   Workspace, "workspaceId"),
    owner("set_native_prompt_command_conflict_choice_command",         Workspace, "request.workspaceId"),
    target("set_permission_mode"),
    local("set_prevent_sleep_enabled"),
    owner("set_primary_assistant_workspace",                           Workspace, "request.workspaceId"),
    owner("set_session_memory_mode",                                   Session,   "request.sessionId"),
    owner("set_session_thread_goal_status",                            Session,   "request.sessionId"),
    owner("set_subagent_timeout",                                      Session,   "request.sessionId"),
    target("set_subscription_account_enabled"),
    target("set_superagent_settings"),
    target("set_task_model"),
    local("set_tray_unread_count"),
    target("set_web_search_provider"),
    owner("set_workspace_icon",                                        Workspace, "request.workspaceId"),
    local("show_agent_companion_desktop_pet"),
    local("show_main_window"),
    local("speech_append_audio_chunk"),
    local("speech_append_realtime_audio"),
    local("speech_cancel_input_session"),
    local("speech_cancel_model_download"),
    local("speech_cancel_realtime_response"),
    local("speech_close_realtime_session"),
    local("speech_commit_realtime_audio"),
    local("speech_delete_model"),
    local("speech_download_model"),
    local("speech_finish_input_session"),
    local("speech_get_realtime_config"),
    local("speech_list_models"),
    local("speech_save_realtime_config"),
    local("speech_send_realtime_tool_result"),
    local("speech_speak_realtime_text"),
    local("speech_start_input_session"),
    local("speech_start_realtime_session"),
    local("speech_verify_model"),
    target("ssh_connect"),
    target("ssh_delete_connection"),
    target("ssh_disconnect"),
    target("ssh_disconnect_all"),
    target("ssh_get_config"),
    target("ssh_get_server_info"),
    target("ssh_has_stored_password"),
    target("ssh_is_connected"),
    target("ssh_list_config_hosts"),
    target("ssh_list_docker_containers"),
    target("ssh_list_port_forwards"),
    target("ssh_list_remote_listening_ports"),
    target("ssh_list_saved_connections"),
    target("ssh_list_wsl_distributions"),
    target("ssh_save_connection"),
    target("ssh_start_port_forward"),
    target("ssh_stop_port_forward"),
    target("ssh_test_connection"),
    owner("start_acp_dialog_turn",                                     Session,   "request.sessionId"),
    owner("start_dialog_turn",                                         Session,   "request.sessionId"),
    owner("start_file_watch",                                          Workspace, "request.workspaceId"),
    target("start_mcp_remote_oauth"),
    target("start_mcp_server"),
    owner("start_search_file_contents_stream",                         Workspace, "request.workspaceId"),
    owner("start_search_filenames_stream",                             Workspace, "request.workspaceId"),
    target_because("start_subscription_account_login",                          SIGN_IN_FLOW_ID),
    target_because("start_subscription_login",                                  SIGN_IN_FLOW_ID),
    owner("start_user_question_interaction",                           Session,   "request.sessionId"),
    owner("steer_dialog_turn",                                         Session,   "request.sessionId"),
    target("stop_acp_client"),
    owner("stop_dialog_turn",                                          Session,   "request.sessionId"),
    owner("stop_file_watch",                                           Workspace, "request.workspaceId"),
    target("stop_mcp_server"),
    target("submit_acp_permission_response"),
    target("submit_mcp_interaction_response"),
    target("submit_user_answers"),
    owner("submit_user_message",                                       Session,   "request.sessionId"),
    target("subscribe_permission_requests"),
    target("superagent_cancel_turn"),
    target("superagent_delete_conversation"),
    target("superagent_delete_data"),
    target("superagent_disable"),
    target("superagent_enable"),
    target("superagent_get_conversation"),
    target("superagent_job_action"),
    target("superagent_list_conversations"),
    target("superagent_rename_conversation"),
    target("superagent_send"),
    target("superagent_set_model"),
    target("superagent_status"),
    owner("terminal_ack",                                              Terminal,  "request.sessionId"),
    owner("terminal_close",                                            Terminal,  "request.sessionId"),
    owner("terminal_create",                                           Workspace, "request.workspaceId"),
    owner("terminal_execute",                                          Terminal,  "request.sessionId"),
    owner("terminal_get",                                              Terminal,  "sessionId"),
    owner("terminal_get_history",                                      Terminal,  "sessionId"),
    target("terminal_get_shells"),
    owner("terminal_has_shell_integration",                            Terminal,  "sessionId"),
    target("terminal_list"),
    owner("terminal_resize",                                           Terminal,  "request.sessionId"),
    owner("terminal_send_command",                                     Terminal,  "request.sessionId"),
    target("terminal_shutdown_all"),
    owner("terminal_signal",                                           Terminal,  "request.sessionId"),
    owner("terminal_write",                                            Terminal,  "request.sessionId"),
    target("test_ai_config_connection"),
    target("test_ai_connection"),
    target("test_image_generation_service"),
    local("toggle_main_window_fullscreen"),
    owner("touch_session_activity",                                    Session,   "request.session_id"),
    target("ui_bundle_manifest"),
    owner("unarchive_session",                                         Session,   "request.session_id"),
    owner("update_active_turn_permission_mode",                        Session,   "request.sessionId"),
    target("update_app_status"),
    target("update_cron_job"),
    owner("update_custom_agent",                                       Workspace, "request.workspaceId"),
    owner("update_external_integration_policy_command",                Workspace, "request.workspaceId"),
    target("update_mcp_remote_auth"),
    target("update_miniapp"),
    owner("update_session_mode",                                       Session,   "request.sessionId"),
    owner("update_session_model",                                      Session,   "request.sessionId"),
    owner("update_session_model_target",                               Session,   "request.sessionId"),
    owner("update_session_permission_mode",                            Session,   "request.sessionId"),
    owner("update_session_thread_goal_objective",                      Session,   "request.sessionId"),
    owner("update_session_title",                                      Session,   "request.sessionId"),
    owner("update_subagent",                                           Workspace, "request.workspaceId"),
    owner("update_subagent_config",                                    Workspace, "request.workspaceId"),
    owner("update_workspace_info",                                     Workspace, "request.workspaceId"),
    target("upload_image_contexts"),
    target("upsert_permission_rule"),
    owner("upsert_terminal_profile",                                   Workspace, "request.workspaceId"),
    target("validate_config"),
    target("validate_cron_job_draft"),
    owner("validate_skill_path",                                       Workspace, "workspaceId"),
    owner("validate_tool_input",                                       Workspace, "request.workspaceId"),
    owner("workspace_file_upload",                                     Workspace, "request.workspaceId"),
    owner("worktree_bind_session",                                     Session,   "request.sessionId"),
    owner("worktree_create",                                           Workspace, "request.projectWorkspaceId"),
    owner("worktree_create_branch",                                    Workspace, "request.projectWorkspaceId"),
    owner("worktree_list",                                             Workspace, "request.projectWorkspaceId"),
    target("worktree_list_projects"),
    owner("worktree_promote",                                          Workspace, "request.projectWorkspaceId"),
    owner("worktree_recreate",                                         Workspace, "request.projectWorkspaceId"),
    owner("worktree_remove",                                           Workspace, "request.projectWorkspaceId"),
    local("write_clipboard_image"),
    owner("write_file_content",                                        Workspace, "request.workspaceId"),
];

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use super::*;
    use crate::remote_surface::{operations, OperationDefinition, OperationSurface};

    /// Whether a registry row needs a routing row: every registered backend
    /// command that is not retired.
    fn needs_route(op: &OperationDefinition) -> bool {
        // Fleet verbs are answered by the entry itself and never travel
        // inside a `fleet_call` (`fleet_nested_call`).
        matches!(
            op.surface,
            OperationSurface::TauriCommand | OperationSurface::CloudNode
        ) && !matches!(op.peer, PeerStance::Retired { .. } | PeerStance::FleetEntry)
    }

    #[test]
    fn routes_are_sorted_unique_and_name_registry_rows() {
        for window in FLEET_ROUTES.windows(2) {
            assert!(
                window[0].id < window[1].id,
                "fleet routes must be sorted by id and unique: {} then {}",
                window[0].id,
                window[1].id
            );
        }
        for row in FLEET_ROUTES {
            let op = operation(row.id)
                .unwrap_or_else(|| panic!("fleet route {} has no registry row", row.id));
            assert!(
                needs_route(op),
                "{} is not a registered, live backend command; drop its fleet route",
                row.id
            );
        }
    }

    /// The registry closure: every registered backend command declares how a
    /// `fleet_call` reaches it, consistent with its peer stance.
    #[test]
    fn every_registered_command_has_one_consistent_route() {
        let routed: BTreeSet<&str> = FLEET_ROUTES.iter().map(|row| row.id).collect();
        let missing: Vec<&str> = operations()
            .iter()
            .filter(|op| needs_route(op))
            .map(|op| op.id)
            .filter(|id| !routed.contains(id))
            .collect();
        assert!(
            missing.is_empty(),
            "registered commands without a fleet route (add one row to \
             remote_surface/fleet_routing.rs: owner(..) when the request names an existing \
             session, workspace or terminal, else target(..); local(..) for controller-local rows): {missing:?}"
        );
        for row in FLEET_ROUTES {
            let op = operation(row.id).unwrap();
            let entry_local = matches!(
                op.peer,
                PeerStance::ControllerLocal | PeerStance::HostControlPlane
            );
            match row.route {
                FleetRoute::EntryLocal => assert!(
                    entry_local,
                    "{} is forwarded to peers ({:?}); it cannot be EntryLocal",
                    row.id, op.peer
                ),
                FleetRoute::ByOwner { .. } | FleetRoute::ByTarget { .. } => assert!(
                    matches!(op.peer, PeerStance::Proxied | PeerStance::OperatorOnly),
                    "{} stays on the client's own backend ({:?}); route it local(..)",
                    row.id,
                    op.peer
                ),
            }
        }
    }

    #[test]
    fn owner_paths_are_well_formed_and_entities_match_the_family() {
        for row in FLEET_ROUTES {
            match row.route {
                FleetRoute::ByOwner { entity, path } => {
                    assert!(
                        !path.is_empty()
                            && path.split('.').all(|segment| {
                                !segment.is_empty()
                                    && segment
                                        .chars()
                                        .all(|c| c.is_ascii_alphanumeric() || c == '_')
                            }),
                        "{}: malformed owner path {path:?}",
                        row.id
                    );
                    let leaf = path.rsplit('.').next().unwrap().to_ascii_lowercase();
                    assert!(
                        leaf.ends_with("id"),
                        "{}: owner path {path:?} must name an id",
                        row.id
                    );
                    if row.id.starts_with("terminal_") && row.id != "terminal_create" {
                        assert_eq!(entity, FleetEntity::Terminal, "{}", row.id);
                    } else {
                        assert_ne!(
                            entity,
                            FleetEntity::Terminal,
                            "{}: only terminal commands are owned by a terminal",
                            row.id
                        );
                    }
                }
                FleetRoute::ByTarget {
                    reason: Some(reason),
                } => {
                    assert!(!reason.trim().is_empty(), "{} has an empty reason", row.id)
                }
                _ => {}
            }
        }
    }

    #[test]
    fn known_anchors_route_as_designed() {
        let owner_of = |id: &str| match fleet_route(id) {
            FleetRoute::ByOwner { entity, path } => Some((entity, path)),
            _ => None,
        };
        assert_eq!(
            owner_of("start_dialog_turn"),
            Some((FleetEntity::Session, "request.sessionId"))
        );
        assert_eq!(
            owner_of("get_session_transcript_view"),
            Some((FleetEntity::Session, "request.session_id")),
            "owner paths use the serde wire key the clients send"
        );
        assert_eq!(
            owner_of("list_persisted_sessions_page"),
            Some((FleetEntity::Workspace, "request.workspace_id"))
        );
        assert_eq!(
            owner_of("create_session"),
            Some((FleetEntity::Workspace, "request.workspaceId")),
            "a new session belongs to the workspace's device"
        );
        assert_eq!(
            owner_of("terminal_write"),
            Some((FleetEntity::Terminal, "request.sessionId"))
        );
        assert_eq!(
            owner_of("terminal_create"),
            Some((FleetEntity::Workspace, "request.workspaceId")),
            "without a workspace, terminal_create goes to the given target"
        );
        assert_eq!(
            owner_of("fork_session"),
            Some((FleetEntity::Session, "request.source_session_id"))
        );
        for device_scoped in [
            "get_config",
            "set_config",
            "respond_permission",
            "submit_user_answers",
            "get_workspace_navigator",
        ] {
            assert!(
                matches!(fleet_route(device_scoped), FleetRoute::ByTarget { .. }),
                "{device_scoped} is device-scoped"
            );
        }
        assert!(matches!(
            fleet_route("open_workspace"),
            FleetRoute::ByTarget { reason: Some(_) }
        ));
        assert_eq!(fleet_route("account_login"), FleetRoute::EntryLocal);
        assert_eq!(fleet_route("show_main_window"), FleetRoute::EntryLocal);
        assert_eq!(
            fleet_route("get_workspace_info"),
            FleetRoute::ByTarget { reason: None },
            "a HostInvoke-only alias has no row and goes to the target"
        );
        assert_eq!(
            fleet_route("a_command_from_a_newer_client"),
            FleetRoute::ByTarget { reason: None }
        );
    }

    #[test]
    fn fleet_verbs_are_answered_by_the_serving_host_and_never_wrapped() {
        let entry: BTreeSet<&str> = fleet_entry_commands().collect();
        assert_eq!(
            entry,
            BTreeSet::from([
                "fleet_attention",
                "fleet_attention_mark_read",
                "fleet_call",
                "fleet_device_detail",
                "fleet_events",
                "fleet_models",
                "fleet_navigator",
                "fleet_prompts",
                "fleet_recent_sessions",
                "fleet_subscribe",
                "fleet_ui_bundle",
            ])
        );
        for verb in entry.iter().chain(
            [
                "fleet_digest",
                "fleet_replay",
                "fleet_blob_get",
                "fleet_blob_holders",
                "fleet_replica_digest",
                "fleet_replica_list",
                "fleet_replica_pull",
                "fleet_replica_push",
            ]
            .iter(),
        ) {
            assert!(is_fleet_verb(verb), "{verb}");
            assert!(
                FLEET_ROUTES.iter().all(|row| row.id != *verb),
                "{verb} has no fleet route"
            );
        }
        assert!(is_fleet_verb("fleet_something_newer"));
        assert!(!is_fleet_verb("start_dialog_turn"));
    }

    #[test]
    fn owner_key_values_follow_the_path() {
        let args = serde_json::json!({"request": {"sessionId": "s1", "empty": "", "n": 3}, "sessionId": "top"});
        assert_eq!(owner_key_value(&args, "request.sessionId"), Some("s1"));
        assert_eq!(owner_key_value(&args, "sessionId"), Some("top"));
        assert_eq!(owner_key_value(&args, "request.empty"), None);
        assert_eq!(owner_key_value(&args, "request.n"), None);
        assert_eq!(owner_key_value(&args, "request.missing"), None);
        assert_eq!(
            owner_key_value(&serde_json::Value::Null, "request.sessionId"),
            None
        );
        let snake = serde_json::json!({"request": {"session_id": "s2", "workspaceId": "w"}});
        assert_eq!(owner_key_value(&snake, "request.sessionId"), Some("s2"));
        assert_eq!(owner_key_value(&snake, "request.workspace_id"), Some("w"));
        assert_eq!(other_spelling("source_session_id"), "sourceSessionId");
        assert_eq!(other_spelling("parentSessionId"), "parent_session_id");
    }
}

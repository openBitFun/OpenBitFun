#![recursion_limit = "256"]
#![allow(non_snake_case)]
//! OpenBitFun desktop backend library: the product backend the native NSH
//! desktop app (`src/apps/desktop-nsh`) loads in-process through the C ABI in
//! [`backend_protocol::ffi`], and that browsers, phones and other account
//! devices reach over OBP ([`backend_protocol::ws`], [`mesh`]).
//!
//! The reqwest HTTP/2 and MCP transport type graph exceeds rustc's default
//! trait-evaluation recursion budget when desktop tasks require `Send`.
//! The reqwest HTTP/2 and MCP transport type graph exceeds rustc's default
//! trait-evaluation recursion budget when desktop tasks require `Send`.
//!
//! Concretely, dropping the limit back to 128 fails with `overflow evaluating
//! the requirement Vec<slab::Entry<h2::…::Slot<h2::…::recv::Event>>>: Send`.
//! The chain runs ~15 frames through h2's own internals (`Slab` → `Buffer` →
//! `Recv` → `Actions` → `Inner` → `Arc<Mutex<_>>` → `RecvStream` → hyper's
//! `Incoming`), into the MCP remote transport, then out through roughly ten
//! nested `async fn` bodies from `agentic::coordination::scheduler` to the
//! `tokio::spawn` in `api::remote_connect_api`.
//!
//! Most of that depth is in third-party types, so `Box::pin`-ing one of our own
//! futures does not collapse it; only erasing a mid-chain future to
//! `Pin<Box<dyn Future + Send>>` would, at the cost of an allocation and dynamic
//! dispatch on the dialog-turn path. Raising the budget is the mechanism rustc
//! itself suggests, costs nothing at runtime, and is re-checked whenever this
//! attribute is touched.

pub mod api;
pub mod appearance;
pub mod backend_protocol;
pub mod computer_use;
pub mod crash_diagnostics;
pub mod desktop_cards;
pub mod fleet;
pub mod host;
pub mod logging;
pub mod mesh;
mod miniapp_desktop;
mod miniapp_web_host;
mod native_browser;
pub mod native_host;
mod openbitfun_control_host;
pub mod runtime;
pub mod sleep_prevention;
pub mod startup_trace;
mod update_maintenance;

use crate::host::{HostHandle, HostTransportAdapter};
use openbitfun_agent_runtime::sdk::{attach_session_event_cursor, SessionEventJournal};
use openbitfun_core::agentic::tools::computer_use_capability::set_computer_use_host_available;
use openbitfun_core::agentic::tools::computer_use_host::ComputerUseHostRef;
use openbitfun_core::infrastructure::ai::AIClientFactory;
use openbitfun_core::infrastructure::{get_path_manager_arc, try_get_path_manager_arc};
use openbitfun_core::service::search::get_global_workspace_search_service;
use openbitfun_core::service::session_projection_store::{
    runtime_event_log_dir, FileSessionProjectionStore,
};
use openbitfun_core::util::{elapsed_ms, TimingCollector};
use openbitfun_events::AgenticEvent;
use openbitfun_transport::TransportAdapter;
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, OnceLock,
};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

// Re-export API
pub use api::*;

use api::acp_client_api::*;
use api::clipboard_file_api::*;
use api::commands::*;
use api::computer_use_api::*;
use api::config_api::*;
use api::cron_api::*;
use api::custom_agent_api::{
    create_custom_agent, delete_custom_agent, get_custom_agent_detail, reload_custom_agents,
    update_custom_agent,
};
use api::diff_api::*;
use api::external_hooks_api::*;
use api::external_session_import_api::*;
use api::external_sources_api::*;
use api::git_agent_api::*;
use api::git_api::*;
use api::i18n_api::*;
use api::mcp_api::*;
use api::review_platform_api::*;
use api::runtime_api::*;
use api::search_api::*;
use api::session_api::*;
use api::session_storage_directory::reveal_session_storage_directory;
use api::skill_api::*;
use api::snapshot_service::*;
use api::speech_api::*;
use api::subagent_api::*;
use api::system_api::*;
use api::tool_api::*;
use startup_trace::{DesktopStartupTrace, DesktopStartupTraceSnapshot};

pub(crate) const PLUGIN_HOST_LAUNCH_POLICY: openbitfun_core::plugin_host::PluginHostLaunchPolicy =
    openbitfun_core::plugin_host::PluginHostLaunchPolicy::Enabled;

pub(crate) fn ensure_rustls_crypto_provider() {
    openbitfun_core::service::remote_connect::ensure_rustls_crypto_provider();
}

const CRON_DESKTOP_START_FALLBACK_DELAY: Duration = Duration::from_secs(120);
const BROWSER_WEBVIEW_PAGE_LOAD_EVENT: &str = "browser-webview-page-load";

/// Brings the main window forward (a MiniApp shell's "show the main window",
/// or a MiniApp tab request): the UI shell owns the window.
fn handle_secondary_launch_host(app: &HostHandle) {
    let host = Arc::clone(app.native());
    tokio::spawn(async move {
        if let Err(error) = host
            .shell_request(
                "window.show",
                serde_json::Value::Null,
                host::shell::SHELL_REQUEST_TIMEOUT,
            )
            .await
        {
            log::warn!("Failed to show the native main window: {}", error);
        }
    });
}

/// Agentic Coordinator state
#[derive(Clone)]
pub struct CoordinatorState {
    pub coordinator: Arc<openbitfun_core::agentic::coordination::ConversationCoordinator>,
}

/// Dialog scheduler state (primary entry point for user messages)
#[derive(Clone)]
pub struct SchedulerState {
    pub scheduler: Arc<openbitfun_core::agentic::coordination::DialogScheduler>,
}

pub(crate) fn e2e_storage_guard_enabled() -> bool {
    std::env::var("OPENBITFUN_E2E_STORAGE_GUARD")
        .ok()
        .is_some_and(|value| value == "1" || value.eq_ignore_ascii_case("true"))
}

// @backend-command
fn get_startup_native_trace(
    state: crate::host::State<'_, DesktopStartupTrace>,
) -> DesktopStartupTraceSnapshot {
    state.snapshot()
}

/// A startup step failed before the backend could serve any client.
pub(crate) struct StartupFailure {
    /// User-facing explanation (the runner shows it; `Backend.ready()` rejects with it).
    pub(crate) message: String,
}

impl StartupFailure {
    fn new(message: String) -> Self {
        Self { message }
    }
}

/// The bootstrapped backend core, before host wiring (`native_host`).
pub(crate) struct BackendCore {
    pub(crate) startup_started: Instant,
    pub(crate) startup_timings: TimingCollector,
    pub(crate) log_config: logging::LogConfig,
    pub(crate) session_log_dir: PathBuf,
    pub(crate) startup_trace: DesktopStartupTrace,
    pub(crate) startup_log_level: log::LevelFilter,
    pub(crate) coordinator: Arc<openbitfun_core::agentic::coordination::ConversationCoordinator>,
    pub(crate) scheduler: Arc<openbitfun_core::agentic::coordination::DialogScheduler>,
    pub(crate) event_queue: Arc<openbitfun_core::agentic::events::EventQueue>,
    pub(crate) event_router: Arc<openbitfun_core::agentic::events::EventRouter>,
    pub(crate) workspace_search_enabled: bool,
    pub(crate) startup_flashgrep_path: Option<PathBuf>,
    pub(crate) app_state: AppState,
    pub(crate) session_event_journal: Arc<SessionEventJournal>,
    pub(crate) desktop_runtime: runtime::DesktopRuntimeContext,
    pub(crate) coordinator_state: CoordinatorState,
    pub(crate) scheduler_state: SchedulerState,
    pub(crate) terminal_state: api::terminal_api::TerminalState,
    pub(crate) path_manager: Arc<openbitfun_core::infrastructure::PathManager>,
}

/// Isolates authentication storage for guarded E2E profiles. Must run before
/// any account discovery or background refresh can touch the normal profile.
pub(crate) fn apply_e2e_storage_guard() -> Result<(), String> {
    // E2E profiles must isolate authentication as well as ordinary config.
    // Use the existing encrypted fixture vault on every platform, before any
    // account discovery or background refresh can touch the normal profile.
    if e2e_storage_guard_enabled() {
        let paths = match openbitfun_core::infrastructure::PathManager::new() {
            Ok(paths) => paths,
            Err(error) => {
                eprintln!("Failed to initialize isolated E2E authentication storage: {error}");
                return Err(format!(
                    "Failed to initialize isolated E2E authentication storage: {error}"
                ));
            }
        };
        openbitfun_core::infrastructure::subscription_auth::store::set_store_path_and_file_vault_for_test(
            paths.user_data_dir().join("subscription_auth.json"),
        );
        #[cfg(not(debug_assertions))]
        if std::env::var_os("OPENBITFUN_E2E_SUBSCRIPTION_CA_FILE").is_some() {
            eprintln!("Isolated subscription mock TLS requires a debug build");
            return Err("Isolated subscription mock TLS requires a debug build".to_string());
        }
        #[cfg(debug_assertions)]
        if let Some(certificate_path) = std::env::var_os("OPENBITFUN_E2E_SUBSCRIPTION_CA_FILE") {
            let result = std::fs::read(certificate_path)
                .map_err(|error| error.to_string())
                .and_then(|pem| openbitfun_core::infrastructure::subscription_auth::set_isolated_http_root_certificate_for_test(&pem).map_err(|error| error.to_string()));
            if let Err(error) = result {
                eprintln!("Failed to initialize isolated E2E subscription TLS: {error}");
                return Err(format!(
                    "Failed to initialize isolated E2E subscription TLS: {error}"
                ));
            }
        }
    }
    Ok(())
}

/// Bootstraps the host-independent backend (configuration, plugin host,
/// i18n, AI factory, agentic system, application state, agent runtime).
pub(crate) async fn bootstrap_backend_core() -> Result<BackendCore, StartupFailure> {
    let startup_started = Instant::now();
    let startup_trace_id = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| format!("desktop-{}", duration.as_millis()))
        .unwrap_or_else(|_| "desktop-unknown".to_string());
    let mut startup_timings = TimingCollector::default();
    let in_debug = cfg!(debug_assertions) || std::env::var("DEBUG").unwrap_or_default() == "1";
    let log_config = logging::LogConfig::new(in_debug);
    let session_log_dir = log_config.session_log_dir.clone();
    if let Err(error) = logging::install_early_file_logging(&session_log_dir) {
        eprintln!(
            "Warning: Failed to install early startup logging: {}",
            error
        );
    }
    let native_startup_trace_path = logging::native_startup_trace_path(&session_log_dir);
    let startup_trace = match DesktopStartupTrace::new_persisted(
        startup_trace_id.clone(),
        startup_started,
        &native_startup_trace_path,
    ) {
        Ok(trace) => trace,
        Err(error) => {
            log::warn!("Native startup trace persistence is unavailable: {}", error);
            DesktopStartupTrace::new(startup_trace_id.clone(), startup_started)
        }
    };
    startup_trace.record_phase("native_process_start", "native");
    crash_diagnostics::initialize_run_state(session_log_dir.clone(), &startup_trace_id);
    setup_panic_hook();

    // Install the rustls ring CryptoProvider as the process-level default early,
    // so that all subsequent TLS operations (relay_client, reqwest, tokio-tungstenite)
    // reuse the same provider instead of each attempting their own install_default().
    ensure_rustls_crypto_provider();

    eprintln!("=== OpenBitFun Desktop Starting ===");

    if let Err(error) = openbitfun_core::agentic::system::select_agentic_system_profile(
        openbitfun_core::agentic::system::DeliveryProfile::Desktop,
    ) {
        log::error!("Failed to select Desktop agent profile: {}", error);
        return Err(StartupFailure::new(format!(
            "OpenBitFun could not select its Desktop agent profile and cannot continue.\n\n{error}\n\nSee early-startup.log for details."
        )));
    }

    let step_started = Instant::now();
    if let Err(e) = openbitfun_core::service::config::initialize_global_config().await {
        log::error!("Failed to initialize global config service: {}", e);
        return Err(StartupFailure::new(format!(
            "OpenBitFun could not initialize its configuration and cannot continue.\n\n{e}\n\nSee early-startup.log for details."
        )));
    }
    if let Ok(config_service) = openbitfun_core::service::config::get_global_config_service().await
    {
        for diagnostic in config_service.load_diagnostics().await {
            log::warn!(
                "Startup configuration diagnostic: code={}, path={}, recoverability={:?}",
                diagnostic.code,
                diagnostic.path,
                diagnostic.recoverability
            );
        }
    }
    startup_timings.record_elapsed("initialize_global_config", step_started);
    startup_trace.record_elapsed_step("native_bootstrap", "initialize_global_config", step_started);

    let step_started = Instant::now();
    match openbitfun_core::plugin_host::initialize_configured_plugin_host_with_log_file(
        PLUGIN_HOST_LAUNCH_POLICY,
        Some(session_log_dir.join("plugin-host.log")),
    )
    .await
    {
        Ok(openbitfun_core::plugin_host::PluginHostStartup::Disabled) => {}
        Ok(status) => log::info!("Plugin host initialization completed: {:?}", status),
        Err(error) => {
            log::error!("Failed to initialize configured plugin host: {}", error);
            openbitfun_core::plugin_host::report_configured_plugin_activation_failure(
                "Desktop startup",
                None,
                error,
            )
            .await;
        }
    }
    startup_timings.record_elapsed("initialize_plugin_host", step_started);
    startup_trace.record_elapsed_step("native_bootstrap", "initialize_plugin_host", step_started);

    // The three steps below only depend on the global config service (initialized
    // above) and write to disjoint global singletons, so they can run concurrently:
    // - initialize_global_i18n_service: reads config, sets the global i18n singleton
    // - resolve_runtime_log_level: reads config, returns a value
    // - AIClientFactory::initialize_global: reads config, sets GLOBAL_AI_CLIENT_FACTORY
    let (
        i18n_duration_ms,
        (startup_log_level, log_level_duration_ms),
        (ai_factory_result, ai_factory_duration_ms),
    ) = {
        use openbitfun_core::service::config::get_global_config_service;
        use openbitfun_core::service::i18n::initialize_global_i18n_service;

        // Initialize global I18nService so bot/remote-connect language is always in sync.
        let i18n_task = async {
            let step_started = Instant::now();
            match get_global_config_service().await {
                Ok(config_service) => {
                    if let Err(e) = initialize_global_i18n_service(Some(config_service)).await {
                        log::error!("Failed to initialize global I18nService: {}", e);
                    }
                }
                Err(e) => {
                    log::error!("Failed to get config service for I18nService init: {}", e);
                }
            }
            elapsed_ms(step_started)
        };

        let log_level_task = async {
            let step_started = Instant::now();
            let level = resolve_runtime_log_level(log_config.level).await;
            (level, elapsed_ms(step_started))
        };

        let ai_factory_task = async {
            let step_started = Instant::now();
            let result = AIClientFactory::initialize_global().await;
            (result, elapsed_ms(step_started))
        };

        tokio::join!(i18n_task, log_level_task, ai_factory_task)
    };

    startup_timings.push_duration("initialize_global_i18n_service", i18n_duration_ms);
    startup_trace.record_step(
        "native_step_end",
        "native_bootstrap",
        "initialize_global_i18n_service",
        i18n_duration_ms,
    );
    startup_trace.record_step(
        "native_step_end",
        "native_bootstrap",
        "resolve_runtime_log_level",
        log_level_duration_ms,
    );
    startup_timings.push_duration(
        "initialize_global_ai_client_factory",
        ai_factory_duration_ms,
    );
    startup_trace.record_step(
        "native_step_end",
        "native_bootstrap",
        "initialize_global_ai_client_factory",
        ai_factory_duration_ms,
    );
    if let Err(e) = ai_factory_result {
        log::error!("Failed to initialize global AIClientFactory: {}", e);
        return Err(StartupFailure::new(format!(
            "Failed to initialize global AIClientFactory: {e}"
        )));
    }

    let step_started = Instant::now();
    let (coordinator, scheduler, event_queue, event_router, ai_client_factory, token_usage_service) =
        match init_agentic_system().await {
            Ok(state) => state,
            Err(e) => {
                log::error!("Failed to initialize agentic system: {}", e);
                return Err(StartupFailure::new(format!(
                    "Failed to initialize agentic system: {e}"
                )));
            }
        };
    startup_timings.record_elapsed("init_agentic_system", step_started);
    startup_trace.record_elapsed_step("native_bootstrap", "init_agentic_system", step_started);

    let step_started = Instant::now();
    if let Err(e) = init_function_agents(ai_client_factory.clone()).await {
        log::error!("Failed to initialize function agents: {}", e);
        return Err(StartupFailure::new(format!(
            "Failed to initialize function agents: {e}"
        )));
    }
    startup_timings.record_elapsed("init_function_agents", step_started);
    startup_trace.record_elapsed_step("native_bootstrap", "init_function_agents", step_started);

    let step_started = Instant::now();
    let workspace_search_enabled =
        openbitfun_core::service::search::workspace_search_feature_enabled().await;
    startup_trace.record_elapsed_step(
        "native_bootstrap",
        "workspace_search_feature_enabled",
        step_started,
    );
    let step_started = Instant::now();
    let startup_flashgrep_path = configure_workspace_search_daemon_env();
    startup_trace.record_elapsed_step(
        "native_bootstrap",
        "configure_workspace_search_daemon_env",
        step_started,
    );

    let step_started = Instant::now();
    let app_state = match AppState::new_async(token_usage_service).await {
        Ok(state) => state,
        Err(e) => {
            log::error!("Failed to initialize AppState: {}", e);
            return Err(StartupFailure::new(format!(
                "OpenBitFun could not initialize its application state and cannot continue.\n\n{e}\n\nSee {} for details.",
                logging::early_startup_log_path(&session_log_dir).display()
            )));
        }
    };
    startup_timings.record_elapsed("initialize_app_state", step_started);
    startup_trace.record_elapsed_step("native_bootstrap", "initialize_app_state", step_started);

    // A Turn that is still executing exists nowhere durable but this log: the
    // persisted Session record stores a running Turn as idle so a restart never
    // revives work. Without it, a client returning to this device after the
    // process restarted is served a Turn frozen at the last checkpoint.
    let session_event_journal = Arc::new(match try_get_path_manager_arc() {
        Ok(path_manager) => SessionEventJournal::new().with_store(Arc::new(
            FileSessionProjectionStore::new(runtime_event_log_dir(&path_manager)),
        )),
        Err(error) => {
            log::warn!("Runtime event log disabled: application paths unavailable: {error}");
            SessionEventJournal::new()
        }
    });
    let step_started = Instant::now();
    let desktop_runtime = match runtime::DesktopRuntimeContext::build(
        coordinator.clone(),
        scheduler.clone(),
        app_state.token_usage_service.clone(),
        app_state.workspace_service.clone(),
        app_state.ssh_manager.clone(),
        app_state.acp_client_service.clone(),
        session_event_journal.clone(),
    ) {
        Ok(runtime) => runtime,
        Err(error) => {
            log::error!("Failed to initialize Desktop Agent Runtime: {}", error);
            return Err(StartupFailure::new(format!(
                "Failed to initialize Desktop Agent Runtime: {error}"
            )));
        }
    };
    startup_timings.record_elapsed("initialize_desktop_agent_runtime", step_started);
    startup_trace.record_elapsed_step(
        "native_bootstrap",
        "initialize_desktop_agent_runtime",
        step_started,
    );

    let coordinator_state = CoordinatorState {
        coordinator: coordinator.clone(),
    };

    let scheduler_state = SchedulerState {
        scheduler: scheduler.clone(),
    };

    let terminal_state = api::terminal_api::TerminalState::new();

    let path_manager = get_path_manager_arc();

    Ok(BackendCore {
        startup_started,
        startup_timings,
        log_config,
        session_log_dir,
        startup_trace,
        startup_log_level,
        coordinator,
        scheduler,
        event_queue,
        event_router,
        workspace_search_enabled,
        startup_flashgrep_path,
        app_state,
        session_event_journal,
        desktop_runtime,
        coordinator_state,
        scheduler_state,
        terminal_state,
        path_manager,
    })
}

/// The registered backend commands: the product command vocabulary every
/// client calls by name (`BackendService::dispatch`). Each entry is a typed
/// handler marked `// @backend-command` or a host adapter under
/// `backend_protocol::native_commands`. After adding, removing or renaming
/// one, run `pnpm run desktop-nsh:generate-dispatch` and keep one Product
/// Operation Registry row per command
/// (`src/crates/contracts/product-domains/src/remote_surface/table.rs`).
macro_rules! backend_commands {
    ($($command:path),* $(,)?) => {};
}

backend_commands![
    backend_protocol::native_commands::miniapp_presentation,
    api::miniapp_api::miniapp_shell_call,
    miniapp_web_host::mark_miniapp_web_surface_ready,
    miniapp_web_host::report_miniapp_web_result,
    // Spaces everywhere (wave 22, P4)
    miniapp_desktop::inline::miniapp_inline,
    miniapp_desktop::catalog::miniapp_account_catalog,
    backend_protocol::native_commands::show_main_window,
    backend_protocol::native_commands::hide_main_window_after_close_request,
    api::agentic_api::create_session,
    api::agentic_api::update_session_mode,
    api::agentic_api::update_session_model,
    // Turn and session policy (wave 3 session).
    api::session_policy_api::submit_user_message,
    api::session_policy_api::get_session_mode_catalog,
    api::session_policy_api::list_session_commands,
    api::session_policy_api::execute_session_command,
    api::session_policy_api::stop_dialog_turn,
    api::session_policy_api::mark_session_seen,
    // Logic batch 4: typed transcript view.
    api::transcript_view_api::get_session_transcript_view,
    api::agentic_api::get_model_routing_status,
    api::model_pool_api::get_model_pools,
    api::model_pool_api::retry_model_pool_member,
    api::model_pool_api::save_model_pool,
    api::model_pool_api::delete_model_pool,
    api::model_pool_api::get_model_pool_status,
    api::model_pool_api::get_session_model_target,
    api::model_pool_api::update_session_model_target,
    api::agentic_api::update_session_permission_mode,
    api::agentic_api::update_active_turn_permission_mode,
    api::agentic_api::get_session_permission_mode,
    api::agentic_api::reload_session_context,
    api::agentic_api::update_session_title,
    api::agentic_api::ensure_coordinator_session,
    api::agentic_api::ensure_control_conversation,
    api::agentic_api::create_control_conversation,
    api::agentic_api::record_voice_exchange,
    api::agentic_api::start_dialog_turn,
    api::agentic_api::compact_session,
    api::agentic_api::activate_session_goal,
    api::agentic_api::get_session_thread_goal,
    api::agentic_api::clear_session_thread_goal,
    api::agentic_api::set_session_thread_goal_status,
    api::agentic_api::update_session_thread_goal_objective,
    api::agentic_api::ensure_assistant_bootstrap,
    api::agentic_api::run_init_agents_md,
    api::agentic_api::cancel_dialog_turn,
    api::agentic_api::interrupt_dialog_turn,
    api::agentic_api::recover_interrupted_dialog_turn,
    api::agentic_api::steer_dialog_turn,
    api::agentic_api::manage_dialog_queue,
    api::agentic_api::control_deep_review_queue,
    api::agentic_api::cancel_session,
    api::agentic_api::set_subagent_timeout,
    api::agentic_api::control_background_command,
    api::agentic_api::send_background_command_input,
    api::agentic_api::read_background_command_output,
    api::agentic_api::list_background_command_activities,
    api::agentic_api::delete_session,
    api::agentic_api::restore_session,
    api::agentic_api::restore_session_view,
    api::agentic_api::load_session_event_backfill,
    api::agentic_api::load_session_turn_window,
    api::agentic_api::load_session_trajectory,
    api::agentic_api::restore_session_with_turns,
    api::agentic_api::reset_memory,
    api::agentic_api::get_memory_paths,
    api::agentic_api::set_session_memory_mode,
    get_startup_native_trace,
    api::agentic_api::list_sessions,
    api::agentic_api::get_session_interaction_mailbox,
    api::agentic_api::list_pending_permission_requests,
    api::agentic_api::subscribe_permission_requests,
    api::agentic_api::respond_permission,
    api::agentic_api::respond_permission_batch,
    api::agentic_api::list_project_permission_grants,
    api::agentic_api::remove_project_permission_grant,
    api::agentic_api::clear_project_permission_grants,
    api::agentic_api::list_project_permission_audit,
    api::agentic_api::get_project_permission_rules,
    api::agentic_api::save_project_permission_rules,
    api::agentic_api::cancel_tool,
    api::agentic_api::generate_session_title,
    api::agentic_api::get_available_modes,
    api::agentic_api::get_default_review_team_definition,
    api::review_launch_api::launch_review,
    api::btw_api::btw_ask_stream,
    api::btw_api::btw_cancel,
    api::editor_ai_api::editor_ai_stream,
    api::editor_ai_api::editor_ai_cancel,
    get_external_hook_catalog,
    get_external_hook_import_snapshot,
    plan_external_hook_import_command,
    apply_external_hook_import_command,
    mutate_external_hook_import_command,
    get_external_source_snapshot,
    get_instruction_source_catalog,
    get_workspace_reference_snapshot,
    plan_external_mcp_import_command,
    apply_external_mcp_import_command,
    reveal_external_source_location,
    get_external_source_control_snapshot,
    get_external_source_discovery_snapshot,
    list_removed_external_sessions,
    restore_removed_external_session,
    apply_external_source_control_action_command,
    get_external_ecosystem_awareness_command,
    acknowledge_external_ecosystems_command,
    update_external_integration_policy_command,
    set_external_source_enabled_command,
    set_external_source_conflict_choice_command,
    get_native_prompt_command_conflicts_command,
    set_native_prompt_command_conflict_choice_command,
    expand_external_prompt_command_command,
    set_external_tool_target_decision_command,
    set_external_tool_targets_enabled_command,
    set_external_tool_conflict_choice_command,
    set_external_subagent_activation_command,
    set_external_subagents_enabled_command,
    set_external_subagent_model_binding_command,
    choose_external_subagent_conflict_command,
    set_external_mcp_server_decision_command,
    set_external_mcp_servers_enabled_command,
    choose_external_mcp_conflict_command,
    api::context_upload_api::upload_image_contexts,
    get_all_tools_info,
    get_chat_mcp_catalog,
    get_readonly_tools_info,
    get_tool_info,
    validate_tool_input,
    execute_tool,
    submit_user_answers,
    start_user_question_interaction,
    initialize_workspace_startup_state,
    get_available_tools,
    report_ide_control_result,
    openbitfun_control_host::mark_openbitfun_control_surface_ready,
    openbitfun_control_host::mark_openbitfun_control_surface_unready,
    openbitfun_control_host::product_control_invoke,
    openbitfun_control_host::report_openbitfun_control_result,
    get_health_status,
    get_statistics,
    test_ai_connection,
    test_ai_config_connection,
    test_image_generation_service,
    list_ai_models_by_config,
    probe_magpie_gateway,
    list_subscription_accounts,
    list_subscription_account_instances,
    get_subscription_account_quota,
    start_subscription_account_login,
    logout_subscription_account_instance,
    set_subscription_account_enabled,
    refresh_subscription_account_instance,
    start_subscription_login,
    get_subscription_login_status,
    cancel_subscription_login,
    logout_subscription_account,
    refresh_subscription_account,
    initialize_ai,
    refresh_model_client,
    get_app_state,
    update_app_status,
    update_workspace_info,
    get_workspace_icon,
    set_workspace_icon,
    list_agent_companion_pets,
    import_agent_companion_pet_package,
    delete_agent_companion_pet_package,
    // Desktop presence: cards and the pet (wave 22, P3)
    api::companion_pet_api::load_agent_companion_pet_spritesheet,
    api::companion_pet_api::load_agent_companion_pet_still,
    backend_protocol::native_commands::show_agent_companion_desktop_pet,
    backend_protocol::native_commands::hide_agent_companion_desktop_pet,
    backend_protocol::native_commands::resize_agent_companion_desktop_pet,
    desktop_cards::desktop_card_api::desktop_card_list,
    desktop_cards::desktop_card_api::desktop_card_get,
    desktop_cards::desktop_card_api::desktop_card_set_visible,
    desktop_cards::desktop_card_api::desktop_card_delete,
    desktop_cards::desktop_card_api::desktop_card_refresh,
    desktop_cards::desktop_card_api::desktop_card_set_checklist_item,
    desktop_cards::desktop_card_api::desktop_card_set_always_on_top,
    desktop_cards::desktop_card_api::desktop_card_set_bounds,
    read_file_content,
    write_file_content,
    workspace_file_upload,
    reset_workspace_persona_files,
    check_path_exists,
    get_file_metadata,
    get_file_editor_sync_hash,
    rename_file,
    export_local_file_to_path,
    reveal_in_explorer,
    get_file_tree,
    explorer_get_file_tree,
    get_directory_children,
    explorer_get_children,
    get_directory_children_paginated,
    explorer_get_children_paginated,
    search_files,
    search_filenames,
    search_file_contents,
    search_get_repo_status,
    search_build_index,
    search_rebuild_index,
    start_search_filenames_stream,
    start_search_file_contents_stream,
    cancel_search,
    delete_file,
    delete_directory,
    create_file,
    create_directory,
    compress_path,
    decompress_path,
    list_directory_files,
    start_file_watch,
    stop_file_watch,
    get_watched_paths,
    get_file_watch_status,
    retry_file_watch,
    backend_protocol::native_commands::get_clipboard_files,
    backend_protocol::native_commands::get_clipboard_image,
    backend_protocol::native_commands::write_clipboard_image,
    paste_files,
    get_config,
    get_configs,
    computer_use_get_status,
    computer_use_control_status,
    computer_use_control_stop,
    computer_use_control_preview,
    computer_use_request_permissions,
    computer_use_request_permission,
    computer_use_share_targets,
    computer_use_share_observe,
    computer_use_share_input,
    computer_use_share_start,
    computer_use_share_control,
    computer_use_share_request,
    computer_use_share_grants,
    computer_use_share_forget_grant,
    computer_use_open_system_settings,
    set_config,
    // Typed settings mutations (wave 3 config).
    api::settings_mutation_api::ai_model_upsert,
    api::settings_mutation_api::ai_model_delete,
    api::settings_mutation_api::resolve_ai_model_request_url,
    api::settings_mutation_api::set_task_model,
    api::settings_mutation_api::set_permission_mode,
    api::settings_mutation_api::upsert_permission_rule,
    api::settings_mutation_api::delete_permission_rule,
    api::settings_mutation_api::set_approval_settings,
    api::settings_mutation_api::set_web_search_provider,
    api::settings_mutation_api::set_superagent_settings,
    api::settings_mutation_api::get_settings_schema,
    // permission page view (wave 4)
    api::settings_mutation_api::get_permission_settings,
    set_acp_client_permission_mode,
    save_cloud_speech_config,
    get_web_search_credential_status,
    save_web_search_credential,
    clear_web_search_credential,
    get_decision_model_credential_status,
    save_decision_model_credential,
    clear_decision_model_credential,
    reset_config,
    export_config,
    import_config,
    validate_config,
    reload_config,
    get_global_config_health,
    get_runtime_logging_info,
    export_diagnostics_bundle,
    append_flow_chat_diagnostics,
    get_runtime_capabilities,
    speech_list_models,
    speech_download_model,
    speech_cancel_model_download,
    speech_delete_model,
    speech_verify_model,
    speech_start_input_session,
    speech_append_audio_chunk,
    speech_finish_input_session,
    speech_cancel_input_session,
    speech_start_realtime_session,
    speech_append_realtime_audio,
    speech_commit_realtime_audio,
    speech_send_realtime_tool_result,
    speech_speak_realtime_text,
    speech_cancel_realtime_response,
    speech_close_realtime_session,
    speech_get_realtime_config,
    speech_save_realtime_config,
    get_agent_profile_configs,
    get_agent_profile_config,
    set_agent_profile_config,
    reset_agent_profile_config,
    list_subagents,
    list_visible_subagents,
    list_manageable_subagents,
    get_custom_agent_detail,
    create_custom_agent,
    update_custom_agent,
    delete_custom_agent,
    reload_custom_agents,
    get_subagent_detail,
    delete_subagent,
    create_subagent,
    update_subagent,
    reload_subagents,
    list_agent_tool_names,
    update_subagent_config,
    get_skill_configs,
    get_global_skill_settings,
    get_mode_skill_configs,
    list_skill_market,
    search_skill_market,
    download_skill_market,
    set_global_skill_disabled,
    set_mode_skill_disabled,
    replace_mode_skill_selection,
    reset_mode_skill_selection,
    validate_skill_path,
    add_skill,
    delete_skill,
    git_is_repository,
    git_get_repository_trust,
    git_trust_repository,
    git_get_repository_basic,
    git_resolve_revision,
    git_get_repository,
    review_platform_get_workspace_snapshot,
    review_platform_get_workspace_context,
    review_platform_get_pull_request_detail,
    review_platform_get_pull_request_review_target,
    review_platform_get_issue,
    review_platform_get_pull_request_review_target_by_identity,
    review_platform_get_pull_request_detail_page,
    review_platform_get_pull_request_ci_log,
    review_platform_update_auth_token,
    review_platform_clear_auth_token,
    git_get_status,
    git_get_tracked_change_count,
    git_get_branches,
    git_get_enhanced_branches,
    git_get_commits,
    git_add_files,
    git_commit,
    git_push,
    git_pull,
    git_checkout_branch,
    git_create_branch,
    git_delete_branch,
    git_get_diff,
    git_get_changed_files,
    git_reset_files,
    git_reset_to_commit,
    git_get_file_content,
    git_get_graph,
    git_cherry_pick,
    git_cherry_pick_abort,
    git_cherry_pick_continue,
    git_list_worktrees,
    git_add_worktree,
    git_remove_worktree,
    // git liveness (wave 4)
    git_discard_files,
    git_commit_and_checkout,
    git_watch_status,
    git_unwatch_status,
    api::worktree_api::worktree_list,
    api::worktree_api::worktree_list_projects,
    api::worktree_api::worktree_create,
    api::worktree_api::worktree_create_branch,
    api::worktree_api::worktree_promote,
    api::worktree_api::worktree_remove,
    api::worktree_api::worktree_recreate,
    api::worktree_api::worktree_bind_session,
    generate_commit_message,
    quick_commit_message,
    save_git_repo_history,
    load_git_repo_history,
    preview_commit_message,
    compute_diff,
    apply_patch,
    save_merged_diff_content,
    rollback_session,
    rollback_session_to_turn,
    accept_session,
    accept_file,
    reject_file,
    get_session_files,
    get_session_turns,
    get_turn_files,
    get_file_diff,
    get_operation_diff,
    get_session_file_diff_stats,
    get_operation_summary,
    get_session_operations,
    accept_operation,
    reject_operation,
    get_session_stats,
    get_snapshot_system_stats,
    get_snapshot_sessions,
    check_git_isolation,
    get_file_change_history,
    inspect_snapshot_storage,
    clean_snapshot_storage,
    get_all_modified_files,
    get_baseline_snapshot_diff,
    // Session persistence API
    reveal_session_storage_directory,
    list_persisted_sessions,
    search_session_content,
    search_referenceable_sessions,
    list_persisted_sessions_page,
    get_session_lineage,
    load_session_turns,
    get_session_usage_report,
    save_session_turn,
    save_session_metadata,
    export_session_transcript,
    delete_persisted_session,
    touch_session_activity,
    load_persisted_session_metadata,
    fork_session,
    copy_session,
    archive_session,
    unarchive_session,
    archive_all_sessions,
    list_archived_sessions,
    delete_all_archived_sessions,
    initialize_mcp_servers,
    api::mcp_api::initialize_mcp_servers_non_destructive,
    get_mcp_servers,
    api::mcp_api::list_mcp_resources,
    api::mcp_api::read_mcp_resource,
    api::mcp_api::list_mcp_prompts,
    api::mcp_api::get_mcp_prompt,
    start_mcp_server,
    stop_mcp_server,
    restart_mcp_server,
    get_mcp_server_status,
    load_mcp_json_config,
    save_mcp_json_config,
    get_mcp_tool_ui_uri,
    fetch_mcp_app_resource,
    send_mcp_app_message,
    submit_mcp_interaction_response,
    update_mcp_remote_auth,
    clear_mcp_remote_auth,
    api::mcp_api::delete_mcp_server,
    api::mcp_api::start_mcp_remote_oauth,
    api::mcp_api::get_mcp_remote_oauth_session,
    api::mcp_api::cancel_mcp_remote_oauth,
    initialize_acp_clients,
    get_acp_clients,
    probe_acp_client_requirements,
    predownload_acp_client_adapter,
    install_acp_client_cli,
    stop_acp_client,
    load_acp_json_config,
    save_acp_json_config,
    submit_acp_permission_response,
    create_acp_flow_session,
    start_acp_dialog_turn,
    cancel_acp_dialog_turn,
    get_acp_session_options,
    get_acp_session_commands,
    set_acp_session_model,
    set_acp_session_config_option,
    get_global_config_status,
    get_model_configs,
    get_ai_model_catalog,
    get_local_models_dev_catalogs,
    project_ai_model_reasoning_catalog,
    get_models_dev_catalog_status,
    refresh_models_dev_catalog_now,
    reveal_models_dev_cache_directory,
    get_recent_workspaces,
    remove_recent_workspace,
    cleanup_invalid_workspaces,
    get_opened_workspaces,
    get_assistant_workspaces,
    open_workspace,
    open_remote_workspace,
    create_assistant_workspace,
    get_primary_assistant_workspace,
    // assistant identity (wave 4)
    set_assistant_identity,
    set_primary_assistant_workspace,
    delete_assistant_workspace,
    reset_assistant_workspace,
    close_workspace,
    set_active_workspace,
    reorder_opened_workspaces,
    get_current_workspace,
    scan_workspace_info,
    list_cron_jobs,
    create_cron_job,
    update_cron_job,
    delete_cron_job,
    notify_cron_host_ready,
    // routines (wave 4)
    api::cron_api::validate_cron_job_draft,
    api::cron_api::preview_cron_occurrences,
    api::config_api::canonicalize_agent_profile_configs,
    api::terminal_api::terminal_get_shells,
    api::terminal_api::terminal_create,
    api::terminal_api::terminal_get,
    api::terminal_api::terminal_list,
    api::terminal_api::terminal_close,
    api::terminal_api::terminal_write,
    api::terminal_api::terminal_resize,
    api::terminal_api::terminal_signal,
    api::terminal_api::terminal_ack,
    api::terminal_api::terminal_execute,
    api::terminal_api::terminal_send_command,
    api::terminal_api::terminal_has_shell_integration,
    api::terminal_api::terminal_shutdown_all,
    api::terminal_api::terminal_get_history,
    get_system_info,
    get_app_version,
    backend_protocol::native_commands::check_for_updates,
    backend_protocol::native_commands::install_update,
    backend_protocol::native_commands::download_update,
    api::update_api::cancel_app_update_download,
    backend_protocol::native_commands::get_pending_update,
    backend_protocol::native_commands::install_pending_update,
    backend_protocol::native_commands::open_html_file_in_browser,
    backend_protocol::native_commands::restart_app,
    backend_protocol::native_commands::send_system_notification,
    backend_protocol::native_commands::quit_app,
    backend_protocol::native_commands::minimize_to_tray,
    backend_protocol::native_commands::initialize_tray_after_startup,
    backend_protocol::native_commands::set_tray_unread_count,
    backend_protocol::native_commands::toggle_main_window_fullscreen,
    // Native desktop shell channel (wave 4 native).
    api::native_shell_api::host_shell_attach,
    api::native_shell_api::host_shell_respond,
    sleep_prevention::get_prevent_sleep_enabled,
    sleep_prevention::set_prevent_sleep_enabled,
    check_command_exists,
    check_commands_exist,
    run_system_command,
    i18n_get_current_language,
    i18n_set_language,
    i18n_get_supported_languages,
    i18n_get_config,
    i18n_set_config,
    // Remote Connect
    api::remote_connect_api::remote_connect_get_device_info,
    api::remote_connect_api::remote_connect_get_methods,
    api::remote_connect_api::remote_connect_start,
    api::remote_connect_api::remote_connect_stop,
    api::remote_connect_api::remote_connect_stop_bot,
    api::remote_connect_api::remote_connect_status,
    api::remote_connect_api::remote_connect_get_form_state,
    api::remote_connect_api::remote_connect_set_allowed,
    api::remote_connect_api::remote_connect_set_form_state,
    api::remote_connect_api::remote_connect_configure_bot,
    api::remote_connect_api::remote_connect_weixin_qr_start,
    api::remote_connect_api::remote_connect_weixin_qr_poll,
    api::remote_connect_api::remote_connect_get_bot_verbose_mode,
    api::remote_connect_api::remote_connect_set_bot_verbose_mode,
    // Account API
    api::account_identity_api::account_github_start,
    api::account_identity_api::account_github_poll,
    api::account_identity_api::account_email_start,
    api::account_identity_api::account_email_verify,
    api::account_identity_api::account_identity,
    // Account settings sync (wave 21, S)
    api::account_settings_sync_api::account_settings_sync_status,
    api::account_settings_sync_api::account_settings_sync_set,
    // Account records (wave24-replica)
    api::account_records_api::device_records_overview,
    api::remote_connect_api::account_login,
    api::remote_connect_api::account_status,
    api::remote_connect_api::account_logout,
    api::remote_connect_api::account_get_credential_hint,
    api::remote_connect_api::account_token_expired,
    api::remote_connect_api::account_list_devices,
    api::remote_connect_api::account_update_device_alias,
    api::remote_connect_api::account_delete_device,
    // MiniApp API
    api::miniapp_api::list_miniapps,
    api::miniapp_api::get_miniapp,
    api::miniapp_api::create_miniapp,
    api::miniapp_api::update_miniapp,
    api::miniapp_api::delete_miniapp,
    api::miniapp_api::get_miniapp_versions,
    api::miniapp_api::rollback_miniapp,
    api::miniapp_api::get_miniapp_storage,
    api::miniapp_api::set_miniapp_storage,
    api::miniapp_api::grant_miniapp_workspace,
    api::miniapp_api::grant_miniapp_path,
    api::miniapp_api::miniapp_runtime_status,
    api::miniapp_api::miniapp_worker_call,
    api::miniapp_api::miniapp_host_call,
    api::miniapp_api::miniapp_worker_stop,
    api::miniapp_api::miniapp_worker_list_running,
    api::miniapp_api::miniapp_install_deps,
    api::miniapp_api::miniapp_recompile,
    api::miniapp_api::miniapp_dialog_message,
    api::miniapp_api::miniapp_import_from_path,
    api::miniapp_api::miniapp_sync_from_fs,
    api::miniapp_api::miniapp_create_draft,
    api::miniapp_api::miniapp_get_draft,
    api::miniapp_api::miniapp_sync_draft_from_fs,
    api::miniapp_api::miniapp_set_draft_permissions,
    api::miniapp_api::miniapp_permission_diff_for_draft,
    api::miniapp_api::miniapp_apply_draft,
    api::miniapp_api::miniapp_discard_draft,
    api::miniapp_api::get_miniapp_draft_storage,
    api::miniapp_api::set_miniapp_draft_storage,
    api::miniapp_api::miniapp_draft_worker_call,
    api::miniapp_api::miniapp_draft_host_call,
    api::miniapp_api::miniapp_draft_worker_stop,
    api::miniapp_api::miniapp_get_customization_metadata,
    api::miniapp_api::miniapp_decline_builtin_update,
    api::miniapp_market_api::miniapp_market_browse,
    api::miniapp_market_api::miniapp_market_get_listing,
    api::miniapp_market_api::miniapp_market_set_rating,
    api::miniapp_market_api::miniapp_market_set_favorite,
    api::miniapp_market_api::miniapp_market_list_submissions,
    api::miniapp_market_api::miniapp_market_withdraw_submission,
    api::miniapp_market_api::miniapp_market_installed_status,
    api::miniapp_market_api::miniapp_market_installed_origins,
    api::miniapp_market_api::miniapp_market_install,
    api::miniapp_market_api::miniapp_market_import_package,
    api::miniapp_market_api::miniapp_market_inspect_package,
    api::miniapp_api::miniapp_ai_complete,
    api::miniapp_api::miniapp_ai_chat,
    api::miniapp_api::miniapp_ai_cancel,
    api::miniapp_api::miniapp_ai_list_models,
    api::miniapp_agent_api::miniapp_agent_ensure_session,
    api::miniapp_agent_api::miniapp_agent_run,
    api::miniapp_agent_api::miniapp_agent_cancel,
    api::miniapp_agent_api::miniapp_agent_turn_text,
    api::miniapp_agent_api::miniapp_agent_cancel_stale_runs,
    // Browser API (embedded webview)
    backend_protocol::native_commands::browser_webview_eval,
    backend_protocol::native_commands::browser_webview_create,
    backend_protocol::native_commands::browser_webview_navigate,
    backend_protocol::native_commands::browser_webview_reload,
    backend_protocol::native_commands::browser_webview_set_bounds,
    backend_protocol::native_commands::browser_webview_capture_preview,
    api::browser_api::browser_webview_set_agent_target_state,
    backend_protocol::native_commands::browser_get_url,
    api::browser_api::browser_webview_report_page_load,
    api::html_preview_api::html_preview_create,
    api::html_preview_api::html_preview_read_resource,
    api::html_preview_api::html_preview_release,
    api::latex_api::compile_workspace_latex,
    // Browser Control API (CDP-based user browser control)
    api::browser_control_api::browser_control_list_browsers,
    api::browser_control_api::browser_control_get_status,
    api::browser_control_api::browser_control_launch,
    api::browser_control_api::browser_control_enable_default_cdp,
    api::browser_control_api::browser_control_restart_with_cdp,
    api::browser_control_api::browser_control_disconnect,
    // Insights API
    api::insights_api::generate_insights,
    api::insights_api::get_latest_insights,
    api::insights_api::load_insights_report,
    api::insights_api::has_insights_data,
    api::insights_api::cancel_insights_generation,
    // Token usage statistics API
    api::token_usage_api::get_token_usage_statistics,
    // View models (wave 4)
    api::token_usage_api::get_token_usage_activity,
    api::view_model_api::get_workspace_navigator,
    api::view_model_api::get_personal_overview,
    // SSH Remote API
    api::ssh_api::ssh_list_saved_connections,
    api::ssh_api::ssh_save_connection,
    api::ssh_api::ssh_delete_connection,
    api::ssh_api::ssh_has_stored_password,
    api::ssh_api::ssh_connect,
    api::ssh_api::ssh_test_connection,
    api::ssh_api::ssh_list_docker_containers,
    api::ssh_api::ssh_list_wsl_distributions,
    api::ssh_api::ssh_disconnect,
    api::ssh_api::ssh_disconnect_all,
    api::ssh_api::ssh_is_connected,
    api::ssh_api::ssh_get_server_info,
    api::ssh_api::ssh_get_config,
    api::ssh_api::ssh_list_config_hosts,
    api::ssh_api::remote_read_file,
    api::ssh_api::remote_write_file,
    api::ssh_api::remote_exists,
    api::ssh_api::remote_read_dir,
    api::ssh_api::remote_get_tree,
    api::ssh_api::remote_create_dir,
    api::ssh_api::remote_remove,
    api::ssh_api::remote_rename,
    api::ssh_api::remote_download_to_local_path,
    api::ssh_api::remote_upload_from_local_path,
    api::ssh_api::cancel_transfer,
    api::ssh_api::remote_execute,
    api::ssh_api::remote_open_workspace,
    api::ssh_api::remote_close_workspace,
    api::ssh_api::remote_remove_workspace,
    api::ssh_api::remote_get_workspace_info,
    // remote link + terminal profiles (wave 4)
    api::ssh_api::remote_workspace_ensure_connected,
    api::ssh_api::remote_workspace_link_states,
    api::terminal_profiles_api::get_terminal_profiles,
    api::terminal_profiles_api::upsert_terminal_profile,
    api::terminal_profiles_api::delete_terminal_profile,
    api::terminal_profiles_api::import_terminal_profiles,
    // Remote port forwarding (local `-L` mappings, user-driven)
    api::ssh_api::ssh_start_port_forward,
    api::ssh_api::ssh_stop_port_forward,
    api::ssh_api::ssh_list_port_forwards,
    api::ssh_api::ssh_list_remote_listening_ports,
    // Detached task dispatch (controller-side SSH transport)
    api::dispatch_api::dispatch_list_targets,
    api::dispatch_api::dispatch_probe_target,
    api::dispatch_api::dispatch_sync_model_config,
    api::dispatch_api::dispatch_submit,
    api::dispatch_api::dispatch_status,
    api::dispatch_api::dispatch_cancel,
    api::dispatch_api::dispatch_sync_result,
    api::dispatch_api::dispatch_list_jobs,
    api::dispatch_api::dispatch_answer,
    api::dispatch_api::dispatch_append,
    api::dispatch_api::dispatch_continue,
    api::dispatch_api::dispatch_query,
    api::dispatch_api::dispatch_load_transcript,
    api::dispatch_api::dispatch_save_transcript,
    // Relay self-deploy API
    // Backend protocol listener for browsers and phones (OBP over WebSocket)
    backend_protocol::ws::obp_get_status,
    backend_protocol::ws::obp_create_pairing,
    backend_protocol::ws::obp_revoke_paired_client,
    // The web UI bundle a browser loads from this device (wave 10).
    backend_protocol::ws::ui_bundle_manifest,
    // Device network (OpenBitFun Link in-process; OBP to other account devices)
    mesh::mesh_api::mesh_status,
    mesh::mesh_api::mesh_list_devices,
    // Peer Device Mode over OBP on the mesh (controller side)
    mesh::peer_link::peer_link_connect,
    mesh::peer_link::peer_link_call,
    mesh::peer_link::peer_link_events,
    mesh::peer_link::peer_link_disconnect,
    // Fleet: every runtime host of the account through this one (wave 12).
    fleet::fleet_api::fleet_attention,
    fleet::fleet_api::fleet_attention_mark_read,
    fleet::fleet_api::fleet_call,
    fleet::fleet_api::fleet_device_detail,
    fleet::fleet_api::fleet_events,
    fleet::fleet_api::fleet_models,
    fleet::fleet_api::fleet_navigator,
    fleet::fleet_api::fleet_prompts,
    fleet::fleet_api::fleet_recent_sessions,
    fleet::fleet_api::fleet_subscribe,
    fleet::fleet_api::fleet_ui_bundle,
];

/// Starts the backend services every host runs once its managed state is
/// registered: agentic event delivery, remote connect, browser control
/// reattach, terminal events, MCP/ACP, event emitters and config listeners.
pub(crate) fn start_backend_services(
    host: HostHandle,
    event_queue: Arc<openbitfun_core::agentic::events::EventQueue>,
    event_router: Arc<openbitfun_core::agentic::events::EventRouter>,
    session_event_journal: Arc<SessionEventJournal>,
    startup_log_level: log::LevelFilter,
    startup_trace: &DesktopStartupTrace,
) {
    let transport = Arc::new(HostTransportAdapter::new(host.clone()));

    let step_started = Instant::now();
    start_event_loop_with_transport(event_queue, event_router, transport, session_event_journal);
    startup_trace.record_elapsed_step(
        "native_setup",
        "start_event_loop_with_transport",
        step_started,
    );

    // Eagerly initialize the remote connect service so previously
    // paired bots start listening immediately on app startup.
    let step_started = Instant::now();
    api::remote_connect_api::init_on_startup();
    startup_trace.record_elapsed_step(
        "native_setup",
        "remote_connect_init_on_startup",
        step_started,
    );

    // Reattach to a browser that is already running with remote
    // debugging on, so a OpenBitFun restart does not drop the connection.
    let step_started = Instant::now();
    api::browser_control_api::init_on_startup();
    startup_trace.record_elapsed_step(
        "native_setup",
        "browser_control_init_on_startup",
        step_started,
    );

    {
        let step_started = Instant::now();
        // Share the managed state's initialization guard with commands such
        // as `terminal_get_shells`, which may run before this task starts.
        let terminal_state_inner = host
            .state::<api::terminal_api::TerminalState>()
            .inner()
            .clone();
        let app_handle_clone = host.clone();
        tokio::spawn(async move {
            api::terminal_api::start_terminal_event_loop(terminal_state_inner, app_handle_clone);
        });
        startup_trace.record_elapsed_step(
            "native_setup",
            "spawn_terminal_event_loop",
            step_started,
        );
    }

    let step_started = Instant::now();
    init_mcp_servers(host.clone());
    startup_trace.record_elapsed_step("native_setup", "init_mcp_servers", step_started);
    let step_started = Instant::now();
    init_acp_clients(host.clone());
    startup_trace.record_elapsed_step("native_setup", "init_acp_clients", step_started);

    let step_started = Instant::now();
    init_services(host.clone(), startup_log_level);
    api::remote_connect_api::set_account_app_handle(host.clone());
    sleep_prevention::spawn_config_listener(host.clone());
    startup_trace.record_elapsed_step("native_setup", "init_services", step_started);

    let step_started = Instant::now();
    logging::spawn_log_cleanup_task();
    startup_trace.record_elapsed_step("native_setup", "spawn_log_cleanup_task", step_started);
}

async fn init_agentic_system() -> anyhow::Result<(
    Arc<openbitfun_core::agentic::coordination::ConversationCoordinator>,
    Arc<openbitfun_core::agentic::coordination::DialogScheduler>,
    Arc<openbitfun_core::agentic::events::EventQueue>,
    Arc<openbitfun_core::agentic::events::EventRouter>,
    Arc<AIClientFactory>,
    Arc<openbitfun_core::service::token_usage::TokenUsageService>,
)> {
    use openbitfun_core::agentic::*;

    let ai_client_factory = AIClientFactory::get_global().await?;

    let event_queue = Arc::new(events::EventQueue::new(Default::default()));
    let event_router = Arc::new(events::EventRouter::new());

    let path_manager = try_get_path_manager_arc()?;
    let persistence_manager = Arc::new(persistence::PersistenceManager::new(path_manager.clone())?);
    // The round executor captures this service at construction so failed or
    // cancelled attempts with unknown usage persist without a usage event.
    let token_usage_service = Arc::new(
        openbitfun_core::service::token_usage::TokenUsageService::new(path_manager.clone())
            .await
            .map_err(|e| anyhow::anyhow!("Failed to initialize token usage service: {}", e))?,
    );
    openbitfun_core::service::token_usage::set_global_token_usage_service(
        token_usage_service.clone(),
    );

    let context_store = Arc::new(session::SessionContextStore::new());
    let context_compressor = Arc::new(session::ContextCompressor::new());

    let session_manager = Arc::new(session::SessionManager::new(
        context_store,
        persistence_manager,
        Default::default(),
    ));

    let tool_registry = tools::registry::get_global_tool_registry();
    let tool_state_manager = Arc::new(tools::pipeline::ToolStateManager::new(event_queue.clone()));
    let permission_request_manager =
        openbitfun_core::product_runtime::core_permission_request_manager()
            .map_err(anyhow::Error::msg)?;

    if let Ok(paths) = openbitfun_core::infrastructure::try_get_path_manager_arc() {
        openbitfun_computer_use::set_ocr_debug_directory(
            paths
                .default_assistant_workspace_dir(None)
                .join(openbitfun_core_types::product_identity::hidden_data_directory())
                .join("computer_use_debug"),
        );
    }
    let computer_use_host: ComputerUseHostRef =
        Arc::new(computer_use::DesktopComputerUseHost::new());
    set_computer_use_host_available(true);

    let tool_pipeline = Arc::new(
        tools::pipeline::ToolPipeline::new(
            tool_registry,
            tool_state_manager,
            Some(computer_use_host),
        )
        .with_permission_request_manager(permission_request_manager),
    );

    let stream_processor = Arc::new(execution::StreamProcessor::new(event_queue.clone()));
    let round_executor = Arc::new(execution::RoundExecutor::new(
        stream_processor,
        event_queue.clone(),
        tool_pipeline.clone(),
    ));

    let execution_config = execution::execution_engine_config_from_global_config().await;

    let execution_engine = execution::ExecutionEngine::new(
        round_executor,
        event_queue.clone(),
        session_manager.clone(),
        context_compressor,
        execution_config,
    );
    let execution_engine = Arc::new(execution_engine);

    let runtime_ownership = Arc::new(
        openbitfun_core::runtime_ownership::CoreRuntimeOwnership::embedded(
            path_manager.as_ref(),
            "desktop",
        ),
    );
    let coordinator = Arc::new(coordination::ConversationCoordinator::new(
        session_manager.clone(),
        execution_engine,
        tool_pipeline,
        event_queue.clone(),
        event_router.clone(),
        runtime_ownership,
    ));
    coordinator.set_terminal_port(
        openbitfun_core::product_runtime::CoreRuntimeServicesProvider::terminal_port(),
    );
    coordinator.set_remote_exec_port(
        openbitfun_core::product_runtime::CoreRuntimeServicesProvider::remote_exec_port(),
    );

    coordination::ConversationCoordinator::set_global(coordinator.clone());

    // The subscriber reuses the round executor's authority. Known-usage events
    // deduplicate by attempt ID; unknown usage is recorded directly by the round.
    let token_usage_subscriber = Arc::new(
        openbitfun_core::service::token_usage::TokenUsageSubscriber::new(
            token_usage_service.clone(),
        ),
    );
    event_router.subscribe_internal("token_usage".to_string(), token_usage_subscriber);
    event_router.subscribe_internal(
        "session_context_usage".to_string(),
        Arc::new(
            openbitfun_core::agentic::session::SessionContextUsageSubscriber::new(
                session_manager.clone(),
            ),
        ),
    );

    log::info!("Token usage service initialized and subscriber registered");

    // Create the DialogScheduler and wire up the outcome notification channel
    let scheduler =
        coordination::DialogScheduler::new(coordinator.clone(), session_manager.clone());
    coordinator.set_scheduler_notifier(scheduler.outcome_sender());
    coordinator.set_round_injection_source(scheduler.round_injection_monitor());
    coordination::set_global_scheduler(scheduler.clone());

    let cron_service = openbitfun_core::service::cron::CronService::new(
        path_manager.clone(),
        coordinator.clone(),
        scheduler.clone(),
    )
    .await
    .map_err(|e| anyhow::anyhow!("Failed to initialize cron service: {}", e))?;
    openbitfun_core::service::cron::set_global_cron_service(cron_service.clone());
    let cron_subscriber = Arc::new(openbitfun_core::service::cron::CronEventSubscriber::new(
        cron_service.clone(),
    ));
    event_router.subscribe_internal("cron_jobs".to_string(), cron_subscriber);
    {
        let cron_service_for_fallback = cron_service.clone();
        // Desktop cron runs can emit FlowChat events immediately. Prefer the
        // frontend readiness handshake, but keep a fallback so cron is not left
        // disabled if the web host never reaches the ready path.
        tokio::spawn(async move {
            tokio::time::sleep(CRON_DESKTOP_START_FALLBACK_DELAY).await;
            log::info!(
                "Ensuring cron service is started after desktop fallback delay: delay_seconds={}",
                CRON_DESKTOP_START_FALLBACK_DELAY.as_secs()
            );
            cron_service_for_fallback.start();
        });
    }

    log::info!("Cron service initialized and waiting for desktop host readiness");
    log::info!("Agentic system initialized");
    Ok((
        coordinator,
        scheduler,
        event_queue,
        event_router,
        ai_client_factory,
        token_usage_service,
    ))
}

async fn init_function_agents(ai_client_factory: Arc<AIClientFactory>) -> anyhow::Result<()> {
    let _ = openbitfun_core::function_agents::git_func_agent::GitFunctionAgent::new(
        ai_client_factory.clone(),
    );

    Ok(())
}

fn init_mcp_servers(app_handle: HostHandle) {
    tokio::spawn(async move {
        let _ = app_handle;
    });
}

fn init_acp_clients(app_handle: HostHandle) {
    tokio::spawn(async move {
        let state: crate::host::State<'_, api::AppState> = app_handle.state();
        if let Some(service) = state.acp_client_service.as_ref() {
            if let Err(error) = service.initialize_all().await {
                log::warn!("Failed to initialize ACP clients: {}", error);
            }
        }
    });
}

fn setup_panic_hook() {
    std::panic::set_hook(Box::new(move |panic_info| {
        let thread = std::thread::current();
        let thread_name = thread.name().map(str::to_string);
        let thread_id = format!("{:?}", thread.id());
        // Never treat unnamed worker threads (e.g., std::thread::spawn in
        // third-party crates) as the main thread.
        let is_main_thread = thread_name.as_deref() == Some("main");

        let location = panic_info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
            .unwrap_or_else(|| "unknown location".to_string());

        let message = panic_info
            .payload()
            .downcast_ref::<&str>()
            .copied()
            .or_else(|| {
                panic_info
                    .payload()
                    .downcast_ref::<String>()
                    .map(String::as_str)
            })
            .unwrap_or("unknown panic message");

        log::error!(
            "Application panic at {} (thread={:?}, id={}, main={}): {}",
            location,
            thread_name,
            thread_id,
            is_main_thread,
            message,
        );
        crate::crash_diagnostics::write_panic_report(
            location.clone(),
            message.to_string(),
            thread_name.clone(),
            thread_id,
        );

        if message.contains("WSAStartup") || message.contains("10093") || message.contains("hyper")
        {
            log::error!("Network-related crash detected, possible solutions:");
            log::error!("  1) Restart the application");
            log::error!("  2) Check Windows network service status");
            log::error!("  3) Run as administrator");
        }

        // Returning from a panic hook does not catch the panic. Leave worker
        // panics to the runtime and any caller-owned unwind boundary; main-thread
        // panics follow the application's fatal cleanup and exit path.
        if !is_main_thread {
            log::warn!("Non-main-thread panic recorded; deferring to the panic runtime");
            return;
        }

        perform_process_exit_cleanup_emergency();
        std::process::exit(1);
    }));
}

static PROCESS_EXIT_CLEANUP_STARTED: AtomicBool = AtomicBool::new(false);
static PROCESS_EXIT_CLEANUP_COMPLETE: AtomicBool = AtomicBool::new(false);
static PROCESS_EXIT_CLEANUP_NOTIFY: OnceLock<tokio::sync::Notify> = OnceLock::new();
static EMERGENCY_CLEANUP_STARTED: AtomicBool = AtomicBool::new(false);

pub(crate) async fn perform_process_exit_cleanup() -> bool {
    let notify = PROCESS_EXIT_CLEANUP_NOTIFY.get_or_init(tokio::sync::Notify::new);
    if PROCESS_EXIT_CLEANUP_STARTED.swap(true, Ordering::AcqRel) {
        loop {
            let notified = notify.notified();
            if PROCESS_EXIT_CLEANUP_COMPLETE.load(Ordering::Acquire) {
                return false;
            }
            notified.await;
        }
    }

    log::info!("Desktop process graceful shutdown started");
    match openbitfun_core::plugin_host::shutdown_configured_plugin_host().await {
        Ok(Some(report)) => log::info!(
            "Desktop plugin host shutdown completed: generation={}, disposition={:?}, rpc_completed={}, exit_code={:?}, duration_ms={}",
            report.generation,
            report.disposition,
            report.rpc_completed,
            report.exit_code,
            report.duration_ms
        ),
        Ok(None) => log::debug!("Desktop plugin host shutdown skipped: host not started"),
        Err(error) => log::warn!("Desktop plugin host shutdown failed: {}", error),
    }
    if let Some(search_service) = get_global_workspace_search_service() {
        search_service.shutdown_blocking();
    }
    openbitfun_core::util::process_manager::cleanup_all_processes();
    api::remote_connect_api::cleanup_on_exit();
    PROCESS_EXIT_CLEANUP_COMPLETE.store(true, Ordering::Release);
    notify.notify_waiters();
    log::info!("Desktop process graceful shutdown completed");
    true
}

pub(crate) fn perform_process_exit_cleanup_emergency() -> bool {
    if PROCESS_EXIT_CLEANUP_COMPLETE.load(Ordering::Acquire)
        || EMERGENCY_CLEANUP_STARTED.swap(true, Ordering::AcqRel)
    {
        return false;
    }
    log::warn!("Desktop emergency process cleanup started");
    // Run emergency cleanup on a helper thread with a bounded wait so a mutex
    // held by the panicking thread can never deadlock the panic hook.
    let (done_tx, done_rx) = std::sync::mpsc::channel();
    if std::thread::Builder::new()
        .name("emergency-exit-cleanup".to_string())
        .spawn(move || {
            if let Some(search_service) = get_global_workspace_search_service() {
                search_service.shutdown_blocking();
            }
            openbitfun_core::util::process_manager::cleanup_all_processes();
            api::remote_connect_api::cleanup_on_exit();
            let _ = done_tx.send(());
        })
        .is_ok()
    {
        let _ = done_rx.recv_timeout(std::time::Duration::from_secs(2));
    } else {
        openbitfun_core::util::process_manager::cleanup_all_processes();
        api::remote_connect_api::cleanup_on_exit();
    }
    true
}

fn configure_workspace_search_daemon_env() -> Option<std::path::PathBuf> {
    let path = openbitfun_core::service::search::resolve_workspace_search_daemon_program_path();
    if let Some(path) = path.as_ref() {
        std::env::set_var("FLASHGREP_DAEMON_BIN", path);
    }
    path
}

/// Deliver one event to the WebView and, when peer controllers are attached,
/// fan it out to paired devices. Text chunks arrive here already coalesced by
/// `TextChunkCoalescer`.
async fn deliver_event_to_webview(
    transport: &HostTransportAdapter,
    event: AgenticEvent,
    session_event_journal: &SessionEventJournal,
) {
    openbitfun_core::service::remote_connect::notify_session_catalog_event(&event);
    let cursor = session_event_journal.record(&event);
    let Some(mut projected) = openbitfun_events::project_agentic_frontend_event(event) else {
        log::warn!("Unhandled AgenticEvent type in desktop delivery");
        return;
    };
    if let Some(cursor) = cursor {
        attach_session_event_cursor(&mut projected.payload, cursor);
    }

    deliver_projected_event(transport, projected).await;
}

/// Final product delivery for native and ACP projections alike. ACP records
/// before enqueueing here; native events record after text coalescing above.
pub(crate) async fn deliver_projected_event(
    transport: &HostTransportAdapter,
    projected: openbitfun_events::AgenticFrontendEvent,
) {
    if let Err(e) = transport
        .emit_generic(&projected.event_name, projected.payload)
        .await
    {
        log::error!("Failed to emit event: {:?}", e);
    }

    // Session events reach controllers through host streams they read on
    // demand. Do not duplicate every payload on the per-controller ephemeral channel.
}

/// Update the rate EMA from a flush that produced `flushed_chars` characters.
///
/// `arm_time` is when the flushed window was armed (the first buffered chunk).
/// When there is a recorded previous flush, the elapsed interval is measured
/// from that point so that an idle gap longer than `RATE_EMA_RESET_MS` resets
/// the estimate instead of blending the old stream's rate into the new one.
fn update_rate_after_flush(
    rate_ema: &mut f64,
    flushed_chars: usize,
    arm_time: tokio::time::Instant,
    last_flush_time: &mut Option<tokio::time::Instant>,
) {
    let now = tokio::time::Instant::now();
    let elapsed = last_flush_time
        .map(|t| now - t)
        .unwrap_or_else(|| arm_time.elapsed());
    *rate_ema = crate::api::event_coalescer::update_rate_ema(*rate_ema, flushed_chars, elapsed);
    *last_flush_time = Some(now);
}

/// Flush all buffered chunks as merged events and feed the flushed content
/// volume back into the rate estimate that sizes the next window.
async fn flush_coalesced<D, F>(
    deliver: &mut D,
    coalescer: &mut crate::api::event_coalescer::TextChunkCoalescer,
    rate_ema: &mut f64,
    arm_time: tokio::time::Instant,
    last_flush_time: &mut Option<tokio::time::Instant>,
) where
    D: FnMut(AgenticEvent) -> F,
    F: std::future::Future<Output = ()>,
{
    let flushed_chars = coalescer.buffered_chars();
    update_rate_after_flush(rate_ema, flushed_chars, arm_time, last_flush_time);
    for event in coalescer.flush() {
        deliver(event).await;
    }
}

/// Drive the agentic event queue: route raw events to internal subscribers,
/// coalesce streamed text chunks, and deliver merged events through `deliver`.
///
/// Scheduling contract:
/// - The coalescing window is armed as soon as the first chunk is buffered
///   (even while the queue is still being drained), so the window counts from
///   the first chunk, not from the end of the drain.
/// - The window timer is only polled at the outer `select!`. Under sustained
///   load the queue may stay non-empty and the drain loop never exits, so an
///   expired deadline is also honored inside the drain: the buffered text is
///   flushed in place before processing continues. Text therefore waits at
///   most one window regardless of queue pressure.
async fn event_loop_driver<D, F>(
    event_queue: Arc<openbitfun_core::agentic::events::EventQueue>,
    event_router: Arc<openbitfun_core::agentic::events::EventRouter>,
    mut deliver: D,
) where
    D: FnMut(AgenticEvent) -> F,
    F: std::future::Future<Output = ()>,
{
    use crate::api::event_coalescer::{
        next_flush_deadline, next_window, TextChunkCoalescer, INITIAL_RATE_EMA_CPS,
    };
    use tokio::time::{sleep_until, Instant};

    let mut coalescer = TextChunkCoalescer::new();
    let mut flush_deadline: Option<Instant> = None;
    // Instant at which the current `flush_deadline` was armed. Kept in sync
    // with the deadline so flushes can measure the actual window elapsed.
    let mut flush_arm_time: Option<Instant> = None;
    // Instant of the previous flush. Used to detect idle gaps that should
    // reset the stream-rate EMA.
    let mut last_flush_time: Option<Instant> = None;
    // Measured stream rate (chars/sec), blended per window flush. Starts at
    // the reference rate so the first window matches the previous fixed
    // 50ms behavior.
    let mut rate_ema = INITIAL_RATE_EMA_CPS;
    let mut last_window = next_window(rate_ema);

    loop {
        let window_timer = async {
            match flush_deadline {
                Some(deadline) => sleep_until(deadline).await,
                // No buffered chunks: wait for the queue without a timer.
                None => std::future::pending::<()>().await,
            }
        };

        tokio::select! {
            _ = event_queue.wait_for_events() => {
                loop {
                    let batch = event_queue.dequeue_configured_batch().await;
                    if batch.is_empty() {
                        break;
                    }

                    for envelope in batch {
                        // Route to internal subscribers (e.g. RemoteSessionStateTracker)
                        // sequentially so that text chunks are appended in order.
                        // Internal routing stays on the raw events; only the
                        // WebView / peer delivery below is coalesced.
                        if let Err(e) = event_router.route(envelope.clone()).await {
                            log::warn!("Internal event routing failed: {:?}", e);
                        }

                        // A non-chunk event flushes pending text immediately.
                        // Capture the flushed volume and the arm time before the
                        // coalescer drains, then feed it into the rate estimate
                        // through the same path as a timer-driven flush.
                        let pre_flush_chars = coalescer.buffered_chars();
                        let arm_time = flush_arm_time;
                        let pushed = coalescer.push(envelope.event);
                        let did_flush = !pushed.is_empty();

                        for event in pushed {
                            deliver(event).await;
                        }

                        if did_flush && pre_flush_chars > 0 {
                            if let Some(arm) = arm_time {
                                update_rate_after_flush(
                                    &mut rate_ema,
                                    pre_flush_chars,
                                    arm,
                                    &mut last_flush_time,
                                );
                            }
                        }

                        // Arm the coalescing window as soon as the first chunk
                        // is buffered so the window counts while the drain is
                        // still running; clear a stale deadline when a flush
                        // (e.g. a non-chunk event) drained the buffer.
                        if coalescer.is_pending() && flush_deadline.is_none() {
                            last_window = next_window(rate_ema);
                        }
                        let now = Instant::now();
                        let new_deadline = next_flush_deadline(
                            coalescer.is_pending(),
                            flush_deadline,
                            now,
                            last_window,
                        );
                        // Keep the arm time in sync with the deadline: record
                        // it when the window is armed, clear it when drained.
                        match (flush_deadline, new_deadline) {
                            (None, Some(_)) => flush_arm_time = Some(now),
                            (Some(_), None) => flush_arm_time = None,
                            _ => {}
                        }
                        flush_deadline = new_deadline;
                    }

                    // The window timer is only polled at the outer select, but
                    // the queue may stay non-empty under sustained load. Honor
                    // an expired deadline here so the throttle semantics hold
                    // (text waits at most one window) no matter how busy the
                    // queue is.
                    if flush_deadline.is_some_and(|deadline| Instant::now() >= deadline) {
                        let arm_time = flush_arm_time
                            .expect("arm_time must be set when a deadline is armed");
                        flush_deadline = None;
                        flush_arm_time = None;
                        flush_coalesced(
                            &mut deliver,
                            &mut coalescer,
                            &mut rate_ema,
                            arm_time,
                            &mut last_flush_time,
                        )
                        .await;
                    }
                }
            }
            _ = window_timer => {
                let arm_time = flush_arm_time
                    .expect("arm_time must be set when a deadline is armed");
                flush_deadline = None;
                flush_arm_time = None;
                flush_coalesced(
                    &mut deliver,
                    &mut coalescer,
                    &mut rate_ema,
                    arm_time,
                    &mut last_flush_time,
                )
                .await;
            }
        }
    }
}

fn start_event_loop_with_transport(
    event_queue: Arc<openbitfun_core::agentic::events::EventQueue>,
    event_router: Arc<openbitfun_core::agentic::events::EventRouter>,
    transport: Arc<HostTransportAdapter>,
    session_event_journal: Arc<SessionEventJournal>,
) {
    tokio::spawn(async move {
        event_loop_driver(event_queue, event_router, |event| {
            let transport = transport.clone();
            let session_event_journal = session_event_journal.clone();
            async move {
                deliver_event_to_webview(&transport, event, &session_event_journal).await;
            }
        })
        .await;
    });
}

fn init_services(app_handle: HostHandle, default_log_level: log::LevelFilter) {
    use openbitfun_core::{infrastructure, service};

    spawn_runtime_log_level_listener(default_log_level);
    spawn_workspace_search_feature_listener(app_handle.clone());

    tokio::spawn(async move {
        let transport = Arc::new(HostTransportAdapter::new(app_handle.clone()));
        let emitter = create_event_emitter(transport);
        let workspace_identity_watch_service = {
            let app_state: crate::host::State<'_, api::app_state::AppState> = app_handle.state();
            app_state.workspace_identity_watch_service.clone()
        };

        service::snapshot::initialize_snapshot_event_emitter(emitter.clone());

        openbitfun_core::service::initialize_file_watch_service(emitter.clone());
        // Live Git status (`git://status-changed`) for leased repositories.
        openbitfun_core::service::git::status_watch::get_global_git_status_monitor()
            .set_emitter(emitter.clone());

        if let Err(e) = workspace_identity_watch_service
            .set_event_emitter(emitter.clone())
            .await
        {
            log::error!(
                "Failed to initialize workspace identity watch service: {}",
                e
            );
        }

        // Workspaces opened by remote controllers, IM bots, or Peer Mode
        // controllers change the host catalog without a webview command;
        // the webview re-reads its opened/recent lists on this hint.
        service::workspace::start_workspace_catalog_publication(emitter.clone());

        let event_system = infrastructure::events::get_global_event_system();
        event_system.set_emitter(emitter).await;
    });
}

async fn resolve_runtime_log_level(default_level: log::LevelFilter) -> log::LevelFilter {
    use openbitfun_core::service::config::get_global_config_service;

    if let Ok(config_service) = get_global_config_service().await {
        if let Ok(config_level) = config_service
            .get_config::<String>(Some("app.logging.level"))
            .await
        {
            if let Some(level) = logging::parse_log_level(&config_level) {
                return level;
            }
            log::warn!(
                "Invalid app.logging.level '{}', falling back to default={}",
                config_level,
                logging::level_to_str(default_level)
            );
        }
    }

    default_level
}

fn spawn_runtime_log_level_listener(default_level: log::LevelFilter) {
    use openbitfun_core::service::config::{subscribe_config_updates, ConfigUpdateEvent};

    tokio::spawn(async move {
        if let Some(mut receiver) = subscribe_config_updates() {
            loop {
                match receiver.recv().await {
                    Ok(ConfigUpdateEvent::LogLevelUpdated { new_level }) => {
                        if let Some(level) = logging::parse_log_level(&new_level) {
                            logging::apply_runtime_log_level(level, "config_update_event");
                            if let Err(error) =
                                openbitfun_core::plugin_host::set_configured_plugin_host_log_level(
                                    logging::level_to_str(level),
                                )
                                .await
                            {
                                log::warn!("Failed to update plugin host log level: {}", error);
                            }
                        } else {
                            log::warn!(
                                "Received invalid log level from config update event: {}",
                                new_level
                            );
                        }
                    }
                    Ok(ConfigUpdateEvent::ConfigReloaded) => {
                        let level = resolve_runtime_log_level(default_level).await;
                        logging::apply_runtime_log_level(level, "config_reloaded");
                        if let Err(error) =
                            openbitfun_core::plugin_host::set_configured_plugin_host_log_level(
                                logging::level_to_str(level),
                            )
                            .await
                        {
                            log::warn!("Failed to update plugin host log level: {}", error);
                        }
                    }
                    Ok(_) => {}
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                        log::warn!("Log-level listener channel closed, stopping listener");
                        break;
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                        log::warn!("Log-level listener lagged by {} messages", n);
                    }
                }
            }
        } else {
            log::warn!("Config update subscription unavailable for log-level listener");
        }
    });
}

fn create_event_emitter(
    transport: Arc<HostTransportAdapter>,
) -> Arc<dyn openbitfun_core::infrastructure::events::EventEmitter> {
    use openbitfun_transport::TransportEmitter;
    let inner: Arc<dyn openbitfun_core::infrastructure::events::EventEmitter> =
        Arc::new(TransportEmitter::new(transport));
    api::miniapp_agent_api::wrap_miniapp_agent_context_cleanup_emitter(inner)
}

fn spawn_workspace_search_feature_listener(app_handle: HostHandle) {
    use openbitfun_core::service::config::{subscribe_config_updates, ConfigUpdateEvent};

    let app_state: crate::host::State<'_, api::AppState> = app_handle.state();
    let workspace_search_service = app_state.workspace_search_service.clone();
    let workspace_id = app_state.workspace_id.clone();
    let workspace_service = app_state.workspace_service.clone();

    tokio::spawn(async move {
        let mut feature_enabled =
            openbitfun_core::service::search::workspace_search_feature_enabled().await;

        let Some(mut receiver) = subscribe_config_updates() else {
            log::warn!("Config update subscription unavailable for workspace search listener");
            return;
        };

        loop {
            match receiver.recv().await {
                Ok(ConfigUpdateEvent::AppUpdated) | Ok(ConfigUpdateEvent::ConfigReloaded) => {
                    let next_enabled =
                        openbitfun_core::service::search::workspace_search_feature_enabled().await;

                    if next_enabled == feature_enabled {
                        continue;
                    }

                    if !next_enabled {
                        workspace_search_service.stop_all_daemons().await;
                        log::info!(
                            "Workspace search feature disabled; stopped flashgrep daemon and cleared sessions"
                        );
                        feature_enabled = false;
                        continue;
                    }

                    let resolved_path = configure_workspace_search_daemon_env();
                    if !openbitfun_core::service::search::workspace_search_daemon_available() {
                        log::warn!(
                            "Workspace search feature enabled but daemon is unavailable: path={:?}, hint={}",
                            resolved_path.as_ref().map(|path| path.display().to_string()),
                            openbitfun_core::service::search::workspace_search_daemon_missing_hint()
                        );
                        feature_enabled = true;
                        continue;
                    }

                    let selected_id = workspace_id.read().await.clone();
                    let current_workspace = if let Some(id) = selected_id {
                        workspace_service.get_workspace(&id).await
                    } else {
                        None
                    };
                    if let Some(current_workspace) = current_workspace {
                        if current_workspace.workspace_kind
                            != openbitfun_core::service::workspace::WorkspaceKind::Remote
                        {
                            let current_workspace = current_workspace.root_path;
                            match workspace_search_service.open_repo(&current_workspace).await {
                                Ok(_) => {
                                    workspace_search_service.schedule_auto_index(
                                        &current_workspace,
                                        openbitfun_core::service::search::WorkspaceSearchAutoIndexPriority::Focused,
                                    ).await;
                                    log::info!(
                                        "Workspace search feature enabled; warmed current workspace: path={}",
                                        current_workspace.display()
                                    );
                                }
                                Err(error) => {
                                    log::warn!(
                                        "Workspace search feature enabled but failed to warm current workspace: path={}, error={}",
                                        current_workspace.display(),
                                        error
                                    );
                                }
                            }
                        }
                    }

                    feature_enabled = true;
                }
                Ok(_) => {}
                Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                    log::warn!("Workspace search feature listener channel closed");
                    break;
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    log::warn!("Workspace search feature listener lagged by {} messages", n);
                }
            }
        }
    });
}

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

#[cfg(test)]
mod event_loop_driver_tests {
    use super::*;
    use openbitfun_core::agentic::events::{EventQueue, EventQueueConfig, EventRouter};

    fn text_chunk(text: &str) -> AgenticEvent {
        AgenticEvent::TextChunk {
            session_id: "s".to_string(),
            turn_id: "t".to_string(),
            round_id: "r".to_string(),
            attempt_id: None,
            attempt_index: None,
            text: text.to_string(),
        }
    }

    /// Regression test for the P1 scheduling issue: the window timer is only
    /// polled at the outer `select!`, so a drain loop that never finds an
    /// empty queue (sustained producer load) must still honor the deadline
    /// in place. The first flush must happen ~one window after the first
    /// chunk, and further windows must keep firing while the queue stays
    /// non-empty.
    ///
    /// Setup: the producer enqueues one chunk per millisecond and delivery
    /// stalls one millisecond per event, so the drain loop never sees an
    /// empty queue. The paused clock steps 1ms at a time so producer and
    /// driver advance deterministically.
    #[tokio::test(start_paused = true)]
    async fn flush_timer_fires_while_queue_stays_non_empty() {
        let queue = Arc::new(EventQueue::new(EventQueueConfig {
            max_queue_size: 10000,
            batch_size: 10,
        }));
        let router = Arc::new(EventRouter::new());
        let received: Arc<tokio::sync::Mutex<Vec<AgenticEvent>>> =
            Arc::new(tokio::sync::Mutex::new(Vec::new()));

        let producer_queue = queue.clone();
        let producer = tokio::spawn(async move {
            for i in 0..1000 {
                producer_queue
                    .enqueue(text_chunk(&format!("chunk{i} ")), None)
                    .await
                    .expect("enqueue should succeed");
                tokio::time::sleep(Duration::from_millis(1)).await;
            }
        });

        let driver_queue = queue.clone();
        let driver_received = received.clone();
        let driver = tokio::spawn(async move {
            event_loop_driver(driver_queue, router, |event| {
                let received = driver_received.clone();
                async move {
                    received.lock().await.push(event);
                    // Slow delivery down so the drain never finds the queue
                    // empty while the producer keeps enqueueing.
                    tokio::time::sleep(Duration::from_millis(1)).await;
                }
            })
            .await;
        });

        let mut first_flush_at_ms: Option<u128> = None;
        for step in 0..300 {
            tokio::time::advance(Duration::from_millis(1)).await;
            tokio::task::yield_now().await;
            tokio::task::yield_now().await;
            tokio::task::yield_now().await;
            if first_flush_at_ms.is_none() && !received.lock().await.is_empty() {
                first_flush_at_ms = Some(step as u128 + 1);
            }
        }

        let first = first_flush_at_ms.expect(
            "expected a flush within the first window; with the drain loop never \
             exiting, the deadline must still be honored in place",
        );
        // First chunk lands at ~1ms; the initial window is 50ms, so the first
        // flush must land around 51ms. 40..=120 is a generous bound that still
        // fails if the deadline only starts after the drain loop exits.
        assert!(
            (40..=120).contains(&first),
            "first flush at {first}ms, expected ~50ms after the first chunk"
        );

        let total = received.lock().await.len();
        assert!(
            total >= 3,
            "expected multiple window flushes during sustained drain, got {total}"
        );

        driver.abort();
        producer.abort();
    }

    /// Under sustained drain, merged text must stay a growing prefix of the
    /// produced stream: no chunk is dropped and none is duplicated.
    #[tokio::test(start_paused = true)]
    async fn sustained_drain_does_not_lose_or_duplicate_text() {
        let queue = Arc::new(EventQueue::new(EventQueueConfig {
            max_queue_size: 10000,
            batch_size: 10,
        }));
        let router = Arc::new(EventRouter::new());
        let received: Arc<tokio::sync::Mutex<Vec<AgenticEvent>>> =
            Arc::new(tokio::sync::Mutex::new(Vec::new()));

        let producer_queue = queue.clone();
        let producer = tokio::spawn(async move {
            for i in 0..1000 {
                producer_queue
                    .enqueue(text_chunk(&format!("x{i} ")), None)
                    .await
                    .expect("enqueue should succeed");
                tokio::time::sleep(Duration::from_millis(1)).await;
            }
        });

        let driver_queue = queue.clone();
        let driver_received = received.clone();
        let driver = tokio::spawn(async move {
            event_loop_driver(driver_queue, router, |event| {
                let received = driver_received.clone();
                async move {
                    received.lock().await.push(event);
                    tokio::time::sleep(Duration::from_millis(1)).await;
                }
            })
            .await;
        });

        for _ in 0..300 {
            tokio::time::advance(Duration::from_millis(1)).await;
            tokio::task::yield_now().await;
            tokio::task::yield_now().await;
            tokio::task::yield_now().await;
        }

        let events = received.lock().await;
        assert!(
            events.len() >= 3,
            "expected multiple flushes, got {}",
            events.len()
        );
        // Each merged event carries only the chunks of its own window; the
        // frontend appends them to the same text item. Concatenated, they must
        // reproduce the producer's chunk sequence exactly: contiguous, no
        // loss, no duplication, no reordering.
        let mut joined = String::new();
        for event in events.iter() {
            if let AgenticEvent::TextChunk { text, .. } = event {
                joined.push_str(text);
            }
        }
        let numbers: Vec<u32> = joined
            .split_whitespace()
            .map(|word| {
                word.strip_prefix('x')
                    .and_then(|n| n.parse::<u32>().ok())
                    .unwrap_or_else(|| panic!("unexpected chunk payload: {word:?}"))
            })
            .collect();
        for (index, number) in numbers.iter().enumerate() {
            assert_eq!(
                *number as usize, index,
                "chunk sequence must be contiguous: got x{number} at position {index}"
            );
        }

        driver.abort();
        producer.abort();
    }
}

/// Opt-in native regression entry; requires a disposable fixture launched by
/// scripts/test-macos-control-roundtrip.mjs and a pumping macOS main run loop.
#[cfg(all(feature = "devtools", target_os = "macos"))]
pub async fn run_native_computer_use_roundtrip_fixture() {
    computer_use::native_control_roundtrip::run().await;
}

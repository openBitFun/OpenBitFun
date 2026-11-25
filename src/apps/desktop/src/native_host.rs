//! In-process native host bootstrap.
//!
//! Starts the backend (configuration, agentic system, managed state, event
//! delivery, remote connect, terminal, MCP/ACP, product control) and exposes
//! it through the transport-neutral [`crate::backend_protocol::BackendService`].
//!
//! The native UI process owns its window, menus and tray (shell channel,
//! `host::shell`). The built-in browser's pages are the UI's web views,
//! driven over the shell channel (`native_browser`). MiniApp windows run in
//! the lightweight shell sidecar (`miniapp_desktop::start_native`).

use std::sync::Arc;
use std::time::Instant;

use crate::backend_protocol::{BackendService, EventHub, DEFAULT_EVENT_REPLAY_CAPACITY};
use crate::host::{HostHandle, NativeHost, NativeHostInfo};
use crate::{crash_diagnostics, logging, BackendCore};

fn native_platform() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "linux"
    }
}

/// A native host with an empty state registry and a fresh event hub.
pub fn create_native_host() -> Arc<NativeHost> {
    NativeHost::new(
        EventHub::new(DEFAULT_EVENT_REPLAY_CAPACITY),
        NativeHostInfo {
            version: crate::VERSION.to_string(),
            platform: native_platform().to_string(),
            data_dir: String::new(),
        },
    )
}

/// Bootstraps the backend into `host`. Must run on the backend's
/// multi-thread Tokio runtime; returns the protocol endpoint once every
/// startup step has run, or the fatal startup error.
pub async fn start_native_backend(host: Arc<NativeHost>) -> Result<BackendService, String> {
    crate::apply_e2e_storage_guard()?;
    let BackendCore {
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
    } = crate::bootstrap_backend_core()
        .await
        .map_err(|failure| failure.message)?;

    let setup_started = Instant::now();
    startup_trace.record_phase("native_host_setup_start", "native_setup");
    let data_dir = path_manager.user_data_dir();

    // Managed state every command handler can borrow (`host::State`).
    let mut controller_dir = data_dir.join("external-control");
    if !crate::miniapp_desktop::host_channel().is_default() {
        controller_dir.push("development");
    }
    host.manage(crate::external_control::DesktopController::new(
        controller_dir,
    ));
    host.manage(app_state);
    host.manage(crate::sleep_prevention::SleepPreventionState::default());
    host.manage(desktop_runtime);
    host.manage(coordinator_state);
    host.manage(scheduler_state);
    host.manage(path_manager);
    host.manage(coordinator);
    host.manage(scheduler);
    host.manage(terminal_state);
    host.manage(startup_trace.clone());

    let step_started = Instant::now();
    if let Err(error) = logging::install_native_runtime_logging(&log_config) {
        log::warn!(
            "Native runtime logging unavailable; early startup log stays active: {}",
            error
        );
    }
    logging::register_runtime_log_state(startup_log_level, session_log_dir);
    crash_diagnostics::log_previous_unexpected_exit_if_any();
    startup_trace.record_elapsed_step(
        "native_setup",
        "register_runtime_log_state_and_crash_diagnostics",
        step_started,
    );
    startup_trace.record_logging_ready_and_stop_persistence();

    for step in startup_timings.steps() {
        log::debug!(
            "Native host startup step completed: step={}, duration_ms={}",
            step.name,
            step.duration_ms
        );
    }

    if workspace_search_enabled {
        match startup_flashgrep_path {
            Some(path) => log::info!(
                "Workspace search daemon startup check passed: path={}",
                path.display()
            ),
            None => log::warn!(
                "Workspace search daemon startup check failed: {}",
                openbitfun_core::service::search::workspace_search_daemon_missing_hint()
            ),
        }
    }
    let handle = HostHandle::new(Arc::clone(&host));
    crate::miniapp_desktop::start_native(&handle);
    // Agent MiniApp automation: independent windows answer through their
    // agent bridge; the in-product tab surface needs a UI that attaches it.
    crate::miniapp_web_host::install(handle.clone());
    crate::openbitfun_control_host::install(handle.clone());
    // Agent browser tools drive the UI's web views through the shell channel.
    crate::native_browser::install(Arc::clone(&host));
    // Desktop cards: the store, refresh timers and the DesktopCard tool host;
    // the shell draws the windows (wave 22, P3).
    if let Err(error) = crate::desktop_cards::install(&handle) {
        log::warn!("Desktop cards unavailable: {}", error);
    }
    let settings_sync_handle = handle.clone();
    crate::start_backend_services(
        handle,
        event_queue,
        event_router,
        session_event_journal,
        startup_log_level,
        &startup_trace,
    );

    host.set_info(NativeHostInfo {
        version: crate::VERSION.to_string(),
        platform: native_platform().to_string(),
        data_dir: data_dir.display().to_string(),
    });
    startup_trace.record_elapsed_step("native_setup", "native_host_setup", setup_started);
    log::info!(
        "OpenBitFun native backend started: since_process_start_ms={}",
        openbitfun_core::util::elapsed_ms(startup_started)
    );
    let service = BackendService::new(host);
    // Browsers and phones reach the same service over WebSocket (loopback by
    // default, the LAN when the user enabled it in Devices).
    crate::backend_protocol::ws::start_for_native_host(service.clone(), &data_dir).await;
    // Other devices of the signed-in account reach this backend over the
    // device network (OpenBitFun Link in-process + the OBP mesh listener).
    crate::mesh::start_for_native_host(&data_dir);
    // wave24-replica: agents, skills, routines, cards, pets, ... follow it too.
    crate::api::account_records_api::start(settings_sync_handle.clone());
    // Preferences and permission configuration follow the signed-in account.
    crate::api::account_settings_sync_api::start(settings_sync_handle);
    crate::external_control::restore(service.host_handle()).await;
    Ok(service)
}

/// Graceful shutdown: stops HTML previews, terminals/remote PTYs, SSH port
/// forwards and connections, mesh/OBP, plugin host, search daemons and child
/// processes, marks a clean exit and closes the event stream.
pub async fn shutdown_native_backend(service: &BackendService, reason: &'static str) {
    crate::api::html_preview_api::release_all_previews();
    let host = service.host();
    if let Some(controller) = host.try_state::<Arc<crate::external_control::DesktopController>>() {
        controller.stop().await;
    }
    if let Some(terminal_state) = host.try_state::<crate::api::terminal_api::TerminalState>() {
        if tokio::time::timeout(
            std::time::Duration::from_secs(3),
            crate::api::terminal_api::terminal_shutdown_all(terminal_state),
        )
        .await
        .is_err()
        {
            log::warn!("Timed out shutting down terminal sessions during exit");
        }
    }
    if let Some(app_state) = host.try_state::<crate::api::app_state::AppState>() {
        if tokio::time::timeout(std::time::Duration::from_secs(3), async {
            app_state.port_forward_manager.stop_all().await;
            if let Ok(manager) = app_state.get_ssh_manager_async().await {
                manager.disconnect_all().await;
            }
        })
        .await
        .is_err()
        {
            log::warn!("Timed out stopping SSH connections and port forwards during exit");
        }
    }
    crate::mesh::shutdown_global().await;
    crate::backend_protocol::ws::shutdown_global();
    crate::perform_process_exit_cleanup().await;
    crash_diagnostics::mark_clean_shutdown(reason);
    service.events().close();
}

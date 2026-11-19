//! In-process native host bootstrap.
//!
//! Starts the same backend the Tauri host runs (configuration, agentic
//! system, managed state, event delivery, remote connect, terminal, MCP/ACP,
//! product control) without a Tauri application, and exposes it through the
//! transport-neutral [`crate::backend_protocol::BackendService`].
//!
//! Startup steps that only make sense with a Tauri webview or window (menus,
//! tray, window geometry and recovery, the frontend asset protocol, embedded
//! WebDriver, the builtin browser, MiniApp windows and desktop cards) are not
//! started: the native UI process owns its window, menus and tray.

use std::sync::{Arc, OnceLock};
use std::time::Instant;

use crate::backend_protocol::{BackendService, EventHub, DEFAULT_EVENT_REPLAY_CAPACITY};
use crate::host::{HostHandle, NativeHost, NativeHostInfo};
use crate::{api, crash_diagnostics, logging, BackendCore};

static NATIVE_ASYNC_RUNTIME: OnceLock<()> = OnceLock::new();

fn native_platform() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "linux"
    }
}

/// The mobile-web bundle: `OPENBITFUN_MOBILE_WEB_DIR`, the packaged app's
/// resources, or the repository build output in development builds.
fn native_mobile_web_dir() -> Option<std::path::PathBuf> {
    let mut candidates = Vec::new();
    if let Some(dir) = std::env::var_os("OPENBITFUN_MOBILE_WEB_DIR") {
        candidates.push(std::path::PathBuf::from(dir));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(contents) = exe.parent().and_then(|dir| dir.parent()) {
            candidates.push(contents.join("Resources/mobile-web/dist"));
        }
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("mobile-web/dist"));
        }
    }
    if cfg!(debug_assertions) {
        candidates.push(
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../mobile-web/dist"),
        );
    }
    candidates
        .into_iter()
        .find(|dir| dir.join("index.html").is_file())
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
    // Desktop code still spawns through `tauri::async_runtime`; point it at
    // this runtime so the native host never starts a second Tokio runtime.
    NATIVE_ASYNC_RUNTIME.get_or_init(|| {
        tauri::async_runtime::set(tokio::runtime::Handle::current());
    });

    crate::apply_e2e_storage_guard()?;
    let BackendCore {
        startup_started,
        startup_trace_id: _,
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
        frontend_workbench,
    } = crate::bootstrap_backend_core()
        .await
        .map_err(|failure| failure.message)?;

    let setup_started = Instant::now();
    startup_trace.record_phase("native_host_setup_start", "native_setup");
    let data_dir = path_manager.user_data_dir();

    // The same managed state the Tauri builder registers, minus window-only
    // state (main-window geometry, MiniApp window hosts, desktop cards).
    host.manage(app_state);
    host.manage(crate::sleep_prevention::SleepPreventionState::default());
    host.manage(desktop_runtime);
    host.manage(coordinator_state);
    host.manage(scheduler_state);
    host.manage(path_manager);
    host.manage(coordinator);
    host.manage(scheduler);
    host.manage(terminal_state);
    host.manage(frontend_workbench);
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
    match native_mobile_web_dir() {
        Some(path) => {
            log::info!("Found bundled mobile-web at: {}", path.display());
            api::remote_connect_api::set_mobile_web_resource_path(path);
        }
        None => log::info!(
            "Native host has no bundled mobile-web resources; remote connect serves the relay-hosted mobile web only"
        ),
    }

    let handle = HostHandle::Native(Arc::clone(&host));
    crate::openbitfun_control_host::install(handle.clone());
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
    Ok(service)
}

/// Graceful shutdown: stops plugin host, search daemons and child processes,
/// marks a clean exit and closes the event stream.
pub async fn shutdown_native_backend(service: &BackendService, reason: &'static str) {
    crate::backend_protocol::ws::shutdown_global();
    crate::perform_process_exit_cleanup().await;
    crash_diagnostics::mark_clean_shutdown(reason);
    service.events().close();
}

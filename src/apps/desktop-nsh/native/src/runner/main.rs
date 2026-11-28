//! `openbitfun-nsh`: the OpenBitFun desktop as a native NSH app.
//!
//! The UI is the shared TSX app (`src/nsh-ui`, bundled by
//! `nsh build src/apps/desktop-nsh`); the backend is the desktop backend
//! library (`libopenbitfun_desktop_lib`), loaded into this process and
//! reached through its C ABI — the transport-neutral backend protocol. No
//! webview and no Tauri event loop run here.
//!
//! The backend bootstraps on its own runtime concurrently with the UI's
//! first frame; `Backend.ready()` reports the outcome.
//!
//! One runner for the three desktops: NSH's release runner of each platform
//! (`nsh-macos-app` / AppKit, `nsh-windows-app` / Win32 + WebView2,
//! `nsh-linux-app` / GTK) with the same backend library and native module.
//! The JS bundle comes from `NSH_APP_DIR`, else the package layout of the
//! platform: `<App>.app/Contents/Resources/nsh` on macOS, `nsh\` next to
//! the executable on Windows and `nsh/` next to it on Linux.

// Launch packaged Windows builds from Explorer without allocating a console.
#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

#[cfg(any(target_os = "macos", windows, target_os = "linux"))]
mod backend_library;
#[cfg(any(target_os = "macos", windows, target_os = "linux"))]
mod bridge;
#[cfg(any(target_os = "macos", windows, target_os = "linux"))]
mod folder_picker;
#[cfg(target_os = "macos")]
mod genui_card;
#[cfg(any(target_os = "macos", windows, target_os = "linux"))]
mod miniapp_launch;
#[cfg(windows)]
mod panel_context_menu;
#[cfg(target_os = "macos")]
mod panel_drag;

use std::process::ExitCode;

/// How long a quit waits for the backend's graceful shutdown.
#[cfg(any(target_os = "macos", windows, target_os = "linux"))]
const SHUTDOWN_TIMEOUT_MS: u32 = 10_000;

/// NSH's release runner of this platform.
#[cfg(target_os = "macos")]
mod platform {
    pub(crate) fn set_ui_sets(sets: Vec<nsh_core::element::Registry>) {
        nsh_platform_macos::set_ui_sets(sets);
    }
    pub(crate) fn run() -> std::process::ExitCode {
        nsh_macos_app::main()
    }
    /// NativeUI cards run in engines nested in the transcript (`genui_card`).
    /// Off unless `OPENBITFUN_NATIVE_UI_CARDS=1`: NSH 0.7.1 draws a second
    /// embedded engine in one process in the wrong place, so a card would
    /// show as an empty area. The UI then shows the card's source instead.
    pub(crate) fn register_native_cards() -> bool {
        if std::env::var_os("OPENBITFUN_NATIVE_UI_CARDS").as_deref() != Some(std::ffi::OsStr::new("1")) {
            return false;
        }
        nsh_platform_macos::set_components(super::genui_card::register);
        true
    }
}

#[cfg(windows)]
mod platform {
    pub(crate) fn set_ui_sets(sets: Vec<nsh_core::element::Registry>) {
        nsh_platform_windows::set_ui_sets(sets);
    }
    pub(crate) fn run() -> std::process::ExitCode {
        nsh_windows_app::main()
    }
    /// NativeUI cards need a nested engine view; not implemented here yet.
    pub(crate) fn register_native_cards() -> bool {
        false
    }
}

#[cfg(target_os = "linux")]
mod platform {
    pub(crate) fn set_ui_sets(sets: Vec<nsh_core::element::Registry>) {
        nsh_platform_linux::set_ui_sets(sets);
    }
    pub(crate) fn run() -> std::process::ExitCode {
        nsh_linux_app::main()
    }
    /// NativeUI cards need a nested engine view; not implemented here yet.
    pub(crate) fn register_native_cards() -> bool {
        false
    }
}

#[cfg(any(target_os = "macos", windows, target_os = "linux"))]
fn main() -> ExitCode {
    if miniapp_launch::handle_cli_launch() {
        return ExitCode::SUCCESS;
    }
    let backend = match backend_library::BackendLibrary::load() {
        Ok(backend) => Some(backend),
        Err(error) => {
            eprintln!("{error}");
            // The UI still opens and shows the failure (`ready()` rejects).
            openbitfun_nsh_native::fail(error);
            None
        }
    };
    let mut native_registry = openbitfun_nsh_native::registry();
    if let Some(backend) = backend {
        bridge::start(backend);
        register_lifecycle_shutdown(&mut native_registry, backend);
        #[cfg(not(windows))]
        register_exit_shutdown(backend);
    }

    #[cfg(target_os = "macos")]
    panel_drag::install();
    #[cfg(windows)]
    native_registry.setup(panel_context_menu::install);

    platform::set_ui_sets(vec![nsh_base::registry(), native_registry]);
    openbitfun_nsh_native::set_native_cards_available(platform::register_native_cards());
    let exit = platform::run();

    // Fallback when the runner returned before the NSH engine started; after a
    // normal quit `on_app_quit` already ran and this is an idempotent no-op.
    if let Some(backend) = backend {
        backend.shutdown(SHUTDOWN_TIMEOUT_MS);
    }
    exit
}

/// Triggers graceful backend shutdown from the NSH app lifecycle before the
/// platform exits the process (including macOS intercepted system quits and
/// Windows/Linux exits where `atexit` cannot safely run `runtime.block_on`).
#[cfg(any(target_os = "macos", windows, target_os = "linux"))]
fn register_lifecycle_shutdown(
    registry: &mut nsh_core::element::Registry,
    backend: &'static backend_library::BackendLibrary,
) {
    registry.setup(move || {
        let _ = nsh_core::element::create_root(|| {
            nsh_core::element::desktop::on_app_quit(move || {
                backend.shutdown(SHUTDOWN_TIMEOUT_MS);
                std::future::ready(())
            });
        });
    });
}

/// Non-blocking last-resort fallback on Unix (`timeout_ms == 0`, so it never
/// calls `runtime.block_on` during process teardown). Skipped on Windows,
/// where `ExitProcess` terminates worker threads before running `atexit`.
/// When `on_app_quit` or `main` already ran, this is an instant atomic no-op.
#[cfg(any(target_os = "macos", target_os = "linux"))]
fn register_exit_shutdown(backend: &'static backend_library::BackendLibrary) {
    use std::sync::OnceLock;

    static BACKEND: OnceLock<&'static backend_library::BackendLibrary> = OnceLock::new();

    extern "C" fn shutdown_at_exit() {
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            if let Some(backend) = BACKEND.get() {
                backend.shutdown(0);
            }
        }));
    }

    extern "C" {
        fn atexit(callback: extern "C" fn()) -> std::ffi::c_int;
    }

    if BACKEND.set(backend).is_ok() {
        // SAFETY: registers a plain `extern "C"` function with the C runtime.
        if unsafe { atexit(shutdown_at_exit) } != 0 {
            eprintln!("openbitfun-nsh: could not register the backend shutdown at exit");
        }
    }
}

#[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
fn main() -> ExitCode {
    eprintln!("openbitfun-nsh: the native desktop runs on macOS, Windows and Linux");
    ExitCode::FAILURE
}

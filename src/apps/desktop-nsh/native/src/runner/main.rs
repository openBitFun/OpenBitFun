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

#[cfg(any(target_os = "macos", windows, target_os = "linux"))]
mod backend_library;
#[cfg(any(target_os = "macos", windows, target_os = "linux"))]
mod bridge;
#[cfg(target_os = "macos")]
mod folder_picker;

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
}

#[cfg(windows)]
mod platform {
    pub(crate) fn set_ui_sets(sets: Vec<nsh_core::element::Registry>) {
        nsh_platform_windows::set_ui_sets(sets);
    }
    pub(crate) fn run() -> std::process::ExitCode {
        nsh_windows_app::main()
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
}

#[cfg(any(target_os = "macos", windows, target_os = "linux"))]
fn main() -> ExitCode {
    let backend = match backend_library::BackendLibrary::load() {
        Ok(backend) => Some(backend),
        Err(error) => {
            eprintln!("{error}");
            // The UI still opens and shows the failure (`ready()` rejects).
            openbitfun_nsh_native::fail(error);
            None
        }
    };
    if let Some(backend) = backend {
        bridge::start(backend);
        register_exit_shutdown(backend);
    }

    platform::set_ui_sets(vec![
        nsh_base::registry(),
        openbitfun_nsh_native::registry(),
    ]);
    let exit = platform::run();

    // The UI quit (`Application.quit()` or the last window closed): shut the
    // backend down gracefully, bounded so a stuck service cannot keep the
    // process alive.
    if let Some(backend) = backend {
        backend.shutdown(SHUTDOWN_TIMEOUT_MS);
    }
    exit
}

/// A quit the app intercepted (a JS quit handler that then approves it)
/// ends in AppKit's `terminate:` (and the platform's exit elsewhere), which
/// exits the process without returning from the runner: shut the backend
/// down from `atexit` too. The shutdown is idempotent, so the normal path's
/// explicit call makes this a no-op.
#[cfg(any(target_os = "macos", windows, target_os = "linux"))]
fn register_exit_shutdown(backend: &'static backend_library::BackendLibrary) {
    use std::sync::OnceLock;

    static BACKEND: OnceLock<&'static backend_library::BackendLibrary> = OnceLock::new();

    extern "C" fn shutdown_at_exit() {
        if let Some(backend) = BACKEND.get() {
            backend.shutdown(SHUTDOWN_TIMEOUT_MS);
        }
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

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

#[cfg(target_os = "macos")]
mod backend_library;
#[cfg(target_os = "macos")]
mod bridge;
#[cfg(target_os = "macos")]
mod folder_picker;

use std::process::ExitCode;

/// How long a quit waits for the backend's graceful shutdown.
#[cfg(target_os = "macos")]
const SHUTDOWN_TIMEOUT_MS: u32 = 10_000;

#[cfg(target_os = "macos")]
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

    nsh_platform_macos::set_ui_sets(vec![
        nsh_base::registry(),
        openbitfun_nsh_native::registry(),
    ]);
    let exit = nsh_macos_app::main();

    // The UI quit (`Application.quit()` or the last window closed): shut the
    // backend down gracefully, bounded so a stuck service cannot keep the
    // process alive.
    if let Some(backend) = backend {
        backend.shutdown(SHUTDOWN_TIMEOUT_MS);
    }
    exit
}

/// A quit the app intercepted (a JS quit handler that then approves it)
/// ends in AppKit's `terminate:`, which exits the process without returning
/// from the runner: shut the backend down from `atexit` too. The shutdown is
/// idempotent, so the normal path's explicit call makes this a no-op.
#[cfg(target_os = "macos")]
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

#[cfg(not(target_os = "macos"))]
fn main() -> ExitCode {
    // Windows and Linux keep the Tauri desktop for this release; their NSH
    // runners (`nsh-windows-app`, `nsh-linux-app`) are wired in a later one.
    eprintln!(
        "openbitfun-nsh: the native NSH desktop host currently runs on macOS only; use the OpenBitFun desktop build on this platform"
    );
    ExitCode::FAILURE
}

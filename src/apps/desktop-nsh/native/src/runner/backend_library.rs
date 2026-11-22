//! Loads the desktop backend library and binds its C ABI
//! (`openbitfun_desktop_lib::backend_protocol::ffi`).

use std::ffi::c_void;
use std::path::PathBuf;

/// The ABI version this runner speaks.
const BACKEND_ABI_VERSION: u32 = 1;

/// `status` of a successful result callback.
pub(crate) const BACKEND_STATUS_OK: i32 = 0;

pub(crate) type ResultCallback = extern "C" fn(*mut c_void, i32, *const u8, usize);
pub(crate) type EventsCallback = extern "C" fn(*mut c_void, *const u8, usize, u32, u64, bool);

type AbiVersionFn = unsafe extern "C" fn() -> u32;
type StartFn = unsafe extern "C" fn(ResultCallback, *mut c_void);
type InvokeFn =
    unsafe extern "C" fn(*const u8, usize, *const u8, usize, ResultCallback, *mut c_void);
type EventsAfterFn = unsafe extern "C" fn(u64, u32, EventsCallback, *mut c_void);
type LogFn = unsafe extern "C" fn(*const u8, usize, *const u8, usize);
type ShutdownFn = unsafe extern "C" fn(u32);

/// File name of the backend library on this platform.
fn library_file_name() -> String {
    libloading::library_filename("openbitfun_desktop_lib")
        .to_string_lossy()
        .into_owned()
}

/// Where the library is looked for: `OPENBITFUN_BACKEND_LIB`, next to the
/// executable (development: `target/<profile>`), the macOS app bundle's
/// `Frameworks`, and Linux's `../lib` FHS directory.
fn candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(path) = std::env::var_os("OPENBITFUN_BACKEND_LIB") {
        candidates.push(PathBuf::from(path));
    }
    if let Ok(exe) = std::env::current_exe() {
        let exe = exe.canonicalize().unwrap_or(exe);
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join(library_file_name()));
            #[cfg(target_os = "macos")]
            candidates.push(dir.join("../Frameworks").join(library_file_name()));
            #[cfg(target_os = "linux")]
            candidates.push(dir.join("../lib").join(library_file_name()));
        }
    }
    candidates
}

/// The bound backend library. Leaked: it lives until process exit.
#[derive(Clone, Copy)]
pub(crate) struct BackendLibrary {
    start: StartFn,
    invoke: InvokeFn,
    events_after: EventsAfterFn,
    log: LogFn,
    shutdown: ShutdownFn,
}

impl BackendLibrary {
    pub(crate) fn load() -> Result<&'static Self, String> {
        let tried = candidates();
        let path = tried.iter().find(|path| path.is_file()).ok_or_else(|| {
            format!(
                "OpenBitFun backend library not found (build it with `cargo build -p openbitfun-desktop --lib`); tried: {}",
                tried
                    .iter()
                    .map(|path| path.display().to_string())
                    .collect::<Vec<_>>()
                    .join(", ")
            )
        })?;
        // SAFETY: loading runs the library's initializers; the library is
        // OpenBitFun's own backend, found at a path this process controls.
        let library = unsafe { libloading::Library::new(path) }
            .map_err(|error| format!("Failed to load {}: {error}", path.display()))?;
        let library: &'static libloading::Library = Box::leak(Box::new(library));
        // SAFETY: the symbol types match `backend_protocol::ffi` of the same
        // ABI version, checked first.
        unsafe {
            let version: libloading::Symbol<AbiVersionFn> =
                library.get(b"obf_backend_abi_version\0").map_err(|error| {
                    format!("{} is not an OpenBitFun backend: {error}", path.display())
                })?;
            let version = version();
            if version != BACKEND_ABI_VERSION {
                return Err(format!(
                    "{} speaks backend ABI {version}; this runner needs {BACKEND_ABI_VERSION}",
                    path.display()
                ));
            }
            fn bind<T: Copy>(
                library: &'static libloading::Library,
                name: &[u8],
            ) -> Result<T, String> {
                // SAFETY: the caller names the symbol with its ABI type.
                unsafe { library.get::<T>(name) }
                    .map(|symbol| *symbol)
                    .map_err(|error| format!("{}: {error}", String::from_utf8_lossy(name)))
            }
            let bound = Self {
                start: bind::<StartFn>(library, b"obf_backend_start\0")?,
                invoke: bind::<InvokeFn>(library, b"obf_backend_invoke\0")?,
                events_after: bind::<EventsAfterFn>(library, b"obf_backend_events_after\0")?,
                log: bind::<LogFn>(library, b"obf_backend_log\0")?,
                shutdown: bind::<ShutdownFn>(library, b"obf_backend_shutdown\0")?,
            };
            Ok(Box::leak(Box::new(bound)))
        }
    }

    pub(crate) fn start(&self, callback: ResultCallback, ctx: *mut c_void) {
        // SAFETY: a bound ABI function; `ctx` is passed back to `callback`.
        unsafe { (self.start)(callback, ctx) }
    }

    pub(crate) fn invoke(
        &self,
        command: &str,
        args: &str,
        callback: ResultCallback,
        ctx: *mut c_void,
    ) {
        // SAFETY: both strings are valid for the call; the library copies them.
        unsafe {
            (self.invoke)(
                command.as_ptr(),
                command.len(),
                args.as_ptr(),
                args.len(),
                callback,
                ctx,
            )
        }
    }

    pub(crate) fn events_after(
        &self,
        after: u64,
        max: u32,
        callback: EventsCallback,
        ctx: *mut c_void,
    ) {
        // SAFETY: a bound ABI function; `ctx` is passed back to `callback`.
        unsafe { (self.events_after)(after, max, callback, ctx) }
    }

    pub(crate) fn log(&self, level: &str, message: &str) {
        // SAFETY: both strings are valid for the call.
        unsafe { (self.log)(level.as_ptr(), level.len(), message.as_ptr(), message.len()) }
    }

    pub(crate) fn shutdown(&self, timeout_ms: u32) {
        // SAFETY: a bound ABI function, called from the main thread after
        // the UI loop returned.
        unsafe { (self.shutdown)(timeout_ms) }
    }
}

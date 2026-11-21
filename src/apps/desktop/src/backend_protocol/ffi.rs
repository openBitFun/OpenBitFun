//! C ABI of the backend protocol.
//!
//! A UI host that is not a Rust dependency of this crate (the NSH desktop
//! runner, packaged next to `libopenbitfun_desktop_lib`) loads the backend
//! library at runtime and talks to it through these functions: the same
//! `dispatch` + sequence-numbered event stream as every other transport,
//! carried as UTF-8 JSON. The backend owns its Tokio runtime.
//!
//! Callbacks run on backend threads; their `data` pointer is valid only for
//! the duration of the call. `ctx` is passed back unchanged.

use std::ffi::c_void;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use serde_json::Value;
use tokio::sync::watch;

use super::{BackendEvent, BackendService};

/// Version of this ABI; a host refuses a library with another version.
pub const BACKEND_ABI_VERSION: u32 = 1;

/// `status` passed to an [`ObfResultCallback`]: success, `data` is JSON.
pub const BACKEND_STATUS_OK: i32 = 0;
/// `status` passed to an [`ObfResultCallback`]: failure, `data` is the error text.
pub const BACKEND_STATUS_ERROR: i32 = 1;

/// Receives one result: `status` and UTF-8 `data` (`len` bytes).
pub type ObfResultCallback =
    extern "C" fn(ctx: *mut c_void, status: i32, data: *const u8, len: usize);

/// Receives one event batch: a JSON array of `{seq, event, payload}`, the
/// number of events, the cursor to continue from, and whether the stream
/// closed.
pub type ObfEventsCallback = extern "C" fn(
    ctx: *mut c_void,
    data: *const u8,
    len: usize,
    count: u32,
    last_seq: u64,
    closed: bool,
);

#[derive(Clone)]
enum Readiness {
    Starting,
    Ready(BackendService),
    Failed(String),
}

struct FfiBackend {
    runtime: Mutex<Option<tokio::runtime::Runtime>>,
    handle: tokio::runtime::Handle,
    readiness: watch::Sender<Readiness>,
}

static BACKEND: OnceLock<FfiBackend> = OnceLock::new();

/// A host pointer handed back to the host on a backend thread.
struct HostContext(*mut c_void);

// SAFETY: the pointer is opaque to the backend and only passed back to the
// host's callback, which the ABI requires to be callable from any thread.
unsafe impl Send for HostContext {}

impl HostContext {
    // A method (not a field access) so async blocks move the whole `Send`
    // wrapper instead of capturing the raw pointer field.
    fn into_raw(self) -> *mut c_void {
        self.0
    }
}

fn respond(callback: ObfResultCallback, ctx: HostContext, result: Result<String, String>) {
    let (status, text) = match result {
        Ok(text) => (BACKEND_STATUS_OK, text),
        Err(text) => (BACKEND_STATUS_ERROR, text),
    };
    callback(ctx.into_raw(), status, text.as_ptr(), text.len());
}

/// # Safety
/// `data` must point to `len` readable bytes (or be null with `len == 0`).
unsafe fn read_str(data: *const u8, len: usize) -> Result<String, String> {
    if data.is_null() || len == 0 {
        return Ok(String::new());
    }
    // SAFETY: guaranteed by the caller.
    let bytes = unsafe { std::slice::from_raw_parts(data, len) };
    String::from_utf8(bytes.to_vec()).map_err(|error| format!("argument is not UTF-8: {error}"))
}

async fn ready_service(backend: &FfiBackend) -> Result<BackendService, String> {
    let mut readiness = backend.readiness.subscribe();
    loop {
        match &*readiness.borrow_and_update() {
            Readiness::Ready(service) => return Ok(service.clone()),
            Readiness::Failed(error) => return Err(error.clone()),
            Readiness::Starting => {}
        }
        if readiness.changed().await.is_err() {
            return Err("the backend bootstrap was abandoned".to_string());
        }
    }
}

fn started_backend() -> Result<&'static FfiBackend, String> {
    BACKEND
        .get()
        .ok_or_else(|| "the backend was not started (obf_backend_start)".to_string())
}

fn build_runtime() -> std::io::Result<tokio::runtime::Runtime> {
    tokio::runtime::Builder::new_multi_thread()
        .worker_threads(4)
        // Agent turns need deep stacks, as in the desktop binary.
        .thread_stack_size(8 * 1024 * 1024)
        .thread_name("openbitfun-backend")
        .enable_all()
        .build()
}

/// The ABI version of this library ([`BACKEND_ABI_VERSION`]).
#[no_mangle]
pub extern "C" fn obf_backend_abi_version() -> u32 {
    BACKEND_ABI_VERSION
}

/// Starts the backend once: builds its runtime and bootstraps it in the
/// background. `callback` receives the host info JSON
/// (`{version, platform, dataDir, fleet?: {protocol, deviceId}}`) or the
/// fatal startup error. Calling it
/// again reports the same outcome.
#[no_mangle]
pub extern "C" fn obf_backend_start(callback: ObfResultCallback, ctx: *mut c_void) {
    let ctx = HostContext(ctx);
    let backend = match BACKEND.get() {
        Some(backend) => backend,
        None => {
            let runtime = match build_runtime() {
                Ok(runtime) => runtime,
                Err(error) => {
                    respond(
                        callback,
                        ctx,
                        Err(format!("Failed to build the backend runtime: {error}")),
                    );
                    return;
                }
            };
            let (readiness, _) = watch::channel(Readiness::Starting);
            let candidate = FfiBackend {
                handle: runtime.handle().clone(),
                runtime: Mutex::new(Some(runtime)),
                readiness,
            };
            let mut first = false;
            let backend = BACKEND.get_or_init(|| {
                first = true;
                candidate
            });
            if first {
                backend.handle.spawn(async move {
                    let host = crate::native_host::create_native_host();
                    let outcome = crate::native_host::start_native_backend(host).await;
                    let backend = BACKEND.get().expect("backend initialized");
                    backend.readiness.send_replace(match outcome {
                        Ok(service) => Readiness::Ready(service),
                        Err(error) => {
                            log::error!("Native backend startup failed: {}", error);
                            Readiness::Failed(error)
                        }
                    });
                });
            }
            backend
        }
    };
    backend.handle.spawn(async move {
        let backend = BACKEND.get().expect("backend initialized");
        let result = ready_service(backend).await.and_then(|service| {
            let mut info =
                serde_json::to_value(service.info()).map_err(|error| error.to_string())?;
            // The fleet protocol and this device's id (the native UI keys its
            // own device with it); absent while the device has no identity.
            if let (Some(object), Some(fleet)) = (info.as_object_mut(), crate::fleet::ready_info())
            {
                object.insert("fleet".to_string(), fleet);
            }
            serde_json::to_string(&info).map_err(|error| error.to_string())
        });
        respond(callback, ctx, result);
    });
}

/// Runs one command (`command`, Tauri-shaped JSON `args`) and reports the
/// JSON of its result or its error text. Waits for the bootstrap first.
///
/// # Safety
/// `command` and `args` must point to `command_len` / `args_len` readable
/// bytes (or be null with a zero length); they are copied before returning.
#[no_mangle]
pub unsafe extern "C" fn obf_backend_invoke(
    command: *const u8,
    command_len: usize,
    args: *const u8,
    args_len: usize,
    callback: ObfResultCallback,
    ctx: *mut c_void,
) {
    let ctx = HostContext(ctx);
    // SAFETY: guaranteed by the caller.
    let input = unsafe { read_str(command, command_len) }
        // SAFETY: guaranteed by the caller.
        .and_then(|command| Ok((command, unsafe { read_str(args, args_len) }?)));
    let backend = match (started_backend(), input) {
        (Ok(backend), Ok(input)) => (backend, input),
        (Err(error), _) | (_, Err(error)) => {
            respond(callback, ctx, Err(error));
            return;
        }
    };
    let (backend, (command, args)) = backend;
    backend.handle.spawn(async move {
        let result = async {
            let service = ready_service(backend).await?;
            let args: Value = if args.trim().is_empty() {
                Value::Object(Default::default())
            } else {
                serde_json::from_str(&args)
                    .map_err(|error| format!("invalid args for command `{command}`: {error}"))?
            };
            // A panicking handler fails its own task, not this one.
            let started = std::time::Instant::now();
            let outcome = tokio::spawn(service.dispatch_owned(command.clone(), args)).await;
            log::debug!(
                "Native backend command finished: command={}, ok={}, duration_ms={}",
                command,
                matches!(outcome, Ok(Ok(_))),
                started.elapsed().as_millis()
            );
            let value = outcome.map_err(|error| {
                log::error!(
                    "Backend command task failed: command={}, error={}",
                    command,
                    error
                );
                format!("backend command `{command}` failed: {error}")
            })??;
            serde_json::to_string(&value)
                .map_err(|error| format!("failed to encode the result of `{command}`: {error}"))
        }
        .await;
        respond(callback, ctx, result);
    });
}

fn encode_events(events: &[Arc<BackendEvent>]) -> String {
    let events: Vec<&BackendEvent> = events.iter().map(Arc::as_ref).collect();
    serde_json::to_string(&events).unwrap_or_else(|error| {
        log::error!("Failed to encode backend events: {}", error);
        "[]".to_string()
    })
}

/// Waits for at least one event with `seq > after` (or shutdown) and
/// reports up to `max` of them. A stale cursor (from another backend
/// process) reports an empty, open batch whose `last_seq` is the current
/// position.
#[no_mangle]
pub extern "C" fn obf_backend_events_after(
    after: u64,
    max: u32,
    callback: ObfEventsCallback,
    ctx: *mut c_void,
) {
    let ctx = HostContext(ctx);
    let backend = match started_backend() {
        Ok(backend) => backend,
        Err(error) => {
            log::error!("Backend events requested before start: {}", error);
            callback(ctx.into_raw(), b"[]".as_ptr(), 2, 0, after, true);
            return;
        }
    };
    backend.handle.spawn(async move {
        let (json, count, last_seq, closed) = match ready_service(backend).await {
            Ok(service) => {
                let batch = service
                    .events()
                    .wait_events_after(after, max.max(1) as usize)
                    .await;
                log::trace!(
                    "Native backend events delivered: after={}, count={}, last_seq={}, closed={}",
                    after,
                    batch.events.len(),
                    batch.last_seq,
                    batch.closed
                );
                (
                    encode_events(&batch.events),
                    batch.events.len() as u32,
                    batch.last_seq,
                    batch.closed,
                )
            }
            Err(_) => ("[]".to_string(), 0, after, true),
        };
        callback(
            ctx.into_raw(),
            json.as_ptr(),
            json.len(),
            count,
            last_seq,
            closed,
        );
    });
}

/// Writes one frontend log line into the backend log (`error`, `warn`,
/// `info`, `debug`, `trace`).
///
/// # Safety
/// Both strings must point to their given number of readable bytes.
#[no_mangle]
pub unsafe extern "C" fn obf_backend_log(
    level: *const u8,
    level_len: usize,
    message: *const u8,
    message_len: usize,
) {
    // SAFETY: guaranteed by the caller.
    let level = unsafe { read_str(level, level_len) }.unwrap_or_default();
    // SAFETY: guaranteed by the caller.
    let message = unsafe { read_str(message, message_len) }.unwrap_or_default();
    let level = match level.as_str() {
        "error" => log::Level::Error,
        "warn" => log::Level::Warn,
        "debug" => log::Level::Debug,
        "trace" => log::Level::Trace,
        _ => log::Level::Info,
    };
    log::log!(target: "webview", level, "{}", message);
}

/// Graceful shutdown (plugin host, search daemons, child processes, clean
/// exit marker, event stream close), bounded by `timeout_ms`; then stops the
/// runtime. Blocks the calling thread, which must not be a backend thread.
#[no_mangle]
pub extern "C" fn obf_backend_shutdown(timeout_ms: u32) {
    let Some(backend) = BACKEND.get() else {
        return;
    };
    let service = match &*backend.readiness.borrow() {
        Readiness::Ready(service) => Some(service.clone()),
        _ => None,
    };
    let runtime = backend
        .runtime
        .lock()
        .ok()
        .and_then(|mut runtime| runtime.take());
    let Some(runtime) = runtime else {
        return;
    };
    if let Some(service) = service {
        // The timer must be created inside the runtime's context.
        let finished = runtime.block_on(async {
            tokio::time::timeout(
                Duration::from_millis(u64::from(timeout_ms)),
                crate::native_host::shutdown_native_backend(&service, "native_host_quit"),
            )
            .await
        });
        if finished.is_err() {
            log::warn!("Native backend shutdown timed out after {} ms", timeout_ms);
        }
    }
    runtime.shutdown_timeout(Duration::from_secs(2));
}

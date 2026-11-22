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

use std::any::Any;
use std::ffi::c_void;
use std::future::Future;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

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
    shutdown_requested: AtomicBool,
}

static BACKEND: OnceLock<Arc<FfiBackend>> = OnceLock::new();

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

fn panic_payload_message(payload: Box<dyn Any + Send>) -> String {
    if let Some(message) = payload.downcast_ref::<&str>() {
        (*message).to_string()
    } else if let Some(message) = payload.downcast_ref::<String>() {
        message.clone()
    } else {
        "unexpected panic".to_string()
    }
}

fn respond(callback: ObfResultCallback, ctx: HostContext, result: Result<String, String>) {
    let (status, text) = match result {
        Ok(text) => (BACKEND_STATUS_OK, text),
        Err(text) => (BACKEND_STATUS_ERROR, text),
    };
    let _ = catch_unwind(AssertUnwindSafe(|| {
        callback(ctx.into_raw(), status, text.as_ptr(), text.len());
    }));
}

/// Ensures an [`ObfResultCallback`] fires exactly once, even if the owning
/// task is dropped on runtime shutdown or unwinds on panic.
struct ResultCallbackGuard {
    callback: ObfResultCallback,
    ctx: Option<HostContext>,
}

impl ResultCallbackGuard {
    fn new(callback: ObfResultCallback, ctx: *mut c_void) -> Self {
        Self {
            callback,
            ctx: Some(HostContext(ctx)),
        }
    }

    fn respond(mut self, result: Result<String, String>) {
        if let Some(ctx) = self.ctx.take() {
            respond(self.callback, ctx, result);
        }
    }
}

impl Drop for ResultCallbackGuard {
    fn drop(&mut self) {
        if let Some(ctx) = self.ctx.take() {
            respond(
                self.callback,
                ctx,
                Err("the backend shut down before completing the request".to_string()),
            );
        }
    }
}

/// Ensures an [`ObfEventsCallback`] fires exactly once, delivering a closed
/// empty batch if the task is cancelled on runtime shutdown or unwinds.
struct EventsCallbackGuard {
    callback: ObfEventsCallback,
    ctx: Option<HostContext>,
    after: u64,
}

impl EventsCallbackGuard {
    fn new(callback: ObfEventsCallback, ctx: *mut c_void, after: u64) -> Self {
        Self {
            callback,
            ctx: Some(HostContext(ctx)),
            after,
        }
    }

    fn deliver(mut self, json: &str, count: u32, last_seq: u64, closed: bool) {
        if let Some(ctx) = self.ctx.take() {
            let _ = catch_unwind(AssertUnwindSafe(|| {
                (self.callback)(
                    ctx.into_raw(),
                    json.as_ptr(),
                    json.len(),
                    count,
                    last_seq,
                    closed,
                );
            }));
        }
    }
}

impl Drop for EventsCallbackGuard {
    fn drop(&mut self) {
        if let Some(ctx) = self.ctx.take() {
            let _ = catch_unwind(AssertUnwindSafe(|| {
                (self.callback)(ctx.into_raw(), b"[]".as_ptr(), 2, 0, self.after, true);
            }));
        }
    }
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

fn started_backend() -> Result<&'static Arc<FfiBackend>, String> {
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

impl FfiBackend {
    fn new(runtime: tokio::runtime::Runtime) -> Arc<Self> {
        let (readiness, _) = watch::channel(Readiness::Starting);
        Arc::new(Self {
            handle: runtime.handle().clone(),
            runtime: Mutex::new(Some(runtime)),
            readiness,
            shutdown_requested: AtomicBool::new(false),
        })
    }

    fn spawn_bootstrap<F, Fut>(self: &Arc<Self>, bootstrap: F)
    where
        F: FnOnce() -> Fut + Send + 'static,
        Fut: Future<Output = Result<BackendService, String>> + Send + 'static,
    {
        let backend = Arc::clone(self);
        self.handle.spawn(async move {
            // Isolate the bootstrap future in its own task so a panic becomes
            // `JoinError` and transitions readiness to `Failed` instead of
            // leaving `ready_service()` waiting forever.
            let outcome = tokio::spawn(async move { bootstrap().await }).await;
            let next_state = match outcome {
                Ok(Ok(service)) => Readiness::Ready(service),
                Ok(Err(error)) => {
                    log::error!("Native backend startup failed: {}", error);
                    Readiness::Failed(error)
                }
                Err(join_error) => {
                    let message = if join_error.is_panic() {
                        format!(
                            "Native backend startup panicked: {}",
                            panic_payload_message(join_error.into_panic())
                        )
                    } else {
                        format!("Native backend startup task aborted: {join_error}")
                    };
                    log::error!("{}", message);
                    Readiness::Failed(message)
                }
            };
            let mut discarded_service = None;
            backend.readiness.send_if_modified(|state| {
                if matches!(state, Readiness::Starting) {
                    *state = next_state;
                    true
                } else {
                    if let Readiness::Ready(service) = next_state {
                        discarded_service = Some(service);
                    }
                    false
                }
            });
            if let Some(service) = discarded_service {
                service.events().close();
            }
        });
    }

    fn is_shutting_down(&self) -> bool {
        self.shutdown_requested.load(Ordering::Acquire)
    }

    fn notify_ready(self: &Arc<Self>, guard: ResultCallbackGuard) {
        if self.is_shutting_down() {
            guard.respond(Err("the backend is shutting down".to_string()));
            return;
        }
        let backend = Arc::clone(self);
        self.handle.spawn(async move {
            let result = ready_service(&backend).await.and_then(|service| {
                let mut info =
                    serde_json::to_value(service.info()).map_err(|error| error.to_string())?;
                // The fleet protocol and this device's id (the native UI keys its
                // own device with it); absent while the device has no identity.
                if let (Some(object), Some(fleet)) =
                    (info.as_object_mut(), crate::fleet::ready_info())
                {
                    object.insert("fleet".to_string(), fleet);
                }
                serde_json::to_string(&info).map_err(|error| error.to_string())
            });
            guard.respond(result);
        });
    }

    fn invoke(self: &Arc<Self>, command: String, args: String, guard: ResultCallbackGuard) {
        if self.is_shutting_down() {
            guard.respond(Err("the backend is shutting down".to_string()));
            return;
        }
        let backend = Arc::clone(self);
        self.handle.spawn(async move {
            let result = async {
                let service = ready_service(&backend).await?;
                let args: Value = if args.trim().is_empty() {
                    Value::Object(Default::default())
                } else {
                    serde_json::from_str(&args)
                        .map_err(|error| format!("invalid args for command `{command}`: {error}"))?
                };
                // A panicking handler fails its own task, not this one.
                let started = Instant::now();
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
            guard.respond(result);
        });
    }

    fn events_after(self: &Arc<Self>, after: u64, max: u32, guard: EventsCallbackGuard) {
        if self.is_shutting_down() {
            guard.deliver("[]", 0, after, true);
            return;
        }
        let backend = Arc::clone(self);
        self.handle.spawn(async move {
            let (json, count, last_seq, closed) = match ready_service(&backend).await {
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
            guard.deliver(&json, count, last_seq, closed);
        });
    }

    fn shutdown_with<F, Fut>(&self, timeout_ms: u32, run_shutdown: F)
    where
        F: FnOnce(Option<BackendService>) -> Fut + Send + 'static,
        Fut: Future<Output = ()> + Send + 'static,
    {
        let already_requested = self.shutdown_requested.swap(true, Ordering::AcqRel);
        if timeout_ms == 0 {
            // Non-blocking fallback path (e.g. Unix `atexit`): never call
            // `block_on` or block on locks while process teardown is underway.
            if already_requested {
                return;
            }
            let ready_service = match &*self.readiness.borrow() {
                Readiness::Ready(service) => Some(service.clone()),
                _ => None,
            };
            if let Some(service) = ready_service {
                service.events().close();
            }
            self.readiness.send_if_modified(|state| {
                if matches!(state, Readiness::Starting) {
                    *state = Readiness::Failed("the backend shut down".to_string());
                    true
                } else {
                    false
                }
            });
            if let Ok(mut slot) = self.runtime.try_lock() {
                if let Some(runtime) = slot.take() {
                    crate::backend_protocol::ws::shutdown_global();
                    openbitfun_core::util::process_manager::cleanup_all_processes();
                    runtime.shutdown_background();
                }
            }
            return;
        }

        let runtime = self
            .runtime
            .lock()
            .ok()
            .and_then(|mut runtime| runtime.take());
        let Some(runtime) = runtime else {
            return;
        };

        let readiness = self.readiness.clone();
        let finish_shutdown = move || {
            let total_budget = Duration::from_millis(u64::from(timeout_ms));
            let deadline = Instant::now() + total_budget;

            let finished = runtime.block_on(async move {
                let initial = readiness.borrow().clone();
                let service = match initial {
                    Readiness::Ready(service) => Some(service),
                    Readiness::Failed(_) => None,
                    Readiness::Starting => {
                        // Wait bounded for startup to settle so graceful
                        // shutdown can clean up whatever finished starting,
                        // while always reserving budget for teardown itself.
                        let startup_wait = Duration::from_millis(
                            (u64::from(timeout_ms) / 2)
                                .clamp(1, 3_000)
                                .min(u64::from(timeout_ms)),
                        );
                        let mut rx = readiness.subscribe();
                        let settled = tokio::time::timeout(startup_wait, async {
                            loop {
                                match rx.borrow_and_update().clone() {
                                    Readiness::Ready(service) => return Some(service),
                                    Readiness::Failed(_) => return None,
                                    Readiness::Starting => {}
                                }
                                if rx.changed().await.is_err() {
                                    return None;
                                }
                            }
                        })
                        .await;
                        match settled {
                            Ok(service) => service,
                            Err(_) => {
                                log::warn!(
                                    "Native backend shutdown proceeded while startup was still in progress"
                                );
                                readiness.send_if_modified(|state| {
                                    if matches!(state, Readiness::Starting) {
                                        *state = Readiness::Failed(
                                            "the backend shut down during startup".to_string(),
                                        );
                                        true
                                    } else {
                                        false
                                    }
                                });
                                None
                            }
                        }
                    }
                };

                let remaining = deadline.saturating_duration_since(Instant::now());
                tokio::time::timeout(remaining, run_shutdown(service)).await
            });

            if finished.is_err() {
                log::warn!("Native backend shutdown timed out after {} ms", timeout_ms);
            }
            runtime.shutdown_timeout(Duration::from_secs(2));
        };

        if tokio::runtime::Handle::try_current().is_ok() {
            // Avoid panicking if a caller ever invokes shutdown from inside a
            // Tokio runtime context.
            if let Ok(handle) = std::thread::Builder::new()
                .name("openbitfun-backend-shutdown".to_string())
                .spawn(finish_shutdown)
            {
                let _ = handle.join();
            }
        } else {
            finish_shutdown();
        }
    }
}

/// The ABI version of this library ([`BACKEND_ABI_VERSION`]).
#[no_mangle]
pub extern "C" fn obf_backend_abi_version() -> u32 {
    catch_unwind(AssertUnwindSafe(|| BACKEND_ABI_VERSION)).unwrap_or(0)
}

/// Starts the backend once: builds its runtime and bootstraps it in the
/// background. `callback` receives the host info JSON
/// (`{version, platform, dataDir, fleet?: {protocol, deviceId}}`) or the
/// fatal startup error. Calling it
/// again reports the same outcome.
#[no_mangle]
pub extern "C" fn obf_backend_start(callback: ObfResultCallback, ctx: *mut c_void) {
    let guard = ResultCallbackGuard::new(callback, ctx);
    if let Err(payload) = catch_unwind(AssertUnwindSafe(move || {
        let backend = match BACKEND.get() {
            Some(backend) => backend,
            None => {
                let runtime = match build_runtime() {
                    Ok(runtime) => runtime,
                    Err(error) => {
                        guard.respond(Err(format!("Failed to build the backend runtime: {error}")));
                        return;
                    }
                };
                let candidate = FfiBackend::new(runtime);
                let mut first = false;
                let backend = BACKEND.get_or_init(|| {
                    first = true;
                    candidate
                });
                if first {
                    backend.spawn_bootstrap(|| async {
                        let host = crate::native_host::create_native_host();
                        crate::native_host::start_native_backend(host).await
                    });
                }
                backend
            }
        };
        backend.notify_ready(guard);
    })) {
        log::error!(
            "obf_backend_start panicked: {}",
            panic_payload_message(payload)
        );
    }
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
    let guard = ResultCallbackGuard::new(callback, ctx);
    if let Err(payload) = catch_unwind(AssertUnwindSafe(move || {
        // SAFETY: guaranteed by the caller.
        let input = unsafe { read_str(command, command_len) }
            // SAFETY: guaranteed by the caller.
            .and_then(|command| Ok((command, unsafe { read_str(args, args_len) }?)));
        let (backend, (command, args)) = match (started_backend(), input) {
            (Ok(backend), Ok(input)) => (backend, input),
            (Err(error), _) | (_, Err(error)) => {
                guard.respond(Err(error));
                return;
            }
        };
        backend.invoke(command, args, guard);
    })) {
        log::error!(
            "obf_backend_invoke panicked: {}",
            panic_payload_message(payload)
        );
    }
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
    let guard = EventsCallbackGuard::new(callback, ctx, after);
    if let Err(payload) = catch_unwind(AssertUnwindSafe(move || {
        let backend = match started_backend() {
            Ok(backend) => backend,
            Err(error) => {
                log::error!("Backend events requested before start: {}", error);
                guard.deliver("[]", 0, after, true);
                return;
            }
        };
        backend.events_after(after, max, guard);
    })) {
        log::error!(
            "obf_backend_events_after panicked: {}",
            panic_payload_message(payload)
        );
    }
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
    let _ = catch_unwind(AssertUnwindSafe(|| {
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
    }));
}

/// Graceful shutdown (plugin host, search daemons, child processes, clean
/// exit marker, event stream close), bounded by `timeout_ms`; then stops the
/// runtime. Passing `timeout_ms == 0` performs non-blocking emergency teardown
/// without calling `block_on`. Blocks the calling thread when `timeout_ms > 0`.
#[no_mangle]
pub extern "C" fn obf_backend_shutdown(timeout_ms: u32) {
    let _ = catch_unwind(AssertUnwindSafe(|| {
        let Some(backend) = BACKEND.get() else {
            return;
        };
        backend.shutdown_with(timeout_ms, |service| async move {
            match service {
                Some(service) => {
                    crate::native_host::shutdown_native_backend(&service, "native_host_quit").await;
                }
                None => {
                    crate::mesh::shutdown_global().await;
                    crate::backend_protocol::ws::shutdown_global();
                    crate::perform_process_exit_cleanup().await;
                }
            }
        });
    }));
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    fn test_runtime() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .expect("test tokio runtime")
    }

    type ResultMessage = (i32, String);
    type EventsMessage = (String, u32, u64, bool);

    fn result_channel() -> (*mut c_void, mpsc::Receiver<ResultMessage>) {
        let (tx, rx) = mpsc::channel::<ResultMessage>();
        (Box::into_raw(Box::new(tx)).cast::<c_void>(), rx)
    }

    fn events_channel() -> (*mut c_void, mpsc::Receiver<EventsMessage>) {
        let (tx, rx) = mpsc::channel::<EventsMessage>();
        (Box::into_raw(Box::new(tx)).cast::<c_void>(), rx)
    }

    extern "C" fn capture_result(ctx: *mut c_void, status: i32, data: *const u8, len: usize) {
        let tx = unsafe { Box::from_raw(ctx.cast::<mpsc::Sender<ResultMessage>>()) };
        let text = unsafe { read_str(data, len) }.unwrap_or_default();
        let _ = tx.send((status, text));
    }

    extern "C" fn capture_events(
        ctx: *mut c_void,
        data: *const u8,
        len: usize,
        count: u32,
        last_seq: u64,
        closed: bool,
    ) {
        let tx = unsafe { Box::from_raw(ctx.cast::<mpsc::Sender<EventsMessage>>()) };
        let text = unsafe { read_str(data, len) }.unwrap_or_default();
        let _ = tx.send((text, count, last_seq, closed));
    }

    #[test]
    fn startup_panic_moves_readiness_to_failed() {
        let backend = FfiBackend::new(test_runtime());
        backend.spawn_bootstrap(|| async {
            panic!("simulated bootstrap panic");
        });

        let (ctx, rx) = result_channel();
        backend.notify_ready(ResultCallbackGuard::new(capture_result, ctx));

        let (status, message) = rx
            .recv_timeout(Duration::from_secs(5))
            .expect("notify_ready callback fired instead of hanging");
        assert_eq!(status, BACKEND_STATUS_ERROR);
        assert!(
            message.contains("simulated bootstrap panic"),
            "unexpected error: {message}"
        );

        let (ctx2, rx2) = result_channel();
        backend.invoke(
            "no_such_command".to_string(),
            "{}".to_string(),
            ResultCallbackGuard::new(capture_result, ctx2),
        );
        let (status2, message2) = rx2
            .recv_timeout(Duration::from_secs(5))
            .expect("invoke callback fired after startup panic");
        assert_eq!(status2, BACKEND_STATUS_ERROR);
        assert!(
            message2.contains("simulated bootstrap panic"),
            "unexpected invoke error: {message2}"
        );

        backend.shutdown_with(1_000, |_| async {});
    }

    #[test]
    fn post_shutdown_invoke_and_events_fire_callbacks_immediately() {
        let backend = FfiBackend::new(test_runtime());
        backend.spawn_bootstrap(|| async {
            let host = crate::native_host::create_native_host();
            Ok(BackendService::new(host))
        });

        // Wait until ready before shutting down.
        let (ctx_ready, rx_ready) = result_channel();
        backend.notify_ready(ResultCallbackGuard::new(capture_result, ctx_ready));
        let (status, _) = rx_ready
            .recv_timeout(Duration::from_secs(5))
            .expect("backend became ready");
        assert_eq!(status, BACKEND_STATUS_OK);

        let shutdown_ran = Arc::new(AtomicBool::new(false));
        let shutdown_ran_clone = Arc::clone(&shutdown_ran);
        backend.shutdown_with(1_000, move |service| async move {
            assert!(service.is_some());
            shutdown_ran_clone.store(true, Ordering::SeqCst);
        });
        assert!(shutdown_ran.load(Ordering::SeqCst));

        // Late invoke must fire immediately with error (no leak, no hang).
        let (ctx_inv, rx_inv) = result_channel();
        backend.invoke(
            "ping".to_string(),
            "{}".to_string(),
            ResultCallbackGuard::new(capture_result, ctx_inv),
        );
        let (inv_status, inv_msg) = rx_inv
            .try_recv()
            .expect("post-shutdown invoke fired synchronously");
        assert_eq!(inv_status, BACKEND_STATUS_ERROR);
        assert!(inv_msg.contains("shutting down"), "{inv_msg}");

        // Late events_after must fire immediately with closed empty batch.
        let (ctx_ev, rx_ev) = events_channel();
        backend.events_after(42, 64, EventsCallbackGuard::new(capture_events, ctx_ev, 42));
        let (json, count, last_seq, closed) = rx_ev
            .try_recv()
            .expect("post-shutdown events_after fired synchronously");
        assert_eq!(json, "[]");
        assert_eq!(count, 0);
        assert_eq!(last_seq, 42);
        assert!(closed);
    }

    #[test]
    fn shutdown_while_starting_cleans_up_and_unblocks_waiters() {
        let backend = FfiBackend::new(test_runtime());
        backend.spawn_bootstrap(|| async {
            // Simulate a slow bootstrap that outlives the shutdown startup wait.
            tokio::time::sleep(Duration::from_secs(30)).await;
            let host = crate::native_host::create_native_host();
            Ok(BackendService::new(host))
        });

        let (ctx_wait, rx_wait) = result_channel();
        backend.notify_ready(ResultCallbackGuard::new(capture_result, ctx_wait));

        let cleanup_called = Arc::new(AtomicBool::new(false));
        let cleanup_called_clone = Arc::clone(&cleanup_called);
        backend.shutdown_with(200, move |service| async move {
            assert!(service.is_none());
            cleanup_called_clone.store(true, Ordering::SeqCst);
        });
        assert!(
            cleanup_called.load(Ordering::SeqCst),
            "shutdown cleanup must still run when backend was Starting"
        );

        let (status, _) = rx_wait
            .recv_timeout(Duration::from_secs(2))
            .expect("pending notify_ready callback fired on shutdown");
        assert_eq!(status, BACKEND_STATUS_ERROR);
    }

    #[test]
    fn non_blocking_shutdown_closes_events_and_rejects_late_calls() {
        let backend = FfiBackend::new(test_runtime());
        backend.spawn_bootstrap(|| async {
            let host = crate::native_host::create_native_host();
            Ok(BackendService::new(host))
        });

        let (ctx_ready, rx_ready) = result_channel();
        backend.notify_ready(ResultCallbackGuard::new(capture_result, ctx_ready));
        let (status, _) = rx_ready
            .recv_timeout(Duration::from_secs(5))
            .expect("backend became ready");
        assert_eq!(status, BACKEND_STATUS_OK);

        // Start a long-poll event wait before non-blocking shutdown.
        let (ctx_wait_ev, rx_wait_ev) = events_channel();
        backend.events_after(
            0,
            16,
            EventsCallbackGuard::new(capture_events, ctx_wait_ev, 0),
        );

        // timeout_ms == 0 must not invoke block_on or wait on async shutdown.
        backend.shutdown_with(0, |_| async {
            panic!("non-blocking shutdown must not run async shutdown closure");
        });

        let (_, _, _, closed) = rx_wait_ev
            .recv_timeout(Duration::from_secs(2))
            .expect("waiting events_after unblocked by non-blocking shutdown");
        assert!(closed);

        // Subsequent invoke returns immediately with error.
        let (ctx_inv, rx_inv) = result_channel();
        backend.invoke(
            "ping".to_string(),
            "{}".to_string(),
            ResultCallbackGuard::new(capture_result, ctx_inv),
        );
        let (inv_status, _) = rx_inv
            .try_recv()
            .expect("invoke after non-blocking shutdown fired immediately");
        assert_eq!(inv_status, BACKEND_STATUS_ERROR);
    }
}

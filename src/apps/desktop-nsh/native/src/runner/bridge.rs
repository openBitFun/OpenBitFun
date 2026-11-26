//! The `openbitfun/native` bridge over the backend library's C ABI.

use std::ffi::c_void;
use std::sync::Arc;

use openbitfun_nsh_native::{BackendBridge, BoxFuture, EventBatch};
use tokio::sync::oneshot;

use crate::backend_library::{BackendLibrary, BACKEND_STATUS_OK};

type ResultSender = oneshot::Sender<Result<String, String>>;
type EventsSender = oneshot::Sender<EventBatch>;

/// Copies a callback's UTF-8 bytes.
///
/// # Safety
/// `data` must point to `len` readable bytes, or be null with `len == 0`.
unsafe fn callback_text(data: *const u8, len: usize) -> String {
    if data.is_null() || len == 0 {
        return String::new();
    }
    // SAFETY: guaranteed by the caller (the ABI keeps `data` valid during
    // the callback).
    String::from_utf8_lossy(unsafe { std::slice::from_raw_parts(data, len) }).into_owned()
}

extern "C" fn on_result(ctx: *mut c_void, status: i32, data: *const u8, len: usize) {
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        if ctx.is_null() {
            log::error!("Backend result callback received null context");
            return;
        }
        // SAFETY: `ctx` is the `Box<ResultSender>` leaked by `request`; the ABI
        // calls back exactly once.
        let sender = unsafe { Box::from_raw(ctx.cast::<ResultSender>()) };
        // SAFETY: valid for the callback's duration.
        let text = unsafe { callback_text(data, len) };
        let _ = sender.send(if status == BACKEND_STATUS_OK {
            Ok(text)
        } else {
            Err(text)
        });
    }));
}

extern "C" fn on_events(
    ctx: *mut c_void,
    data: *const u8,
    len: usize,
    count: u32,
    last_seq: u64,
    closed: bool,
) {
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        if ctx.is_null() {
            log::error!("Backend events callback received null context");
            return;
        }
        // SAFETY: `ctx` is the `Box<EventsSender>` leaked by `events_after`;
        // the ABI calls back exactly once.
        let sender = unsafe { Box::from_raw(ctx.cast::<EventsSender>()) };
        let _ = sender.send(EventBatch {
            // SAFETY: valid for the callback's duration.
            json: unsafe { callback_text(data, len) },
            count: count as usize,
            last_seq,
            closed,
        });
    }));
}

/// A result channel whose sender is handed to the library as `ctx`.
fn request() -> (*mut c_void, oneshot::Receiver<Result<String, String>>) {
    let (sender, receiver) = oneshot::channel::<Result<String, String>>();
    (Box::into_raw(Box::new(sender)).cast(), receiver)
}

async fn answer(receiver: oneshot::Receiver<Result<String, String>>) -> Result<String, String> {
    receiver
        .await
        .map_err(|_| "the backend dropped the request".to_string())?
}

pub(crate) struct NativeBridge {
    backend: &'static BackendLibrary,
}

impl BackendBridge for NativeBridge {
    fn invoke(&self, command: String, args_json: String) -> BoxFuture<Result<String, String>> {
        let (ctx, receiver) = request();
        self.backend.invoke(&command, &args_json, on_result, ctx);
        Box::pin(answer(receiver))
    }

    fn events_after(&self, after: u64, max: usize) -> BoxFuture<EventBatch> {
        let (sender, receiver) = oneshot::channel::<EventBatch>();
        let ctx = Box::into_raw(Box::new(sender)).cast();
        let max = u32::try_from(max).unwrap_or(u32::MAX);
        self.backend.events_after(after, max, on_events, ctx);
        Box::pin(async move {
            receiver.await.unwrap_or(EventBatch {
                json: "[]".to_string(),
                count: 0,
                last_seq: after,
                closed: true,
            })
        })
    }

    fn log(&self, level: &str, message: &str) {
        self.backend.log(level, message);
    }

    fn pick_directory(&self, options_json: String) -> Option<BoxFuture<Result<String, String>>> {
        Some(crate::folder_picker::pick_directory(options_json))
    }

    fn pick_file_dialog(&self, options_json: String) -> Option<BoxFuture<Result<String, String>>> {
        Some(crate::folder_picker::pick_file_dialog(options_json))
    }
}

/// Starts the backend; attaches the bridge (or reports the fatal error)
/// once its bootstrap finishes. Returns immediately.
pub(crate) fn start(backend: &'static BackendLibrary) {
    let (ctx, receiver) = request();
    backend.start(on_result, ctx);
    // The module's promises wait on the outcome; deliver it from a helper
    // thread so the UI thread never blocks on the bootstrap.
    let spawned = std::thread::Builder::new()
        .name("openbitfun-backend-ready".to_string())
        .spawn(move || match receiver.blocking_recv() {
            Ok(Ok(info)) => {
                openbitfun_nsh_native::attach(Arc::new(NativeBridge { backend }), info);
            }
            Ok(Err(error)) => {
                log::error!("Native backend startup failed: {}", error);
                openbitfun_nsh_native::fail(error);
            }
            Err(_) => {
                openbitfun_nsh_native::fail("the backend dropped its startup report".to_string())
            }
        });
    if let Err(error) = spawned {
        openbitfun_nsh_native::fail(format!("Failed to wait for the backend: {error}"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn callbacks_ignore_null_context_without_panicking() {
        on_result(std::ptr::null_mut(), BACKEND_STATUS_OK, b"ok".as_ptr(), 2);
        on_events(std::ptr::null_mut(), b"[]".as_ptr(), 2, 0, 0, true);
    }
}

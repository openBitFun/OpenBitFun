//! MiniApp windows in the native host. The independent window is the same
//! lightweight shell sidecar the Tauri desktop launches, connected to this
//! backend's MiniApp IPC endpoint (`miniapp_desktop::start_native`), so a
//! MiniApp runs with the full bridge (worker, storage, agent, chat) here too.

use std::sync::Arc;

use serde_json::Value;

use super::{arg, DispatchFuture};
use crate::host::{HostHandle, NativeHost};

pub(in crate::backend_protocol) fn miniapp_presentation(
    host: &Arc<NativeHost>,
    args: Value,
) -> DispatchFuture<'_> {
    Box::pin(async move {
        let request: crate::miniapp_desktop::PresentationRequest =
            arg(&args, "request", "miniapp_presentation")?;
        crate::miniapp_desktop::native_presentation(&HostHandle::new(Arc::clone(host)), request)
            .await
    })
}

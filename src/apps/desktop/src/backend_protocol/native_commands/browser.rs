//! The embedded browser commands in the native host. The NSH UI owns the web
//! views; `crate::native_browser` keeps the target registry and asks the UI
//! shell to act on a page. Requests and responses keep the Tauri commands'
//! shapes (`api::browser_api`), so the same frontend code runs on either host.

use std::sync::Arc;

use serde_json::Value;

use super::{arg, arg_or_default, DispatchFuture};
use crate::api::browser_api::{
    WebviewBoundsRequest, WebviewCreateRequest, WebviewEvalRequest, WebviewLabelRequest,
    WebviewNavigateRequest, WebviewPreviewRequest,
};
use crate::host::NativeHost;
use crate::native_browser;

pub(in crate::backend_protocol) fn browser_webview_create(
    host: &Arc<NativeHost>,
    args: Value,
) -> DispatchFuture<'_> {
    Box::pin(async move {
        let request: WebviewCreateRequest = arg(&args, "request", "browser_webview_create")?;
        native_browser::create_page(host, request).await?;
        Ok(Value::Null)
    })
}

pub(in crate::backend_protocol) fn browser_webview_navigate(
    host: &Arc<NativeHost>,
    args: Value,
) -> DispatchFuture<'_> {
    Box::pin(async move {
        let request: WebviewNavigateRequest = arg(&args, "request", "browser_webview_navigate")?;
        native_browser::navigate_page(
            host,
            &request.label,
            &request.url,
            request.open_request_id.as_deref(),
        )
        .await?;
        Ok(Value::Null)
    })
}

pub(in crate::backend_protocol) fn browser_webview_reload(
    host: &Arc<NativeHost>,
    args: Value,
) -> DispatchFuture<'_> {
    Box::pin(async move {
        let request: WebviewLabelRequest = arg(&args, "request", "browser_webview_reload")?;
        native_browser::reload_page(host, &request.label).await?;
        Ok(Value::Null)
    })
}

pub(in crate::backend_protocol) fn browser_webview_eval(
    host: &Arc<NativeHost>,
    args: Value,
) -> DispatchFuture<'_> {
    Box::pin(async move {
        let request: WebviewEvalRequest = arg(&args, "request", "browser_webview_eval")?;
        native_browser::inject_script(host, &request.label, &request.script).await?;
        Ok(Value::Null)
    })
}

pub(in crate::backend_protocol) fn browser_webview_set_bounds(
    host: &Arc<NativeHost>,
    args: Value,
) -> DispatchFuture<'_> {
    Box::pin(async move {
        let request: WebviewBoundsRequest = arg(&args, "request", "browser_webview_set_bounds")?;
        native_browser::set_page_bounds(
            host,
            &request.label,
            request.x,
            request.y,
            request.width,
            request.height,
        )
        .await?;
        Ok(Value::Null)
    })
}

pub(in crate::backend_protocol) fn browser_webview_capture_preview(
    host: &Arc<NativeHost>,
    args: Value,
) -> DispatchFuture<'_> {
    Box::pin(async move {
        // Every field is optional; a call without a request asks for the
        // device's most recently shown page.
        let request: WebviewPreviewRequest =
            arg_or_default(&args, "request", "browser_webview_capture_preview")?;
        native_browser::capture_preview(host, request).await
    })
}

pub(in crate::backend_protocol) fn browser_get_url(
    host: &Arc<NativeHost>,
    args: Value,
) -> DispatchFuture<'_> {
    Box::pin(async move {
        let request: WebviewLabelRequest = arg(&args, "request", "browser_get_url")?;
        native_browser::current_url(host, &request.label)
            .await
            .map(Value::String)
    })
}

//! Native host adapters for commands whose Tauri handler needs a Tauri
//! window, webview, raw IPC body or app handle.
//!
//! Each `pub(super) fn <command>(host, args)` here answers the registered
//! command of the same name in the native host
//! (`scripts/generate-desktop-native-dispatch.mjs` wires it into
//! `dispatch_generated.rs`). Arguments arrive exactly as the Tauri frontend
//! sent them, and results keep the Tauri command's response shape, so the
//! same UI code runs against either host.
//!
//! Operations on the window, tray, notifications, clipboard and the
//! application lifecycle belong to the native UI shell; these adapters ask it
//! through [`crate::host::shell`] and fail loudly when no shell offers them.

mod browser;
mod miniapp;
mod pet;
mod update;

use std::sync::Arc;

use serde::Deserialize;
use serde_json::{json, Value};

use super::DispatchFuture;
use crate::host::shell::SHELL_REQUEST_TIMEOUT;
use crate::host::NativeHost;

pub(super) use browser::{
    browser_get_url, browser_webview_capture_preview, browser_webview_create, browser_webview_eval,
    browser_webview_navigate, browser_webview_reload, browser_webview_set_bounds,
};
pub(super) use miniapp::miniapp_presentation;
pub(super) use pet::{
    hide_agent_companion_desktop_pet, resize_agent_companion_desktop_pet,
    show_agent_companion_desktop_pet,
};
pub(super) use update::{
    check_for_updates, download_update, get_pending_update, install_pending_update, install_update,
};

/// Reads `args[key]` (Tauri's camelCase argument key) into `T`.
fn arg<T: for<'de> Deserialize<'de>>(args: &Value, key: &str, command: &str) -> Result<T, String> {
    let value = args.get(key).cloned().unwrap_or(Value::Null);
    serde_json::from_value(value)
        .map_err(|error| format!("invalid args `{key}` for command `{command}`: {error}"))
}

/// Like [`arg`], but a missing key reads as the type's default (requests
/// whose every field is optional).
fn arg_or_default<T: for<'de> Deserialize<'de> + Default>(
    args: &Value,
    key: &str,
    command: &str,
) -> Result<T, String> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(T::default()),
        Some(_) => arg(args, key, command),
    }
}

/// Asks the shell for `op` with the ordinary timeout.
async fn shell(host: &NativeHost, op: &str, args: Value) -> Result<Value, String> {
    host.shell_request(op, args, SHELL_REQUEST_TIMEOUT).await
}

pub(super) fn send_system_notification(host: &Arc<NativeHost>, args: Value) -> DispatchFuture<'_> {
    Box::pin(async move {
        let request: crate::api::system_api::SendNotificationRequest =
            arg(&args, "request", "send_system_notification")?;
        shell(
            host,
            "notification.show",
            json!({ "title": request.title, "body": request.body }),
        )
        .await?;
        Ok(Value::Null)
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UnreadCount {
    count: u32,
}

pub(super) fn set_tray_unread_count(host: &Arc<NativeHost>, args: Value) -> DispatchFuture<'_> {
    Box::pin(async move {
        let request: UnreadCount = arg(&args, "request", "set_tray_unread_count")?;
        shell(
            host,
            "tray.setUnreadCount",
            json!({ "count": request.count }),
        )
        .await?;
        Ok(Value::Null)
    })
}

/// The shell builds its tray with its window; the startup call only
/// confirms a shell is there to carry it.
pub(super) fn initialize_tray_after_startup(
    host: &Arc<NativeHost>,
    args: Value,
) -> DispatchFuture<'_> {
    let _ = args;
    Box::pin(async move {
        if host.shell().attached() {
            Ok(Value::Null)
        } else {
            Err(crate::host::unsupported_in_native_host(
                "initialize_tray_after_startup (no desktop shell is attached)",
            ))
        }
    })
}

pub(super) fn show_main_window(host: &Arc<NativeHost>, args: Value) -> DispatchFuture<'_> {
    let _ = args;
    Box::pin(async move {
        shell(host, "window.show", Value::Null).await?;
        Ok(Value::Null)
    })
}

pub(super) fn hide_main_window_after_close_request(
    host: &Arc<NativeHost>,
    args: Value,
) -> DispatchFuture<'_> {
    let _ = args;
    Box::pin(async move {
        // As in Tauri, only macOS keeps the app running with its window hidden.
        if cfg!(target_os = "macos") {
            shell(host, "window.hide", Value::Null).await?;
        }
        Ok(Value::Null)
    })
}

pub(super) fn minimize_to_tray(host: &Arc<NativeHost>, args: Value) -> DispatchFuture<'_> {
    let _ = args;
    Box::pin(async move {
        shell(host, "window.hide", Value::Null).await?;
        log::info!("Main window minimized to tray via command");
        Ok(Value::Null)
    })
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct WindowFacts {
    #[serde(default)]
    is_fullscreen: bool,
    #[serde(default)]
    is_maximized: bool,
}

pub(super) fn toggle_main_window_fullscreen(
    host: &Arc<NativeHost>,
    args: Value,
) -> DispatchFuture<'_> {
    let _ = args;
    Box::pin(async move {
        let facts: WindowFacts =
            serde_json::from_value(shell(host, "window.toggleFullscreen", Value::Null).await?)
                .unwrap_or_default();
        serde_json::to_value(crate::api::system_api::ToggleMainWindowFullscreenResponse {
            is_fullscreen: facts.is_fullscreen,
            is_maximized: facts.is_maximized,
        })
        .map_err(|error| error.to_string())
    })
}

/// Quitting is the shell's (`Application.quit()`); the runner shuts the
/// backend down gracefully once the UI's run returns.
pub(super) fn quit_app(host: &Arc<NativeHost>, args: Value) -> DispatchFuture<'_> {
    let _ = args;
    Box::pin(async move {
        log::info!("Quit requested via quit_app command");
        shell(host, "app.quit", Value::Null).await?;
        Ok(Value::Null)
    })
}

pub(super) fn restart_app(host: &Arc<NativeHost>, args: Value) -> DispatchFuture<'_> {
    let _ = args;
    Box::pin(async move {
        log::info!("Restart requested via restart_app command");
        shell(host, "app.restart", Value::Null).await?;
        Ok(Value::Null)
    })
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ClipboardFiles {
    #[serde(default)]
    paths: Vec<String>,
}

pub(super) fn get_clipboard_files(host: &Arc<NativeHost>, args: Value) -> DispatchFuture<'_> {
    let _ = args;
    Box::pin(async move {
        let files: ClipboardFiles =
            serde_json::from_value(shell(host, "clipboard.readFiles", Value::Null).await?)
                .map_err(|error| {
                    format!("The desktop shell sent unreadable clipboard files: {error}")
                })?;
        serde_json::to_value(crate::api::clipboard_file_api::ClipboardFilesResponse {
            files: files.paths,
            is_cut: false,
        })
        .map_err(|error| error.to_string())
    })
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ClipboardImage {
    #[serde(default)]
    base64: Option<String>,
    #[serde(default)]
    mime_type: Option<String>,
}

/// Recognized image payloads only, so a misbehaving reader cannot inject
/// arbitrary bytes as an attachment.
fn sniff_image(base64_text: &str) -> Option<&'static str> {
    use base64::Engine as _;
    // The magic bytes fit in the first 16 base64 characters.
    let head: String = base64_text.chars().take(16).collect();
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(head.as_bytes())
        .ok()?;
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        Some("image/png")
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF8") {
        Some("image/gif")
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else if bytes.starts_with(b"MM\0*") || bytes.starts_with(b"II*\0") {
        Some("image/tiff")
    } else {
        None
    }
}

pub(super) fn get_clipboard_image(host: &Arc<NativeHost>, args: Value) -> DispatchFuture<'_> {
    let _ = args;
    Box::pin(async move {
        let image: ClipboardImage =
            serde_json::from_value(shell(host, "clipboard.readImage", Value::Null).await?)
                .unwrap_or_default();
        let response = match image.base64.filter(|text| !text.is_empty()) {
            Some(base64) => {
                let Some(sniffed) = sniff_image(&base64) else {
                    return Err("The clipboard image is not in a recognized format".to_string());
                };
                let _ = image.mime_type;
                json!({ "base64": base64, "mimeType": sniffed })
            }
            None => json!({ "base64": null, "mimeType": null }),
        };
        Ok(response)
    })
}

/// Tauri's handler takes the PNG as the raw IPC body; over the JSON wire it
/// arrives as the args object: `{ "png": "<base64>" }`, a byte array, or the
/// `{ "request": ... }` envelope around either.
fn png_from_args(args: &Value) -> Result<String, String> {
    use base64::Engine as _;
    let payload = args.get("request").unwrap_or(args);
    let png = match payload {
        Value::Array(_) => serde_json::from_value::<Vec<u8>>(payload.clone())
            .map(|bytes| base64::engine::general_purpose::STANDARD.encode(bytes))
            .map_err(|_| "write_clipboard_image expects PNG bytes".to_string())?,
        Value::Object(map) => match map.get("png").or_else(|| map.get("base64")) {
            Some(Value::String(text)) => text.trim().to_string(),
            Some(value @ Value::Array(_)) => serde_json::from_value::<Vec<u8>>(value.clone())
                .map(|bytes| base64::engine::general_purpose::STANDARD.encode(bytes))
                .map_err(|_| "write_clipboard_image expects PNG bytes".to_string())?,
            _ => return Err("write_clipboard_image expects `png` (base64 PNG bytes)".to_string()),
        },
        Value::String(text) => text.trim().to_string(),
        _ => return Err("write_clipboard_image expects PNG bytes".to_string()),
    };
    if png.is_empty() {
        return Err("write_clipboard_image received an empty image".to_string());
    }
    if sniff_image(&png) != Some("image/png") {
        return Err("Clipboard image is not a readable PNG".to_string());
    }
    Ok(png)
}

pub(super) fn write_clipboard_image(host: &Arc<NativeHost>, args: Value) -> DispatchFuture<'_> {
    Box::pin(async move {
        let png = png_from_args(&args)?;
        shell(
            host,
            "clipboard.writeImage",
            json!({ "dataUrl": format!("data:image/png;base64,{png}") }),
        )
        .await
        .inspect_err(|error| log::warn!("Clipboard image write failed: {}", error))?;
        Ok(Value::Null)
    })
}

/// Opening a file in the default browser needs no window: the backend asks
/// the operating system, as the Tauri opener plugin does.
pub(super) fn open_html_file_in_browser(host: &Arc<NativeHost>, args: Value) -> DispatchFuture<'_> {
    let _ = host;
    Box::pin(async move {
        let request: crate::api::system_api::OpenHtmlFileInBrowserRequest =
            arg(&args, "request", "open_html_file_in_browser")?;
        tokio::task::spawn_blocking(move || {
            crate::api::system_api::validate_html_file(&request.path)?;
            openbitfun_services_core::system::LocalSystemProvider::new()
                .open_file(&request.path, None)
                .map(|_| Value::Null)
                .map_err(|error| {
                    format!("Failed to open HTML file in browser: {}", error.message())
                })
        })
        .await
        .map_err(|error| error.to_string())?
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backend_protocol::EventHub;
    use crate::host::NativeHostInfo;

    fn host() -> Arc<NativeHost> {
        NativeHost::new(
            EventHub::new(16),
            NativeHostInfo {
                version: "1.0.0".into(),
                platform: "macos".into(),
                data_dir: String::new(),
            },
        )
    }

    #[test]
    fn png_payloads_are_accepted_in_every_wire_shape_and_checked() {
        use base64::Engine as _;
        let png = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13];
        let encoded = base64::engine::general_purpose::STANDARD.encode(png);
        assert_eq!(png_from_args(&json!({ "png": encoded })).unwrap(), encoded);
        assert_eq!(png_from_args(&json!(png.to_vec())).unwrap(), encoded);
        assert_eq!(
            png_from_args(&json!({ "request": { "png": png.to_vec() } })).unwrap(),
            encoded
        );
        assert!(png_from_args(&json!({ "png": "" })).is_err());
        let text = base64::engine::general_purpose::STANDARD.encode(b"not an image at all");
        assert!(png_from_args(&json!({ "png": text })).is_err());
    }

    #[test]
    fn clipboard_images_must_be_recognized_formats() {
        use base64::Engine as _;
        let jpeg = base64::engine::general_purpose::STANDARD.encode([0xFF, 0xD8, 0xFF, 0xE0, 1, 2]);
        assert_eq!(sniff_image(&jpeg), Some("image/jpeg"));
        let text = base64::engine::general_purpose::STANDARD.encode(b"<script>");
        assert_eq!(sniff_image(&text), None);
    }

    #[tokio::test]
    async fn shell_backed_commands_refuse_loudly_without_a_shell() {
        let host = host();
        let error = quit_app(&host, json!({})).await.unwrap_err();
        assert!(error.starts_with("unsupported_in_native_host"), "{error}");
        let error = initialize_tray_after_startup(&host, json!({}))
            .await
            .unwrap_err();
        assert!(error.starts_with("unsupported_in_native_host"), "{error}");
        host.shell().attach(["window.show".to_string()]);
        assert!(initialize_tray_after_startup(&host, json!({}))
            .await
            .is_ok());
        let error = send_system_notification(&host, json!({"request": {"title": "t"}}))
            .await
            .unwrap_err();
        assert!(error.contains("does not offer"), "{error}");
    }

    #[tokio::test]
    async fn shell_answers_keep_the_tauri_response_shapes() {
        let host = host();
        host.shell().attach(
            [
                "clipboard.readFiles",
                "clipboard.readImage",
                "window.toggleFullscreen",
            ]
            .map(String::from),
        );
        // Each responder answers the first request published after it started.
        let answer = |host: Arc<NativeHost>, value: Value| {
            let start = host.events().last_seq();
            tokio::spawn(async move {
                let mut cursor = start;
                loop {
                    let batch = host.events().events_after(cursor, 16);
                    cursor = batch.last_seq;
                    if let Some(event) = batch.events.first() {
                        let id = event.payload["id"].as_u64().unwrap();
                        host.shell()
                            .respond(crate::host::shell::ShellResponse {
                                id,
                                ok: true,
                                value,
                                error: None,
                            })
                            .unwrap();
                        return;
                    }
                    tokio::task::yield_now().await;
                }
            })
        };
        let responder = answer(Arc::clone(&host), json!({ "paths": ["/tmp/a.txt"] }));
        let files = get_clipboard_files(&host, json!({})).await.unwrap();
        responder.await.unwrap();
        assert_eq!(files, json!({ "files": ["/tmp/a.txt"], "is_cut": false }));

        let responder = answer(Arc::clone(&host), Value::Null);
        let image = get_clipboard_image(&host, json!({})).await.unwrap();
        responder.await.unwrap();
        assert_eq!(image, json!({ "base64": null, "mimeType": null }));

        let responder = answer(
            Arc::clone(&host),
            json!({ "isFullscreen": true, "isMaximized": false }),
        );
        let facts = toggle_main_window_fullscreen(&host, json!({}))
            .await
            .unwrap();
        responder.await.unwrap();
        assert_eq!(facts, json!({ "isFullscreen": true, "isMaximized": false }));
    }

    #[test]
    fn png_from_args_accepts_base64_byte_array_without_panicking() {
        let png_header: Vec<u8> = vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00];
        let encoded = png_from_args(&json!({ "base64": png_header })).unwrap();
        assert!(!encoded.is_empty());
        let encoded_png = png_from_args(&json!({ "png": png_header })).unwrap();
        assert_eq!(encoded, encoded_png);
    }
}

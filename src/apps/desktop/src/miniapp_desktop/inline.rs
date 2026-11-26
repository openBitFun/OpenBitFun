//! In-product MiniApp presentation for the NSH UI (wave 22, P4).
//!
//! Every client opens a Space inside the app: the NSH UI mounts the app's
//! document in a `WebView` (an iframe on the web target) and plays the part
//! the sidecar Shell plays for an independent window. It speaks the same
//! closed Shell protocol (`poll`, `rpc`, `ready`, `heartbeat`, `close`,
//! `permissions`, `agentClaim`, `agentResponse`) through one proxied command,
//! so a phone or a browser renders the frame while every call runs on the
//! Space's runtime device over OBP, with the identity the backend bound at
//! `open`. Nothing here evaluates JavaScript or reaches other commands.
//!
//! The view is a `Tab` view of the instance registry, which is what the
//! in-product presentation always was: opening it while the app is in its own
//! window transfers the app here once the frame is ready, and "Open in window"
//! transfers it back (the inline view's next `poll` answers `released`). A
//! second client opening the same Space takes the view over; the first one's
//! calls then fail with the Shell identity mismatch and it says so.
//!
//! Older hosts do not know `miniapp_inline` and answer it as unknown, which the
//! UI reports instead of falling back to a local document. `miniapp_presentation`
//! (`kind: "window"`, and `kind: "tab"` refused by the native host) is unchanged.

use super::*;

/// What every in-product (`tab`) view may ask after `open`.
const INLINE_METHODS: &[&str] = &[
    "poll",
    "rpc",
    "ready",
    "heartbeat",
    "close",
    "permissions",
    "agentClaim",
    "agentResponse",
];

/// Additional methods allowed only for a desktop standalone NSH window view
/// (`MiniAppViewKind::Window`), never for remote or in-product `Tab` views.
const WINDOW_ONLY_METHODS: &[&str] = &["chatSnapshot", "tab"];

fn is_window_view(host: &DesktopMiniApps, params: &Value) -> bool {
    let Some(instance_id) = params.get("instanceId").and_then(Value::as_str) else {
        return false;
    };
    let Some(view_id) = params.get("viewId").and_then(Value::as_str) else {
        return false;
    };
    let Ok(instance) = host.instances.get(instance_id) else {
        return false;
    };
    instance
        .primary_view
        .iter()
        .chain(instance.pending_view.iter())
        .any(|view| view.view_id == view_id && view.kind == MiniAppViewKind::Window)
}

/// A view nonce long enough that another client cannot guess it, and short
/// enough to bound the lease table.
const NONCE_MIN: usize = 16;
const NONCE_MAX: usize = 128;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MiniAppInlineRequest {
    method: String,
    #[serde(default)]
    params: Value,
}

/// The NSH MiniApp view protocol (`open`, then the closed Shell protocol for
/// both in-product `tab` views and native desktop `window` views).
// @backend-command
pub(crate) async fn miniapp_inline(
    app: HostHandle,
    request: MiniAppInlineRequest,
) -> Result<Value, String> {
    if app.try_state::<DesktopMiniApps>().is_none() {
        return Err(crate::host::unsupported_in_native_host(
            "miniapp_inline (another OpenBitFun host owns MiniApps for this profile; quit it and restart)",
        ));
    }
    let params = match request.params {
        Value::Null => json!({}),
        Value::Object(map) => Value::Object(map),
        _ => return Err("MiniApp inline params must be an object".into()),
    };
    match request.method.as_str() {
        "open" => open(&app, params).await,
        method if INLINE_METHODS.contains(&method) => dispatch(&app, method, params).await,
        method if WINDOW_ONLY_METHODS.contains(&method) => {
            let host = app.state::<DesktopMiniApps>();
            if !is_window_view(&host, &params) {
                return Err(format!(
                    "Unsupported in-product MiniApp operation: {method}"
                ));
            }
            dispatch(&app, method, params).await
        }
        other => Err(format!("Unsupported in-product MiniApp operation: {other}")),
    }
}

fn nonce(params: &Value) -> Result<String, String> {
    let nonce = string(params, "nonce")?;
    if !(NONCE_MIN..=NONCE_MAX).contains(&nonce.len())
        || !nonce
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("Invalid MiniApp view nonce".into());
    }
    Ok(nonce)
}

/// Prepare (or take over) an in-product (`tab`) or desktop standalone (`window`)
/// view and return what the frame needs: the document, the instance and view
/// identity, locale and appearance.
async fn open(app: &HostHandle, params: Value) -> Result<Value, String> {
    let app_id = string(&params, "appId")?;
    let nonce = nonce(&params)?;
    let view_kind = match params.get("kind").and_then(Value::as_str).unwrap_or("tab") {
        "tab" => MiniAppViewKind::Tab,
        "window" => {
            if !app.native().shell().offers("miniapp.window.open") {
                return Err(crate::host::unsupported_in_native_host(
                    "miniapp_inline (independent MiniApp windows require the local native desktop shell)",
                ));
            }
            MiniAppViewKind::Window
        }
        other => return Err(format!("Unsupported MiniApp view kind: {other}")),
    };
    let workspace_path = params
        .get("workspacePath")
        .and_then(Value::as_str)
        .map(str::to_owned);
    // A remote workspace grant is refused loudly: the worker and its file
    // grants would run on this machine, not on the workspace's host.
    let workspace = local_workspace(app, workspace_path).await?;
    let host = app.state::<DesktopMiniApps>();
    let _guard = host.launches.lock().await;
    let appearance = params
        .get("appearanceMode")
        .and_then(Value::as_str)
        .filter(|mode| matches!(*mode, "light" | "dark"))
        .map(str::to_owned)
        .unwrap_or_else(|| crate::appearance::AppearanceConfig::miniapp_mode().into());
    let miniapp = miniapp_api::get_miniapp(
        crate::host::State::from(app.state()),
        miniapp_api::GetMiniAppRequest {
            app_id: app_id.clone(),
            appearance_mode: Some(appearance.clone()),
            workspace_path: workspace.clone(),
        },
    )
    .await?;
    if miniapp.compiled_html.trim().is_empty() {
        return Err("MiniApp document is empty; rebuild it in OpenBitFun".into());
    }
    let (instance, view) = host.instances.prepare(app_id, workspace, view_kind)?;
    {
        let mut shells = host.shells.lock().unwrap_or_else(|p| p.into_inner());
        let bridge = shell_advertises_agent_bridge(&params);
        match shells.get_mut(&view.view_id) {
            // Another client had this view: it is taken over, and the old
            // nonce stops working. Queued events stay for the new owner.
            Some(existing) => {
                existing.nonce = nonce;
                existing.agent_bridge = bridge;
                existing.notify.notify_waiters();
            }
            None => {
                shells.insert(
                    view.view_id.clone(),
                    ShellLease {
                        instance_id: instance.instance_id.clone(),
                        nonce,
                        streams: HashSet::new(),
                        events: VecDeque::new(),
                        sequence: 0,
                        event_bytes: 0,
                        agent_bridge: bridge,
                        notify: Arc::new(tokio::sync::Notify::new()),
                    },
                );
            }
        }
    }
    host.liveness_wake.notify_one();
    changed(app);
    let locale =
        crate::api::i18n_api::i18n_get_current_language(crate::host::State::from(app.state()))
            .await?;
    let mut document = serde_json::to_value(&miniapp).map_err(|e| e.to_string())?;
    if let Some(object) = document.as_object_mut() {
        // The frame needs the compiled document, not the sources it came from.
        object.remove("source");
        object.remove("ai_context");
    }
    let transfer_confirmed = if view_kind == MiniAppViewKind::Window {
        host.confirmed_transfers
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .remove(&view.view_id)
    } else {
        false
    };
    let capabilities: Vec<&str> = if view_kind == MiniAppViewKind::Window {
        vec![
            ipc::MINIAPP_CUSTOM_CHROME_CAPABILITY,
            ipc::MINIAPP_CHAT_SNAPSHOT_CAPABILITY,
            ipc::MINIAPP_AGENT_BRIDGE_CAPABILITY,
        ]
    } else {
        vec![ipc::MINIAPP_AGENT_BRIDGE_CAPABILITY]
    };
    Ok(json!({
        "presentationCapabilities": capabilities,
        "transferConfirmed": transfer_confirmed,
        "instance": instance,
        "view": view,
        "app": document,
        "hostEpoch": host.instances.snapshot().host_epoch,
        "locale": locale,
        "appearanceMode": appearance,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nonces_are_bounded_tokens() {
        assert!(nonce(&json!({"nonce": "abcdefghijklmnop"})).is_ok());
        assert!(nonce(&json!({"nonce": "short"})).is_err());
        assert!(nonce(&json!({"nonce": "has spaces in it, sixteen+"})).is_err());
        assert!(nonce(&json!({"nonce": "x".repeat(NONCE_MAX + 1)})).is_err());
        assert!(nonce(&json!({})).is_err());
    }

    #[test]
    fn the_inline_view_never_reaches_shell_only_operations() {
        for method in ["tab", "ping", "showMain", "contentAction", "chatSnapshot"] {
            assert!(
                !INLINE_METHODS.contains(&method),
                "{method} must stay with the Shell"
            );
        }
        assert!(INLINE_METHODS.contains(&"rpc"));
        assert!(INLINE_METHODS.contains(&"poll"));
    }

    #[test]
    fn requests_use_the_camel_case_envelope() {
        let request: MiniAppInlineRequest = serde_json::from_value(json!({
            "method": "rpc",
            "params": {"instanceId": "i", "viewId": "v", "nonce": "n", "method": "worker.call"}
        }))
        .expect("request");
        assert_eq!(request.method, "rpc");
        assert_eq!(request.params["method"], "worker.call");
        let bare: MiniAppInlineRequest =
            serde_json::from_value(json!({"method": "open"})).expect("params default");
        assert!(bare.params.is_null());
    }

    #[test]
    fn an_inline_view_with_a_bridge_answers_the_agent_like_a_window() {
        let host = DesktopMiniApps::new(ipc::HostChannel::Development);
        let (instance, view) = host
            .instances
            .prepare("demo".into(), None, MiniAppViewKind::Tab)
            .expect("inline view");
        host.shells
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .insert(
                view.view_id.clone(),
                ShellLease {
                    instance_id: instance.instance_id.clone(),
                    nonce: "nonce-nonce-nonce".into(),
                    streams: HashSet::new(),
                    events: VecDeque::new(),
                    sequence: 0,
                    event_bytes: 0,
                    agent_bridge: true,
                    notify: Arc::new(tokio::sync::Notify::new()),
                },
            );
        assert!(
            host.agent_window("demo").is_none(),
            "not mounted until ready"
        );
        host.instances
            .ready(&instance.instance_id, &view.view_id)
            .expect("ready");
        assert_eq!(
            host.agent_window("demo"),
            Some(AgentWindow {
                view_id: view.view_id.clone(),
                instance_id: instance.instance_id.clone(),
            })
        );
        // It is not an independent window: the Shell-only rules still hold.
        assert!(!host.window_presentation_exists("demo"));
        assert_eq!(
            host.tab_presentation("demo"),
            Some(instance.instance_id.clone())
        );
    }

    #[test]
    fn window_only_methods_are_gated_to_window_views() {
        let host = DesktopMiniApps::new(ipc::HostChannel::Development);
        let (tab_instance, tab_view) = host
            .instances
            .prepare("demo-tab".into(), None, MiniAppViewKind::Tab)
            .expect("tab view");
        assert!(!is_window_view(
            &host,
            &json!({"instanceId": tab_instance.instance_id, "viewId": tab_view.view_id})
        ));

        let (win_instance, win_view) = host
            .instances
            .prepare("demo-win".into(), None, MiniAppViewKind::Window)
            .expect("window view");
        assert!(is_window_view(
            &host,
            &json!({"instanceId": win_instance.instance_id, "viewId": win_view.view_id})
        ));
        assert!(WINDOW_ONLY_METHODS.contains(&"chatSnapshot"));
        assert!(WINDOW_ONLY_METHODS.contains(&"tab"));
    }

    #[test]
    fn a_tab_view_without_a_bridge_lease_is_not_an_agent_target() {
        let host = DesktopMiniApps::new(ipc::HostChannel::Development);
        let (instance, view) = host
            .instances
            .prepare("demo".into(), None, MiniAppViewKind::Tab)
            .expect("tab view");
        host.instances
            .ready(&instance.instance_id, &view.view_id)
            .expect("ready");
        assert!(host.agent_window("demo").is_none());
    }
}

//! The embedded browser of the native (NSH) desktop.
//!
//! In the Tauri host the backend creates child webviews itself. In the native
//! desktop the web views belong to the NSH UI process: the backend keeps the
//! same target registry (`api::browser_api`), owns every agent-facing
//! semantic (target ownership, navigation waits, the CDP-shaped primitives of
//! `BrowserActions` through `openbitfun_webdriver::actuated`) and asks the UI
//! shell to act on a page over the shell-request channel
//! ([`crate::host::shell`]). The shell is only the actuator: it loads, reloads,
//! evaluates, types and clicks, and reports page loads back
//! (`browser_webview_report_page_load`).
//!
//! A shell that does not offer the browser operations (an older UI, or no UI
//! attached) makes every command fail with `unsupported_in_native_host`
//! instead of pretending a page exists.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use openbitfun_core::agentic::tools::browser_control::builtin_browser::{
    set_builtin_browser_host, BuiltInBrowserCommand, BuiltInBrowserHost, BuiltInBrowserOpenRequest,
    BuiltInBrowserTarget,
};
use openbitfun_webdriver::actuated::{
    ActuatedWebviewAutomation, ActuatorFuture, ScriptFailure, TrustedInput, WebviewActuator,
};
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::sync::{Mutex, RwLock};

use crate::api::browser_api::{self, WebviewCreateRequest};
use crate::host::shell::SHELL_REQUEST_TIMEOUT;
use crate::host::NativeHost;

const OPEN_BUILT_IN_BROWSER_EVENT: &str = "agentic://open-built-in-browser";
static NEXT_OPEN_REQUEST_ID: AtomicU64 = AtomicU64::new(1);
/// How long target discovery waits for a page's title.
const TITLE_READ_TIMEOUT_MS: u64 = 2_000;

/// Why the native host cannot capture a page preview or screenshot.
pub(crate) const CAPTURE_UNSUPPORTED_REASON: &str =
    "The native desktop's web view has no snapshot API (NSH 0.6); page screenshots and previews are unavailable here";

/// The shell operations of the embedded browser, as the UI announces them.
pub(crate) mod ops {
    pub(crate) const CREATE: &str = "browser.create";
    pub(crate) const NAVIGATE: &str = "browser.navigate";
    pub(crate) const RELOAD: &str = "browser.reload";
    pub(crate) const INJECT: &str = "browser.inject";
    pub(crate) const EVALUATE: &str = "browser.evaluate";
    pub(crate) const INPUT: &str = "browser.input";
    pub(crate) const STATE: &str = "browser.state";
    pub(crate) const SET_BOUNDS: &str = "browser.setBounds";
    pub(crate) const CLOSE: &str = "browser.close";
}

async fn shell(host: &NativeHost, op: &str, args: Value) -> Result<Value, String> {
    host.shell_request(op, args, SHELL_REQUEST_TIMEOUT).await
}

fn validate_http_url(url: &str) -> Result<(), String> {
    let parsed = url
        .parse::<reqwest::Url>()
        .map_err(|error| format!("invalid url: {error}"))?;
    match parsed.scheme() {
        "http" | "https" => Ok(()),
        scheme => Err(format!("unsupported protocol: {scheme}")),
    }
}

fn validate_bounds(width: f64, height: f64, x: f64, y: f64) -> Result<(), String> {
    if [x, y, width, height].iter().all(|value| value.is_finite()) && width > 1.0 && height > 1.0 {
        Ok(())
    } else {
        Err("invalid webview bounds".to_string())
    }
}

fn require_registered(label: &str) -> Result<(), String> {
    browser_api::validate_browser_label(label)?;
    if browser_api::browser_target_registered(label) {
        Ok(())
    } else {
        Err(format!("Webview not found: {label}"))
    }
}

/// `browser_webview_create`: registers the target, then asks the shell for
/// a web view that loads `url`. Agent pages (with a conversation) start
/// hidden; the UI presents them when the user looks.
pub(crate) async fn create_page(
    host: &NativeHost,
    request: WebviewCreateRequest,
) -> Result<(), String> {
    browser_api::validate_browser_label(&request.label)?;
    validate_bounds(request.width, request.height, request.x, request.y)?;
    validate_http_url(&request.url)?;
    let args = json!({
        "label": request.label,
        "url": request.url,
        "conversationId": request.conversation_id,
        "x": request.x,
        "y": request.y,
        "width": request.width,
        "height": request.height,
    });
    browser_api::register_browser_target(
        &request.label,
        &request.url,
        request.open_request_id.clone(),
        request.conversation_id.clone(),
    );
    browser_api::begin_reported_browser_navigation(&request.label, "about:blank");
    if let Err(error) = shell(host, ops::CREATE, args).await {
        browser_api::unregister_browser_target(&request.label);
        return Err(error);
    }
    Ok(())
}

/// `browser_webview_navigate`.
pub(crate) async fn navigate_page(
    host: &NativeHost,
    label: &str,
    url: &str,
    open_request_id: Option<&str>,
) -> Result<(), String> {
    validate_http_url(url)?;
    require_registered(label)?;
    browser_api::begin_reported_browser_navigation(label, url);
    if let Err(error) = shell(host, ops::NAVIGATE, json!({ "label": label, "url": url })).await {
        browser_api::cancel_reported_browser_navigation(label);
        return Err(format!("navigate failed: {error}"));
    }
    // As in the Tauri host: only a navigation that started acknowledges an
    // open request.
    browser_api::associate_browser_open_request(label, open_request_id);
    Ok(())
}

/// `browser_webview_reload`.
pub(crate) async fn reload_page(host: &NativeHost, label: &str) -> Result<(), String> {
    require_registered(label)?;
    // A reload replaces the document: tools wait for its load as for a navigation.
    browser_api::begin_reported_browser_navigation(label, "about:blank");
    if let Err(error) = shell(host, ops::RELOAD, json!({ "label": label })).await {
        browser_api::cancel_reported_browser_navigation(label);
        return Err(format!("reload failed: {error}"));
    }
    Ok(())
}

/// `browser_webview_eval`: runs `script` without a result, as Tauri's
/// `Webview::eval`.
pub(crate) async fn inject_script(
    host: &NativeHost,
    label: &str,
    script: &str,
) -> Result<(), String> {
    require_registered(label)?;
    shell(
        host,
        ops::INJECT,
        json!({ "label": label, "script": script }),
    )
    .await
    .map(|_| ())
    .map_err(|error| format!("eval failed: {error}"))
}

/// `browser_webview_set_bounds`: the NSH UI lays its presented page out
/// itself; the bounds size the page while it is hidden.
pub(crate) async fn set_page_bounds(
    host: &NativeHost,
    label: &str,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    validate_bounds(width, height, x, y)?;
    require_registered(label)?;
    shell(
        host,
        ops::SET_BOUNDS,
        json!({ "label": label, "x": x, "y": y, "width": width, "height": height }),
    )
    .await
    .map(|_| ())
    .map_err(|error| format!("set bounds failed: {error}"))
}

/// What the shell reports about one page (it also tells `loading` and
/// `presented`, which discovery does not need).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PageState {
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub title: String,
}

/// The shell's view of a page; `None` when the shell holds no such page.
async fn page_state(host: &NativeHost, label: &str) -> Result<Option<PageState>, String> {
    let value = shell(host, ops::STATE, json!({ "label": label })).await?;
    if value.is_null() {
        return Ok(None);
    }
    serde_json::from_value(value)
        .map(Some)
        .map_err(|error| format!("The desktop shell sent an unreadable page state: {error}"))
}

/// `browser_get_url`: the page's committed URL; empty while none committed.
pub(crate) async fn current_url(host: &NativeHost, label: &str) -> Result<String, String> {
    require_registered(label)?;
    if let Some(error) = browser_api::browser_navigation_failure(label) {
        return Err(error);
    }
    match page_state(host, label).await? {
        Some(state) => Ok(state.url),
        None => Err(format!("Webview not found: {label}")),
    }
}

/// `browser_webview_capture_preview`: validated like the Tauri command, then
/// answered with its explicit unsupported shape.
pub(crate) fn capture_preview(label: &str) -> Result<Value, String> {
    require_registered(label)?;
    serde_json::to_value(browser_api::WebviewPreviewResponse::Unsupported {
        reason: CAPTURE_UNSUPPORTED_REASON.to_string(),
    })
    .map_err(|error| error.to_string())
}

/// One page as the actuator of the shared browser primitives.
pub(crate) struct NativePageActuator {
    host: Arc<NativeHost>,
    label: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EvaluateReply {
    ok: bool,
    #[serde(default)]
    value: Value,
    #[serde(default)]
    code: Option<String>,
    #[serde(default)]
    message: Option<String>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct InputReply {
    #[serde(default)]
    delivered: bool,
}

impl WebviewActuator for NativePageActuator {
    fn navigate<'a>(&'a self, url: &'a str) -> ActuatorFuture<'a, Result<(), String>> {
        Box::pin(async move { navigate_page(&self.host, &self.label, url, None).await })
    }

    fn reload(&self) -> ActuatorFuture<'_, Result<(), String>> {
        Box::pin(async move { reload_page(&self.host, &self.label).await })
    }

    fn evaluate<'a>(
        &'a self,
        script: &'a str,
        timeout_ms: u64,
    ) -> ActuatorFuture<'a, Result<Value, ScriptFailure>> {
        Box::pin(async move {
            let reply = self
                .host
                .shell_request(
                    ops::EVALUATE,
                    json!({ "label": self.label, "script": script, "timeoutMs": timeout_ms }),
                    Duration::from_millis(timeout_ms) + SHELL_REQUEST_TIMEOUT,
                )
                .await
                .map_err(ScriptFailure::Host)?;
            let reply: EvaluateReply = serde_json::from_value(reply).map_err(|error| {
                ScriptFailure::Host(format!(
                    "The desktop shell sent an unreadable script result: {error}"
                ))
            })?;
            if reply.ok {
                return Ok(reply.value);
            }
            let message = reply
                .message
                .unwrap_or_else(|| "JavaScript evaluation failed".to_string());
            // Only the page's own failure is a script exception; a page that
            // went away or a timeout is the host's.
            match reply.code.as_deref() {
                Some("ERR_NSH_WEBVIEW_SCRIPT") | None => Err(ScriptFailure::Script(message)),
                Some(code) => Err(ScriptFailure::Host(format!("{code}: {message}"))),
            }
        })
    }

    fn trusted_input(&self, input: TrustedInput) -> ActuatorFuture<'_, Result<bool, String>> {
        Box::pin(async move {
            let input = match input {
                TrustedInput::Click { x, y } => json!({ "type": "click", "x": x, "y": y }),
                TrustedInput::Key(key) => json!({ "type": "key", "key": key }),
            };
            let reply = shell(
                &self.host,
                ops::INPUT,
                json!({ "label": self.label, "input": input }),
            )
            .await?;
            Ok(serde_json::from_value::<InputReply>(reply)
                .unwrap_or_default()
                .delivered)
        })
    }

    fn close(&self) -> ActuatorFuture<'_, Result<(), String>> {
        Box::pin(async move {
            shell(&self.host, ops::CLOSE, json!({ "label": self.label }))
                .await
                .map(|_| ())
        })
    }

    fn capture_png(&self) -> ActuatorFuture<'_, Result<String, String>> {
        Box::pin(async move { Err(CAPTURE_UNSUPPORTED_REASON.to_string()) })
    }
}

type PageAutomation = ActuatedWebviewAutomation<NativePageActuator>;

/// The built-in browser host of the native desktop.
pub(crate) struct NativeBuiltInBrowserHost {
    host: Arc<NativeHost>,
    open_lock: Mutex<()>,
    pages: RwLock<HashMap<String, Arc<PageAutomation>>>,
}

impl NativeBuiltInBrowserHost {
    pub(crate) fn new(host: Arc<NativeHost>) -> Self {
        Self {
            host,
            open_lock: Mutex::new(()),
            pages: RwLock::new(HashMap::new()),
        }
    }

    async fn page(&self, target_id: &str) -> Result<Arc<PageAutomation>, String> {
        require_registered(target_id)?;
        if let Some(page) = self.pages.read().await.get(target_id).cloned() {
            return Ok(page);
        }
        let mut pages = self.pages.write().await;
        Ok(pages
            .entry(target_id.to_string())
            .or_insert_with(|| {
                Arc::new(ActuatedWebviewAutomation::new(
                    target_id,
                    NativePageActuator {
                        host: Arc::clone(&self.host),
                        label: target_id.to_string(),
                    },
                ))
            })
            .clone())
    }

    async fn forget(&self, target_id: &str) {
        self.pages.write().await.remove(target_id);
        browser_api::unregister_browser_target(target_id);
    }

    /// The page's `document.title`, without waiting on a slow page for long.
    async fn read_title(&self, target_id: &str) -> Option<String> {
        let page = self.page(target_id).await.ok()?;
        page.actuator()
            .evaluate("document.title", TITLE_READ_TIMEOUT_MS)
            .await
            .ok()
            .and_then(|value| value.as_str().map(str::to_string))
    }

    async fn discover_targets(
        &self,
        conversation_id: Option<&str>,
    ) -> Result<Vec<BuiltInBrowserTarget>, String> {
        let mut targets = browser_api::registered_browser_targets();
        // Another conversation's pages are never read for this one.
        targets.retain(|target| {
            conversation_id.is_none() || target.conversation_id.as_deref() == conversation_id
        });
        let mut kept = Vec::with_capacity(targets.len());
        for mut target in targets {
            match page_state(&self.host, &target.id).await {
                // The UI no longer holds the page (the user closed it).
                Ok(None) => {
                    self.forget(&target.id).await;
                    continue;
                }
                Ok(Some(state)) => {
                    if !state.url.is_empty() {
                        target.url = state.url;
                    }
                    let mut title = state.title;
                    // The web view's events may carry no title: read it from
                    // the page, as the Tauri host does, unless its load failed.
                    if title.is_empty()
                        && browser_api::browser_navigation_failure(&target.id).is_none()
                    {
                        title = self.read_title(&target.id).await.unwrap_or_default();
                    }
                    if !title.is_empty() {
                        target.title = title;
                        browser_api::update_browser_target_metadata(
                            &target.id,
                            &target.url,
                            &target.title,
                        );
                    }
                }
                // No shell to ask: keep what the registry knows.
                Err(error) => {
                    log::debug!(
                        "Browser page state unavailable: target={}, error={}",
                        target.id,
                        error
                    );
                }
            }
            if target.title.is_empty() {
                target.title = "Built-in browser".to_string();
            }
            kept.push(target);
        }
        Ok(kept)
    }
}

#[async_trait]
impl BuiltInBrowserHost for NativeBuiltInBrowserHost {
    async fn open(
        &self,
        request: BuiltInBrowserOpenRequest,
    ) -> Result<BuiltInBrowserTarget, String> {
        let request_id = format!(
            "builtin-browser-open-{}-{}",
            std::process::id(),
            NEXT_OPEN_REQUEST_ID.fetch_add(1, Ordering::Relaxed)
        );
        let _open_guard = self.open_lock.lock().await;
        let existing = request
            .replace_existing
            .then(|| {
                browser_api::registered_browser_targets()
                    .into_iter()
                    .find(|target| target.conversation_id == request.conversation_id)
            })
            .flatten();
        let target_id = if let Some(target) = existing {
            navigate_page(&self.host, &target.id, &request.url, Some(&request_id)).await?;
            target.id
        } else {
            let label = format!("embedded-browser-panel-view-{request_id}");
            create_page(
                &self.host,
                WebviewCreateRequest {
                    label: label.clone(),
                    url: request.url.clone(),
                    x: 0.0,
                    y: 0.0,
                    width: 1024.0,
                    height: 768.0,
                    open_request_id: Some(request_id.clone()),
                    conversation_id: request.conversation_id.clone(),
                },
            )
            .await?;
            label
        };
        browser_api::update_browser_target_metadata(&target_id, &request.url, &request.title);
        let target = browser_api::registered_browser_target_for_open_request(&request_id)
            .ok_or_else(|| "the session browser page was closed while opening".to_string())?;
        if let Err(error) = self.host.emit(
            OPEN_BUILT_IN_BROWSER_EVENT,
            json!({
                "requestId": request_id,
                "sessionId": request.conversation_id,
                "targetId": target.id,
                "url": request.url,
                "title": request.title,
                "replaceExisting": request.replace_existing,
            }),
        ) {
            return Err(format!("failed to present the built-in browser: {error}"));
        }
        Ok(target)
    }

    async fn list_targets(&self) -> Result<Vec<BuiltInBrowserTarget>, String> {
        self.discover_targets(None).await
    }

    async fn list_targets_for_session(
        &self,
        conversation_id: Option<&str>,
    ) -> Result<Vec<BuiltInBrowserTarget>, String> {
        self.discover_targets(conversation_id).await
    }

    async fn execute(&self, command: BuiltInBrowserCommand) -> Result<Value, String> {
        if command.method == "Runtime.evaluate" {
            browser_api::wait_for_browser_navigation(&command.target_id).await?;
        }
        let page = self.page(&command.target_id).await?;
        let result = page.execute(&command.method, command.params).await;
        if command.method == "Page.close" && result.is_ok() {
            self.forget(&command.target_id).await;
        }
        result
    }
}

/// Makes the native desktop's web views the built-in browser of agent tools.
pub(crate) fn install(host: Arc<NativeHost>) {
    set_builtin_browser_host(Arc::new(NativeBuiltInBrowserHost::new(host)));
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backend_protocol::EventHub;
    use crate::host::shell::ShellResponse;
    use crate::host::NativeHostInfo;

    fn host() -> Arc<NativeHost> {
        NativeHost::new(
            EventHub::new(64),
            NativeHostInfo {
                version: "1.0.0".into(),
                platform: "macos".into(),
                data_dir: String::new(),
            },
        )
    }

    /// Plays the UI shell: answers each browser request with `answer(op, args)`
    /// and records them.
    fn play_shell(
        host: &Arc<NativeHost>,
        answer: impl Fn(&str, &Value) -> Result<Value, String> + Send + Sync + 'static,
    ) -> Arc<std::sync::Mutex<Vec<(String, Value)>>> {
        host.shell().attach(
            [
                ops::CREATE,
                ops::NAVIGATE,
                ops::RELOAD,
                ops::INJECT,
                ops::EVALUATE,
                ops::INPUT,
                ops::STATE,
                ops::SET_BOUNDS,
                ops::CLOSE,
            ]
            .map(String::from),
        );
        let seen = Arc::new(std::sync::Mutex::new(Vec::new()));
        let host = Arc::clone(host);
        let record = Arc::clone(&seen);
        // Requests published from now on, also before the task first runs.
        let mut cursor = host.events().last_seq();
        tokio::spawn(async move {
            loop {
                let batch = host.events().events_after(cursor, 16);
                cursor = batch.last_seq;
                for event in &batch.events {
                    if event.event != crate::host::shell::SHELL_REQUEST_EVENT {
                        continue;
                    }
                    let op = event.payload["op"].as_str().unwrap_or("").to_string();
                    let args = event.payload["args"].clone();
                    record.lock().unwrap().push((op.clone(), args.clone()));
                    let (ok, value, error) = match answer(&op, &args) {
                        Ok(value) => (true, value, None),
                        Err(error) => (false, Value::Null, Some(error)),
                    };
                    let _ = host.shell().respond(ShellResponse {
                        id: event.payload["id"].as_u64().unwrap(),
                        ok,
                        value,
                        error,
                    });
                }
                tokio::task::yield_now().await;
            }
        });
        seen
    }

    fn report(label: &str, event: &str, url: &str) -> browser_api::BrowserPageLoadReport {
        browser_api::BrowserPageLoadReport {
            label: label.into(),
            event: event.into(),
            url: url.into(),
            title: Some("Example Domain".into()),
            error: None,
        }
    }

    #[tokio::test]
    async fn without_a_shell_every_page_operation_refuses_loudly() {
        let host = host();
        let label = "embedded-browser-view-native-no-shell";
        let error = create_page(
            &host,
            WebviewCreateRequest {
                label: label.into(),
                url: "https://example.com/".into(),
                x: 0.0,
                y: 0.0,
                width: 800.0,
                height: 600.0,
                open_request_id: None,
                conversation_id: None,
            },
        )
        .await
        .unwrap_err();
        assert!(error.starts_with("unsupported_in_native_host"), "{error}");
        // A refused page is not left registered for agents to find.
        assert!(!browser_api::browser_target_registered(label));
        assert!(current_url(&host, label)
            .await
            .unwrap_err()
            .contains("Webview not found"));
        assert!(capture_preview(label).is_err());
    }

    #[tokio::test]
    async fn an_agent_sequence_navigates_reads_the_title_and_clicks_through_the_shell() {
        let host = host();
        let seen = play_shell(&host, |op, args| match op {
            ops::EVALUATE => {
                let script = args["script"].as_str().unwrap_or_default();
                if script.contains("document.title") {
                    Ok(json!({ "ok": true, "value": "Example Domain" }))
                } else if script.contains("throw") {
                    Ok(json!({ "ok": false, "code": "ERR_NSH_WEBVIEW_SCRIPT", "message": "boom" }))
                } else {
                    Ok(json!({ "ok": true, "value": true }))
                }
            }
            ops::INPUT => Ok(json!({ "delivered": true })),
            ops::STATE => Ok(json!({ "url": "https://example.com/", "title": "Example Domain" })),
            _ => Ok(Value::Null),
        });
        let browser = NativeBuiltInBrowserHost::new(Arc::clone(&host));
        let target = browser
            .open(BuiltInBrowserOpenRequest {
                url: "https://example.com/".into(),
                title: "Example".into(),
                replace_existing: false,
                conversation_id: Some("conversation-native".into()),
            })
            .await
            .unwrap();
        assert!(target.id.starts_with("embedded-browser-panel-view-"));
        assert_eq!(
            target.conversation_id.as_deref(),
            Some("conversation-native")
        );
        let created = seen.lock().unwrap()[0].clone();
        assert_eq!(created.0, ops::CREATE);
        assert_eq!(created.1["conversationId"], "conversation-native");

        // The page reports its load; reads wait for it.
        assert!(browser_api::apply_browser_page_load_report(&report(
            &target.id,
            "started",
            "https://example.com/"
        )));
        assert!(browser_api::apply_browser_page_load_report(&report(
            &target.id,
            "finished",
            "https://example.com/"
        )));
        let title = browser
            .execute(BuiltInBrowserCommand {
                target_id: target.id.clone(),
                method: "Runtime.evaluate".into(),
                params: Some(json!({ "expression": "document.title" })),
            })
            .await
            .unwrap();
        assert_eq!(title["result"]["value"], "Example Domain");
        let thrown = browser
            .execute(BuiltInBrowserCommand {
                target_id: target.id.clone(),
                method: "Runtime.evaluate".into(),
                params: Some(json!({ "expression": "throw new Error('x')" })),
            })
            .await
            .unwrap();
        assert_eq!(thrown["exceptionDetails"]["text"], "boom");
        for kind in ["mousePressed", "mouseReleased"] {
            browser
                .execute(BuiltInBrowserCommand {
                    target_id: target.id.clone(),
                    method: "Input.dispatchMouseEvent".into(),
                    params: Some(json!({ "type": kind, "x": 12, "y": 34 })),
                })
                .await
                .unwrap();
        }
        let input = seen
            .lock()
            .unwrap()
            .iter()
            .find(|(op, _)| op == ops::INPUT)
            .cloned()
            .unwrap();
        assert_eq!(
            input.1["input"],
            json!({ "type": "click", "x": 12.0, "y": 34.0 })
        );

        // Discovery is scoped to the conversation and reads the live title.
        let listed = browser
            .list_targets_for_session(Some("conversation-native"))
            .await
            .unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].title, "Example Domain");
        assert!(browser
            .list_targets_for_session(Some("someone-else"))
            .await
            .unwrap()
            .is_empty());

        // A replacement navigation waits for its own load, not the old one.
        browser
            .execute(BuiltInBrowserCommand {
                target_id: target.id.clone(),
                method: "Page.navigate".into(),
                params: Some(json!({ "url": "https://example.org/" })),
            })
            .await
            .unwrap();
        let pending = tokio::time::timeout(
            Duration::from_millis(50),
            browser_api::wait_for_browser_navigation(&target.id),
        )
        .await;
        assert!(pending.is_err(), "reads must wait for the new document");
        browser_api::apply_browser_page_load_report(&browser_api::BrowserPageLoadReport {
            error: Some("offline".into()),
            ..report(&target.id, "failed", "")
        });
        assert!(browser_api::wait_for_browser_navigation(&target.id)
            .await
            .unwrap_err()
            .contains("offline"));

        browser
            .execute(BuiltInBrowserCommand {
                target_id: target.id.clone(),
                method: "Page.close".into(),
                params: None,
            })
            .await
            .unwrap();
        assert!(!browser_api::browser_target_registered(&target.id));
    }

    #[tokio::test]
    async fn ui_commands_keep_the_tauri_shapes_and_capture_is_explicitly_unsupported() {
        let host = host();
        let seen = play_shell(&host, |op, _| match op {
            ops::STATE => Ok(json!({ "url": "https://example.com/a", "title": "A" })),
            _ => Ok(Value::Null),
        });
        let label = "embedded-browser-view-native-ui";
        create_page(
            &host,
            WebviewCreateRequest {
                label: label.into(),
                url: "https://example.com/".into(),
                x: 0.0,
                y: 0.0,
                width: 800.0,
                height: 600.0,
                open_request_id: None,
                conversation_id: None,
            },
        )
        .await
        .unwrap();
        assert!(create_page(
            &host,
            WebviewCreateRequest {
                label: "embedded-browser-view-native-file".into(),
                url: "file:///etc/hosts".into(),
                x: 0.0,
                y: 0.0,
                width: 800.0,
                height: 600.0,
                open_request_id: None,
                conversation_id: None,
            },
        )
        .await
        .unwrap_err()
        .contains("unsupported protocol"));
        assert_eq!(
            current_url(&host, label).await.unwrap(),
            "https://example.com/a"
        );
        inject_script(&host, label, "history.back()").await.unwrap();
        set_page_bounds(&host, label, 0.0, 0.0, 640.0, 480.0)
            .await
            .unwrap();
        assert!(set_page_bounds(&host, label, 0.0, 0.0, 0.0, 480.0)
            .await
            .is_err());
        reload_page(&host, label).await.unwrap();
        assert_eq!(
            capture_preview(label).unwrap(),
            json!({ "status": "unsupported", "reason": CAPTURE_UNSUPPORTED_REASON })
        );
        let ops_seen: Vec<String> = seen
            .lock()
            .unwrap()
            .iter()
            .map(|(op, _)| op.clone())
            .collect();
        assert_eq!(
            ops_seen,
            vec![
                ops::CREATE,
                ops::STATE,
                ops::INJECT,
                ops::SET_BOUNDS,
                ops::RELOAD
            ]
        );
        browser_api::unregister_browser_target(label);
    }
}

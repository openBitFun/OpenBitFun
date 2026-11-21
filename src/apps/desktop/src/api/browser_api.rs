//! Browser API — the embedded browser's target registry and commands.
//!
//! The pages are NSH web views in the UI process (`native_browser.rs`, shell
//! operations `browser.*`); this module keeps the target registry, navigation
//! waits fed by page-load reports, and the request shapes of the browser
//! commands (`backend_protocol::native_commands::browser`).

use openbitfun_core::agentic::tools::browser_control::BuiltInBrowserTarget;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use tokio::sync::watch;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebviewEvalRequest {
    pub label: String,
    pub script: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebviewNavigateRequest {
    pub label: String,
    pub url: String,
    #[serde(default)]
    pub open_request_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebviewBoundsRequest {
    pub label: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebviewCreateRequest {
    pub label: String,
    pub url: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    #[serde(default)]
    pub open_request_id: Option<String>,
    #[serde(default)]
    pub conversation_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserAgentTargetStateRequest {
    pub label: String,
    pub active: bool,
    #[serde(default)]
    pub open_request_id: Option<String>,
}

#[derive(Clone, Debug, Default)]
struct BrowserTargetRecord {
    active: bool,
    last_active_seq: u64,
    url: String,
    title: Option<String>,
    open_request_id: Option<String>,
    conversation_id: Option<String>,
    navigation: Option<BrowserNavigation>,
}

#[derive(Clone, Debug)]
struct BrowserNavigation {
    started: bool,
    completed: watch::Sender<Option<Result<(), String>>>,
}

impl BrowserNavigation {
    fn new() -> Self {
        Self {
            started: false,
            completed: watch::channel(None).0,
        }
    }

    fn page_load(&mut self, event: &str) {
        if event == "started" {
            self.started = true;
        } else if event == "finished" && self.started {
            // Redirects may finish at a different URL. A finish from the old
            // document before this navigation starts must not release readers.
            self.completed.send_replace(Some(Ok(())));
        }
    }

    /// A main-frame failure reported by a host whose web view only tells
    /// load start, finish and error (the native NSH desktop).
    fn page_failed(&mut self, error: &str) {
        self.completed.send_replace(Some(Err(format!(
            "[NOT_AVAILABLE] Navigation failed: {error}"
        ))));
    }
}

#[derive(Default)]
struct BrowserTargetRegistry {
    next_seq: u64,
    records: HashMap<String, BrowserTargetRecord>,
}

impl BrowserTargetRegistry {
    fn label_for_open_request(&self, request_id: &str) -> Option<String> {
        self.records.iter().find_map(|(label, record)| {
            (record.open_request_id.as_deref() == Some(request_id)).then(|| label.clone())
        })
    }
}

static BROWSER_TARGETS: OnceLock<Mutex<BrowserTargetRegistry>> = OnceLock::new();

fn lock_browser_targets() -> std::sync::MutexGuard<'static, BrowserTargetRegistry> {
    BROWSER_TARGETS
        .get_or_init(|| Mutex::new(BrowserTargetRegistry::default()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub(crate) fn validate_browser_label(label: &str) -> Result<(), String> {
    if label.starts_with("embedded-browser-view-")
        || label.starts_with("embedded-browser-panel-view-")
    {
        Ok(())
    } else {
        Err("invalid browser webview label".to_string())
    }
}

pub(crate) fn register_browser_target(
    label: &str,
    url: &str,
    open_request_id: Option<String>,
    conversation_id: Option<String>,
) {
    lock_browser_targets().records.insert(
        label.to_string(),
        BrowserTargetRecord {
            url: url.to_string(),
            open_request_id,
            conversation_id,
            ..BrowserTargetRecord::default()
        },
    );
}

pub(crate) fn associate_browser_open_request(label: &str, open_request_id: Option<&str>) {
    let Some(open_request_id) = open_request_id
        .map(str::trim)
        .filter(|request_id| !request_id.is_empty())
    else {
        return;
    };
    if let Some(record) = lock_browser_targets().records.get_mut(label) {
        record.open_request_id = Some(open_request_id.to_string());
    }
}

/// Native navigation can leave the previous completed document readable while
/// the replacement response is in flight. Do not expose that document to tools.
pub(crate) async fn wait_for_browser_navigation(label: &str) -> Result<(), String> {
    let pending = lock_browser_targets()
        .records
        .get(label)
        .and_then(|record| record.navigation.as_ref())
        .map(|navigation| navigation.completed.subscribe());
    if let Some(mut pending) = pending {
        let outcome = tokio::time::timeout(
            std::time::Duration::from_secs(15),
            pending.wait_for(Option::is_some),
        )
        .await
        .map_err(|_| {
            format!("Navigation on {label} is still loading; wait before reading this page")
        })?
        .map_err(|_| format!("Navigation on {label} was superseded or its page was closed"))?
        .clone();
        return outcome.expect("completed navigation has an outcome");
    }
    Ok(())
}

pub(crate) fn browser_navigation_failure(label: &str) -> Option<String> {
    lock_browser_targets()
        .records
        .get(label)
        .and_then(|record| record.navigation.as_ref())
        .and_then(|navigation| {
            navigation
                .completed
                .borrow()
                .as_ref()
                .and_then(|outcome| outcome.as_ref().err())
                .cloned()
        })
}

pub(crate) fn update_browser_target_metadata(label: &str, url: &str, title: &str) {
    if let Some(record) = lock_browser_targets().records.get_mut(label) {
        record.url = url.to_string();
        record.title = Some(title.to_string());
    }
}

pub(crate) fn unregister_browser_target(label: &str) {
    lock_browser_targets().records.remove(label);
}

/// Whether `label` names a registered browser target.
pub(crate) fn browser_target_registered(label: &str) -> bool {
    lock_browser_targets().records.contains_key(label)
}

/// Starts tracking a navigation of a target whose host reports page loads
/// itself (the native desktop). Returns whether the navigation only changes
/// the fragment of the recorded document, which keeps that document and
/// does not wait for a load.
pub(crate) fn begin_reported_browser_navigation(label: &str, url: &str) -> bool {
    let mut registry = lock_browser_targets();
    let Some(record) = registry.records.get_mut(label) else {
        return false;
    };
    let same_document = fragment_only_change(&record.url, url);
    record.navigation = (!same_document).then(BrowserNavigation::new);
    if !same_document {
        record.title = None;
    }
    same_document
}

/// Drops a navigation that never started (the host refused it).
pub(crate) fn cancel_reported_browser_navigation(label: &str) {
    if let Some(record) = lock_browser_targets().records.get_mut(label) {
        record.navigation = None;
    }
}

fn fragment_only_change(current: &str, next: &str) -> bool {
    let (Ok(mut current), Ok(next)) = (
        current.parse::<reqwest::Url>(),
        next.parse::<reqwest::Url>(),
    ) else {
        return false;
    };
    let fragment_changed = current.fragment() != next.fragment();
    current.set_fragment(next.fragment());
    fragment_changed && current == next
}

/// The registered targets of a host that owns no Tauri webviews (the native
/// desktop), most recently activated first. Pages leave the inventory when
/// the host closes them, not by comparing against Tauri handles.
pub(crate) fn registered_browser_targets() -> Vec<BuiltInBrowserTarget> {
    let registry = lock_browser_targets();
    let mut targets = registry
        .records
        .iter()
        .map(|(label, record)| {
            (
                record.last_active_seq,
                BuiltInBrowserTarget {
                    id: label.clone(),
                    url: record.url.clone(),
                    title: record.title.clone().unwrap_or_default(),
                    active: record.active,
                    conversation_id: record.conversation_id.clone(),
                },
            )
        })
        .collect::<Vec<_>>();
    targets.sort_by(|left, right| {
        right
            .0
            .cmp(&left.0)
            .then_with(|| left.1.id.cmp(&right.1.id))
    });
    targets.into_iter().map(|(_, target)| target).collect()
}

/// The registered target that acknowledged `request_id` (native desktop).
pub(crate) fn registered_browser_target_for_open_request(
    request_id: &str,
) -> Option<BuiltInBrowserTarget> {
    let label = lock_browser_targets().label_for_open_request(request_id)?;
    registered_browser_targets()
        .into_iter()
        .find(|target| target.id == label)
}

/// A page-load report from a host whose UI owns the web view (the native
/// NSH desktop): `started`, `finished` or `failed`.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserPageLoadReport {
    pub label: String,
    pub event: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
}

/// Applies a page-load report to the target registry. Returns `false` for a
/// label that is not registered (a page the backend already closed).
pub(crate) fn apply_browser_page_load_report(report: &BrowserPageLoadReport) -> bool {
    let mut registry = lock_browser_targets();
    let Some(record) = registry.records.get_mut(&report.label) else {
        return false;
    };
    if !report.url.is_empty() {
        record.url = report.url.clone();
    }
    match report.event.as_str() {
        "started" => {
            record.title = None;
            // A load the page started itself (a link, a script) is a new
            // navigation tools must wait for, as WebKit's observer reports it.
            let navigation = record.navigation.get_or_insert_with(BrowserNavigation::new);
            if navigation.completed.borrow().is_some() {
                *navigation = BrowserNavigation::new();
            }
            navigation.page_load("started");
        }
        "finished" => {
            if let Some(title) = report.title.as_deref().filter(|title| !title.is_empty()) {
                record.title = Some(title.to_string());
            }
            if let Some(navigation) = &mut record.navigation {
                navigation.page_load("finished");
            }
        }
        "failed" => {
            let error = report
                .error
                .as_deref()
                .filter(|error| !error.trim().is_empty())
                .unwrap_or("the page did not load");
            record
                .navigation
                .get_or_insert_with(BrowserNavigation::new)
                .page_failed(error);
        }
        _ => {}
    }
    true
}

/// The native desktop's web views report their page loads here; the target
/// registry, agent tools and every frontend then see them as the Tauri host's
/// native page-load observer reports them. The Tauri host observes its own
/// webviews and ignores reports for labels it does not hold.
// @backend-command
pub async fn browser_webview_report_page_load(
    host: crate::host::HostHandle,
    request: BrowserPageLoadReport,
) -> Result<(), String> {
    validate_browser_label(&request.label)?;
    if !matches!(request.event.as_str(), "started" | "finished" | "failed") {
        return Err(format!("unknown page-load event: {}", request.event));
    }
    if !apply_browser_page_load_report(&request) {
        return Ok(());
    }
    use openbitfun_core::agentic::tools::browser_control::builtin_browser;
    if request.event == "failed" {
        let error = request.error.clone().unwrap_or_default();
        builtin_browser::publish_builtin_browser_navigation_failed(&request.label, &error);
    } else {
        builtin_browser::publish_builtin_browser_page_load(
            &request.label,
            &request.event,
            &request.url,
        );
    }
    let mut payload = serde_json::json!({
        "label": request.label,
        "event": request.event,
        "url": request.url,
    });
    if let Some(error) = &request.error {
        payload["error"] = serde_json::Value::String(error.clone());
    }
    host.emit_to("main", crate::BROWSER_WEBVIEW_PAGE_LOAD_EVENT, payload)
        .map_err(|error| format!("failed to publish the page load: {error}"))
}

/// Advertise which built-in browser surface the Agent should target. This is
/// lifecycle metadata only; browser actions remain in the shared Rust action
/// layer and native WebView adapter.
// @backend-command
pub async fn browser_webview_set_agent_target_state(
    request: BrowserAgentTargetStateRequest,
) -> Result<(), String> {
    validate_browser_label(&request.label)?;
    let mut registry = lock_browser_targets();
    if !registry.records.contains_key(&request.label) {
        return Err(format!("Webview not found: {}", request.label));
    }
    if request.active {
        registry.next_seq = registry.next_seq.saturating_add(1);
        let next_seq = registry.next_seq;
        for record in registry.records.values_mut() {
            record.active = false;
        }
        let record = registry
            .records
            .get_mut(&request.label)
            .expect("registered target");
        record.active = true;
        record.last_active_seq = next_seq;
        if let Some(request_id) = request
            .open_request_id
            .as_deref()
            .map(str::trim)
            .filter(|request_id| !request_id.is_empty())
            // Session requests are registered by the host before presentation.
            // A late callback from the old panel must not overwrite a newer open.
            .filter(|_| record.conversation_id.is_none())
        {
            record.open_request_id = Some(request_id.to_string());
        }
    } else if let Some(record) = registry.records.get_mut(&request.label) {
        record.active = false;
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebviewLabelRequest {
    pub label: String,
}

/// `browser_webview_capture_preview`. A client names a page by `label`, or
/// asks for the page an agent conversation uses (`conversationId`), or for
/// the device's most recently shown page (neither). Both fields are optional
/// so the label-only shape older callers send keeps working.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebviewPreviewRequest {
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub conversation_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum WebviewPreviewResponse {
    Ready {
        #[serde(rename = "dataUrl")]
        data_url: String,
    },
    Unsupported {
        reason: String,
    },
    /// A script-free copy of the page's document as it is now: the native
    /// desktop's web view has no pixel snapshot API, so a phone or a browser
    /// draws this copy as a read-only live view.
    #[serde(rename_all = "camelCase")]
    Snapshot {
        label: String,
        url: String,
        title: String,
        html: String,
        /// The page's viewport on the desktop, in CSS pixels.
        viewport_width: u32,
        viewport_height: u32,
        captured_at_ms: u64,
    },
    /// The page exists but its copy is larger than a live view carries.
    #[serde(rename_all = "camelCase")]
    TooLarge {
        label: String,
        url: String,
        title: String,
    },
    /// No page matches the request (the conversation opened none).
    NoPage,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replacement_navigation_does_not_accept_the_previous_document_finish() {
        let mut navigation = BrowserNavigation::new();
        navigation.page_load("finished");
        assert!(navigation.completed.borrow().is_none());
        navigation.page_load("started");
        navigation.page_load("started"); // A redirect or a superseding navigation.
        navigation.page_load("finished");
        assert_eq!(*navigation.completed.borrow(), Some(Ok(())));
    }

    #[tokio::test]
    async fn presentation_cannot_overwrite_a_session_hosts_newer_open_request() {
        let label = "embedded-browser-panel-view-request-owner-test";
        register_browser_target(
            label,
            "https://example.com",
            Some("new-request".into()),
            Some("owner".into()),
        );
        browser_webview_set_agent_target_state(BrowserAgentTargetStateRequest {
            label: label.into(),
            active: true,
            open_request_id: Some("old-request".into()),
        })
        .await
        .unwrap();
        assert_eq!(
            lock_browser_targets().label_for_open_request("new-request"),
            Some(label.into())
        );
        unregister_browser_target(label);
    }

    #[test]
    fn legacy_create_payload_keeps_the_unscoped_browser_contract() {
        let request: WebviewCreateRequest = serde_json::from_value(serde_json::json!({
            "label": "embedded-browser-panel-view-old", "url": "https://example.com",
            "x": 0, "y": 0, "width": 800, "height": 600,
        }))
        .unwrap();
        assert!(request.conversation_id.is_none());
        assert!(request.open_request_id.is_none());
    }

    #[test]
    fn open_request_correlation_accepts_the_exact_background_target() {
        let mut registry = BrowserTargetRegistry::default();
        registry.records.insert(
            "embedded-browser-panel-view-old".to_string(),
            BrowserTargetRecord {
                active: true,
                open_request_id: Some("old-request".to_string()),
                ..BrowserTargetRecord::default()
            },
        );
        registry.records.insert(
            "embedded-browser-panel-view-new".to_string(),
            BrowserTargetRecord {
                active: false,
                open_request_id: Some("new-request".to_string()),
                ..BrowserTargetRecord::default()
            },
        );

        assert_eq!(
            registry.label_for_open_request("old-request").as_deref(),
            Some("embedded-browser-panel-view-old")
        );
        assert_eq!(registry.label_for_open_request("missing-request"), None);

        assert_eq!(
            registry.label_for_open_request("new-request").as_deref(),
            Some("embedded-browser-panel-view-new")
        );
    }
}

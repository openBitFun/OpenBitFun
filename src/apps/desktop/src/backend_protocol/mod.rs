//! Transport-neutral backend protocol of the desktop backend.
//!
//! Every client (the in-process NSH UI today; WebSocket/relay clients later)
//! talks to the backend through the same two primitives:
//!
//! - [`BackendService::dispatch`]: run one product command by its Tauri
//!   command name with the exact JSON arguments the Tauri frontend passed to
//!   `invoke`, returning the JSON of the command's `Ok` value or its error
//!   text;
//! - [`BackendService::subscribe_events`]: the ordered event stream (names
//!   and payloads identical to the Tauri host's events), each event carrying
//!   a monotonically increasing `seq`, with a bounded replay ring so a
//!   reconnecting client can resume after the last `seq` it saw.
//!
//! Nothing here depends on a UI toolkit or on a transport; host-specific
//! glue (NSH native module, servers) lives in the host crates. [`ffi`] is
//! the C ABI through which a separately built UI host (the NSH desktop
//! runner) loads this library and speaks the same protocol in-process.

mod dispatch;
mod dispatch_generated;
mod events;
pub mod ffi;
pub mod ws;

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use serde_json::Value;

use crate::host::{HostHandle, NativeHost, NativeHostInfo};

pub use dispatch_generated::{NativeCommandSupport, NATIVE_COMMANDS};
pub use events::{
    BackendEvent, EventBatch, EventHub, EventSubscription, DEFAULT_EVENT_REPLAY_CAPACITY,
    EVENTS_DROPPED_EVENT,
};

/// A boxed, sendable dispatch future.
pub type DispatchFuture<'a> = Pin<Box<dyn Future<Output = Result<Value, String>> + Send + 'a>>;

/// The backend protocol endpoint of one running backend.
#[derive(Clone)]
pub struct BackendService {
    host: Arc<NativeHost>,
}

impl BackendService {
    pub fn new(host: Arc<NativeHost>) -> Self {
        Self { host }
    }

    /// The native host behind this service.
    pub fn host(&self) -> &Arc<NativeHost> {
        &self.host
    }

    /// A host handle for code that runs host-side work on behalf of a client.
    pub fn host_handle(&self) -> HostHandle {
        HostHandle::Native(Arc::clone(&self.host))
    }

    /// Runs one command. Unknown commands and commands that need a Tauri
    /// webview or window fail with `unsupported_in_native_host: <command>`.
    pub fn dispatch<'a>(&'a self, command: &'a str, args: Value) -> DispatchFuture<'a> {
        dispatch_generated::dispatch(&self.host, command, args)
    }

    /// Like [`Self::dispatch`] but owning its inputs, for spawning.
    pub fn dispatch_owned(
        &self,
        command: String,
        args: Value,
    ) -> impl Future<Output = Result<Value, String>> + Send + 'static {
        let service = self.clone();
        async move { service.dispatch(&command, args).await }
    }

    /// A subscriber of the ordered event stream. `after: None` delivers only
    /// new events; `Some(seq)` replays retained events after `seq`.
    pub fn subscribe_events(&self, after: Option<u64>) -> EventSubscription {
        self.host.events().subscribe(after)
    }

    /// The event hub (for transports that manage their own cursors).
    pub fn events(&self) -> &Arc<EventHub> {
        self.host.events()
    }

    /// Static facts about the backend host.
    pub fn info(&self) -> NativeHostInfo {
        self.host.info()
    }

    /// Whether the command has a native implementation (as opposed to an
    /// explicit unsupported arm or no arm at all).
    pub fn supports(command: &str) -> bool {
        NATIVE_COMMANDS
            .iter()
            .any(|(name, support)| *name == command && *support == NativeCommandSupport::Native)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    /// Command names registered in the Tauri `generate_handler!` list.
    fn registered_commands() -> BTreeSet<String> {
        let source = include_str!("../lib.rs");
        let start = source
            .find("tauri::generate_handler![")
            .expect("generate_handler! in lib.rs")
            + "tauri::generate_handler![".len();
        let end = start + source[start..].find(']').expect("end of generate_handler!");
        source[start..end]
            .lines()
            .map(|line| line.split("//").next().unwrap_or_default().trim())
            .flat_map(|line| line.split(','))
            .map(str::trim)
            .filter(|entry| !entry.is_empty())
            .map(|entry| entry.rsplit("::").next().unwrap_or(entry).to_string())
            .collect()
    }

    #[test]
    fn every_registered_command_has_a_native_dispatch_arm() {
        let registered = registered_commands();
        let dispatched: BTreeSet<String> = NATIVE_COMMANDS
            .iter()
            .map(|(name, _)| (*name).to_string())
            .collect();
        let missing: Vec<_> = registered.difference(&dispatched).collect();
        let stale: Vec<_> = dispatched.difference(&registered).collect();
        assert!(
            missing.is_empty() && stale.is_empty(),
            "native dispatcher is out of date (run node scripts/generate-desktop-native-dispatch.mjs): missing={missing:?}, stale={stale:?}"
        );
        assert_eq!(dispatched.len(), NATIVE_COMMANDS.len(), "duplicate arms");
    }

    #[test]
    fn every_command_source_has_a_matching_arm() {
        // A `#[tauri::command]` anywhere in the crate must be registered and
        // therefore dispatched; an unregistered command would be dead code.
        let dispatched: BTreeSet<&str> = NATIVE_COMMANDS.iter().map(|(name, _)| *name).collect();
        let sources = [
            include_str!("../api/commands.rs"),
            include_str!("../api/agentic_api.rs"),
            include_str!("../api/system_api.rs"),
            include_str!("../api/config_api.rs"),
            include_str!("../api/terminal_api.rs"),
        ];
        for source in sources {
            let mut lines = source.lines().peekable();
            while let Some(line) = lines.next() {
                if line.trim() != "#[tauri::command]" {
                    continue;
                }
                let signature = lines
                    .by_ref()
                    .find(|line| line.contains("fn "))
                    .expect("command fn");
                let name = signature
                    .split("fn ")
                    .nth(1)
                    .and_then(|rest| rest.split(['(', '<']).next())
                    .expect("command name")
                    .trim();
                assert!(dispatched.contains(name), "no native arm for {name}");
            }
        }
    }

    #[tokio::test]
    async fn unknown_and_tauri_only_commands_fail_loudly() {
        let host = crate::native_host::create_native_host();
        let service = BackendService::new(host);
        let error = service
            .dispatch("no_such_command", Value::Null)
            .await
            .unwrap_err();
        assert_eq!(error, "unsupported_in_native_host: no_such_command");
        let error = service
            .dispatch("browser_webview_create", serde_json::json!({}))
            .await
            .unwrap_err();
        assert_eq!(error, "unsupported_in_native_host: browser_webview_create");
        // A native command whose managed state is not registered names it.
        let error = service
            .dispatch("get_opened_workspaces", serde_json::json!({}))
            .await
            .unwrap_err();
        assert!(
            error.starts_with("unsupported_in_native_host: get_opened_workspaces"),
            "{error}"
        );
    }

    #[tokio::test]
    async fn native_commands_receive_state_and_arguments() {
        let host = crate::native_host::create_native_host();
        host.manage(crate::startup_trace::DesktopStartupTrace::new(
            "native-test".to_string(),
            std::time::Instant::now(),
        ));
        let service = BackendService::new(host);
        let snapshot = service
            .dispatch("get_startup_native_trace", serde_json::json!({}))
            .await
            .expect("startup trace snapshot");
        assert_eq!(snapshot["traceId"], "native-test");
    }
}

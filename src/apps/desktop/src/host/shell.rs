//! Requests from the backend to the native UI shell.
//!
//! In the native desktop the window, tray, notifications, clipboard, login
//! item and application lifecycle belong to the NSH shell (`nsh/desktop`),
//! not to the backend library. Commands that act on them (`quit_app`,
//! `send_system_notification`, the launch-at-login option, ...) still run in
//! the backend, so every client and the agent reach them the same way: the
//! backend asks the shell and waits for its answer.
//!
//! Protocol (owner scope only; `host://` events never leave it):
//! - the shell announces what it can do once its window is up:
//!   `host_shell_attach { request: { ops: [...] } }`;
//! - the backend publishes `host://shell-request` `{ id, op, args }`;
//! - the shell answers `host_shell_respond { request: { id, ok, value?, error? } }`.
//!
//! A shell that never attached (an older UI), or did not list an operation,
//! gets an explicit `unsupported_in_native_host` error immediately instead of
//! a request nobody answers.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::Deserialize;
use serde_json::{json, Value};
use tokio::sync::oneshot;

use crate::backend_protocol::EventHub;

/// The event carrying one shell request.
pub const SHELL_REQUEST_EVENT: &str = "host://shell-request";

/// How long an ordinary shell operation may take.
pub const SHELL_REQUEST_TIMEOUT: Duration = Duration::from_secs(15);

/// How long an operation that waits for the user (a save panel) may take.
pub const SHELL_INTERACTIVE_TIMEOUT: Duration = Duration::from_secs(30 * 60);

type Waiter = oneshot::Sender<Result<Value, String>>;

#[derive(Default)]
struct ShellState {
    /// Operations the attached shell offers; `None` until it attached.
    ops: Option<HashSet<String>>,
    pending: HashMap<u64, Waiter>,
}

/// The backend's side of the shell-request channel.
#[derive(Default)]
pub struct ShellBridge {
    state: Mutex<ShellState>,
    next_id: AtomicU64,
}

/// The shell's answer to one request (`host_shell_respond`).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellResponse {
    pub id: u64,
    pub ok: bool,
    #[serde(default)]
    pub value: Value,
    #[serde(default)]
    pub error: Option<String>,
}

fn shell_unsupported(op: &str, why: &str) -> String {
    format!(
        "{}: shell operation {op} ({why})",
        super::UNSUPPORTED_IN_NATIVE_HOST
    )
}

impl ShellBridge {
    fn lock(&self) -> std::sync::MutexGuard<'_, ShellState> {
        match self.state.lock() {
            Ok(state) => state,
            Err(poisoned) => poisoned.into_inner(),
        }
    }

    /// Records the operations the shell offers. A later attach (the UI
    /// reloaded) replaces the list; requests still waiting stay valid.
    pub fn attach(&self, ops: impl IntoIterator<Item = String>) -> Vec<String> {
        let ops: HashSet<String> = ops
            .into_iter()
            .map(|op| op.trim().to_string())
            .filter(|op| !op.is_empty())
            .collect();
        let mut listed: Vec<String> = ops.iter().cloned().collect();
        listed.sort();
        self.lock().ops = Some(ops);
        listed
    }

    /// Whether the attached shell offers `op`.
    pub fn offers(&self, op: &str) -> bool {
        self.lock().ops.as_ref().is_some_and(|ops| ops.contains(op))
    }

    /// Whether a shell attached at all.
    pub fn attached(&self) -> bool {
        self.lock().ops.is_some()
    }

    /// Asks the shell to run `op` and waits up to `timeout` for its answer.
    pub async fn request(
        &self,
        events: &EventHub,
        op: &str,
        args: Value,
        timeout: Duration,
    ) -> Result<Value, String> {
        let (sender, receiver) = oneshot::channel();
        let id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        {
            let mut state = self.lock();
            match &state.ops {
                None => {
                    return Err(shell_unsupported(
                        op,
                        "no desktop shell is attached to this backend; update the app",
                    ))
                }
                Some(ops) if !ops.contains(op) => {
                    return Err(shell_unsupported(
                        op,
                        "the attached desktop shell does not offer it; update the app",
                    ))
                }
                Some(_) => {}
            }
            state.pending.insert(id, sender);
        }
        events.publish(
            SHELL_REQUEST_EVENT,
            json!({ "id": id, "op": op, "args": args }),
        );
        let outcome = tokio::time::timeout(timeout, receiver).await;
        // A timed-out or dropped waiter must not linger.
        self.lock().pending.remove(&id);
        match outcome {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err(format!("The desktop shell dropped request {op}")),
            Err(_) => Err(format!(
                "The desktop shell did not answer {op} within {} s",
                timeout.as_secs()
            )),
        }
    }

    /// Settles a waiting request. Unknown, late or repeated answers are
    /// refused, never fatal.
    pub fn respond(&self, response: ShellResponse) -> Result<(), String> {
        let waiter = self
            .lock()
            .pending
            .remove(&response.id)
            .ok_or_else(|| format!("No shell request {} is waiting", response.id))?;
        let result = if response.ok {
            Ok(response.value)
        } else {
            Err(response
                .error
                .filter(|error| !error.trim().is_empty())
                .unwrap_or_else(|| "The desktop shell refused the request".to_string()))
        };
        let _ = waiter.send(result);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[tokio::test]
    async fn requests_fail_fast_until_a_shell_attaches_and_offers_the_operation() {
        let bridge = ShellBridge::default();
        let hub = EventHub::new(16);
        let error = bridge
            .request(&hub, "notify", Value::Null, SHELL_REQUEST_TIMEOUT)
            .await
            .unwrap_err();
        assert!(error.starts_with("unsupported_in_native_host"), "{error}");
        assert!(error.contains("no desktop shell"), "{error}");
        bridge.attach(["quit".to_string()]);
        let error = bridge
            .request(&hub, "notify", Value::Null, SHELL_REQUEST_TIMEOUT)
            .await
            .unwrap_err();
        assert!(error.contains("does not offer"), "{error}");
        // Nothing was published for refused requests.
        assert_eq!(hub.events_after(0, 16).events.len(), 0);
    }

    #[tokio::test]
    async fn an_answer_settles_its_request_once() {
        let bridge = Arc::new(ShellBridge::default());
        let hub = EventHub::new(16);
        bridge.attach(["notify".to_string()]);
        let waiting = {
            let bridge = Arc::clone(&bridge);
            let hub = Arc::clone(&hub);
            tokio::spawn(async move {
                bridge
                    .request(&hub, "notify", json!({"title": "t"}), SHELL_REQUEST_TIMEOUT)
                    .await
            })
        };
        let event = loop {
            let batch = hub.events_after(0, 16);
            if let Some(event) = batch.events.first() {
                break Arc::clone(event);
            }
            tokio::task::yield_now().await;
        };
        assert_eq!(event.event, SHELL_REQUEST_EVENT);
        assert_eq!(event.payload["op"], "notify");
        let id = event.payload["id"].as_u64().unwrap();
        bridge
            .respond(ShellResponse {
                id,
                ok: true,
                value: json!(true),
                error: None,
            })
            .unwrap();
        assert_eq!(waiting.await.unwrap(), Ok(json!(true)));
        // A repeated answer is refused.
        assert!(bridge
            .respond(ShellResponse {
                id,
                ok: true,
                value: Value::Null,
                error: None,
            })
            .is_err());
    }

    #[tokio::test]
    async fn a_refusal_carries_the_shell_error_and_timeouts_release_the_waiter() {
        let bridge = Arc::new(ShellBridge::default());
        let hub = EventHub::new(16);
        bridge.attach(["clipboard.readImage".to_string()]);
        let error = bridge
            .request(
                &hub,
                "clipboard.readImage",
                Value::Null,
                Duration::from_millis(10),
            )
            .await
            .unwrap_err();
        assert!(error.contains("did not answer"), "{error}");
        assert!(bridge.lock().pending.is_empty());
        let late = hub.events_after(0, 16).events[0].payload["id"]
            .as_u64()
            .unwrap();
        assert!(bridge
            .respond(ShellResponse {
                id: late,
                ok: false,
                value: Value::Null,
                error: Some("too late".into()),
            })
            .is_err());
    }

    #[test]
    fn responses_accept_legacy_minimal_payloads() {
        let response: ShellResponse = serde_json::from_str(r#"{"id":3,"ok":false}"#).unwrap();
        assert!(response.error.is_none());
        assert!(response.value.is_null());
        let response: ShellResponse =
            serde_json::from_str(r#"{"id":4,"ok":true,"value":{"a":1},"future":true}"#).unwrap();
        assert_eq!(response.value["a"], 1);
    }
}

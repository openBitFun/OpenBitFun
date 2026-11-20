//! The in-process native host: a frozen state registry plus the backend
//! event hub. It replaces the Tauri application handle when the desktop
//! backend runs inside a native UI process (or behind a protocol server).

use std::any::{Any, TypeId};
use std::collections::HashMap;
use std::sync::{Arc, RwLock};

use serde::Serialize;

use super::State;
use crate::backend_protocol::EventHub;

/// Static facts about the running native host.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeHostInfo {
    /// Application version.
    pub version: String,
    /// `macos`, `windows` or `linux`.
    pub platform: String,
    /// User data directory of this installation.
    pub data_dir: String,
}

type StateEntry = &'static (dyn Any + Send + Sync);

/// A backend-internal event listener (`HostHandle::listen`): gets the JSON
/// text of each matching event's payload, as Tauri's `Event::payload()`.
type Listener = Arc<dyn Fn(&str) + Send + Sync>;
type Listeners = Arc<RwLock<Vec<(String, Listener)>>>;

/// The native host. Lives for the whole process.
pub struct NativeHost {
    states: RwLock<HashMap<TypeId, StateEntry>>,
    events: Arc<EventHub>,
    info: RwLock<NativeHostInfo>,
    shell: super::shell::ShellBridge,
    listeners: Listeners,
    listener_task: std::sync::Once,
}

impl NativeHost {
    /// A host publishing into `events`.
    pub fn new(events: Arc<EventHub>, info: NativeHostInfo) -> Arc<Self> {
        Arc::new(Self {
            states: RwLock::new(HashMap::new()),
            events,
            info: RwLock::new(info),
            shell: super::shell::ShellBridge::default(),
            listeners: Arc::default(),
            listener_task: std::sync::Once::new(),
        })
    }

    /// Registers managed state. The first
    /// value of a type wins and later ones are refused (returns `false`).
    /// Registered values live until process exit.
    pub fn manage<T: Send + Sync + 'static>(&self, value: T) -> bool {
        let mut states = match self.states.write() {
            Ok(states) => states,
            Err(poisoned) => poisoned.into_inner(),
        };
        if states.contains_key(&TypeId::of::<T>()) {
            return false;
        }
        let leaked: &'static T = Box::leak(Box::new(value));
        states.insert(TypeId::of::<T>(), leaked);
        true
    }

    /// Managed state, if registered.
    pub fn try_state<T: Send + Sync + 'static>(&self) -> Option<State<'_, T>> {
        let states = match self.states.read() {
            Ok(states) => states,
            Err(poisoned) => poisoned.into_inner(),
        };
        let entry: StateEntry = *states.get(&TypeId::of::<T>())?;
        entry.downcast_ref::<T>().map(State::from_ref)
    }

    /// Managed state for a command argument, or an explicit error naming the
    /// command and the missing state type.
    pub fn command_state<T: Send + Sync + 'static>(
        &self,
        command: &str,
    ) -> Result<State<'_, T>, String> {
        self.try_state::<T>().ok_or_else(|| {
            format!(
                "{}: {} (state {} is not available in the native host)",
                super::UNSUPPORTED_IN_NATIVE_HOST,
                command,
                std::any::type_name::<T>()
            )
        })
    }

    /// Publishes one frontend event.
    pub fn emit<S: Serialize>(&self, event: &str, payload: S) -> anyhow::Result<()> {
        let payload = serde_json::to_value(payload)?;
        self.events.publish(event, payload);
        Ok(())
    }

    /// Calls `handler` with the payload JSON of every later event named
    /// `event`, for backend code that reacts
    /// to its own events (MiniApp windows relay agent and worker events).
    /// Listeners run on one dispatcher task over the event stream, in order.
    pub fn listen<F>(&self, event: impl Into<String>, handler: F)
    where
        F: Fn(&str) + Send + Sync + 'static,
    {
        {
            let mut listeners = match self.listeners.write() {
                Ok(listeners) => listeners,
                Err(poisoned) => poisoned.into_inner(),
            };
            listeners.push((event.into(), Arc::new(handler)));
        }
        self.listener_task.call_once(|| {
            let listeners = Arc::clone(&self.listeners);
            let mut subscription = self.events.subscribe(None);
            tokio::spawn(async move {
                loop {
                    let batch = subscription.next_batch(256).await;
                    for event in &batch.events {
                        let matching: Vec<Listener> = {
                            let listeners = match listeners.read() {
                                Ok(listeners) => listeners,
                                Err(poisoned) => poisoned.into_inner(),
                            };
                            listeners
                                .iter()
                                .filter(|(name, _)| *name == event.event)
                                .map(|(_, listener)| Arc::clone(listener))
                                .collect()
                        };
                        if matching.is_empty() {
                            continue;
                        }
                        let payload = event.payload.to_string();
                        for listener in matching {
                            listener(&payload);
                        }
                    }
                    if batch.closed {
                        break;
                    }
                }
            });
        });
    }

    /// The event hub this host publishes into.
    pub fn events(&self) -> &Arc<EventHub> {
        &self.events
    }

    /// The channel to the native UI shell (window, tray, notifications,
    /// clipboard, login item, application lifecycle).
    pub fn shell(&self) -> &super::shell::ShellBridge {
        &self.shell
    }

    /// Asks the native UI shell to run `op`; see [`super::shell`].
    pub async fn shell_request(
        &self,
        op: &str,
        args: serde_json::Value,
        timeout: std::time::Duration,
    ) -> Result<serde_json::Value, String> {
        self.shell.request(&self.events, op, args, timeout).await
    }

    /// Static host facts.
    pub fn info(&self) -> NativeHostInfo {
        match self.info.read() {
            Ok(info) => info.clone(),
            Err(poisoned) => poisoned.into_inner().clone(),
        }
    }

    /// Replaces the host facts (the data directory is known only after the
    /// configuration bootstrap).
    pub fn set_info(&self, info: NativeHostInfo) {
        match self.info.write() {
            Ok(mut current) => *current = info,
            Err(poisoned) => *poisoned.into_inner() = info,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backend_protocol::EventHub;

    #[tokio::test(flavor = "multi_thread")]
    async fn listeners_get_the_payload_json_of_matching_events_in_order() {
        let host = NativeHost::new(
            EventHub::new(16),
            NativeHostInfo {
                version: "1.0.0".into(),
                platform: "macos".into(),
                data_dir: String::new(),
            },
        );
        let (sender, mut receiver) = tokio::sync::mpsc::unbounded_channel();
        host.listen("miniapp-deleted", move |payload| {
            let _ = sender.send(payload.to_string());
        });
        // Give the dispatcher its subscription before publishing.
        tokio::task::yield_now().await;
        host.emit("other-event", serde_json::json!({"id": "x"}))
            .unwrap();
        host.emit("miniapp-deleted", serde_json::json!({"id": "a"}))
            .unwrap();
        host.emit("miniapp-deleted", serde_json::json!({"id": "b"}))
            .unwrap();
        let first = tokio::time::timeout(std::time::Duration::from_secs(5), receiver.recv())
            .await
            .unwrap()
            .unwrap();
        let second = tokio::time::timeout(std::time::Duration::from_secs(5), receiver.recv())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(first, r#"{"id":"a"}"#);
        assert_eq!(second, r#"{"id":"b"}"#);
    }
}

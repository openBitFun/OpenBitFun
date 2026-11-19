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

/// The native host. Lives for the whole process.
pub struct NativeHost {
    states: RwLock<HashMap<TypeId, StateEntry>>,
    events: Arc<EventHub>,
    info: RwLock<NativeHostInfo>,
}

impl NativeHost {
    /// A host publishing into `events`.
    pub fn new(events: Arc<EventHub>, info: NativeHostInfo) -> Arc<Self> {
        Arc::new(Self {
            states: RwLock::new(HashMap::new()),
            events,
            info: RwLock::new(info),
        })
    }

    /// Registers managed state. Like `tauri::Manager::manage`, the first
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

    /// The event hub this host publishes into.
    pub fn events(&self) -> &Arc<EventHub> {
        &self.events
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

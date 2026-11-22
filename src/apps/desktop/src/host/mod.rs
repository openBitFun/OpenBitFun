//! The backend host shim.
//!
//! Desktop commands and their helpers take [`State`] (managed state borrowed
//! for one call) and [`HostHandle`] (the running backend host). The generated
//! dispatcher in [`crate::backend_protocol`] fills both from the in-process
//! [`NativeHost`]; window, tray, notification, clipboard and lifecycle work
//! goes through the shell channel ([`shell`]), which refuses loudly with
//! [`UNSUPPORTED_IN_NATIVE_HOST`] when no UI shell offers an operation.

mod native;
pub mod shell;
mod transport;

use std::fmt;
use std::ops::Deref;
use std::sync::Arc;

use serde::Serialize;

pub use native::{ListenerId, NativeHost, NativeHostInfo};
pub use transport::HostTransportAdapter;

/// Error prefix used whenever the host cannot perform an operation (no shell
/// offers it, or the command was retired). Clients match on the prefix.
pub const UNSUPPORTED_IN_NATIVE_HOST: &str = "unsupported_in_native_host";

/// The explicit error returned for an operation the host cannot perform.
pub fn unsupported_in_native_host(operation: &str) -> String {
    format!("{UNSUPPORTED_IN_NATIVE_HOST}: {operation}")
}

/// Managed state borrowed for the duration of a command.
///
/// Built from any `&T` registered in the host, so handlers can be called
/// directly by the dispatcher and by tests.
pub struct State<'r, T: Send + Sync + 'static>(&'r T);

impl<'r, T: Send + Sync + 'static> State<'r, T> {
    /// Wraps a borrowed state value.
    pub fn from_ref(value: &'r T) -> Self {
        Self(value)
    }

    /// The borrowed state value, with the full state lifetime.
    pub fn inner(&self) -> &'r T {
        self.0
    }
}

impl<T: Send + Sync + 'static> Deref for State<'_, T> {
    type Target = T;

    fn deref(&self) -> &T {
        self.0
    }
}

impl<T: Send + Sync + 'static> Clone for State<'_, T> {
    fn clone(&self) -> Self {
        *self
    }
}

impl<T: Send + Sync + 'static> Copy for State<'_, T> {}

impl<T: Send + Sync + 'static + fmt::Debug> fmt::Debug for State<'_, T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_tuple("State").field(self.0).finish()
    }
}

/// The application host a command runs in: the in-process backend host that
/// the native NSH app, OBP WebSocket clients and mesh peers all reach.
#[derive(Clone)]
pub struct HostHandle(Arc<NativeHost>);

impl fmt::Debug for HostHandle {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("HostHandle")
    }
}

impl From<Arc<NativeHost>> for HostHandle {
    fn from(host: Arc<NativeHost>) -> Self {
        Self(host)
    }
}

impl HostHandle {
    /// A handle on `host`.
    pub fn new(host: Arc<NativeHost>) -> Self {
        Self(host)
    }

    /// The backend host.
    pub fn native(&self) -> &Arc<NativeHost> {
        &self.0
    }

    /// Managed state; panics like a missing registration would when it is absent.
    pub fn state<T: Send + Sync + 'static>(&self) -> State<'_, T> {
        match self.try_state::<T>() {
            Some(state) => state,
            None => panic!(
                "state() called before manage() for {}",
                std::any::type_name::<T>()
            ),
        }
    }

    /// Managed state, if registered.
    pub fn try_state<T: Send + Sync + 'static>(&self) -> Option<State<'_, T>> {
        self.0.try_state::<T>()
    }

    /// Emits an event to every frontend of this host.
    pub fn emit<S: Serialize + Clone>(&self, event: &str, payload: S) -> anyhow::Result<()> {
        self.0.emit(event, payload)
    }

    /// Emits an event to one frontend target. The host has one main
    /// frontend stream: events for `main` are delivered, events for other
    /// targets (auxiliary windows of the retired Tauri shell) have no receiver.
    pub fn emit_to<S: Serialize + Clone>(
        &self,
        target: &str,
        event: &str,
        payload: S,
    ) -> anyhow::Result<()> {
        if target == "main" {
            self.0.emit(event, payload)
        } else {
            log::debug!(
                "Host has no frontend target for event: target={}, event={}",
                target,
                event
            );
            Ok(())
        }
    }

    /// Calls `handler` with the payload JSON of every event named `event`
    /// this host emits.
    pub fn listen<F>(&self, event: impl Into<String>, handler: F) -> ListenerId
    where
        F: Fn(&str) + Send + Sync + 'static,
    {
        self.0.listen(event, handler)
    }

    /// Calls `handler` with `(event_name, &payload)` for every event named
    /// `event` without re-serializing JSON.
    pub fn listen_value<F>(&self, event: impl Into<String>, handler: F) -> ListenerId
    where
        F: Fn(&str, &serde_json::Value) + Send + Sync + 'static,
    {
        self.0.listen_value(event, handler)
    }

    /// Calls `handler` with `(event_name, &payload)` for every event whose
    /// name starts with `prefix`.
    pub fn listen_prefix_value<F>(&self, prefix: impl Into<String>, handler: F) -> ListenerId
    where
        F: Fn(&str, &serde_json::Value) + Send + Sync + 'static,
    {
        self.0.listen_prefix_value(prefix, handler)
    }

    /// Removes a listener registered on this host.
    pub fn unlisten(&self, id: ListenerId) -> bool {
        self.0.unlisten(id)
    }

    /// The application version.
    pub fn app_version(&self) -> String {
        self.0.info().version.clone()
    }
}

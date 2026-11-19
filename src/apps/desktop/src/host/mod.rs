//! Host shim shared by the legacy Tauri host and the in-process native host.
//!
//! Desktop commands and their helpers take [`State`] and [`HostHandle`]
//! instead of `tauri::State` and `tauri::AppHandle`. Both types still work as
//! `#[tauri::command]` arguments (they delegate to Tauri's extractors), and
//! both can also be constructed without Tauri, so the native dispatcher in
//! [`crate::backend_protocol`] can call the same handlers directly.
//!
//! Operations that only exist inside a Tauri host (webviews, window chrome,
//! Tauri plugins) go through [`HostHandle::tauri`], which fails with an
//! explicit [`UNSUPPORTED_IN_NATIVE_HOST`] error in the native host instead of
//! silently succeeding.

mod native;
mod transport;

use std::fmt;
use std::ops::Deref;
use std::sync::Arc;

use serde::Serialize;

pub use native::{NativeHost, NativeHostInfo};
pub use transport::HostTransportAdapter;

/// Error prefix used whenever the native host cannot perform a Tauri-only
/// operation. The frontend transport surfaces it verbatim.
pub const UNSUPPORTED_IN_NATIVE_HOST: &str = "unsupported_in_native_host";

/// The explicit error returned for a Tauri-only operation in the native host.
pub fn unsupported_in_native_host(operation: &str) -> String {
    format!("{UNSUPPORTED_IN_NATIVE_HOST}: {operation}")
}

/// Managed state borrowed for the duration of a command.
///
/// This replaces `tauri::State` in desktop commands. Unlike `tauri::State` it
/// can be built from any `&T`, so handlers can run outside Tauri.
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

impl<'r, T: Send + Sync + 'static> From<tauri::State<'r, T>> for State<'r, T> {
    fn from(state: tauri::State<'r, T>) -> Self {
        Self(state.inner())
    }
}

impl<'r, 'de: 'r, T: Send + Sync + 'static, R: tauri::Runtime> tauri::ipc::CommandArg<'de, R>
    for State<'r, T>
{
    fn from_command(
        command: tauri::ipc::CommandItem<'de, R>,
    ) -> Result<Self, tauri::ipc::InvokeError> {
        <tauri::State<'r, T> as tauri::ipc::CommandArg<'de, R>>::from_command(command)
            .map(|state| Self(state.inner()))
    }
}

/// The application host a command runs in.
#[derive(Clone)]
pub enum HostHandle {
    /// The legacy Tauri host (one transition release).
    Tauri(tauri::AppHandle),
    /// The in-process native host (NSH and future protocol servers).
    Native(Arc<NativeHost>),
}

impl fmt::Debug for HostHandle {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Tauri(_) => f.write_str("HostHandle::Tauri"),
            Self::Native(_) => f.write_str("HostHandle::Native"),
        }
    }
}

impl From<tauri::AppHandle> for HostHandle {
    fn from(app: tauri::AppHandle) -> Self {
        Self::Tauri(app)
    }
}

impl From<&tauri::AppHandle> for HostHandle {
    fn from(app: &tauri::AppHandle) -> Self {
        Self::Tauri(app.clone())
    }
}

impl HostHandle {
    /// The Tauri application handle when running in the Tauri host.
    pub fn as_tauri(&self) -> Option<&tauri::AppHandle> {
        match self {
            Self::Tauri(app) => Some(app),
            Self::Native(_) => None,
        }
    }

    /// The Tauri application handle, or an explicit unsupported error naming
    /// `operation` in the native host.
    pub fn tauri(&self, operation: &str) -> Result<&tauri::AppHandle, String> {
        self.as_tauri()
            .ok_or_else(|| unsupported_in_native_host(operation))
    }

    /// The native host when running without Tauri.
    pub fn as_native(&self) -> Option<&Arc<NativeHost>> {
        match self {
            Self::Tauri(_) => None,
            Self::Native(host) => Some(host),
        }
    }

    /// Whether this is the in-process native host.
    pub fn is_native(&self) -> bool {
        matches!(self, Self::Native(_))
    }

    /// Managed state; panics like `tauri::Manager::state` when it is missing.
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
        match self {
            Self::Tauri(app) => {
                use tauri::Manager;
                app.try_state::<T>().map(State::from)
            }
            Self::Native(host) => host.try_state::<T>(),
        }
    }

    /// Emits an event to every frontend of this host.
    pub fn emit<S: Serialize + Clone>(&self, event: &str, payload: S) -> tauri::Result<()> {
        match self {
            Self::Tauri(app) => {
                use tauri::Emitter;
                app.emit(event, payload)
            }
            Self::Native(host) => host.emit(event, payload).map_err(tauri::Error::Anyhow),
        }
    }

    /// Emits an event to one frontend target. The native host has one main
    /// frontend: events for `main` are delivered, events for Tauri-only
    /// auxiliary windows have no receiver (as in Tauri when that window is
    /// closed).
    pub fn emit_to<S: Serialize + Clone>(
        &self,
        target: &str,
        event: &str,
        payload: S,
    ) -> tauri::Result<()> {
        match self {
            Self::Tauri(app) => {
                use tauri::Emitter;
                app.emit_to(target, event, payload)
            }
            Self::Native(host) => {
                if target == "main" {
                    host.emit(event, payload).map_err(tauri::Error::Anyhow)
                } else {
                    log::debug!(
                        "Native host has no frontend target for event: target={}, event={}",
                        target,
                        event
                    );
                    Ok(())
                }
            }
        }
    }

    /// The application version.
    pub fn app_version(&self) -> String {
        match self {
            Self::Tauri(app) => app.package_info().version.to_string(),
            Self::Native(host) => host.info().version.clone(),
        }
    }
}

impl<'de> tauri::ipc::CommandArg<'de, tauri::Wry> for HostHandle {
    fn from_command(
        command: tauri::ipc::CommandItem<'de, tauri::Wry>,
    ) -> Result<Self, tauri::ipc::InvokeError> {
        <tauri::AppHandle as tauri::ipc::CommandArg<'de, tauri::Wry>>::from_command(command)
            .map(HostHandle::Tauri)
    }
}

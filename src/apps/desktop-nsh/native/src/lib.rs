//! `openbitfun/native`: the in-process backend as an NSH native module.
//!
//! This crate is deliberately thin and backend-agnostic. The host binary
//! bootstraps the backend and attaches it at runtime through [`attach`]; until
//! then (and if bootstrap fails) the module's promises wait for, or reject
//! with, the backend's readiness. Event batching for `nextEvents` keeps one
//! cursor per UI process over the backend's sequence-numbered event stream.

use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};

use nsh_core::prelude::*;
use tokio::sync::watch;

/// A boxed, sendable future.
pub type BoxFuture<T> = Pin<Box<dyn Future<Output = T> + Send + 'static>>;

/// Most events delivered by one `nextEvents` call.
pub const MAX_EVENTS_PER_BATCH: usize = 512;

/// Prefix of the rejection for commands the native host cannot run.
pub const UNSUPPORTED_IN_NATIVE_HOST: &str = "unsupported_in_native_host";

/// Events after a cursor, already encoded for JS.
#[derive(Debug, Clone, Default)]
pub struct EventBatch {
    /// JSON array of `{"seq", "event", "payload"}` objects in emission order.
    pub json: String,
    /// Number of events in `json`.
    pub count: usize,
    /// The cursor to continue from.
    pub last_seq: u64,
    /// The backend stopped; no further events will arrive.
    pub closed: bool,
}

/// What the module needs from the backend. Implemented by the host binary
/// over the backend's transport-neutral protocol service.
pub trait BackendBridge: Send + Sync + 'static {
    /// Runs one command with the Tauri-shaped JSON arguments; resolves with
    /// the JSON of the result or rejects with the error text.
    fn invoke(&self, command: String, args_json: String) -> BoxFuture<Result<String, String>>;

    /// Waits for at least one event with `seq > after` (or shutdown) and
    /// returns up to `max` of them.
    fn events_after(&self, after: u64, max: usize) -> BoxFuture<EventBatch>;

    /// Writes one frontend log line into the backend log.
    fn log(&self, level: &str, message: &str);

    /// The local folder picker; `None` when the host has none.
    fn pick_directory(&self, options_json: String) -> Option<BoxFuture<Result<String, String>>> {
        let _ = options_json;
        None
    }
}

/// Readiness of the backend as seen by the module.
#[derive(Clone)]
enum Readiness {
    Starting,
    Ready {
        bridge: Arc<dyn BackendBridge>,
        info_json: String,
    },
    Failed(String),
}

fn readiness() -> &'static watch::Sender<Readiness> {
    static READINESS: OnceLock<watch::Sender<Readiness>> = OnceLock::new();
    READINESS.get_or_init(|| watch::channel(Readiness::Starting).0)
}

/// The local UI's event cursor (`nextEvents()` without an explicit cursor).
static UI_EVENT_CURSOR: AtomicU64 = AtomicU64::new(0);

/// Attaches the bootstrapped backend. `info_json` is what `ready()` resolves
/// with. Later calls replace nothing: the first outcome wins.
pub fn attach(bridge: Arc<dyn BackendBridge>, info_json: String) {
    readiness().send_if_modified(|state| match state {
        Readiness::Starting => {
            *state = Readiness::Ready { bridge, info_json };
            true
        }
        _ => false,
    });
}

/// Reports a fatal bootstrap error: `ready()` and every pending or later
/// call reject with it.
pub fn fail(error: String) {
    readiness().send_if_modified(|state| match state {
        Readiness::Starting => {
            *state = Readiness::Failed(error);
            true
        }
        _ => false,
    });
}

/// Waits for the bootstrap outcome.
async fn ready_bridge() -> Result<(Arc<dyn BackendBridge>, String), String> {
    let mut receiver = readiness().subscribe();
    loop {
        match &*receiver.borrow_and_update() {
            Readiness::Ready { bridge, info_json } => {
                return Ok((Arc::clone(bridge), info_json.clone()));
            }
            Readiness::Failed(error) => return Err(error.clone()),
            Readiness::Starting => {}
        }
        if receiver.changed().await.is_err() {
            return Err("the backend bootstrap was abandoned".to_string());
        }
    }
}

/// The OpenBitFun backend, linked into this process.
#[module]
pub struct Backend;

#[module]
impl Backend {
    /// Runs one backend command. `argsJson` is the JSON of the args object
    /// Tauri's `invoke(command, args)` received. Resolves with the JSON of the
    /// command's result (`null` for none); rejects with its error text, or
    /// with `unsupported_in_native_host: <command>` for a command this host
    /// cannot run.
    pub async fn invoke(command: String, args_json: String) -> Result<String, String> {
        let (bridge, _) = ready_bridge().await?;
        bridge.invoke(command, args_json).await
    }

    /// Long poll for backend events: resolves, as soon as at least one is
    /// queued, with a JSON array of `{ seq, event, payload }` in emission
    /// order (at most 512). `afterSeq` resumes after that sequence number
    /// (the backend replays a bounded history); without it the module
    /// continues after the last batch it delivered. An empty array means the
    /// backend shut down.
    pub async fn next_events(after_seq: Option<u64>) -> Result<String, String> {
        let (bridge, _) = ready_bridge().await?;
        let mut after = after_seq.unwrap_or_else(|| UI_EVENT_CURSOR.load(Ordering::Acquire));
        loop {
            let batch = bridge.events_after(after, MAX_EVENTS_PER_BATCH).await;
            UI_EVENT_CURSOR.store(batch.last_seq, Ordering::Release);
            if batch.count > 0 {
                return Ok(batch.json);
            }
            if batch.closed {
                return Ok("[]".to_string());
            }
            // A cursor from before a backend restart: continue from the
            // backend's current position instead of reporting shutdown.
            after = batch.last_seq;
        }
    }

    /// Resolves once the backend finished bootstrapping with
    /// `{ version, platform, dataDir }`; rejects with the fatal startup error.
    pub async fn ready() -> Result<String, String> {
        ready_bridge().await.map(|(_, info)| info)
    }

    /// Writes one frontend log line (`error`, `warn`, `info`, `debug`,
    /// `trace`) into the backend log.
    pub async fn log(level: String, message: String) -> Result<(), String> {
        let (bridge, _) = ready_bridge().await?;
        bridge.log(&level, &message);
        Ok(())
    }

    /// The local folder picker. `optionsJson` is
    /// `{ "title": "...", "defaultPath"?: "..." }`; resolves with the JSON of
    /// the chosen absolute path, or `null` when cancelled.
    pub async fn pick_directory(options_json: String) -> Result<String, String> {
        let (bridge, _) = ready_bridge().await?;
        match bridge.pick_directory(options_json) {
            Some(pick) => pick.await,
            None => Err(format!("{UNSUPPORTED_IN_NATIVE_HOST}: pick_directory")),
        }
    }
}

/// The crate's UI set: the `Backend` module.
#[native_module("openbitfun/native")]
fn native(registry: &mut Registry) {
    registry.module::<Backend>();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn module_is_registered() {
        let set = registry();
        assert!(
            set.module_specs().iter().any(|spec| spec.name == "Backend"),
            "Backend module missing"
        );
    }
}

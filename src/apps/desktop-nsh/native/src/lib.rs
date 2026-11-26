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
use std::time::Duration;

use nsh_core::prelude::*;
use tokio::sync::watch;

/// A boxed, sendable future.
pub type BoxFuture<T> = Pin<Box<dyn Future<Output = T> + Send + 'static>>;

/// Most events delivered by one `nextEvents` call.
pub const MAX_EVENTS_PER_BATCH: usize = 512;

/// Initial backoff when `events_after` yields an empty, non-closed batch.
const EMPTY_BATCH_BACKOFF_INITIAL: Duration = Duration::from_millis(50);

/// Maximum backoff for repeated empty, non-closed batches.
const EMPTY_BATCH_BACKOFF_MAX: Duration = Duration::from_millis(500);

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

    /// The local file open/save dialog; `None` when the host has none.
    fn pick_file_dialog(&self, options_json: String) -> Option<BoxFuture<Result<String, String>>> {
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

async fn next_events_from(
    bridge: &dyn BackendBridge,
    cursor: &AtomicU64,
    after_seq: Option<u64>,
) -> String {
    let mut after = after_seq.unwrap_or_else(|| cursor.load(Ordering::Acquire));
    let mut empty_backoff = EMPTY_BATCH_BACKOFF_INITIAL;
    let mut rewound_once = false;
    loop {
        let batch = bridge.events_after(after, MAX_EVENTS_PER_BATCH).await;
        if after_seq.is_none() {
            cursor.fetch_max(batch.last_seq, Ordering::AcqRel);
        }
        if batch.count > 0 {
            return batch.json;
        }
        if batch.closed {
            return "[]".to_string();
        }
        // A stale cursor from before a backend restart rewinds once to the
        // backend's current position; an unchanged or repeated empty
        // non-closed batch backs off instead of spinning.
        if batch.last_seq < after && !rewound_once {
            rewound_once = true;
            after = batch.last_seq;
            continue;
        }
        after = batch.last_seq;
        timer(empty_backoff).await;
        empty_backoff = (empty_backoff * 2).min(EMPTY_BATCH_BACKOFF_MAX);
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
        Ok(next_events_from(bridge.as_ref(), &UI_EVENT_CURSOR, after_seq).await)
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

    /// The local file open/save dialog. `optionsJson` is
    /// `{ "mode": "open" | "save", "title"?: "...", "defaultPath"?: "...", "multiple"?: bool, "directory"?: bool, "filters"?: [{ "name": "...", "extensions": ["..."] }] }`;
    /// resolves with JSON (`string | string[] | null`).
    pub async fn pick_file_dialog(options_json: String) -> Result<String, String> {
        let (bridge, _) = ready_bridge().await?;
        match bridge.pick_file_dialog(options_json) {
            Some(pick) => pick.await,
            None => Err(format!("{UNSUPPORTED_IN_NATIVE_HOST}: pick_file_dialog")),
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
    use std::collections::VecDeque;
    use std::sync::Mutex;
    use std::time::Instant;

    struct FakeBridge {
        batches: Mutex<VecDeque<EventBatch>>,
    }

    impl FakeBridge {
        fn new(batches: Vec<EventBatch>) -> Self {
            Self {
                batches: Mutex::new(batches.into()),
            }
        }
    }

    impl BackendBridge for FakeBridge {
        fn invoke(
            &self,
            _command: String,
            _args_json: String,
        ) -> BoxFuture<Result<String, String>> {
            Box::pin(async { Ok("null".to_string()) })
        }

        fn events_after(&self, after: u64, _max: usize) -> BoxFuture<EventBatch> {
            let next = self
                .batches
                .lock()
                .expect("fake batches lock")
                .pop_front()
                .unwrap_or(EventBatch {
                    json: "[]".to_string(),
                    count: 0,
                    last_seq: after,
                    closed: true,
                });
            Box::pin(async move { next })
        }

        fn log(&self, _level: &str, _message: &str) {}
    }

    #[test]
    fn module_is_registered() {
        let set = registry();
        assert!(
            set.module_specs().iter().any(|spec| spec.name == "Backend"),
            "Backend module missing"
        );
    }

    #[tokio::test]
    async fn explicit_after_seq_does_not_rewind_global_cursor() {
        let cursor = AtomicU64::new(50);
        let bridge = FakeBridge::new(vec![EventBatch {
            json: r#"[{"seq":10,"event":"e","payload":{}}]"#.to_string(),
            count: 1,
            last_seq: 10,
            closed: false,
        }]);
        let json = next_events_from(&bridge, &cursor, Some(5)).await;
        assert!(json.contains("\"seq\":10"));
        assert_eq!(cursor.load(Ordering::Acquire), 50);
    }

    #[tokio::test]
    async fn implicit_cursor_advances_monotonically_with_fetch_max() {
        let cursor = AtomicU64::new(20);
        let bridge = FakeBridge::new(vec![
            EventBatch {
                json: r#"[{"seq":15,"event":"old","payload":{}}]"#.to_string(),
                count: 1,
                last_seq: 15,
                closed: false,
            },
            EventBatch {
                json: r#"[{"seq":35,"event":"new","payload":{}}]"#.to_string(),
                count: 1,
                last_seq: 35,
                closed: false,
            },
        ]);
        let _ = next_events_from(&bridge, &cursor, None).await;
        assert_eq!(cursor.load(Ordering::Acquire), 20);
        let _ = next_events_from(&bridge, &cursor, None).await;
        assert_eq!(cursor.load(Ordering::Acquire), 35);
    }

    #[tokio::test]
    async fn empty_non_closed_batch_backs_off_instead_of_spinning() {
        let cursor = AtomicU64::new(10);
        let bridge = FakeBridge::new(vec![
            EventBatch {
                json: "[]".to_string(),
                count: 0,
                last_seq: 10,
                closed: false,
            },
            EventBatch {
                json: r#"[{"seq":11,"event":"after-backoff","payload":{}}]"#.to_string(),
                count: 1,
                last_seq: 11,
                closed: false,
            },
        ]);
        let started = Instant::now();
        let json = next_events_from(&bridge, &cursor, None).await;
        assert!(json.contains("after-backoff"));
        assert!(
            started.elapsed() >= Duration::from_millis(40),
            "expected backoff before retry, elapsed={:?}",
            started.elapsed()
        );
        assert_eq!(cursor.load(Ordering::Acquire), 11);
    }
}

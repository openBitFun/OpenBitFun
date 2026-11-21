//! The Inbox of one entry (`fleet_attention`, `fleet_attention_mark_read`):
//! the attention projection (`product_domains::fleet::attention`) over this
//! host's fleet index, the account's cloud-agent jobs, and the read state
//! the entry keeps for its clients.
//!
//! - The prompts and failed sessions come from the index (every device's
//!   partition), so they are as fresh as the replication.
//! - The cloud agent's jobs come from the cloud node (`superagent_status`,
//!   its `workingNow` lists) when the index holds the node and it accepts
//!   calls; a read is reused for a few seconds, and a failed read keeps the
//!   last good one.
//! - The view's revision moves only when its content does (ages excluded),
//!   and every move is published as `fleet://attention-changed {revision}`
//!   on the host's event stream, so clients re-read instead of polling.
//! - Read state is per entry: `mark_read {revision}` marks the Done and
//!   Failed items of the view served at that revision, so an item that
//!   arrived after the client looked stays unread. It is kept in memory
//!   (bounded); a restarted entry shows recent Done and Failed items again
//!   rather than hiding something the user never saw.

use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, VecDeque};
use std::hash::{Hash, Hasher};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use openbitfun_product_domains::fleet::*;
use openbitfun_product_domains::superagent::JobCard;
use serde_json::{json, Value};

use super::index::FleetIndex;
use super::sync::FleetPeerTransport;
use super::FleetEventSink;

/// The Inbox verbs (`PeerStance::FleetEntry`).
pub const FLEET_ATTENTION_COMMANDS: &[&str] = &["fleet_attention", "fleet_attention_mark_read"];

/// How long one read of the cloud node's jobs is reused.
const CLOUD_TTL: Duration = Duration::from_secs(5);
/// How long the cloud node may take to answer.
const CLOUD_TIMEOUT: Duration = Duration::from_secs(3);
/// Served views remembered for `mark_read`.
const SERVED_VIEWS: usize = 16;
/// Read marks kept (oldest dropped first).
const READ_MAX: usize = 4096;

#[derive(Default)]
struct State {
    revision: u64,
    content: Option<u64>,
    jobs: Vec<AttentionJob>,
    jobs_at: Option<Instant>,
    read: HashMap<String, u64>,
    read_order: VecDeque<String>,
    served: VecDeque<(u64, Vec<(String, u64)>)>,
}

/// The Inbox of one fleet host.
pub struct FleetAttention {
    index: Arc<FleetIndex>,
    peers: Arc<dyn FleetPeerTransport>,
    sink: Option<Arc<dyn FleetEventSink>>,
    state: Mutex<State>,
}

fn content_hash(projection: &AttentionProjection) -> u64 {
    let mut groups = projection.groups.clone();
    for item in groups.iter_mut().flat_map(|group| group.items.iter_mut()) {
        item.age_ms = None;
    }
    let mut hasher = DefaultHasher::new();
    serde_json::to_string(&groups)
        .unwrap_or_default()
        .hash(&mut hasher);
    projection.badge.hash(&mut hasher);
    // A newer failure of the same session looks alike but is a new item.
    projection.readable.hash(&mut hasher);
    hasher.finish()
}

/// The cards of a `superagent_status` answer the entry keeps: the
/// `workingNow.needsYou` and `working` lists, and `done` / `failed` lists
/// when the node sends them (read tolerantly; anything else is ignored).
/// The Inbox shows the blocked, done and failed ones; the device page
/// (`fleet_device_detail`) the queued and blocked ones of its device.
pub fn attention_jobs_of_status(status: &Value) -> Vec<AttentionJob> {
    let lists = &status["workingNow"];
    ["needsYou", "working", "done", "failed"]
        .iter()
        .filter_map(|key| lists.get(*key).and_then(Value::as_array))
        .flatten()
        .filter_map(AttentionJob::from_value)
        .collect()
}

impl FleetAttention {
    pub fn new(
        index: Arc<FleetIndex>,
        peers: Arc<dyn FleetPeerTransport>,
        sink: Option<Arc<dyn FleetEventSink>>,
    ) -> Arc<Self> {
        Arc::new(Self {
            index,
            peers,
            sink,
            state: Mutex::new(State {
                // From the clock, so a revision from an earlier process is
                // never mistaken for one of this process.
                revision: crate::now_ms(),
                ..State::default()
            }),
        })
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// Answers an Inbox verb; `None` for any other command.
    pub async fn handle(&self, command: &str, args: &Value) -> Option<Result<Value, String>> {
        let request = args.get("request").cloned().unwrap_or(Value::Null);
        let result = match command {
            "fleet_attention" => {
                let _: FleetAttentionRequest = match parse(request) {
                    Ok(request) => request,
                    Err(error) => return Some(Err(error)),
                };
                serde_json::to_value(self.view().await).map_err(|error| error.to_string())
            }
            "fleet_attention_mark_read" => match parse::<FleetAttentionMarkReadRequest>(request) {
                Ok(request) => serde_json::to_value(self.mark_read(request.revision))
                    .map_err(|error| error.to_string()),
                Err(error) => Err(error),
            },
            _ => return None,
        };
        Some(result)
    }

    /// `fleet_attention`: the whole view, the cloud node's jobs refreshed.
    pub async fn view(&self) -> FleetAttentionView {
        self.refresh_cloud().await;
        self.project(true)
    }

    /// The cloud agent's job cards, refreshed like `fleet_attention` reads
    /// them (reused for a few seconds; a failed read keeps the last good one).
    pub async fn cloud_jobs(&self) -> Vec<JobCard> {
        self.refresh_cloud().await;
        self.lock()
            .jobs
            .iter()
            .map(|job| job.card.clone())
            .collect()
    }

    /// The index changed: re-project with the jobs held, and publish when
    /// the content moved.
    pub fn local_changed(&self) {
        self.project(false);
    }

    /// `fleet_attention_mark_read {revision}`.
    pub fn mark_read(&self, revision: u64) -> FleetAttentionMarkReadResponse {
        let marked = {
            let mut state = self.lock();
            let items = state
                .served
                .iter()
                .rev()
                .find(|(served, _)| *served <= revision)
                .map(|(_, items)| items.clone())
                .unwrap_or_default();
            let mut marked = 0u32;
            for (item, stamp) in items {
                let newer = state.read.get(&item).is_none_or(|held| *held < stamp);
                if newer {
                    if state.read.insert(item.clone(), stamp).is_none() {
                        state.read_order.push_back(item);
                    }
                    marked += 1;
                }
            }
            while state.read_order.len() > READ_MAX {
                if let Some(oldest) = state.read_order.pop_front() {
                    state.read.remove(&oldest);
                }
            }
            marked
        };
        let view = self.project(false);
        FleetAttentionMarkReadResponse {
            revision: view.revision,
            marked,
        }
    }

    fn cloud_target(&self) -> Option<String> {
        self.index
            .navigator(None)
            .devices
            .into_iter()
            .find(|device| device.host_kind == FleetHostKind::Cloud)
            .filter(|device| device.state.accepts_calls())
            .map(|device| device.device_id)
    }

    async fn refresh_cloud(&self) {
        let Some(target) = self.cloud_target() else {
            let mut state = self.lock();
            state.jobs.clear();
            state.jobs_at = None;
            return;
        };
        let fresh = self
            .lock()
            .jobs_at
            .is_some_and(|at| at.elapsed() < CLOUD_TTL);
        if fresh {
            return;
        }
        let answer = tokio::time::timeout(
            CLOUD_TIMEOUT,
            self.peers
                .call(&target, "superagent_status", json!({ "request": {} })),
        )
        .await;
        let mut state = self.lock();
        match answer {
            Ok(Ok(status)) => {
                state.jobs = attention_jobs_of_status(&status);
                state.jobs_at = Some(Instant::now());
            }
            Ok(Err(error)) => {
                log::debug!("Inbox kept the last cloud jobs: error={}", error.message);
                state.jobs_at = Some(Instant::now());
            }
            Err(_) => log::debug!("Inbox kept the last cloud jobs: the cloud node timed out"),
        }
    }

    fn project(&self, record_served: bool) -> FleetAttentionView {
        let navigator = self.index.navigator(None);
        let prompts = self.index.prompts();
        let (view, changed) = {
            let mut state = self.lock();
            let inputs = AttentionInputs {
                devices: &navigator.devices,
                prompts: &prompts.prompts,
                jobs: &state.jobs,
                now_ms: crate::now_ms(),
            };
            let read = &state.read;
            let projection = project_attention(&inputs, &|item, stamp| {
                read.get(item).is_some_and(|held| *held >= stamp)
            });
            let content = content_hash(&projection);
            let changed = state.content != Some(content);
            if changed {
                state.revision += 1;
                state.content = Some(content);
            }
            let revision = state.revision;
            if record_served
                && state
                    .served
                    .back()
                    .is_none_or(|(served, _)| *served != revision)
            {
                state
                    .served
                    .push_back((revision, projection.readable.clone()));
                while state.served.len() > SERVED_VIEWS {
                    state.served.pop_front();
                }
            }
            (
                FleetAttentionView {
                    revision,
                    groups: projection.groups,
                    badge: projection.badge,
                },
                changed,
            )
        };
        if changed {
            if let Some(sink) = &self.sink {
                sink.emit(
                    FLEET_ATTENTION_CHANGED_EVENT,
                    json!({ "revision": view.revision }),
                );
            }
        }
        view
    }
}

fn parse<T: serde::de::DeserializeOwned + Default>(request: Value) -> Result<T, String> {
    if request.is_null() {
        return Ok(T::default());
    }
    serde_json::from_value(request).map_err(|error| format!("invalid fleet request: {error}"))
}

#[cfg(test)]
#[path = "attention_tests.rs"]
mod tests;

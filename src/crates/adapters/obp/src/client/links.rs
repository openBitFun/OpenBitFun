//! The peer links of one runtime host: one authenticated `account-device`
//! OBP connection per other device of the account, kept open, resumed after a
//! drop, and shared by every user of this backend.
//!
//! Two kinds of users hold a link:
//!
//! - Peer Device Mode (the desktop's `peer_link_*` commands): a UI drives
//!   another device. The link carries the peer's whole event stream and is
//!   closed after five minutes without a call or a poll.
//! - The fleet layer: an entry keeps an index-only link to every peer
//!   (`connect_index`, hello `events: {prefixes: ["fleet://"]}`), pinned
//!   until released, and widens it to the whole stream while a client follows
//!   the device (`set_followed`).
//!
//! A link reaches its device through a [`PeerConnector`] (the host's Link
//! runtime; a test dialer in tests), so the same pool serves the desktop and
//! the CLI.
//!
//! Interest changes (a client follows or stops following the device) are
//! make-before-break: the link opens the connection with the new filter while
//! the current one keeps serving calls, moves new calls to it, and closes the
//! old one once the calls it carries have answered. A call in flight is never
//! dropped by a follow or unfollow.
//!
//! Resume: the link keeps the peer events it took in a bounded ring (4,096
//! events / 16 MiB) and, when the connection drops or its interest changes,
//! reconnects with `lastSeq` + `instanceId`, so the peer replays the gap. A
//! cursor that fell out of the ring, or that belongs to an earlier instance of
//! the peer backend, gets a synthetic `backend://events-dropped` first and
//! re-hydrates through commands. A peer that ignores the prefix filter (older
//! builds do not know it) is filtered here, so an index-only link never holds
//! transcripts.
//!
//! Remote scenarios: this is the Peer Device Mode and fleet data plane over
//! the account device network. It never uses the old relay transport.

use std::collections::{HashMap, HashSet, VecDeque};
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};
use tokio::sync::{watch, Notify};

use super::{MeshCallError, MeshCaller, MeshConnectOptions, MeshObpConnection, MeshObpEvent};
use crate::events::{BackendEvent, EVENTS_DROPPED_EVENT};

/// Peer events kept per link (count bound).
pub const RING_EVENTS: usize = 4096;
/// Peer events kept per link (byte bound, payload JSON).
pub const RING_BYTES: usize = 16 * 1024 * 1024;
/// The event-name prefix of an index-only link.
pub const INDEX_EVENT_PREFIX: &str = "fleet://";
/// The event window a link asks the peer for.
const LINK_CREDIT_BYTES: u64 = 4 * 1024 * 1024;
/// Longest long poll.
const MAX_WAIT: Duration = Duration::from_secs(25);
/// A Peer Device Mode hold nobody polled or called for this long is released.
const IDLE_CLOSE: Duration = Duration::from_secs(5 * 60);
const BACKOFF_FIRST: Duration = Duration::from_millis(300);
/// The longest a replaced connection stays open for the calls it carries.
const DRAIN_MAX: Duration = Duration::from_secs(120);
const BACKOFF_MAX: Duration = Duration::from_secs(10);

/// A boxed connect future.
pub type ConnectFuture =
    Pin<Box<dyn Future<Output = Result<MeshObpConnection, String>> + Send + 'static>>;

/// How a link reaches a device (the host's Link runtime; a test dialer in
/// tests).
pub trait PeerConnector: Send + Sync + 'static {
    fn connect(&self, device_id: String, options: MeshConnectOptions) -> ConnectFuture;
    /// `(path, latency_ms)` of the device in the mesh route table.
    fn route(&self, device_id: &str) -> Option<(String, Option<f64>)>;
}

/// Where a link stands.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LinkState {
    Connected,
    Reconnecting,
    Closed,
}

/// What a link carries: fleet events only, or the peer's whole stream.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LinkInterest {
    Index,
    Full,
}

/// What `peer_link_connect` answers.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerLinkInfo {
    pub device_id: String,
    /// Always `mesh`: the transport this link uses.
    pub transport: &'static str,
    pub state: LinkState,
    pub scope: Value,
    pub capabilities: Vec<String>,
    /// The registry peer-host capabilities the peer serves (its hello's
    /// `hostCapabilities`; empty for a peer that does not send them).
    pub host_capabilities: Vec<String>,
    /// What kind of host the peer is (its hello's `hostKind`: `desktop`, `cli`);
    /// absent for a peer that does not say, which is a desktop host.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host_kind: Option<String>,
    pub protocol: Value,
    pub backend: Value,
    pub registry_digest: Value,
    /// `p2p` or `relayed` (Link route), when known.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mesh_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latency_ms: Option<f64>,
}

/// What `peer_link_events` answers.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerEventsBatch {
    /// The peer backend instance the events belong to.
    pub instance_id: Option<String>,
    pub state: LinkState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// `{seq, event, payload}` exactly as the peer sent them; a synthetic
    /// `backend://events-dropped` (no `seq`) leads when the cursor is gone.
    pub events: Vec<Value>,
}

/// What a link's ring holds for one cursor (the fleet mux reads it).
#[cfg_attr(not(feature = "fleet"), allow(dead_code))]
#[derive(Debug, Clone)]
pub(crate) enum OriginRead {
    /// No link, or no connection adopted yet.
    Unknown,
    /// The peer runs another backend instance than the cursor's.
    InstanceChanged {
        instance: String,
        /// The newest peer `seq` the link took.
        newest: u64,
    },
    /// The cursor is older than the complete part of the ring.
    Gap {
        instance: String,
        /// The first `seq` the ring still holds completely.
        resume_seq: u64,
    },
    /// Events after the cursor (possibly none).
    Events {
        instance: String,
        events: Vec<Arc<BackendEvent>>,
    },
}

struct Ring {
    instance_id: Option<String>,
    events: VecDeque<(Arc<BackendEvent>, usize)>,
    bytes: usize,
    /// Newest peer `seq` the link took, kept or filtered (its resume cursor).
    last_seq: Option<u64>,
    /// The peer's newest `seq` when this instance's first connection opened
    /// (where the link started reading, before any event arrived).
    start_seq: Option<u64>,
    /// The ring holds the peer's whole stream after this `seq`; `None` while
    /// the link is index-only.
    full_after: Option<u64>,
}

impl Ring {
    fn new() -> Self {
        Self {
            instance_id: None,
            events: VecDeque::new(),
            bytes: 0,
            last_seq: None,
            start_seq: None,
            full_after: None,
        }
    }

    fn push(&mut self, event: MeshObpEvent) {
        let size = event.event.len() + event.payload.to_string().len() + 32;
        self.last_seq = Some(event.seq);
        self.events.push_back((
            Arc::new(BackendEvent {
                seq: event.seq,
                event: event.event,
                payload: event.payload,
            }),
            size,
        ));
        self.bytes += size;
        while self.events.len() > RING_EVENTS || (self.bytes > RING_BYTES && self.events.len() > 1)
        {
            if let Some((_, dropped)) = self.events.pop_front() {
                self.bytes -= dropped;
            }
        }
    }

    /// A new peer backend instance: its `seq` restarted, the old history is gone.
    fn reset(&mut self, instance_id: Option<String>) {
        self.instance_id = instance_id;
        self.events.clear();
        self.bytes = 0;
        self.last_seq = None;
        self.start_seq = None;
        self.full_after = None;
    }

    /// The newest peer `seq` this link has read up to.
    fn position(&self) -> Option<u64> {
        self.last_seq.or(self.start_seq)
    }

    fn oldest_seq(&self) -> Option<u64> {
        self.events.front().map(|(event, _)| event.seq)
    }

    /// Events after `after`, or `None` when the cursor fell out of the ring.
    fn after(&self, after: Option<u64>) -> Option<Vec<Value>> {
        let Some(after) = after else {
            return Some(self.events.iter().map(|(event, _)| wire(event)).collect());
        };
        if let Some(oldest) = self.oldest_seq() {
            if after.saturating_add(1) < oldest {
                return None;
            }
        }
        Some(
            self.events
                .iter()
                .filter(|(event, _)| event.seq > after)
                .map(|(event, _)| wire(event))
                .collect(),
        )
    }

    fn all(&self) -> Vec<Value> {
        self.events.iter().map(|(event, _)| wire(event)).collect()
    }

    /// The first `seq` after which the ring is the complete stream.
    #[cfg_attr(not(feature = "fleet"), allow(dead_code))]
    fn complete_from(&self) -> Option<u64> {
        let full_after = self.full_after?;
        let oldest = self.oldest_seq().map_or(full_after, |oldest| oldest - 1);
        Some(full_after.max(oldest))
    }

    #[cfg_attr(not(feature = "fleet"), allow(dead_code))]
    fn read(&self, instance: &str, after: u64, max: usize) -> OriginRead {
        let Some(current) = self.instance_id.clone() else {
            return OriginRead::Unknown;
        };
        let newest = self.position().unwrap_or(0);
        if current != instance {
            return OriginRead::InstanceChanged {
                instance: current,
                newest,
            };
        }
        if after < newest {
            match self.complete_from() {
                Some(complete) if after >= complete => {}
                Some(complete) => {
                    return OriginRead::Gap {
                        instance: current,
                        resume_seq: complete + 1,
                    }
                }
                None => {
                    return OriginRead::Gap {
                        instance: current,
                        resume_seq: newest + 1,
                    }
                }
            }
        }
        let events = self
            .events
            .iter()
            .filter(|(event, _)| event.seq > after)
            .take(max.max(1))
            .map(|(event, _)| Arc::clone(event))
            .collect();
        OriginRead::Events {
            instance: current,
            events,
        }
    }
}

fn wire(event: &BackendEvent) -> Value {
    json!({ "seq": event.seq, "event": event.event, "payload": event.payload })
}

fn dropped(reason: &str, after: Option<u64>, resume: Option<u64>) -> Value {
    json!({
        "event": EVENTS_DROPPED_EVENT,
        "payload": { "reason": reason, "afterSeq": after, "resumeSeq": resume },
    })
}

fn instance_of(hello: &Value) -> Option<String> {
    hello["backend"]["instanceId"].as_str().map(str::to_string)
}

/// Who keeps a link open.
#[derive(Debug, Default, Clone, Copy)]
struct Holds {
    /// Peer Device Mode (released when idle).
    driven: bool,
    /// The fleet index subscription (pinned).
    index: bool,
    /// A fleet client follows the device.
    followed: bool,
    /// Ad-hoc RPC call (index-level interest, released when idle).
    rpc: bool,
}

impl Holds {
    fn interest(self) -> Option<LinkInterest> {
        if self.driven || self.followed {
            Some(LinkInterest::Full)
        } else if self.index || self.rpc {
            Some(LinkInterest::Index)
        } else {
            None
        }
    }
}

#[derive(Debug, Clone, Copy)]
enum Hold {
    Driven,
    Index,
    Rpc,
}

/// The calls running on one connection of a link.
#[derive(Default)]
struct InFlight {
    count: AtomicUsize,
    idle: Notify,
}

impl InFlight {
    fn enter(self: &Arc<Self>) -> CallGuard {
        self.count.fetch_add(1, Ordering::AcqRel);
        CallGuard(Arc::clone(self))
    }

    /// Waits until no call runs on the connection.
    async fn wait_idle(&self) {
        loop {
            let idle = self.idle.notified();
            tokio::pin!(idle);
            idle.as_mut().enable();
            if self.count.load(Ordering::Acquire) == 0 {
                return;
            }
            idle.await;
        }
    }
}

struct CallGuard(Arc<InFlight>);

impl Drop for CallGuard {
    fn drop(&mut self) {
        if self.0.count.fetch_sub(1, Ordering::AcqRel) == 1 {
            self.0.idle.notify_waiters();
        }
    }
}

/// The caller of a link's current connection, with its running calls.
#[derive(Clone)]
struct LinkCaller {
    caller: MeshCaller,
    in_flight: Arc<InFlight>,
}

struct LinkShared {
    device_id: String,
    ring: Mutex<Ring>,
    arrived: Notify,
    arrivals: Arc<watch::Sender<u64>>,
    caller: Mutex<Option<LinkCaller>>,
    hello: Mutex<Value>,
    state: Mutex<(LinkState, Option<String>)>,
    closing: watch::Sender<bool>,
    holds: Mutex<Holds>,
    interest: watch::Sender<LinkInterest>,
    /// The connection is index-only and the peer did not apply the filter.
    filter_here: Mutex<bool>,
    touched: Mutex<Instant>,
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn options_for(interest: LinkInterest, ring: &Ring) -> MeshConnectOptions {
    MeshConnectOptions {
        last_seq: ring.position(),
        instance_id: ring.instance_id.clone(),
        credit_bytes: Some(LINK_CREDIT_BYTES),
        event_prefixes: (interest == LinkInterest::Index)
            .then(|| vec![INDEX_EVENT_PREFIX.to_string()]),
        fleet: None,
    }
}

/// Whether a hello answer confirms the prefix filter.
fn filter_applied(hello: &Value) -> bool {
    hello["events"]["prefixes"]
        .as_array()
        .is_some_and(|prefixes| {
            prefixes
                .iter()
                .any(|prefix| prefix.as_str() == Some(INDEX_EVENT_PREFIX))
        })
}

impl LinkShared {
    fn touch(&self) {
        *lock(&self.touched) = Instant::now();
    }

    fn set_state(&self, state: LinkState, error: Option<String>) {
        *lock(&self.state) = (state, error);
        self.arrived.notify_waiters();
        self.arrivals
            .send_modify(|count| *count = count.wrapping_add(1));
    }

    fn state(&self) -> (LinkState, Option<String>) {
        lock(&self.state).clone()
    }

    /// Applies a hold change; returns whether anyone still holds the link.
    fn update_holds(&self, change: impl FnOnce(&mut Holds)) -> bool {
        let interest = {
            let mut holds = lock(&self.holds);
            change(&mut holds);
            holds.interest()
        };
        match interest {
            Some(interest) => {
                self.interest.send_if_modified(|current| {
                    let changed = *current != interest;
                    *current = interest;
                    changed
                });
                true
            }
            None => false,
        }
    }

    /// Takes a fresh connection: records its hello and caller, and resets the
    /// ring when the peer backend restarted. `resumed_after` is the cursor
    /// the connection was opened with.
    fn adopt(
        &self,
        connection: &MeshObpConnection,
        interest: LinkInterest,
        resumed_after: Option<u64>,
    ) {
        let hello = connection.hello().clone();
        let instance = instance_of(&hello);
        {
            let mut ring = lock(&self.ring);
            let same_instance = ring.instance_id == instance;
            if !same_instance {
                if ring.instance_id.is_some() {
                    log::info!(
                        "Peer backend restarted; peer event history reset: device={}",
                        self.device_id
                    );
                }
                ring.reset(instance);
            }
            if ring.position().is_none() {
                ring.start_seq = hello["lastSeq"].as_u64();
            }
            match interest {
                LinkInterest::Index => ring.full_after = None,
                LinkInterest::Full => {
                    if ring.full_after.is_none() {
                        let start = match resumed_after {
                            Some(after) if same_instance => after,
                            _ => hello["lastSeq"].as_u64().unwrap_or(0),
                        };
                        ring.full_after = Some(start);
                    }
                }
            }
        }
        *lock(&self.filter_here) = interest == LinkInterest::Index && !filter_applied(&hello);
        *lock(&self.hello) = hello;
        *lock(&self.caller) = Some(LinkCaller {
            caller: connection.caller(),
            in_flight: Arc::new(InFlight::default()),
        });
        self.set_state(LinkState::Connected, None);
    }

    fn push(&self, event: MeshObpEvent) {
        {
            let mut ring = lock(&self.ring);
            let keep = !*lock(&self.filter_here)
                || event.event.starts_with(INDEX_EVENT_PREFIX)
                || event.event == EVENTS_DROPPED_EVENT;
            if keep {
                ring.push(event);
            } else {
                ring.last_seq = Some(event.seq);
                return;
            }
        }
        self.arrived.notify_waiters();
        self.arrivals
            .send_modify(|count| *count = count.wrapping_add(1));
    }
}

/// One linked device.
struct PeerLink {
    shared: Arc<LinkShared>,
    task: tokio::task::JoinHandle<()>,
}

/// The peer links of this backend.
pub struct PeerLinks {
    connector: Arc<dyn PeerConnector>,
    links: tokio::sync::Mutex<HashMap<String, PeerLink>>,
    arrivals: Arc<watch::Sender<u64>>,
    /// Devices a fleet client follows (applied when their link opens).
    followed: Mutex<HashSet<String>>,
}

fn map_call_error(device_id: &str, error: MeshCallError) -> String {
    if error.code == 0 && error.message.starts_with("peer_") {
        // Already a link-state text.
        error.message
    } else if error.code == 0 {
        // Transport: the mesh connection went away during the call.
        format!(
            "peer_unreachable: device {device_id} did not answer over the mesh: {}",
            error.message
        )
    } else {
        // The peer backend's own refusal or failure text, unchanged.
        error.message
    }
}

enum Ended {
    Closed,
    Lost,
    Interest,
}

async fn pump(
    shared: Arc<LinkShared>,
    connector: Arc<dyn PeerConnector>,
    mut connection: MeshObpConnection,
) {
    let mut closing = shared.closing.subscribe();
    let mut interest = shared.interest.subscribe();
    interest.borrow_and_update();
    loop {
        // Read the current connection until it ends, the link closes, or
        // what it should carry changes.
        let ended = loop {
            tokio::select! {
                event = connection.next_event() => match event {
                    Some(event) => {
                        let restarted_note = event.event == EVENTS_DROPPED_EVENT
                            && event.payload["reason"] == "backend_restarted";
                        // The ring was already reset for a new instance; the
                        // peer's own restart notice would only repeat it.
                        if restarted_note && lock(&shared.ring).last_seq.is_none() {
                            continue;
                        }
                        shared.push(event);
                    }
                    None => break Ended::Lost,
                },
                _ = closing.changed() => break Ended::Closed,
                changed = interest.changed() => {
                    if changed.is_err() { break Ended::Closed; }
                    break Ended::Interest;
                }
            }
        };
        if matches!(ended, Ended::Interest) && !*closing.borrow() {
            match switch(&shared, &connector, &mut interest, &mut closing).await {
                Switch::Done(next, in_flight) => {
                    let old = std::mem::replace(&mut connection, next);
                    tokio::spawn(async move {
                        if let Some(in_flight) = in_flight {
                            let _ = tokio::time::timeout(DRAIN_MAX, in_flight.wait_idle()).await;
                        }
                        old.close().await;
                    });
                    continue;
                }
                Switch::Closed => {
                    *lock(&shared.caller) = None;
                    connection.close().await;
                    shared.set_state(LinkState::Closed, None);
                    return;
                }
                // The new connection failed: the old path (close, reconnect).
                Switch::Failed => {}
            }
        }
        *lock(&shared.caller) = None;
        if matches!(ended, Ended::Closed) || *closing.borrow() {
            connection.close().await;
            shared.set_state(LinkState::Closed, None);
            return;
        }
        if matches!(ended, Ended::Interest) {
            connection.close().await;
            log::info!(
                "Peer link interest changed; reconnecting: device={}, interest={:?}",
                shared.device_id,
                *interest.borrow()
            );
        } else {
            drop(connection);
            log::info!(
                "Peer link lost; reconnecting over the mesh: device={}",
                shared.device_id
            );
        }
        shared.set_state(
            LinkState::Reconnecting,
            Some(format!(
                "peer_reconnecting: the mesh connection to device {} dropped; reconnecting",
                shared.device_id
            )),
        );
        // Reconnect with the resume cursor until it works or the link closes.
        let mut backoff = BACKOFF_FIRST;
        let (adopted, wanted, resumed_after) = loop {
            let wanted = *interest.borrow_and_update();
            let options = options_for(wanted, &lock(&shared.ring));
            let resumed_after = options.last_seq;
            let attempt = connector.connect(shared.device_id.clone(), options);
            tokio::select! {
                result = attempt => match result {
                    Ok(connection) => break (connection, wanted, resumed_after),
                    Err(error) => {
                        log::warn!(
                            "Peer link reconnect failed: device={}, error={}",
                            shared.device_id,
                            error
                        );
                        shared.set_state(LinkState::Reconnecting, Some(error));
                    }
                },
                _ = closing.changed() => {
                    shared.set_state(LinkState::Closed, None);
                    return;
                }
            }
            tokio::select! {
                _ = tokio::time::sleep(backoff) => {}
                _ = closing.changed() => {
                    shared.set_state(LinkState::Closed, None);
                    return;
                }
            }
            backoff = (backoff * 2).min(BACKOFF_MAX);
        };
        connection = adopted;
        shared.adopt(&connection, wanted, resumed_after);
        log::info!("Peer link resumed: device={}", shared.device_id);
    }
}

enum Switch {
    /// The new connection, and the running calls of the one it replaced.
    Done(MeshObpConnection, Option<Arc<InFlight>>),
    Closed,
    Failed,
}

/// Opens the connection for the link's new interest while the current one
/// keeps serving calls; on success new calls go to the new connection.
async fn switch(
    shared: &Arc<LinkShared>,
    connector: &Arc<dyn PeerConnector>,
    interest: &mut watch::Receiver<LinkInterest>,
    closing: &mut watch::Receiver<bool>,
) -> Switch {
    let wanted = *interest.borrow_and_update();
    // Events the old connection still holds are not taken any more: the new
    // one replays everything after this cursor.
    let options = options_for(wanted, &lock(&shared.ring));
    let resumed_after = options.last_seq;
    tokio::select! {
        result = connector.connect(shared.device_id.clone(), options) => match result {
            Ok(next) => {
                let previous = lock(&shared.caller)
                    .as_ref()
                    .map(|current| Arc::clone(&current.in_flight));
                shared.adopt(&next, wanted, resumed_after);
                log::info!(
                    "Peer link switched without dropping calls: device={}, interest={:?}",
                    shared.device_id,
                    wanted
                );
                Switch::Done(next, previous)
            }
            Err(error) => {
                log::warn!(
                    "Peer link switch failed; reconnecting: device={}, error={}",
                    shared.device_id,
                    error
                );
                Switch::Failed
            }
        },
        _ = closing.changed() => Switch::Closed,
    }
}

impl PeerLinks {
    pub fn new(connector: Arc<dyn PeerConnector>) -> Arc<Self> {
        let links = Arc::new(Self {
            connector,
            links: tokio::sync::Mutex::new(HashMap::new()),
            arrivals: Arc::new(watch::channel(0).0),
            followed: Mutex::new(HashSet::new()),
        });
        let weak = Arc::downgrade(&links);
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(30)).await;
                let Some(links) = weak.upgrade() else { return };
                links.close_idle(IDLE_CLOSE).await;
            }
        });
        links
    }

    /// Releases idle-expirable holds (`driven` and `rpc`) nobody used for
    /// `idle`, closing links nobody else holds.
    async fn close_idle(&self, idle: Duration) {
        let mut links = self.links.lock().await;
        let stale: Vec<String> = links
            .iter()
            .filter(|(_, link)| {
                let holds = *lock(&link.shared.holds);
                (holds.driven || holds.rpc) && lock(&link.shared.touched).elapsed() > idle
            })
            .map(|(id, _)| id.clone())
            .collect();
        for id in stale {
            let Some(link) = links.get(&id) else { continue };
            if link.shared.update_holds(|holds| {
                holds.driven = false;
                holds.rpc = false;
            }) {
                continue;
            }
            if let Some(link) = links.remove(&id) {
                log::info!("Peer link idle; closing: device={}", id);
                link.shared.closing.send_replace(true);
                drop(link.task);
            }
        }
    }

    fn info(&self, shared: &LinkShared) -> PeerLinkInfo {
        let hello = lock(&shared.hello).clone();
        let route = self.connector.route(&shared.device_id);
        let strings = |value: &Value| -> Vec<String> {
            value
                .as_array()
                .map(|items| {
                    items
                        .iter()
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default()
        };
        PeerLinkInfo {
            device_id: shared.device_id.clone(),
            transport: "mesh",
            state: shared.state().0,
            scope: hello["scope"].clone(),
            capabilities: strings(&hello["capabilities"]),
            host_capabilities: strings(&hello["hostCapabilities"]),
            host_kind: hello["hostKind"].as_str().map(str::to_string),
            protocol: hello["protocol"].clone(),
            backend: hello["backend"].clone(),
            registry_digest: hello["registryDigest"].clone(),
            mesh_path: route.as_ref().map(|(path, _)| path.clone()),
            latency_ms: route.and_then(|(_, latency)| latency),
        }
    }

    /// Opens (or reuses) the link to `device_id` for Peer Device Mode: the
    /// peer's whole event stream, released after five idle minutes.
    pub async fn connect(&self, device_id: &str) -> Result<PeerLinkInfo, String> {
        self.open(device_id, Hold::Driven).await
    }

    /// Opens (or reuses) the fleet index link to `device_id`: fleet events
    /// only (unless the device is driven or followed), never idle-closed
    /// until [`Self::release_index`].
    pub async fn connect_index(&self, device_id: &str) -> Result<PeerLinkInfo, String> {
        self.open(device_id, Hold::Index).await
    }

    /// Opens (or reuses) an ad-hoc RPC link to `device_id`: index-level event
    /// interest that is automatically released after five idle minutes unless
    /// another hold (`index`, `followed`, `driven`) keeps it alive.
    pub async fn connect_rpc(&self, device_id: &str) -> Result<PeerLinkInfo, String> {
        self.open(device_id, Hold::Rpc).await
    }

    async fn open(&self, device_id: &str, hold: Hold) -> Result<PeerLinkInfo, String> {
        if !openbitfun_link::handshake::valid_device_id(device_id) {
            return Err(format!("peer_link: invalid device id {device_id:?}"));
        }
        let apply = |holds: &mut Holds| match hold {
            Hold::Driven => holds.driven = true,
            Hold::Index => holds.index = true,
            Hold::Rpc => holds.rpc = true,
        };
        {
            let mut links = self.links.lock().await;
            if let Some(link) = links.get(device_id) {
                if link.shared.state().0 != LinkState::Closed {
                    link.shared.update_holds(apply);
                    link.shared.touch();
                    return Ok(self.info(&link.shared));
                }
                links.remove(device_id);
            }
        }
        let mut holds = Holds {
            followed: lock(&self.followed).contains(device_id),
            ..Holds::default()
        };
        apply(&mut holds);
        let interest = holds.interest().unwrap_or(LinkInterest::Full);
        // Connect without holding the table: other links keep answering.
        let connection = self
            .connector
            .connect(device_id.to_string(), options_for(interest, &Ring::new()))
            .await?;
        let shared = Arc::new(LinkShared {
            device_id: device_id.to_string(),
            ring: Mutex::new(Ring::new()),
            arrived: Notify::new(),
            arrivals: Arc::clone(&self.arrivals),
            caller: Mutex::new(None),
            hello: Mutex::new(Value::Null),
            state: Mutex::new((LinkState::Connected, None)),
            closing: watch::channel(false).0,
            holds: Mutex::new(holds),
            interest: watch::channel(interest).0,
            filter_here: Mutex::new(false),
            touched: Mutex::new(Instant::now()),
        });
        shared.adopt(&connection, interest, None);
        let mut links = self.links.lock().await;
        if let Some(existing) = links.get(device_id) {
            // A concurrent connect won the race; keep its link and close the
            // duplicate outside `self.links` so other peers are never stalled.
            if existing.shared.state().0 != LinkState::Closed {
                existing.shared.update_holds(apply);
                existing.shared.touch();
                let info = self.info(&existing.shared);
                drop(links);
                connection.close().await;
                return Ok(info);
            }
        }
        let task = tokio::spawn(pump(
            Arc::clone(&shared),
            Arc::clone(&self.connector),
            connection,
        ));
        log::info!(
            "Peer link opened over the mesh: device={}, interest={:?}",
            device_id,
            interest
        );
        let info = self.info(&shared);
        if let Some(stale) = links.insert(device_id.to_string(), PeerLink { shared, task }) {
            stale.shared.closing.send_replace(true);
        }
        Ok(info)
    }

    /// Drops the fleet index hold on `device_id`; closes the link when
    /// nobody else holds it.
    pub async fn release_index(&self, device_id: &str) {
        let mut links = self.links.lock().await;
        let Some(link) = links.get(device_id) else {
            return;
        };
        if link.shared.update_holds(|holds| holds.index = false) {
            return;
        }
        if let Some(link) = links.remove(device_id) {
            link.shared.closing.send_replace(true);
            log::info!("Peer link released; closing: device={}", device_id);
        }
    }

    /// Widens (or narrows back) the link to the peer's whole stream while a
    /// fleet client follows the device. A device without a link keeps the
    /// intent for when its link opens (the fleet index opens it).
    pub async fn set_followed(&self, device_id: &str, followed: bool) {
        if followed {
            lock(&self.followed).insert(device_id.to_string());
        } else {
            lock(&self.followed).remove(device_id);
        }
        let mut links = self.links.lock().await;
        let Some(link) = links.get(device_id) else {
            return;
        };
        if link.shared.update_holds(|holds| holds.followed = followed) {
            return;
        }
        if let Some(link) = links.remove(device_id) {
            link.shared.closing.send_replace(true);
        }
    }

    /// The devices with an open link.
    pub async fn linked_devices(&self) -> Vec<String> {
        let links = self.links.lock().await;
        let mut ids: Vec<String> = links
            .iter()
            .filter(|(_, link)| link.shared.state().0 != LinkState::Closed)
            .map(|(id, _)| id.clone())
            .collect();
        ids.sort();
        ids
    }

    /// The last `hello` answer of the link to `device_id` (its capabilities
    /// say whether the peer serves `fleet_v1`).
    pub async fn hello_of(&self, device_id: &str) -> Option<Value> {
        let links = self.links.lock().await;
        let link = links.get(device_id)?;
        let hello = lock(&link.shared.hello).clone();
        (!hello.is_null()).then_some(hello)
    }

    /// The state of the link to `device_id` and its last error.
    pub async fn state_of(&self, device_id: &str) -> Option<(LinkState, Option<String>)> {
        let links = self.links.lock().await;
        links.get(device_id).map(|link| link.shared.state())
    }

    /// Bumped whenever any link takes an event or changes state.
    pub fn arrivals(&self) -> watch::Receiver<u64> {
        self.arrivals.subscribe()
    }

    async fn shared(&self, device_id: &str) -> Result<Arc<LinkShared>, String> {
        let links = self.links.lock().await;
        let link = links.get(device_id).ok_or_else(|| {
            format!("peer_link_closed: no link to device {device_id}; connect first")
        })?;
        link.shared.touch();
        Ok(Arc::clone(&link.shared))
    }

    /// Runs `command` with its args on the peer: its result, or its error
    /// text (`peer_*` texts for link failures).
    pub async fn call(&self, device_id: &str, command: &str, args: Value) -> Result<Value, String> {
        self.call_typed(device_id, command, args)
            .await
            .map_err(|error| map_call_error(device_id, error))
    }

    /// Runs `command` on the peer, keeping the peer's JSON-RPC error (code
    /// and `data`, such as `data.kind = "unsupported"`). Link failures are
    /// transport errors (code 0) with the `peer_*` texts.
    pub async fn call_typed(
        &self,
        device_id: &str,
        command: &str,
        args: Value,
    ) -> Result<Value, MeshCallError> {
        let transport = |message: String| MeshCallError {
            code: 0,
            message,
            data: None,
        };
        let shared = self.shared(device_id).await.map_err(transport)?;
        // The call is counted under the caller lock, so a connection the link
        // moves away from stays open for it (an interest change).
        let current = lock(&shared.caller)
            .as_ref()
            .filter(|current| !current.caller.is_closed())
            .map(|current| (current.caller.clone(), current.in_flight.enter()));
        let Some((caller, _running)) = current else {
            let (state, error) = shared.state();
            return Err(transport(match state {
                LinkState::Closed => {
                    format!("peer_link_closed: the link to device {device_id} is closed")
                }
                _ => error.unwrap_or_else(|| {
                    format!("peer_reconnecting: reconnecting to device {device_id}")
                }),
            }));
        };
        caller.call(command, args).await.map_err(|error| {
            if error.code == 0 {
                MeshCallError {
                    message: map_call_error(device_id, error.clone()),
                    ..error
                }
            } else {
                error
            }
        })
    }

    /// The peer events after `after_seq` (of `instance_id`), waiting up to
    /// `wait` for the first one.
    pub async fn events(
        &self,
        device_id: &str,
        after_seq: Option<u64>,
        instance_id: Option<&str>,
        wait: Duration,
    ) -> Result<PeerEventsBatch, String> {
        let shared = self.shared(device_id).await?;
        let deadline = tokio::time::Instant::now() + wait.min(MAX_WAIT);
        loop {
            let arrived = shared.arrived.notified();
            tokio::pin!(arrived);
            arrived.as_mut().enable();
            let (state, error) = shared.state();
            let (instance, events) = {
                let ring = lock(&shared.ring);
                let current = ring.instance_id.clone();
                let foreign = instance_id.is_some() && instance_id != current.as_deref();
                let events = if foreign {
                    let mut events = vec![dropped("backend_restarted", after_seq, None)];
                    events.extend(ring.all());
                    events
                } else {
                    match ring.after(after_seq) {
                        Some(events) => events,
                        None => {
                            let mut events =
                                vec![dropped("slow_client", after_seq, ring.oldest_seq())];
                            events.extend(ring.all());
                            events
                        }
                    }
                };
                (current, events)
            };
            let timed_out = tokio::time::Instant::now() >= deadline;
            if !events.is_empty() || state == LinkState::Closed || timed_out {
                return Ok(PeerEventsBatch {
                    instance_id: instance,
                    state,
                    error,
                    events,
                });
            }
            tokio::select! {
                _ = arrived => {}
                _ = tokio::time::sleep_until(deadline) => {}
            }
        }
    }

    /// What the ring of `device_id` holds after `(instance, after)` (the
    /// fleet mux), at most `max` events.
    #[cfg_attr(not(feature = "fleet"), allow(dead_code))]
    pub(crate) async fn read_origin(
        &self,
        device_id: &str,
        instance: &str,
        after: u64,
        max: usize,
    ) -> OriginRead {
        let links = self.links.lock().await;
        let Some(link) = links.get(device_id) else {
            return OriginRead::Unknown;
        };
        let ring = lock(&link.shared.ring);
        ring.read(instance, after, max)
    }

    /// `(instance, newest seq)` of the ring of `device_id`, once known.
    #[cfg_attr(not(feature = "fleet"), allow(dead_code))]
    pub(crate) async fn position_of(&self, device_id: &str) -> Option<(String, u64)> {
        let links = self.links.lock().await;
        let link = links.get(device_id)?;
        let ring = lock(&link.shared.ring);
        Some((ring.instance_id.clone()?, ring.position().unwrap_or(0)))
    }

    /// `(instance, start seq)` where the link began reading the complete
    /// stream for `device_id` (used when a peer connects after `fleet_subscribe`
    /// so events arriving before the first poll are not skipped).
    #[cfg_attr(not(feature = "fleet"), allow(dead_code))]
    pub(crate) async fn start_position_of(&self, device_id: &str) -> Option<(String, u64)> {
        let links = self.links.lock().await;
        let link = links.get(device_id)?;
        let ring = lock(&link.shared.ring);
        let seq = ring
            .complete_from()
            .or(ring.start_seq)
            .or_else(|| ring.position())
            .unwrap_or(0);
        Some((ring.instance_id.clone()?, seq))
    }

    /// Closes the link to `device_id`; `false` when there was none.
    pub async fn disconnect(&self, device_id: &str) -> bool {
        let Some(link) = self.links.lock().await.remove(device_id) else {
            return false;
        };
        link.shared.closing.send_replace(true);
        let _ = tokio::time::timeout(Duration::from_secs(3), link.task).await;
        log::info!("Peer link closed: device={}", device_id);
        true
    }

    /// Closes every link (sign-out, shutdown).
    pub async fn disconnect_all(&self) {
        let ids: Vec<String> = self.links.lock().await.keys().cloned().collect();
        for id in ids {
            self.disconnect(&id).await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(seq: u64) -> MeshObpEvent {
        MeshObpEvent {
            seq,
            event: "agentic://text-chunk".into(),
            payload: json!({ "text": seq.to_string() }),
            origin: None,
            origin_instance: None,
        }
    }

    #[test]
    fn ring_serves_cursors_and_reports_gaps() {
        let mut ring = Ring::new();
        ring.reset(Some("i1".into()));
        for seq in 10..20 {
            ring.push(event(seq));
        }
        assert_eq!(ring.last_seq, Some(19));
        assert_eq!(ring.after(Some(15)).unwrap().len(), 4);
        assert_eq!(ring.after(Some(9)).unwrap().len(), 10);
        assert_eq!(ring.after(None).unwrap().len(), 10);
        // A cursor older than the ring cannot be served.
        assert!(ring.after(Some(3)).is_none());
        let item = &ring.after(Some(18)).unwrap()[0];
        assert_eq!(item["seq"], 19);
        assert_eq!(item["payload"]["text"], "19");
    }

    /// An older peer ignores the prefix filter: an index-only link keeps only
    /// fleet events (and drop notices) itself, while its resume cursor still
    /// moves past everything it read.
    #[test]
    fn index_only_link_filters_when_the_peer_did_not() {
        let shared = LinkShared {
            device_id: "old-peer".into(),
            ring: Mutex::new(Ring::new()),
            arrived: Notify::new(),
            arrivals: Arc::new(watch::channel(0).0),
            caller: Mutex::new(None),
            hello: Mutex::new(Value::Null),
            state: Mutex::new((LinkState::Connected, None)),
            closing: watch::channel(false).0,
            holds: Mutex::new(Holds {
                index: true,
                ..Holds::default()
            }),
            interest: watch::channel(LinkInterest::Index).0,
            filter_here: Mutex::new(true),
            touched: Mutex::new(Instant::now()),
        };
        assert!(!filter_applied(&json!({ "scope": "account-device" })));
        assert!(filter_applied(
            &json!({ "events": { "prefixes": ["fleet://"] } })
        ));
        lock(&shared.ring).reset(Some("i1".into()));
        shared.push(event(1));
        shared.push(MeshObpEvent {
            event: "fleet://digest-changed".into(),
            ..event(2)
        });
        shared.push(event(3));
        let ring = lock(&shared.ring);
        let kept: Vec<u64> = ring.events.iter().map(|(event, _)| event.seq).collect();
        assert_eq!(kept, [2]);
        assert_eq!(ring.last_seq, Some(3));
        // The index-only part of a ring is never served as the full stream.
        assert!(matches!(ring.read("i1", 1, 10), OriginRead::Gap { .. }));
    }

    #[test]
    fn ring_is_bounded() {
        let mut ring = Ring::new();
        for seq in 0..(RING_EVENTS as u64 + 10) {
            ring.push(event(seq));
        }
        assert_eq!(ring.events.len(), RING_EVENTS);
        assert_eq!(ring.oldest_seq(), Some(10));
    }

    #[test]
    fn origin_reads_report_instance_gaps_and_index_only_history() {
        let mut ring = Ring::new();
        assert!(matches!(ring.read("i1", 0, 10), OriginRead::Unknown));
        ring.reset(Some("i1".into()));
        ring.full_after = Some(9);
        for seq in 10..20 {
            ring.push(event(seq));
        }
        match ring.read("i1", 14, 10) {
            OriginRead::Events { events, .. } => {
                assert_eq!(events.len(), 5);
                assert_eq!(events[0].seq, 15);
            }
            other => panic!("{other:?}"),
        }
        assert!(matches!(
            ring.read("i1", 3, 10),
            OriginRead::Gap { resume_seq: 10, .. }
        ));
        assert!(matches!(
            ring.read("i0", 14, 10),
            OriginRead::InstanceChanged { newest: 19, .. }
        ));
        // An index-only ring is never the complete stream.
        ring.full_after = None;
        assert!(matches!(ring.read("i1", 14, 10), OriginRead::Gap { .. }));
        // A cursor at the newest seq waits (no gap).
        assert!(matches!(
            ring.read("i1", 19, 10),
            OriginRead::Events { ref events, .. } if events.is_empty()
        ));
    }
}

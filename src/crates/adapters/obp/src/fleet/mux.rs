//! The per-client fleet event stream: the entry's own events and those of
//! every device the client follows, each tagged with its origin, in one
//! stream with a vector cursor.
//!
//! - Ordering is per origin only: frames carry the origin's own `seq` and its
//!   backend instance, and a client drops `seq <= cursor` for the same
//!   instance. There is no cross-origin order.
//! - Sources: the entry's own events come from its [`EventHub`]; a peer's come
//!   from the ring of its link ([`PeerLinks`], 4,096 events / 16 MiB per
//!   origin). A cursor older than the ring is replayed from the owner
//!   (`fleet_replay`); when that history is gone, or the owner restarted, the
//!   client gets `backend://events-dropped {origin, reason, resumeSeq}` and
//!   re-hydrates that origin only.
//! - Interest: `fleet_subscribe {follow}` names the devices (and sessions or
//!   terminals) a client shows. The mux keeps a full upstream stream only for
//!   devices someone follows; every other link stays index-only.
//! - Backpressure: the connection's credit and ack. A client that falls
//!   behind is skipped forward for the lagging origin only
//!   (`events-dropped {origin, reason: "slow_client"}`); text chunks are
//!   coalesced per origin and stream.
//!
//! The WebSocket connection drives a [`FleetStream`]; the native desktop's
//! in-process UI long-polls [`FleetMux::poll`] for peer origins (its own
//! events stay in-process).

use std::collections::{BTreeMap, BTreeSet, HashMap, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use openbitfun_product_domains::fleet::{
    FleetCursor, FleetCursorState, FleetEventFrame, FleetEventsResponse, FleetFollow, FleetHello,
    FleetReplayEvent, FleetReplayRequest, FleetReplayResponse, EVENTS_DROPPED_HISTORY_GONE,
    EVENTS_DROPPED_INSTANCE_CHANGED, EVENTS_DROPPED_SLOW_CLIENT, MAX_INDEXED_DEVICES,
};
use serde_json::{json, Value};
use tokio::sync::watch;

use crate::authority::MeshAuthority;
use crate::client::links::{OriginRead, PeerLinks};
use crate::events::{BackendEvent, EventHub, EVENTS_DROPPED_EVENT};
use crate::server::{coalesce_events, event_visible, Outgoing, Scope};

/// Longest `fleet_events` long poll.
pub const MAX_POLL_WAIT: Duration = Duration::from_secs(25);
/// Most frames one `fleet_events` answer carries.
pub const MAX_POLL_FRAMES: usize = 512;
/// Most events one `fleet_replay` answer carries.
pub const MAX_REPLAY_EVENTS: u32 = 4096;
/// Events read from one origin per fill.
const READ_BATCH: usize = 256;
/// A stream re-checks its sources at least this often (positions that were
/// unknown, replays that failed).
const RECHECK: Duration = Duration::from_secs(2);

/// Who a stream belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum FleetClientKey {
    /// The native desktop's in-process UI (`fleet_events`).
    Local,
    /// One OBP connection.
    Connection(u64),
}

#[derive(Default)]
struct ClientState {
    follow: BTreeMap<String, FleetFollow>,
    /// Where following a device started (its ring position then), for an
    /// origin the client's cursor does not name.
    start: BTreeMap<String, Option<(String, u64)>>,
}

/// The fleet event layer of one runtime host.
pub struct FleetMux {
    authority: Arc<dyn MeshAuthority>,
    hub: Arc<EventHub>,
    links: Arc<PeerLinks>,
    clients: Mutex<HashMap<FleetClientKey, ClientState>>,
    /// Serializes follow changes (they adjust link holds).
    apply: tokio::sync::Mutex<()>,
    follow_changed: watch::Sender<u64>,
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl FleetMux {
    /// `authority` names this device (the origin of the hub's events), `hub`
    /// is the host's event stream and `links` its peer links.
    pub fn new(
        authority: Arc<dyn MeshAuthority>,
        hub: Arc<EventHub>,
        links: Arc<PeerLinks>,
    ) -> Arc<Self> {
        Arc::new(Self {
            authority,
            hub,
            links,
            clients: Mutex::new(HashMap::new()),
            apply: tokio::sync::Mutex::new(()),
            follow_changed: watch::channel(0).0,
        })
    }

    /// This device's id (the origin of local events); `None` signed out.
    pub fn local_device_id(&self) -> Option<String> {
        self.authority.local_device_id()
    }

    /// The host's event stream.
    pub fn hub(&self) -> &Arc<EventHub> {
        &self.hub
    }

    /// The peer links the mux reads.
    pub fn links(&self) -> &Arc<PeerLinks> {
        &self.links
    }

    fn followed_union(&self) -> BTreeSet<String> {
        lock(&self.clients)
            .values()
            .flat_map(|state| state.follow.keys().cloned())
            .collect()
    }

    /// `fleet_subscribe`: what `client` follows now (replaces the previous
    /// interest). Links of devices someone follows carry the whole stream;
    /// the others go back to index-only.
    pub async fn set_follow(&self, client: FleetClientKey, follow: BTreeMap<String, FleetFollow>) {
        let _apply = self.apply.lock().await;
        let local = self.local_device_id();
        let follow: BTreeMap<String, FleetFollow> = follow
            .into_iter()
            .filter(|(device, _)| Some(device.as_str()) != local.as_deref())
            .filter(|(device, _)| openbitfun_link::handshake::valid_device_id(device))
            .take(MAX_INDEXED_DEVICES)
            .collect();
        let before = self.followed_union();
        let previous: BTreeSet<String> = lock(&self.clients)
            .get(&client)
            .map(|state| state.follow.keys().cloned().collect())
            .unwrap_or_default();
        let mut start = lock(&self.clients)
            .get(&client)
            .map(|state| state.start.clone())
            .unwrap_or_default();
        start.retain(|device, _| follow.contains_key(device));
        for device in follow.keys() {
            if !previous.contains(device) {
                start.insert(device.clone(), self.links.position_of(device).await);
            }
        }
        lock(&self.clients).insert(client, ClientState { follow, start });
        let after = self.followed_union();
        for device in after.difference(&before) {
            self.links.set_followed(device, true).await;
        }
        for device in before.difference(&after) {
            self.links.set_followed(device, false).await;
        }
        self.follow_changed
            .send_modify(|count| *count = count.wrapping_add(1));
    }

    /// Forgets `client` (its connection closed).
    pub async fn drop_client(&self, client: FleetClientKey) {
        let _apply = self.apply.lock().await;
        let before = self.followed_union();
        lock(&self.clients).remove(&client);
        let after = self.followed_union();
        for device in before.difference(&after) {
            self.links.set_followed(device, false).await;
        }
        self.follow_changed
            .send_modify(|count| *count = count.wrapping_add(1));
    }

    fn follow_of(&self, client: FleetClientKey) -> Vec<(String, FleetFollow)> {
        lock(&self.clients)
            .get(&client)
            .map(|state| {
                state
                    .follow
                    .iter()
                    .map(|(device, follow)| (device.clone(), follow.clone()))
                    .collect()
            })
            .unwrap_or_default()
    }

    fn start_of(&self, client: FleetClientKey, device: &str) -> Option<(String, u64)> {
        lock(&self.clients)
            .get(&client)
            .and_then(|state| state.start.get(device).cloned().flatten())
    }

    /// Persists the initial `(instance, seq)` for a followed device that was
    /// not yet linked when `set_follow` ran, so detached `fleet_events` polls
    /// do not lose events that arrive before or between polls.
    fn set_start_if_unset(&self, client: FleetClientKey, device: &str, position: (String, u64)) {
        if let Some(state) = lock(&self.clients).get_mut(&client) {
            if let Some(slot @ None) = state.start.get_mut(device) {
                *slot = Some(position);
            }
        }
    }

    /// `fleet_events` for the native desktop's in-process UI: the frames of
    /// the peer origins `client` follows after `cursor`, waiting up to
    /// `wait` for the first one. The UI's own events stay in-process.
    pub async fn poll(
        self: &Arc<Self>,
        client: FleetClientKey,
        cursor: &FleetCursor,
        wait: Duration,
    ) -> FleetEventsResponse {
        let mut stream = FleetStream::detached(Arc::clone(self), client, cursor);
        let deadline = tokio::time::Instant::now() + wait.min(MAX_POLL_WAIT);
        loop {
            stream.fill(u64::MAX, READ_BATCH).await;
            if !stream.is_empty() || tokio::time::Instant::now() >= deadline {
                break;
            }
            tokio::select! {
                _ = stream.wait() => {}
                _ = tokio::time::sleep_until(deadline) => {}
            }
        }
        let mut events = Vec::new();
        while let Some(item) = stream.take() {
            if events.len() >= MAX_POLL_FRAMES {
                break;
            }
            events.push(item.into_frame());
        }
        FleetEventsResponse { events }
    }
}

/// `fleet_replay` on the owner: its own events after `afterSeq` of
/// `instanceId`, those any account device may receive (registry `Proxied`).
/// Another instance, or a cursor older than the ring, answers
/// `historyGone`.
pub fn serve_replay(
    hub: &EventHub,
    own_instance_id: &str,
    request: &FleetReplayRequest,
) -> FleetReplayResponse {
    let gone = || FleetReplayResponse {
        instance_id: own_instance_id.to_string(),
        events: Vec::new(),
        history_gone: true,
    };
    if request.instance_id != own_instance_id {
        return gone();
    }
    let max = request.max.clamp(1, MAX_REPLAY_EVENTS) as usize;
    let batch = hub.events_after(request.after_seq, max);
    if batch
        .events
        .first()
        .is_some_and(|event| event.event == EVENTS_DROPPED_EVENT)
        || batch.last_seq < request.after_seq
    {
        return gone();
    }
    let scope = Scope::AccountDevice {
        device_id: String::new(),
    };
    FleetReplayResponse {
        instance_id: own_instance_id.to_string(),
        events: batch
            .events
            .iter()
            .filter(|event| event_visible(&scope, &event.event))
            .map(|event| FleetReplayEvent {
                seq: event.seq,
                event: event.event.clone(),
                payload: event.payload.clone(),
            })
            .collect(),
        history_gone: false,
    }
}

/// One frame waiting to be sent.
pub(crate) struct FleetItem {
    pub(crate) origin: String,
    pub(crate) instance: String,
    pub(crate) out: Outgoing,
    pub(crate) bytes: u64,
    /// An `events-dropped` notice: sent even when the window is spent.
    pub(crate) notice: bool,
}

impl FleetItem {
    fn into_frame(self) -> FleetEventFrame {
        let (seq, event, payload) = self.out.into_parts();
        FleetEventFrame {
            origin: self.origin,
            origin_instance: self.instance,
            seq,
            event,
            payload,
        }
    }
}

fn estimate(event: &str, payload: &Value, origin: &str) -> u64 {
    (payload.to_string().len() + event.len() + origin.len() + 96) as u64
}

fn dropped_item(origin: &str, instance: &str, reason: &str, resume_seq: Option<u64>) -> FleetItem {
    let payload = json!({ "origin": origin, "reason": reason, "resumeSeq": resume_seq });
    let bytes = estimate(EVENTS_DROPPED_EVENT, &payload, origin);
    FleetItem {
        origin: origin.to_string(),
        instance: instance.to_string(),
        out: Outgoing::Merged {
            seq: resume_seq.map_or(0, |seq| seq.saturating_sub(1)),
            event: EVENTS_DROPPED_EVENT.to_string(),
            payload,
        },
        bytes,
        notice: true,
    }
}

fn text_of<'a>(payload: &'a Value, keys: &[&str]) -> Option<&'a str> {
    keys.iter()
        .find_map(|key| payload.get(*key).and_then(Value::as_str))
}

/// Whether a followed device's event is one the client shows: everything
/// with `all`, otherwise events of the followed sessions (or their child
/// sessions) and terminals, and device-level events naming neither.
fn follows(follow: &FleetFollow, payload: &Value) -> bool {
    if follow.all == Some(true) {
        return true;
    }
    let session = text_of(payload, &["sessionId", "session_id"]);
    let parent = text_of(payload, &["parentSessionId", "parent_session_id"]);
    let terminal = text_of(payload, &["terminalId", "terminal_id"]);
    if session.is_none() && terminal.is_none() {
        return true;
    }
    let listed = |list: &Option<Vec<String>>, id: Option<&str>| {
        id.is_some_and(|id| {
            list.as_ref()
                .is_some_and(|list| list.iter().any(|item| item == id))
        })
    };
    listed(&follow.sessions, session)
        || listed(&follow.sessions, parent)
        || listed(&follow.terminals, terminal)
}

struct LocalOrigin {
    device_id: String,
    instance: String,
    cursor: u64,
}

/// One client's merged stream with its read positions per origin.
pub(crate) struct FleetStream {
    mux: Arc<FleetMux>,
    client: FleetClientKey,
    scope: Scope,
    prefixes: Option<Vec<String>>,
    local: Option<LocalOrigin>,
    /// `(instance, seq)` read so far per peer origin.
    peers: BTreeMap<String, (String, u64)>,
    pending: VecDeque<FleetItem>,
    pending_bytes: HashMap<String, u64>,
    arrivals: watch::Receiver<u64>,
    follows: watch::Receiver<u64>,
}

/// Where a fleet stream starts: the client's cursor answer per origin.
pub(crate) type CursorStates = BTreeMap<String, FleetCursorState>;

impl FleetStream {
    fn base(mux: Arc<FleetMux>, client: FleetClientKey, scope: Scope) -> Self {
        let arrivals = mux.links.arrivals();
        let follows = mux.follow_changed.subscribe();
        Self {
            mux,
            client,
            scope,
            prefixes: None,
            local: None,
            peers: BTreeMap::new(),
            pending: VecDeque::new(),
            pending_bytes: HashMap::new(),
            arrivals,
            follows,
        }
    }

    /// A stream over peer origins only, from `cursor` (the native desktop's
    /// long poll).
    fn detached(mux: Arc<FleetMux>, client: FleetClientKey, cursor: &FleetCursor) -> Self {
        let mut stream = Self::base(mux, client, Scope::Owner);
        let local = stream.mux.local_device_id();
        for (origin, position) in &cursor.0 {
            if Some(origin.as_str()) != local.as_deref() {
                stream
                    .peers
                    .insert(origin.clone(), (position.instance_id.clone(), position.seq));
            }
        }
        stream
    }

    /// The stream of one OBP connection after its fleet hello. `instance_id`
    /// is this server's backend instance (the local origin's); `legacy` is
    /// the hello's own `(lastSeq, instanceId)`, used for the local origin
    /// when the fleet cursor does not name it. `None` when this device has
    /// no identity (signed out): the connection is then served as an old
    /// one.
    pub(crate) async fn open(
        mux: Arc<FleetMux>,
        client: FleetClientKey,
        scope: Scope,
        prefixes: Option<Vec<String>>,
        hello: &FleetHello,
        instance_id: &str,
        legacy: Option<(u64, Option<String>)>,
    ) -> Option<(Self, CursorStates)> {
        let device_id = mux.local_device_id()?;
        let mut stream = Self::base(mux, client, scope);
        stream.prefixes = prefixes;
        let mut states = CursorStates::new();
        let newest = stream.mux.hub.last_seq();

        let named = hello.cursor.0.get(&device_id);
        let resume = match (named, legacy) {
            (Some(position), _) => Some((position.instance_id.clone(), position.seq)),
            (None, Some((seq, instance))) => {
                Some((instance.unwrap_or_else(|| instance_id.to_string()), seq))
            }
            (None, None) => None,
        };
        let cursor = match resume {
            Some((instance, seq)) if instance == instance_id && seq <= newest => {
                let gone = stream
                    .mux
                    .hub
                    .events_after(seq, 1)
                    .events
                    .first()
                    .is_some_and(|event| event.event == EVENTS_DROPPED_EVENT);
                states.insert(
                    device_id.clone(),
                    if gone {
                        FleetCursorState::Dropped
                    } else {
                        FleetCursorState::Resumed
                    },
                );
                seq
            }
            Some((instance, _)) => {
                let reason = if instance == instance_id {
                    EVENTS_DROPPED_HISTORY_GONE
                } else {
                    EVENTS_DROPPED_INSTANCE_CHANGED
                };
                states.insert(device_id.clone(), FleetCursorState::Dropped);
                stream.push(dropped_item(
                    &device_id,
                    instance_id,
                    reason,
                    Some(newest + 1),
                ));
                newest
            }
            None => newest,
        };
        if named.is_none() {
            // Only origins the client named get a state.
            states.remove(&device_id);
        }
        stream.local = Some(LocalOrigin {
            device_id: device_id.clone(),
            instance: instance_id.to_string(),
            cursor,
        });

        for (origin, position) in &hello.cursor.0 {
            if *origin == device_id {
                continue;
            }
            match stream.mux.links.position_of(origin).await {
                Some((instance, newest)) if instance != position.instance_id => {
                    states.insert(origin.clone(), FleetCursorState::Dropped);
                    stream.push(dropped_item(
                        origin,
                        &instance,
                        EVENTS_DROPPED_INSTANCE_CHANGED,
                        Some(newest + 1),
                    ));
                    stream.peers.insert(origin.clone(), (instance, newest));
                }
                // Same instance (a gap is replayed from the owner), or a
                // device not linked yet: resumed when its events arrive.
                _ => {
                    states.insert(origin.clone(), FleetCursorState::Resumed);
                    stream
                        .peers
                        .insert(origin.clone(), (position.instance_id.clone(), position.seq));
                }
            }
        }
        Some((stream, states))
    }

    fn push(&mut self, item: FleetItem) {
        *self.pending_bytes.entry(item.origin.clone()).or_default() += item.bytes;
        self.pending.push_back(item);
    }

    fn passes(&self, event: &str) -> bool {
        event_visible(&self.scope, event)
            && crate::server::passes_prefixes(self.prefixes.as_deref(), event)
    }

    fn pending_of(&self, origin: &str) -> u64 {
        self.pending_bytes.get(origin).copied().unwrap_or(0)
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.pending.is_empty()
    }

    /// The next frame to send.
    pub(crate) fn peek(&self) -> Option<&FleetItem> {
        self.pending.front()
    }

    /// Takes the next frame.
    pub(crate) fn take(&mut self) -> Option<FleetItem> {
        let item = self.pending.pop_front()?;
        if let Some(bytes) = self.pending_bytes.get_mut(&item.origin) {
            *bytes = bytes.saturating_sub(item.bytes);
        }
        Some(item)
    }

    /// Origins whose unsent frames exceed `limit` bytes.
    pub(crate) fn over(&self, limit: u64) -> Vec<String> {
        let mut origins: Vec<String> = self
            .pending_bytes
            .iter()
            .filter(|(_, bytes)| **bytes > limit)
            .map(|(origin, _)| origin.clone())
            .collect();
        origins.sort();
        origins
    }

    /// Skips `origin` to its newest event: its unsent frames are dropped and
    /// the client is told to re-hydrate that origin (`slow_client`).
    pub(crate) async fn skip_slow(&mut self, origin: &str) {
        self.pending.retain(|item| item.origin != origin);
        self.pending_bytes.remove(origin);
        let (instance, newest) = match &mut self.local {
            Some(local) if local.device_id == origin => {
                local.cursor = self.mux.hub.last_seq();
                (local.instance.clone(), local.cursor)
            }
            _ => match self.mux.links.position_of(origin).await {
                Some((instance, newest)) => {
                    self.peers
                        .insert(origin.to_string(), (instance.clone(), newest));
                    (instance, newest)
                }
                None => match self.peers.get(origin) {
                    Some((instance, seq)) => (instance.clone(), *seq),
                    None => return,
                },
            },
        };
        log::info!(
            "Fleet client fell behind; skipping one origin: origin={}, resume_seq={}",
            origin,
            newest + 1
        );
        let item = dropped_item(
            origin,
            &instance,
            EVENTS_DROPPED_SLOW_CLIENT,
            Some(newest + 1),
        );
        *self.pending_bytes.entry(item.origin.clone()).or_default() += item.bytes;
        self.pending.push_front(item);
    }

    /// Reads what is available into the outbox, at most `batch` events per
    /// origin and not past `cap` unsent bytes of one origin. Never waits for
    /// new events (a replay from an owner is awaited).
    pub(crate) async fn fill(&mut self, cap: u64, batch: usize) {
        self.fill_local(cap, batch);
        let local = self.local.as_ref().map(|local| local.device_id.clone());
        for (device, follow) in self.mux.follow_of(self.client) {
            if Some(&device) == local.as_ref() || self.pending_of(&device) >= cap {
                continue;
            }
            self.fill_peer(&device, &follow, batch).await;
        }
    }

    fn fill_local(&mut self, cap: u64, batch: usize) {
        let Some(local) = self.local.as_ref() else {
            return;
        };
        if self.pending_of(&local.device_id) >= cap {
            return;
        }
        let (device_id, instance, cursor) = (
            local.device_id.clone(),
            local.instance.clone(),
            local.cursor,
        );
        let read = self.mux.hub.events_after(cursor, batch);
        let mut run: Vec<Arc<BackendEvent>> = Vec::new();
        let mut items = Vec::new();
        for event in read.events {
            if event.event == EVENTS_DROPPED_EVENT {
                // The cursor fell out of the hub's ring.
                self.flush_run(&device_id, &instance, &mut run, &mut items);
                let resume = event.payload["resumeSeq"].as_u64();
                items.push(dropped_item(
                    &device_id,
                    &instance,
                    EVENTS_DROPPED_HISTORY_GONE,
                    resume,
                ));
                continue;
            }
            if self.passes(&event.event) {
                run.push(event);
            }
        }
        self.flush_run(&device_id, &instance, &mut run, &mut items);
        for item in items {
            self.push(item);
        }
        if let Some(local) = self.local.as_mut() {
            local.cursor = read.last_seq;
        }
    }

    fn flush_run(
        &self,
        origin: &str,
        instance: &str,
        run: &mut Vec<Arc<BackendEvent>>,
        items: &mut Vec<FleetItem>,
    ) {
        if run.is_empty() {
            return;
        }
        for out in coalesce_events(std::mem::take(run)) {
            let bytes = {
                let (_, event, payload) = out.parts();
                estimate(event, payload, origin)
            };
            items.push(FleetItem {
                origin: origin.to_string(),
                instance: instance.to_string(),
                out,
                bytes,
                notice: false,
            });
        }
    }

    async fn fill_peer(&mut self, device: &str, follow: &FleetFollow, batch: usize) {
        let position = match self.peers.get(device).cloned() {
            Some(position) => position,
            None => match self.mux.start_of(self.client, device) {
                Some(start) => start,
                None => {
                    // Not linked yet when following started: persist the link's
                    // starting position on `ClientState.start` once known (so
                    // detached `fleet_events` polls keep it across calls) and
                    // immediately read any events already buffered since link open.
                    let Some(position) = self.mux.links.start_position_of(device).await else {
                        return;
                    };
                    self.mux
                        .set_start_if_unset(self.client, device, position.clone());
                    self.peers.insert(device.to_string(), position.clone());
                    position
                }
            },
        };
        let (instance, after) = position;
        match self
            .mux
            .links
            .read_origin(device, &instance, after, batch)
            .await
        {
            OriginRead::Unknown => {
                self.peers.insert(device.to_string(), (instance, after));
            }
            OriginRead::InstanceChanged { instance, newest } => {
                self.push(dropped_item(
                    device,
                    &instance,
                    EVENTS_DROPPED_INSTANCE_CHANGED,
                    Some(newest + 1),
                ));
                self.peers.insert(device.to_string(), (instance, newest));
            }
            OriginRead::Gap {
                instance,
                resume_seq,
            } => {
                let position = self
                    .replay(device, follow, &instance, after, resume_seq)
                    .await;
                self.peers.insert(device.to_string(), position);
            }
            OriginRead::Events { instance, events } => {
                let mut last = after;
                let mut run = Vec::new();
                let mut items = Vec::new();
                for event in events {
                    last = last.max(event.seq);
                    if event.event == EVENTS_DROPPED_EVENT {
                        // The owner skipped the link forward.
                        self.flush_run(device, &instance, &mut run, &mut items);
                        let reason = event.payload["reason"]
                            .as_str()
                            .unwrap_or(EVENTS_DROPPED_HISTORY_GONE)
                            .to_string();
                        let resume = event.payload["resumeSeq"].as_u64();
                        items.push(dropped_item(device, &instance, &reason, resume));
                        continue;
                    }
                    if self.passes(&event.event) && follows(follow, &event.payload) {
                        run.push(event);
                    }
                }
                self.flush_run(device, &instance, &mut run, &mut items);
                for item in items {
                    self.push(item);
                }
                self.peers.insert(device.to_string(), (instance, last));
            }
        }
    }

    /// Fills a gap older than the link's ring from the owner
    /// (`fleet_replay`). Returns the position to continue from.
    async fn replay(
        &mut self,
        device: &str,
        follow: &FleetFollow,
        instance: &str,
        after: u64,
        resume_seq: u64,
    ) -> (String, u64) {
        let args = json!({ "request": {
            "afterSeq": after,
            "instanceId": instance,
            "max": MAX_REPLAY_EVENTS,
        }});
        let answer = match self
            .mux
            .links
            .call_typed(device, "fleet_replay", args)
            .await
        {
            // The link is down or reconnecting: try again once it is back
            // (the history may still be there).
            Err(error) if error.is_transport() => {
                log::debug!(
                    "Fleet replay deferred; link not ready: origin={}, error={}",
                    device,
                    error
                );
                return (instance.to_string(), after);
            }
            answer => answer,
        };
        let replayed = answer.ok().and_then(|value| {
            serde_json::from_value::<FleetReplayResponse>(value)
                .ok()
                .filter(|response| !response.history_gone && response.instance_id == instance)
        });
        let Some(replayed) = replayed else {
            self.push(dropped_item(
                device,
                instance,
                EVENTS_DROPPED_HISTORY_GONE,
                Some(resume_seq),
            ));
            return (instance.to_string(), resume_seq.saturating_sub(1));
        };
        let mut last = after;
        let mut run = Vec::new();
        let mut items = Vec::new();
        for event in replayed.events {
            if event.seq <= last {
                continue;
            }
            last = event.seq;
            if self.passes(&event.event) && follows(follow, &event.payload) {
                run.push(Arc::new(BackendEvent {
                    seq: event.seq,
                    event: event.event,
                    payload: event.payload,
                }));
            }
        }
        self.flush_run(device, instance, &mut run, &mut items);
        for item in items {
            self.push(item);
        }
        // Nothing the owner still had was visible: continue from where the
        // link's ring is complete.
        let last = if last == after {
            resume_seq.saturating_sub(1)
        } else {
            last
        };
        (instance.to_string(), last)
    }

    /// Waits until a source may have something new. `false` once the hub
    /// closed.
    pub(crate) async fn wait(&mut self) -> bool {
        let cursor = self.local.as_ref().map(|local| local.cursor);
        let hub = Arc::clone(&self.mux.hub);
        let local = async move {
            match cursor {
                Some(cursor) => !hub.wait_events_after(cursor, 1).await.closed,
                None => std::future::pending::<bool>().await,
            }
        };
        tokio::select! {
            open = local => open,
            _ = self.arrivals.changed() => true,
            _ = self.follows.changed() => true,
            _ = tokio::time::sleep(RECHECK) => true,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn follow_filters_by_session_terminal_and_device_level() {
        let follow = FleetFollow {
            sessions: Some(vec!["s1".into()]),
            terminals: Some(vec!["t1".into()]),
            all: None,
        };
        assert!(follows(&follow, &json!({ "sessionId": "s1" })));
        assert!(follows(
            &follow,
            &json!({ "sessionId": "c", "parentSessionId": "s1" })
        ));
        assert!(follows(&follow, &json!({ "terminal_id": "t1" })));
        assert!(!follows(&follow, &json!({ "sessionId": "s2" })));
        assert!(follows(&follow, &json!({ "workspaceId": "w" })));
        let all = FleetFollow {
            all: Some(true),
            ..FleetFollow::default()
        };
        assert!(follows(&all, &json!({ "sessionId": "s2" })));
    }

    #[test]
    fn replay_serves_the_owner_ring_and_reports_gone_history() {
        let hub = EventHub::new(4);
        for index in 0..6 {
            hub.publish("agentic://text-chunk", json!({ "index": index }));
        }
        hub.publish("account://login-state", json!({}));
        let request = |after_seq, instance: &str| FleetReplayRequest {
            after_seq,
            instance_id: instance.into(),
            max: 10,
        };
        let answer = serve_replay(&hub, "i1", &request(4, "i1"));
        assert!(!answer.history_gone);
        // Owner-only events are never replayed to another device.
        let seqs: Vec<u64> = answer.events.iter().map(|event| event.seq).collect();
        assert_eq!(seqs, [5, 6]);
        assert!(serve_replay(&hub, "i1", &request(1, "i1")).history_gone);
        assert!(serve_replay(&hub, "i1", &request(4, "i0")).history_gone);
    }
}

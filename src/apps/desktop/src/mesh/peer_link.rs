//! Peer Device Mode over OBP on the account mesh (controller side).
//!
//! A UI that drives another device of the account keeps its own backend for
//! controller-local work (account, window, mesh, updater) and sends every
//! registry-`Proxied` command to the selected device's backend. This module
//! is that link: the local (owner) backend opens one authenticated
//! `account-device` OBP connection per driven device through
//! [`super::connect_device`] and exposes it to its own UIs with four
//! `ControllerLocal` commands:
//!
//! - `peer_link_connect {deviceId}`: open (or reuse) the link; returns the
//!   peer's `hello` (scope, capabilities, backend identity, `lastSeq`) and the
//!   mesh path (p2p or relayed).
//! - `peer_link_call {deviceId, command, args}`: run one command on the peer.
//!   `args` is exactly the Tauri args object the UI built and the result is
//!   the peer's own JSON: nothing is wrapped, projected or re-encoded.
//! - `peer_link_events {deviceId, afterSeq?, instanceId?, waitMs?}`: a long
//!   poll over the peer's event stream. Items are the peer's own
//!   `{seq, event, payload}` (the peer's `seq`), so the UI resumes after the
//!   last peer `seq` it applied, exactly like the in-process stream.
//! - `peer_link_disconnect {deviceId}`.
//!
//! The UI could not speak to the peer itself: the device handshake needs this
//! device's X25519 key, which stays in the backend. Going through the local
//! backend costs one in-process hop (a function call for the native UI); the
//! payload crosses it unchanged and token chunks are delivered as the peer
//! emits them.
//!
//! Resume: the link keeps the peer events it took in a bounded ring and, when
//! the mesh connection drops, reconnects with `lastSeq` + `instanceId`, so the
//! peer replays the gap. A UI cursor that fell out of the ring, or that
//! belongs to an earlier instance of the peer backend, gets a synthetic
//! `backend://events-dropped` first and re-hydrates through commands.
//!
//! Remote scenarios: this is the Peer Device Mode data plane. It never uses
//! the old relay transport (`account_device_rpc`, relay `rpc-call`,
//! `machine-event`, `HostStream`); a device that is not on the mesh is driven
//! by the legacy path in the UI instead (negotiated per device).

use std::collections::{HashMap, VecDeque};
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::{watch, Notify};

use crate::backend_protocol::ws::mesh_client::{
    MeshCallError, MeshCaller, MeshConnectOptions, MeshObpConnection, MeshObpEvent,
};
use crate::backend_protocol::EVENTS_DROPPED_EVENT;

/// Peer events kept for UI cursors (count bound).
const RING_EVENTS: usize = 4096;
/// Peer events kept for UI cursors (byte bound, payload JSON).
const RING_BYTES: usize = 16 * 1024 * 1024;
/// The event window the link asks the peer for.
const LINK_CREDIT_BYTES: u64 = 4 * 1024 * 1024;
/// Longest long poll.
const MAX_WAIT: Duration = Duration::from_secs(25);
/// A link nobody polled or called for this long is closed.
const IDLE_CLOSE: Duration = Duration::from_secs(5 * 60);
const BACKOFF_FIRST: Duration = Duration::from_millis(300);
const BACKOFF_MAX: Duration = Duration::from_secs(10);

/// A boxed connect future.
pub type ConnectFuture =
    Pin<Box<dyn Future<Output = Result<MeshObpConnection, String>> + Send + 'static>>;

/// How the link reaches a device (the mesh runtime; a test dialer in tests).
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

struct Ring {
    instance_id: Option<String>,
    events: VecDeque<(MeshObpEvent, usize)>,
    bytes: usize,
    /// Newest peer `seq` the link took (its resume cursor).
    last_seq: Option<u64>,
}

impl Ring {
    fn new() -> Self {
        Self {
            instance_id: None,
            events: VecDeque::new(),
            bytes: 0,
            last_seq: None,
        }
    }

    fn push(&mut self, event: MeshObpEvent) {
        let size = event.event.len() + event.payload.to_string().len() + 32;
        self.last_seq = Some(event.seq);
        self.events.push_back((event, size));
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
}

fn wire(event: &MeshObpEvent) -> Value {
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

struct LinkShared {
    device_id: String,
    ring: Mutex<Ring>,
    arrived: Notify,
    caller: Mutex<Option<MeshCaller>>,
    hello: Mutex<Value>,
    state: Mutex<(LinkState, Option<String>)>,
    closing: watch::Sender<bool>,
    touched: Mutex<Instant>,
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl LinkShared {
    fn touch(&self) {
        *lock(&self.touched) = Instant::now();
    }

    fn set_state(&self, state: LinkState, error: Option<String>) {
        *lock(&self.state) = (state, error);
        self.arrived.notify_waiters();
    }

    fn state(&self) -> (LinkState, Option<String>) {
        lock(&self.state).clone()
    }

    /// Takes a fresh connection: records its hello and caller, and resets the
    /// ring when the peer backend restarted.
    fn adopt(&self, connection: &MeshObpConnection) {
        let hello = connection.hello().clone();
        let instance = instance_of(&hello);
        {
            let mut ring = lock(&self.ring);
            if ring.instance_id != instance {
                if ring.instance_id.is_some() {
                    log::info!(
                        "Peer backend restarted; peer event history reset: device={}",
                        self.device_id
                    );
                }
                ring.reset(instance);
            }
        }
        *lock(&self.hello) = hello;
        *lock(&self.caller) = Some(connection.caller());
        self.set_state(LinkState::Connected, None);
    }

    fn push(&self, event: MeshObpEvent) {
        lock(&self.ring).push(event);
        self.arrived.notify_waiters();
    }
}

/// One driven device.
struct PeerLink {
    shared: Arc<LinkShared>,
    task: tokio::task::JoinHandle<()>,
}

/// The peer links of this backend.
pub struct PeerLinks {
    connector: Arc<dyn PeerConnector>,
    links: tokio::sync::Mutex<HashMap<String, PeerLink>>,
}

fn map_call_error(device_id: &str, error: MeshCallError) -> String {
    if error.code == 0 {
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

async fn pump(
    shared: Arc<LinkShared>,
    connector: Arc<dyn PeerConnector>,
    mut connection: MeshObpConnection,
) {
    let mut closing = shared.closing.subscribe();
    loop {
        // Read the current connection until it ends or the link closes.
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
                    None => break false,
                },
                _ = closing.changed() => break true,
            }
        };
        *lock(&shared.caller) = None;
        if ended || *closing.borrow() {
            connection.close().await;
            shared.set_state(LinkState::Closed, None);
            return;
        }
        drop(connection);
        log::info!(
            "Peer link lost; reconnecting over the mesh: device={}",
            shared.device_id
        );
        shared.set_state(
            LinkState::Reconnecting,
            Some(format!(
                "peer_reconnecting: the mesh connection to device {} dropped; reconnecting",
                shared.device_id
            )),
        );
        // Reconnect with the resume cursor until it works or the link closes.
        let mut backoff = BACKOFF_FIRST;
        connection = loop {
            let options = {
                let ring = lock(&shared.ring);
                MeshConnectOptions {
                    last_seq: ring.last_seq,
                    instance_id: ring.instance_id.clone(),
                    credit_bytes: Some(LINK_CREDIT_BYTES),
                }
            };
            let attempt = connector.connect(shared.device_id.clone(), options);
            tokio::select! {
                result = attempt => match result {
                    Ok(connection) => break connection,
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
        shared.adopt(&connection);
        log::info!("Peer link resumed: device={}", shared.device_id);
    }
}

impl PeerLinks {
    pub fn new(connector: Arc<dyn PeerConnector>) -> Arc<Self> {
        let links = Arc::new(Self {
            connector,
            links: tokio::sync::Mutex::new(HashMap::new()),
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

    async fn close_idle(&self, idle: Duration) {
        let mut links = self.links.lock().await;
        let stale: Vec<String> = links
            .iter()
            .filter(|(_, link)| lock(&link.shared.touched).elapsed() > idle)
            .map(|(id, _)| id.clone())
            .collect();
        for id in stale {
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

    /// Opens (or reuses) the link to `device_id`.
    pub async fn connect(&self, device_id: &str) -> Result<PeerLinkInfo, String> {
        if !openbitfun_link::handshake::valid_device_id(device_id) {
            return Err(format!("peer_link: invalid device id {device_id:?}"));
        }
        {
            let mut links = self.links.lock().await;
            if let Some(link) = links.get(device_id) {
                if link.shared.state().0 != LinkState::Closed {
                    link.shared.touch();
                    return Ok(self.info(&link.shared));
                }
                links.remove(device_id);
            }
        }
        // Connect without holding the table: other links keep answering.
        let connection = self
            .connector
            .connect(
                device_id.to_string(),
                MeshConnectOptions {
                    credit_bytes: Some(LINK_CREDIT_BYTES),
                    ..MeshConnectOptions::default()
                },
            )
            .await?;
        let shared = Arc::new(LinkShared {
            device_id: device_id.to_string(),
            ring: Mutex::new(Ring::new()),
            arrived: Notify::new(),
            caller: Mutex::new(None),
            hello: Mutex::new(Value::Null),
            state: Mutex::new((LinkState::Connected, None)),
            closing: watch::channel(false).0,
            touched: Mutex::new(Instant::now()),
        });
        shared.adopt(&connection);
        let mut links = self.links.lock().await;
        if let Some(existing) = links.get(device_id) {
            // A concurrent connect won the race; keep its link.
            if existing.shared.state().0 != LinkState::Closed {
                connection.close().await;
                existing.shared.touch();
                return Ok(self.info(&existing.shared));
            }
        }
        let task = tokio::spawn(pump(
            Arc::clone(&shared),
            Arc::clone(&self.connector),
            connection,
        ));
        log::info!("Peer link opened over the mesh: device={}", device_id);
        let info = self.info(&shared);
        if let Some(stale) = links.insert(device_id.to_string(), PeerLink { shared, task }) {
            stale.shared.closing.send_replace(true);
        }
        Ok(info)
    }

    async fn shared(&self, device_id: &str) -> Result<Arc<LinkShared>, String> {
        let links = self.links.lock().await;
        let link = links.get(device_id).ok_or_else(|| {
            format!("peer_link_closed: no link to device {device_id}; connect first")
        })?;
        link.shared.touch();
        Ok(Arc::clone(&link.shared))
    }

    /// Runs `command` with its Tauri `args` on the peer.
    pub async fn call(&self, device_id: &str, command: &str, args: Value) -> Result<Value, String> {
        let shared = self.shared(device_id).await?;
        let caller = lock(&shared.caller).clone();
        let Some(caller) = caller.filter(|caller| !caller.is_closed()) else {
            let (state, error) = shared.state();
            return Err(match state {
                LinkState::Closed => {
                    format!("peer_link_closed: the link to device {device_id} is closed")
                }
                _ => error.unwrap_or_else(|| {
                    format!("peer_reconnecting: reconnecting to device {device_id}")
                }),
            });
        };
        caller
            .call(command, args)
            .await
            .map_err(|error| map_call_error(device_id, error))
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

/// The production connector: the mesh runtime of this process.
struct RuntimeConnector;

impl PeerConnector for RuntimeConnector {
    fn connect(&self, device_id: String, options: MeshConnectOptions) -> ConnectFuture {
        Box::pin(async move { super::connect_device(&device_id, options).await })
    }

    fn route(&self, device_id: &str) -> Option<(String, Option<f64>)> {
        let status = super::global()?.status();
        let peer = status.peer(device_id)?;
        let path = serde_json::to_value(peer.path)
            .ok()?
            .as_str()
            .map(str::to_string)?;
        Some((path, peer.latency_ms))
    }
}

static LINKS: std::sync::OnceLock<Arc<PeerLinks>> = std::sync::OnceLock::new();

/// The peer links of this process (created on first use).
pub fn global() -> Arc<PeerLinks> {
    Arc::clone(LINKS.get_or_init(|| PeerLinks::new(Arc::new(RuntimeConnector))))
}

/// Closes every link if any was opened (sign-out, shutdown).
pub async fn shutdown_global() {
    if let Some(links) = LINKS.get() {
        links.disconnect_all().await;
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerLinkConnectRequest {
    pub device_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerLinkCallRequest {
    pub device_id: String,
    pub command: String,
    /// The Tauri args object (`{request}` or positional arguments).
    #[serde(default)]
    pub args: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerLinkEventsRequest {
    pub device_id: String,
    #[serde(default)]
    pub after_seq: Option<u64>,
    #[serde(default)]
    pub instance_id: Option<String>,
    /// Longest wait for the first event, in ms (default and cap 25 000).
    #[serde(default)]
    pub wait_ms: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerLinkDisconnectRequest {
    pub device_id: String,
}

/// Opens (or reuses) the OBP-on-mesh link to another device of the account.
// @backend-command
pub async fn peer_link_connect(request: PeerLinkConnectRequest) -> Result<PeerLinkInfo, String> {
    global().connect(request.device_id.trim()).await
}

/// Runs one product command on a linked device.
// @backend-command
pub async fn peer_link_call(request: PeerLinkCallRequest) -> Result<Value, String> {
    let args = if request.args.is_null() {
        Value::Object(Default::default())
    } else {
        request.args
    };
    global()
        .call(request.device_id.trim(), &request.command, args)
        .await
}

/// Long-polls a linked device's event stream.
// @backend-command
pub async fn peer_link_events(request: PeerLinkEventsRequest) -> Result<PeerEventsBatch, String> {
    let wait = Duration::from_millis(request.wait_ms.unwrap_or(MAX_WAIT.as_millis() as u64));
    global()
        .events(
            request.device_id.trim(),
            request.after_seq,
            request.instance_id.as_deref(),
            wait,
        )
        .await
}

/// Closes the link to a device.
// @backend-command
pub async fn peer_link_disconnect(request: PeerLinkDisconnectRequest) -> Result<Value, String> {
    let closed = global().disconnect(request.device_id.trim()).await;
    Ok(json!({ "closed": closed }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(seq: u64) -> MeshObpEvent {
        MeshObpEvent {
            seq,
            event: "agentic://text-chunk".into(),
            payload: json!({ "text": seq.to_string() }),
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

    #[test]
    fn ring_is_bounded() {
        let mut ring = Ring::new();
        for seq in 0..(RING_EVENTS as u64 + 10) {
            ring.push(event(seq));
        }
        assert_eq!(ring.events.len(), RING_EVENTS);
        assert_eq!(ring.oldest_seq(), Some(10));
    }
}

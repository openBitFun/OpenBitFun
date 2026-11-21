//! One OBP WebSocket connection: handshake, calls, and the event pump with
//! credit/ack backpressure.
//!
//! The runtime never waits for a client: events are read from the shared
//! replay ring ([`EventHub`]) at the connection's own pace. A connection that
//! advertises `ack` gets a byte window; when the window is spent the pump
//! stops reading, and once the unread backlog passes a byte bound it skips to
//! the newest event and sends `backend://events-dropped` so the client
//! re-hydrates through ordinary commands. When the pump catches up on a
//! backlog, consecutive text/thinking chunks of one stream are merged (the
//! merged event carries the last merged `seq`).

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::extract::ws::{CloseFrame, Message, WebSocket};
use futures::{SinkExt, StreamExt};
use serde_json::Value;
use tokio::sync::{mpsc, watch, Notify, Semaphore};

use super::protocol::{
    command_error, error_frame, event_frame, passes_prefixes, result_frame, AckParams,
    BackendIdentity, CallParams, HelloParams, HelloResult, Incoming, RpcError, FORBIDDEN,
    HELLO_REQUIRED, INTERNAL_ERROR, INVALID_PARAMS, INVALID_REQUEST, METHOD_NOT_FOUND,
    OBP_PROTOCOL_VERSION, PARSE_ERROR, PROTOCOL_MISMATCH, SERVER_CAPABILITIES,
};
use super::scope::{check_cloud_agent_call, check_command, event_visible, Scope};
use super::ObpBackend;
use crate::events::{BackendEvent, EventHub, EVENTS_DROPPED_EVENT};

const TEXT_CHUNK_EVENT: &str = "agentic://text-chunk";

/// Identifies connections to the fleet mux (`FleetClientKey::Connection`).
static NEXT_FLEET_CLIENT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

/// The fleet stream of a connection whose hello asked for it (feature
/// `fleet`; without it no connection has one).
#[cfg(feature = "fleet")]
type FleetStreamSlot = crate::fleet::mux::FleetStream;
#[cfg(not(feature = "fleet"))]
type FleetStreamSlot = std::convert::Infallible;

/// A connection bound to the fleet mux: it answers `fleet_subscribe` itself.
#[derive(Clone)]
struct FleetBinding {
    #[cfg(feature = "fleet")]
    mux: Arc<crate::fleet::mux::FleetMux>,
    #[cfg(feature = "fleet")]
    key: crate::fleet::mux::FleetClientKey,
}

/// What the handshake settled.
struct Session {
    /// The event cursor to start after (plain stream).
    cursor: u64,
    credit: Option<Arc<Credit>>,
    /// The hello's event-name prefix filter.
    prefixes: Option<Vec<String>>,
    fleet: Option<(FleetStreamSlot, FleetBinding)>,
}

/// Close code sent when the server stops a connection on purpose.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StopReason {
    /// The paired client's credential was revoked.
    Revoked,
    /// The listener or the backend is shutting down.
    Shutdown,
}

impl StopReason {
    fn close_frame(self) -> CloseFrame {
        match self {
            Self::Revoked => CloseFrame {
                code: 4003,
                reason: "credential revoked".into(),
            },
            Self::Shutdown => CloseFrame {
                code: 1001,
                reason: "backend going away".into(),
            },
        }
    }
}

/// Tunables of one connection.
#[derive(Debug, Clone)]
pub struct ConnectionLimits {
    pub hello_timeout: Duration,
    pub default_credit_bytes: u64,
    pub min_credit_bytes: u64,
    pub max_credit_bytes: u64,
    /// Unread backlog (bytes) past which a stalled client is skipped forward.
    pub backlog_drop_bytes: u64,
    pub max_inflight_calls: usize,
    pub events_per_batch: usize,
    pub ping_interval: Duration,
    pub idle_timeout: Duration,
}

impl Default for ConnectionLimits {
    fn default() -> Self {
        Self {
            hello_timeout: Duration::from_secs(10),
            default_credit_bytes: 1024 * 1024,
            min_credit_bytes: 64 * 1024,
            max_credit_bytes: 16 * 1024 * 1024,
            backlog_drop_bytes: 8 * 1024 * 1024,
            max_inflight_calls: 64,
            events_per_batch: 256,
            ping_interval: Duration::from_secs(30),
            idle_timeout: Duration::from_secs(90),
        }
    }
}

/// The capabilities of an `account-device` connection: the base set plus
/// the host's own host-verb capabilities.
pub(crate) fn mesh_capabilities(backend: &dyn ObpBackend) -> Vec<&'static str> {
    let mut capabilities = super::protocol::BASE_MESH_CAPABILITIES.to_vec();
    for capability in backend.mesh_capabilities() {
        if !capabilities.contains(&capability) {
            capabilities.push(capability);
        }
    }
    if backend.serves_cloud_agent()
        && !capabilities.contains(&super::scope::CLOUD_AGENT_SCOPE_CAPABILITY)
    {
        capabilities.push(super::scope::CLOUD_AGENT_SCOPE_CAPABILITY);
    }
    capabilities
}

/// What a connection needs from its server.
pub(crate) struct ConnectionContext {
    pub backend: Arc<dyn ObpBackend>,
    pub scope: Scope,
    pub instance_id: String,
    pub registry_digest: String,
    pub limits: ConnectionLimits,
    /// The id of the web UI bundle this host ships, when loaded (the
    /// `hello`'s `uiBundleId` hint; `ui_bundle_manifest` is authoritative).
    pub ui_bundle_id: Option<String>,
    /// The server's count of attached fleet clients (`fleetLoad`): a
    /// connection whose hello opened a fleet stream holds one while it lives.
    pub fleet_clients: Arc<std::sync::atomic::AtomicUsize>,
    pub stop: watch::Receiver<Option<StopReason>>,
}

/// Holds one unit of the server's fleet-client count until dropped.
struct FleetClientSlot(Arc<std::sync::atomic::AtomicUsize>);

impl FleetClientSlot {
    fn hold(count: &Arc<std::sync::atomic::AtomicUsize>) -> Self {
        count.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        Self(Arc::clone(count))
    }
}

impl Drop for FleetClientSlot {
    fn drop(&mut self) {
        self.0.fetch_sub(1, std::sync::atomic::Ordering::Relaxed);
    }
}

/// Bytes sent and not yet acknowledged, by `seq`.
struct Credit {
    window: u64,
    inner: Mutex<CreditInner>,
    changed: Notify,
}

/// One sent frame: `(seq, bytes, origin)`.
type SentFrame = (u64, u64, Option<(String, String)>);

#[derive(Default)]
struct CreditInner {
    /// `(seq, bytes, origin)` in send order; `origin` is `(device,
    /// instance)` on a fleet stream.
    sent: VecDeque<SentFrame>,
    unacked_bytes: u64,
}

impl Credit {
    fn new(window: u64) -> Self {
        Self {
            window,
            inner: Mutex::new(CreditInner::default()),
            changed: Notify::new(),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, CreditInner> {
        match self.inner.lock() {
            Ok(inner) => inner,
            Err(poisoned) => poisoned.into_inner(),
        }
    }

    fn exhausted(&self) -> bool {
        self.lock().unacked_bytes >= self.window
    }

    fn record(&self, seq: u64, bytes: u64) {
        let mut inner = self.lock();
        inner.sent.push_back((seq, bytes, None));
        inner.unacked_bytes += bytes;
    }

    /// A frame of a fleet stream (`seq` is `origin`'s own).
    #[cfg_attr(not(feature = "fleet"), allow(dead_code))]
    fn record_origin(&self, origin: &str, instance: &str, seq: u64, bytes: u64) {
        let mut inner = self.lock();
        inner
            .sent
            .push_back((seq, bytes, Some((origin.to_string(), instance.to_string()))));
        inner.unacked_bytes += bytes;
    }

    fn ack(&self, seq: u64) {
        {
            let mut inner = self.lock();
            while let Some((sent_seq, bytes, _)) = inner.sent.front() {
                if *sent_seq > seq {
                    break;
                }
                let bytes = *bytes;
                inner.sent.pop_front();
                inner.unacked_bytes = inner.unacked_bytes.saturating_sub(bytes);
            }
        }
        self.changed.notify_one();
    }

    /// An ack on a fleet stream. With the client's vector `cursor`, every
    /// frame at the front that the cursor covers (same origin instance, seq
    /// not newer) is returned. With `seq` alone, frames up to the first one
    /// with that seq are returned (seqs are per origin, so the plain rule
    /// would stall on a mixed stream).
    fn ack_fleet(&self, seq: u64, cursor: Option<&Value>) {
        {
            let mut inner = self.lock();
            let covered = |origin: &Option<(String, String)>, sent_seq: u64| match (cursor, origin)
            {
                (Some(cursor), Some((device, instance))) => {
                    let position = &cursor[device.as_str()];
                    position["instanceId"].as_str() == Some(instance.as_str())
                        && position["seq"]
                            .as_u64()
                            .is_some_and(|acked| sent_seq <= acked)
                }
                _ => false,
            };
            if cursor.is_some_and(Value::is_object) {
                while let Some((sent_seq, bytes, origin)) = inner.sent.front() {
                    if !covered(origin, *sent_seq) {
                        break;
                    }
                    let bytes = *bytes;
                    inner.sent.pop_front();
                    inner.unacked_bytes = inner.unacked_bytes.saturating_sub(bytes);
                }
            } else if let Some(position) = inner.sent.iter().position(|(sent, _, _)| *sent == seq) {
                for _ in 0..=position {
                    if let Some((_, bytes, _)) = inner.sent.pop_front() {
                        inner.unacked_bytes = inner.unacked_bytes.saturating_sub(bytes);
                    }
                }
            }
        }
        self.changed.notify_one();
    }
}

/// One event as the pump sends it: shared from the ring, or merged.
pub(crate) enum Outgoing {
    Shared(Arc<BackendEvent>),
    Merged {
        seq: u64,
        event: String,
        payload: Value,
    },
}

impl Outgoing {
    pub(crate) fn seq(&self) -> u64 {
        match self {
            Self::Shared(event) => event.seq,
            Self::Merged { seq, .. } => *seq,
        }
    }

    /// `(seq, event, payload)`.
    #[cfg_attr(not(feature = "fleet"), allow(dead_code))]
    pub(crate) fn parts(&self) -> (u64, &str, &Value) {
        match self {
            Self::Shared(event) => (event.seq, event.event.as_str(), &event.payload),
            Self::Merged {
                seq,
                event,
                payload,
            } => (*seq, event.as_str(), payload),
        }
    }

    /// `(seq, event, payload)`, owned.
    #[cfg_attr(not(feature = "fleet"), allow(dead_code))]
    pub(crate) fn into_parts(self) -> (u64, String, Value) {
        match self {
            Self::Shared(event) => (event.seq, event.event.clone(), event.payload.clone()),
            Self::Merged {
                seq,
                event,
                payload,
            } => (seq, event, payload),
        }
    }

    fn frame(&self) -> String {
        match self {
            Self::Shared(event) => event_frame(event.seq, &event.event, &event.payload),
            Self::Merged {
                seq,
                event,
                payload,
            } => event_frame(*seq, event, payload),
        }
    }
}

const TEXT_FIELDS: [&str; 4] = ["text", "delta", "content", "chunk"];

fn text_field_of(payload: &serde_json::Map<String, Value>) -> Option<&'static str> {
    TEXT_FIELDS
        .into_iter()
        .find(|field| payload.get(*field).is_some_and(Value::is_string))
}

/// The stream a chunk belongs to (the same key the UI's coalescer uses).
fn chunk_key(payload: &serde_json::Map<String, Value>) -> String {
    let read = |a: &str, b: &str| -> String {
        match payload.get(a).or_else(|| payload.get(b)) {
            Some(Value::String(text)) => text.clone(),
            Some(Value::Null) | None => String::new(),
            Some(other) => other.to_string(),
        }
    };
    [
        read("__openbitfunSourceDeviceId", "__openbitfunSourceDeviceId"),
        read("sessionId", "session_id"),
        read("turnId", "turn_id"),
        read("roundId", "round_id"),
        read("attemptId", "attempt_id"),
        read("contentType", "contentType"),
        read("reasoningKind", "reasoningKind"),
    ]
    .join("\u{0}")
}

/// Merges consecutive chunks of one stream. Order is preserved: any other
/// event ends the run before it.
pub(crate) fn coalesce(events: Vec<Arc<BackendEvent>>) -> Vec<Outgoing> {
    let mut out: Vec<Outgoing> = Vec::with_capacity(events.len());
    // (key, field, ended) of the run at the end of `out`.
    let mut run: Option<(String, &'static str, bool)> = None;
    for event in events {
        let mergeable = (event.event == TEXT_CHUNK_EVENT)
            .then(|| event.payload.as_object())
            .flatten()
            .and_then(|payload| text_field_of(payload).map(|field| (chunk_key(payload), field)));
        let Some((key, field)) = mergeable else {
            run = None;
            out.push(Outgoing::Shared(event));
            continue;
        };
        let thinking_end = event
            .payload
            .get("isThinkingEnd")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let joins = matches!(&run, Some((run_key, run_field, ended)) if *run_key == key && *run_field == field && !ended);
        if joins {
            if let Some(last) = out.pop() {
                let (mut payload, name) = match last {
                    Outgoing::Shared(previous) => {
                        (previous.payload.clone(), previous.event.clone())
                    }
                    Outgoing::Merged { payload, event, .. } => (payload, event),
                };
                if let Some(object) = payload.as_object_mut() {
                    let appended = format!(
                        "{}{}",
                        object
                            .get(field)
                            .and_then(Value::as_str)
                            .unwrap_or_default(),
                        event
                            .payload
                            .get(field)
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                    );
                    object.insert(field.to_string(), Value::String(appended));
                    if thinking_end {
                        object.insert("isThinkingEnd".to_string(), Value::Bool(true));
                    }
                }
                out.push(Outgoing::Merged {
                    seq: event.seq,
                    event: name,
                    payload,
                });
                run = Some((key, field, thinking_end));
                continue;
            }
        }
        run = Some((key, field, thinking_end));
        out.push(Outgoing::Shared(event));
    }
    out
}

fn estimate_bytes(event: &BackendEvent) -> u64 {
    let payload = serde_json::to_vec(&event.payload)
        .map(|bytes| bytes.len())
        .unwrap_or(0);
    (payload + event.event.len() + 64) as u64
}

/// Unread events of a stalled connection, measured incrementally.
struct Backlog {
    scanned: u64,
    bytes: u64,
}

impl Backlog {
    fn reset(&mut self, cursor: u64) {
        self.scanned = cursor;
        self.bytes = 0;
    }

    fn scan(&mut self, hub: &EventHub, visible: &dyn Fn(&str) -> bool, cursor: u64) {
        if self.scanned < cursor {
            self.reset(cursor);
        }
        loop {
            let batch = hub.events_after(self.scanned, 512);
            if batch.events.is_empty() {
                return;
            }
            for event in &batch.events {
                if event.event == EVENTS_DROPPED_EVENT {
                    // The cursor already fell out of the ring.
                    self.bytes = u64::MAX;
                } else if visible(&event.event) {
                    self.bytes = self.bytes.saturating_add(estimate_bytes(event));
                }
            }
            self.scanned = batch.last_seq;
        }
    }
}

type Outbox = mpsc::Sender<Message>;

async fn send_text(outbox: &Outbox, text: String) -> bool {
    !text.is_empty() && outbox.send(Message::Text(text.into())).await.is_ok()
}

/// Serves one upgraded WebSocket until either side closes it.
pub(crate) async fn serve(socket: WebSocket, context: ConnectionContext) {
    let (sink, stream) = socket.split();
    serve_split(sink, stream, context).await;
}

/// Serves one OBP connection over any message transport (a WebSocket's two
/// halves, or the end-to-end channel of a browser controller, `mesh::e2e`).
pub(crate) async fn serve_split<K, S, E>(mut sink: K, mut stream: S, context: ConnectionContext)
where
    K: futures::Sink<Message> + Unpin + Send + 'static,
    S: futures::Stream<Item = Result<Message, E>> + Unpin + Send,
{
    let (outbox, mut outgoing) = mpsc::channel::<Message>(256);
    let writer = tokio::spawn(async move {
        while let Some(message) = outgoing.recv().await {
            let closing = matches!(message, Message::Close(_));
            if sink.send(message).await.is_err() || closing {
                break;
            }
        }
        let _ = sink.close().await;
    });

    let mut stop = context.stop.clone();
    let hello = tokio::select! {
        hello = handshake(&mut stream, &outbox, &context) => hello,
        _ = tokio::time::sleep(context.limits.hello_timeout) => {
            let _ = outbox.send(Message::Close(Some(CloseFrame { code: 4001, reason: "hello timeout".into() }))).await;
            None
        }
        _ = stop.changed() => None,
    };
    let Some(session) = hello else {
        drop(outbox);
        let _ = writer.await;
        return;
    };
    let credit = session.credit.clone();
    let _fleet_slot = session
        .fleet
        .is_some()
        .then(|| FleetClientSlot::hold(&context.fleet_clients));
    let (pump, fleet) = match session.fleet {
        #[cfg(feature = "fleet")]
        Some((fleet_stream, binding)) => (
            tokio::spawn(pump_fleet(
                fleet_stream,
                credit.clone(),
                context.limits.clone(),
                outbox.clone(),
                context.stop.clone(),
            )),
            Some(binding),
        ),
        #[cfg(not(feature = "fleet"))]
        Some((never, _)) => match never {},
        None => (
            tokio::spawn(pump_events(
                context.backend.events(),
                context.scope.clone(),
                session.prefixes,
                session.cursor,
                credit.clone(),
                context.limits.clone(),
                outbox.clone(),
                context.stop.clone(),
            )),
            None,
        ),
    };

    let calls = Arc::new(Semaphore::new(context.limits.max_inflight_calls.max(1)));
    let mut ping = tokio::time::interval(context.limits.ping_interval);
    ping.tick().await;
    let mut last_heard = tokio::time::Instant::now();
    let stop_reason = loop {
        tokio::select! {
            message = stream.next() => {
                let Some(Ok(message)) = message else { break None };
                last_heard = tokio::time::Instant::now();
                match message {
                    Message::Text(text) => {
                        handle_message(text.as_str(), &context, &outbox, credit.as_deref(), &calls, fleet.as_ref()).await;
                    }
                    Message::Binary(_) => {
                        let frame = error_frame(&Value::Null, &RpcError::new(INVALID_REQUEST, "binary frames are not part of OBP"));
                        let _ = send_text(&outbox, frame).await;
                    }
                    Message::Close(_) => break None,
                    Message::Ping(_) | Message::Pong(_) => {}
                }
            }
            _ = ping.tick() => {
                if last_heard.elapsed() > context.limits.idle_timeout {
                    log::debug!("OBP connection idle; closing: scope={}", context.scope.wire_name());
                    break None;
                }
                let _ = outbox.send(Message::Ping(Vec::new().into())).await;
            }
            changed = stop.changed() => {
                if changed.is_err() { break Some(StopReason::Shutdown); }
                if let Some(reason) = *stop.borrow() { break Some(reason); }
            }
        }
    };
    pump.abort();
    #[cfg(feature = "fleet")]
    if let Some(binding) = &fleet {
        binding.mux.drop_client(binding.key).await;
    }
    if let Some(reason) = stop_reason {
        let _ = outbox
            .send(Message::Close(Some(reason.close_frame())))
            .await;
    }
    drop(outbox);
    let _ = writer.await;
}

/// Reads until `hello`, answering anything else with `hello_required`.
/// Returns the event cursor to start after, the negotiated credit, the
/// prefix filter and, for a fleet hello, the fleet stream.
async fn handshake<S, E>(
    stream: &mut S,
    outbox: &Outbox,
    context: &ConnectionContext,
) -> Option<Session>
where
    S: futures::Stream<Item = Result<Message, E>> + Unpin,
{
    loop {
        let message = stream.next().await?.ok()?;
        let text = match message {
            Message::Text(text) => text,
            Message::Close(_) => return None,
            _ => continue,
        };
        let incoming: Incoming = match serde_json::from_str(text.as_str()) {
            Ok(incoming) => incoming,
            Err(error) => {
                let frame =
                    error_frame(&Value::Null, &RpcError::new(PARSE_ERROR, error.to_string()));
                send_text(outbox, frame).await;
                continue;
            }
        };
        let id = incoming.id.clone().unwrap_or(Value::Null);
        if incoming.method != "hello" {
            if incoming.id.is_some() {
                let frame = error_frame(
                    &id,
                    &RpcError::new(HELLO_REQUIRED, "send hello before any other method"),
                );
                send_text(outbox, frame).await;
            }
            continue;
        }
        let params: HelloParams = if incoming.params.is_null() {
            HelloParams::default()
        } else {
            match serde_json::from_value(incoming.params) {
                Ok(params) => params,
                Err(error) => {
                    let frame = error_frame(&id, &RpcError::new(INVALID_PARAMS, error.to_string()));
                    send_text(outbox, frame).await;
                    continue;
                }
            }
        };
        let protocol = params.protocol.unwrap_or(OBP_PROTOCOL_VERSION);
        if protocol != OBP_PROTOCOL_VERSION {
            let frame = error_frame(
                &id,
                &RpcError::new(
                    PROTOCOL_MISMATCH,
                    format!("this backend speaks OBP version {OBP_PROTOCOL_VERSION}; the client asked for {protocol}"),
                )
                .with_data(serde_json::json!({ "supported": [OBP_PROTOCOL_VERSION] })),
            );
            send_text(outbox, frame).await;
            continue;
        }

        let hub = context.backend.events();
        let newest = hub.last_seq();
        let credit = params.ack.then(|| {
            let limits = &context.limits;
            let window = params
                .credit_bytes
                .unwrap_or(limits.default_credit_bytes)
                .clamp(limits.min_credit_bytes, limits.max_credit_bytes);
            Arc::new(Credit::new(window))
        });
        let prefixes = params.event_prefixes();
        let fleet = open_fleet(&params, context, prefixes.clone()).await;
        let info = context.backend.info();
        let read = |key: &str| {
            info.get(key)
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string()
        };
        let result = HelloResult {
            protocol: OBP_PROTOCOL_VERSION,
            scope: context.scope.wire_name(),
            capabilities: match context.scope {
                Scope::AccountDevice { .. } | Scope::CloudAgent { .. } => {
                    mesh_capabilities(context.backend.as_ref())
                }
                _ => SERVER_CAPABILITIES.to_vec(),
            },
            registry_digest: context.registry_digest.clone(),
            backend: BackendIdentity {
                version: read("version"),
                platform: read("platform"),
                instance_id: context.instance_id.clone(),
                data_dir: context.scope.is_owner().then(|| read("dataDir")),
            },
            last_seq: newest,
            credit_bytes: credit.as_ref().map(|credit| credit.window),
            host_capabilities: openbitfun_product_domains::remote_surface::advertised_by(
                context.backend.host_kind(),
            )
            .iter()
            .map(|capability| capability.key())
            .collect(),
            host_kind: context.backend.host_kind().as_wire_str(),
            ui_bundle_id: context.ui_bundle_id.clone(),
            events: prefixes
                .as_ref()
                .map(|prefixes| serde_json::json!({ "prefixes": prefixes })),
            fleet: fleet.as_ref().map(|(_, answer, _)| answer.clone()),
        };
        if !send_text(outbox, result_frame(&id, &result)).await {
            return None;
        }
        if let Some((fleet_stream, _, binding)) = fleet {
            log::info!(
                "OBP fleet client connected: scope={}, client={}",
                context.scope.wire_name(),
                params.client.as_deref().unwrap_or("-")
            );
            return Some(Session {
                cursor: newest,
                credit,
                prefixes,
                fleet: Some((fleet_stream, binding)),
            });
        }
        log::info!(
            "OBP client connected: scope={}, client={}, resume={:?}",
            context.scope.wire_name(),
            params.client.as_deref().unwrap_or("-"),
            params.last_seq
        );

        // Resume after the client's cursor when it belongs to this backend
        // instance; otherwise tell it the history it holds is gone.
        let same_instance = params
            .instance_id
            .as_deref()
            .is_none_or(|instance| instance == context.instance_id);
        let cursor = match params.last_seq {
            Some(seq) if same_instance && seq <= newest => seq,
            Some(seq) => {
                let reason = if same_instance {
                    "unknown_cursor"
                } else {
                    "backend_restarted"
                };
                let frame = event_frame(
                    newest,
                    EVENTS_DROPPED_EVENT,
                    &serde_json::json!({ "afterSeq": seq, "resumeSeq": newest + 1, "reason": reason }),
                );
                if let Some(credit) = &credit {
                    credit.record(newest, frame.len() as u64);
                }
                if !send_text(outbox, frame).await {
                    return None;
                }
                newest
            }
            None => newest,
        };
        return Some(Session {
            cursor,
            credit,
            prefixes,
            fleet: None,
        });
    }
}

/// The fleet stream a hello asks for, with its `fleet` answer
/// (`{protocol, deviceId, cursorState}`): only for a `fleet` hello on the
/// owner or account-device scope of a host that serves the fleet layer, and
/// while this device has an identity. Everything else is an old connection.
#[cfg(feature = "fleet")]
async fn open_fleet(
    params: &HelloParams,
    context: &ConnectionContext,
    prefixes: Option<Vec<String>>,
) -> Option<(FleetStreamSlot, Value, FleetBinding)> {
    let hello = params.fleet_hello()?;
    if !matches!(context.scope, Scope::Owner | Scope::AccountDevice { .. }) {
        return None;
    }
    let mux = context.backend.fleet_mux()?;
    let key = crate::fleet::mux::FleetClientKey::Connection(
        NEXT_FLEET_CLIENT.fetch_add(1, std::sync::atomic::Ordering::Relaxed),
    );
    let legacy = params.last_seq.map(|seq| (seq, params.instance_id.clone()));
    let (fleet_stream, states) = crate::fleet::mux::FleetStream::open(
        Arc::clone(&mux),
        key,
        context.scope.clone(),
        prefixes,
        &hello,
        &context.instance_id,
        legacy,
    )
    .await?;
    let answer = serde_json::json!({
        "protocol": openbitfun_product_domains::fleet::FLEET_PROTOCOL_VERSION,
        "deviceId": mux.local_device_id(),
        "cursorState": states,
    });
    Some((fleet_stream, answer, FleetBinding { mux, key }))
}

#[cfg(not(feature = "fleet"))]
async fn open_fleet(
    _params: &HelloParams,
    _context: &ConnectionContext,
    _prefixes: Option<Vec<String>>,
) -> Option<(FleetStreamSlot, Value, FleetBinding)> {
    let _ = &NEXT_FLEET_CLIENT;
    None
}

async fn handle_message(
    text: &str,
    context: &ConnectionContext,
    outbox: &Outbox,
    credit: Option<&Credit>,
    calls: &Arc<Semaphore>,
    fleet: Option<&FleetBinding>,
) {
    if text.trim_start().starts_with('[') {
        let frame = error_frame(
            &Value::Null,
            &RpcError::new(INVALID_REQUEST, "JSON-RPC batches are not supported"),
        );
        send_text(outbox, frame).await;
        return;
    }
    let incoming: Incoming = match serde_json::from_str(text) {
        Ok(incoming) => incoming,
        Err(error) => {
            let frame = error_frame(&Value::Null, &RpcError::new(PARSE_ERROR, error.to_string()));
            send_text(outbox, frame).await;
            return;
        }
    };
    if incoming
        .jsonrpc
        .as_deref()
        .is_some_and(|version| version != "2.0")
    {
        if let Some(id) = &incoming.id {
            let frame = error_frame(
                id,
                &RpcError::new(INVALID_REQUEST, "jsonrpc must be \"2.0\""),
            );
            send_text(outbox, frame).await;
        }
        return;
    }
    match (incoming.method.as_str(), incoming.id) {
        ("ack", _) => match serde_json::from_value::<AckParams>(incoming.params) {
            Ok(ack) => {
                if let Some(credit) = credit {
                    if fleet.is_some() {
                        credit.ack_fleet(ack.seq, ack.cursor.as_ref());
                    } else {
                        credit.ack(ack.seq);
                    }
                }
            }
            Err(error) => log::debug!("OBP ack ignored: {}", error),
        },
        ("call", Some(id)) => {
            let params = match serde_json::from_value::<CallParams>(incoming.params) {
                Ok(params) => params,
                Err(error) => {
                    let frame = error_frame(&id, &RpcError::new(INVALID_PARAMS, error.to_string()));
                    send_text(outbox, frame).await;
                    return;
                }
            };
            if let Some(frame) = answer_fleet_verb(&id, &params, context, fleet).await {
                send_text(outbox, frame).await;
                return;
            }
            let backend = Arc::clone(&context.backend);
            let host_verb = |command: &str| backend.is_account_device_host_verb(command);
            if let Err(refusal) = check_command(&context.scope, &params.command, &host_verb) {
                log::info!(
                    "OBP call refused for scope: scope={}, command={}",
                    context.scope.wire_name(),
                    params.command
                );
                let error = RpcError::new(FORBIDDEN, refusal).with_data(serde_json::json!({
                    "kind": "forbidden",
                    "command": params.command,
                    "scope": context.scope.wire_name(),
                }));
                send_text(outbox, error_frame(&id, &error)).await;
                return;
            }
            // The cloud agent: this device's switches and the call's
            // approval policy, read per call.
            if let Scope::CloudAgent { .. } = context.scope {
                let policy = backend.cloud_agent_policy().await;
                if let Err(refusal) = check_cloud_agent_call(&params.command, &params.args, &policy)
                {
                    log::info!(
                        "OBP call refused for the cloud agent: command={}",
                        params.command
                    );
                    let error = RpcError::new(FORBIDDEN, refusal).with_data(serde_json::json!({
                        "kind": "forbidden",
                        "command": params.command,
                        "scope": context.scope.wire_name(),
                    }));
                    send_text(outbox, error_frame(&id, &error)).await;
                    return;
                }
            }
            // Bound in-flight calls; past the bound this connection's reader
            // waits, which is its own backpressure.
            let Ok(permit) = Arc::clone(calls).acquire_owned().await else {
                return;
            };
            let backend = Arc::clone(&context.backend);
            let outbox = outbox.clone();
            tokio::spawn(async move {
                let command = params.command;
                let args = if params.args.is_null() {
                    Value::Object(Default::default())
                } else {
                    params.args
                };
                // A panicking command fails its own task, not the connection.
                let outcome = tokio::spawn(backend.dispatch(command.clone(), args)).await;
                let frame = match outcome {
                    Ok(Ok(value)) => result_frame(&id, &value),
                    Ok(Err(message)) => {
                        let unsupported = backend.is_unsupported_error(&message);
                        error_frame(&id, &command_error(&command, message, unsupported))
                    }
                    Err(error) => {
                        log::error!(
                            "OBP command task failed: command={}, error={}",
                            command,
                            error
                        );
                        error_frame(
                            &id,
                            &RpcError::new(
                                INTERNAL_ERROR,
                                format!("backend command `{command}` failed: {error}"),
                            ),
                        )
                    }
                };
                send_text(&outbox, frame).await;
                drop(permit);
            });
        }
        ("hello", Some(id)) => {
            let frame = error_frame(
                &id,
                &RpcError::new(INVALID_REQUEST, "hello was already received"),
            );
            send_text(outbox, frame).await;
        }
        (method, Some(id)) => {
            let frame = error_frame(
                &id,
                &RpcError::new(METHOD_NOT_FOUND, format!("unknown method `{method}`")),
            );
            send_text(outbox, frame).await;
        }
        (_, None) => {}
    }
}

/// The fleet verbs a connection answers itself: `fleet_events` is the native
/// desktop's in-process long poll and never runs over OBP (a connection gets
/// the fleet stream as frames), and `fleet_subscribe` on a fleet connection
/// sets that connection's interest. `None`: the call goes on as usual.
async fn answer_fleet_verb(
    id: &Value,
    params: &CallParams,
    context: &ConnectionContext,
    fleet: Option<&FleetBinding>,
) -> Option<String> {
    match params.command.as_str() {
        "fleet_events" => Some(error_frame(
            id,
            &command_error(
                "fleet_events",
                "fleet_events_unsupported: fleet_events serves the in-process desktop UI; over OBP send a hello with `fleet` and read the event frames".to_string(),
                true,
            ),
        )),
        #[cfg(feature = "fleet")]
        "fleet_subscribe" => {
            let binding = fleet?;
            if !matches!(context.scope, Scope::Owner | Scope::AccountDevice { .. }) {
                return None;
            }
            let request = params.args.get("request").unwrap_or(&params.args).clone();
            let request: openbitfun_product_domains::fleet::FleetSubscribeRequest =
                match serde_json::from_value(request) {
                    Ok(request) => request,
                    Err(error) => {
                        return Some(error_frame(
                            id,
                            &command_error(
                                "fleet_subscribe",
                                format!("invalid fleet_subscribe request: {error}"),
                                false,
                            ),
                        ))
                    }
                };
            binding.mux.set_follow(binding.key, request.follow).await;
            Some(result_frame(id, &serde_json::json!({ "applied": true })))
        }
        _ => {
            let _ = (context, fleet);
            None
        }
    }
}

#[allow(clippy::too_many_arguments)]
async fn pump_events(
    hub: Arc<EventHub>,
    scope: Scope,
    prefixes: Option<Vec<String>>,
    mut cursor: u64,
    credit: Option<Arc<Credit>>,
    limits: ConnectionLimits,
    outbox: Outbox,
    mut stop: watch::Receiver<Option<StopReason>>,
) {
    let mut backlog = Backlog {
        scanned: cursor,
        bytes: 0,
    };
    let visible =
        |event: &str| event_visible(&scope, event) && passes_prefixes(prefixes.as_deref(), event);
    loop {
        if let Some(credit) = &credit {
            while credit.exhausted() {
                backlog.scan(&hub, &visible, cursor);
                if backlog.bytes > limits.backlog_drop_bytes {
                    let newest = hub.last_seq();
                    log::info!(
                        "OBP client fell behind; skipping to the newest event: scope={}, after_seq={}, resume_seq={}",
                        scope.wire_name(),
                        cursor,
                        newest + 1
                    );
                    let frame = event_frame(
                        newest,
                        EVENTS_DROPPED_EVENT,
                        &serde_json::json!({ "afterSeq": cursor, "resumeSeq": newest + 1, "reason": "slow_client" }),
                    );
                    credit.record(newest, frame.len() as u64);
                    if !send_text(&outbox, frame).await {
                        return;
                    }
                    cursor = newest;
                    backlog.reset(cursor);
                }
                let watermark = backlog.scanned.max(cursor);
                tokio::select! {
                    _ = credit.changed.notified() => {}
                    batch = hub.wait_events_after(watermark, 1) => {
                        if batch.closed {
                            let _ = outbox
                                .send(Message::Close(Some(StopReason::Shutdown.close_frame())))
                                .await;
                            return;
                        }
                    }
                    _ = stop.changed() => return,
                }
            }
        }
        let batch = tokio::select! {
            batch = hub.wait_events_after(cursor, limits.events_per_batch) => batch,
            _ = stop.changed() => return,
        };
        if batch.events.is_empty() {
            if batch.closed {
                let _ = outbox
                    .send(Message::Close(Some(StopReason::Shutdown.close_frame())))
                    .await;
                return;
            }
            // A cursor beyond the stream (cannot happen after the handshake
            // check, but never spin on it).
            cursor = batch.last_seq.min(cursor);
            tokio::time::sleep(Duration::from_millis(50)).await;
            continue;
        }
        let visible: Vec<Arc<BackendEvent>> = batch
            .events
            .into_iter()
            .filter(|event| visible(&event.event))
            .collect();
        let mut spent = false;
        for outgoing in coalesce(visible) {
            // The window is checked per event: a batch never overruns it by
            // more than one frame. The rest is read again once credit returns.
            if credit.as_ref().is_some_and(|credit| credit.exhausted()) {
                spent = true;
                break;
            }
            let frame = outgoing.frame();
            if let Some(credit) = &credit {
                credit.record(outgoing.seq(), frame.len() as u64);
            }
            if !send_text(&outbox, frame).await {
                return;
            }
            cursor = outgoing.seq();
        }
        if !spent {
            cursor = batch.last_seq;
        }
    }
}

/// The event pump of a fleet connection: frames of every origin the client
/// follows, under the same credit window. When the window is spent the
/// unsent frames are bounded per origin, and an origin past the backlog
/// bound is skipped forward on its own (`events-dropped {origin, reason:
/// "slow_client"}`); the other origins keep their events.
#[cfg(feature = "fleet")]
async fn pump_fleet(
    mut fleet: FleetStreamSlot,
    credit: Option<Arc<Credit>>,
    limits: ConnectionLimits,
    outbox: Outbox,
    mut stop: watch::Receiver<Option<StopReason>>,
) {
    let spent =
        |credit: &Option<Arc<Credit>>| credit.as_ref().is_some_and(|credit| credit.exhausted());
    loop {
        // Send what the window allows; notices go out regardless.
        while let Some(item) = fleet.peek() {
            if !item.notice && spent(&credit) {
                break;
            }
            let Some(item) = fleet.take() else { break };
            let (seq, event, payload) = item.out.parts();
            let frame = super::protocol::fleet_event_frame(
                &item.origin,
                &item.instance,
                seq,
                event,
                payload,
            );
            // Notices are not counted: a client acks the frames it applied
            // by cursor, and a notice moves no cursor of its own.
            if let (Some(credit), false) = (&credit, item.notice) {
                credit.record_origin(&item.origin, &item.instance, seq, frame.len() as u64);
            }
            if !send_text(&outbox, frame).await {
                return;
            }
        }
        let window_spent = spent(&credit);
        let cap = if window_spent {
            limits.backlog_drop_bytes.saturating_add(1)
        } else {
            u64::MAX
        };
        fleet.fill(cap, limits.events_per_batch).await;
        if window_spent {
            for origin in fleet.over(limits.backlog_drop_bytes) {
                fleet.skip_slow(&origin).await;
            }
        }
        if !fleet.is_empty() && !window_spent {
            continue;
        }
        if fleet.peek().is_some_and(|item| item.notice) {
            continue;
        }
        let credit_returned = async {
            match &credit {
                Some(credit) => credit.changed.notified().await,
                None => std::future::pending::<()>().await,
            }
        };
        tokio::select! {
            open = fleet.wait() => {
                if !open {
                    let _ = outbox
                        .send(Message::Close(Some(StopReason::Shutdown.close_frame())))
                        .await;
                    return;
                }
            }
            _ = credit_returned => {}
            _ = stop.changed() => return,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chunk(seq: u64, session: &str, text: &str) -> Arc<BackendEvent> {
        Arc::new(BackendEvent {
            seq,
            event: TEXT_CHUNK_EVENT.into(),
            payload: serde_json::json!({ "sessionId": session, "roundId": "r", "text": text }),
        })
    }

    #[test]
    fn coalescing_merges_runs_of_one_stream_and_keeps_order() {
        let other = Arc::new(BackendEvent {
            seq: 4,
            event: "agentic://tool-event".into(),
            payload: Value::Null,
        });
        let out = coalesce(vec![
            chunk(1, "s", "a"),
            chunk(2, "s", "b"),
            chunk(3, "t", "c"),
            other,
            chunk(5, "s", "d"),
            chunk(6, "s", "e"),
        ]);
        let shapes: Vec<(u64, String)> = out
            .iter()
            .map(|item| {
                let frame: Value = serde_json::from_str(&item.frame()).unwrap();
                let text = frame["params"]["payload"]["text"]
                    .as_str()
                    .unwrap_or("-")
                    .to_string();
                (item.seq(), text)
            })
            .collect();
        assert_eq!(
            shapes,
            [
                (2, "ab".to_string()),
                (3, "c".to_string()),
                (4, "-".to_string()),
                (6, "de".to_string())
            ]
        );
    }

    #[test]
    fn fleet_acks_return_credit_by_cursor_or_by_seq() {
        let credit = Credit::new(100);
        credit.record_origin("a", "ia", 40, 30);
        credit.record_origin("b", "ib", 3, 30);
        credit.record_origin("a", "ia", 41, 30);
        credit.record_origin("b", "ib", 4, 30);
        assert!(credit.exhausted());
        // `seq` alone must not pop frames of another origin with higher seqs
        // stalled behind a lower one, nor stall on them.
        credit.ack_fleet(3, None);
        assert_eq!(credit.lock().sent.len(), 2);
        let cursor = serde_json::json!({
            "a": { "instanceId": "ia", "seq": 41 },
            "b": { "instanceId": "ib", "seq": 3 },
        });
        credit.ack_fleet(41, Some(&cursor));
        assert_eq!(credit.lock().sent.len(), 1);
        // Another instance's cursor covers nothing.
        let foreign = serde_json::json!({ "b": { "instanceId": "old", "seq": 9 } });
        credit.ack_fleet(4, Some(&foreign));
        assert_eq!(credit.lock().sent.len(), 1);
        let cursor = serde_json::json!({ "b": { "instanceId": "ib", "seq": 4 } });
        credit.ack_fleet(4, Some(&cursor));
        assert_eq!(credit.lock().unacked_bytes, 0);
    }

    #[test]
    fn credit_is_returned_by_acks() {
        let credit = Credit::new(100);
        credit.record(1, 60);
        assert!(!credit.exhausted());
        credit.record(2, 60);
        assert!(credit.exhausted());
        credit.ack(1);
        assert!(!credit.exhausted());
        credit.ack(2);
        assert_eq!(credit.lock().unacked_bytes, 0);
    }
}

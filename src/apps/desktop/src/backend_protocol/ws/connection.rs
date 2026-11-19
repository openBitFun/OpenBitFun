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
    command_error, error_frame, event_frame, result_frame, AckParams, BackendIdentity, CallParams,
    HelloParams, HelloResult, Incoming, RpcError, FORBIDDEN, HELLO_REQUIRED, INTERNAL_ERROR,
    INVALID_PARAMS, INVALID_REQUEST, METHOD_NOT_FOUND, OBP_PROTOCOL_VERSION, PARSE_ERROR,
    PROTOCOL_MISMATCH, SERVER_CAPABILITIES,
};
use super::scope::{check_command, event_visible, Scope};
use super::ObpBackend;
use crate::backend_protocol::{BackendEvent, EventHub, EVENTS_DROPPED_EVENT};

const TEXT_CHUNK_EVENT: &str = "agentic://text-chunk";

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

/// What a connection needs from its server.
pub(crate) struct ConnectionContext {
    pub backend: Arc<dyn ObpBackend>,
    pub scope: Scope,
    pub instance_id: String,
    pub registry_digest: String,
    pub limits: ConnectionLimits,
    pub stop: watch::Receiver<Option<StopReason>>,
}

/// Bytes sent and not yet acknowledged, by `seq`.
struct Credit {
    window: u64,
    inner: Mutex<CreditInner>,
    changed: Notify,
}

#[derive(Default)]
struct CreditInner {
    sent: VecDeque<(u64, u64)>,
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
        inner.sent.push_back((seq, bytes));
        inner.unacked_bytes += bytes;
    }

    fn ack(&self, seq: u64) {
        {
            let mut inner = self.lock();
            while let Some(&(sent_seq, bytes)) = inner.sent.front() {
                if sent_seq > seq {
                    break;
                }
                inner.sent.pop_front();
                inner.unacked_bytes = inner.unacked_bytes.saturating_sub(bytes);
            }
        }
        self.changed.notify_one();
    }
}

/// One event as the pump sends it: shared from the ring, or merged.
enum Outgoing {
    Shared(Arc<BackendEvent>),
    Merged {
        seq: u64,
        event: String,
        payload: Value,
    },
}

impl Outgoing {
    fn seq(&self) -> u64 {
        match self {
            Self::Shared(event) => event.seq,
            Self::Merged { seq, .. } => *seq,
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
fn coalesce(events: Vec<Arc<BackendEvent>>) -> Vec<Outgoing> {
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

    fn scan(&mut self, hub: &EventHub, scope: &Scope, cursor: u64) {
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
                } else if event_visible(scope, &event.event) {
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
    let (mut sink, mut stream) = socket.split();
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
    let Some((cursor, credit)) = hello else {
        drop(outbox);
        let _ = writer.await;
        return;
    };

    let pump = tokio::spawn(pump_events(
        context.backend.events(),
        context.scope.clone(),
        cursor,
        credit.clone(),
        context.limits.clone(),
        outbox.clone(),
        context.stop.clone(),
    ));

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
                        handle_message(text.as_str(), &context, &outbox, credit.as_deref(), &calls).await;
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
    if let Some(reason) = stop_reason {
        let _ = outbox
            .send(Message::Close(Some(reason.close_frame())))
            .await;
    }
    drop(outbox);
    let _ = writer.await;
}

/// Reads until `hello`, answering anything else with `hello_required`.
/// Returns the event cursor to start after and the negotiated credit.
async fn handshake(
    stream: &mut futures::stream::SplitStream<WebSocket>,
    outbox: &Outbox,
    context: &ConnectionContext,
) -> Option<(u64, Option<Arc<Credit>>)> {
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
            capabilities: SERVER_CAPABILITIES,
            registry_digest: context.registry_digest.clone(),
            backend: BackendIdentity {
                version: read("version"),
                platform: read("platform"),
                instance_id: context.instance_id.clone(),
                data_dir: context.scope.is_owner().then(|| read("dataDir")),
            },
            last_seq: newest,
            credit_bytes: credit.as_ref().map(|credit| credit.window),
        };
        if !send_text(outbox, result_frame(&id, &result)).await {
            return None;
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
        return Some((cursor, credit));
    }
}

async fn handle_message(
    text: &str,
    context: &ConnectionContext,
    outbox: &Outbox,
    credit: Option<&Credit>,
    calls: &Arc<Semaphore>,
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
                    credit.ack(ack.seq);
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
            if let Err(refusal) = check_command(&context.scope, &params.command) {
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
                    Ok(Err(message)) => error_frame(&id, &command_error(&command, message)),
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

async fn pump_events(
    hub: Arc<EventHub>,
    scope: Scope,
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
    loop {
        if let Some(credit) = &credit {
            while credit.exhausted() {
                backlog.scan(&hub, &scope, cursor);
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
            .filter(|event| event_visible(&scope, &event.event))
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

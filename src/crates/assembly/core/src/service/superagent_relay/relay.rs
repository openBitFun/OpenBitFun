//! The relay engine: one model round per request id, streamed into a
//! numbered chunk log that pollers read by cursor.

use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use futures::StreamExt;
use serde::de::DeserializeOwned;
use serde_json::{json, Value};
use tokio::sync::watch;

use super::dto::{
    FleetModelCancelRequest, FleetModelPollRequest, FleetModelStartRequest, RelayChunk, RelayError,
    RelayMessage, RelayResult, RelayToolCall, RelayToolCallDelta, RelayUsage,
};
use super::provider::{ModelProvider, ModelUsageSink, ProviderRequest};
use super::{FLEET_MODEL_CANCEL, FLEET_MODEL_POLL, FLEET_MODEL_START};
use crate::util::types::{Message, ToolCall, ToolDefinition};

/// Bounds of one relay (per device process).
#[derive(Debug, Clone)]
pub struct RelayLimits {
    /// Rounds running at once on this device.
    pub max_active: usize,
    /// Requests kept (running and finished) for resumable polling.
    pub max_retained: usize,
    /// Total output+result bytes kept across finished rounds before oldest
    /// finished entries are evicted.
    pub max_retained_bytes: usize,
    /// How long a finished round stays readable.
    pub retain_finished: Duration,
    /// Streamed output (text, reasoning, tool arguments) per round.
    pub max_output_bytes: usize,
    /// The start request's JSON size.
    pub max_request_bytes: usize,
    pub max_messages: usize,
    pub max_tools: usize,
    pub max_output_tokens: u32,
    /// The longest a poll waits for its first new chunk.
    pub max_wait: Duration,
    pub max_chunks_per_poll: usize,
}

impl Default for RelayLimits {
    fn default() -> Self {
        Self {
            max_active: 4,
            max_retained: 32,
            max_retained_bytes: 32 * 1024 * 1024,
            retain_finished: Duration::from_secs(5 * 60),
            max_output_bytes: 4 * 1024 * 1024,
            max_request_bytes: 8 * 1024 * 1024,
            max_messages: 1024,
            max_tools: 128,
            max_output_tokens: 128_000,
            max_wait: Duration::from_millis(25_000),
            max_chunks_per_poll: 512,
        }
    }
}

#[derive(Default)]
struct EntryState {
    chunks: Vec<RelayChunk>,
    output_bytes: usize,
    done: bool,
    result: Option<RelayResult>,
    finished_at: Option<Instant>,
}

struct Entry {
    fingerprint: u64,
    created_at: Instant,
    state: Mutex<EntryState>,
    /// Bumped on every new chunk and on finish (pollers wait on it).
    version: watch::Sender<u64>,
    task: Mutex<Option<tokio::task::AbortHandle>>,
}

impl Entry {
    fn state(&self) -> MutexGuard<'_, EntryState> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn bump(&self) {
        self.version.send_modify(|version| *version += 1);
    }

    fn is_done(&self) -> bool {
        self.state().done
    }

    /// Approximate bytes retained by this entry's streamed chunks and final result.
    fn retained_bytes(&self) -> usize {
        let state = self.state();
        let result_bytes = state.result.as_ref().map_or(0, |result| {
            result.text.len()
                + result.reasoning.len()
                + result
                    .tool_calls
                    .iter()
                    .map(|call| call.id.len() + call.name.len() + call.arguments.len())
                    .sum::<usize>()
        });
        state.output_bytes.saturating_add(result_bytes)
    }

    /// Finishes the round once (a later finish, e.g. after a cancel, is a
    /// no-op). Returns whether this call finished it.
    fn finish(&self, result: RelayResult) -> bool {
        {
            let mut state = self.state();
            if state.done {
                return false;
            }
            state.done = true;
            state.result = Some(result);
            state.finished_at = Some(Instant::now());
        }
        self.bump();
        true
    }
}

/// The model relay of this device.
pub struct ModelRelay {
    provider: Arc<dyn ModelProvider>,
    usage: Arc<dyn ModelUsageSink>,
    limits: RelayLimits,
    requests: Mutex<HashMap<String, Arc<Entry>>>,
}

fn invalid(message: impl std::fmt::Display) -> String {
    format!("fleet_model_invalid_request: {message}")
}

fn parse<T: DeserializeOwned>(command: &str, args: &Value) -> Result<T, String> {
    let request = args.get("request").unwrap_or(args);
    serde_json::from_value(request.clone())
        .map_err(|error| invalid(format!("{command} request is unreadable: {error}")))
}

fn valid_request_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
}

fn fingerprint(request: &FleetModelStartRequest) -> u64 {
    let mut hasher = DefaultHasher::new();
    serde_json::to_string(request)
        .unwrap_or_default()
        .hash(&mut hasher);
    hasher.finish()
}

impl ModelRelay {
    pub fn new(
        provider: Arc<dyn ModelProvider>,
        usage: Arc<dyn ModelUsageSink>,
        limits: RelayLimits,
    ) -> Arc<Self> {
        Arc::new(Self {
            provider,
            usage,
            limits,
            requests: Mutex::new(HashMap::new()),
        })
    }

    fn requests(&self) -> MutexGuard<'_, HashMap<String, Arc<Entry>>> {
        self.requests
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    #[cfg(test)]
    pub(crate) fn retained_count(&self) -> usize {
        self.requests().len()
    }

    /// Runs one `fleet_model_*` command.
    pub async fn handle(self: &Arc<Self>, command: &str, args: Value) -> Result<Value, String> {
        match command {
            FLEET_MODEL_START => {
                let size = serde_json::to_vec(&args)
                    .map(|bytes| bytes.len())
                    .unwrap_or(0);
                if size > self.limits.max_request_bytes {
                    return Err(invalid(format!(
                        "the request is {size} bytes; the limit is {}",
                        self.limits.max_request_bytes
                    )));
                }
                self.start(parse(command, &args)?)
            }
            FLEET_MODEL_POLL => self.poll(parse(command, &args)?).await,
            FLEET_MODEL_CANCEL => {
                let answer = self.cancel(parse(command, &args)?);
                if answer.get("cancelled").and_then(Value::as_bool) == Some(true) {
                    self.evict_and_schedule_expiry();
                }
                Ok(answer)
            }
            other => Err(format!(
                "fleet_model_unknown_command: '{other}' is not a model relay command"
            )),
        }
    }

    /// `fleet_model_start`: `{requestId, resumed}`.
    pub fn start(self: &Arc<Self>, request: FleetModelStartRequest) -> Result<Value, String> {
        let provider_request = self.validate(&request)?;
        let print = fingerprint(&request);
        let entry = {
            let mut requests = self.requests();
            self.evict(&mut requests, 1);
            if let Some(existing) = requests.get(&request.request_id) {
                if existing.fingerprint != print {
                    return Err(format!(
                        "fleet_model_request_conflict: request '{}' was already started with a different body",
                        request.request_id
                    ));
                }
                return Ok(json!({ "requestId": request.request_id, "resumed": true }));
            }
            let active = requests.values().filter(|entry| !entry.is_done()).count();
            if active >= self.limits.max_active {
                return Err(format!(
                    "fleet_model_busy: this device is already running {active} relayed rounds; retry shortly or use another device"
                ));
            }
            if requests.len() >= self.limits.max_retained {
                return Err(
                    "fleet_model_busy: this device holds too many relayed rounds; retry shortly"
                        .to_string(),
                );
            }
            let (version, _) = watch::channel(0);
            let entry = Arc::new(Entry {
                fingerprint: print,
                created_at: Instant::now(),
                state: Mutex::new(EntryState::default()),
                version,
                task: Mutex::new(None),
            });
            requests.insert(request.request_id.clone(), Arc::clone(&entry));
            entry
        };
        let relay = Arc::clone(self);
        let run_entry = Arc::clone(&entry);
        let task = tokio::spawn(async move { relay.run(run_entry, provider_request).await });
        *entry
            .task
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(task.abort_handle());
        log::info!(
            "Superagent relay round started: request_id={}",
            request.request_id
        );
        Ok(json!({ "requestId": request.request_id, "resumed": false }))
    }

    /// `fleet_model_poll`: `{requestId, chunks, nextSeq, done, result?}`.
    /// `done` (with `result`) only once every chunk was delivered.
    pub async fn poll(&self, request: FleetModelPollRequest) -> Result<Value, String> {
        let entry = {
            let mut requests = self.requests();
            self.evict(&mut requests, 0);
            requests.get(&request.request_id).cloned()
        }
        .ok_or_else(|| {
            format!(
                "fleet_model_unknown_request: request '{}' is not running or no longer kept on this device; start it again",
                request.request_id
            )
        })?;
        let wait = Duration::from_millis(request.wait_ms).min(self.limits.max_wait);
        let mut changes = entry.version.subscribe();
        let ready = |entry: &Entry| {
            let state = entry.state();
            state.done
                || state
                    .chunks
                    .last()
                    .is_some_and(|chunk| chunk.seq > request.after_seq)
        };
        if !ready(&entry) && !wait.is_zero() {
            let deadline = tokio::time::Instant::now() + wait;
            while !ready(&entry) {
                match tokio::time::timeout_at(deadline, changes.changed()).await {
                    Ok(Ok(())) => continue,
                    _ => break,
                }
            }
        }
        let state = entry.state();
        let chunks: Vec<&RelayChunk> = state
            .chunks
            .iter()
            .filter(|chunk| chunk.seq > request.after_seq)
            .take(self.limits.max_chunks_per_poll)
            .collect();
        let next_seq = chunks.last().map_or(request.after_seq, |chunk| chunk.seq);
        let last_seq = state.chunks.last().map_or(0, |chunk| chunk.seq);
        let done = state.done && next_seq >= last_seq;
        let mut answer = json!({
            "requestId": request.request_id,
            "chunks": chunks,
            "nextSeq": next_seq,
            "done": done,
        });
        if done {
            answer["result"] = serde_json::to_value(&state.result).unwrap_or(Value::Null);
        }
        Ok(answer)
    }

    /// `fleet_model_cancel`: `{requestId, cancelled}` (idempotent; an unknown
    /// or finished request answers `false`).
    pub fn cancel(&self, request: FleetModelCancelRequest) -> Value {
        let entry = self.requests().get(&request.request_id).cloned();
        let cancelled = entry.is_some_and(|entry| {
            let finished = entry.finish(RelayResult {
                finish_reason: Some("cancelled".to_string()),
                error: Some(RelayError::new(
                    "fleet_model_cancelled",
                    "the round was cancelled by the caller",
                )),
                ..RelayResult::default()
            });
            if let Some(task) = entry
                .task
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .take()
            {
                task.abort();
            }
            finished
        });
        if cancelled {
            log::info!(
                "Superagent relay round cancelled: request_id={}",
                request.request_id
            );
        }
        json!({ "requestId": request.request_id, "cancelled": cancelled })
    }

    /// Immediately applies retention caps and schedules a one-shot expiry sweep
    /// for `retain_finished` so completed rounds do not linger indefinitely
    /// when no further calls arrive.
    fn evict_and_schedule_expiry(self: &Arc<Self>) {
        {
            let mut requests = self.requests();
            self.evict(&mut requests, 0);
        }
        let delay = self.limits.retain_finished;
        let weak = Arc::downgrade(self);
        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            handle.spawn(async move {
                tokio::time::sleep(delay).await;
                if let Some(relay) = weak.upgrade() {
                    let mut requests = relay.requests();
                    relay.evict(&mut requests, 0);
                }
            });
        }
    }

    /// Drops finished rounds past their retention TTL, then evicts the oldest
    /// finished rounds until both the entry count and total retained byte caps
    /// are satisfied.
    fn evict(&self, requests: &mut HashMap<String, Arc<Entry>>, reserve_slots: usize) {
        let now = Instant::now();
        let retain = self.limits.retain_finished;
        requests.retain(|_, entry| {
            entry
                .state()
                .finished_at
                .is_none_or(|finished| now.duration_since(finished) < retain)
        });
        let max_count = self.limits.max_retained.saturating_sub(reserve_slots);
        while requests.len() > max_count {
            let oldest = requests
                .iter()
                .filter(|(_, entry)| entry.is_done())
                .min_by_key(|(_, entry)| entry.created_at)
                .map(|(id, _)| id.clone());
            match oldest {
                Some(id) => {
                    requests.remove(&id);
                }
                None => break,
            }
        }
        let mut finished_bytes: usize = requests
            .values()
            .filter(|entry| entry.is_done())
            .map(|entry| entry.retained_bytes())
            .sum();
        while finished_bytes > self.limits.max_retained_bytes {
            let oldest = requests
                .iter()
                .filter(|(_, entry)| entry.is_done())
                .min_by_key(|(_, entry)| entry.created_at)
                .map(|(id, entry)| (id.clone(), entry.retained_bytes()));
            match oldest {
                Some((id, bytes)) => {
                    requests.remove(&id);
                    finished_bytes = finished_bytes.saturating_sub(bytes);
                }
                None => break,
            }
        }
    }

    fn validate(&self, request: &FleetModelStartRequest) -> Result<ProviderRequest, String> {
        if !valid_request_id(&request.request_id) {
            return Err(invalid(
                "requestId must be 1-128 characters of letters, digits, '-', '_', '.' or ':'",
            ));
        }
        if request.messages.is_empty() {
            return Err(invalid("messages must not be empty"));
        }
        if request.messages.len() > self.limits.max_messages {
            return Err(invalid(format!(
                "at most {} messages are relayed",
                self.limits.max_messages
            )));
        }
        if request.tools.len() > self.limits.max_tools {
            return Err(invalid(format!(
                "at most {} tools are relayed",
                self.limits.max_tools
            )));
        }
        if let Some(limit) = request.max_output_tokens {
            if limit == 0 || limit > self.limits.max_output_tokens {
                return Err(invalid(format!(
                    "maxOutputTokens must be between 1 and {}",
                    self.limits.max_output_tokens
                )));
            }
        }
        let mut messages = Vec::with_capacity(request.messages.len() + 1);
        if !request.system.trim().is_empty() {
            messages.push(Message::system(request.system.clone()));
        }
        for message in &request.messages {
            messages.push(to_message(message)?);
        }
        let mut tools = Vec::with_capacity(request.tools.len());
        for tool in &request.tools {
            if tool.name.trim().is_empty() {
                return Err(invalid("a tool needs a name"));
            }
            tools.push(ToolDefinition {
                name: tool.name.clone(),
                description: tool.description.clone(),
                parameters: if tool.parameters.is_null() {
                    json!({ "type": "object", "properties": {} })
                } else {
                    tool.parameters.clone()
                },
            });
        }
        Ok(ProviderRequest {
            request_id: request.request_id.clone(),
            model: request
                .model
                .as_ref()
                .map(|model| model.trim().to_string())
                .filter(|model| !model.is_empty()),
            messages,
            tools,
            max_output_tokens: request.max_output_tokens,
        })
    }

    async fn run(self: Arc<Self>, entry: Arc<Entry>, request: ProviderRequest) {
        let request_id = request.request_id.clone();
        let opened = match self.provider.open(request).await {
            Ok(opened) => opened,
            Err(error) => {
                log::warn!(
                    "Superagent relay round failed to open: request_id={}, code={}",
                    request_id,
                    error.code
                );
                if entry.finish(RelayResult {
                    error: Some(error),
                    ..RelayResult::default()
                }) {
                    self.evict_and_schedule_expiry();
                }
                return;
            }
        };
        let mut stream = opened.stream;
        let mut round = Round::new(opened.model_name.clone());
        let mut failure = None;
        while let Some(item) = stream.next().await {
            if entry.is_done() {
                // Cancelled while the provider was answering.
                return;
            }
            let response = match item {
                Ok(response) => response,
                Err(error) => {
                    failure = Some(RelayError::new(
                        "fleet_model_provider_error",
                        format!("the model stream failed: {error}"),
                    ));
                    break;
                }
            };
            let chunks = round.absorb(response);
            if !chunks.is_empty() {
                let mut state = entry.state();
                if state.done {
                    return;
                }
                for mut chunk in chunks {
                    state.output_bytes += chunk_bytes(&chunk);
                    chunk.seq = state.chunks.len() as u64 + 1;
                    state.chunks.push(chunk);
                }
                let over = state.output_bytes > self.limits.max_output_bytes;
                drop(state);
                entry.bump();
                if over {
                    failure = Some(RelayError::new(
                        "fleet_model_output_too_large",
                        format!(
                            "the round produced more than {} bytes",
                            self.limits.max_output_bytes
                        ),
                    ));
                    break;
                }
            }
        }
        let usage = round.usage;
        let mut result = round.into_result();
        result.error = failure;
        let ok = result.error.is_none();
        if entry.finish(result) {
            self.evict_and_schedule_expiry();
            log::info!(
                "Superagent relay round finished: request_id={}, ok={}",
                request_id,
                ok
            );
            if let Some(usage) = usage {
                self.usage
                    .record(request_id, opened.model_id, opened.model_name, usage)
                    .await;
            }
        }
    }
}

fn chunk_bytes(chunk: &RelayChunk) -> usize {
    chunk.text.as_ref().map_or(0, String::len)
        + chunk.reasoning.as_ref().map_or(0, String::len)
        + chunk.tool_call.as_ref().map_or(0, |call| {
            call.arguments_delta.as_ref().map_or(0, String::len)
                + call.name.as_ref().map_or(0, String::len)
                + call.id.as_ref().map_or(0, String::len)
        })
}

fn to_message(message: &RelayMessage) -> Result<Message, String> {
    match message.role.as_str() {
        "user" => Ok(Message::user(message.content.clone())),
        "assistant" => {
            if message.tool_calls.is_empty() {
                return Ok(Message::assistant(message.content.clone()));
            }
            let calls = message
                .tool_calls
                .iter()
                .map(|call| ToolCall {
                    id: call.id.clone(),
                    name: call.name.clone(),
                    arguments: serde_json::from_str(&call.arguments)
                        .unwrap_or_else(|_| json!({})),
                    raw_arguments: Some(call.arguments.clone()),
                })
                .collect();
            let mut assistant = Message::assistant_with_tools(calls);
            if !message.content.is_empty() {
                assistant.content = Some(message.content.clone());
            }
            Ok(assistant)
        }
        "tool" => {
            let call_id = message
                .tool_call_id
                .clone()
                .filter(|id| !id.is_empty())
                .ok_or_else(|| invalid("a tool message needs toolCallId"))?;
            let mut result = Message::user(message.content.clone());
            result.role = "tool".to_string();
            result.tool_call_id = Some(call_id);
            result.name = message.name.clone();
            result.is_error = Some(message.is_error.unwrap_or(false));
            Ok(result)
        }
        other => Err(invalid(format!(
            "message role '{other}' is not relayed (use user, assistant or tool; the system prompt goes in `system`)"
        ))),
    }
}

/// Accumulates one round's stream into chunks and the final result.
struct Round {
    model: String,
    text: String,
    reasoning: String,
    calls: Vec<CallSlot>,
    usage: Option<RelayUsage>,
    finish_reason: Option<String>,
}

struct CallSlot {
    provider_index: Option<usize>,
    id: String,
    name: String,
    arguments: String,
}

impl Round {
    fn new(model: String) -> Self {
        Self {
            model,
            text: String::new(),
            reasoning: String::new(),
            calls: Vec::new(),
            usage: None,
            finish_reason: None,
        }
    }

    fn absorb(&mut self, response: openbitfun_ai_adapters::UnifiedResponse) -> Vec<RelayChunk> {
        let mut chunks = Vec::new();
        if let Some(model) = response.response_model.filter(|model| !model.is_empty()) {
            self.model = model;
        }
        if let Some(text) = response.text.filter(|text| !text.is_empty()) {
            self.text.push_str(&text);
            chunks.push(RelayChunk {
                seq: 0,
                text: Some(text),
                reasoning: None,
                tool_call: None,
            });
        }
        if let Some(reasoning) = response.reasoning_content.filter(|text| !text.is_empty()) {
            self.reasoning.push_str(&reasoning);
            chunks.push(RelayChunk {
                seq: 0,
                text: None,
                reasoning: Some(reasoning),
                tool_call: None,
            });
        }
        if let Some(call) = response.tool_call {
            if let Some(delta) = self.absorb_call(call) {
                chunks.push(RelayChunk {
                    seq: 0,
                    text: None,
                    reasoning: None,
                    tool_call: Some(delta),
                });
            }
        }
        if let Some(usage) = response.usage {
            self.usage = Some(RelayUsage {
                input_tokens: usage.prompt_token_count,
                output_tokens: usage.candidates_token_count,
                cached_tokens: usage.cached_content_token_count,
            });
        }
        if let Some(reason) = response.finish_reason.filter(|reason| !reason.is_empty()) {
            self.finish_reason = Some(reason);
        }
        chunks
    }

    fn absorb_call(
        &mut self,
        call: openbitfun_ai_adapters::UnifiedToolCall,
    ) -> Option<RelayToolCallDelta> {
        let id = call.id.filter(|id| !id.is_empty());
        let slot = match call.tool_call_index {
            Some(index) => self
                .calls
                .iter()
                .position(|slot| slot.provider_index == Some(index)),
            None => match &id {
                Some(id) => self.calls.iter().position(|slot| &slot.id == id),
                None => self.calls.len().checked_sub(1),
            },
        };
        let slot = match slot {
            Some(slot) => slot,
            None => {
                self.calls.push(CallSlot {
                    provider_index: call.tool_call_index,
                    id: String::new(),
                    name: String::new(),
                    arguments: String::new(),
                });
                self.calls.len() - 1
            }
        };
        let entry = &mut self.calls[slot];
        let mut delta = RelayToolCallDelta {
            index: slot,
            id: None,
            name: None,
            arguments_delta: None,
        };
        if let Some(id) = id.filter(|id| *id != entry.id) {
            entry.id = id.clone();
            delta.id = Some(id);
        }
        if let Some(name) = call
            .name
            .filter(|name| !name.is_empty() && *name != entry.name)
        {
            entry.name = name.clone();
            delta.name = Some(name);
        }
        if let Some(arguments) = call.arguments.filter(|arguments| !arguments.is_empty()) {
            if call.arguments_is_snapshot {
                // A snapshot replaces the arguments; only a pure extension is
                // streamed as a delta (the result always carries the whole).
                if let Some(suffix) = arguments.strip_prefix(entry.arguments.as_str()) {
                    if !suffix.is_empty() {
                        delta.arguments_delta = Some(suffix.to_string());
                    }
                }
                entry.arguments = arguments;
            } else {
                entry.arguments.push_str(&arguments);
                delta.arguments_delta = Some(arguments);
            }
        }
        (delta.id.is_some() || delta.name.is_some() || delta.arguments_delta.is_some())
            .then_some(delta)
    }

    fn into_result(self) -> RelayResult {
        RelayResult {
            text: self.text,
            reasoning: self.reasoning,
            tool_calls: self
                .calls
                .into_iter()
                .filter(|slot| !slot.name.is_empty())
                .map(|slot| RelayToolCall {
                    id: slot.id,
                    name: slot.name,
                    arguments: if slot.arguments.trim().is_empty() {
                        "{}".to_string()
                    } else {
                        slot.arguments
                    },
                })
                .collect(),
            finish_reason: self.finish_reason,
            model: self.model,
            usage: self.usage,
            error: None,
        }
    }
}

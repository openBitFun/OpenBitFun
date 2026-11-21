//! The account-wide model catalog on a runtime host.
//!
//! - **Publishing**: [`catalog_of`] projects this device's configured chat
//!   models (never another device's relay entries) into the fleet digest's
//!   `models` ([`local_catalog`]); [`follow_model_config`] re-reads the digest
//!   when the user changes models.
//! - **Using another device's model**: the host installs [`FleetModelPeers`]
//!   (its fleet index and Link calls) with [`install_peers`], and
//!   [`sync_runtime_models`] mirrors every other device's published models as
//!   runtime model entries (provider `fleet_relay`, id
//!   `fleet:<deviceId>/<modelId>`, no credentials, never persisted). A session
//!   bound to such an entry resolves like any configured model, and each of
//!   its rounds runs on the owner through its model relay
//!   (`fleet_model_start` / `_poll` / `_cancel`): [`FleetRelayTransport`].
//!   Credentials never leave the owner.
//! - **Failing loudly**: a round whose owner is offline fails at once with
//!   "{model} lives on {device}, which is offline" (never retried, never a
//!   local fallback); a stored reference this host cannot resolve fails the
//!   turn instead of running the primary model ([`unresolved_model_error`]).
//!
//! Remote scenarios: the session's runtime (this host) and the model's owner
//! are two devices of one account over Link; a phone or browser only picks
//! the reference (display-only). A Detached Dispatch job keeps its own
//! target-local models.

use std::collections::BTreeMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex, OnceLock, RwLock};
use std::time::Duration;

use futures::StreamExt;
use openbitfun_ai_adapters::client::relay_transport::{
    install_relay_transport, RelayStreamFuture, RelayStreamRequest, RelayStreamTransport,
};
use openbitfun_ai_adapters::tool_call_accumulator::ToolCallCompletion;
use openbitfun_ai_adapters::{StreamResponse, UnifiedResponse, UnifiedTokenUsage, UnifiedToolCall};
use openbitfun_core_types::errors::{AiProviderError, ErrorCategory};
use openbitfun_product_domains::fleet::{
    device_model_ref, device_offline_message, parse_model_ref, FleetModel, FleetModelRef,
    FleetModels, FLEET_MODEL_UNAVAILABLE, FLEET_RELAY_PROVIDER, MAX_MODELS_PER_DEVICE,
};
use serde_json::{json, Value};

use crate::service::config::types::{AIModelConfig, ModelCapability};
use crate::service::superagent_relay::{
    RelayChunk, RelayMessage, RelayResult, RelayTool, RelayToolCall, FLEET_MODEL_CANCEL,
    FLEET_MODEL_POLL, FLEET_MODEL_START,
};
use crate::util::types::{Message, ToolDefinition};

/// A boxed future borrowing its receiver.
pub type PeersFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// The longest one relay call may take (a poll waits up to 20 s).
const CALL_TIMEOUT: Duration = Duration::from_secs(45);
/// How long one poll waits for new chunks on the owner.
const POLL_WAIT_MS: u64 = 20_000;
/// Poll failures in a row before the round fails (a poll resumes by cursor).
const MAX_POLL_FAILURES: u32 = 3;
/// The relay's bound on `maxOutputTokens`.
const MAX_RELAY_OUTPUT_TOKENS: u32 = 128_000;

// ---------------------------------------------------------------------------
// Publishing this device's catalog
// ---------------------------------------------------------------------------

fn capability_name(capability: &ModelCapability) -> Option<String> {
    serde_json::to_value(capability)
        .ok()
        .and_then(|value| value.as_str().map(str::to_string))
}

/// This device's configured chat models as its digest publishes them:
/// enabled text models only, never another device's relay entries, the
/// primary model marked.
pub fn catalog_of(ai: &crate::service::config::types::AIConfig) -> Vec<FleetModel> {
    let primary = ai.resolve_model_selection("primary");
    let mut models: Vec<FleetModel> = ai
        .models
        .iter()
        .filter(|model| {
            model.enabled
                && model.supports_text_generation()
                && model.provider != FLEET_RELAY_PROVIDER
                && parse_model_ref(&model.id) == FleetModelRef::Local(model.id.trim())
        })
        .map(|model| FleetModel {
            model_id: model.id.clone(),
            display_name: if model.name.trim().is_empty() {
                model.model_name.clone()
            } else {
                model.name.clone()
            },
            provider: model.provider.clone(),
            model_name: model.model_name.clone(),
            capabilities: model
                .capabilities
                .iter()
                .filter_map(capability_name)
                .collect(),
            context_window: model.context_window,
            primary: primary.as_deref() == Some(model.id.as_str()),
        })
        .collect();
    openbitfun_product_domains::fleet::bound_catalog(&mut models);
    models
}

/// This device's catalog now; an unreadable configuration publishes an
/// empty one (this build has a catalog, it just lists nothing).
pub async fn local_catalog() -> Vec<FleetModel> {
    let service = match crate::service::config::get_global_config_service().await {
        Ok(service) => service,
        Err(error) => {
            log::debug!("Fleet model catalog empty: the config service is not running: {error}");
            return Vec::new();
        }
    };
    match service.get_effective_ai_config().await {
        Ok(ai) => catalog_of(&ai),
        Err(error) => {
            log::warn!("Fleet model catalog empty: the AI config is unreadable: {error}");
            Vec::new()
        }
    }
}

/// Marks the digest dirty whenever the user changes a setting (models
/// included), so the catalog follows within the coalescing window.
pub async fn follow_model_config(producer: &Arc<super::FleetDigestProducer>) {
    let Ok(service) = crate::service::config::get_global_config_service().await else {
        return;
    };
    let mut changes = service.subscribe_local_changes();
    let weak = Arc::downgrade(producer);
    tokio::spawn(async move {
        while changes.changed().await.is_ok() {
            let Some(producer) = weak.upgrade() else {
                return;
            };
            producer.notify_changed();
        }
    });
}

// ---------------------------------------------------------------------------
// The host's view of the other devices
// ---------------------------------------------------------------------------

/// A model's owner as the host's fleet index knows it.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ModelOwner {
    pub name: String,
    pub online: bool,
    /// The owner's published catalog; `None` for a build without one.
    pub models: Option<Vec<FleetModel>>,
}

/// What a host provides so sessions can use other devices' models.
pub trait FleetModelPeers: Send + Sync + 'static {
    /// This device's id on the account.
    fn self_device_id(&self) -> String;
    /// A device of the account as the index knows it now.
    fn owner(&self, device_id: &str) -> Option<ModelOwner>;
    /// One relay command on that device over the account device network.
    fn call<'a>(
        &'a self,
        device_id: &'a str,
        command: &'a str,
        args: Value,
    ) -> PeersFuture<'a, Result<Value, String>>;
}

static PEERS: RwLock<Option<Arc<dyn FleetModelPeers>>> = RwLock::new(None);

fn peers() -> Option<Arc<dyn FleetModelPeers>> {
    PEERS
        .read()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone()
}

/// Installs the host's peers (when its fleet starts) and the relay transport
/// of the AI adapters (once per process).
pub fn install_peers(peers: Arc<dyn FleetModelPeers>) {
    *PEERS
        .write()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(peers);
    install_transport();
}

/// Forgets the host's peers (its fleet stopped). Stored references keep
/// resolving; their rounds fail with a clear reason until the fleet runs.
pub fn clear_peers() {
    PEERS
        .write()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .take();
}

/// Installs [`FleetRelayTransport`] into the AI adapters (idempotent).
pub fn install_transport() {
    static INSTALLED: OnceLock<()> = OnceLock::new();
    INSTALLED.get_or_init(|| install_relay_transport(Arc::new(FleetRelayTransport)));
}

/// The model of `raw` on this device when it names one of this device's
/// models (plain, or qualified with this device's own id).
pub fn local_model_ref(raw: &str) -> String {
    match parse_model_ref(raw) {
        FleetModelRef::Local(model_id) => model_id.to_string(),
        FleetModelRef::Device {
            device_id,
            model_id,
        } if peers().is_some_and(|peers| peers.self_device_id() == device_id) => {
            model_id.to_string()
        }
        FleetModelRef::Device { .. } => raw.trim().to_string(),
    }
}

/// The error of a stored reference to another device's model that this
/// host cannot resolve (`None` for any other reference): the turn fails with
/// it instead of falling back to a local model.
pub fn unresolved_model_error(raw: &str) -> Option<String> {
    let FleetModelRef::Device {
        device_id,
        model_id,
    } = parse_model_ref(raw)
    else {
        return None;
    };
    let owner = peers().and_then(|peers| peers.owner(device_id));
    Some(match owner {
        Some(owner) if !owner.online => device_offline_message(model_id, &owner.name),
        Some(owner) => format!(
            "{FLEET_MODEL_UNAVAILABLE}: {model_id} is not offered by {} anymore; pick another model",
            owner.name
        ),
        None => format!(
            "{FLEET_MODEL_UNAVAILABLE}: {model_id} lives on a device this host does not know now ({device_id}); sign in to the account's device network or pick another model"
        ),
    })
}

// ---------------------------------------------------------------------------
// Runtime entries for other devices' models
// ---------------------------------------------------------------------------

/// The runtime model entry that stands for `model` of `device_id`.
pub fn runtime_entry(device_id: &str, device_name: &str, model: &FleetModel) -> AIModelConfig {
    let model_ref = device_model_ref(device_id, &model.model_id);
    let display = if model.display_name.trim().is_empty() {
        model.model_id.clone()
    } else {
        model.display_name.clone()
    };
    let mut capabilities: Vec<ModelCapability> = model
        .capabilities
        .iter()
        .filter_map(|name| serde_json::from_value(Value::String(name.clone())).ok())
        .collect();
    if !capabilities.contains(&ModelCapability::TextChat) {
        capabilities.insert(0, ModelCapability::TextChat);
    }
    AIModelConfig {
        id: model_ref.clone(),
        name: format!("{display} ({device_name})"),
        provider: FLEET_RELAY_PROVIDER.to_string(),
        model_name: if model.model_name.trim().is_empty() {
            model.model_id.clone()
        } else {
            model.model_name.clone()
        },
        base_url: model_ref.clone(),
        request_url: Some(model_ref),
        api_key: String::new(),
        context_window: model.context_window,
        enabled: true,
        capabilities,
        ..AIModelConfig::default()
    }
}

fn installed() -> &'static Mutex<BTreeMap<String, AIModelConfig>> {
    static INSTALLED: OnceLock<Mutex<BTreeMap<String, AIModelConfig>>> = OnceLock::new();
    INSTALLED.get_or_init(|| Mutex::new(BTreeMap::new()))
}

/// The runtime entries the catalog asks for: every model of every other
/// device that publishes one (offline devices included, so a stored
/// reference resolves and its round fails fast with the offline reason).
pub fn wanted_entries(view: &FleetModels) -> BTreeMap<String, AIModelConfig> {
    view.devices
        .iter()
        .filter(|device| !device.is_this_device)
        .flat_map(|device| {
            device
                .models
                .iter()
                .take(MAX_MODELS_PER_DEVICE)
                .map(|choice| runtime_entry(&device.device_id, &device.name, &choice.model))
        })
        .map(|entry| (entry.id.clone(), entry))
        .collect()
}

/// Mirrors the account catalog (relative to this host) as runtime model
/// entries: installs new and changed ones, removes the ones no device
/// publishes anymore. Cheap when nothing changed.
pub async fn sync_runtime_models(view: &FleetModels) {
    let wanted = wanted_entries(view);
    let (install, remove) = {
        let held = installed().lock().unwrap_or_else(|p| p.into_inner());
        let install: Vec<AIModelConfig> = wanted
            .values()
            .filter(|entry| {
                held.get(&entry.id)
                    .map(serde_json::to_value)
                    .and_then(Result::ok)
                    != serde_json::to_value(entry).ok()
            })
            .cloned()
            .collect();
        let remove: Vec<String> = held
            .keys()
            .filter(|id| !wanted.contains_key(*id))
            .cloned()
            .collect();
        (install, remove)
    };
    if install.is_empty() && remove.is_empty() {
        return;
    }
    let Ok(service) = crate::service::config::get_global_config_service().await else {
        return;
    };
    let factory = crate::infrastructure::ai::get_global_ai_client_factory()
        .await
        .ok();
    for entry in &install {
        if let Err(error) = service.install_runtime_ai_model(entry.clone()).await {
            log::warn!(
                "Fleet model entry not installed: id={}, error={}",
                entry.id,
                error
            );
            continue;
        }
        if let Some(factory) = factory.as_ref() {
            factory.invalidate_model(&entry.id);
        }
        installed()
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .insert(entry.id.clone(), entry.clone());
    }
    for id in &remove {
        service.remove_runtime_ai_model(id).await;
        if let Some(factory) = factory.as_ref() {
            factory.invalidate_model(id);
        }
        installed()
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .remove(id);
    }
    log::info!(
        "Fleet model entries synced: installed={}, removed={}",
        install.len(),
        remove.len()
    );
}

// ---------------------------------------------------------------------------
// Rounds on the owner
// ---------------------------------------------------------------------------

fn provider_error(message: String, category: ErrorCategory, code: &str) -> anyhow::Error {
    let mut error = AiProviderError::classified(message, category);
    error.provider = Some(FLEET_RELAY_PROVIDER.to_string());
    error.provider_code = Some(code.to_string());
    anyhow::Error::new(error)
}

/// The relay request of one round: system messages become `system`, tool
/// calls and results keep their ids, and images stay on this device (the
/// owner sees a note instead).
pub fn relay_start_request(
    request_id: &str,
    model_id: &str,
    messages: &[Message],
    tools: Option<&[ToolDefinition]>,
    max_output_tokens: Option<u32>,
) -> Value {
    let mut system = Vec::new();
    let mut relayed = Vec::new();
    for message in messages {
        let content = message.content.clone().unwrap_or_default();
        match message.role.as_str() {
            "system" => {
                if !content.trim().is_empty() {
                    system.push(content);
                }
            }
            "assistant" => relayed.push(RelayMessage {
                role: "assistant".to_string(),
                content,
                tool_calls: message
                    .tool_calls
                    .iter()
                    .flatten()
                    .map(|call| RelayToolCall {
                        id: call.id.clone(),
                        name: call.name.clone(),
                        arguments: call.serialized_arguments(),
                    })
                    .collect(),
                tool_call_id: None,
                name: None,
                is_error: None,
            }),
            "tool" => relayed.push(RelayMessage {
                role: "tool".to_string(),
                content: with_image_note(content, message),
                tool_calls: Vec::new(),
                tool_call_id: message.tool_call_id.clone(),
                name: message.name.clone(),
                is_error: message.is_error,
            }),
            _ => relayed.push(RelayMessage {
                role: "user".to_string(),
                content: with_image_note(content, message),
                tool_calls: Vec::new(),
                tool_call_id: None,
                name: None,
                is_error: None,
            }),
        }
    }
    let tools: Vec<RelayTool> = tools
        .unwrap_or_default()
        .iter()
        .map(|tool| RelayTool {
            name: tool.name.clone(),
            description: tool.description.clone(),
            parameters: tool.parameters.clone(),
        })
        .collect();
    let mut start = json!({
        "requestId": request_id,
        "model": model_id,
        "system": system.join("\n\n"),
        "messages": relayed,
        "tools": tools,
    });
    if let Some(limit) = max_output_tokens.filter(|limit| *limit > 0) {
        start["maxOutputTokens"] = json!(limit.min(MAX_RELAY_OUTPUT_TOKENS));
    }
    json!({ "request": start })
}

fn with_image_note(content: String, message: &Message) -> String {
    let images = message.tool_image_attachments.as_ref().map_or(0, Vec::len);
    if images == 0 {
        return content;
    }
    format!("{content}\n[{images} image(s) omitted: the model runs on another device]")
}

/// One relay chunk as a stream response.
pub fn chunk_response(chunk: &RelayChunk) -> UnifiedResponse {
    UnifiedResponse {
        text: chunk.text.clone(),
        reasoning_content: chunk.reasoning.clone(),
        tool_call: chunk.tool_call.as_ref().map(|call| UnifiedToolCall {
            tool_call_index: Some(call.index),
            id: call.id.clone(),
            name: call.name.clone(),
            arguments: call.arguments_delta.clone(),
            arguments_is_snapshot: false,
        }),
        ..UnifiedResponse::default()
    }
}

/// The finished round as the stream's last response, or its error.
pub fn finish_response(result: RelayResult) -> anyhow::Result<UnifiedResponse> {
    if let Some(error) = result.error {
        let category = match error.code.as_str() {
            "fleet_model_busy" => ErrorCategory::RateLimit,
            "fleet_model_provider_error" => ErrorCategory::ProviderUnavailable,
            "fleet_model_output_too_large" | "fleet_model_cancelled" => ErrorCategory::ModelError,
            _ => ErrorCategory::InvalidRequest,
        };
        return Err(provider_error(
            format!("{}: {}", error.code, error.message),
            category,
            &error.code,
        ));
    }
    let finish_reason = result.finish_reason.unwrap_or_else(|| {
        if result.tool_calls.is_empty() {
            "stop".to_string()
        } else {
            "tool_calls".to_string()
        }
    });
    let completion = if matches!(finish_reason.as_str(), "length" | "max_tokens") {
        ToolCallCompletion::OutputLimit
    } else if result.tool_calls.is_empty() {
        ToolCallCompletion::NormalNoToolUse
    } else {
        ToolCallCompletion::NormalToolUse
    };
    Ok(UnifiedResponse {
        response_model: Some(result.model).filter(|model| !model.is_empty()),
        usage: result.usage.map(|usage| UnifiedTokenUsage {
            prompt_token_count: usage.input_tokens,
            candidates_token_count: usage.output_tokens,
            total_token_count: usage.input_tokens.saturating_add(usage.output_tokens),
            reasoning_token_count: None,
            cached_content_token_count: usage.cached_tokens,
            cache_creation_token_count: None,
        }),
        tool_call_completion: Some(completion),
        finish_reason: Some(finish_reason),
        ..UnifiedResponse::default()
    })
}

/// The AI adapters' transport for `fleet_relay` entries: one round on the
/// model's owner through its relay, streamed back chunk by chunk.
pub struct FleetRelayTransport;

impl RelayStreamTransport for FleetRelayTransport {
    fn open(&self, request: RelayStreamRequest) -> RelayStreamFuture {
        Box::pin(open_round(request))
    }
}

async fn open_round(request: RelayStreamRequest) -> anyhow::Result<StreamResponse> {
    let reference = request.config.request_url.trim().to_string();
    let FleetModelRef::Device {
        device_id,
        model_id,
    } = parse_model_ref(&reference)
    else {
        return Err(provider_error(
            format!(
                "{FLEET_MODEL_UNAVAILABLE}: '{reference}' does not name a model of another device"
            ),
            ErrorCategory::InvalidRequest,
            FLEET_MODEL_UNAVAILABLE,
        ));
    };
    let (device_id, model_id) = (device_id.to_string(), model_id.to_string());
    let Some(peers) = peers() else {
        return Err(provider_error(
            format!("{FLEET_MODEL_UNAVAILABLE}: {model_id} runs on another device, and this device is not on the account's device network now"),
            ErrorCategory::InvalidRequest,
            FLEET_MODEL_UNAVAILABLE,
        ));
    };
    let label = request.config.name.clone();
    match peers.owner(&device_id) {
        Some(owner) if owner.online => {}
        Some(owner) => {
            let model = owner
                .models
                .iter()
                .flatten()
                .find(|model| model.model_id == model_id)
                .map(|model| model.display_name.clone())
                .filter(|name| !name.trim().is_empty())
                .unwrap_or_else(|| model_id.clone());
            return Err(provider_error(
                device_offline_message(&model, &owner.name),
                ErrorCategory::InvalidRequest,
                openbitfun_product_domains::fleet::FLEET_MODEL_DEVICE_OFFLINE,
            ));
        }
        None => {
            return Err(provider_error(
                format!("{FLEET_MODEL_UNAVAILABLE}: {label} lives on a device this host does not know now"),
                ErrorCategory::InvalidRequest,
                FLEET_MODEL_UNAVAILABLE,
            ));
        }
    }
    let request_id = format!("dev-{}", uuid::Uuid::new_v4().simple());
    let start = relay_start_request(
        &request_id,
        &model_id,
        &request.messages,
        request.tools.as_deref(),
        request.config.max_tokens,
    );
    let started = tokio::time::timeout(
        CALL_TIMEOUT,
        peers.call(&device_id, FLEET_MODEL_START, start),
    )
    .await
    .map_err(|_| "the owner did not answer in time".to_string())
    .and_then(|answer| answer);
    if let Err(error) = started {
        let category = if error.starts_with("fleet_model_busy") {
            ErrorCategory::RateLimit
        } else if error.starts_with("fleet_model_") || error.starts_with("forbidden_for_scope") {
            ErrorCategory::InvalidRequest
        } else {
            ErrorCategory::Network
        };
        return Err(provider_error(
            format!("the round could not start on {device_id}: {error}"),
            category,
            "fleet_model_start_failed",
        ));
    }
    log::info!(
        "Fleet model round started on its owner: device_id={}, request_id={}",
        device_id,
        request_id
    );
    let (sender, receiver) = tokio::sync::mpsc::channel::<anyhow::Result<UnifiedResponse>>(64);
    tokio::spawn(poll_round(peers, device_id, request_id, sender));
    let stream = futures::stream::unfold(receiver, |mut receiver| async move {
        receiver.recv().await.map(|item| (item, receiver))
    })
    .boxed();
    Ok(StreamResponse {
        stream,
        raw_sse_rx: None,
        trace_handle: None,
    })
}

async fn poll_round(
    peers: Arc<dyn FleetModelPeers>,
    device_id: String,
    request_id: String,
    sender: tokio::sync::mpsc::Sender<anyhow::Result<UnifiedResponse>>,
) {
    let mut after_seq = 0u64;
    let mut failures = 0u32;
    loop {
        if sender.is_closed() {
            break;
        }
        let poll = json!({ "request": {
            "requestId": request_id,
            "afterSeq": after_seq,
            "waitMs": POLL_WAIT_MS,
        }});
        let answer = tokio::select! {
            answer = tokio::time::timeout(CALL_TIMEOUT, peers.call(&device_id, FLEET_MODEL_POLL, poll)) => answer,
            _ = sender.closed() => break,
        };
        let answer = match answer {
            Ok(Ok(answer)) => {
                failures = 0;
                answer
            }
            Ok(Err(error)) if error.starts_with("fleet_model_unknown_request") => {
                let _ = sender
                    .send(Err(provider_error(
                        format!("the owner lost the round: {error}"),
                        ErrorCategory::Network,
                        "fleet_model_round_lost",
                    )))
                    .await;
                return;
            }
            failed => {
                failures += 1;
                let error = match failed {
                    Ok(Err(error)) => error,
                    _ => "the owner did not answer in time".to_string(),
                };
                if failures >= MAX_POLL_FAILURES {
                    let _ = sender
                        .send(Err(provider_error(
                            format!("the link to {device_id} broke during the round: {error}"),
                            ErrorCategory::Network,
                            "fleet_model_link_lost",
                        )))
                        .await;
                    return;
                }
                tokio::time::sleep(Duration::from_millis(500 * u64::from(failures))).await;
                continue;
            }
        };
        let chunks: Vec<RelayChunk> = answer
            .get("chunks")
            .cloned()
            .and_then(|chunks| serde_json::from_value(chunks).ok())
            .unwrap_or_default();
        for chunk in &chunks {
            after_seq = after_seq.max(chunk.seq);
            if sender.send(Ok(chunk_response(chunk))).await.is_err() {
                break;
            }
        }
        if let Some(next) = answer.get("nextSeq").and_then(Value::as_u64) {
            after_seq = after_seq.max(next);
        }
        if answer.get("done").and_then(Value::as_bool) == Some(true) {
            let result: RelayResult = answer
                .get("result")
                .cloned()
                .and_then(|result| serde_json::from_value(result).ok())
                .unwrap_or_default();
            let _ = sender.send(finish_response(result)).await;
            return;
        }
    }
    // The caller dropped the stream (cancelled): stop the owner's round.
    let cancel = json!({ "request": { "requestId": request_id } });
    if let Err(error) = peers.call(&device_id, FLEET_MODEL_CANCEL, cancel).await {
        log::debug!(
            "Fleet model round cancel not delivered: device_id={}, error={}",
            device_id,
            error
        );
    }
}

#[cfg(test)]
#[path = "models_tests.rs"]
mod tests;

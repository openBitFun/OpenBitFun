//! Where relayed rounds run: the provider configured on this device
//! (ai-adapters), and where their usage is recorded.

use std::future::Future;
use std::pin::Pin;

use futures::StreamExt;
use openbitfun_ai_adapters::UnifiedResponse;

use super::dto::{RelayError, RelayUsage};
use crate::util::types::{Message, ToolDefinition};

/// A boxed future, as the provider and sink traits return them.
pub type BoxFuture<T> = Pin<Box<dyn Future<Output = T> + Send>>;

/// One round as the provider takes it (messages already converted).
#[derive(Debug, Clone)]
pub struct ProviderRequest {
    pub request_id: String,
    pub model: Option<String>,
    pub messages: Vec<Message>,
    pub tools: Vec<ToolDefinition>,
    pub max_output_tokens: Option<u32>,
}

/// An open model stream.
pub struct ProviderStream {
    /// The configured model id that serves the round (usage key).
    pub model_id: String,
    /// The provider's model name (shown to the caller).
    pub model_name: String,
    pub stream: Pin<Box<dyn futures::Stream<Item = Result<UnifiedResponse, String>> + Send>>,
}

/// Opens model streams. No tool ever runs through this trait: tool
/// definitions go to the model and tool calls come back as data.
pub trait ModelProvider: Send + Sync + 'static {
    fn open(&self, request: ProviderRequest) -> BoxFuture<Result<ProviderStream, RelayError>>;
}

/// Records a finished round's usage on this device.
pub trait ModelUsageSink: Send + Sync + 'static {
    fn record(
        &self,
        request_id: String,
        model_id: String,
        model_name: String,
        usage: RelayUsage,
    ) -> BoxFuture<()>;
}

/// The model configured on this device, through the process-wide AI client
/// factory (same credentials, endpoints and stream handling as local turns).
pub struct ConfiguredModelProvider;

impl ModelProvider for ConfiguredModelProvider {
    fn open(&self, request: ProviderRequest) -> BoxFuture<Result<ProviderStream, RelayError>> {
        Box::pin(async move {
            let unavailable = |message: String| RelayError::new("fleet_model_unavailable", message);
            let factory = crate::infrastructure::ai::get_global_ai_client_factory()
                .await
                .map_err(|error| unavailable(format!("the model runtime is not ready: {error}")))?;
            let model_id = request
                .model
                .clone()
                .unwrap_or_else(|| "primary".to_string());
            let client = factory
                .get_client_resolved(&model_id)
                .await
                .map_err(|error| {
                    unavailable(format!(
                        "no usable model '{model_id}' is configured on this device: {error}"
                    ))
                })?;
            // A round relayed here runs here: never onwards to a third
            // device through one of this device's relay entries.
            if openbitfun_ai_adapters::client::relay_transport::is_relay_format(
                &client.config.format,
            ) {
                return Err(unavailable(format!(
                    "model '{model_id}' is not configured on this device"
                )));
            }
            let client = match request.max_output_tokens {
                Some(limit) => {
                    let limit = client.config.max_tokens.map_or(limit, |own| own.min(limit));
                    client.with_max_tokens(Some(limit))
                }
                None => client.as_ref().clone(),
            };
            let tools = (!request.tools.is_empty()).then_some(request.tools);
            let response = client
                .send_message_stream(request.messages, tools, None)
                .await
                .map_err(|error| {
                    RelayError::new(
                        "fleet_model_provider_error",
                        format!("the model provider refused the request: {error}"),
                    )
                })?;
            let stream = response
                .stream
                .map(|item| item.map_err(|error| error.to_string()))
                .boxed();
            Ok(ProviderStream {
                model_id,
                model_name: client.config.model.clone(),
                stream,
            })
        })
    }
}

/// The device's token usage ledger, labelled "OpenBitFun agent".
pub struct TokenUsageLedgerSink;

impl ModelUsageSink for TokenUsageLedgerSink {
    fn record(
        &self,
        request_id: String,
        model_id: String,
        model_name: String,
        usage: RelayUsage,
    ) -> BoxFuture<()> {
        Box::pin(async move {
            let Some(service) = crate::service::token_usage::get_global_token_usage_service()
            else {
                log::debug!(
                    "Superagent relay usage not recorded: the usage ledger is not running, request_id={}",
                    request_id
                );
                return;
            };
            let details = serde_json::json!({
                "source": "superagent_relay",
                "label": super::USAGE_LABEL,
            });
            if let Err(error) = service
                .record_usage(
                    model_id,
                    model_name,
                    super::USAGE_SESSION_ID.to_string(),
                    request_id.clone(),
                    usage.input_tokens,
                    usage.output_tokens,
                    usage.cached_tokens,
                    Some(details),
                    false,
                )
                .await
            {
                log::warn!(
                    "Superagent relay usage not recorded: request_id={}, error={}",
                    request_id,
                    error
                );
            }
        })
    }
}

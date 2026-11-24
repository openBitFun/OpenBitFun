//! Model I/O for a single execution attempt. Round recovery and cancellation
//! stay with the caller, including after the response stream has opened.

use std::sync::Arc;

use crate::infrastructure::ai::{AIClient, AIClientFactory, StreamResponse};
use crate::util::errors::OpenBitFunResult;
use crate::util::types::{Message, ToolDefinition};
use openbitfun_ai_adapters::ModelExchangeTraceConfig;
use openbitfun_core_types::ModelRequestContext;

#[async_trait::async_trait]
pub trait ModelRequests: Send + Sync {
    async fn client_factory(&self) -> OpenBitFunResult<Arc<AIClientFactory>>;

    async fn send_once(
        &self,
        client: &AIClient,
        messages: Vec<Message>,
        tools: Option<Vec<ToolDefinition>>,
        context: ModelRequestContext,
        trace: Option<ModelExchangeTraceConfig>,
    ) -> anyhow::Result<StreamResponse>;
}

/// Product configuration can replace its factory between turns.
pub struct ProductModelRequests;

#[async_trait::async_trait]
impl ModelRequests for ProductModelRequests {
    async fn client_factory(&self) -> OpenBitFunResult<Arc<AIClientFactory>> {
        AIClientFactory::get_global().await
    }

    async fn send_once(
        &self,
        client: &AIClient,
        messages: Vec<Message>,
        tools: Option<Vec<ToolDefinition>>,
        context: ModelRequestContext,
        trace: Option<ModelExchangeTraceConfig>,
    ) -> anyhow::Result<StreamResponse> {
        client
            .send_message_stream_once_with_request_context(messages, tools, Some(context), trace)
            .await
    }
}

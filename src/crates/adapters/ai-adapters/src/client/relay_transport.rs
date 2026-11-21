//! Model rounds that run on another device of the account.
//!
//! A model entry whose provider is [`RELAY_FORMAT`] holds no credentials and
//! no endpoint: it stands for a model configured on another device, and each
//! round runs there through that device's model relay. This adapter does not
//! know how devices are reached; the host installs a [`RelayStreamTransport`]
//! (the account device network) once at startup, and a client of a relay
//! model without one fails loudly instead of falling back to a local model.

use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, RwLock};

use anyhow::{anyhow, Result};

use super::{AIClient, StreamResponse};
use crate::types::{AIConfig, Message, ToolDefinition};

/// The provider (API format) of relay model entries.
pub const RELAY_FORMAT: &str = "fleet_relay";

/// One round, as the transport takes it.
#[derive(Debug, Clone)]
pub struct RelayStreamRequest {
    /// The relay model entry (its `request_url` names the owner and model).
    pub config: AIConfig,
    pub messages: Vec<Message>,
    pub tools: Option<Vec<ToolDefinition>>,
}

/// A boxed future of a transport.
pub type RelayStreamFuture = Pin<Box<dyn Future<Output = Result<StreamResponse>> + Send>>;

/// Opens a round on the model's owner device and streams it back.
pub trait RelayStreamTransport: Send + Sync + 'static {
    fn open(&self, request: RelayStreamRequest) -> RelayStreamFuture;
}

static TRANSPORT: RwLock<Option<Arc<dyn RelayStreamTransport>>> = RwLock::new(None);

/// Installs the process-wide transport (the host, once at startup).
pub fn install_relay_transport(transport: Arc<dyn RelayStreamTransport>) {
    *TRANSPORT
        .write()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(transport);
}

fn transport() -> Option<Arc<dyn RelayStreamTransport>> {
    TRANSPORT
        .read()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone()
}

/// Whether `format` names a relay model entry.
pub fn is_relay_format(format: &str) -> bool {
    format.trim().eq_ignore_ascii_case(RELAY_FORMAT)
}

pub(crate) async fn send_stream(
    client: &AIClient,
    messages: Vec<Message>,
    tools: Option<Vec<ToolDefinition>>,
) -> Result<StreamResponse> {
    if let Some(authorization) = &client.request_authorization {
        authorization.validate().await?;
    }
    let transport = transport().ok_or_else(|| {
        anyhow!(
            "fleet_model_unavailable: model '{}' runs on another device, and this host cannot reach other devices",
            client.config.name
        )
    })?;
    transport
        .open(RelayStreamRequest {
            config: client.config.clone(),
            messages,
            tools,
        })
        .await
}

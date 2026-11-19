//! Frontend event transport for either host.

use std::sync::Arc;

use async_trait::async_trait;
use openbitfun_events::AgenticEvent;
use openbitfun_transport::{SinkTransportAdapter, TauriTransportAdapter, TransportAdapter};

use super::HostHandle;

/// Delivers projected backend events to the host's frontends: the Tauri
/// event bus, or the native host's ordered event hub.
#[derive(Debug)]
pub enum HostTransportAdapter {
    Tauri(TauriTransportAdapter),
    Native(SinkTransportAdapter),
}

impl HostTransportAdapter {
    pub fn new(host: HostHandle) -> Self {
        match host {
            HostHandle::Tauri(app) => Self::Tauri(TauriTransportAdapter::new(app)),
            HostHandle::Native(native) => {
                let events = Arc::clone(native.events());
                Self::Native(SinkTransportAdapter::new(Arc::new(move |name, payload| {
                    events.publish(name, payload);
                })))
            }
        }
    }

    fn inner(&self) -> &dyn TransportAdapter {
        match self {
            Self::Tauri(adapter) => adapter,
            Self::Native(adapter) => adapter,
        }
    }
}

#[async_trait]
impl TransportAdapter for HostTransportAdapter {
    async fn emit_event(&self, event: AgenticEvent) -> anyhow::Result<()> {
        self.inner().emit_event(event).await
    }

    async fn emit_generic(
        &self,
        event_name: &str,
        payload: serde_json::Value,
    ) -> anyhow::Result<()> {
        self.inner().emit_generic(event_name, payload).await
    }
}

//! Frontend event transport of the backend host.

use std::sync::Arc;

use async_trait::async_trait;
use openbitfun_events::AgenticEvent;
use openbitfun_transport::{SinkTransportAdapter, TransportAdapter};

use super::HostHandle;

/// Delivers projected backend events into the host's ordered event hub,
/// which every client (NSH UI, OBP WebSocket, mesh peers) reads.
#[derive(Debug)]
pub struct HostTransportAdapter(SinkTransportAdapter);

impl HostTransportAdapter {
    pub fn new(host: HostHandle) -> Self {
        let events = Arc::clone(host.native().events());
        Self(SinkTransportAdapter::new(Arc::new(move |name, payload| {
            events.publish(name, payload);
        })))
    }
}

#[async_trait]
impl TransportAdapter for HostTransportAdapter {
    async fn emit_event(&self, event: AgenticEvent) -> anyhow::Result<()> {
        self.0.emit_event(event).await
    }

    async fn emit_generic(
        &self,
        event_name: &str,
        payload: serde_json::Value,
    ) -> anyhow::Result<()> {
        self.0.emit_generic(event_name, payload).await
    }
}

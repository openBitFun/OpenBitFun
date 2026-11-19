//! Sink transport adapter.
//!
//! Delivers projected frontend events to an in-process sink (an ordered event
//! hub, a channel, a protocol server). Used by hosts without a webview event
//! bus. Agentic event names and payload shapes are projected by
//! `openbitfun-events`, exactly as the Tauri adapter projects them.

use crate::traits::TransportAdapter;
use async_trait::async_trait;
use log::warn;
use openbitfun_events::{project_agentic_frontend_event, AgenticEvent};
use std::fmt;
use std::sync::Arc;

/// Receives one projected event: its frontend name and JSON payload.
pub type EventSink = Arc<dyn Fn(&str, serde_json::Value) + Send + Sync>;

pub struct SinkTransportAdapter {
    sink: EventSink,
}

impl SinkTransportAdapter {
    pub fn new(sink: EventSink) -> Self {
        Self { sink }
    }
}

impl fmt::Debug for SinkTransportAdapter {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SinkTransportAdapter")
            .field("adapter_type", &"sink")
            .finish()
    }
}

#[async_trait]
impl TransportAdapter for SinkTransportAdapter {
    async fn emit_event(&self, event: AgenticEvent) -> anyhow::Result<()> {
        let Some(projected) = project_agentic_frontend_event(event) else {
            warn!("Unhandled AgenticEvent type in SinkTransportAdapter");
            return Ok(());
        };
        (self.sink)(projected.event_name.as_str(), projected.payload);
        Ok(())
    }

    async fn emit_generic(
        &self,
        event_name: &str,
        payload: serde_json::Value,
    ) -> anyhow::Result<()> {
        (self.sink)(event_name, payload);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::future::Future;
    use std::sync::Mutex;
    use std::task::{Context, Poll, Waker};

    #[test]
    fn generic_events_reach_the_sink_in_order() {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let recorder = Arc::clone(&seen);
        let adapter = SinkTransportAdapter::new(Arc::new(move |name, payload| {
            recorder.lock().unwrap().push((name.to_string(), payload));
        }));
        // The adapter never awaits anything pending, so one poll completes it.
        let mut delivery = Box::pin(async {
            adapter
                .emit_generic("a", serde_json::json!(1))
                .await
                .unwrap();
            adapter
                .emit_generic("b", serde_json::json!(2))
                .await
                .unwrap();
        });
        let mut context = Context::from_waker(Waker::noop());
        assert!(matches!(
            delivery.as_mut().poll(&mut context),
            Poll::Ready(())
        ));
        let seen = seen.lock().unwrap();
        assert_eq!(seen[0].0, "a");
        assert_eq!(seen[1].1, serde_json::json!(2));
    }
}

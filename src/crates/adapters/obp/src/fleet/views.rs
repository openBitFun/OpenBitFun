//! The entry's view models over its fleet index (`fleet_recent_sessions`,
//! `fleet_device_detail`): the projections of
//! `product_domains::fleet::views` over this host's navigator projection,
//! prompt tray, and the cloud agent's job cards the Inbox already reads.
//!
//! Both are answered by the serving runtime host itself
//! (`PeerStance::FleetEntry`), like `fleet_navigator`: no device is called
//! for them except the cloud node, whose read is shared with
//! `fleet_attention` (reused for a few seconds, the last good one kept).

use std::sync::Arc;

use openbitfun_product_domains::fleet::*;
use serde_json::Value;

use super::attention::FleetAttention;
use super::index::FleetIndex;

/// The view verbs (`PeerStance::FleetEntry`).
pub const FLEET_VIEW_COMMANDS: &[&str] = &["fleet_device_detail", "fleet_recent_sessions"];

/// The view models of one fleet host.
pub struct FleetViews {
    index: Arc<FleetIndex>,
    attention: Arc<FleetAttention>,
}

impl FleetViews {
    pub fn new(index: Arc<FleetIndex>, attention: Arc<FleetAttention>) -> Arc<Self> {
        Arc::new(Self { index, attention })
    }

    /// Answers a view verb; `None` for any other command.
    pub async fn handle(&self, command: &str, args: &Value) -> Option<Result<Value, String>> {
        let request = args.get("request").cloned().unwrap_or(Value::Null);
        let result = match command {
            "fleet_recent_sessions" => parse::<FleetRecentSessionsRequest>(request)
                .and_then(|request| to_value(self.recent_sessions(&request))),
            "fleet_device_detail" => match parse::<FleetDeviceDetailRequest>(request) {
                Ok(request) => match self.device_detail(&request).await {
                    Ok(detail) => to_value(detail),
                    Err(error) => Err(error),
                },
                Err(error) => Err(error),
            },
            _ => return None,
        };
        Some(result)
    }

    /// `fleet_recent_sessions {limit?, cursor?}`.
    pub fn recent_sessions(&self, request: &FleetRecentSessionsRequest) -> FleetRecentSessions {
        let navigator = self.index.navigator(None);
        project_recent_sessions(navigator.revision, &navigator.devices, request)
    }

    /// `fleet_device_detail {deviceId}`; an empty id is this host. A device
    /// the index does not know is refused as `fleet_device_offline: <id>
    /// (device_unknown)`, the answer `fleet_call` gives for it.
    pub async fn device_detail(
        &self,
        request: &FleetDeviceDetailRequest,
    ) -> Result<FleetDeviceDetail, String> {
        let device_id = match request.device_id.trim() {
            "" => self.index.self_device_id().to_string(),
            id => id.to_string(),
        };
        let navigator = self.index.navigator(None);
        let Some(device) = navigator
            .devices
            .iter()
            .find(|device| device.device_id == device_id)
        else {
            return Err(FleetCallRefusal::DeviceOffline {
                device_id,
                reason: "device_unknown",
            }
            .message());
        };
        let prompts = self.index.prompts();
        // The cloud node has no jobs of its own to show.
        let cloud_jobs = if device.host_kind == FleetHostKind::Cloud {
            Vec::new()
        } else {
            self.attention.cloud_jobs().await
        };
        Ok(project_device_detail(
            navigator.revision,
            device,
            &prompts.prompts,
            &cloud_jobs,
        ))
    }
}

fn parse<T: serde::de::DeserializeOwned + Default>(request: Value) -> Result<T, String> {
    if request.is_null() {
        return Ok(T::default());
    }
    serde_json::from_value(request).map_err(|error| format!("invalid fleet request: {error}"))
}

fn to_value<T: serde::Serialize>(value: T) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|error| error.to_string())
}

#[cfg(test)]
#[path = "views_tests.rs"]
mod tests;

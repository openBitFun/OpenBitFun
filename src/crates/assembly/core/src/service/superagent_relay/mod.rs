//! The device side of the account's cloud superagent.
//!
//! The superagent is a thin control-plane loop on the server
//! (`openbitfun-superagent`). It holds no model credentials and runs no
//! tools: it relays each model round to a device of the account
//! (`fleet_model_start` / `fleet_model_poll` / `fleet_model_cancel`). It
//! reaches devices through the `cloud-agent` OBP scope
//! (`openbitfun_obp::server::Scope::CloudAgent`: the account-device
//! allowlist plus the relay, under this device's switches). This module
//! owns:
//!
//! - [`ModelRelay`]: one completion per request id through the provider
//!   configured on this device (ai-adapters). Tool definitions are passed to
//!   the model and tool calls are returned to the caller; nothing runs here.
//!   Polling is resumable by sequence number, a repeated start with the same
//!   id is idempotent, and finished requests stay readable for a while so a
//!   reconnecting poller picks up where it left off. Usage is recorded on
//!   this device as "OpenBitFun agent".
//! - [`SuperagentDeviceSettings`]: the device switches
//!   `superagent.acceptDispatch` and `superagent.allowAutoApproval` (both
//!   default on) the OBP `cloud-agent` scope reads per call.
//!
//! Hosts (desktop, CLI) wire it by routing `fleet_model_*` from a
//! `cloud-agent` connection to [`handle_fleet_model_command`], answering
//! `ObpBackend::serves_cloud_agent` and `cloud_agent_policy` from
//! [`device_settings`], and advertising [`FLEET_MODEL_CAPABILITY`].
//!
//! Remote scenarios: the relay runs where the model credentials are (this
//! device); the caller is always remote. Nothing blocks on a UI, and a
//! dropped poller loses nothing (cursor resume).

mod dto;
mod provider;
mod relay;
mod settings;

#[cfg(test)]
mod tests;

pub use dto::{
    FleetModelCancelRequest, FleetModelPollRequest, FleetModelStartRequest, RelayChunk, RelayError,
    RelayMessage, RelayResult, RelayTool, RelayToolCall, RelayToolCallDelta, RelayUsage,
};
pub use provider::{
    BoxFuture, ConfiguredModelProvider, ModelProvider, ModelUsageSink, ProviderRequest,
    ProviderStream, TokenUsageLedgerSink,
};
pub use relay::{ModelRelay, RelayLimits};
pub use settings::{device_settings, SuperagentDeviceSettings};

use std::sync::{Arc, OnceLock};

use serde_json::Value;

/// Advertised by a host that serves the model relay.
pub const FLEET_MODEL_CAPABILITY: &str = "fleet_model_v1";
/// The model relay's commands (served to the `cloud-agent` scope only).
pub const FLEET_MODEL_START: &str = "fleet_model_start";
pub const FLEET_MODEL_POLL: &str = "fleet_model_poll";
pub const FLEET_MODEL_CANCEL: &str = "fleet_model_cancel";
/// How usage of relayed rounds is labelled on this device.
pub const USAGE_LABEL: &str = "OpenBitFun agent";
/// The usage ledger's session key for relayed rounds (one bucket for every
/// superagent round on this device; the turn key is the request id).
pub const USAGE_SESSION_ID: &str = "openbitfun-agent";

/// Whether `command` is one of the relay's commands.
pub fn is_fleet_model_command(command: &str) -> bool {
    matches!(
        command,
        FLEET_MODEL_START | FLEET_MODEL_POLL | FLEET_MODEL_CANCEL
    )
}

/// The process-wide relay over this device's configured provider.
pub fn global_relay() -> Arc<ModelRelay> {
    static RELAY: OnceLock<Arc<ModelRelay>> = OnceLock::new();
    Arc::clone(RELAY.get_or_init(|| {
        ModelRelay::new(
            Arc::new(ConfiguredModelProvider),
            Arc::new(TokenUsageLedgerSink),
            RelayLimits::default(),
        )
    }))
}

/// Runs one `fleet_model_*` command (`{request: …}` or the flat form) on the
/// process-wide relay; `None` for any other command.
pub async fn handle_fleet_model_command(
    command: &str,
    args: Value,
) -> Option<Result<Value, String>> {
    if !is_fleet_model_command(command) {
        return None;
    }
    Some(global_relay().handle(command, args).await)
}

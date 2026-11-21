//! How the agent reaches the account's devices: a [`DeviceRpc`] trait, so
//! the turn loop and the tools are tested with fake devices, and the real
//! implementation (`link_rpc`) dials devices over the account's Link network.

use std::future::Future;
use std::pin::Pin;

use openbitfun_product_domains::superagent::RuntimeFacts;
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// One device of the account, as the agent sees it now.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DeviceSnapshot {
    pub facts: RuntimeFacts,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    pub models: Vec<String>,
    /// The device's workspaces with their repository facts (from its fleet
    /// digest and a probe by workspace id), already bounded.
    pub workspaces: Vec<Value>,
}

/// Why a device call failed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RpcError {
    /// The device is not on the account network now (the call never ran).
    Offline(String),
    /// The device's build lacks what the call needs (never dialed).
    UpdateRequired(String),
    /// The device ran the call and answered with an error.
    Refused(String),
    /// The connection broke mid-call: the outcome is unknown, so a mutation
    /// is reconciled through status/list instead of repeated blindly.
    Transport(String),
}

impl RpcError {
    pub fn message(&self) -> &str {
        match self {
            Self::Offline(m) | Self::UpdateRequired(m) | Self::Refused(m) | Self::Transport(m) => m,
        }
    }

    /// The call certainly did not run on the device.
    pub fn never_ran(&self) -> bool {
        matches!(self, Self::Offline(_) | Self::UpdateRequired(_))
    }
}

impl std::fmt::Display for RpcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.message())
    }
}

/// The account's devices, for the agent.
pub trait DeviceRpc: Send + Sync + 'static {
    /// Every runtime host of the account (online or not) with its last
    /// known facts.
    fn devices<'a>(
        &'a self,
        account_id: &'a str,
    ) -> BoxFuture<'a, Result<Vec<DeviceSnapshot>, RpcError>>;
    /// Runs one OBP command on a device (`dispatch_target_*`,
    /// `fleet_model_*`, `fleet_digest`). Implementations never dial a device
    /// that lacks `cloud_agent_scope_v1` (`UpdateRequired`).
    fn call<'a>(
        &'a self,
        account_id: &'a str,
        device_id: &'a str,
        command: &'a str,
        args: Value,
    ) -> BoxFuture<'a, Result<Value, RpcError>>;
}

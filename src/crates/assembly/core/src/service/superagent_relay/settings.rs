//! The device switches for the cloud superagent (config path `superagent`).

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// `superagent.acceptDispatch` and `superagent.allowAutoApproval`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SuperagentDeviceSettings {
    /// Whether the cloud agent may work on this device (a user fences a
    /// machine off by turning it off).
    pub accept_dispatch: bool,
    /// Whether the cloud agent may submit with `approvalPolicy: auto` and
    /// answer this device's prompts.
    pub allow_auto_approval: bool,
}

impl Default for SuperagentDeviceSettings {
    fn default() -> Self {
        Self {
            accept_dispatch: true,
            allow_auto_approval: true,
        }
    }
}

impl SuperagentDeviceSettings {
    /// Reads the `superagent` config value tolerantly: a missing section,
    /// an unreadable value or a wrongly typed field keeps that field's
    /// default (a switch is off only when it is exactly `false`).
    pub fn from_config_value(value: Option<&Value>) -> Self {
        let defaults = Self::default();
        let Some(Value::Object(object)) = value else {
            return defaults;
        };
        let flag = |camel: &str, snake: &str| {
            object
                .get(camel)
                .or_else(|| object.get(snake))
                .and_then(Value::as_bool)
        };
        Self {
            accept_dispatch: flag("acceptDispatch", "accept_dispatch")
                .unwrap_or(defaults.accept_dispatch),
            allow_auto_approval: flag("allowAutoApproval", "allow_auto_approval")
                .unwrap_or(defaults.allow_auto_approval),
        }
    }
}

/// The persisted section (`GlobalConfig.superagent`, written by the typed
/// `set_superagent_settings` mutation) as the switches the device enforces.
impl From<crate::service::config::types::SuperagentConfig> for SuperagentDeviceSettings {
    fn from(config: crate::service::config::types::SuperagentConfig) -> Self {
        Self {
            accept_dispatch: config.accept_dispatch,
            allow_auto_approval: config.allow_auto_approval,
        }
    }
}

/// This device's switches now. Read per cloud-agent call; a config service
/// that is not running or has no `superagent` section yields the defaults.
pub async fn device_settings() -> SuperagentDeviceSettings {
    let value = match crate::service::config::get_global_config_service().await {
        Ok(service) => service
            .get_config::<Value>(Some(
                crate::service::config::settings_mutations::SUPERAGENT_PATH,
            ))
            .await
            .ok(),
        Err(_) => None,
    };
    SuperagentDeviceSettings::from_config_value(value.as_ref())
}

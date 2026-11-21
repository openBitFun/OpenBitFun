//! Account settings sync for a product host (desktop backend, CLI host).
//!
//! The binder lives in `openbitfun_services_integrations::remote_connect::settings_sync`
//! and the data in the account replica the device network exchanges
//! between the account's devices (obp `fleet::replica`); nothing is stored
//! on a server. This module wires the binder to the shared
//! [`ConfigService`]: reads come from the config, defaults from a fresh
//! [`GlobalConfig`], the local-change signal is
//! [`ConfigService::subscribe_local_changes`], the switch is
//! `app.account_sync.enabled`, and the binding state is kept per account
//! under the profile's user data directory (`account_sync/`, which follows
//! `OPENBITFUN_USER_ROOT`). A host passes how a value is applied (the desktop
//! commits through its GUI config transaction, the CLI through the config
//! service), where the replica comes from and what its UI is told.

use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, OnceLock};

use anyhow::{anyhow, Result};
use async_trait::async_trait;
use serde_json::Value;

pub use openbitfun_services_integrations::remote_connect::settings_sync::*;

use crate::service::config::{ConfigService, GlobalConfig};
use crate::util::errors::OpenBitFunError;

/// The config path of the device's sync switch.
pub const SWITCH_PATH: &str = "app.account_sync.enabled";
/// The UI event after account values were applied here (`{keys}`).
pub const SETTINGS_APPLIED_EVENT: &str = "account://settings-applied";
/// The UI event when the sync state changes (a [`SyncStatus`]).
pub const SYNC_STATE_EVENT: &str = "account://settings-sync-state";

type ApplyFuture = Pin<Box<dyn Future<Output = Result<()>> + Send>>;
/// How a host stores one synced value.
pub type ApplyFn = Arc<dyn Fn(String, Value) -> ApplyFuture + Send + Sync>;

/// [`LocalSettings`] over the shared config service.
pub struct ConfigLocalSettings {
    config: Arc<ConfigService>,
    apply: Option<ApplyFn>,
    defaults: Value,
}

impl ConfigLocalSettings {
    /// `apply` is the host's typed mutation; `None` writes through the config
    /// service (`set_config`, which validates and persists).
    pub fn new(config: Arc<ConfigService>, apply: Option<ApplyFn>) -> Self {
        let defaults = serde_json::to_value(GlobalConfig::default()).unwrap_or(Value::Null);
        Self {
            config,
            apply,
            defaults,
        }
    }
}

#[async_trait]
impl LocalSettings for ConfigLocalSettings {
    async fn enabled(&self) -> bool {
        self.config
            .get_config::<bool>(Some(SWITCH_PATH))
            .await
            .unwrap_or(true)
    }

    async fn read(&self, key: &str) -> Result<Option<Value>> {
        match self.config.get_config::<Value>(Some(key)).await {
            Ok(Value::Null) => Ok(None),
            Ok(value) => Ok(Some(value)),
            Err(OpenBitFunError::NotFound(_)) => Ok(None),
            Err(error) if error.to_string().contains("not found") => Ok(None),
            Err(error) => Err(anyhow!("read {key}: {error}")),
        }
    }

    async fn default_value(&self, key: &str) -> Option<Value> {
        let pointer = format!("/{}", key.replace('.', "/"));
        self.defaults
            .pointer(&pointer)
            .filter(|value| !value.is_null())
            .cloned()
    }

    async fn apply(&self, key: &str, value: &Value) -> Result<()> {
        match self.apply.as_ref() {
            Some(apply) => apply(key.to_string(), value.clone()).await,
            None => self
                .config
                .set_config(key, value.clone())
                .await
                .map_err(|error| anyhow!("{error}")),
        }
    }
}

/// The binding state directory: `<user data>/account_sync`.
pub fn state_directory() -> Result<std::path::PathBuf> {
    Ok(user_data_dir()?.join("account_sync"))
}

/// The profile's user data directory (the account replica lives under
/// `fleet/` there).
pub fn user_data_dir() -> Result<std::path::PathBuf> {
    let paths = crate::infrastructure::try_get_path_manager_arc()
        .map_err(|error| anyhow!("path manager: {error}"))?;
    Ok(paths.user_data_dir())
}

static ENGINE: OnceLock<Arc<SettingsSync>> = OnceLock::new();

/// The process's binder, once a host started it.
pub fn engine() -> Option<Arc<SettingsSync>> {
    ENGINE.get().cloned()
}

/// Wakes the binder (sign-in, sign-out, the switch, the device network).
/// No-op before start.
pub fn wake() {
    if let Some(engine) = ENGINE.get() {
        engine.wake();
    }
}

/// The current status (`None` before a host started sync).
pub fn status() -> Option<SyncStatus> {
    ENGINE.get().map(|engine| engine.status())
}

/// Starts the process's binder once; later calls return the first one.
pub fn start(
    config: Arc<ConfigService>,
    apply: Option<ApplyFn>,
    provider: Arc<dyn ReplicaProvider>,
    observer: Arc<dyn SyncObserver>,
) -> Result<Arc<SettingsSync>> {
    if let Some(engine) = ENGINE.get() {
        return Ok(Arc::clone(engine));
    }
    let store = Arc::new(FileSyncStateStore::new(state_directory()?));
    let changes = config.subscribe_local_changes();
    let local = Arc::new(ConfigLocalSettings::new(config, apply));
    let engine = SettingsSync::new(local, provider, store, observer);
    if ENGINE.set(Arc::clone(&engine)).is_err() {
        return Ok(Arc::clone(ENGINE.get().expect("engine was set")));
    }
    let handle = tokio::runtime::Handle::try_current()
        .map_err(|_| anyhow!("account settings sync needs a runtime"))?;
    handle.spawn(Arc::clone(&engine).run(changes));
    log::info!("Account settings sync started");
    Ok(engine)
}

/// Turns sync on or off for this device and wakes the binder.
pub async fn set_enabled(config: &ConfigService, enabled: bool) -> Result<()> {
    config
        .set_config(SWITCH_PATH, enabled)
        .await
        .map_err(|error| anyhow!("{error}"))?;
    wake();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::PathManager;
    use crate::service::config::ConfigManagerSettings;

    async fn service(dir: &tempfile::TempDir) -> Arc<ConfigService> {
        let path_manager = Arc::new(PathManager::with_user_root_for_tests(
            dir.path().join("user"),
        ));
        Arc::new(
            ConfigService::with_settings(ConfigManagerSettings {
                path_manager: Some(path_manager),
                auto_save: true,
                backup_count: 0,
            })
            .await
            .expect("config service"),
        )
    }

    #[tokio::test]
    async fn every_synced_key_reads_and_applies_through_the_config_service() {
        let dir = tempfile::tempdir().unwrap();
        let config = service(&dir).await;
        let local = ConfigLocalSettings::new(Arc::clone(&config), None);
        assert!(local.enabled().await, "sync is on by default");
        for setting in SYNCED_SETTINGS {
            // Every key is a real path: reading it never fails.
            local
                .read(setting.key)
                .await
                .unwrap_or_else(|error| panic!("{}: {error:#}", setting.key));
        }
        // A fresh config's values are the defaults the first sync compares.
        assert_eq!(
            local.default_value("appearance.selection").await,
            Some(serde_json::json!("system"))
        );
        assert_eq!(local.default_value("appearance.content_width").await, None);
        // Keys that are absent until first set apply too.
        local
            .apply("appearance.content_width", &serde_json::json!(880))
            .await
            .unwrap();
        assert_eq!(
            local.read("appearance.content_width").await.unwrap(),
            Some(serde_json::json!(880))
        );
        local
            .apply(
                "font",
                &serde_json::json!({ "uiSize": { "level": "large" } }),
            )
            .await
            .unwrap();
        local
            .apply(
                "tool_permissions.policy.preset",
                &serde_json::json!("full_access"),
            )
            .await
            .unwrap();
        assert_eq!(
            local.read("tool_permissions.policy.preset").await.unwrap(),
            Some(serde_json::json!("full_access"))
        );
        set_enabled(&config, false).await.unwrap();
        assert!(!local.enabled().await);
    }
}

//! Account settings sync on a CLI host: Preferences and permission
//! configuration follow the signed-in account (binder:
//! `openbitfun_core::service::remote_connect::settings_sync`). The account's
//! synced settings live in this device's copy of the account replica
//! (`openbitfun_obp::fleet::replica`), which the fleet exchanges with the
//! account's other devices over Link; values apply through the shared config
//! service; attached controllers hear `account://settings-applied` and
//! `account://settings-sync-state` on this host's event stream.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use openbitfun_core::service::remote_connect::settings_sync::{
    self, ReplicaEntry, ReplicaProvider, ReplicaState, SettingsReplica, SyncObserver, SyncStatus,
    SETTINGS_APPLIED_EVENT, SETTINGS_COLLECTION, SYNC_STATE_EVENT,
};
use openbitfun_obp::fleet::replica::{replica_path, AccountReplica};
use serde_json::Value;

use crate::runtime::CliRuntimeContext;

/// The signed-in account's replica on this device.
struct ReplicaAdapter {
    account_id: String,
    replica: Arc<AccountReplica>,
}

impl SettingsReplica for ReplicaAdapter {
    fn account_id(&self) -> String {
        self.account_id.clone()
    }

    fn entries(&self) -> Vec<ReplicaEntry> {
        self.replica
            .records(SETTINGS_COLLECTION)
            .into_iter()
            .map(|record| ReplicaEntry {
                key: record.id,
                value: record.value,
                stamp: record.hlc.stamp(),
            })
            .collect()
    }

    fn put(&self, key: &str, value: Value) -> anyhow::Result<Option<String>> {
        Ok(self
            .replica
            .put(SETTINGS_COLLECTION, key, value)?
            .map(|record| record.hlc.stamp()))
    }

    fn seed(&self, key: &str, value: Value) -> anyhow::Result<Option<String>> {
        Ok(self
            .replica
            .seed(SETTINGS_COLLECTION, key, value)?
            .map(|record| record.hlc.stamp()))
    }

    fn changes(&self) -> tokio::sync::watch::Receiver<u64> {
        self.replica.subscribe()
    }

    fn state(&self) -> ReplicaState {
        let status = self.replica.status();
        ReplicaState {
            peers: status.peers,
            peers_online: status.peers_online,
            undelivered: status.undelivered,
            exchanging: status.exchanging,
            last_exchange_ms: status.last_exchange_ms,
        }
    }
}

static REPLICA: Mutex<Option<Arc<ReplicaAdapter>>> = Mutex::new(None);
static SIGNED_IN: AtomicBool = AtomicBool::new(false);

fn current_replica() -> Option<Arc<ReplicaAdapter>> {
    REPLICA.lock().unwrap_or_else(|p| p.into_inner()).clone()
}

/// The fleet started for `account_id`: open (or keep) that account's
/// replica and let the fleet exchange it.
pub(crate) fn attach_replica(account_id: &str) {
    SIGNED_IN.store(true, Ordering::SeqCst);
    let Some(host) = crate::fleet_host::current() else {
        return;
    };
    let adapter = match current_replica().filter(|current| current.account_id == account_id) {
        Some(current) => current,
        None => {
            let path = match settings_sync::user_data_dir() {
                Ok(dir) => Some(replica_path(&dir, account_id)),
                Err(error) => {
                    tracing::warn!("Account replica kept in memory only: {error:#}");
                    None
                }
            };
            Arc::new(ReplicaAdapter {
                account_id: account_id.to_string(),
                replica: AccountReplica::open(host.device_id().to_string(), path),
            })
        }
    };
    // The same fleet with the same replica keeps its exchange running.
    if !host
        .replica_sync()
        .is_some_and(|sync| Arc::ptr_eq(sync.replica(), &adapter.replica))
    {
        host.attach_replica(Arc::clone(&adapter.replica));
    }
    *REPLICA.lock().unwrap_or_else(|p| p.into_inner()) = Some(adapter);
    settings_sync::wake();
    // wave24-replica: the account records ride the same replica.
    openbitfun_core::service::remote_connect::account_records::wake();
}

/// The signed-in account's replica on this device (the account records
/// binder reads it; wave24-replica).
pub(crate) fn current_account_replica() -> Option<(String, Arc<AccountReplica>)> {
    current_replica().map(|adapter| (adapter.account_id.clone(), Arc::clone(&adapter.replica)))
}

struct CliReplicas;

impl ReplicaProvider for CliReplicas {
    fn replica(&self) -> Option<Arc<dyn SettingsReplica>> {
        current_replica().map(|adapter| adapter as Arc<dyn SettingsReplica>)
    }

    fn signed_in(&self) -> bool {
        SIGNED_IN.load(Ordering::SeqCst)
    }
}

struct CliObserver;

impl SyncObserver for CliObserver {
    fn settings_applied(&self, keys: &[String]) {
        crate::obp_host::publish_event(
            SETTINGS_APPLIED_EVENT,
            &serde_json::json!({ "keys": keys }),
        );
    }

    fn status_changed(&self, status: &SyncStatus) {
        if let Ok(payload) = serde_json::to_value(status) {
            crate::obp_host::publish_event(SYNC_STATE_EVENT, &payload);
        }
    }
}

/// Starts sync for this process (once); never blocks.
pub(crate) fn start(runtime: &Arc<CliRuntimeContext>) {
    let directory = runtime.account_runtime().directory_sessions();
    tokio::spawn(async move {
        if let Ok(Some(_)) = directory.signed_in_account().await {
            SIGNED_IN.store(true, Ordering::SeqCst);
        }
        let config = match openbitfun_core::service::config::get_global_config_service().await {
            Ok(config) => config,
            Err(error) => {
                tracing::warn!("Account settings sync not started: {error}");
                return;
            }
        };
        if let Err(error) = settings_sync::start(
            Arc::clone(&config),
            None,
            Arc::new(CliReplicas),
            Arc::new(CliObserver),
        ) {
            tracing::warn!("Account settings sync not started: {error:#}");
        }
        // wave24-replica: the account records (agents, skills, routines, ...).
        crate::account_records::start(config);
    });
}

// ── Commands (as the desktop serves them) ───────────────────────────────

/// `account_settings_sync_status` / `account_settings_sync_set`'s answer
/// when the binder has not reported yet.
fn current_status(enabled: bool) -> SyncStatus {
    settings_sync::status().unwrap_or(SyncStatus {
        enabled,
        phase: if enabled {
            settings_sync::SyncPhase::Offline
        } else {
            settings_sync::SyncPhase::Off
        },
        pending: 0,
        last_synced_at_ms: None,
        peers: 0,
        peers_online: 0,
        active: false,
        groups: Vec::new(),
    })
}

async fn switch_value() -> Result<bool, String> {
    let config = openbitfun_core::service::config::get_global_config_service()
        .await
        .map_err(|error| format!("Failed to get config service: {error}"))?;
    Ok(config
        .get_config::<bool>(Some(settings_sync::SWITCH_PATH))
        .await
        .unwrap_or(true))
}

/// `account_settings_sync_status {}`.
pub(crate) async fn status_command() -> Result<Value, String> {
    serde_json::to_value(current_status(switch_value().await?)).map_err(|e| e.to_string())
}

/// `account_settings_sync_set {enabled}`: turns sync on or off for this
/// device; answers the status once the binder has looked at the new switch.
pub(crate) async fn set_command(args: &Value) -> Result<Value, String> {
    let request = args.get("request").unwrap_or(args);
    let enabled = request
        .get("enabled")
        .and_then(Value::as_bool)
        .ok_or_else(|| {
            "account_settings_sync_set: `enabled` (a boolean) is required".to_string()
        })?;
    let config = openbitfun_core::service::config::get_global_config_service()
        .await
        .map_err(|error| format!("Failed to get config service: {error}"))?;
    settings_sync::set_enabled(&config, enabled)
        .await
        .map_err(|error| format!("{error:#}"))?;
    if let Some(engine) = settings_sync::engine() {
        // The switch is read at the start of a round: wait briefly for it.
        let mut status = engine.subscribe_status();
        let _ = tokio::time::timeout(
            std::time::Duration::from_secs(3),
            status.wait_for(|status| status.enabled == enabled),
        )
        .await;
    }
    serde_json::to_value(current_status(switch_value().await?)).map_err(|e| e.to_string())
}

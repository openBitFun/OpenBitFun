//! Account settings sync on the desktop backend.
//!
//! The binder (`openbitfun_core::service::remote_connect::settings_sync`)
//! reads this device's config, applies account values through the GUI config
//! transaction (`set_config_from_gui`, the same path as every Settings write,
//! with its schema checks and backend effects) and keeps the account's synced
//! settings in this device's copy of the account replica
//! (`openbitfun_obp::fleet::replica`), which the fleet layer exchanges with
//! the account's other devices over Link. No server keeps them.
//!
//! The UI only shows what the backend reports: `account_settings_sync_status`,
//! the `account://settings-sync-state` event, and `account://settings-applied`
//! after account values landed here (the UI re-reads what it draws).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use openbitfun_core::service::remote_connect::settings_sync::{
    self, ApplyFn, ReplicaEntry, ReplicaProvider, ReplicaState, SettingsReplica, SyncObserver,
    SyncPhase, SyncStatus, SETTINGS_APPLIED_EVENT, SETTINGS_COLLECTION, SYNC_STATE_EVENT,
};
use openbitfun_obp::fleet::replica::{replica_path, AccountReplica};
use serde::Deserialize;
use serde_json::Value;

use crate::api::app_state::AppState;
use crate::host::{HostHandle, State};

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
    REPLICA
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone()
}

/// The fleet started for `account_id`: open (or keep) that account's replica
/// and let the fleet exchange it. Edits made while the device network was
/// off stay in the replica and go out now.
pub(crate) fn attach_replica(account_id: &str) {
    SIGNED_IN.store(true, Ordering::SeqCst);
    let Some(host) = crate::fleet::current() else {
        return;
    };
    let adapter = match current_replica().filter(|current| current.account_id == account_id) {
        Some(current) => current,
        None => {
            let path = match settings_sync::user_data_dir() {
                Ok(dir) => Some(replica_path(&dir, account_id)),
                Err(error) => {
                    log::warn!("Account replica kept in memory only: {error:#}");
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
    *REPLICA
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(adapter);
    settings_sync::wake();
    // wave24-replica: the account records ride the same replica.
    openbitfun_core::service::remote_connect::account_records::wake();
}

/// The signed-in account's replica on this device (the account records
/// binder reads it; wave24-replica).
pub(crate) fn current_account_replica() -> Option<(String, Arc<AccountReplica>)> {
    current_replica().map(|adapter| (adapter.account_id.clone(), Arc::clone(&adapter.replica)))
}

/// Detaches the active replica handle (Link/fleet teardown) without changing
/// the signed-in flag.
pub(crate) fn detach_replica() {
    REPLICA
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .take();
    settings_sync::wake();
    openbitfun_core::service::remote_connect::account_records::wake();
}

/// Signed out: no replica until the next sign-in.
pub(crate) fn signed_out() {
    SIGNED_IN.store(false, Ordering::SeqCst);
    REPLICA
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .take();
    settings_sync::wake();
    openbitfun_core::service::remote_connect::account_records::wake();
}

/// Signed in (the device network follows).
pub(crate) fn signed_in() {
    SIGNED_IN.store(true, Ordering::SeqCst);
    settings_sync::wake();
    openbitfun_core::service::remote_connect::account_records::wake();
}

struct DesktopReplicas;

impl ReplicaProvider for DesktopReplicas {
    fn replica(&self) -> Option<Arc<dyn SettingsReplica>> {
        current_replica().map(|adapter| adapter as Arc<dyn SettingsReplica>)
    }

    fn signed_in(&self) -> bool {
        SIGNED_IN.load(Ordering::SeqCst)
    }
}

struct DesktopObserver {
    app: HostHandle,
}

impl SyncObserver for DesktopObserver {
    fn settings_applied(&self, keys: &[String]) {
        let _ = self
            .app
            .emit(SETTINGS_APPLIED_EVENT, serde_json::json!({ "keys": keys }));
    }

    fn status_changed(&self, status: &SyncStatus) {
        let _ = self.app.emit(SYNC_STATE_EVENT, status);
    }
}

/// Starts sync for this backend (once). Never blocks; a failure is logged and
/// leaves Settings showing sync as unavailable.
pub(crate) fn start(app: HostHandle) {
    let Ok(handle) = tokio::runtime::Handle::try_current() else {
        return;
    };
    handle.spawn(async move {
        // Whether an account is signed in at start (later sign-ins and
        // sign-outs move the flag).
        if let Ok(Some(_)) = super::account_directory::current_sessions()
            .signed_in_account()
            .await
        {
            SIGNED_IN.store(true, Ordering::SeqCst);
        }
        let config = {
            let state = app.state::<AppState>();
            Arc::clone(&state.config_service)
        };
        let apply_app = app.clone();
        let apply: ApplyFn = Arc::new(move |key, value| {
            let app = apply_app.clone();
            Box::pin(async move {
                crate::openbitfun_control_host::set_config_from_gui(&app, &key, value, None)
                    .await
                    .map(|_| ())
                    .map_err(|error| anyhow::anyhow!(error))
            })
        });
        let observer = Arc::new(DesktopObserver { app });
        if let Err(error) =
            settings_sync::start(config, Some(apply), Arc::new(DesktopReplicas), observer)
        {
            log::warn!("Account settings sync not started: {error:#}");
        }
    });
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountSettingsSyncStatusRequest {}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountSettingsSyncSetRequest {
    pub enabled: bool,
}

fn current_status(enabled: bool) -> SyncStatus {
    settings_sync::status().unwrap_or(SyncStatus {
        enabled,
        phase: if enabled {
            SyncPhase::Offline
        } else {
            SyncPhase::Off
        },
        pending: 0,
        last_synced_at_ms: None,
        peers: 0,
        peers_online: 0,
        active: false,
        groups: Vec::new(),
    })
}

async fn switch_value(state: &AppState) -> bool {
    state
        .config_service
        .get_config::<bool>(Some(settings_sync::SWITCH_PATH))
        .await
        .unwrap_or(true)
}

// @backend-command
pub async fn account_settings_sync_status(
    state: State<'_, AppState>,
    _request: AccountSettingsSyncStatusRequest,
) -> Result<SyncStatus, String> {
    Ok(current_status(switch_value(&state).await))
}

/// Turns account settings sync on or off for this device; answers the status
/// once the binder has looked at the new switch.
// @backend-command
pub async fn account_settings_sync_set(
    app: HostHandle,
    state: State<'_, AppState>,
    request: AccountSettingsSyncSetRequest,
) -> Result<SyncStatus, String> {
    crate::openbitfun_control_host::set_config_from_gui(
        &app,
        settings_sync::SWITCH_PATH,
        Value::Bool(request.enabled),
        None,
    )
    .await?;
    settings_sync::wake();
    if let Some(engine) = settings_sync::engine() {
        // The switch is read at the start of a round: wait briefly for it.
        let mut status = engine.subscribe_status();
        let _ = tokio::time::timeout(
            std::time::Duration::from_secs(3),
            status.wait_for(|status| status.enabled == request.enabled),
        )
        .await;
    }
    Ok(current_status(switch_value(&state).await))
}

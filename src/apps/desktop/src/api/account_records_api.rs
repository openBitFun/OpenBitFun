//! Account records on the desktop backend (wave24-replica).
//!
//! The binder (`openbitfun_core::service::remote_connect::account_records`)
//! keeps the account's records beyond settings in this device's copy of the
//! account replica, the one settings sync attaches
//! (`account_settings_sync_api`), and the fleet layer exchanges it with the
//! account's other devices over Link. No server keeps any of it. The desktop
//! adds its own bindings to Core's: desktop card definitions
//! (`desktop_cards::replica`), pets (`account_records_pets`) and SSH
//! profiles (`account_records_ssh`).
//!
//! The UI only shows what the backend reports: `device_records_overview`
//! (the account's routines that run on another device, and the SSH, MCP and
//! skill market entries that still need a secret on this device) and the
//! `account://records-applied` event after account items landed here.

use std::sync::Arc;

use openbitfun_core::service::remote_connect::account_records::{
    self, mcp, routines, skills, AccountRecordPort, LocalCollection, RecordPortProvider,
    RecordsObserver, RefusedItem, RECORDS_APPLIED_EVENT, SKILLS_COLLECTION,
};
use openbitfun_obp::fleet::account_port::ReplicaRecordPort;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::watch;

use crate::api::app_state::AppState;
use crate::host::{HostHandle, State};

pub(crate) struct DesktopRecordPorts;

impl RecordPortProvider for DesktopRecordPorts {
    fn port(&self) -> Option<Arc<dyn AccountRecordPort>> {
        current_port().map(|port| port as Arc<dyn AccountRecordPort>)
    }

    fn changes(&self) -> Option<watch::Receiver<u64>> {
        super::account_settings_sync_api::current_account_replica()
            .map(|(_, replica)| replica.subscribe())
    }

    fn device_name(&self) -> String {
        openbitfun_core::service::remote_connect::DeviceIdentity::from_current_machine()
            .map(|identity| identity.device_name)
            .unwrap_or_default()
    }
}

fn current_port() -> Option<Arc<ReplicaRecordPort>> {
    let (account_id, replica) = super::account_settings_sync_api::current_account_replica()?;
    let sync = Arc::new(|| crate::fleet::current().and_then(|host| host.replica_sync()));
    Some(Arc::new(ReplicaRecordPort::new(account_id, replica, sync)))
}

struct DesktopRecordsObserver {
    app: HostHandle,
}

impl RecordsObserver for DesktopRecordsObserver {
    fn applied(&self, collection: &str, ids: &[String]) {
        let _ = self.app.emit(
            RECORDS_APPLIED_EVENT,
            serde_json::json!({ "collection": collection, "ids": ids }),
        );
    }
}

/// Starts the binder for this backend (once). Never blocks; a failure is
/// logged and leaves the account records on this device only.
pub(crate) fn start(app: HostHandle) {
    let Ok(handle) = tokio::runtime::Handle::try_current() else {
        return;
    };
    handle.spawn(async move {
        let config = {
            let state = app.state::<AppState>();
            Arc::clone(&state.config_service)
        };
        let mut collections = account_records::core_collections(Arc::clone(&config));
        if let Some(cards) = app.try_state::<Arc<crate::desktop_cards::DesktopCards>>() {
            collections.push(
                Arc::new(crate::desktop_cards::replica::CardRecords::new(Arc::clone(
                    &*cards,
                ))) as Arc<dyn LocalCollection>,
            );
        }
        {
            let state = app.state::<AppState>();
            collections.push(Arc::new(super::account_records_pets::PetRecords::new(
                super::commands::companion_user_packages_dir(&state),
                Arc::clone(&config) as Arc<dyn super::account_records_pets::PetChoice>,
            )));
        }
        collections.push(Arc::new(super::account_records_ssh::SshRecords::new(
            Arc::new(super::account_records_ssh::AppSshProfiles(app.clone())),
        )));
        let observer: Arc<dyn RecordsObserver> = Arc::new(DesktopRecordsObserver { app });
        if let Err(error) = account_records::start(
            config,
            collections,
            Arc::new(DesktopRecordPorts),
            Some(observer),
        ) {
            log::warn!("Account records sync not started: {error:#}");
        }
    });
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountRecordsOverviewRequest {}

/// An account entry that needs a secret on this device.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NeedsSecret {
    pub id: String,
    /// What is missing here (env or header names, `password`, `key`, `token`).
    pub missing: Vec<String>,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountRecordsOverview {
    /// A replica is attached (signed in, device network on).
    pub attached: bool,
    /// The account's routines that run on another device.
    pub routines_elsewhere: Vec<Value>,
    pub mcp_needs_secrets: Vec<NeedsSecret>,
    pub ssh_needs_secrets: Vec<NeedsSecret>,
    pub skill_markets_need_token: Vec<String>,
    /// Items kept on this device because they hold a secret or exceed a budget.
    pub refused: Vec<RefusedItem>,
}

/// What this device's lists need from the account records: which routines
/// run elsewhere and which entries still need a secret here.
// @backend-command
pub async fn device_records_overview(
    state: State<'_, AppState>,
    _request: AccountRecordsOverviewRequest,
) -> Result<AccountRecordsOverview, String> {
    let Some(port) = current_port() else {
        return Ok(AccountRecordsOverview::default());
    };
    let mut overview = AccountRecordsOverview {
        attached: true,
        routines_elsewhere: routines::account_routines_elsewhere(port.as_ref()),
        refused: account_records::engine()
            .map(|engine| engine.status().refused)
            .unwrap_or_default(),
        ..AccountRecordsOverview::default()
    };
    match mcp::servers_needing_secrets(port.as_ref(), Arc::clone(&state.config_service)).await {
        Ok(servers) => {
            overview.mcp_needs_secrets = servers
                .into_iter()
                .map(|(id, missing)| NeedsSecret { id, missing })
                .collect()
        }
        Err(error) => log::debug!("MCP secret needs not read: {error:#}"),
    }
    if let Ok(manager) = state.get_ssh_manager_async().await {
        overview.ssh_needs_secrets =
            super::account_records_ssh::profiles_needing_secrets(port.as_ref(), &manager).await;
    }
    let market: Vec<openbitfun_core::service::config::types::SkillMarketSource> = state
        .config_service
        .get_config::<Value>(Some("app.skill_market.sources"))
        .await
        .ok()
        .and_then(|value| serde_json::from_value(value).ok())
        .unwrap_or_default();
    if let Some(record) = port
        .records(SKILLS_COLLECTION)
        .into_iter()
        .find(|record| record.id == "settings:market")
        .and_then(|record| record.value)
    {
        overview.skill_markets_need_token = skills::market_sources_needing_token(&record, &market);
    }
    Ok(overview)
}

#[cfg(test)]
pub(crate) mod test_harness {
    //! Two devices with real account replicas (obp `fleet::replica`), the
    //! real binder and one binding each; [`settle`] exchanges the replicas
    //! the way the device network does.

    use std::sync::{Arc, Mutex};

    use anyhow::Result;
    use async_trait::async_trait;
    use openbitfun_core::service::remote_connect::account_records::{
        AccountRecord, AccountRecordPort, AccountRecordsSync, AlwaysOn, LocalCollection,
        RecordPortProvider, RecordsState, RecordsStateStore,
    };
    use openbitfun_obp::fleet::account_port::ReplicaRecordPort;
    use openbitfun_obp::fleet::replica::{replica_path, AccountReplica};
    use tokio::sync::watch;

    struct Provider(Arc<ReplicaRecordPort>);

    impl RecordPortProvider for Provider {
        fn port(&self) -> Option<Arc<dyn AccountRecordPort>> {
            Some(Arc::clone(&self.0) as Arc<dyn AccountRecordPort>)
        }
        fn changes(&self) -> Option<watch::Receiver<u64>> {
            Some(self.0.replica().subscribe())
        }
        fn device_name(&self) -> String {
            format!("{} desk", self.0.device_id())
        }
    }

    #[derive(Default)]
    struct MemoryStore(Mutex<Option<RecordsState>>);

    #[async_trait]
    impl RecordsStateStore for MemoryStore {
        async fn load(&self, _account_id: &str) -> Result<Option<RecordsState>> {
            Ok(self.0.lock().unwrap().clone())
        }
        async fn save(&self, state: &RecordsState) -> Result<()> {
            *self.0.lock().unwrap() = Some(state.clone());
            Ok(())
        }
    }

    pub(crate) struct Device {
        pub replica: Arc<AccountReplica>,
        pub port: Arc<ReplicaRecordPort>,
        pub sync: Arc<AccountRecordsSync>,
        _dir: tempfile::TempDir,
    }

    pub(crate) fn device(id: &str, binding: Arc<dyn LocalCollection>) -> Device {
        let dir = tempfile::tempdir().unwrap();
        let replica = AccountReplica::open(id, Some(replica_path(dir.path(), "acct")));
        let port = Arc::new(ReplicaRecordPort::new(
            "acct",
            Arc::clone(&replica),
            Arc::new(|| None),
        ));
        let sync = AccountRecordsSync::new(
            vec![binding],
            Arc::new(Provider(Arc::clone(&port))),
            Arc::new(MemoryStore::default()),
            Arc::new(AlwaysOn),
        );
        Device {
            replica,
            port,
            sync,
            _dir: dir,
        }
    }

    /// Both replicas take each other's newer records and the blobs they
    /// name (what `fleet_replica_pull/push` and `fleet_blob_get` do).
    pub(crate) fn exchange(a: &Device, b: &Device) {
        for (from, to) in [(a, b), (b, a)] {
            let records = from.replica.snapshot();
            for record in &records {
                for blob in &record.blobs {
                    if let Some(bytes) = from.replica.blob(&blob.hash) {
                        let _ = to.replica.put_blob(&bytes, false);
                    }
                }
            }
            to.replica.merge(records);
        }
    }

    pub(crate) async fn settle(devices: &[&Device]) {
        for _ in 0..4 {
            for device in devices {
                device.sync.round().await;
            }
            for (index, left) in devices.iter().enumerate() {
                for right in &devices[index + 1..] {
                    exchange(left, right);
                }
            }
        }
    }

    pub(crate) fn live(device: &Device, collection: &str) -> Vec<AccountRecord> {
        device
            .port
            .records(collection)
            .into_iter()
            .filter(|record| record.value.is_some())
            .collect()
    }

    pub(crate) fn replica_text(device: &Device) -> String {
        serde_json::to_string(&device.replica.snapshot()).unwrap()
    }
}

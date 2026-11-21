//! The account's MiniApp list (wave 22, P4).
//!
//! MiniApps belong to the account, not to one device. Each runtime device
//! publishes the apps it has installed to the account replica
//! (`openbitfun_obp::fleet::replica`, collection [`INSTALLS_COLLECTION`]), one
//! record per app and device (`<appId>@<deviceId>`), and only the owning device
//! writes or deletes its records, so two devices never race on one record. The
//! fleet exchanges the replica with the account's other devices over Link; no
//! server keeps the list.
//!
//! [`miniapp_account_catalog`] answers the account's apps grouped by app, with
//! the devices each one is installed on, so every client can open a Space on a
//! device that has it: a pure-UI Space runs on any of them, a Space that needs
//! device capabilities (files, shell, its Node worker) runs against the device
//! the user picks, by default the one in context.
//!
//! Packages stay where they are installed: each device's MiniApp store keeps
//! the source, versions, drafts and storage (device-local data). The replica's
//! blobs are bounded at 4 MiB and the MiniApp store has no install path that
//! keeps an app's id across devices yet, so replicating packages is a later
//! step behind [`MiniAppCatalogStore`]; the list and every record format are
//! ready for it (records keep fields they do not know).
//!
//! Signed out, or before the fleet attached a replica, the catalog is this
//! device's own installs (`scope: "device"`) and nothing is stored.

use std::collections::BTreeMap;
use std::sync::Arc;

use openbitfun_core::miniapp::try_get_global_miniapp_manager;
use openbitfun_obp::fleet::replica::{AccountReplica, CollectionPolicy};
use openbitfun_product_domains::miniapp::types::MiniAppMeta;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::host::HostHandle;

/// Replica collection of per-device install records.
pub(crate) const INSTALLS_COLLECTION: &str = "miniapps.installs";

/// A few hundred apps on a handful of devices, a few hundred bytes each.
pub(crate) const INSTALLS_POLICY: CollectionPolicy = CollectionPolicy {
    name: INSTALLS_COLLECTION,
    max_records: 4096,
    max_bytes: 4 * 1024 * 1024,
    max_value_bytes: 4 * 1024,
    durable_holders: 0,
};

const MAX_NAME_CHARS: usize = 120;
const MAX_DESCRIPTION_CHARS: usize = 400;
const MAX_SHORT_CHARS: usize = 64;

/// One app installed on one device, as the device publishes it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InstallRecord {
    pub app_id: String,
    pub device_id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub icon: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub version: u32,
    #[serde(default)]
    pub updated_at: i64,
    #[serde(default)]
    pub runtime_profile: String,
    /// The app uses device capabilities (files, shell, its Node worker), so
    /// where it runs matters to the user.
    #[serde(default)]
    pub needs_device: bool,
    /// Fields a newer build wrote.
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

impl InstallRecord {
    fn record_id(&self) -> String {
        record_id(&self.app_id, &self.device_id)
    }

    fn from_meta(meta: &MiniAppMeta, device_id: &str) -> Self {
        let badges = meta.permissions.badges();
        let profile = serde_json::to_value(&meta.runtime_profile)
            .ok()
            .and_then(|value| value.as_str().map(str::to_owned))
            .unwrap_or_default();
        Self {
            app_id: meta.id.clone(),
            device_id: device_id.to_string(),
            name: clip(&meta.name, MAX_NAME_CHARS),
            description: clip(&meta.description, MAX_DESCRIPTION_CHARS),
            icon: clip(&meta.icon, MAX_SHORT_CHARS),
            category: clip(&meta.category, MAX_SHORT_CHARS),
            version: meta.version,
            updated_at: meta.updated_at,
            runtime_profile: profile,
            needs_device: badges
                .iter()
                .any(|badge| matches!(*badge, "filesystem" | "shell" | "node_worker")),
            extra: Map::new(),
        }
    }

    /// Same published facts (unknown fields are not ours to compare).
    fn same_facts(&self, other: &Self) -> bool {
        let strip = |record: &Self| Self {
            extra: Map::new(),
            ..record.clone()
        };
        strip(self) == strip(other)
    }
}

fn record_id(app_id: &str, device_id: &str) -> String {
    format!("{app_id}@{device_id}")
}

fn clip(text: &str, limit: usize) -> String {
    text.chars().take(limit).collect()
}

/// Where the account's install records live.
pub(crate) trait MiniAppCatalogStore: Send + Sync {
    /// `true` when the records are shared with the account's other devices.
    fn shared(&self) -> bool;
    fn installs(&self) -> Vec<InstallRecord>;
    fn put_install(&self, record: &InstallRecord) -> Result<(), String>;
    fn remove_install(&self, app_id: &str, device_id: &str) -> Result<(), String>;
}

/// The account replica on this device.
pub(crate) struct ReplicaCatalog(pub(crate) Arc<AccountReplica>);

impl MiniAppCatalogStore for ReplicaCatalog {
    fn shared(&self) -> bool {
        true
    }

    fn installs(&self) -> Vec<InstallRecord> {
        self.0
            .records(INSTALLS_COLLECTION)
            .into_iter()
            .filter_map(|record| record.value)
            .filter_map(|value| serde_json::from_value::<InstallRecord>(value).ok())
            .collect()
    }

    fn put_install(&self, record: &InstallRecord) -> Result<(), String> {
        let value = serde_json::to_value(record).map_err(|e| e.to_string())?;
        self.0
            .put(INSTALLS_COLLECTION, &record.record_id(), value)
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    fn remove_install(&self, app_id: &str, device_id: &str) -> Result<(), String> {
        self.0
            .delete(INSTALLS_COLLECTION, &record_id(app_id, device_id))
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
}

/// Make `store` hold exactly this device's installs for `device_id`: new or
/// changed apps are written, apps no longer installed are deleted, and records
/// of other devices are left alone. Returns how many records changed.
pub(crate) fn reconcile(
    store: &dyn MiniAppCatalogStore,
    device_id: &str,
    local: &[MiniAppMeta],
) -> Result<usize, String> {
    let existing: BTreeMap<String, InstallRecord> = store
        .installs()
        .into_iter()
        .filter(|record| record.device_id == device_id)
        .map(|record| (record.app_id.clone(), record))
        .collect();
    let mut changed = 0;
    for meta in local {
        let mut next = InstallRecord::from_meta(meta, device_id);
        match existing.get(&meta.id) {
            Some(current) if current.same_facts(&next) => continue,
            Some(current) => next.extra = current.extra.clone(),
            None => {}
        }
        store.put_install(&next)?;
        changed += 1;
    }
    for app_id in existing.keys() {
        if !local.iter().any(|meta| &meta.id == app_id) {
            store.remove_install(app_id, device_id)?;
            changed += 1;
        }
    }
    Ok(changed)
}

/// One device an app is installed on.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CatalogDevice {
    pub device_id: String,
    pub version: u32,
    pub updated_at: i64,
}

/// One app of the account, with the devices that have it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CatalogApp {
    pub app_id: String,
    pub name: String,
    pub description: String,
    pub icon: String,
    pub category: String,
    /// Newest version on any device.
    pub version: u32,
    pub updated_at: i64,
    pub runtime_profile: String,
    pub needs_device: bool,
    pub installed_here: bool,
    /// Newest first; this device first among equals.
    pub devices: Vec<CatalogDevice>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MiniAppAccountCatalog {
    /// `account` (shared with the account's devices) or `device` (this
    /// device's installs only: signed out, or the replica is not attached).
    pub scope: &'static str,
    pub this_device: String,
    /// Most recently updated first.
    pub apps: Vec<CatalogApp>,
}

/// Group install records by app (the projection every client draws).
pub(crate) fn project(
    records: Vec<InstallRecord>,
    this_device: &str,
    shared: bool,
) -> MiniAppAccountCatalog {
    let mut by_app: BTreeMap<String, Vec<InstallRecord>> = BTreeMap::new();
    for record in records {
        if record.app_id.is_empty() {
            continue;
        }
        by_app
            .entry(record.app_id.clone())
            .or_default()
            .push(record);
    }
    let mut apps: Vec<CatalogApp> = by_app
        .into_values()
        .map(|mut installs| {
            installs.sort_by(|a, b| {
                b.updated_at
                    .cmp(&a.updated_at)
                    .then_with(|| (b.device_id == this_device).cmp(&(a.device_id == this_device)))
                    .then_with(|| a.device_id.cmp(&b.device_id))
            });
            let newest = installs[0].clone();
            CatalogApp {
                app_id: newest.app_id.clone(),
                name: newest.name.clone(),
                description: newest.description.clone(),
                icon: newest.icon.clone(),
                category: newest.category.clone(),
                version: installs.iter().map(|r| r.version).max().unwrap_or(0),
                updated_at: newest.updated_at,
                runtime_profile: newest.runtime_profile.clone(),
                needs_device: installs.iter().any(|r| r.needs_device),
                installed_here: installs.iter().any(|r| r.device_id == this_device),
                devices: installs
                    .iter()
                    .map(|r| CatalogDevice {
                        device_id: r.device_id.clone(),
                        version: r.version,
                        updated_at: r.updated_at,
                    })
                    .collect(),
            }
        })
        .collect();
    apps.sort_by(|a, b| {
        b.updated_at
            .cmp(&a.updated_at)
            .then_with(|| a.name.cmp(&b.name))
    });
    MiniAppAccountCatalog {
        scope: if shared { "account" } else { "device" },
        this_device: this_device.to_string(),
        apps,
    }
}

/// The account replica the fleet attached on sign-in, with the collection
/// declared.
fn attached_store() -> Option<(String, ReplicaCatalog)> {
    let host = crate::fleet::current()?;
    let sync = host.replica_sync()?;
    let replica = Arc::clone(sync.replica());
    replica.declare(INSTALLS_POLICY);
    Some((host.device_id().to_string(), ReplicaCatalog(replica)))
}

fn this_device_id() -> String {
    crate::fleet::current()
        .map(|host| host.device_id().to_string())
        .unwrap_or_default()
}

async fn local_installs() -> Result<Vec<MiniAppMeta>, String> {
    let manager = try_get_global_miniapp_manager()
        .ok_or("The MiniApp manager is not running in this process")?;
    manager.list().await.map_err(|e| e.to_string())
}

/// Publish this device's installs to the account replica (no replica: nothing).
pub(crate) async fn publish_local() -> Result<usize, String> {
    let Some((device_id, store)) = attached_store() else {
        return Ok(0);
    };
    let local = local_installs().await?;
    reconcile(&store, &device_id, &local)
}

#[derive(Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub(crate) struct MiniAppAccountCatalogRequest {}

/// The account's MiniApps and the devices each is installed on.
// @backend-command
pub(crate) async fn miniapp_account_catalog(
    request: MiniAppAccountCatalogRequest,
) -> Result<MiniAppAccountCatalog, String> {
    let _ = request;
    let local = local_installs().await?;
    match attached_store() {
        Some((device_id, store)) => {
            if let Err(error) = reconcile(&store, &device_id, &local) {
                // The list still answers; the publish retries on the next change.
                log::warn!("MiniApp catalog publish failed: {error}");
            }
            Ok(project(store.installs(), &device_id, store.shared()))
        }
        None => {
            let device_id = this_device_id();
            let records = local
                .iter()
                .map(|meta| InstallRecord::from_meta(meta, &device_id))
                .collect();
            Ok(project(records, &device_id, false))
        }
    }
}

/// Re-publish whenever this device's MiniApps change.
pub(crate) fn install(app: &HostHandle) {
    for event in [
        "miniapp-created",
        "miniapp-updated",
        "miniapp-deleted",
        "miniapp-rolled-back",
        "miniapp-recompiled",
    ] {
        app.listen(event, |_payload| {
            let Ok(handle) = tokio::runtime::Handle::try_current() else {
                return;
            };
            handle.spawn(async {
                if let Err(error) = publish_local().await {
                    log::warn!("MiniApp catalog publish failed: {error}");
                }
            });
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    #[derive(Default)]
    struct MemoryCatalog(Mutex<BTreeMap<String, InstallRecord>>);

    impl MiniAppCatalogStore for MemoryCatalog {
        fn shared(&self) -> bool {
            true
        }
        fn installs(&self) -> Vec<InstallRecord> {
            self.0.lock().unwrap().values().cloned().collect()
        }
        fn put_install(&self, record: &InstallRecord) -> Result<(), String> {
            self.0
                .lock()
                .unwrap()
                .insert(record.record_id(), record.clone());
            Ok(())
        }
        fn remove_install(&self, app_id: &str, device_id: &str) -> Result<(), String> {
            self.0.lock().unwrap().remove(&record_id(app_id, device_id));
            Ok(())
        }
    }

    fn meta(id: &str, version: u32, updated_at: i64) -> MiniAppMeta {
        serde_json::from_value(serde_json::json!({
            "id": id,
            "name": format!("App {id}"),
            "description": "",
            "icon": "app",
            "category": "tools",
            "version": version,
            "created_at": 1,
            "updated_at": updated_at,
        }))
        .expect("meta")
    }

    #[test]
    fn reconcile_writes_changes_and_deletes_only_this_devices_records() {
        let store = MemoryCatalog::default();
        let other = InstallRecord::from_meta(&meta("board", 3, 30), "laptop");
        store.put_install(&other).unwrap();
        assert_eq!(
            reconcile(
                &store,
                "desk",
                &[meta("board", 2, 20), meta("notes", 1, 10)]
            )
            .unwrap(),
            2
        );
        // Unchanged facts write nothing.
        assert_eq!(
            reconcile(
                &store,
                "desk",
                &[meta("board", 2, 20), meta("notes", 1, 10)]
            )
            .unwrap(),
            0
        );
        // Uninstalled here: only this device's record goes.
        assert_eq!(
            reconcile(&store, "desk", &[meta("board", 2, 20)]).unwrap(),
            1
        );
        let ids: Vec<String> = store
            .installs()
            .iter()
            .map(InstallRecord::record_id)
            .collect();
        assert_eq!(
            ids,
            vec!["board@desk".to_string(), "board@laptop".to_string()]
        );
    }

    #[test]
    fn the_catalog_groups_devices_per_app_newest_first() {
        let records = vec![
            InstallRecord::from_meta(&meta("board", 2, 20), "desk"),
            InstallRecord::from_meta(&meta("board", 3, 30), "laptop"),
            InstallRecord::from_meta(&meta("notes", 1, 10), "laptop"),
        ];
        let catalog = project(records, "desk", true);
        assert_eq!(catalog.scope, "account");
        assert_eq!(catalog.apps.len(), 2);
        let board = &catalog.apps[0];
        assert_eq!(board.app_id, "board");
        assert_eq!(board.version, 3);
        assert!(board.installed_here);
        assert_eq!(
            board
                .devices
                .iter()
                .map(|d| d.device_id.as_str())
                .collect::<Vec<_>>(),
            vec!["laptop", "desk"]
        );
        assert!(!catalog.apps[1].installed_here);
    }

    #[test]
    fn records_from_a_newer_build_keep_unknown_fields_and_old_ones_parse() {
        // An older or minimal record (only the identity) still reads.
        let old: InstallRecord =
            serde_json::from_value(serde_json::json!({"appId": "a", "deviceId": "d"})).unwrap();
        assert_eq!(old.version, 0);
        assert!(!old.needs_device);
        let newer: InstallRecord = serde_json::from_value(serde_json::json!({
            "appId": "a", "deviceId": "d", "name": "A", "packageBlob": {"hash": "x"}
        }))
        .unwrap();
        let round = serde_json::to_value(&newer).unwrap();
        assert_eq!(round["packageBlob"]["hash"], "x");
        // Reconcile keeps the unknown field when it rewrites the record.
        let store = MemoryCatalog::default();
        store.put_install(&newer).unwrap();
        reconcile(&store, "d", &[meta("a", 4, 40)]).unwrap();
        let kept = &store.installs()[0];
        assert_eq!(kept.version, 4);
        assert_eq!(kept.extra["packageBlob"]["hash"], "x");
    }

    #[test]
    fn device_capabilities_mark_where_an_app_runs() {
        let mut worker = meta("w", 1, 1);
        worker.permissions = serde_json::from_value(serde_json::json!({
            "node": {"enabled": true}
        }))
        .unwrap();
        assert!(InstallRecord::from_meta(&worker, "d").needs_device);
        assert!(!InstallRecord::from_meta(&meta("ui", 1, 1), "d").needs_device);
    }

    #[test]
    fn signed_out_the_catalog_is_this_device_only() {
        let records = vec![InstallRecord::from_meta(&meta("a", 1, 1), "")];
        let catalog = project(records, "", false);
        assert_eq!(catalog.scope, "device");
        assert_eq!(catalog.apps.len(), 1);
        assert!(catalog.apps[0].installed_here);
    }
}

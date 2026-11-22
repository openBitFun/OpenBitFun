//! Account records sync: the account-level data beyond settings (quick
//! actions, custom agents, skills, routines, MCP server shapes, SSH profiles,
//! the consolidated memory, assistant personas, desktop cards, pets, bot
//! binding metadata) follows the account from device to device.
//!
//! Nothing is stored on a server. Every runtime device keeps the records in
//! its copy of the **account replica** (obp `fleet::replica`, one collection
//! per kind, budgets in `product_domains::fleet::account_records`), which
//! the fleet layer exchanges peer to peer over Link. This module is the
//! binder between the replica and each owning service, the pattern of
//! [`super::settings_sync`]:
//!
//! - **One binding per collection** ([`LocalCollection`]): the owner lists
//!   its items as replica-safe projections (secrets replaced by per-device
//!   placeholders, device-local paths left out) and applies account items
//!   through its own typed mutation.
//! - **Local edits** (an item whose projection differs from what this device
//!   last wrote or applied) become replica writes; an item gone locally
//!   becomes a tombstone.
//! - **Account items** (a record that changed since this device last saw it)
//!   apply through the binding; what the owner stores afterwards is
//!   recorded, so an apply never echoes back as a local edit.
//! - **First sync on a device** offers only the device's non-default items
//!   as seeds (the lowest clock): they fill ids nobody wrote on the account
//!   and lose to every real write. The owner's existing files are the
//!   legacy data: they are read in place and never rewritten by the offer.
//! - **Files** an item carries (persona documents, skill directories, pet
//!   sprites, the memory document) travel as content-addressed blobs,
//!   chunked to the replica's blob limit and fetched on demand; an item
//!   whose content is not reachable yet waits for the next round.
//! - **Concurrent edits**: the greater clock wins; every record names the
//!   stamp its writer had seen (`base`), so a binding learns when the value
//!   it replaces was never seen by the writer and can keep a conflict copy
//!   ([`ApplyContext::concurrent`]).
//! - **Secrets never enter the replica**: the replica refuses them, and the
//!   binder refuses file content shaped like a credential before it writes.
//! - The device's account sync switch covers this binder too.

use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, Result};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::Digest;
use tokio::sync::{watch, Mutex};

pub use openbitfun_product_domains::fleet::account_records::*;

use super::settings_sync::value_digest;

/// Rare fallback rescan when attached and idle with no change signal.
const IDLE_FALLBACK_RESCAN: Duration = Duration::from_secs(600);
/// Retry interval while remote records are waiting for missing content blobs.
const WAITING_BLOB_RETRY: Duration = Duration::from_secs(15);
/// Quiet time after the last local change before it is written.
const LOCAL_DEBOUNCE: Duration = Duration::from_millis(500);
/// Hard cap on any single synced content file assembled from remote blobs.
const MAX_CONTENT_FILE_BYTES: u64 = 64 * 1024 * 1024;
/// Upper bound on upfront `Vec::with_capacity` from an untrusted `FileEntry::bytes`.
const MAX_PREALLOC_FILE_BYTES: usize = MAX_CHUNK_BYTES;

// ── Items ────────────────────────────────────────────────────────────────

/// A file an item carries (a relative POSIX path).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ItemFile {
    pub path: String,
    pub bytes: Vec<u8>,
}

/// One item of a collection on this device, as the account sees it.
#[derive(Debug, Clone, PartialEq)]
pub struct LocalItem {
    /// The record id (`valid_record_id`).
    pub id: String,
    /// The replica-safe projection (no secrets, no file contents).
    pub value: Value,
    pub files: Vec<ItemFile>,
    /// Offered to the account at this device's first sync (`false`: a
    /// default every device has).
    pub offer: bool,
}

impl LocalItem {
    pub fn new(id: impl Into<String>, value: Value) -> Self {
        Self {
            id: id.into(),
            value,
            files: Vec::new(),
            offer: true,
        }
    }

    pub fn with_files(mut self, files: Vec<ItemFile>) -> Self {
        self.files = files;
        self
    }

    pub fn offered(mut self, offer: bool) -> Self {
        self.offer = offer;
        self
    }
}

/// An account item to apply here.
#[derive(Debug, Clone, PartialEq)]
pub struct RemoteItem {
    pub id: String,
    pub value: Value,
    pub files: Vec<ItemFile>,
    /// The device that wrote it.
    pub writer: String,
}

/// This device, as bindings name it in records (a routine's target, a
/// device-bound card, a bot's owner).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DeviceContext {
    pub device_id: String,
    pub device_name: String,
}

/// What a binding learns about an apply.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ApplyContext {
    pub device: DeviceContext,
    /// The item exists here with content the writer never saw (a concurrent
    /// edit, or a first sync where both sides had it): prose owners keep a
    /// conflict copy of the local content.
    pub concurrent: bool,
}

/// One owner's collection on this device.
#[async_trait]
pub trait LocalCollection: Send + Sync {
    fn collection(&self) -> &'static str;
    /// Every item this device has (complete: an item missing here counts as
    /// deleted here).
    async fn list(&self, device: &DeviceContext) -> Result<Vec<LocalItem>>;
    /// Stores an account item through the owner's typed mutation.
    async fn apply(&self, item: &RemoteItem, context: &ApplyContext) -> Result<()>;
    /// The account deleted the item.
    async fn remove(&self, id: &str) -> Result<()>;
}

// ── The record envelope ──────────────────────────────────────────────────

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct FileEntry {
    path: String,
    bytes: u64,
    sha256: String,
    chunks: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Envelope {
    /// The projection.
    v: Value,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    files: Vec<FileEntry>,
    /// The record stamp the writer had seen when it wrote (empty: none).
    #[serde(skip_serializing_if = "String::is_empty")]
    base: String,
}

fn sha256_hex(bytes: &[u8]) -> String {
    sha2::Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// A stable digest of an item (projection plus file contents).
fn item_digest(value: &Value, files: &[(String, String)]) -> String {
    let mut files: Vec<_> = files.to_vec();
    files.sort();
    value_digest(&json!({ "v": value, "files": files }))
}

fn local_digest(item: &LocalItem) -> String {
    let files: Vec<_> = item
        .files
        .iter()
        .map(|file| (file.path.clone(), sha256_hex(&file.bytes)))
        .collect();
    item_digest(&item.value, &files)
}

fn envelope_digest(envelope: &Envelope) -> String {
    let files: Vec<_> = envelope
        .files
        .iter()
        .map(|file| (file.path.clone(), file.sha256.clone()))
        .collect();
    item_digest(&envelope.v, &files)
}

/// The device that wrote a record (from its stamp).
fn writer_of(stamp: &str) -> String {
    stamp.splitn(3, '-').nth(2).unwrap_or_default().to_string()
}

/// Whether a relative file path stays inside the item's directory.
pub fn safe_relative_path(path: &str) -> bool {
    !path.is_empty()
        && path.len() <= 512
        && !path.starts_with('/')
        && !path.contains('\\')
        && !path.contains('\0')
        && path
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..")
}

// ── State ────────────────────────────────────────────────────────────────

/// What this device last wrote or applied for one record.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ItemState {
    pub stamp: String,
    /// Digest of the local item at that point (empty: absent here).
    pub digest: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CollectionState {
    pub seeded: bool,
    pub items: BTreeMap<String, ItemState>,
}

/// The per-account binding state (persisted; every field tolerates absence).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RecordsState {
    pub account_id: String,
    pub collections: BTreeMap<String, CollectionState>,
}

/// Where the per-account binding state is kept.
#[async_trait]
pub trait RecordsStateStore: Send + Sync {
    async fn load(&self, account_id: &str) -> Result<Option<RecordsState>>;
    async fn save(&self, state: &RecordsState) -> Result<()>;
}

/// One JSON file per account under a directory.
pub struct FileRecordsStateStore {
    directory: PathBuf,
}

impl FileRecordsStateStore {
    pub fn new(directory: impl Into<PathBuf>) -> Self {
        Self {
            directory: directory.into(),
        }
    }

    fn path(&self, account_id: &str) -> PathBuf {
        let name = &sha256_hex(account_id.as_bytes())[..24];
        self.directory.join(format!("records-{name}.json"))
    }
}

#[async_trait]
impl RecordsStateStore for FileRecordsStateStore {
    async fn load(&self, account_id: &str) -> Result<Option<RecordsState>> {
        let path = self.path(account_id);
        let bytes = match tokio::fs::read(&path).await {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(anyhow!("read {}: {error}", path.display())),
        };
        match serde_json::from_slice::<RecordsState>(&bytes) {
            Ok(state) if state.account_id == account_id => Ok(Some(state)),
            Ok(_) => Ok(None),
            Err(error) => {
                // An unreadable state only costs a fresh first sync (offers
                // lose to the account's values); the file is kept aside.
                log::warn!("Account records sync state unreadable, starting over: {error}");
                let _ = tokio::fs::rename(&path, path.with_extension("json.unreadable")).await;
                Ok(None)
            }
        }
    }

    async fn save(&self, state: &RecordsState) -> Result<()> {
        tokio::fs::create_dir_all(&self.directory)
            .await
            .map_err(|error| anyhow!("create {}: {error}", self.directory.display()))?;
        let path = self.path(&state.account_id);
        let temporary = path.with_extension("json.tmp");
        tokio::fs::write(&temporary, serde_json::to_vec_pretty(state)?)
            .await
            .map_err(|error| anyhow!("write {}: {error}", temporary.display()))?;
        tokio::fs::rename(&temporary, &path)
            .await
            .map_err(|error| anyhow!("replace {}: {error}", path.display()))
    }
}

// ── Host ─────────────────────────────────────────────────────────────────

/// Where the replica comes from (the device network's fleet layer).
pub trait RecordPortProvider: Send + Sync {
    /// `None` while signed out or while the device network is off.
    fn port(&self) -> Option<Arc<dyn AccountRecordPort>>;
    /// Changes of the current replica (local writes and merged records).
    fn changes(&self) -> Option<watch::Receiver<u64>>;
    /// This device's name as other devices show it.
    fn device_name(&self) -> String {
        String::new()
    }
}

/// The device's account sync switch.
#[async_trait]
pub trait RecordsSwitch: Send + Sync {
    async fn enabled(&self) -> bool;
}

/// What the binder tells the host's UI.
pub trait RecordsObserver: Send + Sync {
    /// Account items were applied (or removed) here.
    fn applied(&self, collection: &str, ids: &[String]);
}

/// A switch that is always on (tests, hosts without one).
pub struct AlwaysOn;

#[async_trait]
impl RecordsSwitch for AlwaysOn {
    async fn enabled(&self) -> bool {
        true
    }
}

/// Why an item was not written to the account.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefusedItem {
    pub collection: String,
    pub id: String,
    /// `secret`, `budget` or `invalid`.
    pub reason: String,
}

/// Where the records sync stands.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordsStatus {
    pub enabled: bool,
    /// A replica is attached (signed in, device network on).
    pub attached: bool,
    /// Items refused (they stay on this device).
    pub refused: Vec<RefusedItem>,
    /// Account items waiting for content no reachable device has yet.
    pub waiting: usize,
}

// ── Binder ───────────────────────────────────────────────────────────────

/// The account records binder of one host process.
pub struct AccountRecordsSync {
    collections: Vec<Arc<dyn LocalCollection>>,
    provider: Arc<dyn RecordPortProvider>,
    store: Arc<dyn RecordsStateStore>,
    switch: Arc<dyn RecordsSwitch>,
    observer: std::sync::Mutex<Option<Arc<dyn RecordsObserver>>>,
    /// Collections whose last round failed (warned once).
    warned: std::sync::Mutex<BTreeSet<String>>,
    /// Items refused until they are written (by collection and id).
    refused: std::sync::Mutex<BTreeMap<(String, String), RefusedItem>>,
    state: Mutex<Option<RecordsState>>,
    status: watch::Sender<RecordsStatus>,
    wake: tokio::sync::Notify,
}

struct Round<'a> {
    port: &'a dyn AccountRecordPort,
    device: DeviceContext,
    refused: Vec<RefusedItem>,
    waiting: usize,
    applied: Vec<(&'static str, Vec<String>)>,
    written: Vec<(String, String)>,
    /// Items refused in an earlier round (not retried until they change).
    refused_before: BTreeSet<(String, String)>,
}

impl AccountRecordsSync {
    pub fn new(
        collections: Vec<Arc<dyn LocalCollection>>,
        provider: Arc<dyn RecordPortProvider>,
        store: Arc<dyn RecordsStateStore>,
        switch: Arc<dyn RecordsSwitch>,
    ) -> Arc<Self> {
        Arc::new(Self {
            collections,
            provider,
            store,
            switch,
            observer: std::sync::Mutex::new(None),
            refused: std::sync::Mutex::new(BTreeMap::new()),
            warned: std::sync::Mutex::new(BTreeSet::new()),
            state: Mutex::new(None),
            status: watch::channel(RecordsStatus::default()).0,
            wake: tokio::sync::Notify::new(),
        })
    }

    pub fn status(&self) -> RecordsStatus {
        self.status.borrow().clone()
    }

    /// Sets what the host's UI is told after applies.
    pub fn set_observer(&self, observer: Arc<dyn RecordsObserver>) {
        *self.observer.lock().unwrap_or_else(|p| p.into_inner()) = Some(observer);
    }

    /// A sign-in or sign-out, the switch, the device network or an owner's
    /// store changed.
    pub fn wake(&self) {
        self.wake.notify_one();
    }

    /// The bound collections.
    pub fn collection_names(&self) -> Vec<&'static str> {
        self.collections
            .iter()
            .map(|collection| collection.collection())
            .collect()
    }

    fn publish(&self, status: RecordsStatus) {
        self.status.send_if_modified(|current| {
            if *current == status {
                false
            } else {
                *current = status;
                true
            }
        });
    }

    /// One pass over every bound collection.
    pub async fn round(&self) {
        if !self.switch.enabled().await {
            self.publish(RecordsStatus::default());
            return;
        }
        let Some(port) = self.provider.port() else {
            self.publish(RecordsStatus {
                enabled: true,
                ..RecordsStatus::default()
            });
            return;
        };
        let account_id = port.account_id();
        let mut slot = self.state.lock().await;
        if slot.as_ref().map(|state| state.account_id.as_str()) != Some(account_id.as_str()) {
            let loaded = match self.store.load(&account_id).await {
                Ok(state) => state,
                Err(error) => {
                    log::warn!("Account records sync state not read: {error:#}");
                    None
                }
            };
            *slot = Some(loaded.unwrap_or_else(|| RecordsState {
                account_id: account_id.clone(),
                ..RecordsState::default()
            }));
        }
        let state = slot.as_mut().expect("state was just set");
        let before = state.clone();
        let mut round = Round {
            port: port.as_ref(),
            device: DeviceContext {
                device_id: port.device_id(),
                device_name: self.provider.device_name(),
            },
            refused: Vec::new(),
            waiting: 0,
            applied: Vec::new(),
            written: Vec::new(),
            refused_before: self
                .refused
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .keys()
                .cloned()
                .collect(),
        };
        for collection in &self.collections {
            let entry = state
                .collections
                .entry(collection.collection().to_string())
                .or_default();
            let failed = round.collection(collection.as_ref(), entry).await.err();
            let mut warned = self.warned.lock().unwrap_or_else(|p| p.into_inner());
            match failed {
                // Said once per cause; a store that stays unavailable (no
                // scheduler in this host) is not repeated every round.
                Some(error) if warned.insert(collection.collection().to_string()) => log::warn!(
                    "Account records not synced: collection={}, error={error:#}",
                    collection.collection()
                ),
                Some(error) => log::debug!(
                    "Account records not synced: collection={}, error={error:#}",
                    collection.collection()
                ),
                None => {
                    warned.remove(collection.collection());
                }
            }
        }
        let snapshot = (*state != before).then(|| state.clone());
        drop(slot);
        if let Some(snapshot) = snapshot {
            if let Err(error) = self.store.save(&snapshot).await {
                log::warn!("Account records sync state not saved: {error:#}");
            }
        }
        let observer = self
            .observer
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .clone();
        for (collection, ids) in &round.applied {
            log::info!(
                "Account records applied: collection={collection}, count={}",
                ids.len()
            );
            if let Some(observer) = observer.as_ref() {
                observer.applied(collection, ids);
            }
        }
        let refused = {
            let mut refused = self.refused.lock().unwrap_or_else(|p| p.into_inner());
            for key in &round.written {
                refused.remove(key);
            }
            for item in round.refused {
                refused.insert((item.collection.clone(), item.id.clone()), item);
            }
            refused.values().cloned().collect()
        };
        self.publish(RecordsStatus {
            enabled: true,
            attached: true,
            refused,
            waiting: round.waiting,
        });
    }

    /// Runs rounds until the process ends: after a local change (debounced),
    /// a replica change, a wake, or every few seconds.
    pub async fn run(self: Arc<Self>, local_changes: watch::Receiver<()>) {
        let mut local = Some(local_changes);
        let mut replica_changes: Option<(String, watch::Receiver<u64>)> = None;
        loop {
            self.round().await;
            match (self.provider.port(), self.provider.changes()) {
                (Some(port), Some(changes)) => {
                    let account = port.account_id();
                    if replica_changes.as_ref().map(|(id, _)| id) != Some(&account) {
                        replica_changes = Some((account, changes));
                    }
                }
                _ => replica_changes = None,
            }
            let replica_changed = async {
                match replica_changes.as_mut() {
                    Some((_, receiver)) => {
                        if receiver.changed().await.is_err() {
                            std::future::pending::<()>().await;
                        }
                    }
                    None => std::future::pending::<()>().await,
                }
            };
            let local_changed = async {
                match local.as_mut() {
                    Some(receiver) => {
                        if receiver.changed().await.is_err() {
                            local = None;
                            return std::future::pending::<()>().await;
                        }
                        tokio::time::sleep(LOCAL_DEBOUNCE).await;
                    }
                    None => std::future::pending::<()>().await,
                }
            };
            let fallback_rescan = async {
                let status = self.status.borrow().clone();
                if !status.enabled || !status.attached {
                    std::future::pending::<()>().await;
                } else if status.waiting > 0 {
                    tokio::time::sleep(WAITING_BLOB_RETRY).await;
                } else {
                    tokio::time::sleep(IDLE_FALLBACK_RESCAN).await;
                }
            };
            tokio::select! {
                _ = local_changed => {}
                _ = replica_changed => {}
                _ = self.wake.notified() => {}
                _ = fallback_rescan => {}
            }
        }
    }
}

impl Round<'_> {
    fn refuse(&mut self, collection: &str, id: &str, error: &AccountRecordError) {
        let reason = match error {
            AccountRecordError::Secret(_) => "secret",
            AccountRecordError::Budget(_) => "budget",
            AccountRecordError::Other(_) => "invalid",
        };
        log::warn!("Account record refused, kept on this device: collection={collection}, id={id}, reason={reason}, error={error}");
        self.refused.push(RefusedItem {
            collection: collection.to_string(),
            id: id.to_string(),
            reason: reason.to_string(),
        });
    }

    /// Writes one local item (its files first).
    fn write(
        &mut self,
        collection: &str,
        item: &LocalItem,
        base: &str,
        seed: bool,
    ) -> Result<Option<String>, AccountRecordError> {
        if !valid_record_id(&item.id) {
            return Err(AccountRecordError::Other(format!(
                "invalid id {:?}",
                item.id
            )));
        }
        let pin = collection_budget(collection).is_some_and(|budget| budget.durable_holders > 0);
        let mut files = Vec::new();
        let mut blobs = Vec::new();
        let mut contents: Vec<&[u8]> = Vec::new();
        let mut seen = BTreeSet::new();
        for file in &item.files {
            if !safe_relative_path(&file.path) {
                return Err(AccountRecordError::Other(format!(
                    "invalid path {:?}",
                    file.path
                )));
            }
            if let Ok(text) = std::str::from_utf8(&file.bytes) {
                if text_contains_secret(text) {
                    return Err(AccountRecordError::Secret(format!("file {}", file.path)));
                }
            }
            let mut chunks = Vec::new();
            for chunk in file.bytes.chunks(MAX_CHUNK_BYTES.max(1)) {
                let hash = sha256_hex(chunk);
                if seen.insert(hash.clone()) {
                    blobs.push(AccountBlobRef {
                        hash: hash.clone(),
                        bytes: chunk.len() as u64,
                    });
                    contents.push(chunk);
                }
                chunks.push(hash);
            }
            files.push(FileEntry {
                path: file.path.clone(),
                bytes: file.bytes.len() as u64,
                sha256: sha256_hex(&file.bytes),
                chunks,
            });
        }
        let envelope = Envelope {
            v: item.value.clone(),
            files,
            base: base.to_string(),
        };
        let value = serde_json::to_value(&envelope)
            .map_err(|error| AccountRecordError::Other(error.to_string()))?;
        // The record first, then its content: a pinned blob no record names
        // yet would be unpinned by the replica's cache trim in between. A
        // peer that gets the record before the content waits for it.
        let written = self.port.put(collection, &item.id, value, &blobs, seed)?;
        if written.is_some() || !seed {
            for chunk in contents {
                if let Err(error) = self.port.put_blob(chunk, pin) {
                    log::warn!(
                        "Account record content not kept here: collection={collection}, id={}, error={error}",
                        item.id
                    );
                }
            }
        }
        Ok(written)
    }

    /// Puts back the chunks of `item`'s files that `wanted` names.
    fn restore_blobs(&mut self, collection: &str, item: &LocalItem, wanted: &[String]) {
        let pin = collection_budget(collection).is_some_and(|budget| budget.durable_holders > 0);
        let wanted: BTreeSet<&String> = wanted.iter().collect();
        let mut restored = 0;
        for file in &item.files {
            for chunk in file.bytes.chunks(MAX_CHUNK_BYTES.max(1)) {
                let hash = sha256_hex(chunk);
                if wanted.contains(&hash)
                    && !self.port.has_blob(&hash)
                    && self.port.put_blob(chunk, pin).is_ok()
                {
                    restored += 1;
                }
            }
        }
        if restored > 0 {
            log::info!(
                "Account record content restored on this device: collection={collection}, id={}, blobs={restored}",
                item.id
            );
        }
    }

    async fn content(&mut self, envelope: &Envelope) -> Option<Vec<ItemFile>> {
        let mut files = Vec::new();
        for entry in &envelope.files {
            if !safe_relative_path(&entry.path) {
                return None;
            }
            if entry.bytes > MAX_CONTENT_FILE_BYTES {
                log::warn!(
                    "Account record file exceeds maximum size limit: path={}, bytes={}",
                    entry.path,
                    entry.bytes
                );
                return None;
            }
            let prealloc = usize::try_from(entry.bytes)
                .unwrap_or(MAX_PREALLOC_FILE_BYTES)
                .min(MAX_PREALLOC_FILE_BYTES);
            let mut bytes = Vec::with_capacity(prealloc);
            for hash in &entry.chunks {
                let chunk = self.port.fetch_blob(hash, false).await?;
                if (bytes.len() as u64).saturating_add(chunk.len() as u64) > MAX_CONTENT_FILE_BYTES
                {
                    log::warn!(
                        "Account record file exceeded maximum size while fetching chunks: path={}",
                        entry.path
                    );
                    return None;
                }
                bytes.extend_from_slice(&chunk);
            }
            if sha256_hex(&bytes) != entry.sha256 {
                log::warn!(
                    "Account record file does not match its digest: path={}",
                    entry.path
                );
                return None;
            }
            files.push(ItemFile {
                path: entry.path.clone(),
                bytes,
            });
        }
        Some(files)
    }

    async fn collection(
        &mut self,
        binding: &dyn LocalCollection,
        state: &mut CollectionState,
    ) -> Result<()> {
        let name = binding.collection();
        let local = binding.list(&self.device).await?;
        let has_files = local.iter().any(|item| !item.files.is_empty());
        let local: BTreeMap<String, (LocalItem, String)> = if has_files {
            tokio::task::spawn_blocking(move || {
                local
                    .into_iter()
                    .map(|item| {
                        let digest = local_digest(&item);
                        (item.id.clone(), (item, digest))
                    })
                    .collect()
            })
            .await
            .map_err(|error| anyhow!("hash local account records: {error}"))?
        } else {
            local
                .into_iter()
                .map(|item| {
                    let digest = local_digest(&item);
                    (item.id.clone(), (item, digest))
                })
                .collect()
        };

        // First sync on this device: offer the non-default items.
        if !state.seeded {
            for (id, (item, digest)) in &local {
                if item.offer {
                    match self.write(name, item, "", true) {
                        Ok(_) => self.written.push((name.to_string(), id.clone())),
                        Err(error) => self.refuse(name, id, &error),
                    }
                }
                state.items.insert(
                    id.clone(),
                    ItemState {
                        stamp: String::new(),
                        digest: digest.clone(),
                    },
                );
            }
            state.seeded = true;
        }

        // A replica that lost records this device had offered or written (it
        // was set aside, or the device's identity changed): offer them again
        // at the lowest clock, so they fill the gap and lose to every write.
        let present: BTreeMap<String, AccountRecord> = self
            .port
            .records(name)
            .into_iter()
            .map(|record| (record.id.clone(), record))
            .collect();
        for (id, (item, digest)) in &local {
            let known = state.items.get(id).cloned().unwrap_or_default();
            let refused_before = self
                .refused_before
                .contains(&(name.to_string(), id.clone()));
            if item.offer && known.digest == *digest && !present.contains_key(id) && !refused_before
            {
                match self.write(name, item, "", true) {
                    Ok(_) => self.written.push((name.to_string(), id.clone())),
                    Err(error) => self.refuse(name, id, &error),
                }
            }
            // Content the account's record names that this device should
            // hold but lost: put it back from the local files.
            if let Some(record) = present.get(id).filter(|record| record.value.is_some()) {
                if known.digest == *digest
                    && record.blobs.iter().any(|hash| !self.port.has_blob(hash))
                {
                    self.restore_blobs(name, item, &record.blobs);
                }
            }
        }

        // Local edits: an item changed here since this device last wrote or
        // applied it is the newest write.
        for (id, (item, digest)) in &local {
            let known = state.items.get(id).cloned().unwrap_or_default();
            if known.digest == *digest {
                continue;
            }
            match self.write(name, item, &known.stamp, false) {
                Ok(stamp) => {
                    self.written.push((name.to_string(), id.clone()));
                    let stamp = stamp.unwrap_or_else(|| {
                        self.port
                            .records(name)
                            .into_iter()
                            .find(|record| record.id == *id)
                            .map(|record| record.stamp)
                            .unwrap_or_default()
                    });
                    state.items.insert(
                        id.clone(),
                        ItemState {
                            stamp,
                            digest: digest.clone(),
                        },
                    );
                }
                Err(error) => {
                    self.refuse(name, id, &error);
                    // Retried after the next local change, not every round.
                    state.items.insert(
                        id.clone(),
                        ItemState {
                            stamp: known.stamp,
                            digest: digest.clone(),
                        },
                    );
                }
            }
        }

        // Local deletions: an item this device had, gone here, while the
        // account still holds the version this device last saw.
        let records: BTreeMap<String, AccountRecord> = self
            .port
            .records(name)
            .into_iter()
            .map(|record| (record.id.clone(), record))
            .collect();
        let gone: Vec<String> = state
            .items
            .iter()
            .filter(|(id, known)| !known.digest.is_empty() && !local.contains_key(*id))
            .map(|(id, _)| id.clone())
            .collect();
        for id in gone {
            let known = state.items.get(&id).cloned().unwrap_or_default();
            let current = records.get(&id);
            // Only a version this device saw (or its own offer) is deleted.
            let unchanged = current.is_some_and(|record| {
                record.stamp == known.stamp
                    || known.stamp.is_empty() && writer_of(&record.stamp) == self.device.device_id
            });
            if unchanged && current.is_some_and(|record| record.value.is_some()) {
                match self.port.delete(name, &id) {
                    Ok(stamp) => {
                        let stamp = stamp.unwrap_or_else(|| {
                            current
                                .map(|record| record.stamp.clone())
                                .unwrap_or_default()
                        });
                        state.items.insert(
                            id.clone(),
                            ItemState {
                                stamp,
                                digest: String::new(),
                            },
                        );
                    }
                    Err(error) => self.refuse(name, &id, &error),
                }
            } else if current.is_none() || current.is_some_and(|record| record.value.is_none()) {
                state.items.insert(
                    id.clone(),
                    ItemState {
                        stamp: current
                            .map(|record| record.stamp.clone())
                            .unwrap_or_default(),
                        digest: String::new(),
                    },
                );
            }
            // Otherwise the account changed it since: the account wins below.
        }

        // Account items that changed since this device last saw them.
        let mut touched = Vec::new();
        for record in self.port.records(name) {
            let known = state.items.get(&record.id).cloned().unwrap_or_default();
            if known.stamp == record.stamp {
                continue;
            }
            let here = local.get(&record.id);
            let Some(value) = record.value.as_ref() else {
                if here.is_some() {
                    match binding.remove(&record.id).await {
                        Ok(()) => touched.push((record.id.clone(), record.stamp.clone())),
                        Err(error) => log::warn!(
                            "Account record deletion not applied: collection={name}, id={}, error={error:#}",
                            record.id
                        ),
                    }
                } else {
                    state.items.insert(
                        record.id.clone(),
                        ItemState {
                            stamp: record.stamp.clone(),
                            digest: String::new(),
                        },
                    );
                }
                continue;
            };
            let envelope: Envelope = match serde_json::from_value(value.clone()) {
                Ok(envelope) => envelope,
                Err(error) => {
                    log::warn!(
                        "Account record unreadable, skipped: collection={name}, id={}, error={error}",
                        record.id
                    );
                    continue;
                }
            };
            let digest = envelope_digest(&envelope);
            if here.is_some_and(|(_, local_digest)| *local_digest == digest) {
                state.items.insert(
                    record.id.clone(),
                    ItemState {
                        stamp: record.stamp.clone(),
                        digest,
                    },
                );
                continue;
            }
            let Some(files) = self.content(&envelope).await else {
                self.waiting += 1;
                continue;
            };
            let context = ApplyContext {
                device: self.device.clone(),
                concurrent: here.is_some()
                    && (known.stamp.is_empty() || envelope.base != known.stamp),
            };
            let item = RemoteItem {
                id: record.id.clone(),
                value: envelope.v.clone(),
                files,
                writer: writer_of(&record.stamp),
            };
            match binding.apply(&item, &context).await {
                Ok(()) => touched.push((record.id.clone(), record.stamp.clone())),
                Err(error) => log::warn!(
                    "Account record not applied: collection={name}, id={}, error={error:#}",
                    record.id
                ),
            }
        }

        // Record what the owner stores now, so an apply is not a local edit.
        if !touched.is_empty() {
            let after: BTreeMap<String, String> = binding
                .list(&self.device)
                .await?
                .into_iter()
                .map(|item| {
                    let digest = local_digest(&item);
                    (item.id, digest)
                })
                .collect();
            let mut ids = Vec::new();
            for (id, stamp) in touched {
                let digest = after.get(&id).cloned().unwrap_or_default();
                ids.push(id.clone());
                state.items.insert(id, ItemState { stamp, digest });
            }
            self.applied.push((name, ids));
        }
        Ok(())
    }
}

/// IM bot binding metadata.
pub mod bots;
/// An in-process port (tests, and hosts that run without a device network).
pub mod memory;

#[cfg(test)]
#[path = "account_records_tests.rs"]
mod tests;

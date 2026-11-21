//! The account replica: account-level data that every runtime device
//! (desktop and CLI) keeps and exchanges with the account's other devices
//! over Link. The account directory and the 2.0 services store none of it.
//!
//! - **Records** `(collection, id) -> value` carry a hybrid logical clock
//!   ([`Hlc`]: wall time, a counter, the writing device for ties). The
//!   greater clock wins per record (last writer wins); a deletion is a
//!   tombstone record kept for [`TOMBSTONE_TTL`] so it reaches devices that
//!   were offline. Every runtime device holds every record.
//! - **Collections declare budgets** ([`CollectionPolicy`]: records, bytes,
//!   value size, durable blob holders), so one collection never starves
//!   another. Undeclared collections get [`DEFAULT_COLLECTION_POLICY`].
//! - **Blobs** are immutable and content-addressed (`sha256`). A record names
//!   the blobs it uses ([`ReplicaRecord::blobs`]); devices fetch a blob on
//!   demand from any device that has it (`fleet_blob_get`) and keep it in a
//!   bounded cache. For a collection with `durable_holders = k`, at least
//!   `min(k, runtime devices)` devices **pin** each named blob: each pinning
//!   device writes a holder record (collection [`HOLDERS_COLLECTION`]), so
//!   every device knows the holder count, a device that sees too few holders
//!   fetches and pins the blob itself, and a holder unpins only while enough
//!   other holders remain.
//! - **Exchange** ([`ReplicaSync`]): a local write is pushed at once to every
//!   online peer (`fleet_replica_push`); every [`ReplicaSyncConfig::anti_entropy`],
//!   and whenever a peer comes online, digests are compared
//!   (`fleet_replica_digest`) and a differing peer is pulled
//!   (`fleet_replica_pull`) and pushed to. Writes made while no peer is
//!   reachable stay undelivered and go out on reconnect; a new device pulls
//!   from the first peer it reaches.
//! - **Pushers that are not runtime devices** (the account's cloud node)
//!   write with [`ReplicaAccess::Collections`]: they push records and the
//!   blobs those records name (`fleet_replica_push {records, blobs}`), read
//!   what a device already has (`fleet_replica_list`, `fleet_blob_holders`),
//!   and drop their copy once the push answer reports enough holders. They
//!   never hold a full replica.
//!
//! Settings sync is the first user (collection `settings`,
//! `services-integrations` `remote_connect::settings_sync`). A peer without
//! these verbs answers them as forbidden or unknown and is skipped until it
//! reconnects.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio::sync::{watch, Notify};
use tokio::task::JoinHandle;

use openbitfun_product_domains::fleet::FleetHostKind;

use super::sync::FleetPeerTransport;
use super::FleetCallError;

/// The mesh capability of a host that serves the replica verbs.
pub const ACCOUNT_REPLICA_V1_CAPABILITY: &str = "account_replica_v1";
/// The replica verbs (owner verbs: the account's other runtime hosts call
/// them on the mesh listener; a restricted pusher such as the cloud node
/// gets the subset [`ReplicaAccess::Collections`] allows).
pub const REPLICA_VERBS: &[&str] = &[
    "fleet_blob_get",
    "fleet_blob_holders",
    "fleet_replica_digest",
    "fleet_replica_list",
    "fleet_replica_pull",
    "fleet_replica_push",
];

/// The collection of blob holder records (`<hash>@<device>`).
pub const HOLDERS_COLLECTION: &str = "replica.holders";
/// Most records of the whole replica (a safety net over the budgets).
pub const MAX_RECORDS: usize = 200_000;
/// Largest replica (records only), a safety net over the budgets.
pub const MAX_REPLICA_BYTES: usize = 64 * 1024 * 1024;
/// Largest blob.
pub const MAX_BLOB_BYTES: usize = 4 * 1024 * 1024;
/// Unpinned blobs a device keeps (least recently used go first).
pub const DEFAULT_BLOB_CACHE_BYTES: u64 = 64 * 1024 * 1024;
/// Pinned blobs a device keeps at most.
pub const MAX_PINNED_BYTES: u64 = 2 * 1024 * 1024 * 1024;
/// Records one `fleet_replica_list` answers at most.
pub const MAX_LIST: usize = 500;
/// How long a tombstone is kept.
pub const TOMBSTONE_TTL: Duration = Duration::from_secs(30 * 86_400);
/// How far ahead of this device's clock a remote clock may be before it is
/// clamped (a device with a wrong clock cannot win every write for years).
const MAX_CLOCK_SKEW_MS: u64 = 24 * 3600 * 1000;

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis().min(u64::MAX as u128) as u64)
        .unwrap_or(0)
}

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------

/// A collection's budget, declared by its owner.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CollectionPolicy {
    /// A collection name, or a prefix ending in `.` for every collection
    /// under it (`superagent.`).
    pub name: &'static str,
    pub max_records: usize,
    /// Bytes of the collection's records (JSON).
    pub max_bytes: usize,
    pub max_value_bytes: usize,
    /// Devices that must pin every blob the collection's records name
    /// (`0`: its blobs are fetched on demand only and never pinned).
    pub durable_holders: usize,
}

/// Account settings: a few hundred small values.
pub const SETTINGS_COLLECTION_POLICY: CollectionPolicy = CollectionPolicy {
    name: "settings",
    max_records: 256,
    max_bytes: 256 * 1024,
    max_value_bytes: 32 * 1024,
    durable_holders: 0,
};

/// A collection nobody declared on this device (one a newer build writes).
pub const DEFAULT_COLLECTION_POLICY: CollectionPolicy = CollectionPolicy {
    name: "",
    max_records: 256,
    max_bytes: 256 * 1024,
    max_value_bytes: 32 * 1024,
    durable_holders: 0,
};

const HOLDERS_COLLECTION_POLICY: CollectionPolicy = CollectionPolicy {
    name: HOLDERS_COLLECTION,
    max_records: 100_000,
    max_bytes: 16 * 1024 * 1024,
    max_value_bytes: 512,
    durable_holders: 0,
};

impl CollectionPolicy {
    fn covers(&self, collection: &str) -> bool {
        if self.name.ends_with('.') {
            collection.starts_with(self.name)
        } else {
            collection == self.name
        }
    }
}

// ---------------------------------------------------------------------------
// Clock and records
// ---------------------------------------------------------------------------

/// A hybrid logical clock value. Ordered by wall time, then counter, then
/// device id, so every device picks the same winner.
#[derive(Debug, Clone, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Hlc {
    pub wall_ms: u64,
    #[serde(default)]
    pub counter: u32,
    #[serde(default)]
    pub device_id: String,
}

impl Hlc {
    /// The clock of an offer: a value a device brings along (one nobody
    /// chose on this account yet). Every real write overrides it (its wall
    /// time is 0); between offers the earlier one wins (the counter counts
    /// down from the time of the offer), so the first device of an account
    /// keeps its values and a device that joins later takes them.
    pub fn seed(device_id: &str) -> Self {
        let seconds = (now_ms() / 1000).min(u64::from(u32::MAX)) as u32;
        Self {
            wall_ms: 0,
            counter: u32::MAX - seconds,
            device_id: device_id.to_string(),
        }
    }

    /// Whether this clock is an offer ([`Self::seed`]).
    pub fn is_seed(&self) -> bool {
        self.wall_ms == 0
    }

    /// A string that orders like the clock (for consumers that compare it).
    pub fn stamp(&self) -> String {
        format!(
            "{:016x}-{:08x}-{}",
            self.wall_ms, self.counter, self.device_id
        )
    }
}

/// A blob a record names.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlobRef {
    /// `sha256` of the content (lowercase hex).
    pub hash: String,
    #[serde(default)]
    pub bytes: u64,
}

/// One record: a value, or a tombstone (`value: None`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplicaRecord {
    pub collection: String,
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<Value>,
    pub hlc: Hlc,
    /// The blobs this record uses (immutable, content-addressed).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub blobs: Vec<BlobRef>,
}

impl ReplicaRecord {
    pub fn is_tombstone(&self) -> bool {
        self.value.is_none()
    }

    fn key(&self) -> (String, String) {
        (self.collection.clone(), self.id.clone())
    }
}

/// Why a write was refused.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReplicaError {
    InvalidKey,
    ValueTooLarge(usize),
    /// The collection's budget (or the replica's) is used up.
    Full(String),
    BlobTooLarge(usize),
    BlobMismatch,
    /// A restricted pusher wrote outside its collections.
    Forbidden(String),
    /// The value carries a secret at this path (account records never do:
    /// `product_domains::fleet::account_records::find_secret`).
    SecretField(String),
}

impl std::fmt::Display for ReplicaError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidKey => write!(f, "account replica: invalid collection or id"),
            Self::ValueTooLarge(size) => {
                write!(
                    f,
                    "account replica: value of {size} bytes is over the limit"
                )
            }
            Self::Full(collection) => {
                write!(f, "account replica: the budget of {collection} is used up")
            }
            Self::BlobTooLarge(size) => {
                write!(f, "account replica: blob of {size} bytes is over the limit")
            }
            Self::BlobMismatch => {
                write!(f, "account replica: blob content does not match its hash")
            }
            Self::Forbidden(collection) => {
                write!(
                    f,
                    "account replica: writing {collection} is not allowed for this caller"
                )
            }
            Self::SecretField(path) => {
                write!(
                    f,
                    "account replica: the value carries a secret at {path:?}; secrets stay on the device"
                )
            }
        }
    }
}

impl std::error::Error for ReplicaError {}

fn valid_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 256
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._:/@-".contains(&byte))
}

/// Where a value of `collection` carries a secret (holder records are the
/// replica's own bookkeeping).
fn secret_in(collection: &str, value: &Value) -> Option<String> {
    if collection == HOLDERS_COLLECTION {
        return None;
    }
    openbitfun_product_domains::fleet::account_records::find_secret(value)
}

fn valid_hash(hash: &str) -> bool {
    hash.len() == 64
        && hash
            .bytes()
            .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
}

/// Who calls a replica verb.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReplicaAccess {
    /// Another runtime device of the account: every verb, every collection.
    Device,
    /// A pusher that is not a runtime device (the cloud node): push, list,
    /// blob reads and holder counts, only for collections under these
    /// names or prefixes (ending in `.`); never the full replica.
    Collections(Vec<String>),
}

impl ReplicaAccess {
    fn allows(&self, collection: &str) -> bool {
        match self {
            Self::Device => true,
            Self::Collections(names) => names.iter().any(|name| {
                if name.ends_with('.') {
                    collection.starts_with(name.as_str())
                } else {
                    collection == name
                }
            }),
        }
    }
}

/// The replica's status, as consumers report it.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplicaStatus {
    /// Other runtime devices of the account that serve the replica.
    pub peers: usize,
    /// Of those, the ones online and reachable now.
    pub peers_online: usize,
    /// Local writes no peer has acknowledged yet.
    pub undelivered: usize,
    /// An exchange is running.
    pub exchanging: bool,
    /// When a peer last acknowledged an exchange (unix ms).
    pub last_exchange_ms: Option<u64>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct ReplicaFile {
    version: u32,
    device_id: String,
    records: Vec<ReplicaRecord>,
    /// Keys of local writes no peer acknowledged yet.
    undelivered: Vec<(String, String)>,
    last_clock: Hlc,
    /// Blobs this device pins.
    pinned: Vec<String>,
}

#[derive(Default, Clone, Copy)]
struct Usage {
    records: usize,
    bytes: usize,
}

struct Inner {
    records: BTreeMap<(String, String), ReplicaRecord>,
    undelivered: BTreeSet<(String, String)>,
    last_clock: Hlc,
    bytes: usize,
    usage: HashMap<String, Usage>,
    pinned: BTreeSet<String>,
}

/// One device's copy of the account replica.
pub struct AccountReplica {
    device_id: String,
    path: Option<PathBuf>,
    blob_dir: Option<PathBuf>,
    inner: Mutex<Inner>,
    policies: Mutex<Vec<CollectionPolicy>>,
    blob_cache_bytes: std::sync::atomic::AtomicU64,
    /// Bumped on every change (local write or merged remote record).
    changes: watch::Sender<u64>,
    /// Bumped on local writes (the exchange pushes them).
    local: Arc<Notify>,
    status: watch::Sender<ReplicaStatus>,
}

fn encoded_len(record: &ReplicaRecord) -> usize {
    serde_json::to_vec(record)
        .map(|bytes| bytes.len())
        .unwrap_or(0)
}

fn holder_id(hash: &str, device_id: &str) -> String {
    format!("{hash}@{device_id}")
}

impl AccountReplica {
    /// Opens the replica kept at `path` (`None`: memory only; blobs are then
    /// not kept either). A file of another device, an unreadable one or
    /// expired tombstones are not loaded; an unreadable file is set aside,
    /// never deleted. Settings are declared from the start.
    pub fn open(device_id: impl Into<String>, path: Option<PathBuf>) -> Arc<Self> {
        let device_id = device_id.into();
        let mut inner = Inner {
            records: BTreeMap::new(),
            undelivered: BTreeSet::new(),
            last_clock: Hlc {
                device_id: device_id.clone(),
                ..Hlc::default()
            },
            bytes: 0,
            usage: HashMap::new(),
            pinned: BTreeSet::new(),
        };
        if let Some(path) = path.as_deref() {
            match std::fs::read(path) {
                Ok(bytes) => match serde_json::from_slice::<ReplicaFile>(&bytes) {
                    Ok(file) if file.device_id == device_id || file.device_id.is_empty() => {
                        let horizon = now_ms().saturating_sub(TOMBSTONE_TTL.as_millis() as u64);
                        for record in file.records {
                            if record.is_tombstone() && record.hlc.wall_ms < horizon {
                                continue;
                            }
                            let size = encoded_len(&record);
                            inner.bytes += size;
                            let usage = inner.usage.entry(record.collection.clone()).or_default();
                            usage.records += 1;
                            usage.bytes += size;
                            inner.records.insert(record.key(), record);
                        }
                        inner.undelivered = file
                            .undelivered
                            .into_iter()
                            .filter(|key| inner.records.contains_key(key))
                            .collect();
                        inner.pinned = file
                            .pinned
                            .into_iter()
                            .filter(|hash| valid_hash(hash))
                            .collect();
                        if file.last_clock > inner.last_clock {
                            inner.last_clock = file.last_clock;
                        }
                    }
                    Ok(_) => {
                        log::warn!("Account replica file belongs to another device; starting empty")
                    }
                    Err(error) => {
                        log::warn!("Account replica file unreadable, set aside: {error}");
                        let _ = std::fs::rename(path, path.with_extension("json.unreadable"));
                    }
                },
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => log::warn!("Account replica file not read: {error}"),
            }
        }
        let blob_dir = path.as_deref().map(|path| path.with_extension("blobs"));
        let replica = Arc::new(Self {
            device_id,
            path,
            blob_dir,
            inner: Mutex::new(inner),
            policies: Mutex::new(vec![SETTINGS_COLLECTION_POLICY, HOLDERS_COLLECTION_POLICY]),
            blob_cache_bytes: std::sync::atomic::AtomicU64::new(DEFAULT_BLOB_CACHE_BYTES),
            changes: watch::channel(0).0,
            local: Arc::new(Notify::new()),
            status: watch::channel(ReplicaStatus::default()).0,
        });
        // Every account-record collection has its budget before the first
        // exchange merges anything into it.
        replica.declare_account_collections();
        replica
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn device_id(&self) -> &str {
        &self.device_id
    }

    /// Declares (or replaces) a collection's budget.
    pub fn declare(&self, policy: CollectionPolicy) {
        let mut policies = self.policies.lock().unwrap_or_else(|p| p.into_inner());
        policies.retain(|existing| existing.name != policy.name);
        policies.push(policy);
    }

    /// The budget that applies to `collection` (an exact name before the
    /// longest prefix, else [`DEFAULT_COLLECTION_POLICY`]).
    pub fn policy(&self, collection: &str) -> CollectionPolicy {
        let policies = self.policies.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(exact) = policies.iter().find(|policy| policy.name == collection) {
            return *exact;
        }
        policies
            .iter()
            .filter(|policy| policy.covers(collection))
            .max_by_key(|policy| policy.name.len())
            .copied()
            .unwrap_or(DEFAULT_COLLECTION_POLICY)
    }

    /// How many unpinned blob bytes this device keeps.
    pub fn set_blob_cache_bytes(&self, bytes: u64) {
        self.blob_cache_bytes
            .store(bytes, std::sync::atomic::Ordering::Relaxed);
    }

    /// Follows every change (local writes and merged remote records).
    pub fn subscribe(&self) -> watch::Receiver<u64> {
        self.changes.subscribe()
    }

    pub fn status(&self) -> ReplicaStatus {
        self.status.borrow().clone()
    }

    pub fn subscribe_status(&self) -> watch::Receiver<ReplicaStatus> {
        self.status.subscribe()
    }

    fn update_status(&self, update: impl FnOnce(&mut ReplicaStatus)) {
        let undelivered = self.lock().undelivered.len();
        self.status.send_if_modified(|status| {
            let before = status.clone();
            update(status);
            status.undelivered = undelivered;
            *status != before
        });
    }

    fn persist(&self, inner: &Inner) {
        let Some(path) = self.path.as_deref() else {
            return;
        };
        let file = ReplicaFile {
            version: 1,
            device_id: self.device_id.clone(),
            records: inner.records.values().cloned().collect(),
            undelivered: inner.undelivered.iter().cloned().collect(),
            last_clock: inner.last_clock.clone(),
            pinned: inner.pinned.iter().cloned().collect(),
        };
        let result = (|| -> std::io::Result<()> {
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let tmp = path.with_extension("json.tmp");
            std::fs::write(&tmp, serde_json::to_vec(&file)?)?;
            std::fs::rename(&tmp, path)
        })();
        if let Err(error) = result {
            log::warn!("Account replica not saved: {error}");
        }
    }

    /// The next clock of a local write (after every clock seen so far).
    fn tick(inner: &mut Inner, device_id: &str) -> Hlc {
        let wall = now_ms().max(inner.last_clock.wall_ms);
        let counter = if wall == inner.last_clock.wall_ms {
            inner.last_clock.counter.saturating_add(1)
        } else {
            0
        };
        inner.last_clock = Hlc {
            wall_ms: wall,
            counter,
            device_id: device_id.to_string(),
        };
        inner.last_clock.clone()
    }

    fn store(&self, inner: &mut Inner, record: ReplicaRecord) -> Result<(), ReplicaError> {
        let policy = self.policy(&record.collection);
        let size = encoded_len(&record);
        let replaced = inner.records.get(&record.key()).map(encoded_len);
        let usage = inner
            .usage
            .get(&record.collection)
            .copied()
            .unwrap_or_default();
        let added = usize::from(replaced.is_none());
        let replaced = replaced.unwrap_or(0);
        if usage.records + added > policy.max_records
            || usage.bytes + size - replaced.min(usage.bytes + size) > policy.max_bytes
            || inner.records.len() + added > MAX_RECORDS
            || inner.bytes + size - replaced.min(inner.bytes + size) > MAX_REPLICA_BYTES
        {
            return Err(ReplicaError::Full(record.collection.clone()));
        }
        inner.bytes = inner.bytes + size - replaced;
        let usage = inner.usage.entry(record.collection.clone()).or_default();
        usage.records += added;
        usage.bytes = usage.bytes + size - replaced;
        inner.records.insert(record.key(), record);
        Ok(())
    }

    fn remove(inner: &mut Inner, key: &(String, String)) {
        if let Some(record) = inner.records.remove(key) {
            let size = encoded_len(&record);
            inner.bytes = inner.bytes.saturating_sub(size);
            if let Some(usage) = inner.usage.get_mut(&record.collection) {
                usage.records = usage.records.saturating_sub(1);
                usage.bytes = usage.bytes.saturating_sub(size);
            }
        }
        inner.undelivered.remove(key);
    }

    fn write(
        &self,
        collection: &str,
        id: &str,
        value: Option<Value>,
        blobs: Vec<BlobRef>,
        seed: bool,
    ) -> Result<Option<ReplicaRecord>, ReplicaError> {
        if !valid_name(collection) || !valid_name(id) {
            return Err(ReplicaError::InvalidKey);
        }
        if blobs.iter().any(|blob| !valid_hash(&blob.hash)) {
            return Err(ReplicaError::InvalidKey);
        }
        if let Some(value) = value.as_ref() {
            let size = serde_json::to_vec(value)
                .map(|bytes| bytes.len())
                .unwrap_or(0);
            if size > self.policy(collection).max_value_bytes {
                return Err(ReplicaError::ValueTooLarge(size));
            }
            if let Some(path) = secret_in(collection, value) {
                return Err(ReplicaError::SecretField(path));
            }
        }
        let record = {
            let mut inner = self.lock();
            let key = (collection.to_string(), id.to_string());
            let current = inner.records.get(&key);
            // A seed fills a gap or replaces a later seed; any real write stays.
            if seed && current.is_some_and(|current| current.hlc >= Hlc::seed(&self.device_id)) {
                return Ok(None);
            }
            if current.is_some_and(|current| current.value == value && current.blobs == blobs) {
                return Ok(None);
            }
            let hlc = if seed {
                Hlc::seed(&self.device_id)
            } else {
                Self::tick(&mut inner, &self.device_id)
            };
            let record = ReplicaRecord {
                collection: collection.to_string(),
                id: id.to_string(),
                value,
                hlc,
                blobs,
            };
            self.store(&mut inner, record.clone())?;
            inner.undelivered.insert(key);
            self.persist(&inner);
            record
        };
        self.changes.send_modify(|seq| *seq += 1);
        self.local.notify_one();
        self.update_status(|_| {});
        Ok(Some(record))
    }

    /// Writes a value (a new clock). `Ok(None)`: the value was already stored.
    pub fn put(
        &self,
        collection: &str,
        id: &str,
        value: Value,
    ) -> Result<Option<ReplicaRecord>, ReplicaError> {
        self.write(collection, id, Some(value), Vec::new(), false)
    }

    /// Writes a value that names blobs (they should be held here first, see
    /// [`Self::put_blob`]).
    pub fn put_with_blobs(
        &self,
        collection: &str,
        id: &str,
        value: Value,
        blobs: Vec<BlobRef>,
    ) -> Result<Option<ReplicaRecord>, ReplicaError> {
        self.write(collection, id, Some(value), blobs, false)
    }

    /// Offers an initial value with the lowest clock: stored only when the
    /// record is absent (or a later offer), and any real write overrides it.
    pub fn seed(
        &self,
        collection: &str,
        id: &str,
        value: Value,
    ) -> Result<Option<ReplicaRecord>, ReplicaError> {
        self.write(collection, id, Some(value), Vec::new(), true)
    }

    /// An offer that names blobs ([`Self::seed`] with [`Self::put_with_blobs`]'s
    /// blobs).
    pub fn seed_with_blobs(
        &self,
        collection: &str,
        id: &str,
        value: Value,
        blobs: Vec<BlobRef>,
    ) -> Result<Option<ReplicaRecord>, ReplicaError> {
        self.write(collection, id, Some(value), blobs, true)
    }

    /// Declares the budget of every account-record collection
    /// (`product_domains::fleet::account_records::ACCOUNT_COLLECTIONS`), also
    /// the ones this host does not apply, so it holds and relays them all.
    pub fn declare_account_collections(&self) {
        for budget in openbitfun_product_domains::fleet::account_records::ACCOUNT_COLLECTIONS {
            self.declare(CollectionPolicy {
                name: budget.name,
                max_records: budget.max_records,
                max_bytes: budget.max_bytes,
                max_value_bytes: budget.max_value_bytes,
                durable_holders: budget.durable_holders,
            });
        }
    }

    /// Deletes a record (a tombstone, kept for [`TOMBSTONE_TTL`]).
    pub fn delete(
        &self,
        collection: &str,
        id: &str,
    ) -> Result<Option<ReplicaRecord>, ReplicaError> {
        if !self
            .lock()
            .records
            .contains_key(&(collection.to_string(), id.to_string()))
        {
            return Ok(None);
        }
        self.write(collection, id, None, Vec::new(), false)
    }

    pub fn get(&self, collection: &str, id: &str) -> Option<ReplicaRecord> {
        self.lock()
            .records
            .get(&(collection.to_string(), id.to_string()))
            .cloned()
    }

    /// Every record of a collection, tombstones included.
    pub fn records(&self, collection: &str) -> Vec<ReplicaRecord> {
        self.lock()
            .records
            .values()
            .filter(|record| record.collection == collection)
            .cloned()
            .collect()
    }

    /// Every record.
    pub fn snapshot(&self) -> Vec<ReplicaRecord> {
        self.lock().records.values().cloned().collect()
    }

    /// Merges records from a peer; returns the ones that changed here. A
    /// record wins when its clock is greater; a clock far ahead of this
    /// device's is clamped first.
    pub fn merge(&self, incoming: Vec<ReplicaRecord>) -> Vec<ReplicaRecord> {
        let horizon = now_ms().saturating_sub(TOMBSTONE_TTL.as_millis() as u64);
        let ceiling = now_ms().saturating_add(MAX_CLOCK_SKEW_MS);
        let mut changed = Vec::new();
        {
            let mut inner = self.lock();
            for mut record in incoming {
                if !valid_name(&record.collection)
                    || !valid_name(&record.id)
                    || record.blobs.iter().any(|blob| !valid_hash(&blob.hash))
                {
                    continue;
                }
                if record.is_tombstone() && record.hlc.wall_ms < horizon {
                    continue;
                }
                if let Some(path) = record
                    .value
                    .as_ref()
                    .and_then(|value| secret_in(&record.collection, value))
                {
                    log::warn!(
                        "Account replica record with a secret refused: collection={}, path={path}",
                        record.collection
                    );
                    continue;
                }
                if record.hlc.wall_ms > ceiling {
                    record.hlc.wall_ms = ceiling;
                }
                let key = record.key();
                if inner
                    .records
                    .get(&key)
                    .is_some_and(|current| current.hlc >= record.hlc)
                {
                    continue;
                }
                if record.hlc > inner.last_clock {
                    inner.last_clock = Hlc {
                        wall_ms: record.hlc.wall_ms,
                        counter: record.hlc.counter,
                        device_id: self.device_id.clone(),
                    };
                }
                if let Err(error) = self.store(&mut inner, record.clone()) {
                    log::warn!(
                        "Account replica record not merged: collection={}, error={error}",
                        record.collection
                    );
                    continue;
                }
                // A newer remote write replaces a local one not yet delivered.
                inner.undelivered.remove(&key);
                changed.push(record);
            }
            if !changed.is_empty() {
                self.persist(&inner);
            }
        }
        if !changed.is_empty() {
            self.changes.send_modify(|seq| *seq += 1);
            self.update_status(|_| {});
        }
        changed
    }

    /// A digest of every record's key and clock: equal digests hold the
    /// same records.
    pub fn digest(&self) -> String {
        let inner = self.lock();
        let mut hasher = Sha256::new();
        for record in inner.records.values() {
            hasher.update(record.collection.as_bytes());
            hasher.update([0]);
            hasher.update(record.id.as_bytes());
            hasher.update([0]);
            hasher.update(record.hlc.stamp().as_bytes());
            hasher.update([u8::from(record.is_tombstone())]);
        }
        hasher.finalize()[..16]
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect()
    }

    /// The local writes no peer acknowledged.
    pub fn undelivered(&self) -> Vec<ReplicaRecord> {
        let inner = self.lock();
        inner
            .undelivered
            .iter()
            .filter_map(|key| inner.records.get(key).cloned())
            .collect()
    }

    /// A peer acknowledged these records (as they are now).
    fn delivered(&self, records: &[ReplicaRecord]) {
        {
            let mut inner = self.lock();
            let mut removed = false;
            for record in records {
                let key = record.key();
                if inner
                    .records
                    .get(&key)
                    .is_some_and(|current| current.hlc == record.hlc)
                {
                    removed |= inner.undelivered.remove(&key);
                }
            }
            if removed {
                self.persist(&inner);
            }
        }
        self.update_status(|status| status.last_exchange_ms = Some(now_ms()));
    }

    /// Purges tombstones older than [`TOMBSTONE_TTL`].
    pub fn purge_tombstones(&self) -> usize {
        let horizon = now_ms().saturating_sub(TOMBSTONE_TTL.as_millis() as u64);
        let mut inner = self.lock();
        let expired: Vec<_> = inner
            .records
            .iter()
            .filter(|(_, record)| record.is_tombstone() && record.hlc.wall_ms < horizon)
            .map(|(key, _)| key.clone())
            .collect();
        for key in &expired {
            Self::remove(&mut inner, key);
        }
        if !expired.is_empty() {
            self.persist(&inner);
        }
        expired.len()
    }

    // ── Blobs ───────────────────────────────────────────────────────────

    /// The sha256 (hex) a blob is addressed by.
    pub fn blob_hash(bytes: &[u8]) -> String {
        Sha256::digest(bytes)
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect()
    }

    fn blob_path(&self, hash: &str) -> Option<PathBuf> {
        if !valid_hash(hash) {
            return None;
        }
        self.blob_dir.as_ref().map(|dir| dir.join(hash))
    }

    /// Whether this device holds the blob now.
    pub fn has_blob(&self, hash: &str) -> bool {
        self.blob_path(hash).is_some_and(|path| path.exists())
    }

    /// Whether this device pins the blob.
    pub fn is_pinned(&self, hash: &str) -> bool {
        self.lock().pinned.contains(hash)
    }

    fn blob_usage(&self) -> (u64, u64) {
        let pinned = self.lock().pinned.clone();
        let Some(dir) = self.blob_dir.as_ref() else {
            return (0, 0);
        };
        let mut cached = 0;
        let mut held = 0;
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let size = entry.metadata().map(|meta| meta.len()).unwrap_or(0);
                if pinned.contains(entry.file_name().to_string_lossy().as_ref()) {
                    held += size;
                } else {
                    cached += size;
                }
            }
        }
        (cached, held)
    }

    /// Keeps a blob here (`pin`: as a durable holder, which writes this
    /// device's holder record); returns its hash. An existing blob is only
    /// pinned when asked.
    pub fn put_blob(&self, bytes: &[u8], pin: bool) -> Result<String, ReplicaError> {
        if bytes.len() > MAX_BLOB_BYTES {
            return Err(ReplicaError::BlobTooLarge(bytes.len()));
        }
        let hash = Self::blob_hash(bytes);
        let Some(path) = self.blob_path(&hash) else {
            return Err(ReplicaError::Full("blobs".into()));
        };
        if !path.exists() {
            let (_, held) = self.blob_usage();
            if pin && held + bytes.len() as u64 > MAX_PINNED_BYTES {
                return Err(ReplicaError::Full("blobs".into()));
            }
            let write = (|| -> std::io::Result<()> {
                if let Some(parent) = path.parent() {
                    std::fs::create_dir_all(parent)?;
                }
                let tmp = path.with_extension("tmp");
                std::fs::write(&tmp, bytes)?;
                std::fs::rename(&tmp, &path)
            })();
            write.map_err(|error| {
                log::warn!("Account replica blob not kept: {error}");
                ReplicaError::Full("blobs".into())
            })?;
        }
        if pin {
            self.pin(&hash, bytes.len() as u64);
        } else {
            self.trim_cache();
        }
        Ok(hash)
    }

    /// Stores pushed blob content after checking it against `hash`.
    pub fn put_blob_checked(
        &self,
        hash: &str,
        bytes: &[u8],
        pin: bool,
    ) -> Result<String, ReplicaError> {
        if Self::blob_hash(bytes) != hash {
            return Err(ReplicaError::BlobMismatch);
        }
        self.put_blob(bytes, pin)
    }

    fn pin(&self, hash: &str, bytes: u64) {
        let newly = {
            let mut inner = self.lock();
            let newly = inner.pinned.insert(hash.to_string());
            if newly {
                self.persist(&inner);
            }
            newly
        };
        if newly
            || self
                .get(HOLDERS_COLLECTION, &holder_id(hash, &self.device_id))
                .is_none_or(|record| record.is_tombstone())
        {
            let _ = self.put(
                HOLDERS_COLLECTION,
                &holder_id(hash, &self.device_id),
                json!({ "hash": hash, "deviceId": self.device_id, "bytes": bytes }),
            );
        }
    }

    /// A blob this device holds (checked against its hash; a read keeps a
    /// cached blob fresh).
    pub fn blob(&self, hash: &str) -> Option<Vec<u8>> {
        let path = self.blob_path(hash)?;
        let bytes = std::fs::read(&path).ok()?;
        if Self::blob_hash(&bytes) != hash {
            return None;
        }
        if let Ok(file) = std::fs::File::options().append(true).open(&path) {
            let _ = file.set_modified(SystemTime::now());
        }
        Some(bytes)
    }

    /// The devices that pin a blob (from their holder records).
    pub fn holders(&self, hash: &str) -> Vec<String> {
        let prefix = format!("{hash}@");
        self.lock()
            .records
            .values()
            .filter(|record| {
                record.collection == HOLDERS_COLLECTION
                    && !record.is_tombstone()
                    && record.id.starts_with(&prefix)
            })
            .map(|record| record.id[prefix.len()..].to_string())
            .collect()
    }

    /// The blobs live records of durable collections name, with the holder
    /// count each needs.
    pub fn durable_blobs(&self) -> Vec<(BlobRef, usize)> {
        let records: Vec<ReplicaRecord> = self
            .lock()
            .records
            .values()
            .filter(|record| !record.is_tombstone() && !record.blobs.is_empty())
            .cloned()
            .collect();
        let mut needed: BTreeMap<BlobRef, usize> = BTreeMap::new();
        for record in records {
            let durable = self.policy(&record.collection).durable_holders;
            if durable == 0 {
                continue;
            }
            for blob in record.blobs {
                let entry = needed.entry(blob).or_default();
                *entry = (*entry).max(durable);
            }
        }
        needed.into_iter().collect()
    }

    /// Drops a blob this device holds. A pinned blob that live records
    /// still need is kept unless at least `durable_holders` other devices
    /// hold it.
    pub fn evict_blob(&self, hash: &str) -> bool {
        let needed = self
            .durable_blobs()
            .into_iter()
            .find(|(blob, _)| blob.hash == hash)
            .map(|(_, holders)| holders)
            .unwrap_or(0);
        let others = self
            .holders(hash)
            .into_iter()
            .filter(|device| device != &self.device_id)
            .count();
        if self.is_pinned(hash) && needed > 0 && others < needed {
            return false;
        }
        if let Some(path) = self.blob_path(hash) {
            let _ = std::fs::remove_file(path);
        }
        let was_pinned = {
            let mut inner = self.lock();
            let was = inner.pinned.remove(hash);
            if was {
                self.persist(&inner);
            }
            was
        };
        if was_pinned {
            let _ = self.delete(HOLDERS_COLLECTION, &holder_id(hash, &self.device_id));
        }
        true
    }

    /// Keeps the unpinned cache under its budget (least recently used go)
    /// and unpins blobs no live record needs.
    pub fn trim_cache(&self) {
        let Some(dir) = self.blob_dir.clone() else {
            return;
        };
        let needed: BTreeSet<String> = self
            .durable_blobs()
            .into_iter()
            .map(|(blob, _)| blob.hash)
            .collect();
        let pinned = self.lock().pinned.clone();
        for hash in pinned.difference(&needed) {
            self.evict_blob(hash);
        }
        let pinned = self.lock().pinned.clone();
        let mut cached: Vec<(SystemTime, u64, PathBuf)> = std::fs::read_dir(&dir)
            .map(|entries| {
                entries
                    .flatten()
                    .filter(|entry| !pinned.contains(entry.file_name().to_string_lossy().as_ref()))
                    .filter_map(|entry| {
                        let meta = entry.metadata().ok()?;
                        Some((meta.modified().ok()?, meta.len(), entry.path()))
                    })
                    .collect()
            })
            .unwrap_or_default();
        let budget = self
            .blob_cache_bytes
            .load(std::sync::atomic::Ordering::Relaxed);
        let mut used: u64 = cached.iter().map(|(_, size, _)| size).sum();
        cached.sort_by_key(|(modified, _, _)| *modified);
        for (_, size, path) in cached {
            if used <= budget {
                break;
            }
            let _ = std::fs::remove_file(path);
            used = used.saturating_sub(size);
        }
    }

    // ── Verbs ───────────────────────────────────────────────────────────

    /// Answers a replica verb for another runtime device; `None` for any
    /// other command.
    pub fn handle(&self, command: &str, args: &Value) -> Option<Result<Value, String>> {
        self.handle_as(command, args, &ReplicaAccess::Device)
    }

    /// Answers a replica verb for `access` (a restricted pusher gets push,
    /// list, blob reads and holder counts for its collections only).
    pub fn handle_as(
        &self,
        command: &str,
        args: &Value,
        access: &ReplicaAccess,
    ) -> Option<Result<Value, String>> {
        if !REPLICA_VERBS.contains(&command) {
            return None;
        }
        let request = args.get("request").cloned().unwrap_or(Value::Null);
        let restricted = matches!(access, ReplicaAccess::Collections(_));
        Some(match command {
            "fleet_replica_digest" | "fleet_replica_pull" if restricted => Err(format!(
                "{command}: forbidden for a caller that is not a runtime device"
            )),
            "fleet_replica_digest" => Ok(json!({
                "digest": self.digest(),
                "deviceId": self.device_id,
            })),
            "fleet_replica_pull" => Ok(json!({
                "digest": self.digest(),
                "records": self.snapshot(),
            })),
            "fleet_replica_push" => self.push_verb(&request, access),
            "fleet_replica_list" => self.list_verb(&request, access),
            "fleet_blob_holders" => {
                let hashes: Vec<String> = request
                    .get("hashes")
                    .and_then(Value::as_array)
                    .map(|hashes| {
                        hashes
                            .iter()
                            .filter_map(Value::as_str)
                            .filter(|hash| valid_hash(hash))
                            .take(MAX_LIST)
                            .map(str::to_string)
                            .collect()
                    })
                    .unwrap_or_default();
                let holders: serde_json::Map<String, Value> = hashes
                    .into_iter()
                    .map(|hash| {
                        let holders = self.holders(&hash);
                        (hash, json!(holders))
                    })
                    .collect();
                Ok(json!({ "holders": holders }))
            }
            "fleet_blob_get" => {
                use base64::Engine;
                let hash = request.get("hash").and_then(Value::as_str).unwrap_or("");
                if restricted && !self.blob_visible_to(hash, access) {
                    return Some(Err(format!(
                        "fleet_blob_get: blob {hash} is not readable for this caller"
                    )));
                }
                match self.blob(hash) {
                    Some(bytes) => Ok(json!({
                        "hash": hash,
                        "data": base64::engine::general_purpose::STANDARD.encode(bytes),
                    })),
                    None => Err(format!("fleet_blob_get: blob {hash} is not held here")),
                }
            }
            _ => return None,
        })
    }

    fn blob_visible_to(&self, hash: &str, access: &ReplicaAccess) -> bool {
        self.lock().records.values().any(|record| {
            access.allows(&record.collection) && record.blobs.iter().any(|blob| blob.hash == hash)
        })
    }

    /// `fleet_replica_push {records?, blobs?: [{hash, data}]}`: merges the
    /// records, keeps the blobs (pinned when a durable collection's record
    /// names them) and answers what is stored and who holds each blob.
    fn push_verb(&self, request: &Value, access: &ReplicaAccess) -> Result<Value, String> {
        use base64::Engine;
        let records: Vec<ReplicaRecord> = match request.get("records") {
            None | Some(Value::Null) => Vec::new(),
            Some(records) => serde_json::from_value(records.clone())
                .map_err(|error| format!("fleet_replica_push: invalid records: {error}"))?,
        };
        if let Some(record) = records
            .iter()
            .find(|record| !access.allows(&record.collection))
        {
            return Err(ReplicaError::Forbidden(record.collection.clone()).to_string());
        }
        let pushed_refs: BTreeSet<String> = records
            .iter()
            .flat_map(|record| record.blobs.iter().map(|blob| blob.hash.clone()))
            .collect();
        let keys: Vec<(String, String, Hlc)> = records
            .iter()
            .map(|record| {
                (
                    record.collection.clone(),
                    record.id.clone(),
                    record.hlc.clone(),
                )
            })
            .collect();
        let accepted = self.merge(records).len();
        let durable: BTreeSet<String> = self
            .durable_blobs()
            .into_iter()
            .map(|(blob, _)| blob.hash)
            .collect();
        let mut blob_answers = Vec::new();
        for blob in request
            .get("blobs")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let hash = blob
                .get("hash")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            if access != &ReplicaAccess::Device
                && !pushed_refs.contains(&hash)
                && !self.blob_visible_to(&hash, access)
            {
                blob_answers.push(json!({ "hash": hash, "stored": false, "error": "not named by an allowed record" }));
                continue;
            }
            let data = blob
                .get("data")
                .and_then(Value::as_str)
                .and_then(|data| base64::engine::general_purpose::STANDARD.decode(data).ok());
            let stored = match data {
                Some(bytes) => self
                    .put_blob_checked(&hash, &bytes, durable.contains(&hash))
                    .map(|_| ())
                    .map_err(|error| error.to_string()),
                None => Err("missing or invalid data".to_string()),
            };
            blob_answers.push(match stored {
                Ok(()) => json!({ "hash": hash, "stored": true, "holders": self.holders(&hash) }),
                Err(error) => json!({ "hash": hash, "stored": false, "error": error }),
            });
        }
        let record_answers: Vec<Value> = keys
            .into_iter()
            .map(|(collection, id, hlc)| {
                let current = self.get(&collection, &id);
                json!({
                    "collection": collection,
                    "id": id,
                    // Stored: this device now holds that write or a later one.
                    "stored": current.as_ref().is_some_and(|current| current.hlc >= hlc),
                    "stamp": current.map(|current| current.hlc.stamp()),
                })
            })
            .collect();
        Ok(json!({
            "digest": self.digest(),
            "accepted": accepted,
            "records": record_answers,
            "blobs": blob_answers,
        }))
    }

    /// `fleet_replica_list {collection, sinceStamp?, limit?}`: the records of
    /// one collection after a stamp, in stamp order (ids, stamps, tombstone
    /// marks and blob refs; values only for a runtime device).
    fn list_verb(&self, request: &Value, access: &ReplicaAccess) -> Result<Value, String> {
        let collection = request
            .get("collection")
            .and_then(Value::as_str)
            .unwrap_or("");
        if !valid_name(collection) {
            return Err("fleet_replica_list: a collection is required".into());
        }
        if !access.allows(collection) {
            return Err(ReplicaError::Forbidden(collection.to_string()).to_string());
        }
        let since = request
            .get("sinceStamp")
            .and_then(Value::as_str)
            .unwrap_or("");
        let limit = request
            .get("limit")
            .and_then(Value::as_u64)
            .map(|limit| (limit as usize).clamp(1, MAX_LIST))
            .unwrap_or(MAX_LIST);
        let mut records: Vec<ReplicaRecord> = self
            .records(collection)
            .into_iter()
            .filter(|record| record.hlc.stamp().as_str() > since)
            .collect();
        records.sort_by(|a, b| a.hlc.cmp(&b.hlc));
        let more = records.len() > limit;
        records.truncate(limit);
        let with_values = access == &ReplicaAccess::Device;
        let rows: Vec<Value> = records
            .into_iter()
            .map(|record| {
                let mut row = json!({
                    "id": record.id,
                    "stamp": record.hlc.stamp(),
                    "deleted": record.value.is_none(),
                    "blobs": record.blobs,
                });
                if with_values {
                    row["value"] = record.value.unwrap_or(Value::Null);
                }
                row
            })
            .collect();
        Ok(json!({ "records": rows, "more": more }))
    }
}

// ---------------------------------------------------------------------------
// Exchange
// ---------------------------------------------------------------------------

/// Timers of the exchange.
#[derive(Debug, Clone)]
pub struct ReplicaSyncConfig {
    /// Digest comparison with every online peer.
    pub anti_entropy: Duration,
    /// Presence re-read (a peer that came online is exchanged with at once).
    pub presence_poll: Duration,
    /// How long one call to a peer may take.
    pub call_timeout: Duration,
}

impl Default for ReplicaSyncConfig {
    fn default() -> Self {
        Self {
            anti_entropy: Duration::from_secs(60),
            presence_poll: Duration::from_secs(10),
            call_timeout: Duration::from_secs(15),
        }
    }
}

fn unsupported(error: &FleetCallError) -> bool {
    let kind = error
        .data
        .as_ref()
        .and_then(|data| data.get("kind"))
        .and_then(Value::as_str);
    error.code == -32003
        || matches!(kind, Some("forbidden" | "unsupported"))
        || error.message.contains("unknown fleet owner verb")
        || error.message.contains("has no handler")
}

/// The exchange of one replica with the account's other runtime devices.
pub struct ReplicaSync {
    replica: Arc<AccountReplica>,
    peers: Arc<dyn FleetPeerTransport>,
    config: ReplicaSyncConfig,
    /// Peers that do not serve the replica (until they reconnect).
    unsupported: Mutex<BTreeSet<String>>,
    wake: Notify,
    task: Mutex<Option<JoinHandle<()>>>,
}

impl ReplicaSync {
    pub fn new(
        replica: Arc<AccountReplica>,
        peers: Arc<dyn FleetPeerTransport>,
        config: ReplicaSyncConfig,
    ) -> Arc<Self> {
        Arc::new(Self {
            replica,
            peers,
            config,
            unsupported: Mutex::new(BTreeSet::new()),
            wake: Notify::new(),
            task: Mutex::new(None),
        })
    }

    pub fn replica(&self) -> &Arc<AccountReplica> {
        &self.replica
    }

    /// Starts the exchange loop (needs a Tokio runtime).
    pub fn start(self: &Arc<Self>) {
        let this = Arc::clone(self);
        let task = tokio::spawn(async move { this.run().await });
        *self.task.lock().unwrap_or_else(|p| p.into_inner()) = Some(task);
    }

    /// Stops the exchange (the device network left); the replica keeps
    /// taking local writes, which wait as undelivered.
    pub fn shutdown(&self) {
        if let Some(task) = self.task.lock().unwrap_or_else(|p| p.into_inner()).take() {
            task.abort();
        }
        self.replica.update_status(|status| {
            status.peers_online = 0;
            status.exchanging = false;
        });
    }

    /// Exchange now (a peer came online, the network changed).
    pub fn wake(&self) {
        self.wake.notify_one();
    }

    /// The runtime peers that serve the replica: the online ones and how
    /// many there are in all.
    async fn online_peers(&self) -> (Vec<String>, usize) {
        let presence = self.peers.presence().await;
        let unsupported = self
            .unsupported
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .clone();
        // Every runtime device of the account counts, offline ones too (an
        // offline device's route is unknown); only a reachable one is online.
        let runtime: Vec<_> = presence
            .into_iter()
            .filter(|peer| {
                peer.unsupported.is_none()
                    && !matches!(peer.host_kind, FleetHostKind::Cloud)
                    && !peer.device_id.starts_with("cloud-")
                    && peer.device_id != self.replica.device_id
            })
            .collect();
        let total = runtime
            .iter()
            .filter(|peer| !unsupported.contains(&peer.device_id))
            .count();
        let online = runtime
            .into_iter()
            .filter(|peer| peer.online && peer.mesh && !unsupported.contains(&peer.device_id))
            .map(|peer| peer.device_id)
            .collect();
        (online, total)
    }

    async fn call(
        &self,
        device_id: &str,
        command: &str,
        request: Value,
    ) -> Result<Value, FleetCallError> {
        match tokio::time::timeout(
            self.config.call_timeout,
            self.peers
                .call(device_id, command, json!({ "request": request })),
        )
        .await
        {
            Ok(Err(error)) if unsupported(&error) => {
                log::info!("Account replica: peer does not serve it: device={device_id}");
                self.unsupported
                    .lock()
                    .unwrap_or_else(|p| p.into_inner())
                    .insert(device_id.to_string());
                Err(error)
            }
            Ok(result) => result,
            Err(_) => Err(FleetCallError::transport(format!("{command} timed out"))),
        }
    }

    /// Sends the undelivered local writes to every online peer.
    pub async fn push_local(&self, peers: &[String]) -> bool {
        let records = self.replica.undelivered();
        if records.is_empty() {
            return true;
        }
        let mut delivered = false;
        for device_id in peers {
            match self
                .call(
                    device_id,
                    "fleet_replica_push",
                    json!({ "records": records }),
                )
                .await
            {
                Ok(_) => delivered = true,
                Err(error) => log::debug!(
                    "Account replica push failed: device={device_id}, error={}",
                    error.message
                ),
            }
        }
        if delivered {
            self.replica.delivered(&records);
        }
        delivered
    }

    /// Compares digests with one peer and makes both sides equal.
    pub async fn exchange(&self, device_id: &str) -> Result<(), FleetCallError> {
        let theirs = self
            .call(device_id, "fleet_replica_digest", json!({}))
            .await?;
        if theirs.get("digest").and_then(Value::as_str) == Some(self.replica.digest().as_str()) {
            self.replica.delivered(&self.replica.undelivered());
            return Ok(());
        }
        let pulled = self
            .call(device_id, "fleet_replica_pull", json!({}))
            .await?;
        let records: Vec<ReplicaRecord> = pulled
            .get("records")
            .cloned()
            .map(serde_json::from_value)
            .transpose()
            .map_err(|error| FleetCallError::command(format!("invalid replica: {error}")))?
            .unwrap_or_default();
        let changed = self.replica.merge(records);
        if !changed.is_empty() {
            log::info!(
                "Account replica merged from a peer: device={device_id}, records={}",
                changed.len()
            );
        }
        // What the peer still lacks goes back to it.
        let ours = self.replica.snapshot();
        let answer = self
            .call(device_id, "fleet_replica_push", json!({ "records": ours }))
            .await?;
        if answer.get("digest").and_then(Value::as_str) == Some(self.replica.digest().as_str()) {
            self.replica.delivered(&self.replica.undelivered());
        }
        Ok(())
    }

    /// A blob, from this device or the first online peer that has it (its
    /// holders first); kept in the cache (`pin`: as a durable holder).
    pub async fn fetch_blob(&self, hash: &str, pin: bool) -> Option<Vec<u8>> {
        if let Some(bytes) = self.replica.blob(hash) {
            if pin && !self.replica.is_pinned(hash) {
                let _ = self.replica.put_blob(&bytes, true);
            }
            return Some(bytes);
        }
        let (online, _) = self.online_peers().await;
        let holders = self.replica.holders(hash);
        let mut order: Vec<&String> = online
            .iter()
            .filter(|peer| holders.contains(peer))
            .collect();
        order.extend(online.iter().filter(|peer| !holders.contains(peer)));
        for device_id in order {
            let Ok(answer) = self
                .call(device_id, "fleet_blob_get", json!({ "hash": hash }))
                .await
            else {
                continue;
            };
            use base64::Engine;
            let Some(bytes) = answer
                .get("data")
                .and_then(Value::as_str)
                .and_then(|data| base64::engine::general_purpose::STANDARD.decode(data).ok())
            else {
                continue;
            };
            if self.replica.put_blob_checked(hash, &bytes, pin).is_ok() {
                return Some(bytes);
            }
        }
        None
    }

    /// Pins the durable blobs that have too few holders: a device that sees
    /// a blob held by fewer than `min(k, runtime devices)` devices, and does
    /// not hold it yet, fetches and pins it. Returns how many it pinned.
    pub async fn maintain_blobs(&self, runtime_devices: usize) -> usize {
        let mut pinned = 0;
        for (blob, needed) in self.replica.durable_blobs() {
            let needed = needed.min(runtime_devices.max(1));
            let holders = self.replica.holders(&blob.hash);
            if holders.len() >= needed || holders.contains(&self.replica.device_id) {
                continue;
            }
            if self.fetch_blob(&blob.hash, true).await.is_some() {
                pinned += 1;
            } else {
                log::debug!(
                    "Account replica blob not reachable to pin: hash={}",
                    blob.hash
                );
            }
        }
        self.replica.trim_cache();
        pinned
    }

    /// One pass: push local writes, make every online peer equal, then keep
    /// the durable blobs held.
    pub async fn pass(&self) {
        let (online, total) = self.online_peers().await;
        self.replica.update_status(|status| {
            status.peers = total;
            status.peers_online = online.len();
            status.exchanging = !online.is_empty();
        });
        self.push_local(&online).await;
        for device_id in &online {
            if let Err(error) = self.exchange(device_id).await {
                log::debug!(
                    "Account replica exchange failed: device={device_id}, error={}",
                    error.message
                );
            }
        }
        // This device and every other runtime device that serves the replica.
        self.maintain_blobs(total + 1).await;
        // Peers found not to serve the replica no longer count.
        let (online, total) = self.online_peers().await;
        self.replica.update_status(|status| {
            status.exchanging = false;
            status.peers = total;
            status.peers_online = online.len();
        });
    }

    async fn run(self: Arc<Self>) {
        let local = Arc::clone(&self.replica.local);
        let mut known_online: BTreeSet<String> = BTreeSet::new();
        let mut last_full = tokio::time::Instant::now();
        // A new device pulls from the first peer it reaches.
        self.pass().await;
        loop {
            tokio::select! {
                _ = local.notified() => {
                    let (online, total) = self.online_peers().await;
                    self.replica.update_status(|status| {
                        status.peers = total;
                        status.peers_online = online.len();
                    });
                    self.push_local(&online).await;
                    continue;
                }
                _ = self.wake.notified() => {}
                _ = tokio::time::sleep(self.config.presence_poll) => {}
            }
            let (online, _) = self.online_peers().await;
            let online: BTreeSet<String> = online.into_iter().collect();
            let newcomer = online.difference(&known_online).next().is_some();
            // A peer that left and came back may have been updated.
            {
                let mut unsupported = self.unsupported.lock().unwrap_or_else(|p| p.into_inner());
                unsupported.retain(|device| online.contains(device));
            }
            known_online = online;
            if newcomer
                || last_full.elapsed() >= self.config.anti_entropy
                || !self.replica.undelivered().is_empty()
            {
                last_full = tokio::time::Instant::now();
                self.replica.purge_tombstones();
                self.pass().await;
            }
        }
    }
}

impl Drop for ReplicaSync {
    fn drop(&mut self) {
        if let Some(task) = self.task.lock().unwrap_or_else(|p| p.into_inner()).take() {
            task.abort();
        }
    }
}

/// `<data>/fleet/replica-<account digest>.json` (its blobs beside it in
/// `replica-<account digest>.blobs/`): one replica per account on a device.
pub fn replica_path(data_dir: &Path, account_id: &str) -> PathBuf {
    let digest: String = Sha256::digest(account_id.as_bytes())[..12]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    data_dir
        .join("fleet")
        .join(format!("replica-{digest}.json"))
}

#[cfg(test)]
#[path = "replica_tests.rs"]
mod tests;

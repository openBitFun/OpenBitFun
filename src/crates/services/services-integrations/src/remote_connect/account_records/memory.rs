//! An in-process [`AccountRecordPort`]: the replica's record semantics
//! (hybrid-clock last writer wins, offers at the lowest clock, tombstones,
//! the secret guard and the collection budgets) without a file or a device
//! network. Two ports exchange with [`MemoryRecordPort::exchange`], which is
//! what the fleet layer does over Link.

use std::collections::{BTreeMap, HashMap};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::Value;
use tokio::sync::watch;

use super::{
    collection_budget, find_secret, AccountBlobRef, AccountCollectionBudget, AccountRecord,
    AccountRecordError, AccountRecordPort, AccountReplicaState, BlobFuture,
};

/// The budget of a collection nobody declared (the replica's default).
const DEFAULT_BUDGET: AccountCollectionBudget = AccountCollectionBudget {
    name: "",
    max_records: 256,
    max_bytes: 256 * 1024,
    max_value_bytes: 32 * 1024,
    durable_holders: 0,
};

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

fn stamp(wall: u64, counter: u32, device: &str) -> String {
    format!("{wall:016x}-{counter:08x}-{device}")
}

#[derive(Default)]
struct Inner {
    records: BTreeMap<(String, String), AccountRecord>,
    blobs: HashMap<String, Vec<u8>>,
    wall: u64,
    counter: u32,
}

/// One device's in-process replica.
pub struct MemoryRecordPort {
    account_id: String,
    device_id: String,
    inner: Mutex<Inner>,
    peers: Mutex<Vec<Arc<MemoryRecordPort>>>,
    online: AtomicBool,
    changes: watch::Sender<u64>,
}

impl MemoryRecordPort {
    pub fn new(account_id: &str, device_id: &str) -> Arc<Self> {
        Arc::new(Self {
            account_id: account_id.to_string(),
            device_id: device_id.to_string(),
            inner: Mutex::new(Inner::default()),
            peers: Mutex::new(Vec::new()),
            online: AtomicBool::new(true),
            changes: watch::channel(0).0,
        })
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Lets this device fetch blobs from `peer` (both ways).
    pub fn link(a: &Arc<Self>, b: &Arc<Self>) {
        a.peers.lock().unwrap().push(Arc::clone(b));
        b.peers.lock().unwrap().push(Arc::clone(a));
    }

    pub fn set_online(&self, online: bool) {
        self.online.store(online, Ordering::SeqCst);
    }

    pub fn subscribe(&self) -> watch::Receiver<u64> {
        self.changes.subscribe()
    }

    /// The greater stamp wins on both sides; records with a secret or over
    /// the receiver's budget are refused like the real replica does.
    pub fn exchange(a: &Self, b: &Self) -> bool {
        if !a.online.load(Ordering::SeqCst) || !b.online.load(Ordering::SeqCst) {
            return false;
        }
        for (from, to) in [(a, b), (b, a)] {
            let incoming: Vec<_> = from
                .lock()
                .records
                .iter()
                .map(|(key, record)| (key.clone(), record.clone()))
                .collect();
            let mut changed = false;
            {
                let mut inner = to.lock();
                for (key, record) in incoming {
                    let collection = key.0.clone();
                    if inner
                        .records
                        .get(&key)
                        .is_some_and(|current| current.stamp >= record.stamp)
                    {
                        continue;
                    }
                    if record.value.as_ref().and_then(find_secret).is_some() {
                        continue;
                    }
                    if !fits(&inner, &collection, &record) {
                        continue;
                    }
                    if let Some(wall) = record
                        .stamp
                        .get(..16)
                        .and_then(|wall| u64::from_str_radix(wall, 16).ok())
                    {
                        inner.wall = inner.wall.max(wall);
                    }
                    inner.records.insert(key, record);
                    changed = true;
                }
            }
            if changed {
                to.changes.send_modify(|seq| *seq += 1);
            }
        }
        true
    }

    /// Every record of every collection (for assertions).
    pub fn all(&self) -> Vec<(String, AccountRecord)> {
        self.lock()
            .records
            .iter()
            .map(|((collection, _), record)| (collection.clone(), record.clone()))
            .collect()
    }

    /// Drops a blob (a device that lost content).
    pub fn forget_blob(&self, hash: &str) {
        self.lock().blobs.remove(hash);
    }
}

fn fits(inner: &Inner, collection: &str, record: &AccountRecord) -> bool {
    let budget = collection_budget(collection).unwrap_or(DEFAULT_BUDGET);
    let size = record
        .value
        .as_ref()
        .map(|value| {
            serde_json::to_vec(value)
                .map(|bytes| bytes.len())
                .unwrap_or(0)
        })
        .unwrap_or(0);
    if size > budget.max_value_bytes {
        return false;
    }
    let mut count = 0;
    let mut bytes = size;
    for ((name, id), existing) in &inner.records {
        if name == collection && *id != record.id {
            count += 1;
            bytes += existing
                .value
                .as_ref()
                .map(|value| serde_json::to_vec(value).map(|b| b.len()).unwrap_or(0))
                .unwrap_or(0);
        }
    }
    count < budget.max_records && bytes <= budget.max_bytes
}

impl AccountRecordPort for MemoryRecordPort {
    fn account_id(&self) -> String {
        self.account_id.clone()
    }

    fn device_id(&self) -> String {
        self.device_id.clone()
    }

    fn records(&self, collection: &str) -> Vec<AccountRecord> {
        self.lock()
            .records
            .iter()
            .filter(|((name, _), _)| name == collection)
            .map(|(_, record)| record.clone())
            .collect()
    }

    fn put(
        &self,
        collection: &str,
        id: &str,
        value: Value,
        blobs: &[AccountBlobRef],
        seed: bool,
    ) -> Result<Option<String>, AccountRecordError> {
        if let Some(path) = find_secret(&value) {
            return Err(AccountRecordError::Secret(path));
        }
        let mut inner = self.lock();
        let key = (collection.to_string(), id.to_string());
        let current = inner.records.get(&key).cloned();
        if current.as_ref().is_some_and(|current| {
            current.value.as_ref() == Some(&value)
                && current.blobs
                    == blobs
                        .iter()
                        .map(|blob| blob.hash.clone())
                        .collect::<Vec<_>>()
        }) {
            return Ok(None);
        }
        let new_stamp = if seed {
            let seconds = (now_ms() / 1000).min(u64::from(u32::MAX)) as u32;
            let offer = stamp(0, u32::MAX - seconds, &self.device_id);
            if current
                .as_ref()
                .is_some_and(|current| current.stamp >= offer)
            {
                return Ok(None);
            }
            offer
        } else {
            let wall = now_ms().max(inner.wall);
            if wall == inner.wall {
                inner.counter += 1;
            } else {
                inner.counter = 0;
            }
            inner.wall = wall;
            stamp(wall, inner.counter, &self.device_id)
        };
        let record = AccountRecord {
            id: id.to_string(),
            value: Some(value),
            stamp: new_stamp.clone(),
            blobs: blobs.iter().map(|blob| blob.hash.clone()).collect(),
        };
        if !fits(&inner, collection, &record) {
            return Err(AccountRecordError::Budget(collection.to_string()));
        }
        inner.records.insert(key, record);
        drop(inner);
        self.changes.send_modify(|seq| *seq += 1);
        Ok(Some(new_stamp))
    }

    fn delete(&self, collection: &str, id: &str) -> Result<Option<String>, AccountRecordError> {
        let mut inner = self.lock();
        let key = (collection.to_string(), id.to_string());
        if inner
            .records
            .get(&key)
            .is_none_or(|record| record.value.is_none())
        {
            return Ok(None);
        }
        let wall = now_ms().max(inner.wall);
        if wall == inner.wall {
            inner.counter += 1;
        } else {
            inner.counter = 0;
        }
        inner.wall = wall;
        let new_stamp = stamp(wall, inner.counter, &self.device_id);
        inner.records.insert(
            key,
            AccountRecord {
                id: id.to_string(),
                value: None,
                stamp: new_stamp.clone(),
                blobs: Vec::new(),
            },
        );
        drop(inner);
        self.changes.send_modify(|seq| *seq += 1);
        Ok(Some(new_stamp))
    }

    fn put_blob(&self, bytes: &[u8], _pin: bool) -> Result<String, AccountRecordError> {
        use sha2::Digest;
        if bytes.len() > super::MAX_CHUNK_BYTES {
            return Err(AccountRecordError::Budget("blob".into()));
        }
        let hash: String = sha2::Sha256::digest(bytes)
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect();
        self.lock().blobs.insert(hash.clone(), bytes.to_vec());
        Ok(hash)
    }

    fn fetch_blob<'a>(&'a self, hash: &'a str, _pin: bool) -> BlobFuture<'a> {
        Box::pin(async move {
            if let Some(bytes) = self.lock().blobs.get(hash).cloned() {
                return Some(bytes);
            }
            if !self.online.load(Ordering::SeqCst) {
                return None;
            }
            let peers = self.peers.lock().unwrap().clone();
            for peer in peers {
                if !peer.online.load(Ordering::SeqCst) {
                    continue;
                }
                let found = peer.lock().blobs.get(hash).cloned();
                if let Some(bytes) = found {
                    self.lock().blobs.insert(hash.to_string(), bytes.clone());
                    return Some(bytes);
                }
            }
            None
        })
    }

    fn has_blob(&self, hash: &str) -> bool {
        self.lock().blobs.contains_key(hash)
    }

    fn state(&self) -> AccountReplicaState {
        AccountReplicaState::default()
    }
}

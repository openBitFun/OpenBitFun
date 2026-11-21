//! The account replica as account-record bindings use it
//! (`product_domains::fleet::account_records::AccountRecordPort`): records,
//! offers, deletions and content blobs of the signed-in account's replica on
//! this device, with blobs fetched from the account's other devices through
//! the replica's exchange.

use std::sync::Arc;

use serde_json::Value;

use openbitfun_product_domains::fleet::account_records::{
    AccountBlobRef, AccountRecord, AccountRecordError, AccountRecordPort, AccountReplicaState,
    BlobFuture,
};

use super::replica::{AccountReplica, BlobRef, ReplicaError, ReplicaSync};

/// Finds the replica's current exchange (it moves with the device network).
pub type SyncLookup = Arc<dyn Fn() -> Option<Arc<ReplicaSync>> + Send + Sync>;

/// [`AccountRecordPort`] over one account's [`AccountReplica`].
pub struct ReplicaRecordPort {
    account_id: String,
    replica: Arc<AccountReplica>,
    sync: SyncLookup,
}

impl ReplicaRecordPort {
    /// Declares every account-record collection on `replica` and wraps it.
    pub fn new(
        account_id: impl Into<String>,
        replica: Arc<AccountReplica>,
        sync: SyncLookup,
    ) -> Self {
        replica.declare_account_collections();
        Self {
            account_id: account_id.into(),
            replica,
            sync,
        }
    }

    pub fn replica(&self) -> &Arc<AccountReplica> {
        &self.replica
    }
}

fn error(error: ReplicaError) -> AccountRecordError {
    match error {
        ReplicaError::SecretField(path) => AccountRecordError::Secret(path),
        ReplicaError::Full(_) | ReplicaError::ValueTooLarge(_) | ReplicaError::BlobTooLarge(_) => {
            AccountRecordError::Budget(error.to_string())
        }
        other => AccountRecordError::Other(other.to_string()),
    }
}

impl AccountRecordPort for ReplicaRecordPort {
    fn account_id(&self) -> String {
        self.account_id.clone()
    }

    fn device_id(&self) -> String {
        self.replica.device_id().to_string()
    }

    fn records(&self, collection: &str) -> Vec<AccountRecord> {
        self.replica
            .records(collection)
            .into_iter()
            .map(|record| AccountRecord {
                stamp: record.hlc.stamp(),
                id: record.id,
                value: record.value,
                blobs: record.blobs.into_iter().map(|blob| blob.hash).collect(),
            })
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
        let blobs: Vec<BlobRef> = blobs
            .iter()
            .map(|blob| BlobRef {
                hash: blob.hash.clone(),
                bytes: blob.bytes,
            })
            .collect();
        let written = if seed {
            self.replica.seed_with_blobs(collection, id, value, blobs)
        } else {
            self.replica.put_with_blobs(collection, id, value, blobs)
        };
        written
            .map(|record| record.map(|record| record.hlc.stamp()))
            .map_err(error)
    }

    fn delete(&self, collection: &str, id: &str) -> Result<Option<String>, AccountRecordError> {
        self.replica
            .delete(collection, id)
            .map(|record| record.map(|record| record.hlc.stamp()))
            .map_err(error)
    }

    fn put_blob(&self, bytes: &[u8], pin: bool) -> Result<String, AccountRecordError> {
        self.replica.put_blob(bytes, pin).map_err(error)
    }

    fn fetch_blob<'a>(&'a self, hash: &'a str, pin: bool) -> BlobFuture<'a> {
        Box::pin(async move {
            if let Some(bytes) = self.replica.blob(hash) {
                if pin && !self.replica.is_pinned(hash) {
                    let _ = self.replica.put_blob(&bytes, true);
                }
                return Some(bytes);
            }
            let sync = (self.sync)()?;
            if !Arc::ptr_eq(sync.replica(), &self.replica) {
                return None;
            }
            sync.fetch_blob(hash, pin).await
        })
    }

    fn has_blob(&self, hash: &str) -> bool {
        self.replica.has_blob(hash)
    }

    fn state(&self) -> AccountReplicaState {
        let status = self.replica.status();
        AccountReplicaState {
            peers: status.peers,
            peers_online: status.peers_online,
            undelivered: status.undelivered,
            exchanging: status.exchanging,
            last_exchange_ms: status.last_exchange_ms,
        }
    }
}

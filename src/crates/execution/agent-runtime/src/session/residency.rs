//! Admission and writer-lease lifetime for loaded sessions. The persistence
//! provider acquires the actual cross-process lock in its storage domain.
use super::keyed_lock::{KeyedAsyncLock, KeyedAsyncLockGuard};
use super::{storage::StorageClaim, Session};
use dashmap::{mapref::entry::Entry, DashMap};
use std::sync::Arc;
use tokio::sync::{OwnedSemaphorePermit, Semaphore, TryAcquireError};

/// Storage and cache effects at the durable unload boundary.
#[async_trait::async_trait]
pub trait SessionUnloadEffects: Sync {
    type Error;
    async fn save_before_unload(&self, id: &str, session: Session) -> Result<(), Self::Error>;
    fn clear_settlement(&self, id: &str);
    fn clear_stores(&self, id: &str);
}

pub struct SessionResidency<W> {
    sessions: Arc<DashMap<String, Session>>,
    mutations: KeyedAsyncLock,
    capacity: Arc<Semaphore>,
    residents: DashMap<String, OwnedSemaphorePermit>,
    writers: DashMap<String, W>,
}

impl<W> SessionResidency<W> {
    pub fn new(capacity: usize) -> Self {
        Self {
            sessions: Default::default(),
            mutations: KeyedAsyncLock::default(),
            capacity: Arc::new(Semaphore::new(capacity)),
            residents: DashMap::new(),
            writers: DashMap::new(),
        }
    }

    pub fn sessions(&self) -> &Arc<DashMap<String, Session>> {
        &self.sessions
    }

    /// Publish only after the provider's durable create succeeds. All runtime
    /// stores and leases become resident synchronously under the mutation lock.
    pub fn publish_new(
        &self,
        session: &Session,
        permit: OwnedSemaphorePermit,
        writer: Option<W>,
        claim: StorageClaim<'_>,
        initialize_stores: impl FnOnce(),
    ) -> Result<(), String> {
        let id = &session.session_id;
        match self.sessions.entry(id.clone()) {
            Entry::Vacant(entry) => {
                entry.insert(session.clone());
            }
            Entry::Occupied(_) => {
                claim.commit();
                return Err(format!("Session ID already exists: {id}"));
            }
        }
        initialize_stores();
        claim.commit();
        self.commit_reservation(id, permit);
        if let Some(writer) = writer {
            self.commit_writer(id, writer);
        }
        Ok(())
    }

    /// The caller has reconstructed the history and persisted any migrations.
    pub fn publish_restored(
        &self,
        id: &str,
        session: &Session,
        permit: Option<OwnedSemaphorePermit>,
    ) {
        self.sessions.insert(id.to_owned(), session.clone());
        if let Some(permit) = permit {
            self.commit_reservation(id, permit);
        }
    }

    /// Serialize with admission and hold the durable writer through the final
    /// save and all cache cleanup. A failed or cancelled save leaves it resident.
    pub async fn unload<P: SessionUnloadEffects>(
        &self,
        id: &str,
        effects: &P,
    ) -> Result<bool, P::Error> {
        let _mutation = self.lock_mutation(id).await;
        let Some(session) = self.sessions.get(id).map(|entry| entry.clone()) else {
            return Ok(false);
        };
        effects.save_before_unload(id, session).await?;
        if self.sessions.remove(id).is_none() {
            return Ok(false);
        }
        effects.clear_settlement(id);
        self.release_reservation(id);
        effects.clear_stores(id);
        self.release_writer(id);
        Ok(true)
    }

    pub async fn lock_mutation(&self, session_id: &str) -> KeyedAsyncLockGuard {
        self.mutations.lock(session_id).await
    }

    pub fn reserve(&self) -> Result<OwnedSemaphorePermit, TryAcquireError> {
        self.capacity.clone().try_acquire_owned()
    }

    fn commit_reservation(&self, session_id: &str, permit: OwnedSemaphorePermit) {
        let previous = self.residents.insert(session_id.to_owned(), permit);
        debug_assert!(previous.is_none(), "active session permit already existed");
    }

    pub fn release_reservation(&self, session_id: &str) {
        self.residents.remove(session_id);
    }

    pub fn commit_writer(&self, session_id: &str, writer: W) {
        match self.writers.entry(session_id.to_owned()) {
            Entry::Vacant(entry) => {
                entry.insert(writer);
            }
            Entry::Occupied(_) => debug_assert!(false, "Session write lock already existed"),
        }
    }

    pub fn has_writer(&self, session_id: &str) -> bool {
        self.writers.contains_key(session_id)
    }

    pub fn release_writer(&self, session_id: &str) {
        self.writers.remove(session_id);
    }

    pub fn resident_count(&self) -> usize {
        self.residents.len()
    }
}

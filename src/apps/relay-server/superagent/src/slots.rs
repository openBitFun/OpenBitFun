//! Account slots: one account's state, loaded on demand and unloaded when
//! idle, within fixed memory bounds.
//!
//! A slot holds the account's metadata (its cloud node key and directory
//! credential), the job ledger, the resident conversations (their last
//! turns) and the last runtime index projection. Everything is persisted
//! through the encrypted [`AccountStore`] after every change, so unloading
//! loses nothing; a reload reads it back.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;

use openbitfun_obp::EventHub;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::{Mutex, Semaphore};

use crate::conversation::{Conversation, ConversationSummary, History};
use crate::ledger::Ledger;
use crate::store::{AccountStore, Store, StoreError};

/// Bounds of one process.
#[derive(Debug, Clone)]
pub struct SlotLimits {
    /// Resident slots (least recently used idle slots are unloaded first).
    pub max_resident: usize,
    /// Estimated bytes of one slot's resident state.
    pub max_slot_bytes: usize,
    /// The runtime index projection kept per slot.
    pub max_index_bytes: usize,
    /// A slot without activity, frontends and drivers for this long unloads.
    pub idle_unload_ms: u64,
    /// Concurrent model rounds per account.
    pub model_rounds_per_account: usize,
    /// Events kept per slot for frontends to resume.
    pub event_ring: usize,
}

impl Default for SlotLimits {
    fn default() -> Self {
        Self {
            max_resident: 512,
            max_slot_bytes: 4 * 1024 * 1024,
            max_index_bytes: 256 * 1024,
            idle_unload_ms: 10 * 60 * 1000,
            model_rounds_per_account: 2,
            event_ring: 1024,
        }
    }
}

/// What the cloud node knows about its account (sealed record `meta`).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AccountMeta {
    pub version: u32,
    pub account_id: String,
    /// `cloud-<hash>`.
    pub device_id: String,
    /// The node's X25519 directory secret (base64).
    pub device_secret: String,
    /// The directory credential of the node's own row.
    pub directory_token: Option<String>,
    /// On by default; `superagent_disable` turns it off.
    pub enabled: bool,
    pub created_ms: u64,
    pub updated_ms: u64,
    /// A device the user pinned for model rounds.
    pub pinned_holder: Option<String>,
}

#[derive(Debug, Default)]
pub struct SlotState {
    pub meta: AccountMeta,
    pub ledger: Ledger,
    pub conversations: BTreeMap<String, Conversation>,
    pub summaries: Vec<ConversationSummary>,
    /// The last `fleet_list_runtimes` projection (bounded).
    pub index: Option<Value>,
}

pub struct Slot {
    pub account_id: String,
    /// Names this load of the slot: event `seq`s resume only within it.
    pub instance_id: String,
    pub store: AccountStore,
    pub state: Mutex<SlotState>,
    pub events: Arc<EventHub>,
    /// The fleet digest revision of this load (bumped on every change).
    pub digest_revision: AtomicU64,
    pub model_permits: Arc<Semaphore>,
    last_used_ms: AtomicU64,
    attached: AtomicUsize,
    drivers: std::sync::Mutex<BTreeSet<String>>,
    resident_bytes: AtomicUsize,
    limits: SlotLimits,
    /// Serializes read-modify-write of the `devices` record.
    device_facts_lock: Mutex<()>,
}

pub const META_RECORD: &str = "meta";
pub const LEDGER_RECORD: &str = "ledger";
pub const CONVERSATIONS_RECORD: &str = "conversations";
pub const INDEX_RECORD: &str = "index";
/// The last known facts of the account's devices (`device id -> snapshot`).
pub const DEVICES_RECORD: &str = "devices";

pub fn conversation_record(id: &str) -> String {
    format!("conv-{}", crate::crypto::hex(&sha(id)[..12]))
}

pub fn history_record(id: &str) -> String {
    format!("hist-{}", crate::crypto::hex(&sha(id)[..12]))
}

fn sha(value: &str) -> [u8; 32] {
    use sha2::{Digest, Sha256};
    Sha256::digest(value.as_bytes()).into()
}

impl Slot {
    pub fn touch(&self, now: u64) {
        self.last_used_ms.store(now, Ordering::Relaxed);
    }

    pub fn last_used_ms(&self) -> u64 {
        self.last_used_ms.load(Ordering::Relaxed)
    }

    /// A frontend attached (the slot stays loaded until it detaches).
    pub fn attach(self: &Arc<Self>) -> AttachGuard {
        self.attached.fetch_add(1, Ordering::AcqRel);
        AttachGuard(Arc::clone(self))
    }

    pub fn attached(&self) -> usize {
        self.attached.load(Ordering::Acquire)
    }

    /// Claims the driver of one conversation; `false` when one runs already.
    pub fn claim_driver(&self, conversation_id: &str) -> bool {
        self.drivers
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .insert(conversation_id.to_string())
    }

    pub fn release_driver(&self, conversation_id: &str) {
        self.drivers
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .remove(conversation_id);
    }

    pub fn drivers(&self) -> usize {
        self.drivers.lock().unwrap_or_else(|p| p.into_inner()).len()
    }

    pub fn resident_bytes(&self) -> usize {
        self.resident_bytes.load(Ordering::Relaxed)
    }

    pub fn save_meta(&self, state: &SlotState) -> Result<(), StoreError> {
        self.store.write_json(META_RECORD, &state.meta).map(|_| ())
    }

    pub fn save_ledger(&self, state: &mut SlotState) -> Result<(), StoreError> {
        state.ledger.prune();
        self.store.write_json(LEDGER_RECORD, &state.ledger)?;
        self.enforce_bounds(state);
        Ok(())
    }

    /// Persists one conversation (moving turns that left the window to its
    /// history record) and the conversation list.
    pub fn save_conversation(&self, state: &mut SlotState, id: &str) -> Result<(), StoreError> {
        let Some(conversation) = state.conversations.get_mut(id) else {
            return Ok(());
        };
        let older = conversation.take_overflow();
        if !older.is_empty() {
            let name = history_record(id);
            let mut history: History = self.store.read_json(&name)?.unwrap_or_default();
            history.append(older);
            self.store.write_json(&name, &history)?;
        }
        self.store
            .write_json(&conversation_record(id), &*conversation)?;
        let summary = ConversationSummary {
            id: conversation.id.clone(),
            title: conversation.title.clone(),
            updated_ms: conversation.updated_ms,
            status: match conversation.turn.as_ref().map(|turn| &turn.step) {
                Some(crate::conversation::Step::ModelRound | crate::conversation::Step::Tools) => {
                    "running".to_string()
                }
                Some(crate::conversation::Step::Parked { .. }) => "parked".to_string(),
                Some(crate::conversation::Step::Failed { .. }) => "failed".to_string(),
                _ => "idle".to_string(),
            },
            seen_ms: 0,
        };
        let mut summary = summary;
        summary.seen_ms = state
            .summaries
            .iter()
            .find(|entry| entry.id == summary.id)
            .map(|entry| entry.seen_ms)
            .unwrap_or(0);
        state.summaries.retain(|entry| entry.id != summary.id);
        state.summaries.insert(0, summary);
        state
            .summaries
            .sort_by(|a, b| b.updated_ms.cmp(&a.updated_ms));
        self.store
            .write_json(CONVERSATIONS_RECORD, &state.summaries)?;
        self.enforce_bounds(state);
        Ok(())
    }

    /// Records that a frontend opened the conversation now.
    pub fn mark_seen(&self, state: &mut SlotState, id: &str, now: u64) -> Result<(), StoreError> {
        if let Some(entry) = state.summaries.iter_mut().find(|entry| entry.id == id) {
            entry.seen_ms = now;
            self.store
                .write_json(CONVERSATIONS_RECORD, &state.summaries)?;
        }
        Ok(())
    }

    pub fn rename_conversation(
        &self,
        state: &mut SlotState,
        id: &str,
        title: &str,
    ) -> Result<bool, StoreError> {
        let Some(conversation) = self.conversation(state, id)? else {
            return Ok(false);
        };
        conversation.title = title.to_string();
        self.save_conversation(state, id)?;
        Ok(true)
    }

    /// Removes a conversation and its history. Its jobs stay in the ledger
    /// and keep running on their devices.
    pub fn delete_conversation(&self, state: &mut SlotState, id: &str) -> Result<bool, StoreError> {
        let known = state.summaries.iter().any(|entry| entry.id == id)
            || state.conversations.contains_key(id);
        state.conversations.remove(id);
        state.summaries.retain(|entry| entry.id != id);
        self.store.delete(&conversation_record(id))?;
        self.store.delete(&history_record(id))?;
        self.store
            .write_json(CONVERSATIONS_RECORD, &state.summaries)?;
        self.enforce_bounds(state);
        Ok(known)
    }

    pub fn save_index(&self, state: &mut SlotState, index: Value) -> Result<(), StoreError> {
        let bytes = serde_json::to_vec(&index)
            .map(|v| v.len())
            .unwrap_or(usize::MAX);
        let index = if bytes > self.limits.max_index_bytes {
            serde_json::json!({ "truncated": true, "bytes": bytes })
        } else {
            index
        };
        self.store.write_json(INDEX_RECORD, &index)?;
        state.index = Some(index);
        self.enforce_bounds(state);
        Ok(())
    }

    /// The account's devices as last seen online, so an offline device keeps
    /// its capabilities across a restart. Tolerant: an unreadable record or
    /// entry is skipped (and kept on disk), never an error.
    pub fn device_facts(&self) -> BTreeMap<String, crate::device::DeviceSnapshot> {
        let raw: BTreeMap<String, Value> = match self.store.read_json(DEVICES_RECORD) {
            Ok(Some(raw)) => raw,
            Ok(None) => return BTreeMap::new(),
            Err(error) => {
                log::warn!("Superagent device facts not read: {}", error);
                return BTreeMap::new();
            }
        };
        raw.into_iter()
            .filter_map(|(device_id, value)| {
                serde_json::from_value::<crate::device::DeviceSnapshot>(value)
                    .ok()
                    .map(|snapshot| (device_id, snapshot))
            })
            .collect()
    }

    /// Records one device's facts as last seen online (held as offline, with
    /// no latency). Entries this build cannot read are kept as they are.
    pub async fn save_device_facts(
        &self,
        snapshot: &crate::device::DeviceSnapshot,
    ) -> Result<(), StoreError> {
        let device_id = snapshot.facts.device_id.clone();
        if device_id.is_empty() {
            return Ok(());
        }
        let mut held = snapshot.clone();
        held.facts.online = false;
        held.facts.latency_ms = None;
        let _guard = self.device_facts_lock.lock().await;
        let mut raw: BTreeMap<String, Value> = match self.store.read_json(DEVICES_RECORD) {
            Ok(raw) => raw.unwrap_or_default(),
            // Never overwrite a record this build cannot read.
            Err(error) => return Err(error),
        };
        let value = serde_json::to_value(&held).map_err(|e| StoreError::Io(e.to_string()))?;
        if raw.get(&device_id) == Some(&value) {
            return Ok(());
        }
        raw.insert(device_id, value);
        self.store.write_json(DEVICES_RECORD, &raw).map(|_| ())
    }

    /// A conversation, loading it from the store when it is not resident.
    pub fn conversation<'a>(
        &self,
        state: &'a mut SlotState,
        id: &str,
    ) -> Result<Option<&'a mut Conversation>, StoreError> {
        if !state.conversations.contains_key(id) {
            match self
                .store
                .read_json::<Conversation>(&conversation_record(id))?
            {
                Some(conversation) => {
                    state.conversations.insert(id.to_string(), conversation);
                }
                None => return Ok(None),
            }
            self.enforce_bounds(state);
        }
        Ok(state.conversations.get_mut(id))
    }

    pub fn history(&self, id: &str) -> Result<History, StoreError> {
        Ok(self
            .store
            .read_json(&history_record(id))?
            .unwrap_or_default())
    }

    /// Keeps the resident state within `max_slot_bytes`: conversations
    /// without a running turn leave memory first (they reload on demand).
    pub fn enforce_bounds(&self, state: &mut SlotState) {
        let mut total = estimate(state);
        if total > self.limits.max_slot_bytes {
            let mut idle: Vec<(u64, String)> = state
                .conversations
                .values()
                .filter(|conversation| conversation.active_turn().is_none())
                .map(|conversation| (conversation.updated_ms, conversation.id.clone()))
                .collect();
            idle.sort();
            for (_, id) in idle {
                if total <= self.limits.max_slot_bytes {
                    break;
                }
                state.conversations.remove(&id);
                total = estimate(state);
            }
        }
        if total > self.limits.max_slot_bytes {
            log::warn!(
                "Superagent slot over its bound with running turns: bytes={}, limit={}",
                total,
                self.limits.max_slot_bytes
            );
        }
        self.resident_bytes.store(total, Ordering::Relaxed);
    }
}

pub struct AttachGuard(Arc<Slot>);

impl Drop for AttachGuard {
    fn drop(&mut self) {
        self.0.attached.fetch_sub(1, Ordering::AcqRel);
    }
}

fn json_len<T: Serialize>(value: &T) -> usize {
    serde_json::to_vec(value).map(|v| v.len()).unwrap_or(0)
}

/// Estimated resident bytes of a slot (serialized size, a good proxy for
/// the heap the parsed values hold).
pub fn estimate(state: &SlotState) -> usize {
    json_len(&state.meta)
        + json_len(&state.ledger)
        + state.conversations.values().map(json_len).sum::<usize>()
        + json_len(&state.summaries)
        + state.index.as_ref().map(json_len).unwrap_or(0)
}

#[derive(Debug)]
pub enum SlotError {
    /// The account has no cloud agent data yet (or it was deleted).
    NotProvisioned,
    Store(StoreError),
}

impl std::fmt::Display for SlotError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotProvisioned => {
                f.write_str("superagent_not_provisioned: this account has no cloud agent yet")
            }
            Self::Store(error) => write!(f, "superagent_store_unavailable: {error}"),
        }
    }
}

impl From<StoreError> for SlotError {
    fn from(error: StoreError) -> Self {
        Self::Store(error)
    }
}

/// Every resident slot of the process.
pub struct Slots {
    store: Arc<Store>,
    limits: SlotLimits,
    resident: std::sync::Mutex<HashMap<String, Arc<Slot>>>,
    loading: Mutex<()>,
}

impl Slots {
    pub fn new(store: Arc<Store>, limits: SlotLimits) -> Self {
        Self {
            store,
            limits,
            resident: std::sync::Mutex::new(HashMap::new()),
            loading: Mutex::new(()),
        }
    }

    pub fn store(&self) -> &Arc<Store> {
        &self.store
    }

    pub fn limits(&self) -> &SlotLimits {
        &self.limits
    }

    pub fn resident_count(&self) -> usize {
        self.resident
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .len()
    }

    pub fn resident(&self, account_id: &str) -> Option<Arc<Slot>> {
        self.resident
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .get(account_id)
            .cloned()
    }

    pub fn resident_accounts(&self) -> Vec<String> {
        self.resident
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .keys()
            .cloned()
            .collect()
    }

    /// The account's slot, loaded from the store when not resident.
    /// `create` provisions a new data key and `meta` when none exists.
    pub async fn load(
        &self,
        account_id: &str,
        now: u64,
        create: Option<AccountMeta>,
    ) -> Result<Arc<Slot>, SlotError> {
        if let Some(slot) = self.resident(account_id) {
            slot.touch(now);
            return Ok(slot);
        }
        let _loading = self.loading.lock().await;
        if let Some(slot) = self.resident(account_id) {
            slot.touch(now);
            return Ok(slot);
        }
        if !self.store.exists(account_id) && create.is_none() {
            return Err(SlotError::NotProvisioned);
        }
        let store = self.store.account(account_id, create.is_some())?;
        let meta = match store.read_json::<AccountMeta>(META_RECORD)? {
            Some(meta) => meta,
            None => match create {
                Some(meta) => {
                    store.write_json(META_RECORD, &meta)?;
                    meta
                }
                None => return Err(SlotError::NotProvisioned),
            },
        };
        let state = SlotState {
            meta,
            ledger: store.read_json(LEDGER_RECORD)?.unwrap_or_default(),
            conversations: BTreeMap::new(),
            summaries: store.read_json(CONVERSATIONS_RECORD)?.unwrap_or_default(),
            index: store.read_json(INDEX_RECORD)?,
        };
        let slot = Arc::new(Slot {
            account_id: account_id.to_string(),
            instance_id: uuid::Uuid::new_v4().simple().to_string(),
            store,
            state: Mutex::new(state),
            events: EventHub::new(self.limits.event_ring),
            digest_revision: AtomicU64::new(1),
            model_permits: Arc::new(Semaphore::new(self.limits.model_rounds_per_account.max(1))),
            last_used_ms: AtomicU64::new(now),
            attached: AtomicUsize::new(0),
            drivers: std::sync::Mutex::new(BTreeSet::new()),
            resident_bytes: AtomicUsize::new(0),
            limits: self.limits.clone(),
            device_facts_lock: Mutex::new(()),
        });
        {
            let mut state = slot.state.lock().await;
            // Conversations with an unfinished turn come back resident: the
            // runtime resumes them.
            let running: Vec<String> = state
                .summaries
                .iter()
                .filter(|summary| summary.status == "running" || summary.status == "parked")
                .map(|summary| summary.id.clone())
                .collect();
            for id in running {
                let _ = slot.conversation(&mut state, &id);
            }
            slot.enforce_bounds(&mut state);
        }
        self.evict_for_room(now);
        self.resident
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .insert(account_id.to_string(), Arc::clone(&slot));
        log::info!(
            "Superagent slot loaded: resident={}, bytes={}",
            self.resident_count(),
            slot.resident_bytes()
        );
        Ok(slot)
    }

    fn unloadable(slot: &Arc<Slot>) -> bool {
        // The map holds one reference; anyone else holding the slot is using it.
        slot.attached() == 0 && slot.drivers() == 0 && Arc::strong_count(slot) <= 1
    }

    fn evict_for_room(&self, _now: u64) {
        let mut resident = self.resident.lock().unwrap_or_else(|p| p.into_inner());
        while resident.len() >= self.limits.max_resident {
            let victim = resident
                .iter()
                .filter(|(_, slot)| Self::unloadable(slot))
                .min_by_key(|(_, slot)| slot.last_used_ms())
                .map(|(id, _)| id.clone());
            match victim {
                Some(id) => {
                    resident.remove(&id);
                }
                None => break,
            }
        }
    }

    /// Unloads slots idle for longer than the limit; returns how many.
    pub fn unload_idle(&self, now: u64) -> usize {
        let mut resident = self.resident.lock().unwrap_or_else(|p| p.into_inner());
        let before = resident.len();
        resident.retain(|_, slot| {
            !(Self::unloadable(slot)
                && now.saturating_sub(slot.last_used_ms()) >= self.limits.idle_unload_ms)
        });
        before - resident.len()
    }

    /// Drops a slot from memory (after its data was shredded).
    pub fn forget(&self, account_id: &str) {
        if let Some(slot) = self
            .resident
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .remove(account_id)
        {
            slot.events.close();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::device::DeviceSnapshot;
    use openbitfun_product_domains::superagent::RuntimeFacts;

    fn slots(root: &std::path::Path) -> Slots {
        Slots::new(
            Arc::new(Store::open(root, [7u8; 32]).unwrap()),
            SlotLimits::default(),
        )
    }

    fn meta() -> AccountMeta {
        AccountMeta {
            version: 1,
            account_id: "email-alice".into(),
            device_id: "cloud-1".into(),
            enabled: true,
            ..AccountMeta::default()
        }
    }

    fn seen_online(device_id: &str) -> DeviceSnapshot {
        DeviceSnapshot {
            facts: RuntimeFacts {
                device_id: device_id.into(),
                name: "Studio".into(),
                online: true,
                latency_ms: Some(12),
                host_capabilities: vec!["cloud_agent_scope_v1".into()],
                dispatch_capabilities: vec!["job_submitter_v1".into()],
                ..RuntimeFacts::default()
            },
            version: Some("2.0.0".into()),
            models: vec!["model-a".into()],
            workspaces: vec![serde_json::json!({ "workspaceId": "w1" })],
        }
    }

    #[tokio::test]
    async fn device_facts_survive_a_restart_held_as_offline() {
        let temp = tempfile::tempdir().unwrap();
        {
            let slots = slots(temp.path());
            let slot = slots.load("email-alice", 1, Some(meta())).await.unwrap();
            assert!(slot.device_facts().is_empty());
            slot.save_device_facts(&seen_online("desk-1"))
                .await
                .unwrap();
        }
        // A new process: nothing resident, the record is read back.
        let slots = slots(temp.path());
        let slot = slots.load("email-alice", 2, None).await.unwrap();
        let facts = slot.device_facts();
        let held = facts.get("desk-1").expect("persisted facts");
        assert!(!held.facts.online);
        assert_eq!(held.facts.latency_ms, None);
        assert_eq!(held.facts.host_capabilities, vec!["cloud_agent_scope_v1"]);
        assert_eq!(held.models, vec!["model-a"]);
        assert_eq!(held.version.as_deref(), Some("2.0.0"));
    }

    #[tokio::test]
    async fn device_facts_read_tolerates_older_and_unreadable_entries() {
        let temp = tempfile::tempdir().unwrap();
        let slots = slots(temp.path());
        let slot = slots.load("email-alice", 1, Some(meta())).await.unwrap();
        // An entry of an older shape (fewer fields), one this build cannot
        // read, and an unknown field.
        slot.store
            .write_json(
                DEVICES_RECORD,
                &serde_json::json!({
                    "old-1": { "facts": { "deviceId": "old-1", "hostCapabilities": ["cloud_agent_scope_v1"] } },
                    "bad-1": "not a snapshot",
                    "new-1": { "facts": { "deviceId": "new-1" }, "futureField": 1 },
                }),
            )
            .unwrap();
        let facts = slot.device_facts();
        assert_eq!(
            facts.keys().cloned().collect::<Vec<_>>(),
            vec!["new-1".to_string(), "old-1".to_string()]
        );
        assert!(facts["old-1"].facts.accept_dispatch);
        // A save keeps the entry it cannot read.
        slot.save_device_facts(&seen_online("desk-1"))
            .await
            .unwrap();
        let raw: BTreeMap<String, Value> = slot.store.read_json(DEVICES_RECORD).unwrap().unwrap();
        assert_eq!(raw["bad-1"], Value::String("not a snapshot".into()));
        assert!(raw.contains_key("desk-1"));
        // An unparseable record is never overwritten.
        slot.store.write(DEVICES_RECORD, b"{not json").unwrap();
        assert!(slot.device_facts().is_empty());
        assert!(slot
            .save_device_facts(&seen_online("desk-2"))
            .await
            .is_err());
        assert_eq!(
            slot.store.read(DEVICES_RECORD).unwrap().as_deref(),
            Some(&b"{not json"[..])
        );
    }
}

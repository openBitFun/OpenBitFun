//! Conversation history goes to the account's devices; this node keeps only
//! working state with a time to live (A2/A3 of the server-state audit).
//!
//! The node is a **write-only peer** of the account replica: it seals every
//! finished turn into immutable, content-addressed chunks
//! ([`ArchiveChunk`], at most [`MAX_CHUNK_BYTES`]) and keeps them, with the
//! conversation's record ([`ArchiveRecord`], collection
//! [`ARCHIVE_COLLECTION`]), in the account's **outbox** until runtime
//! devices that advertise `superagent_archive_v1` hold them. It pushes with
//! `fleet_replica_push` under its own clock and drops a chunk once the
//! answers report enough holders (two, or one while only one device is
//! online); it never keeps a full copy and never reads record values.
//!
//! - The outbox ([`OUTBOX_RECORD`]) is bounded: [`OUTBOX_MAX_BYTES`] of
//!   chunks and [`OUTBOX_TTL_MS`]. Past either the oldest chunks go, and
//!   their conversation counts them in `unsaved`: the conversation then
//!   says plainly that those messages were not saved.
//! - The working set (the conversation list this node persists) is at most
//!   [`MAX_WORKING_CONVERSATIONS`] conversations and
//!   [`MAX_WORKING_BYTES`]; a conversation leaves it after
//!   [`IDLE_EVICT_MS`] idle, or earlier past a bound (least recently used
//!   first, never one with a running turn or unsealed history).
//! - A conversation that left the working set is **resumed** from any online
//!   device: the newest chunk carries the record, and the last
//!   [`WINDOW_TURNS`] turns are rebuilt from the chunks.
//! - Legacy `conv-*` / `hist-*` records drain to the devices on first
//!   contact (sealed only while the outbox has room, so nothing legacy is
//!   dropped); a `hist-*` record goes once its chunks are held.
//!
//! Frontends read archived history through their entry (desktop and CLI
//! read their own replica), which passes it along on
//! `superagent_list_conversations` (`archived`) and
//! `superagent_get_conversation` (`archive`); this node projects it with
//! its working set and stores none of it.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use openbitfun_product_domains::superagent::archive::{
    ArchiveChunk, ArchiveChunkRef, ArchiveRecord, ArchivedPage, ArchivedSummary,
    ARCHIVE_COLLECTION, ARCHIVE_DURABLE_HOLDERS, MAX_CHUNKS_PER_RECORD, MAX_CHUNK_BYTES,
    SUPERAGENT_ARCHIVE_CAPABILITY,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::conversation::{
    Conversation, ConversationSummary, History, Message, Role, WINDOW_TURNS,
};
use crate::device::DeviceSnapshot;
use crate::engine::Engine;
use crate::slots::{history_record, Slot, SlotState};
use crate::store::{AccountStore, StoreError};

/// The sealed outbox record of an account.
pub const OUTBOX_RECORD: &str = "outbox";
/// Chunk bytes the outbox holds at most.
pub const OUTBOX_MAX_BYTES: u64 = 4 * 1024 * 1024;
/// How long a chunk waits in the outbox for a device.
pub const OUTBOX_TTL_MS: u64 = 7 * 24 * 3600 * 1000;
/// Conversations in the working set at most.
pub const MAX_WORKING_CONVERSATIONS: usize = 32;
/// Bytes of the working set's conversation records at most.
pub const MAX_WORKING_BYTES: u64 = 4 * 1024 * 1024;
/// A conversation idle this long leaves the working set.
pub const IDLE_EVICT_MS: u64 = 14 * 24 * 3600 * 1000;
/// A last chunk smaller than this is merged with the next turn's messages
/// while the window still holds them (records stay short).
const SMALL_CHUNK_BYTES: u64 = 64 * 1024;
/// Chunk bytes one push carries at most.
const PUSH_BATCH_BYTES: u64 = 1024 * 1024;
/// How often an account with a pending outbox looks for a device.
const PUMP_INTERVAL_MS: u64 = 30 * 1000;
/// How often it looks again while no archive device is online.
const OFFLINE_PUMP_INTERVAL_MS: u64 = 5 * 60 * 1000;
/// A pending outbox older than this is shown as not yet stored.
const PENDING_NOTICE_MS: u64 = 2 * 60 * 1000;
/// Chunks a resume reads at most.
const MAX_RESUME_CHUNKS: usize = 16;
/// Holders tracked per pending chunk at most (pinning + cached markers).
const MAX_CHUNK_HOLDERS: usize = 64;

/// The archive state of one conversation (in its `conv-*` record).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ConversationArchive {
    /// Messages `[0, sealedSeq)` are in chunks (held by devices, pending in
    /// the outbox, or counted in `unsaved`/`dropped`).
    pub sealed_seq: u64,
    pub chunks: Vec<ArchiveChunkRef>,
    /// Messages dropped from the outbox before any device held them.
    pub unsaved: u64,
    /// Messages no longer kept (older than the oldest chunk).
    pub dropped: u64,
    /// The title and model pick the newest chunk carries.
    pub sealed_meta: String,
    /// The record value last queued (its digest).
    pub record_digest: String,
}

impl ConversationArchive {
    pub fn is_empty(&self) -> bool {
        self == &Self::default()
    }
}

/// A hybrid logical clock value, as the replica orders writes.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Hlc {
    pub wall_ms: u64,
    pub counter: u32,
    pub device_id: String,
}

/// A chunk waiting for holders.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct OutChunk {
    pub conversation_id: String,
    pub hash: String,
    pub from_seq: u64,
    pub to_seq: u64,
    pub bytes: u64,
    pub created_ms: u64,
    /// The chunk's JSON, base64.
    pub data: String,
    /// Devices that reported holding it.
    pub holders: Vec<String>,
}

/// A record write waiting for a device (`value: None`: a deletion).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct OutRecord {
    pub value: Option<ArchiveRecord>,
    pub hlc: Hlc,
    /// A device stored this write (it stays while its chunks are pending,
    /// so a device that lacks it gets it along with them).
    pub delivered: bool,
    pub created_ms: u64,
}

/// What the account still has to hand to its devices.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Outbox {
    pub version: u32,
    pub clock: Hlc,
    pub chunks: Vec<OutChunk>,
    pub records: BTreeMap<String, OutRecord>,
    /// The next time the watcher looks for a device (memory only).
    #[serde(skip)]
    pub next_pump_ms: u64,
    /// The next working-set and time-to-live pass (memory only).
    #[serde(skip)]
    pub next_sweep_ms: u64,
}

impl Outbox {
    pub fn is_empty(&self) -> bool {
        self.chunks.is_empty() && self.records.is_empty()
    }

    pub fn chunk_bytes(&self) -> u64 {
        self.chunks.iter().map(|chunk| chunk.bytes).sum()
    }

    fn tick(&mut self, now: u64, device_id: &str) -> Hlc {
        if now > self.clock.wall_ms {
            self.clock.wall_ms = now;
            self.clock.counter = 0;
        } else {
            self.clock.counter = self.clock.counter.saturating_add(1);
        }
        self.clock.device_id = device_id.to_string();
        self.clock.clone()
    }

    /// Whether anything of the conversation still waits for a device.
    pub fn pending_for(&self, id: &str) -> bool {
        self.records.contains_key(id) || self.chunks.iter().any(|c| c.conversation_id == id)
    }

    /// When the oldest pending item of the conversation was queued.
    pub fn oldest_pending_ms(&self, id: &str) -> Option<u64> {
        let chunk = self
            .chunks
            .iter()
            .filter(|c| c.conversation_id == id)
            .map(|c| c.created_ms)
            .min();
        let record = self
            .records
            .get(id)
            .filter(|r| !r.delivered)
            .map(|r| r.created_ms);
        match (chunk, record) {
            (Some(a), Some(b)) => Some(a.min(b)),
            (a, b) => a.or(b),
        }
    }

    pub fn chunk_data(&self, hash: &str) -> Option<Vec<u8>> {
        let chunk = self.chunks.iter().find(|c| c.hash == hash)?;
        BASE64.decode(&chunk.data).ok()
    }

    fn remove_chunk(&mut self, hash: &str) {
        self.chunks.retain(|c| c.hash != hash);
    }
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    crate::crypto::hex(&Sha256::digest(bytes))
}

fn json_len<T: Serialize>(value: &T) -> u64 {
    serde_json::to_vec(value)
        .map(|v| v.len() as u64)
        .unwrap_or(0)
}

/// Reads the outbox; an unreadable one is set aside (kept, never deleted).
pub fn load_outbox(store: &AccountStore) -> Outbox {
    match store.read_json::<Outbox>(OUTBOX_RECORD) {
        Ok(Some(mut outbox)) => {
            for chunk in &mut outbox.chunks {
                dedupe_holders(&mut chunk.holders);
            }
            outbox
        }
        Ok(None) => Outbox::default(),
        Err(error) => {
            log::error!("Superagent outbox unreadable, set aside: {}", error);
            let _ = store.quarantine(OUTBOX_RECORD);
            Outbox::default()
        }
    }
}

pub fn save_outbox(store: &AccountStore, outbox: &Outbox) -> Result<(), StoreError> {
    if outbox.is_empty() {
        return store.delete(OUTBOX_RECORD);
    }
    store.write_json(OUTBOX_RECORD, outbox).map(|_| ())
}

// ---------------------------------------------------------------------------
// Sealing
// ---------------------------------------------------------------------------

fn meta_of(conversation: &Conversation) -> String {
    sha256_hex(
        format!(
            "{}\n{}\n{}",
            conversation.title,
            conversation.pinned_holder.as_deref().unwrap_or(""),
            conversation.model_id.as_deref().unwrap_or("")
        )
        .as_bytes(),
    )
}

/// The title as a record carries it (a title that looks like a credential
/// is never written to the replica, which would refuse the record).
fn record_title(title: &str) -> String {
    if openbitfun_product_domains::fleet::account_records::looks_like_secret(title)
        || openbitfun_product_domains::fleet::account_records::text_contains_secret(title)
    {
        "Conversation".to_string()
    } else {
        title.to_string()
    }
}

/// The conversation's record value now.
pub fn record_of(conversation: &Conversation) -> ArchiveRecord {
    let archive = &conversation.archive;
    ArchiveRecord {
        title: record_title(&conversation.title),
        created_ms: conversation.created_ms,
        updated_ms: conversation.updated_ms,
        message_count: archive.sealed_seq,
        unsaved: archive.unsaved,
        dropped: archive.dropped,
        pinned_holder: conversation.pinned_holder.clone(),
        model_id: conversation.model_id.clone(),
        chunks: archive.chunks.clone(),
    }
}

/// Whether the conversation still has history only this node holds in its
/// legacy form (a `hist-*` record or turns older than the window that were
/// never sealed): it is sealed by [`drain_legacy`] while the outbox has
/// room, not on every save.
pub fn is_legacy(conversation: &Conversation, moved_out: usize) -> bool {
    conversation.archive.sealed_seq + (moved_out as u64) < conversation.history_count
}

/// The seq of the first message of the running turn (or the end).
fn sealable_end(conversation: &Conversation) -> u64 {
    let total = conversation.history_count + conversation.messages.len() as u64;
    let Some(turn) = conversation.active_turn() else {
        return total;
    };
    conversation
        .messages
        .iter()
        .position(|message| message.turn_id.as_deref() == Some(turn.id.as_str()))
        .map(|index| conversation.history_count + index as u64)
        .unwrap_or(total)
}

/// Seals the conversation's finished messages into chunks and queues its
/// record when it changed. `moved_out` are messages that just left the
/// window (seqs `[history_count - len, history_count)`); `history` the
/// legacy record, when draining. Returns whether the outbox changed.
pub fn seal(
    outbox: &mut Outbox,
    device_id: &str,
    conversation: &mut Conversation,
    moved_out: &[Message],
    history: Option<&History>,
    now: u64,
) -> bool {
    let moved_start = conversation.history_count - moved_out.len() as u64;
    let available_from = match history {
        Some(history) => history.dropped.min(moved_start),
        None => moved_start,
    };
    let message_at = |conversation: &Conversation, seq: u64| -> Option<Message> {
        message_from(conversation, moved_out, moved_start, history, seq)
    };
    let end = sealable_end(conversation).max(conversation.history_count);
    let mut from = conversation.archive.sealed_seq;
    let mut changed = false;
    // Messages nobody kept any more (an older build's history budget).
    if from < available_from && end > from {
        conversation.archive.dropped += available_from - from;
        from = available_from;
        conversation.archive.sealed_seq = from;
    }
    let meta = meta_of(conversation);
    let meta_changed = conversation.archive.sealed_meta != meta;
    // Merge a small last chunk (or reseal it for a new title or model) while
    // its messages are still here.
    if end > from || meta_changed {
        if let Some(last) = conversation.archive.chunks.last().cloned() {
            let rebuildable = last.to_seq == from
                && last.from_seq >= available_from
                && (last.from_seq..last.to_seq).all(|seq| message_at(conversation, seq).is_some());
            if rebuildable && (last.bytes < SMALL_CHUNK_BYTES || end == from) {
                conversation.archive.chunks.pop();
                outbox.remove_chunk(&last.hash);
                from = last.from_seq;
            }
        }
    }
    if end > from {
        let mut pending: Vec<Value> = Vec::new();
        let mut pending_bytes = 0u64;
        let mut start = from;
        for seq in from..end {
            let Some(message) = message_at(conversation, seq) else {
                break;
            };
            let value = serde_json::to_value(&message).unwrap_or(Value::Null);
            let size = json_len(&value) + 1;
            if !pending.is_empty() && pending_bytes + size > MAX_CHUNK_BYTES as u64 - 16 * 1024 {
                push_chunk(
                    outbox,
                    conversation,
                    start,
                    std::mem::take(&mut pending),
                    now,
                );
                start = seq;
                pending_bytes = 0;
            }
            pending.push(value);
            pending_bytes += size;
        }
        if !pending.is_empty() {
            push_chunk(outbox, conversation, start, pending, now);
        }
        changed = true;
    }
    conversation.archive.sealed_meta = meta;
    // Bound the record: the oldest chunks go (counted as no longer kept).
    while conversation.archive.chunks.len() > MAX_CHUNKS_PER_RECORD {
        let removed = conversation.archive.chunks.remove(0);
        conversation.archive.dropped += removed.to_seq - removed.from_seq;
        outbox.remove_chunk(&removed.hash);
    }
    changed | queue_record(outbox, device_id, conversation, now)
}

fn message_from(
    conversation: &Conversation,
    moved_out: &[Message],
    moved_start: u64,
    history: Option<&History>,
    seq: u64,
) -> Option<Message> {
    if seq >= conversation.history_count {
        conversation
            .messages
            .get((seq - conversation.history_count) as usize)
            .cloned()
    } else if seq >= moved_start {
        moved_out.get((seq - moved_start) as usize).cloned()
    } else {
        history.and_then(|history| {
            seq.checked_sub(history.dropped)
                .and_then(|index| history.messages.get(index as usize).cloned())
        })
    }
}

fn push_chunk(
    outbox: &mut Outbox,
    conversation: &mut Conversation,
    from: u64,
    messages: Vec<Value>,
    now: u64,
) {
    let to = from + messages.len() as u64;
    let mut record = record_of(conversation);
    record.message_count = from;
    let chunk = ArchiveChunk {
        v: 1,
        conversation_id: conversation.id.clone(),
        from_seq: from,
        to_seq: to,
        messages,
        record,
    };
    let bytes = serde_json::to_vec(&chunk).unwrap_or_default();
    let hash = sha256_hex(&bytes);
    let reference = ArchiveChunkRef {
        hash: hash.clone(),
        from_seq: from,
        to_seq: to,
        bytes: bytes.len() as u64,
    };
    conversation.archive.chunks.push(reference);
    conversation.archive.sealed_seq = to;
    if !outbox.chunks.iter().any(|c| c.hash == hash) {
        outbox.chunks.push(OutChunk {
            conversation_id: conversation.id.clone(),
            hash,
            from_seq: from,
            to_seq: to,
            bytes: bytes.len() as u64,
            created_ms: now,
            data: BASE64.encode(&bytes),
            holders: Vec::new(),
        });
    }
}

/// Queues the conversation's record when its value changed.
fn queue_record(
    outbox: &mut Outbox,
    device_id: &str,
    conversation: &mut Conversation,
    now: u64,
) -> bool {
    if conversation.archive.chunks.is_empty() && conversation.archive.sealed_seq == 0 {
        return false;
    }
    let value = record_of(conversation);
    let digest = sha256_hex(&serde_json::to_vec(&value).unwrap_or_default());
    if digest == conversation.archive.record_digest {
        return false;
    }
    conversation.archive.record_digest = digest;
    let hlc = outbox.tick(now, device_id);
    outbox.records.insert(
        conversation.id.clone(),
        OutRecord {
            value: Some(value),
            hlc,
            delivered: false,
            created_ms: now,
        },
    );
    true
}

/// Queues the deletion of a conversation's record (its pending chunks go).
pub fn queue_tombstone(outbox: &mut Outbox, device_id: &str, id: &str, now: u64) {
    outbox.chunks.retain(|chunk| chunk.conversation_id != id);
    let hlc = outbox.tick(now, device_id);
    outbox.records.insert(
        id.to_string(),
        OutRecord {
            value: None,
            hlc,
            delivered: false,
            created_ms: now,
        },
    );
}

/// Drops what the outbox may no longer hold (oldest first past
/// [`OUTBOX_MAX_BYTES`], anything older than [`OUTBOX_TTL_MS`]). Returns
/// the dropped chunks.
pub fn enforce_outbox(outbox: &mut Outbox, now: u64) -> Vec<OutChunk> {
    let mut dropped = Vec::new();
    outbox.chunks.sort_by_key(|chunk| chunk.created_ms);
    let mut bytes = outbox.chunk_bytes();
    while let Some(oldest) = outbox.chunks.first() {
        if bytes <= OUTBOX_MAX_BYTES && now.saturating_sub(oldest.created_ms) < OUTBOX_TTL_MS {
            break;
        }
        let chunk = outbox.chunks.remove(0);
        bytes = bytes.saturating_sub(chunk.bytes);
        dropped.push(chunk);
    }
    let pending: BTreeSet<String> = outbox
        .chunks
        .iter()
        .map(|chunk| chunk.conversation_id.clone())
        .collect();
    outbox.records.retain(|id, record| {
        pending.contains(id)
            || (!record.delivered && now.saturating_sub(record.created_ms) < OUTBOX_TTL_MS)
    });
    dropped
}

/// Applies dropped chunks to their conversations (`unsaved`), loudly.
pub fn account_dropped(slot: &Slot, state: &mut SlotState, dropped: Vec<OutChunk>, now: u64) {
    let mut touched = BTreeSet::new();
    for chunk in dropped {
        let count = chunk.to_seq - chunk.from_seq;
        log::warn!(
            "Superagent history not stored on any device, dropped: messages={}, bytes={}",
            count,
            chunk.bytes
        );
        if let Ok(Some(conversation)) = slot.conversation(state, &chunk.conversation_id) {
            conversation.archive.unsaved += count;
            conversation
                .archive
                .chunks
                .retain(|reference| reference.hash != chunk.hash);
            touched.insert(chunk.conversation_id.clone());
        } else if let Some(record) = state
            .outbox
            .records
            .get_mut(&chunk.conversation_id)
            .and_then(|record| record.value.as_mut())
        {
            record.unsaved += count;
            record
                .chunks
                .retain(|reference| reference.hash != chunk.hash);
        }
    }
    let device_id = state.meta.device_id.clone();
    for id in touched {
        let SlotState {
            conversations,
            outbox,
            ..
        } = state;
        if let Some(conversation) = conversations.get_mut(&id) {
            queue_record(outbox, &device_id, conversation, now);
            let _ = slot
                .store
                .write_json(&crate::slots::conversation_record(&id), &*conversation);
        }
    }
}

// ---------------------------------------------------------------------------
// Pushing
// ---------------------------------------------------------------------------

/// The online devices that keep Super Agent history.
pub fn archive_devices(devices: &[DeviceSnapshot]) -> Vec<String> {
    devices
        .iter()
        .filter(|device| {
            device.facts.online
                && device
                    .facts
                    .host_capabilities
                    .iter()
                    .any(|c| c == SUPERAGENT_ARCHIVE_CAPABILITY)
        })
        .map(|device| device.facts.device_id.clone())
        .collect()
}

fn wire_record(id: &str, record: &OutRecord) -> Value {
    let mut value = json!({
        "collection": ARCHIVE_COLLECTION,
        "id": id,
        "hlc": record.hlc,
        "blobs": record.value.as_ref().map(|value| value.chunks.iter().map(|chunk| json!({
            "hash": chunk.hash, "bytes": chunk.bytes,
        })).collect::<Vec<_>>()).unwrap_or_default(),
    });
    if let Some(record) = &record.value {
        value["value"] = serde_json::to_value(record).unwrap_or(Value::Null);
    }
    value
}

/// What one push carries to one device.
struct Batch {
    records: Vec<(String, Hlc)>,
    request: Value,
}

fn holder_matches(holder: &str, device_id: &str) -> bool {
    holder == device_id || holder.strip_prefix('~') == Some(device_id)
}

fn dedupe_holders(holders: &mut Vec<String>) {
    let mut pinned: BTreeSet<String> = BTreeSet::new();
    let mut out: Vec<String> = Vec::with_capacity(holders.len().min(MAX_CHUNK_HOLDERS));
    for holder in holders.iter() {
        let holder = holder.trim();
        if holder.is_empty() || holder.starts_with('~') {
            continue;
        }
        if pinned.insert(holder.to_string()) && out.len() < MAX_CHUNK_HOLDERS {
            out.push(holder.to_string());
        }
    }
    let mut cached: BTreeSet<String> = BTreeSet::new();
    for holder in holders.iter() {
        let Some(id) = holder.trim().strip_prefix('~') else {
            continue;
        };
        if id.is_empty() || pinned.contains(id) {
            continue;
        }
        if cached.insert(id.to_string()) && out.len() < MAX_CHUNK_HOLDERS {
            out.push(format!("~{id}"));
        }
    }
    *holders = out;
}

/// Records reported pinning holders and, when `device_id` did not pin, marks it
/// cached (`~{device_id}`) so it is not pushed again. Deduplicates, upgrades
/// cached markers on pin, and caps `chunk.holders` at [`MAX_CHUNK_HOLDERS`].
fn record_chunk_holders(chunk: &mut OutChunk, device_id: &str, reported: &[String]) -> bool {
    let before = chunk.holders.clone();
    dedupe_holders(&mut chunk.holders);
    for holder in reported {
        let holder = holder.trim();
        if holder.is_empty() || holder.starts_with('~') {
            continue;
        }
        chunk
            .holders
            .retain(|existing| existing.strip_prefix('~') != Some(holder));
        if chunk.holders.iter().any(|existing| existing == holder) {
            continue;
        }
        if chunk.holders.len() >= MAX_CHUNK_HOLDERS {
            if let Some(pos) = chunk.holders.iter().position(|h| h.starts_with('~')) {
                chunk.holders.remove(pos);
            } else {
                continue;
            }
        }
        chunk.holders.push(holder.to_string());
    }
    if !device_id.is_empty()
        && !chunk
            .holders
            .iter()
            .any(|holder| holder_matches(holder, device_id))
        && chunk.holders.len() < MAX_CHUNK_HOLDERS
    {
        // Pushed but not pinned there: do not push it again to it.
        chunk.holders.push(format!("~{device_id}"));
    }
    chunk.holders != before
}

fn record_delivered(row: &Value, pushed_hlc: &Hlc) -> bool {
    if row.get("stored").and_then(Value::as_bool) == Some(true) {
        return true;
    }
    if row.get("alreadyStored").and_then(Value::as_bool) == Some(true) {
        return true;
    }
    let marker = row
        .get("status")
        .or_else(|| row.get("reason"))
        .or_else(|| row.get("error"))
        .and_then(Value::as_str);
    if matches!(marker, Some("already_stored" | "older_hlc")) {
        return true;
    }
    if row.get("error").is_none() {
        if let Some(stamp) = row.get("stamp").and_then(Value::as_str) {
            let pushed_stamp = format!(
                "{:016x}-{:08x}-{}",
                pushed_hlc.wall_ms, pushed_hlc.counter, pushed_hlc.device_id
            );
            if stamp >= pushed_stamp.as_str() {
                return true;
            }
        }
    }
    false
}

fn blob_stored(row: &Value) -> bool {
    if row.get("stored").and_then(Value::as_bool) == Some(true) {
        return true;
    }
    if row.get("alreadyStored").and_then(Value::as_bool) == Some(true) {
        return true;
    }
    let marker = row
        .get("status")
        .or_else(|| row.get("reason"))
        .or_else(|| row.get("error"))
        .and_then(Value::as_str);
    matches!(marker, Some("already_stored"))
}

fn batch_for(outbox: &Outbox, device_id: &str) -> Option<Batch> {
    let mut bytes = 0u64;
    let mut chunks: Vec<&OutChunk> = Vec::new();
    for chunk in outbox.chunks.iter().filter(|chunk| {
        !chunk
            .holders
            .iter()
            .any(|holder| holder_matches(holder, device_id))
    }) {
        if !chunks.is_empty() && bytes + chunk.bytes > PUSH_BATCH_BYTES {
            break;
        }
        bytes += chunk.bytes;
        chunks.push(chunk);
    }
    let with_chunks: BTreeSet<&str> = chunks
        .iter()
        .map(|chunk| chunk.conversation_id.as_str())
        .collect();
    let records: Vec<(&String, &OutRecord)> = outbox
        .records
        .iter()
        .filter(|(id, record)| !record.delivered || with_chunks.contains(id.as_str()))
        .collect();
    if records.is_empty() && chunks.is_empty() {
        return None;
    }
    Some(Batch {
        records: records
            .iter()
            .map(|(id, record)| ((*id).clone(), record.hlc.clone()))
            .collect(),
        request: json!({
            "request": {
                "records": records.iter().map(|(id, record)| wire_record(id, record)).collect::<Vec<_>>(),
                "blobs": chunks.iter().map(|chunk| json!({ "hash": chunk.hash, "data": chunk.data })).collect::<Vec<_>>(),
            }
        }),
    })
}

/// What [`pump`] did.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct PumpReport {
    pub devices: usize,
    pub chunks_held: usize,
    pub records_stored: usize,
}

/// Hands the outbox to the account's online archive devices (and drains
/// legacy history while there is room). `force`: ignore the pump interval.
pub async fn pump(engine: &Engine, slot: &Arc<Slot>, force: bool) -> PumpReport {
    let now = engine.now();
    {
        let mut state = slot.state.lock().await;
        if !force && state.outbox.next_pump_ms > now {
            return PumpReport::default();
        }
        state.outbox.next_pump_ms = now + PUMP_INTERVAL_MS;
        let dropped = enforce_outbox(&mut state.outbox, now);
        if !dropped.is_empty() {
            account_dropped(slot, &mut state, dropped, now);
            let _ = save_outbox(&slot.store, &state.outbox);
        }
        if state.outbox.is_empty() && !has_legacy(&state) {
            return PumpReport::default();
        }
    }
    let devices = engine.devices(&slot.account_id).await;
    let online = archive_devices(&devices);
    let mut report = PumpReport {
        devices: online.len(),
        ..PumpReport::default()
    };
    if online.is_empty() {
        slot.state.lock().await.outbox.next_pump_ms = now + OFFLINE_PUMP_INTERVAL_MS;
        return report;
    }
    drain_legacy(slot, now).await;
    let required = ARCHIVE_DURABLE_HOLDERS.min(online.len()).max(1);
    for device_id in &online {
        // A few batches per device per pass.
        for _ in 0..8 {
            let batch = {
                let state = slot.state.lock().await;
                batch_for(&state.outbox, device_id)
            };
            let Some(batch) = batch else {
                break;
            };
            let answer = match engine
                .rpc
                .call(
                    &slot.account_id,
                    device_id,
                    "fleet_replica_push",
                    batch.request,
                )
                .await
            {
                Ok(answer) => answer,
                Err(error) => {
                    log::info!("Superagent history push failed: error={}", error);
                    break;
                }
            };
            let (held, stored_records, holders_changed) =
                apply_answer(slot, device_id, &batch.records, &answer, required).await;
            report.chunks_held += held;
            report.records_stored += stored_records;
            if held == 0 && stored_records == 0 && !holders_changed {
                break;
            }
        }
    }
    finish_drained(slot).await;
    report
}

/// Applies one push answer; returns (chunks dropped as held, records
/// stored, whether any pending chunk's holders changed).
async fn apply_answer(
    slot: &Arc<Slot>,
    device_id: &str,
    records: &[(String, Hlc)],
    answer: &Value,
    required: usize,
) -> (usize, usize, bool) {
    let mut state = slot.state.lock().await;
    let mut stored_records = 0;
    let mut holders_changed = false;
    for row in answer
        .get("records")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let Some(id) = row.get("id").and_then(Value::as_str) else {
            continue;
        };
        let Some((_, hlc)) = records.iter().find(|(pushed, _)| pushed == id) else {
            continue;
        };
        if !record_delivered(row, hlc) {
            continue;
        }
        if let Some(record) = state.outbox.records.get_mut(id) {
            if &record.hlc == hlc && !record.delivered {
                record.delivered = true;
                stored_records += 1;
            }
        }
    }
    for row in answer
        .get("blobs")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        if !blob_stored(row) {
            if let Some(error) = row.get("error").and_then(Value::as_str) {
                log::info!("Superagent history chunk not stored: error={error}");
            }
            continue;
        }
        let hash = row.get("hash").and_then(Value::as_str).unwrap_or("");
        let reported: Vec<String> = row
            .get("holders")
            .and_then(Value::as_array)
            .map(|holders| {
                holders
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default();
        if let Some(chunk) = state.outbox.chunks.iter_mut().find(|c| c.hash == hash) {
            // Only pinning holders count: a device that kept the chunk in its
            // cache only (no policy) does not report itself.
            if record_chunk_holders(chunk, device_id, &reported) {
                holders_changed = true;
            }
        }
    }
    let before = state.outbox.chunks.len();
    state.outbox.chunks.retain(|chunk| {
        chunk
            .holders
            .iter()
            .filter(|holder| !holder.starts_with('~'))
            .count()
            < required
    });
    let held = before - state.outbox.chunks.len();
    let pending: BTreeSet<String> = state
        .outbox
        .chunks
        .iter()
        .map(|chunk| chunk.conversation_id.clone())
        .collect();
    state
        .outbox
        .records
        .retain(|id, record| !record.delivered || pending.contains(id));
    if held > 0 || stored_records > 0 || holders_changed {
        if let Err(error) = save_outbox(&slot.store, &state.outbox) {
            log::warn!("Superagent outbox not saved: {}", error);
        }
        if held > 0 || stored_records > 0 {
            log::info!(
                "Superagent history stored on devices: chunks={}, records={}, pending_chunks={}",
                held,
                stored_records,
                state.outbox.chunks.len()
            );
        }
    }
    (held, stored_records, holders_changed)
}

// ---------------------------------------------------------------------------
// Legacy drain and the working set
// ---------------------------------------------------------------------------

fn has_legacy(state: &SlotState) -> bool {
    state.legacy_pending
}

/// Seals legacy conversations while the outbox has room (half of it), one
/// at a time, so no legacy history is ever dropped by the outbox.
pub async fn drain_legacy(slot: &Arc<Slot>, now: u64) {
    let mut state = slot.state.lock().await;
    if !state.legacy_pending {
        return;
    }
    let ids: Vec<String> = state.summaries.iter().map(|s| s.id.clone()).collect();
    let device_id = state.meta.device_id.clone();
    let mut remaining = false;
    for id in ids {
        if state.outbox.chunk_bytes() > OUTBOX_MAX_BYTES / 2 {
            remaining = true;
            break;
        }
        let Ok(Some(conversation)) = slot.conversation(&mut state, &id) else {
            continue;
        };
        if !is_legacy(conversation, 0) && conversation.archive.sealed_seq > 0 {
            continue;
        }
        let history = match slot.history(&id) {
            Ok(history) => history,
            Err(error) => {
                log::warn!("Superagent legacy history not read: {}", error);
                continue;
            }
        };
        let SlotState {
            conversations,
            outbox,
            ..
        } = &mut *state;
        let Some(conversation) = conversations.get_mut(&id) else {
            continue;
        };
        if seal(outbox, &device_id, conversation, &[], Some(&history), now) {
            let _ = slot
                .store
                .write_json(&crate::slots::conversation_record(&id), &*conversation);
            log::info!(
                "Superagent legacy history sealed for the devices: messages={}",
                conversation.archive.sealed_seq
            );
        }
    }
    state.legacy_pending = remaining;
    let _ = save_outbox(&slot.store, &state.outbox);
}

/// Removes legacy `hist-*` records whose history the devices now hold.
async fn finish_drained(slot: &Arc<Slot>) {
    let state = slot.state.lock().await;
    for summary in &state.summaries {
        if state.outbox.pending_for(&summary.id) {
            continue;
        }
        let name = history_record(&summary.id);
        if slot.store.names().contains(&name) {
            let sealed = state
                .conversations
                .get(&summary.id)
                .map(|c| !is_legacy(c, 0) && c.archive.sealed_seq >= c.history_count)
                .unwrap_or(false);
            if sealed {
                let _ = slot.store.delete(&name);
                log::info!("Superagent legacy history drained to the devices");
            }
        }
    }
}

fn record_bytes(store: &AccountStore, name: &str) -> u64 {
    std::fs::metadata(store.path().join(format!("{name}.rec")))
        .map(|meta| meta.len())
        .unwrap_or(0)
}

/// Keeps the working set within its bounds: conversations idle past
/// [`IDLE_EVICT_MS`] leave it, then the least recently used past the count
/// and byte bounds. A conversation with a running turn or unsealed history
/// stays; one whose history is still in the outbox may go (the outbox keeps
/// it, and its record lists it). Returns the evicted ids.
pub fn enforce_working_set(slot: &Slot, state: &mut SlotState, now: u64) -> Vec<String> {
    // Least recently used first, from the list (no conversation is read
    // unless it would leave).
    let mut candidates: Vec<(u64, String, u64)> = state
        .summaries
        .iter()
        .map(|summary| {
            let bytes = record_bytes(&slot.store, &crate::slots::conversation_record(&summary.id));
            (
                summary.updated_ms.max(summary.seen_ms),
                summary.id.clone(),
                bytes,
            )
        })
        .collect();
    let mut total_bytes: u64 = candidates.iter().map(|c| c.2).sum();
    let mut count = candidates.len();
    candidates.sort();
    let mut evict = Vec::new();
    for (used, id, bytes) in &candidates {
        let idle = now.saturating_sub(*used) >= IDLE_EVICT_MS;
        if !(idle || count > MAX_WORKING_CONVERSATIONS || total_bytes > MAX_WORKING_BYTES) {
            break;
        }
        let sealed = match slot.conversation(state, id) {
            Ok(Some(conversation)) => {
                conversation.active_turn().is_none()
                    && !is_legacy(conversation, 0)
                    && conversation.archive.sealed_seq
                        >= conversation.history_count + conversation.messages.len() as u64
            }
            // A conversation whose record is gone or unreadable stays listed.
            _ => false,
        };
        if !sealed {
            continue;
        }
        evict.push(id.clone());
        count -= 1;
        total_bytes = total_bytes.saturating_sub(*bytes);
    }
    for id in &evict {
        state.conversations.remove(id);
        state.summaries.retain(|s| &s.id != id);
        let _ = slot.store.delete(&crate::slots::conversation_record(id));
        if !state.outbox.pending_for(id) {
            let _ = slot.store.delete(&history_record(id));
        }
    }
    if !evict.is_empty() {
        let _ = slot
            .store
            .write_json(crate::slots::CONVERSATIONS_RECORD, &state.summaries);
        log::info!(
            "Superagent conversations left the working set: count={}, remaining={}",
            evict.len(),
            state.summaries.len()
        );
    }
    evict
}

// ---------------------------------------------------------------------------
// Resume
// ---------------------------------------------------------------------------

/// Why a conversation could not be resumed.
pub const HISTORY_UNAVAILABLE_OFFLINE: &str = "history_unavailable_offline";

async fn device_record(
    engine: &Engine,
    account_id: &str,
    devices: &[String],
    id: &str,
) -> Option<(Vec<String>, bool)> {
    for device_id in devices {
        let mut since = String::new();
        for _ in 0..16 {
            let Ok(answer) = engine
                .rpc
                .call(
                    account_id,
                    device_id,
                    "fleet_replica_list",
                    json!({ "request": { "collection": ARCHIVE_COLLECTION, "sinceStamp": since, "limit": 500 } }),
                )
                .await
            else {
                break;
            };
            let rows = answer
                .get("records")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            if let Some(row) = rows
                .iter()
                .find(|row| row.get("id").and_then(Value::as_str) == Some(id))
            {
                let deleted = row.get("deleted").and_then(Value::as_bool).unwrap_or(false);
                let blobs = row
                    .get("blobs")
                    .and_then(Value::as_array)
                    .map(|blobs| {
                        blobs
                            .iter()
                            .filter_map(|blob| blob.get("hash").and_then(Value::as_str))
                            .map(str::to_string)
                            .collect()
                    })
                    .unwrap_or_default();
                return Some((blobs, deleted));
            }
            let more = answer.get("more").and_then(Value::as_bool).unwrap_or(false);
            match rows
                .last()
                .and_then(|row| row.get("stamp"))
                .and_then(Value::as_str)
            {
                Some(stamp) if more => since = stamp.to_string(),
                _ => break,
            }
        }
    }
    None
}

async fn fetch_chunk(
    engine: &Engine,
    slot: &Slot,
    devices: &[String],
    hash: &str,
) -> Option<(ArchiveChunk, u64)> {
    let local = slot.state.lock().await.outbox.chunk_data(hash);
    let bytes = match local {
        Some(bytes) => bytes,
        None => {
            let mut found = None;
            for device_id in devices {
                let Ok(answer) = engine
                    .rpc
                    .call(
                        &slot.account_id,
                        device_id,
                        "fleet_blob_get",
                        json!({ "request": { "hash": hash } }),
                    )
                    .await
                else {
                    continue;
                };
                if let Some(bytes) = answer
                    .get("data")
                    .and_then(Value::as_str)
                    .and_then(|data| BASE64.decode(data).ok())
                    .filter(|bytes| sha256_hex(bytes) == hash)
                {
                    found = Some(bytes);
                    break;
                }
            }
            found?
        }
    };
    let len = bytes.len() as u64;
    serde_json::from_slice(&bytes)
        .ok()
        .map(|chunk| (chunk, len))
}

/// Brings a conversation that left the working set back from the devices:
/// its record from the newest chunk, its last [`WINDOW_TURNS`] turns from
/// the chunks. `Ok(false)`: no device knows it (or it was deleted);
/// `Err(history_unavailable_offline)`: no device that holds it is online.
pub async fn resume(engine: &Engine, slot: &Arc<Slot>, id: &str) -> Result<bool, String> {
    {
        let mut state = slot.state.lock().await;
        if slot
            .conversation(&mut state, id)
            .map_err(|e| e.to_string())?
            .is_some()
        {
            return Ok(true);
        }
    }
    let queued = slot.state.lock().await.outbox.records.get(id).cloned();
    let devices = archive_devices(&engine.devices(&slot.account_id).await);
    let hashes: Vec<String> = match &queued {
        Some(record) => match &record.value {
            None => return Ok(false),
            Some(value) => value.chunks.iter().map(|c| c.hash.clone()).collect(),
        },
        None => {
            if devices.is_empty() {
                return Err(format!(
                    "{HISTORY_UNAVAILABLE_OFFLINE}: this conversation is stored on your devices and none of them is online"
                ));
            }
            match device_record(engine, &slot.account_id, &devices, id).await {
                None => return Ok(false),
                Some((_, true)) => return Ok(false),
                Some((hashes, false)) => hashes,
            }
        }
    };
    let Some(newest_hash) = hashes.last() else {
        return Ok(false);
    };
    let Some((newest, newest_bytes)) = fetch_chunk(engine, slot, &devices, newest_hash).await
    else {
        return Err(format!(
            "{HISTORY_UNAVAILABLE_OFFLINE}: no online device holds this conversation's history now"
        ));
    };
    let mut record = queued
        .and_then(|queued| queued.value)
        .unwrap_or_else(|| newest.record.clone());
    if !record.chunks.iter().any(|c| &c.hash == newest_hash) {
        record.chunks.retain(|c| hashes.contains(&c.hash));
        record.chunks.push(ArchiveChunkRef {
            hash: newest_hash.clone(),
            from_seq: newest.from_seq,
            to_seq: newest.to_seq,
            bytes: newest_bytes,
        });
    }
    record.message_count = record.message_count.max(newest.to_seq);
    // The window: the newest chunks back to the last WINDOW_TURNS user turns.
    let mut window: Vec<Message> = parse_messages(&newest.messages);
    let mut window_start = newest.from_seq;
    let mut index = record.chunks.len().saturating_sub(1);
    let mut read = 1;
    while user_turns(&window) < WINDOW_TURNS && index > 0 && read < MAX_RESUME_CHUNKS {
        index -= 1;
        let reference = record.chunks[index].clone();
        if reference.to_seq != window_start {
            break;
        }
        let Some((chunk, _)) = fetch_chunk(engine, slot, &devices, &reference.hash).await else {
            break;
        };
        let mut older = parse_messages(&chunk.messages);
        older.extend(window);
        window = older;
        window_start = chunk.from_seq;
        read += 1;
    }
    // Keep the last WINDOW_TURNS user turns.
    let mut users = 0;
    let mut cut = 0;
    for (position, message) in window.iter().enumerate().rev() {
        if message.role == Role::User {
            users += 1;
            if users == WINDOW_TURNS {
                cut = position;
                break;
            }
        }
    }
    let window: Vec<Message> = window.split_off(cut);
    let window_start = window_start + cut as u64;
    let mut conversation =
        Conversation::new(id.to_string(), record.title.clone(), record.created_ms);
    conversation.updated_ms = record.updated_ms;
    conversation.history_count = window_start;
    conversation.messages = window;
    conversation.pinned_holder = record.pinned_holder.clone();
    conversation.model_id = record.model_id.clone();
    for message in &conversation.messages {
        if let (Some(client), true) = (&message.client_message_id, message.role == Role::User) {
            conversation
                .client_ids
                .insert(client.clone(), message.id.clone());
        }
    }
    conversation.archive = ConversationArchive {
        sealed_seq: record.message_count,
        chunks: record.chunks.clone(),
        unsaved: record.unsaved,
        dropped: record.dropped,
        sealed_meta: String::new(),
        record_digest: String::new(),
    };
    conversation.archive.sealed_meta = meta_of(&conversation);
    conversation.archive.record_digest =
        sha256_hex(&serde_json::to_vec(&record_of(&conversation)).unwrap_or_default());
    let mut state = slot.state.lock().await;
    if state.conversations.contains_key(id) {
        return Ok(true);
    }
    state.conversations.insert(id.to_string(), conversation);
    if !state.summaries.iter().any(|s| s.id == id) {
        state.summaries.push(ConversationSummary {
            id: id.to_string(),
            title: record.title.clone(),
            updated_ms: record.updated_ms,
            status: "idle".into(),
            seen_ms: record.updated_ms,
        });
    }
    slot.save_conversation(&mut state, id)
        .map_err(|e| e.to_string())?;
    log::info!(
        "Superagent conversation resumed from the devices: messages={}, window={}",
        record.message_count,
        state
            .conversations
            .get(id)
            .map(|c| c.messages.len())
            .unwrap_or(0)
    );
    Ok(true)
}

fn parse_messages(values: &[Value]) -> Vec<Message> {
    values
        .iter()
        .map(|value| serde_json::from_value(value.clone()).unwrap_or_default())
        .collect()
}

fn user_turns(messages: &[Message]) -> usize {
    messages.iter().filter(|m| m.role == Role::User).count()
}

// ---------------------------------------------------------------------------
// Projection inputs from the entry
// ---------------------------------------------------------------------------

/// The working set and the entry's archived conversations as one list
/// (newest first). Archived rows read as seen; a conversation this node
/// is deleting is left out.
pub fn merged_summaries(
    working: &[ConversationSummary],
    archived: &[ArchivedSummary],
    outbox: &Outbox,
) -> Vec<ConversationSummary> {
    let mut rows: Vec<ConversationSummary> = working.to_vec();
    let known: BTreeSet<String> = rows.iter().map(|row| row.id.clone()).collect();
    let deleting: BTreeSet<&str> = outbox
        .records
        .iter()
        .filter(|(_, record)| record.value.is_none())
        .map(|(id, _)| id.as_str())
        .collect();
    let mut seen = known.clone();
    for row in archived {
        if seen.contains(&row.id) || deleting.contains(row.id.as_str()) || row.id.is_empty() {
            continue;
        }
        seen.insert(row.id.clone());
        rows.push(ConversationSummary {
            id: row.id.clone(),
            title: row.title.clone(),
            updated_ms: row.updated_ms,
            status: "idle".into(),
            seen_ms: row.updated_ms,
        });
    }
    // Conversations that left the working set while their history waits.
    for (id, record) in &outbox.records {
        let Some(value) = &record.value else {
            continue;
        };
        if seen.contains(id) {
            continue;
        }
        seen.insert(id.clone());
        rows.push(ConversationSummary {
            id: id.clone(),
            title: value.title.clone(),
            updated_ms: value.updated_ms,
            status: "idle".into(),
            seen_ms: value.updated_ms,
        });
    }
    rows.sort_by(|a, b| b.updated_ms.cmp(&a.updated_ms).then(a.id.cmp(&b.id)));
    rows
}

/// A message of the conversation by seq from what this node holds beyond
/// its window: the outbox, then a legacy history record.
pub fn held_message(
    outbox: &Outbox,
    conversation_id: &str,
    history: Option<&History>,
    seq: u64,
) -> Option<Message> {
    for chunk in outbox
        .chunks
        .iter()
        .filter(|c| c.conversation_id == conversation_id && c.from_seq <= seq && seq < c.to_seq)
    {
        let bytes = BASE64.decode(&chunk.data).ok()?;
        let parsed: ArchiveChunk = serde_json::from_slice(&bytes).ok()?;
        if let Some(value) = parsed.messages.get((seq - parsed.from_seq) as usize) {
            return serde_json::from_value(value.clone()).ok();
        }
    }
    history.and_then(|history| {
        seq.checked_sub(history.dropped)
            .and_then(|index| history.messages.get(index as usize).cloned())
    })
}

/// A message from the page the entry passed along.
pub fn page_message(page: Option<&ArchivedPage>, seq: u64) -> Option<Message> {
    let page = page?;
    let index = seq.checked_sub(page.from_seq)?;
    page.messages
        .get(index as usize)
        .and_then(|value| serde_json::from_value(value.clone()).ok())
}

/// The notices a conversation view leads with: messages that were never
/// stored, and history that waits for a device.
pub fn history_notices(unsaved: u64, pending_since: Option<u64>, now: u64) -> Vec<Value> {
    let mut notices = Vec::new();
    if unsaved > 0 {
        let text = if unsaved == 1 {
            "1 earlier message was not saved because none of your devices was online.".to_string()
        } else {
            format!(
                "{unsaved} earlier messages were not saved because none of your devices was online."
            )
        };
        notices.push(json!({
            "id": "history-unsaved",
            "role": "card",
            "text": text,
            "card": { "kind": "history_not_saved", "count": unsaved },
            "atMs": 0,
        }));
    }
    if pending_since.is_some_and(|since| now.saturating_sub(since) >= PENDING_NOTICE_MS) {
        notices.push(json!({
            "id": "history-pending",
            "role": "card",
            "text": "History not yet stored on your devices. It is kept here for up to 7 days until one of them is online.",
            "card": { "kind": "history_pending" },
            "atMs": 0,
        }));
    }
    notices
}

/// The history state a conversation view reports.
pub fn history_state(unsaved: u64, pending: bool) -> &'static str {
    match (unsaved > 0, pending) {
        (_, true) => "pending",
        (true, false) => "partial",
        (false, false) => "stored",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::slots::{AccountMeta, SlotLimits, Slots};
    use crate::store::Store;

    fn sample_chunk(hash: &str) -> OutChunk {
        OutChunk {
            conversation_id: "c1".into(),
            hash: hash.into(),
            from_seq: 0,
            to_seq: 2,
            bytes: 128,
            created_ms: 1000,
            data: BASE64.encode(b"{}"),
            holders: Vec::new(),
        }
    }

    fn sample_hlc(wall_ms: u64, counter: u32, device: &str) -> Hlc {
        Hlc {
            wall_ms,
            counter,
            device_id: device.into(),
        }
    }

    #[tokio::test]
    async fn cached_tilde_marker_skips_repush_and_does_not_grow_holders() {
        let dir = tempfile::tempdir().unwrap();
        let store = Arc::new(Store::open(dir.path(), [9u8; 32]).unwrap());
        let slots = Slots::new(store, SlotLimits::default());
        let slot = slots
            .load(
                "acct-1",
                1000,
                Some(AccountMeta {
                    version: 1,
                    account_id: "acct-1".into(),
                    device_id: "cloud-1".into(),
                    enabled: true,
                    ..AccountMeta::default()
                }),
            )
            .await
            .unwrap();
        let hlc = sample_hlc(1000, 0, "cloud-1");
        {
            let mut state = slot.state.lock().await;
            state.outbox.chunks.push(sample_chunk("h1"));
            state.outbox.records.insert(
                "c1".into(),
                OutRecord {
                    value: Some(ArchiveRecord::default()),
                    hlc: hlc.clone(),
                    delivered: false,
                    created_ms: 1000,
                },
            );
        }
        // First batch for dev-a includes chunk h1.
        let batch = {
            let state = slot.state.lock().await;
            batch_for(&state.outbox, "dev-a").expect("first batch")
        };
        assert_eq!(
            batch.request["request"]["blobs"].as_array().unwrap().len(),
            1
        );
        // Device caches blob without pinning (reports empty holders).
        let answer = json!({
            "records": [{ "id": "c1", "stored": true }],
            "blobs": [{ "hash": "h1", "stored": true, "holders": [] }],
        });
        let (held, records_stored, holders_changed) =
            apply_answer(&slot, "dev-a", &batch.records, &answer, 1).await;
        assert_eq!(held, 0);
        assert_eq!(records_stored, 1);
        assert!(holders_changed);
        {
            let state = slot.state.lock().await;
            assert_eq!(state.outbox.chunks[0].holders, vec!["~dev-a".to_string()]);
            // Subsequent batch_for dev-a must skip chunk h1 (and delivered record).
            assert!(batch_for(&state.outbox, "dev-a").is_none());
            // Another device still receives it.
            assert!(batch_for(&state.outbox, "dev-b").is_some());
        }
        // Even if apply_answer is invoked again for dev-a, holders stays deduped.
        let (_, _, changed_again) = apply_answer(&slot, "dev-a", &batch.records, &answer, 1).await;
        assert!(!changed_again);
        assert_eq!(
            slot.state.lock().await.outbox.chunks[0].holders,
            vec!["~dev-a".to_string()]
        );
    }

    #[test]
    fn holders_are_deduped_upgraded_on_pin_and_capped() {
        let mut chunk = sample_chunk("h1");
        // Simulate legacy unbounded duplicates.
        chunk.holders = vec!["~dev-a".into(); 200];
        let changed = record_chunk_holders(&mut chunk, "dev-a", &[]);
        assert!(changed);
        assert_eq!(chunk.holders, vec!["~dev-a".to_string()]);
        // Later dev-a pins it -> upgrades ~dev-a to dev-a without keeping both.
        assert!(record_chunk_holders(&mut chunk, "dev-a", &["dev-a".into()]));
        assert_eq!(chunk.holders, vec!["dev-a".to_string()]);
        // Flood of distinct reported holders is capped at MAX_CHUNK_HOLDERS.
        let many: Vec<String> = (0..MAX_CHUNK_HOLDERS * 2)
            .map(|i| format!("dev-{i}"))
            .collect();
        record_chunk_holders(&mut chunk, "dev-extra", &many);
        assert_eq!(chunk.holders.len(), MAX_CHUNK_HOLDERS);
    }

    #[test]
    fn legacy_outbox_with_duplicate_holders_is_deduped_on_load() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path(), [5u8; 32]).unwrap();
        let account = store.account("acct-legacy", true).unwrap();
        let mut outbox = Outbox::default();
        let mut chunk = sample_chunk("h1");
        chunk.holders = vec![
            "~dev-a".into(),
            "~dev-a".into(),
            "dev-a".into(),
            "~dev-b".into(),
            "~dev-b".into(),
        ];
        outbox.chunks.push(chunk);
        save_outbox(&account, &outbox).unwrap();
        let loaded = load_outbox(&account);
        assert_eq!(
            loaded.chunks[0].holders,
            vec!["dev-a".to_string(), "~dev-b".to_string()]
        );
    }

    #[tokio::test]
    async fn retried_push_reported_already_stored_marks_record_delivered() {
        let dir = tempfile::tempdir().unwrap();
        let store = Arc::new(Store::open(dir.path(), [11u8; 32]).unwrap());
        let slots = Slots::new(store, SlotLimits::default());
        let slot = slots
            .load(
                "acct-2",
                2000,
                Some(AccountMeta {
                    version: 1,
                    account_id: "acct-2".into(),
                    device_id: "cloud-2".into(),
                    enabled: true,
                    ..AccountMeta::default()
                }),
            )
            .await
            .unwrap();
        let cases = [
            (
                "c-already-bool",
                json!({ "id": "c-already-bool", "stored": false, "alreadyStored": true }),
            ),
            (
                "c-already-status",
                json!({ "id": "c-already-status", "stored": false, "status": "already_stored" }),
            ),
            (
                "c-older-hlc",
                json!({ "id": "c-older-hlc", "stored": false, "reason": "older_hlc" }),
            ),
            (
                "c-newer-stamp",
                json!({
                    "id": "c-newer-stamp",
                    "stored": false,
                    "stamp": format!("{:016x}-{:08x}-other", 3000u64, 0u32),
                }),
            ),
        ];
        let hlc = sample_hlc(2000, 1, "cloud-2");
        let mut pushed = Vec::new();
        {
            let mut state = slot.state.lock().await;
            for (id, _) in &cases {
                state.outbox.records.insert(
                    (*id).into(),
                    OutRecord {
                        value: Some(ArchiveRecord::default()),
                        hlc: hlc.clone(),
                        delivered: false,
                        created_ms: 2000,
                    },
                );
                pushed.push(((*id).to_string(), hlc.clone()));
            }
            // Genuine error must NOT be marked delivered.
            state.outbox.records.insert(
                "c-err".into(),
                OutRecord {
                    value: Some(ArchiveRecord::default()),
                    hlc: hlc.clone(),
                    delivered: false,
                    created_ms: 2000,
                },
            );
            pushed.push(("c-err".to_string(), hlc.clone()));
        }
        let mut rows: Vec<Value> = cases.iter().map(|(_, row)| row.clone()).collect();
        rows.push(json!({ "id": "c-err", "stored": false, "error": "replica_full" }));
        let answer = json!({ "records": rows, "blobs": [] });
        let (_, stored, _) = apply_answer(&slot, "dev-a", &pushed, &answer, 1).await;
        assert_eq!(stored, cases.len());
        let state = slot.state.lock().await;
        for (id, _) in &cases {
            assert!(!state.outbox.records.contains_key(*id), "{id} should drain");
        }
        assert!(state.outbox.records.contains_key("c-err"));
        assert!(!state.outbox.records["c-err"].delivered);
    }
}

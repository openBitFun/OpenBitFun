//! Conversation history on the account's devices (the cloud node keeps none
//! durably).
//!
//! The cloud node is a write-only peer of the account replica: it pushes one
//! record per conversation to collection [`ARCHIVE_COLLECTION`] and the
//! conversation's turns as immutable, content-addressed chunk blobs that at
//! least [`ARCHIVE_DURABLE_HOLDERS`] runtime devices pin. It drops its copy
//! of a chunk once the push answers report enough holders. Every shape here
//! is read tolerantly (defaults, unknown fields ignored) by older and newer
//! builds.
//!
//! - The record value ([`ArchiveRecord`]) is the conversation's list entry
//!   and its chunk index. A deletion is a replica tombstone.
//! - A chunk ([`ArchiveChunk`]) holds messages `[fromSeq, toSeq)` of the
//!   conversation and, for the cloud node that resumes it (which never reads
//!   record values), the record as it was when the chunk was sealed.
//! - A device that advertises [`SUPERAGENT_ARCHIVE_CAPABILITY`] declares the
//!   collection's policy (pinning) and grants the cloud node only the
//!   `superagent.` collections; the cloud node pushes to no other device.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Advertised by a runtime device that keeps Super Agent history.
pub const SUPERAGENT_ARCHIVE_CAPABILITY: &str = "superagent_archive_v1";
/// The replica collection of conversation records.
pub const ARCHIVE_COLLECTION: &str = "superagent.conversations";
/// The collection prefix the cloud node may write and read.
pub const CLOUD_REPLICA_COLLECTIONS: &str = "superagent.";
/// Devices that pin every chunk.
pub const ARCHIVE_DURABLE_HOLDERS: usize = 2;
/// The largest chunk the cloud node writes.
pub const MAX_CHUNK_BYTES: usize = 256 * 1024;
/// Chunks one record names at most (older ones are merged by the cloud node
/// while it still holds their turns, see the superagent `archive` module).
pub const MAX_CHUNKS_PER_RECORD: usize = 256;
/// Conversation records the collection holds on a device.
pub const ARCHIVE_MAX_RECORDS: usize = 2048;
/// Bytes of the collection's records on a device.
pub const ARCHIVE_MAX_BYTES: usize = 8 * 1024 * 1024;
/// Bytes of one record value.
pub const ARCHIVE_MAX_VALUE_BYTES: usize = 64 * 1024;
/// Archived conversations an entry passes to the cloud node's list.
pub const MAX_ARCHIVED_LISTED: usize = 500;
/// Messages one archived page carries.
pub const ARCHIVE_PAGE: usize = 100;

/// One chunk a record names.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ArchiveChunkRef {
    pub hash: String,
    pub from_seq: u64,
    pub to_seq: u64,
    pub bytes: u64,
}

/// The record value of one conversation.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ArchiveRecord {
    pub title: String,
    pub created_ms: u64,
    pub updated_ms: u64,
    /// Messages of the conversation so far (the next seq).
    pub message_count: u64,
    /// Messages the cloud node dropped before any device stored them.
    pub unsaved: u64,
    /// Messages older than the oldest chunk that are no longer kept.
    pub dropped: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pinned_holder: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
    /// Oldest first.
    pub chunks: Vec<ArchiveChunkRef>,
}

impl ArchiveRecord {
    /// The chunks holding any of `[from, to)`, oldest first.
    pub fn chunks_for(&self, from: u64, to: u64) -> Vec<&ArchiveChunkRef> {
        self.chunks
            .iter()
            .filter(|chunk| chunk.to_seq > from && chunk.from_seq < to)
            .collect()
    }
}

/// One chunk's content (JSON, the blob).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ArchiveChunk {
    pub v: u32,
    pub conversation_id: String,
    pub from_seq: u64,
    pub to_seq: u64,
    /// The cloud node's messages, as it stores them.
    pub messages: Vec<Value>,
    /// The record when this chunk was sealed, without this chunk's own ref
    /// (the cloud node rebuilds the record from its newest chunk).
    pub record: ArchiveRecord,
}

/// An archived conversation an entry passes to the cloud node's list
/// (`superagent_list_conversations {archived: [...]}`).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ArchivedSummary {
    pub id: String,
    pub title: String,
    pub created_ms: u64,
    pub updated_ms: u64,
    pub message_count: u64,
    pub unsaved: u64,
}

/// The page of an archived conversation an entry passes to the cloud node
/// (`superagent_get_conversation {archive: {...}}`): messages `[fromSeq,
/// fromSeq + messages.len())` read from the entry's replica.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ArchivedPage {
    pub summary: ArchivedSummary,
    pub dropped: u64,
    pub from_seq: u64,
    pub messages: Vec<Value>,
    /// Chunks of the page no online device could give (the page has a gap).
    pub missing_chunks: u32,
}

impl ArchivedSummary {
    pub fn of(id: &str, record: &ArchiveRecord) -> Self {
        Self {
            id: id.to_string(),
            title: record.title.clone(),
            created_ms: record.created_ms,
            updated_ms: record.updated_ms,
            message_count: record.message_count,
            unsaved: record.unsaved,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn records_and_chunks_read_tolerantly_and_round_trip() {
        let record: ArchiveRecord = serde_json::from_value(json!({
            "title": "t", "chunks": [{"hash": "h", "fromSeq": 0, "toSeq": 4}], "future": 1
        }))
        .unwrap();
        assert_eq!(record.chunks[0].to_seq, 4);
        assert_eq!(record.chunks_for(3, 10).len(), 1);
        assert!(record.chunks_for(4, 10).is_empty());
        let chunk: ArchiveChunk = serde_json::from_value(json!({"conversationId": "c"})).unwrap();
        assert!(chunk.messages.is_empty());
        let back: ArchiveRecord =
            serde_json::from_value(serde_json::to_value(&record).unwrap()).unwrap();
        assert_eq!(back, record);
    }
}

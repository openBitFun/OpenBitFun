//! Super Agent history on this runtime device (`superagent.conversations`).
//!
//! The account's cloud node keeps only working state; conversation history
//! lives in the account replica on the runtime devices (records plus pinned,
//! content-addressed turn chunks, see
//! `openbitfun_product_domains::superagent::archive`). This module holds the
//! device side:
//!
//! - [`SUPERAGENT_CONVERSATIONS_POLICY`]: the collection's budget and its
//!   two durable holders (declare it on every replica that serves the cloud
//!   node, then advertise `superagent_archive_v1`);
//! - [`augment_fleet_call`]: the entry's part of the history projection. A
//!   frontend's `fleet_call` of `superagent_list_conversations` or
//!   `superagent_get_conversation` leaves this entry with what this device's
//!   replica knows (archived conversations for the list, the asked page of
//!   an archived conversation's messages), and the cloud node projects its
//!   working set together with them; it stores none of it. A cloud node that
//!   predates the fields ignores them. Desktop and CLI read their own
//!   replica; phone and browser get the replica of the entry they use.

use serde_json::Value;

use openbitfun_product_domains::superagent::archive::{
    ArchiveChunk, ArchiveRecord, ArchivedPage, ArchivedSummary, ARCHIVE_COLLECTION,
    ARCHIVE_DURABLE_HOLDERS, ARCHIVE_MAX_BYTES, ARCHIVE_MAX_RECORDS, ARCHIVE_MAX_VALUE_BYTES,
    ARCHIVE_PAGE, MAX_ARCHIVED_LISTED,
};

use super::replica::{AccountReplica, CollectionPolicy, ReplicaSync};

/// The budget of the conversation records on a device; every chunk they
/// name is pinned by two runtime devices.
pub const SUPERAGENT_CONVERSATIONS_POLICY: CollectionPolicy = CollectionPolicy {
    name: ARCHIVE_COLLECTION,
    max_records: ARCHIVE_MAX_RECORDS,
    max_bytes: ARCHIVE_MAX_BYTES,
    max_value_bytes: ARCHIVE_MAX_VALUE_BYTES,
    durable_holders: ARCHIVE_DURABLE_HOLDERS,
};

/// Declares the history collection on a replica.
pub fn declare(replica: &AccountReplica) {
    replica.declare(SUPERAGENT_CONVERSATIONS_POLICY);
}

/// The archived conversations this replica holds, newest first.
pub fn archived_summaries(replica: &AccountReplica, limit: usize) -> Vec<ArchivedSummary> {
    let mut rows: Vec<ArchivedSummary> = replica
        .records(ARCHIVE_COLLECTION)
        .into_iter()
        .filter_map(|record| {
            let value: ArchiveRecord = serde_json::from_value(record.value?).ok()?;
            Some(ArchivedSummary::of(&record.id, &value))
        })
        .collect();
    rows.sort_by(|a, b| b.updated_ms.cmp(&a.updated_ms).then(a.id.cmp(&b.id)));
    rows.truncate(limit);
    rows
}

/// A chunk from this device or the first online device that holds it.
async fn chunk(sync: &ReplicaSync, hash: &str) -> Option<ArchiveChunk> {
    let bytes = match sync.replica().blob(hash) {
        Some(bytes) => bytes,
        None => sync.fetch_blob(hash, false).await?,
    };
    serde_json::from_slice(&bytes).ok()
}

/// Messages `[end - ARCHIVE_PAGE, end)` of an archived conversation (`end`:
/// `cursor`, or the end of what is archived), read from this replica and
/// the account's online devices. A chunk no device gives ends the page
/// after it (the page stays contiguous) and is counted.
pub async fn archived_page(
    sync: &ReplicaSync,
    conversation_id: &str,
    cursor: Option<u64>,
) -> Option<ArchivedPage> {
    let record = sync.replica().get(ARCHIVE_COLLECTION, conversation_id)?;
    let value: ArchiveRecord = serde_json::from_value(record.value?).ok()?;
    let end = cursor
        .unwrap_or(value.message_count)
        .min(value.message_count);
    let start = end.saturating_sub(ARCHIVE_PAGE as u64);
    let mut page = ArchivedPage {
        summary: ArchivedSummary::of(conversation_id, &value),
        dropped: value.dropped,
        from_seq: end,
        ..ArchivedPage::default()
    };
    let mut messages: Vec<(u64, Value)> = Vec::new();
    for chunk_ref in value.chunks_for(start, end) {
        let Some(chunk) = chunk(sync, &chunk_ref.hash).await else {
            page.missing_chunks += 1;
            messages.clear();
            continue;
        };
        for (offset, message) in chunk.messages.into_iter().enumerate() {
            let seq = chunk.from_seq + offset as u64;
            if seq >= start && seq < end {
                messages.push((seq, message));
            }
        }
    }
    // Keep only the contiguous run that ends at `end`.
    let mut expected = end;
    let mut kept: Vec<Value> = Vec::new();
    for (seq, message) in messages.into_iter().rev() {
        if seq + 1 != expected {
            break;
        }
        expected = seq;
        kept.push(message);
    }
    kept.reverse();
    page.from_seq = expected;
    page.messages = kept;
    Some(page)
}

/// Adds this device's history to a frontend's `fleet_call` of
/// `superagent_list_conversations` (`request.archived`) or
/// `superagent_get_conversation` (`request.archive`); any other call, or a
/// request that already carries them, is returned unchanged.
pub async fn augment_fleet_call(sync: &ReplicaSync, mut args: Value) -> Value {
    let Some(call) = args.get_mut("request").and_then(Value::as_object_mut) else {
        return args;
    };
    let command = call
        .get("command")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    if !matches!(
        command.as_str(),
        "superagent_list_conversations" | "superagent_get_conversation"
    ) {
        return args;
    }
    let inner = call
        .entry("args")
        .or_insert_with(|| Value::Object(Default::default()));
    if !inner.is_object() {
        return args;
    }
    if !inner.get("request").is_some_and(Value::is_object) {
        inner["request"] = Value::Object(Default::default());
    }
    let request = &mut inner["request"];
    match command.as_str() {
        "superagent_list_conversations" if request.get("archived").is_none() => {
            let rows = archived_summaries(sync.replica(), MAX_ARCHIVED_LISTED);
            request["archived"] = serde_json::to_value(rows).unwrap_or(Value::Null);
        }
        "superagent_get_conversation" if request.get("archive").is_none() => {
            let id = request
                .get("conversationId")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let cursor = request.get("cursor").and_then(Value::as_u64);
            if let Some(page) = archived_page(sync, &id, cursor).await {
                request["archive"] = serde_json::to_value(page).unwrap_or(Value::Null);
            }
        }
        _ => {}
    }
    args
}

#[cfg(test)]
#[path = "superagent_archive_tests.rs"]
mod tests;

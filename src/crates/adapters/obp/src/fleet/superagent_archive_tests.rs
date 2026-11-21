use super::*;
use crate::fleet::replica::{replica_path, BlobRef, ReplicaAccess, ReplicaSyncConfig};
use crate::fleet::sync::{FleetPeerPresence, FleetPeerSubscription, FleetPeerTransport};
use crate::fleet::{FleetCallError, FleetFuture};
use openbitfun_product_domains::fleet::FleetHostKind;
use openbitfun_product_domains::superagent::archive::ArchiveChunkRef;
use serde_json::json;
use std::sync::{Arc, Mutex};

/// One other device (`peer`) that holds blobs this device lacks.
struct OnePeer {
    peer: Arc<AccountReplica>,
    online: Mutex<bool>,
}

impl FleetPeerTransport for OnePeer {
    fn presence(&self) -> FleetFuture<'_, Vec<FleetPeerPresence>> {
        Box::pin(async move {
            let online = *self.online.lock().unwrap();
            vec![FleetPeerPresence {
                device_id: self.peer.device_id().to_string(),
                host_kind: FleetHostKind::Desktop,
                online,
                mesh: online,
                ..Default::default()
            }]
        })
    }

    fn subscribe_index(
        &self,
        _device_id: &str,
    ) -> FleetFuture<'_, Result<FleetPeerSubscription, String>> {
        Box::pin(async { Err("not used".to_string()) })
    }

    fn call(
        &self,
        _device_id: &str,
        command: &str,
        args: Value,
    ) -> FleetFuture<'_, Result<Value, FleetCallError>> {
        let command = command.to_string();
        Box::pin(async move {
            if !*self.online.lock().unwrap() {
                return Err(FleetCallError::transport("offline"));
            }
            self.peer
                .handle(&command, &args)
                .expect("a replica verb")
                .map_err(FleetCallError::command)
        })
    }
}

fn chunk_bytes(id: &str, from: u64, count: u64) -> Vec<u8> {
    serde_json::to_vec(&ArchiveChunk {
        v: 1,
        conversation_id: id.into(),
        from_seq: from,
        to_seq: from + count,
        messages: (from..from + count)
            .map(
                |seq| json!({ "id": format!("m{seq}"), "role": "user", "text": format!("t{seq}") }),
            )
            .collect(),
        record: ArchiveRecord::default(),
    })
    .unwrap()
}

/// The cloud node's push of one conversation (record plus its chunks) to
/// `replica`, as a restricted pusher.
fn cloud_push(replica: &AccountReplica, id: &str, chunks: &[Vec<u8>], stamp_ms: u64) -> Value {
    use base64::Engine;
    let mut refs = Vec::new();
    let mut from = 0;
    for bytes in chunks {
        let parsed: ArchiveChunk = serde_json::from_slice(bytes).unwrap();
        refs.push(ArchiveChunkRef {
            hash: AccountReplica::blob_hash(bytes),
            from_seq: from,
            to_seq: parsed.to_seq,
            bytes: bytes.len() as u64,
        });
        from = parsed.to_seq;
    }
    let record = ArchiveRecord {
        title: format!("Title {id}"),
        updated_ms: stamp_ms,
        message_count: from,
        chunks: refs.clone(),
        ..ArchiveRecord::default()
    };
    let request = json!({
        "records": [{
            "collection": ARCHIVE_COLLECTION,
            "id": id,
            "value": record,
            "hlc": { "wallMs": stamp_ms, "counter": 0, "deviceId": "cloud-1" },
            "blobs": refs.iter().map(|r| BlobRef { hash: r.hash.clone(), bytes: r.bytes }).collect::<Vec<_>>(),
        }],
        "blobs": chunks.iter().map(|bytes| json!({
            "hash": AccountReplica::blob_hash(bytes),
            "data": base64::engine::general_purpose::STANDARD.encode(bytes),
        })).collect::<Vec<_>>(),
    });
    replica
        .handle_as(
            "fleet_replica_push",
            &json!({ "request": request }),
            &ReplicaAccess::Collections(vec!["superagent.".into()]),
        )
        .unwrap()
        .unwrap()
}

fn opened(dir: &tempfile::TempDir, id: &str) -> Arc<AccountReplica> {
    let replica = AccountReplica::open(id, Some(replica_path(dir.path(), "acct")));
    declare(&replica);
    replica
}

#[tokio::test]
async fn pushed_chunks_are_pinned_and_pages_read_locally_or_from_a_peer() {
    let dirs = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mine = opened(&dirs.0, "desk");
    let peer = opened(&dirs.1, "cli");
    let chunks = vec![chunk_bytes("c1", 0, 150), chunk_bytes("c1", 150, 30)];
    // The cloud node pushes to the peer only; the peer pins every chunk.
    let answer = cloud_push(&peer, "c1", &chunks, 5_000);
    assert_eq!(answer["records"][0]["stored"], true);
    for blob in answer["blobs"].as_array().unwrap() {
        assert_eq!(blob["stored"], true);
        assert_eq!(blob["holders"], json!(["cli"]));
    }
    // This device gets the record by exchange, not the chunks.
    mine.merge(peer.records(ARCHIVE_COLLECTION));
    let transport = Arc::new(OnePeer {
        peer: Arc::clone(&peer),
        online: Mutex::new(true),
    });
    let sync = ReplicaSync::new(
        Arc::clone(&mine),
        transport.clone(),
        ReplicaSyncConfig::default(),
    );
    let rows = archived_summaries(&mine, 10);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].message_count, 180);
    // The newest page spans both chunks, fetched from the peer.
    let page = archived_page(&sync, "c1", None).await.unwrap();
    assert_eq!(page.from_seq, 80);
    assert_eq!(page.messages.len(), 100);
    assert_eq!(page.messages[0]["id"], "m80");
    assert_eq!(page.messages[99]["id"], "m179");
    // An older page with the peer offline: what this device cached.
    *transport.online.lock().unwrap() = false;
    let older = archived_page(&sync, "c1", Some(80)).await.unwrap();
    assert_eq!(older.messages.len(), 80);
    assert_eq!(older.messages[0]["id"], "m0");
    // The frontend's list call leaves with the archived rows.
    let args = json!({ "request": { "target": "cloud-1", "command": "superagent_list_conversations", "args": { "request": { "limit": 5 } } } });
    let augmented = augment_fleet_call(&sync, args).await;
    assert_eq!(
        augmented["request"]["args"]["request"]["archived"][0]["id"],
        "c1"
    );
    assert_eq!(augmented["request"]["args"]["request"]["limit"], 5);
    // Other calls pass unchanged.
    let other = json!({ "request": { "command": "superagent_send", "args": { "request": {} } } });
    assert_eq!(augment_fleet_call(&sync, other.clone()).await, other);
}

#[test]
fn a_restricted_pusher_reaches_only_superagent_collections() {
    let dir = tempfile::tempdir().unwrap();
    let replica = opened(&dir, "desk");
    replica.put("settings", "theme", json!("dark")).unwrap();
    let cloud = ReplicaAccess::Collections(vec!["superagent.".into()]);
    let push = json!({ "request": { "records": [{
        "collection": "settings", "id": "theme", "value": "light",
        "hlc": { "wallMs": u64::MAX / 2, "deviceId": "cloud-1" }
    }] } });
    assert!(replica
        .handle_as("fleet_replica_push", &push, &cloud)
        .unwrap()
        .is_err());
    assert_eq!(
        replica.get("settings", "theme").unwrap().value,
        Some(json!("dark"))
    );
    assert!(replica
        .handle_as("fleet_replica_pull", &json!({}), &cloud)
        .unwrap()
        .is_err());
    assert!(replica
        .handle_as(
            "fleet_replica_list",
            &json!({ "request": { "collection": "settings" } }),
            &cloud
        )
        .unwrap()
        .is_err());
    assert!(replica
        .handle_as(
            "fleet_replica_list",
            &json!({ "request": { "collection": ARCHIVE_COLLECTION } }),
            &cloud
        )
        .unwrap()
        .is_ok());
}

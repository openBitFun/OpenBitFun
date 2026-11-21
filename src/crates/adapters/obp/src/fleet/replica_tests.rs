use super::*;
use crate::fleet::sync::{FleetPeerPresence, FleetPeerSubscription};
use crate::fleet::FleetFuture;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};

/// The account's devices on one loopback "network": each device's calls go
/// to the other replicas' verbs; a device can be taken offline.
#[derive(Default)]
struct Network {
    replicas: Mutex<HashMap<String, Arc<AccountReplica>>>,
    offline: Mutex<BTreeSet<String>>,
    /// Devices that predate the replica (they refuse the verbs).
    old: Mutex<BTreeSet<String>>,
    dirs: Mutex<Vec<tempfile::TempDir>>,
}

impl Network {
    fn add(&self, replica: &Arc<AccountReplica>) {
        self.replicas
            .lock()
            .unwrap()
            .insert(replica.device_id().to_string(), Arc::clone(replica));
    }

    fn set_offline(&self, device: &str, offline: bool) {
        let mut set = self.offline.lock().unwrap();
        if offline {
            set.insert(device.into());
        } else {
            set.remove(device);
        }
    }

    fn is_offline(&self, device: &str) -> bool {
        self.offline.lock().unwrap().contains(device)
    }
}

struct Transport {
    me: String,
    network: Arc<Network>,
    stopped: AtomicBool,
}

impl FleetPeerTransport for Transport {
    fn presence(&self) -> FleetFuture<'_, Vec<FleetPeerPresence>> {
        Box::pin(async move {
            let me_offline = self.network.is_offline(&self.me);
            let replicas = self.network.replicas.lock().unwrap().clone();
            let mut peers: Vec<FleetPeerPresence> = replicas
                .keys()
                .filter(|id| **id != self.me)
                .map(|id| {
                    let online = !me_offline && !self.network.is_offline(id);
                    FleetPeerPresence {
                        device_id: id.clone(),
                        name: id.clone(),
                        host_kind: FleetHostKind::Desktop,
                        online,
                        // An offline device's route is unknown.
                        mesh: online,
                        ..Default::default()
                    }
                })
                .collect();
            // The cloud node is listed too, and never exchanged with.
            peers.push(FleetPeerPresence {
                device_id: "cloud-abc".into(),
                host_kind: FleetHostKind::Cloud,
                online: true,
                mesh: true,
                ..Default::default()
            });
            peers
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
        device_id: &str,
        command: &str,
        args: Value,
    ) -> FleetFuture<'_, Result<Value, FleetCallError>> {
        let device_id = device_id.to_string();
        let command = command.to_string();
        Box::pin(async move {
            assert!(!self.stopped.load(Ordering::SeqCst));
            assert!(
                !device_id.starts_with("cloud-"),
                "the cloud node is never asked"
            );
            if self.network.is_offline(&self.me) || self.network.is_offline(&device_id) {
                return Err(FleetCallError::transport("offline"));
            }
            if self.network.old.lock().unwrap().contains(&device_id) {
                return Err(FleetCallError {
                    code: -32003,
                    message: format!("command '{command}' is not allowed"),
                    data: Some(json!({ "kind": "forbidden" })),
                });
            }
            let target = self
                .network
                .replicas
                .lock()
                .unwrap()
                .get(&device_id)
                .cloned();
            let target = target.ok_or_else(|| FleetCallError::transport("no such device"))?;
            target
                .handle(&command, &args)
                .expect("a replica verb")
                .map_err(FleetCallError::command)
        })
    }
}

fn device(network: &Arc<Network>, id: &str) -> (Arc<AccountReplica>, Arc<ReplicaSync>) {
    let dir = tempfile::tempdir().unwrap();
    let replica = AccountReplica::open(id, Some(replica_path(dir.path(), "acct")));
    network.dirs.lock().unwrap().push(dir);
    network.add(&replica);
    let sync = ReplicaSync::new(
        Arc::clone(&replica),
        Arc::new(Transport {
            me: id.into(),
            network: Arc::clone(network),
            stopped: AtomicBool::new(false),
        }),
        ReplicaSyncConfig::default(),
    );
    (replica, sync)
}

fn value(replica: &AccountReplica, id: &str) -> Option<Value> {
    replica.get("settings", id).and_then(|record| record.value)
}

#[test]
fn clocks_order_by_wall_time_then_counter_then_device() {
    let a = Hlc {
        wall_ms: 5,
        counter: 0,
        device_id: "b".into(),
    };
    let b = Hlc {
        wall_ms: 5,
        counter: 1,
        device_id: "a".into(),
    };
    let c = Hlc {
        wall_ms: 6,
        counter: 0,
        device_id: "a".into(),
    };
    assert!(a < b && b < c);
    assert!(
        Hlc {
            device_id: "a".into(),
            ..a.clone()
        } < a
    );
    assert!(a.stamp() < b.stamp() && b.stamp() < c.stamp());
    assert!(Hlc::seed("z") < a);

    // Local writes always move the clock forward, even within one millisecond.
    let replica = AccountReplica::open("d1", None);
    let first = replica.put("settings", "k", json!(1)).unwrap().unwrap().hlc;
    let second = replica.put("settings", "k", json!(2)).unwrap().unwrap().hlc;
    assert!(second > first);
    // An unchanged value is not a write.
    assert!(replica.put("settings", "k", json!(2)).unwrap().is_none());
}

#[test]
fn the_later_clock_wins_on_every_device() {
    let a = AccountReplica::open("a", None);
    let b = AccountReplica::open("b", None);
    let early = a.put("settings", "theme", json!("dark")).unwrap().unwrap();
    std::thread::sleep(Duration::from_millis(3));
    let late = b.put("settings", "theme", json!("light")).unwrap().unwrap();
    assert!(late.hlc > early.hlc);
    // Each side merges the other's record, in either order.
    assert_eq!(a.merge(vec![late.clone()]).len(), 1);
    assert!(b.merge(vec![early.clone()]).is_empty());
    assert_eq!(value(&a, "theme"), Some(json!("light")));
    assert_eq!(value(&b, "theme"), Some(json!("light")));
    assert_eq!(a.digest(), b.digest());
    // Merging again changes nothing.
    assert!(a.merge(b.snapshot()).is_empty());
    // A device that saw a later clock writes after it.
    let next = a.put("settings", "theme", json!("slate")).unwrap().unwrap();
    assert!(next.hlc > late.hlc);
}

#[test]
fn a_seed_fills_a_gap_and_loses_to_any_real_write() {
    let a = AccountReplica::open("a", None);
    let b = AccountReplica::open("zz-new-device", None);
    a.put("settings", "language", json!("zh-TW")).unwrap();
    // The new device offers its value; the account's real write wins.
    b.seed("settings", "language", json!("en-US")).unwrap();
    b.merge(a.snapshot());
    assert_eq!(value(&b, "language"), Some(json!("zh-TW")));
    // A seed never replaces a record that exists.
    assert!(b
        .seed("settings", "language", json!("fr"))
        .unwrap()
        .is_none());
    // A gap is filled by a seed and travels.
    b.seed(
        "settings",
        "font",
        json!({ "uiSize": { "level": "large" } }),
    )
    .unwrap();
    a.merge(b.snapshot());
    assert_eq!(
        value(&a, "font"),
        Some(json!({ "uiSize": { "level": "large" } }))
    );
}

#[test]
fn tombstones_travel_and_expire() {
    let a = AccountReplica::open("a", None);
    let b = AccountReplica::open("b", None);
    a.put("notes", "n1", json!("x")).unwrap();
    b.merge(a.snapshot());
    std::thread::sleep(Duration::from_millis(2));
    a.delete("notes", "n1").unwrap();
    b.merge(a.snapshot());
    assert!(b.get("notes", "n1").unwrap().is_tombstone());
    // An expired tombstone is purged and never merged back in.
    let mut old = b.get("notes", "n1").unwrap();
    old.hlc.wall_ms = 1;
    let c = AccountReplica::open("c", None);
    assert!(c.merge(vec![old]).is_empty());
    {
        let mut inner = b.lock();
        let record = inner
            .records
            .get_mut(&("notes".into(), "n1".into()))
            .unwrap();
        record.hlc.wall_ms = 1;
    }
    assert_eq!(b.purge_tombstones(), 1);
    assert!(b.get("notes", "n1").is_none());
}

#[test]
fn each_collection_has_its_own_budget() {
    let replica = AccountReplica::open("a", None);
    let big = "x".repeat(SETTINGS_COLLECTION_POLICY.max_value_bytes + 1);
    assert!(matches!(
        replica.put("settings", "k", json!(big)),
        Err(ReplicaError::ValueTooLarge(_))
    ));
    assert_eq!(
        replica.put("Bad Key", "k", json!(1)),
        Err(ReplicaError::InvalidKey)
    );
    // A collection with a small declared budget fills up ...
    replica.declare(CollectionPolicy {
        name: "notes",
        max_records: 3,
        max_bytes: 64 * 1024,
        max_value_bytes: 1024,
        durable_holders: 0,
    });
    for index in 0..3 {
        replica
            .put("notes", &format!("n{index}"), json!(index))
            .unwrap();
    }
    assert_eq!(
        replica.put("notes", "n3", json!(3)),
        Err(ReplicaError::Full("notes".into()))
    );
    // ... without starving settings, and a large one holds more.
    replica.put("settings", "theme", json!("dark")).unwrap();
    replica.declare(CollectionPolicy {
        name: "superagent.",
        max_records: 10_000,
        max_bytes: 8 * 1024 * 1024,
        max_value_bytes: 4096,
        durable_holders: 2,
    });
    assert_eq!(
        replica.policy("superagent.conversations").max_records,
        10_000
    );
    assert_eq!(
        replica.policy("superagent.conversations").durable_holders,
        2
    );
    for index in 0..400 {
        replica
            .put(
                "superagent.conversations",
                &format!("c{index}"),
                json!({ "title": index }),
            )
            .unwrap();
    }
    // An undeclared collection (from a newer build) gets the default budget.
    assert_eq!(replica.policy("future.thing"), DEFAULT_COLLECTION_POLICY);
    let other = AccountReplica::open("b", None);
    for index in 0..(DEFAULT_COLLECTION_POLICY.max_records + 1) {
        let _ = other.put("future.thing", &format!("f{index}"), json!(index));
    }
    assert_eq!(
        other.records("future.thing").len(),
        DEFAULT_COLLECTION_POLICY.max_records
    );
    // A merge over a budget is skipped, not stored.
    let late = AccountReplica::open("c", None);
    late.put("notes", "late", json!("x")).unwrap();
    assert!(replica.merge(late.snapshot()).is_empty());
}

#[test]
fn the_file_round_trips_and_an_old_or_foreign_file_is_tolerated() {
    let dir = tempfile::tempdir().unwrap();
    let path = replica_path(dir.path(), "email-1");
    let replica = AccountReplica::open("a", Some(path.clone()));
    replica.put("settings", "theme", json!("dark")).unwrap();
    let digest = replica.digest();
    drop(replica);
    let reopened = AccountReplica::open("a", Some(path.clone()));
    assert_eq!(reopened.digest(), digest);
    assert_eq!(
        reopened.undelivered().len(),
        1,
        "the undelivered mark survives a restart"
    );
    // Another account has another file.
    assert_ne!(replica_path(dir.path(), "email-2"), path);
    // A file of another device is not trusted as this one's.
    assert!(AccountReplica::open("b", Some(path.clone()))
        .snapshot()
        .is_empty());
    // An older file without the newer fields reads.
    std::fs::write(&path, br#"{"deviceId":"a","records":[{"collection":"settings","id":"x","value":1,"hlc":{"wallMs":5}}]}"#).unwrap();
    assert_eq!(
        value(&AccountReplica::open("a", Some(path.clone())), "x"),
        Some(json!(1))
    );
    // A damaged one is set aside.
    std::fs::write(&path, b"{nope").unwrap();
    assert!(AccountReplica::open("a", Some(path.clone()))
        .snapshot()
        .is_empty());
    assert!(path.with_extension("json.unreadable").exists());
}

#[test]
fn blobs_are_addressed_by_their_hash() {
    let dir = tempfile::tempdir().unwrap();
    let replica = AccountReplica::open("a", Some(replica_path(dir.path(), "acct")));
    let hash = replica.put_blob(b"hello", false).unwrap();
    assert_eq!(hash, AccountReplica::blob_hash(b"hello"));
    assert_eq!(replica.blob(&hash), Some(b"hello".to_vec()));
    assert!(replica.blob("../../etc/passwd").is_none());
    let answer = replica
        .handle("fleet_blob_get", &json!({ "request": { "hash": hash } }))
        .unwrap()
        .unwrap();
    assert_eq!(answer["data"], "aGVsbG8=");
    assert!(replica
        .handle("fleet_blob_get", &json!({ "request": { "hash": "00" } }))
        .unwrap()
        .is_err());
    assert!(matches!(
        replica.put_blob(&vec![0u8; MAX_BLOB_BYTES + 1], false),
        Err(ReplicaError::BlobTooLarge(_))
    ));
    assert_eq!(
        replica.put_blob_checked(&hash, b"other", false),
        Err(ReplicaError::BlobMismatch)
    );
    // An unpinned blob is a cache entry: over the budget the oldest goes.
    replica.set_blob_cache_bytes(8);
    let second = replica.put_blob(b"hello again", false).unwrap();
    assert!(!replica.has_blob(&hash) || !replica.has_blob(&second));
}

fn history_policy() -> CollectionPolicy {
    CollectionPolicy {
        name: "superagent.",
        max_records: 10_000,
        max_bytes: 8 * 1024 * 1024,
        max_value_bytes: 4096,
        durable_holders: 2,
    }
}

fn chunk(text: &str) -> (Vec<u8>, BlobRef) {
    let bytes = text.as_bytes().to_vec();
    let blob = BlobRef {
        hash: AccountReplica::blob_hash(&bytes),
        bytes: bytes.len() as u64,
    };
    (bytes, blob)
}

#[test]
fn a_restricted_pusher_writes_its_collections_and_learns_the_holders() {
    use base64::Engine;
    let dir = tempfile::tempdir().unwrap();
    let device = AccountReplica::open("desk", Some(replica_path(dir.path(), "acct")));
    device.declare(history_policy());
    let cloud = ReplicaAccess::Collections(vec!["superagent.".into()]);
    let (bytes, blob) = chunk("[{\"role\":\"user\",\"text\":\"hi\"}]");
    let record = ReplicaRecord {
        collection: "superagent.conversations".into(),
        id: "conv-1".into(),
        value: Some(json!({ "title": "Hi", "chunks": [blob.hash] })),
        hlc: Hlc {
            wall_ms: now_ms(),
            counter: 0,
            device_id: "cloud-abc".into(),
        },
        blobs: vec![blob.clone()],
    };
    let push = json!({ "request": {
        "records": [record],
        "blobs": [{ "hash": blob.hash, "data": base64::engine::general_purpose::STANDARD.encode(&bytes) }],
    }});
    let answer = device
        .handle_as("fleet_replica_push", &push, &cloud)
        .unwrap()
        .unwrap();
    assert_eq!(answer["records"][0]["stored"], true);
    assert_eq!(answer["blobs"][0]["stored"], true);
    // The device pins a chunk a durable collection names, and says so.
    assert_eq!(answer["blobs"][0]["holders"], json!(["desk"]));
    assert!(device.is_pinned(&blob.hash));
    // Pushing it again is acknowledged without a new write.
    let again = device
        .handle_as("fleet_replica_push", &push, &cloud)
        .unwrap()
        .unwrap();
    assert_eq!(again["accepted"], 0);
    assert_eq!(again["records"][0]["stored"], true);

    // List and holder counts let the pusher see what is there.
    let listed = device
        .handle_as(
            "fleet_replica_list",
            &json!({ "request": { "collection": "superagent.conversations" } }),
            &cloud,
        )
        .unwrap()
        .unwrap();
    assert_eq!(listed["records"][0]["id"], "conv-1");
    assert!(
        listed["records"][0].get("value").is_none(),
        "a pusher reads no values"
    );
    let stamp = listed["records"][0]["stamp"].as_str().unwrap().to_string();
    let after = device
        .handle_as("fleet_replica_list", &json!({ "request": { "collection": "superagent.conversations", "sinceStamp": stamp } }), &cloud)
        .unwrap()
        .unwrap();
    assert_eq!(after["records"], json!([]));
    let holders = device
        .handle_as(
            "fleet_blob_holders",
            &json!({ "request": { "hashes": [blob.hash] } }),
            &cloud,
        )
        .unwrap()
        .unwrap();
    assert_eq!(holders["holders"][&blob.hash], json!(["desk"]));
    assert!(device
        .handle_as(
            "fleet_blob_get",
            &json!({ "request": { "hash": blob.hash } }),
            &cloud
        )
        .unwrap()
        .is_ok());

    // Outside its collections, and the full replica, it is refused.
    let settings = ReplicaRecord {
        collection: "settings".into(),
        id: "app.language".into(),
        value: Some(json!("en-US")),
        hlc: Hlc {
            wall_ms: now_ms(),
            counter: 0,
            device_id: "cloud-abc".into(),
        },
        blobs: Vec::new(),
    };
    assert!(device
        .handle_as(
            "fleet_replica_push",
            &json!({ "request": { "records": [settings] } }),
            &cloud
        )
        .unwrap()
        .is_err());
    for verb in ["fleet_replica_pull", "fleet_replica_digest"] {
        assert!(
            device.handle_as(verb, &json!({}), &cloud).unwrap().is_err(),
            "{verb}"
        );
    }
    assert!(device
        .handle_as(
            "fleet_replica_list",
            &json!({ "request": { "collection": "settings" } }),
            &cloud
        )
        .unwrap()
        .is_err());
    // A blob no allowed record names is not taken from it.
    let (stray, stray_ref) = chunk("stray");
    let answer = device
        .handle_as(
            "fleet_replica_push",
            &json!({ "request": { "blobs": [{ "hash": stray_ref.hash, "data": base64::engine::general_purpose::STANDARD.encode(&stray) }] } }),
            &cloud,
        )
        .unwrap()
        .unwrap();
    assert_eq!(answer["blobs"][0]["stored"], false);
}

#[test]
fn a_pinned_chunk_is_dropped_only_while_enough_others_hold_it() {
    let dir = tempfile::tempdir().unwrap();
    let a = AccountReplica::open("a", Some(replica_path(dir.path(), "acct-a")));
    a.declare(history_policy());
    let (bytes, blob) = chunk("turns");
    a.put_blob(&bytes, true).unwrap();
    a.put_with_blobs(
        "superagent.conversations",
        "c1",
        json!({}),
        vec![blob.clone()],
    )
    .unwrap();
    assert_eq!(a.holders(&blob.hash), vec!["a".to_string()]);
    assert!(!a.evict_blob(&blob.hash), "the only holder keeps it");
    // Two other holders confirmed it: now this one may let it go.
    for device in ["b", "c"] {
        let other = AccountReplica::open(device, None);
        other.merge(a.snapshot());
        other
            .put(
                HOLDERS_COLLECTION,
                &format!("{}@{device}", blob.hash),
                json!({}),
            )
            .unwrap();
        a.merge(other.snapshot());
    }
    assert!(a.evict_blob(&blob.hash));
    assert!(!a.has_blob(&blob.hash));
    assert!(a
        .get(HOLDERS_COLLECTION, &format!("{}@a", blob.hash))
        .unwrap()
        .is_tombstone());
    // A blob no live record names is unpinned by the cache trim.
    let (loose, _) = chunk("loose");
    let hash = a.put_blob(&loose, true).unwrap();
    a.trim_cache();
    assert!(!a.is_pinned(&hash));
}

#[tokio::test]
async fn two_devices_merge_over_the_verbs() {
    let network = Arc::new(Network::default());
    let (a, sync_a) = device(&network, "a");
    let (b, sync_b) = device(&network, "b");
    a.put("settings", "theme", json!("dark")).unwrap();
    b.put("settings", "language", json!("zh-TW")).unwrap();
    sync_a.pass().await;
    assert_eq!(a.digest(), b.digest());
    assert_eq!(value(&b, "theme"), Some(json!("dark")));
    assert_eq!(value(&a, "language"), Some(json!("zh-TW")));
    assert!(a.undelivered().is_empty());
    assert_eq!(b.undelivered().len(), 1, "b has not exchanged yet");
    sync_b.pass().await;
    assert!(
        b.undelivered().is_empty(),
        "equal digests acknowledge b's write"
    );
    let status = a.status();
    assert_eq!(
        (status.peers, status.peers_online),
        (1, 1),
        "the cloud node is not a peer"
    );
}

#[tokio::test]
async fn offline_edits_merge_on_reconnect_and_the_later_one_wins() {
    let network = Arc::new(Network::default());
    let (a, sync_a) = device(&network, "a");
    let (b, sync_b) = device(&network, "b");
    a.put("settings", "font", json!("default")).unwrap();
    sync_a.pass().await;

    network.set_offline("a", true);
    a.put("settings", "font", json!("compact")).unwrap();
    a.put("settings", "language", json!("en-US")).unwrap();
    sync_a.pass().await;
    assert_eq!(a.undelivered().len(), 2, "queued while offline");
    assert_eq!(a.status().peers_online, 0);
    assert_eq!(
        a.status().peers,
        1,
        "an offline device still counts as a peer"
    );
    std::thread::sleep(Duration::from_millis(3));
    // Meanwhile the other device changes the font later.
    b.put("settings", "font", json!("large")).unwrap();
    sync_b.pass().await;

    network.set_offline("a", false);
    sync_a.pass().await;
    assert!(a.undelivered().is_empty());
    for replica in [&a, &b] {
        assert_eq!(
            value(replica, "font"),
            Some(json!("large")),
            "the later write wins"
        );
        assert_eq!(
            value(replica, "language"),
            Some(json!("en-US")),
            "the offline edit arrives"
        );
    }
    assert_eq!(a.digest(), b.digest());
}

#[tokio::test]
async fn a_new_device_bootstraps_from_any_peer_and_skips_old_ones() {
    let network = Arc::new(Network::default());
    let (a, sync_a) = device(&network, "a");
    let (_old, _) = device(&network, "old");
    network.old.lock().unwrap().insert("old".into());
    a.put("settings", "theme", json!("midnight")).unwrap();
    sync_a.pass().await;

    // The new device has only its own offer; the account's write wins.
    let (c, sync_c) = device(&network, "c");
    c.seed("settings", "theme", json!("system")).unwrap();
    sync_c.pass().await;
    assert_eq!(value(&c, "theme"), Some(json!("midnight")));
    // The device without the replica is skipped from then on.
    assert_eq!(c.status().peers, 1);

    // With no peer online a new device keeps its own values.
    let (d, sync_d) = device(&network, "d");
    network.set_offline("d", true);
    d.seed("settings", "theme", json!("light")).unwrap();
    sync_d.pass().await;
    assert_eq!(value(&d, "theme"), Some(json!("light")));
    network.set_offline("d", false);
    sync_d.pass().await;
    assert_eq!(value(&d, "theme"), Some(json!("midnight")));
}

#[tokio::test]
async fn the_loop_pushes_a_local_write_at_once() {
    let network = Arc::new(Network::default());
    let (a, sync_a) = device(&network, "a");
    let (b, _sync_b) = device(&network, "b");
    sync_a.start();
    tokio::time::sleep(Duration::from_millis(50)).await;
    a.put("settings", "theme", json!("cyber")).unwrap();
    let started = std::time::Instant::now();
    while value(&b, "theme") != Some(json!("cyber")) {
        assert!(started.elapsed() < Duration::from_secs(5), "not pushed");
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    sync_a.shutdown();
}

#[test]
fn between_offers_the_earlier_one_wins() {
    let early = Hlc {
        wall_ms: 0,
        counter: u32::MAX - 100,
        device_id: "zz".into(),
    };
    let late = Hlc {
        wall_ms: 0,
        counter: u32::MAX - 200,
        device_id: "aa".into(),
    };
    assert!(early > late && early.is_seed());
    let first = AccountReplica::open("first", None);
    first.seed("settings", "language", json!("zh-TW")).unwrap();
    let joined = AccountReplica::open("joined", None);
    std::thread::sleep(Duration::from_millis(1100));
    joined.seed("settings", "language", json!("en-US")).unwrap();
    joined.merge(first.snapshot());
    first.merge(joined.snapshot());
    assert_eq!(value(&joined, "language"), Some(json!("zh-TW")));
    assert_eq!(value(&first, "language"), Some(json!("zh-TW")));
}

#[tokio::test]
async fn every_chunk_gets_two_holders_and_a_device_fetches_on_demand() {
    let network = Arc::new(Network::default());
    let (a, sync_a) = device(&network, "a");
    let (b, sync_b) = device(&network, "b");
    let (c, sync_c) = device(&network, "c");
    for replica in [&a, &b, &c] {
        replica.declare(history_policy());
    }
    // The cloud node pushed a conversation and its chunk to one device.
    let (bytes, blob) = chunk("[\"turn 1\", \"turn 2\"]");
    a.put_blob(&bytes, true).unwrap();
    a.put_with_blobs(
        "superagent.conversations",
        "c1",
        json!({ "title": "t" }),
        vec![blob.clone()],
    )
    .unwrap();
    sync_a.pass().await;
    // Records reach every device; the chunk itself only where needed.
    assert!(b.get("superagent.conversations", "c1").is_some());
    sync_b.pass().await;
    sync_c.pass().await;
    // Every device learns the holders at its next exchange.
    sync_a.pass().await;
    for replica in [&a, &b, &c] {
        let holders = replica.holders(&blob.hash);
        assert!(holders.len() >= 2, "{}: {holders:?}", replica.device_id());
    }
    // A device without the chunk reads it from a holder when it needs it.
    let readers: Vec<_> = [(&b, &sync_b), (&c, &sync_c)]
        .into_iter()
        .filter(|(replica, _)| !replica.has_blob(&blob.hash))
        .collect();
    for (replica, sync) in readers {
        assert_eq!(
            sync.fetch_blob(&blob.hash, false).await,
            Some(bytes.clone())
        );
        assert!(replica.has_blob(&blob.hash));
        assert!(
            !replica.is_pinned(&blob.hash),
            "a read caches; it does not pin"
        );
    }
    // With a single device, one holder is enough.
    let lone_network = Arc::new(Network::default());
    let (solo, solo_sync) = device(&lone_network, "solo");
    solo.declare(history_policy());
    let (bytes, blob) = chunk("solo turns");
    solo.put_blob(&bytes, true).unwrap();
    solo.put_with_blobs(
        "superagent.conversations",
        "c1",
        json!({}),
        vec![blob.clone()],
    )
    .unwrap();
    assert_eq!(solo_sync.maintain_blobs(1).await, 0);
    assert_eq!(solo.holders(&blob.hash).len(), 1);
}

// ── Account-record collections (`fleet::account_port`) ──────────────────

mod account_collections {
    use super::*;
    use crate::fleet::account_port::ReplicaRecordPort;
    use openbitfun_product_domains::fleet::account_records::{
        secret_ref, AccountBlobRef, AccountRecordError, AccountRecordPort, ACCOUNT_COLLECTIONS,
    };

    fn port(replica: &Arc<AccountReplica>, sync: Option<Arc<ReplicaSync>>) -> ReplicaRecordPort {
        ReplicaRecordPort::new("acct", Arc::clone(replica), Arc::new(move || sync.clone()))
    }

    #[test]
    fn every_account_collection_refuses_secrets_on_write_and_on_merge() {
        let replica = AccountReplica::open("a", None);
        let port = port(&replica, None);
        let other = AccountReplica::open("b", None);
        other.declare_account_collections();
        for budget in ACCOUNT_COLLECTIONS {
            let collection = budget.name;
            for secret in [
                json!({ "apiKey": "sk-live-not-allowed" }),
                json!({ "config": { "bot_token": "123" } }),
                json!({ "env": { "GITHUB_TOKEN": "plain" } }),
                json!({ "headers": { "Authorization": "Bearer abcdefghijklmnopqrstuvwxyz" } }),
                json!({ "note": "ghp_abcdefghijklmnopqrstuvwxyz0123456789" }),
            ] {
                assert!(
                    matches!(
                        port.put(collection, "r1", secret.clone(), &[], false),
                        Err(AccountRecordError::Secret(_))
                    ),
                    "{collection}: {secret}"
                );
                assert!(
                    matches!(
                        port.put(collection, "r1", secret.clone(), &[], true),
                        Err(AccountRecordError::Secret(_))
                    ),
                    "{collection} offer: {secret}"
                );
            }
            assert!(port.records(collection).is_empty(), "{collection}");
            // Placeholders are what a synced record carries instead.
            port.put(
                collection,
                "r1",
                json!({ "env": { "GITHUB_TOKEN": secret_ref("mcp:gh:env:GITHUB_TOKEN") }, "apiKey": "" }),
                &[],
                false,
            )
            .unwrap();
            // A peer (a faulty or older build) cannot slip one in either.
            let rogue = ReplicaRecord {
                collection: collection.into(),
                id: "rogue".into(),
                value: Some(json!({ "password": "hunter2" })),
                hlc: Hlc {
                    wall_ms: now_ms(),
                    counter: 0,
                    device_id: "b".into(),
                },
                blobs: Vec::new(),
            };
            assert!(replica.merge(vec![rogue]).is_empty(), "{collection}");
            assert!(replica.get(collection, "rogue").is_none(), "{collection}");
        }
        // Settings are guarded the same way.
        assert!(matches!(
            replica.put("settings", "app.language", json!({ "token": "x" })),
            Err(ReplicaError::SecretField(_))
        ));
        assert!(other.merge(replica.snapshot()).len() == ACCOUNT_COLLECTIONS.len());
    }

    #[test]
    fn every_account_collection_keeps_its_declared_budget() {
        let replica = AccountReplica::open("a", None);
        let port = port(&replica, None);
        for budget in ACCOUNT_COLLECTIONS {
            let collection = budget.name;
            assert_eq!(replica.policy(collection).max_records, budget.max_records);
            for index in 0..budget.max_records {
                port.put(
                    collection,
                    &format!("r{index}"),
                    json!({ "i": index }),
                    &[],
                    false,
                )
                .unwrap_or_else(|error| panic!("{collection} #{index}: {error}"));
            }
            // Over the budget: refused, never dropped silently.
            assert!(
                matches!(
                    port.put(collection, "one-more", json!({}), &[], false),
                    Err(AccountRecordError::Budget(_))
                ),
                "{collection}"
            );
            // A value over the per-value limit is refused too.
            let big = "x".repeat(budget.max_value_bytes + 1);
            assert!(
                matches!(
                    port.put(collection, "r0", json!({ "text": big }), &[], false),
                    Err(AccountRecordError::Budget(_))
                ),
                "{collection}"
            );
            assert_eq!(port.records(collection).len(), budget.max_records);
        }
        // Account records never starve the settings.
        replica
            .put("settings", "app.language", json!("en-US"))
            .unwrap();
    }

    #[tokio::test]
    async fn account_records_converge_and_the_later_write_wins() {
        let network = Arc::new(Network::default());
        let (a, sync_a) = device(&network, "a");
        let (b, sync_b) = device(&network, "b");
        let port_a = port(&a, Some(Arc::clone(&sync_a)));
        let port_b = port(&b, Some(Arc::clone(&sync_b)));
        for budget in ACCOUNT_COLLECTIONS {
            port_a
                .put(budget.name, "shared", json!({ "by": "a" }), &[], false)
                .unwrap();
        }
        sync_a.pass().await;
        // Both edit offline; b's edit is the later one.
        network.set_offline("a", true);
        for budget in ACCOUNT_COLLECTIONS {
            port_a
                .put(budget.name, "shared", json!({ "by": "a2" }), &[], false)
                .unwrap();
        }
        std::thread::sleep(Duration::from_millis(3));
        for budget in ACCOUNT_COLLECTIONS {
            port_b
                .put(budget.name, "shared", json!({ "by": "b2" }), &[], false)
                .unwrap();
        }
        network.set_offline("a", false);
        sync_a.pass().await;
        sync_b.pass().await;
        assert_eq!(a.digest(), b.digest());
        for budget in ACCOUNT_COLLECTIONS {
            for port in [&port_a, &port_b] {
                let records = port.records(budget.name);
                assert_eq!(records.len(), 1);
                assert_eq!(
                    records[0].value,
                    Some(json!({ "by": "b2" })),
                    "{}",
                    budget.name
                );
            }
        }
    }

    #[tokio::test]
    async fn content_blobs_reach_another_device_on_demand() {
        let network = Arc::new(Network::default());
        let (a, sync_a) = device(&network, "a");
        let (b, sync_b) = device(&network, "b");
        let port_a = port(&a, Some(Arc::clone(&sync_a)));
        let port_b = port(&b, Some(Arc::clone(&sync_b)));
        let content = b"# Persona\nCalm and precise.\n".to_vec();
        let hash = port_a.put_blob(&content, true).unwrap();
        port_a
            .put(
                "assistants.personas",
                "default",
                json!({ "files": [{ "path": "SOUL.md", "chunks": [hash] }] }),
                &[AccountBlobRef {
                    hash: hash.clone(),
                    bytes: content.len() as u64,
                }],
                false,
            )
            .unwrap();
        sync_a.pass().await;
        assert_eq!(
            port_b.records("assistants.personas")[0].blobs,
            vec![hash.clone()]
        );
        assert_eq!(port_b.fetch_blob(&hash, true).await, Some(content));
        assert!(b.is_pinned(&hash));
    }
}

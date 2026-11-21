//! Super Agent history on the account's devices (A2/A3 of the server-state
//! audit): the cloud node seals finished turns into chunks, pushes them with
//! its conversation records to fake runtime devices that keep a real account
//! replica (restricted to the `superagent.` collections, as a device grants
//! the cloud agent), and drops its copy once enough devices hold them. The
//! clock is manual, so every time to live is driven here.

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use openbitfun_obp::fleet::replica::{replica_path, AccountReplica, ReplicaAccess};
use openbitfun_obp::fleet::superagent_archive;
use openbitfun_product_domains::fleet::FleetHostKind;
use openbitfun_product_domains::superagent::archive::{
    ArchiveRecord, ArchivedSummary, ARCHIVE_COLLECTION,
};
use openbitfun_product_domains::superagent::RuntimeFacts;
use openbitfun_superagent::api::Service;
use openbitfun_superagent::archive::{self, OUTBOX_MAX_BYTES};
use openbitfun_superagent::conversation::{Conversation, Message, Role, WINDOW_TURNS};
use openbitfun_superagent::device::{BoxFuture, DeviceRpc, DeviceSnapshot, RpcError};
use openbitfun_superagent::directory::{Directory, DirectoryDevice, DirectoryError};
use openbitfun_superagent::engine::{Clock, Engine, EngineConfig};
use openbitfun_superagent::model::RelayModel;
use openbitfun_superagent::slots::{SlotLimits, Slots};
use openbitfun_superagent::store::Store;
use serde_json::{json, Value};

const ACCOUNT: &str = "email-scratch-archive";
const DAY: u64 = 24 * 3600 * 1000;
const MASTER: [u8; 32] = [7u8; 32];

struct FakeDevice {
    replica: Arc<AccountReplica>,
    online: bool,
    /// A build that keeps Super Agent history (`superagent_archive_v1`).
    archive: bool,
}

#[derive(Default)]
struct Devices {
    devices: Mutex<BTreeMap<String, FakeDevice>>,
    dirs: Mutex<Vec<tempfile::TempDir>>,
    pushes: Mutex<Vec<String>>,
}

impl Devices {
    fn add(&self, id: &str, online: bool, archive: bool) -> Arc<AccountReplica> {
        let dir = tempfile::tempdir().unwrap();
        let replica = AccountReplica::open(id, Some(replica_path(dir.path(), ACCOUNT)));
        if archive {
            superagent_archive::declare(&replica);
        }
        self.dirs.lock().unwrap().push(dir);
        self.devices.lock().unwrap().insert(
            id.to_string(),
            FakeDevice {
                replica: Arc::clone(&replica),
                online,
                archive,
            },
        );
        replica
    }

    fn set_online(&self, id: &str, online: bool) {
        self.devices.lock().unwrap().get_mut(id).unwrap().online = online;
    }

    fn replica(&self, id: &str) -> Arc<AccountReplica> {
        Arc::clone(&self.devices.lock().unwrap()[id].replica)
    }
}

impl DeviceRpc for Devices {
    fn devices<'a>(
        &'a self,
        _account_id: &'a str,
    ) -> BoxFuture<'a, Result<Vec<DeviceSnapshot>, RpcError>> {
        Box::pin(async move {
            Ok(self
                .devices
                .lock()
                .unwrap()
                .iter()
                .map(|(id, device)| {
                    let mut capabilities = vec![
                        "cloud_agent_scope_v1".to_string(),
                        "account_replica_v1".to_string(),
                    ];
                    if device.archive {
                        capabilities.push("superagent_archive_v1".into());
                    }
                    DeviceSnapshot {
                        facts: RuntimeFacts {
                            device_id: id.clone(),
                            name: id.clone(),
                            host_kind: FleetHostKind::Desktop,
                            online: device.online,
                            host_capabilities: capabilities,
                            accept_dispatch: true,
                            allow_auto_approval: true,
                            ..RuntimeFacts::default()
                        },
                        ..DeviceSnapshot::default()
                    }
                })
                .collect())
        })
    }

    fn call<'a>(
        &'a self,
        _account_id: &'a str,
        device_id: &'a str,
        command: &'a str,
        args: Value,
    ) -> BoxFuture<'a, Result<Value, RpcError>> {
        Box::pin(async move {
            let replica = {
                let devices = self.devices.lock().unwrap();
                let device = devices
                    .get(device_id)
                    .ok_or_else(|| RpcError::Offline("unknown".into()))?;
                if !device.online {
                    return Err(RpcError::Offline(format!("{device_id} is offline")));
                }
                Arc::clone(&device.replica)
            };
            if command == "fleet_replica_push" {
                self.pushes.lock().unwrap().push(device_id.to_string());
            }
            // The device grants the cloud agent its collections only.
            let access = ReplicaAccess::Collections(vec!["superagent.".into()]);
            match replica.handle_as(command, &args, &access) {
                Some(Ok(value)) => Ok(value),
                Some(Err(error)) => Err(RpcError::Refused(error)),
                None => Err(RpcError::Refused(format!("unknown command {command}"))),
            }
        })
    }
}

#[derive(Default)]
struct FakeDirectory {
    rows: Mutex<BTreeMap<String, String>>,
}

impl Directory for FakeDirectory {
    fn register<'a>(
        &'a self,
        _account: &'a str,
        device_id: &'a str,
        _name: &'a str,
        public_key: &'a str,
    ) -> BoxFuture<'a, Result<String, DirectoryError>> {
        Box::pin(async move {
            self.rows
                .lock()
                .unwrap()
                .insert(device_id.into(), public_key.into());
            Ok(format!("token-{device_id}"))
        })
    }
    fn unregister<'a>(
        &'a self,
        _account: &'a str,
        device_id: &'a str,
        _token: Option<&'a str>,
    ) -> BoxFuture<'a, Result<(), DirectoryError>> {
        Box::pin(async move {
            self.rows
                .lock()
                .unwrap()
                .remove(device_id)
                .map(|_| ())
                .ok_or(DirectoryError::NotFound)
        })
    }
    fn devices<'a>(
        &'a self,
        _token: &'a str,
    ) -> BoxFuture<'a, Result<Vec<DirectoryDevice>, DirectoryError>> {
        Box::pin(async { Ok(Vec::new()) })
    }
    fn device_key<'a>(
        &'a self,
        _token: &'a str,
        _device_id: &'a str,
    ) -> BoxFuture<'a, Result<(String, Option<String>), DirectoryError>> {
        Box::pin(async { Err(DirectoryError::NotFound) })
    }
}

struct ManualClock(AtomicU64);

impl Clock for ManualClock {
    fn now_ms(&self) -> u64 {
        self.0.load(Ordering::SeqCst)
    }
}

struct Harness {
    _dir: tempfile::TempDir,
    root: std::path::PathBuf,
    devices: Arc<Devices>,
    clock: Arc<ManualClock>,
    directory: Arc<FakeDirectory>,
    service: Arc<Service>,
}

fn build(
    root: &std::path::Path,
    devices: &Arc<Devices>,
    clock: &Arc<ManualClock>,
    directory: &Arc<FakeDirectory>,
) -> Arc<Service> {
    let store = Arc::new(Store::open(root, MASTER).unwrap());
    let slots = Arc::new(Slots::new(store, SlotLimits::default()));
    let rpc: Arc<dyn DeviceRpc> = devices.clone();
    let engine = Engine::new(
        slots,
        Arc::clone(&rpc),
        Arc::new(RelayModel::new(rpc)),
        clock.clone(),
        EngineConfig::default(),
    );
    Service::new(engine, directory.clone())
}

impl Harness {
    async fn new(devices: Arc<Devices>) -> Self {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_path_buf();
        // Real time: devices clamp a writer clock far ahead of their own.
        let clock = Arc::new(ManualClock(AtomicU64::new(openbitfun_obp::now_ms())));
        let directory = Arc::new(FakeDirectory::default());
        let service = build(&root, &devices, &clock, &directory);
        service.ensure(ACCOUNT).await.unwrap();
        Self {
            _dir: dir,
            root,
            devices,
            clock,
            directory,
            service,
        }
    }

    fn restart(&mut self) {
        self.service = build(&self.root, &self.devices, &self.clock, &self.directory);
    }

    fn engine(&self) -> &Arc<Engine> {
        &self.service.engine
    }

    fn advance(&self, ms: u64) {
        self.clock.0.fetch_add(ms, Ordering::SeqCst);
    }

    fn now(&self) -> u64 {
        self.clock.now_ms()
    }

    async fn slot(&self) -> Arc<openbitfun_superagent::slots::Slot> {
        self.engine()
            .slots
            .load(ACCOUNT, self.now(), None)
            .await
            .unwrap()
    }

    async fn call(&self, command: &str, request: Value) -> Result<Value, String> {
        self.service
            .dispatch(ACCOUNT, command, json!({ "request": request }))
            .await
    }

    /// `turns` finished turns (a user message and an answer of
    /// `answer_bytes`), saved one by one as the turn loop does.
    async fn add_turns(&self, id: &str, turns: usize, answer_bytes: usize) {
        let slot = self.slot().await;
        let mut state = slot.state.lock().await;
        let now = self.now();
        if slot.conversation(&mut state, id).unwrap().is_none() {
            state.conversations.insert(
                id.to_string(),
                Conversation::new(id.into(), format!("Title {id}"), now),
            );
        }
        for _ in 0..turns {
            let conversation = state.conversations.get_mut(id).unwrap();
            let seq = conversation.history_count + conversation.messages.len() as u64;
            conversation.messages.push(Message {
                id: format!("{id}-u{seq}"),
                role: Role::User,
                text: format!("question {seq}"),
                at_ms: now,
                ..Message::default()
            });
            conversation.messages.push(Message {
                id: format!("{id}-a{}", seq + 1),
                role: Role::Assistant,
                text: "x".repeat(answer_bytes),
                at_ms: now,
                ..Message::default()
            });
            conversation.updated_ms = now;
            slot.save_conversation(&mut state, id).unwrap();
        }
    }

    async fn pump(&self) -> archive::PumpReport {
        let slot = self.slot().await;
        archive::pump(self.engine(), &slot, true).await
    }

    async fn outbox_chunks(&self) -> usize {
        self.slot().await.state.lock().await.outbox.chunks.len()
    }

    fn account_bytes(&self) -> u64 {
        fn walk(path: &std::path::Path) -> u64 {
            std::fs::read_dir(path)
                .map(|entries| {
                    entries
                        .flatten()
                        .map(|entry| {
                            let meta = entry.metadata().unwrap();
                            if meta.is_dir() {
                                walk(&entry.path())
                            } else {
                                meta.len()
                            }
                        })
                        .sum()
                })
                .unwrap_or(0)
        }
        walk(&self.root.join("accounts"))
    }
}

fn record_on(replica: &AccountReplica, id: &str) -> Option<ArchiveRecord> {
    serde_json::from_value(replica.get(ARCHIVE_COLLECTION, id)?.value?).ok()
}

#[tokio::test]
async fn turns_are_pushed_held_by_two_devices_and_dropped_here() {
    let devices = Arc::new(Devices::default());
    let desk = devices.add("desk", true, true);
    let cli = devices.add("cli", true, true);
    let h = Harness::new(Arc::clone(&devices)).await;
    h.add_turns("c1", 3, 100).await;
    assert!(h.outbox_chunks().await >= 1, "sealed into the outbox");
    let report = h.pump().await;
    assert_eq!(report.devices, 2);
    // Held by two devices: nothing of it stays here.
    assert_eq!(h.outbox_chunks().await, 0);
    assert!(h.slot().await.state.lock().await.outbox.is_empty());
    for replica in [&desk, &cli] {
        let record = record_on(replica, "c1").expect("the record is on the device");
        assert_eq!(record.message_count, 6);
        assert_eq!(record.title, "Title c1");
        for chunk in &record.chunks {
            assert!(replica.is_pinned(&chunk.hash), "pinned");
        }
        assert_eq!(replica.holders(&record.chunks[0].hash).len(), 1);
    }
    // More turns merge into the small last chunk (the record stays short)
    // and the replaced chunk is no longer named.
    h.add_turns("c1", 2, 100).await;
    h.pump().await;
    let record = record_on(&desk, "c1").unwrap();
    assert_eq!(record.message_count, 10);
    assert_eq!(record.chunks.len(), 1);
    desk.trim_cache();
    assert_eq!(desk.durable_blobs().len(), 1);
    // A device of an earlier build (no history) is never pushed to.
    devices.add("old", true, false);
    h.add_turns("c1", 1, 100).await;
    h.pump().await;
    assert!(!devices.pushes.lock().unwrap().iter().any(|d| d == "old"));
}

#[tokio::test]
async fn one_online_device_is_enough_and_offline_turns_wait() {
    let devices = Arc::new(Devices::default());
    let desk = devices.add("desk", false, true);
    devices.add("cli", false, true);
    let h = Harness::new(Arc::clone(&devices)).await;
    h.add_turns("c1", 2, 100).await;
    // No device online: the turns stay in the outbox.
    assert_eq!(h.pump().await.devices, 0);
    assert!(h.outbox_chunks().await > 0);
    let view = h
        .call(
            "superagent_get_conversation",
            json!({ "conversationId": "c1" }),
        )
        .await
        .unwrap();
    assert_eq!(view["history"]["state"], "pending");
    // After two minutes the conversation says so.
    h.advance(3 * 60 * 1000);
    let view = h
        .call(
            "superagent_get_conversation",
            json!({ "conversationId": "c1" }),
        )
        .await
        .unwrap();
    assert_eq!(view["messages"][0]["card"]["kind"], "history_pending");
    // One device comes online: one holder is enough while it is alone.
    devices.set_online("desk", true);
    h.pump().await;
    assert_eq!(h.outbox_chunks().await, 0);
    assert_eq!(record_on(&desk, "c1").unwrap().message_count, 4);
}

#[tokio::test]
async fn outbox_overflow_drops_the_oldest_and_says_so() {
    let devices = Arc::new(Devices::default());
    devices.add("desk", false, true);
    let h = Harness::new(Arc::clone(&devices)).await;
    // ~200 KiB per turn: 24 turns are well past the 4 MiB outbox.
    h.add_turns("c1", 24, 200 * 1024).await;
    let slot = h.slot().await;
    let (bytes, unsaved) = {
        let state = slot.state.lock().await;
        (
            state.outbox.chunk_bytes(),
            state.conversations["c1"].archive.unsaved,
        )
    };
    assert!(bytes <= OUTBOX_MAX_BYTES, "{bytes}");
    assert!(unsaved > 0);
    let view = h
        .call(
            "superagent_get_conversation",
            json!({ "conversationId": "c1" }),
        )
        .await
        .unwrap();
    assert_eq!(view["messages"][0]["card"]["kind"], "history_not_saved");
    let text = view["messages"][0]["text"].as_str().unwrap();
    assert!(
        text.starts_with(&format!("{unsaved} earlier messages were not saved")),
        "{text}"
    );
    assert_eq!(view["history"]["unsaved"], unsaved);
    // The record the devices get says so as well.
    devices.set_online("desk", true);
    h.pump().await;
    let record = record_on(&devices.replica("desk"), "c1").unwrap();
    assert_eq!(record.unsaved, unsaved);
    // The server keeps a bounded amount per account.
    assert!(h.account_bytes() < 6 * 1024 * 1024, "{}", h.account_bytes());
}

#[tokio::test]
async fn time_to_live_sweep_with_a_manual_clock() {
    let devices = Arc::new(Devices::default());
    devices.add("desk", false, true);
    let h = Harness::new(Arc::clone(&devices)).await;
    h.add_turns("pending", 1, 100).await;
    // The outbox keeps a chunk for 7 days, then drops it loudly.
    h.advance(6 * DAY);
    h.engine().sweep_slot(&h.slot().await, true).await;
    assert!(h.outbox_chunks().await > 0);
    h.advance(2 * DAY);
    h.engine().sweep_slot(&h.slot().await, true).await;
    assert_eq!(h.outbox_chunks().await, 0);
    {
        let slot = h.slot().await;
        let mut state = slot.state.lock().await;
        let conversation = slot.conversation(&mut state, "pending").unwrap().unwrap();
        assert_eq!(conversation.archive.unsaved, 2);
    }
    // A stored conversation idle for 14 days leaves the working set.
    devices.set_online("desk", true);
    h.add_turns("stored", 1, 100).await;
    h.pump().await;
    h.advance(13 * DAY);
    h.engine().sweep_slot(&h.slot().await, true).await;
    let listed = |value: &Value| -> Vec<String> {
        value["conversations"]
            .as_array()
            .unwrap()
            .iter()
            .map(|row| row["id"].as_str().unwrap().to_string())
            .collect()
    };
    let list = h
        .call("superagent_list_conversations", json!({}))
        .await
        .unwrap();
    assert!(listed(&list).contains(&"stored".to_string()));
    h.advance(2 * DAY);
    h.engine().sweep_slot(&h.slot().await, true).await;
    let list = h
        .call("superagent_list_conversations", json!({}))
        .await
        .unwrap();
    assert!(!listed(&list).contains(&"stored".to_string()));
    // The entry's replica lists it again (a backend projection of both).
    let archived: Vec<ArchivedSummary> =
        superagent_archive::archived_summaries(&devices.replica("desk"), 10);
    let list = h
        .call(
            "superagent_list_conversations",
            json!({ "archived": archived }),
        )
        .await
        .unwrap();
    assert!(listed(&list).contains(&"stored".to_string()));
    // Device facts are kept 30 days after the device was last seen.
    let slot = h.slot().await;
    slot.save_device_facts(&DeviceSnapshot {
        facts: RuntimeFacts {
            device_id: "gone".into(),
            ..RuntimeFacts::default()
        },
        ..DeviceSnapshot::default()
    })
    .await
    .unwrap();
    h.advance(29 * DAY);
    assert_eq!(slot.prune_device_facts(None).await, 0);
    h.advance(2 * DAY);
    assert_eq!(slot.prune_device_facts(None).await, 1);
    assert!(slot.device_facts().is_empty());
    drop(slot);
    // An account unused for 180 days with no live work is shredded.
    h.advance(100 * DAY);
    assert!(h.service.sweep_accounts().await.is_empty());
    h.advance(80 * DAY);
    let shredded = h.service.sweep_accounts().await;
    assert_eq!(shredded, vec![ACCOUNT.to_string()]);
    assert!(!h.engine().slots.store().exists(ACCOUNT));
    assert!(h.directory.rows.lock().unwrap().is_empty());
}

#[tokio::test]
async fn an_evicted_conversation_is_rebuilt_from_the_devices() {
    let devices = Arc::new(Devices::default());
    devices.add("desk", true, true);
    devices.add("cli", true, true);
    let h = Harness::new(Arc::clone(&devices)).await;
    let turns = WINDOW_TURNS + 10;
    h.add_turns("old", turns, 10 * 1024).await;
    h.pump().await;
    assert_eq!(h.outbox_chunks().await, 0);
    h.advance(15 * DAY);
    h.engine().sweep_slot(&h.slot().await, true).await;
    let store_names = h.slot().await.store.names();
    assert!(!store_names.iter().any(|name| name.starts_with("conv-")));
    // Only the cli is online now; the rename resumes the conversation.
    devices.set_online("desk", false);
    h.call(
        "superagent_rename_conversation",
        json!({ "conversationId": "old", "title": "Renamed" }),
    )
    .await
    .unwrap();
    let slot = h.slot().await;
    {
        let state = slot.state.lock().await;
        let conversation = &state.conversations["old"];
        let users = conversation
            .messages
            .iter()
            .filter(|m| m.role == Role::User)
            .count();
        assert_eq!(users, WINDOW_TURNS);
        assert_eq!(conversation.history_count, 20);
        assert_eq!(
            conversation.messages.last().unwrap().id,
            format!("old-a{}", 2 * turns - 1)
        );
        assert_eq!(conversation.archive.sealed_seq, 2 * turns as u64);
    }
    h.pump().await;
    let record = record_on(&devices.replica("cli"), "old").unwrap();
    assert_eq!(record.title, "Renamed");
    assert_eq!(record.message_count, 2 * turns as u64);
    // An older page comes from the entry's replica.
    let view = h
        .call(
            "superagent_get_conversation",
            json!({ "conversationId": "old", "cursor": 20 }),
        )
        .await
        .unwrap();
    // Without the entry's page this node has nothing older than its window.
    assert_eq!(view["messages"].as_array().unwrap().len(), 0);
    assert_eq!(view["hasMore"], false);
    let older: Vec<Value> = (0..20)
        .map(|seq| json!({ "id": format!("p{seq}"), "role": "user", "text": format!("q{seq}") }))
        .collect();
    let view = h
        .call(
            "superagent_get_conversation",
            json!({ "conversationId": "old", "cursor": 20, "archive": {
                "summary": { "id": "old", "title": "Renamed", "messageCount": 2 * turns },
                "fromSeq": 0, "messages": older,
            } }),
        )
        .await
        .unwrap();
    assert_eq!(view["messages"].as_array().unwrap().len(), 20);
    assert_eq!(view["cursor"], 0);
}

#[tokio::test]
async fn legacy_conversations_drain_to_the_devices_on_first_contact() {
    let devices = Arc::new(Devices::default());
    let desk = devices.add("desk", false, true);
    let h = Harness::new(Arc::clone(&devices)).await;
    // Records an earlier build wrote: a window past 20 turns and a history.
    let slot = h.slot().await;
    let id = "legacy-1";
    let mut conversation = Conversation::new(id.into(), "Legacy".into(), h.now());
    conversation.history_count = 40;
    for seq in 40..80u64 {
        conversation.messages.push(Message {
            id: format!("w{seq}"),
            role: if seq % 2 == 0 {
                Role::User
            } else {
                Role::Assistant
            },
            text: format!("window {seq}"),
            ..Message::default()
        });
    }
    let history = json!({
        "messages": (5..40).map(|seq| json!({ "id": format!("h{seq}"), "role": "user", "text": "old" })).collect::<Vec<_>>(),
        "dropped": 5,
    });
    let mut legacy = serde_json::to_value(&conversation).unwrap();
    legacy.as_object_mut().unwrap().remove("archive");
    slot.store
        .write_json(
            &openbitfun_superagent::slots::conversation_record(id),
            &legacy,
        )
        .unwrap();
    slot.store
        .write_json(&openbitfun_superagent::slots::history_record(id), &history)
        .unwrap();
    slot.store
        .write_json(
            openbitfun_superagent::slots::CONVERSATIONS_RECORD,
            &json!([{ "id": id, "title": "Legacy", "updatedMs": h.now(), "status": "idle" }]),
        )
        .unwrap();
    drop(slot);
    let mut h = h;
    h.restart();
    // No device yet: nothing is sealed, nothing dropped.
    h.pump().await;
    assert_eq!(h.outbox_chunks().await, 0);
    assert!(h
        .slot()
        .await
        .store
        .names()
        .contains(&openbitfun_superagent::slots::history_record(id)));
    // First contact: everything kept drains, then the history record goes.
    devices.set_online("desk", true);
    h.pump().await;
    let record = record_on(&desk, id).expect("drained");
    assert_eq!(record.message_count, 80);
    assert_eq!(record.dropped, 5);
    assert_eq!(record.chunks.first().unwrap().from_seq, 5);
    assert_eq!(h.outbox_chunks().await, 0);
    assert!(!h
        .slot()
        .await
        .store
        .names()
        .contains(&openbitfun_superagent::slots::history_record(id)));
}

#[tokio::test]
async fn the_outbox_survives_a_restart() {
    let devices = Arc::new(Devices::default());
    let desk = devices.add("desk", false, true);
    let mut h = Harness::new(Arc::clone(&devices)).await;
    h.add_turns("c1", 2, 100).await;
    let pending = h.outbox_chunks().await;
    assert!(pending > 0);
    h.restart();
    assert_eq!(h.outbox_chunks().await, pending);
    devices.set_online("desk", true);
    h.pump().await;
    assert_eq!(h.outbox_chunks().await, 0);
    assert_eq!(record_on(&desk, "c1").unwrap().message_count, 4);
    // Deleting the conversation reaches the device as a tombstone.
    h.call(
        "superagent_delete_conversation",
        json!({ "conversationId": "c1" }),
    )
    .await
    .unwrap();
    h.pump().await;
    assert!(desk.get(ARCHIVE_COLLECTION, "c1").unwrap().is_tombstone());
}

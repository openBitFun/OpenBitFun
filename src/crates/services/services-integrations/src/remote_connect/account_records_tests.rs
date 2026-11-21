use super::memory::MemoryRecordPort;
use super::*;
use serde_json::json;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex as StdMutex;

const COLLECTION: &str = PERSONAS_COLLECTION;

/// An owner's store: items by id, with what the binder applied.
#[derive(Default)]
struct Owner {
    items: StdMutex<BTreeMap<String, LocalItem>>,
    defaults: BTreeSet<String>,
    conflicts: StdMutex<Vec<String>>,
}

impl Owner {
    fn set(&self, id: &str, value: Value, files: Vec<ItemFile>) {
        let offer = !self.defaults.contains(id);
        self.items.lock().unwrap().insert(
            id.into(),
            LocalItem::new(id, value).with_files(files).offered(offer),
        );
    }

    fn get(&self, id: &str) -> Option<LocalItem> {
        self.items.lock().unwrap().get(id).cloned()
    }
}

struct Binding(&'static str, Arc<Owner>);

#[async_trait]
impl LocalCollection for Binding {
    fn collection(&self) -> &'static str {
        self.0
    }

    async fn list(&self, _device: &DeviceContext) -> Result<Vec<LocalItem>> {
        Ok(self.1.items.lock().unwrap().values().cloned().collect())
    }

    async fn apply(&self, item: &RemoteItem, context: &ApplyContext) -> Result<()> {
        if context.concurrent {
            self.1.conflicts.lock().unwrap().push(item.id.clone());
        }
        let offer = !self.1.defaults.contains(&item.id);
        self.1.items.lock().unwrap().insert(
            item.id.clone(),
            LocalItem::new(item.id.clone(), item.value.clone())
                .with_files(item.files.clone())
                .offered(offer),
        );
        Ok(())
    }

    async fn remove(&self, id: &str) -> Result<()> {
        self.1.items.lock().unwrap().remove(id);
        Ok(())
    }
}

struct Provider {
    port: Arc<MemoryRecordPort>,
    attached: AtomicBool,
}

impl RecordPortProvider for Provider {
    fn port(&self) -> Option<Arc<dyn AccountRecordPort>> {
        self.attached
            .load(Ordering::SeqCst)
            .then(|| Arc::clone(&self.port) as Arc<dyn AccountRecordPort>)
    }

    fn changes(&self) -> Option<watch::Receiver<u64>> {
        Some(self.port.subscribe())
    }

    fn device_name(&self) -> String {
        format!("{} laptop", self.port.device_id())
    }
}

#[derive(Default)]
struct MemoryStore(StdMutex<Option<RecordsState>>);

#[async_trait]
impl RecordsStateStore for MemoryStore {
    async fn load(&self, _account_id: &str) -> Result<Option<RecordsState>> {
        Ok(self.0.lock().unwrap().clone())
    }

    async fn save(&self, state: &RecordsState) -> Result<()> {
        *self.0.lock().unwrap() = Some(state.clone());
        Ok(())
    }
}

struct Switch(AtomicBool);

#[async_trait]
impl RecordsSwitch for Switch {
    async fn enabled(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

struct Device {
    port: Arc<MemoryRecordPort>,
    owner: Arc<Owner>,
    sync: Arc<AccountRecordsSync>,
    switch: Arc<Switch>,
}

fn device(id: &str, defaults: &[&str]) -> Device {
    let port = MemoryRecordPort::new("acct", id);
    let owner = Arc::new(Owner {
        defaults: defaults.iter().map(|id| id.to_string()).collect(),
        ..Owner::default()
    });
    let switch = Arc::new(Switch(AtomicBool::new(true)));
    let sync = AccountRecordsSync::new(
        vec![Arc::new(Binding(COLLECTION, Arc::clone(&owner)))],
        Arc::new(Provider {
            port: Arc::clone(&port),
            attached: AtomicBool::new(true),
        }),
        Arc::new(MemoryStore::default()),
        Arc::clone(&switch) as Arc<dyn RecordsSwitch>,
    );
    Device {
        port,
        owner,
        sync,
        switch,
    }
}

fn pair(a: &Device, b: &Device) {
    MemoryRecordPort::link(&a.port, &b.port);
}

async fn settle(devices: &[&Device]) {
    for _ in 0..4 {
        for device in devices {
            device.sync.round().await;
        }
        for (index, left) in devices.iter().enumerate() {
            for right in &devices[index + 1..] {
                MemoryRecordPort::exchange(&left.port, &right.port);
            }
        }
    }
}

fn file(path: &str, text: &str) -> ItemFile {
    ItemFile {
        path: path.into(),
        bytes: text.as_bytes().to_vec(),
    }
}

#[tokio::test]
async fn existing_local_data_seeds_the_account_and_stays_in_place() {
    let a = device("a", &["default-1"]);
    a.owner.set(
        "p1",
        json!({ "name": "Ada" }),
        vec![file("SOUL.md", "calm")],
    );
    a.owner.set("default-1", json!({ "name": "stock" }), vec![]);
    a.sync.round().await;
    let records = a.port.records(COLLECTION);
    assert_eq!(records.len(), 1, "only the non-default item is offered");
    assert!(
        records[0].stamp.starts_with("0000000000000000-"),
        "an offer"
    );
    // The owner's data was only read.
    assert_eq!(
        a.owner.get("p1").unwrap().files,
        vec![file("SOUL.md", "calm")]
    );
    // A second device takes the account's item, file included.
    let b = device("b", &["default-1"]);
    pair(&a, &b);
    settle(&[&a, &b]).await;
    assert_eq!(b.owner.get("p1").unwrap().value, json!({ "name": "Ada" }));
    assert_eq!(
        b.owner.get("p1").unwrap().files,
        vec![file("SOUL.md", "calm")]
    );
}

#[tokio::test]
async fn a_new_device_takes_the_account_values_instead_of_its_own() {
    let a = device("a", &[]);
    a.owner.set("p1", json!({ "name": "account" }), vec![]);
    a.sync.round().await;
    // Settle a real write on the account.
    a.owner.set("p1", json!({ "name": "account v2" }), vec![]);
    a.sync.round().await;
    let b = device("b", &[]);
    b.owner.set("p1", json!({ "name": "fresh device" }), vec![]);
    pair(&a, &b);
    settle(&[&a, &b]).await;
    for device in [&a, &b] {
        assert_eq!(
            device.owner.get("p1").unwrap().value,
            json!({ "name": "account v2" })
        );
    }
    // The device's own version was replaced: the owner can keep a copy.
    assert_eq!(*b.owner.conflicts.lock().unwrap(), vec!["p1".to_string()]);
}

#[tokio::test]
async fn offline_edits_converge_and_the_later_edit_wins_with_a_conflict_mark() {
    let a = device("a", &[]);
    let b = device("b", &[]);
    pair(&a, &b);
    a.owner.set("p1", json!({ "v": 1 }), vec![]);
    settle(&[&a, &b]).await;
    assert_eq!(b.owner.get("p1").unwrap().value, json!({ "v": 1 }));
    // Both edit while apart.
    a.port.set_online(false);
    a.owner.set("p1", json!({ "v": "a" }), vec![]);
    a.sync.round().await;
    std::thread::sleep(std::time::Duration::from_millis(3));
    b.owner.set("p1", json!({ "v": "b" }), vec![]);
    b.sync.round().await;
    a.port.set_online(true);
    settle(&[&a, &b]).await;
    for device in [&a, &b] {
        assert_eq!(device.owner.get("p1").unwrap().value, json!({ "v": "b" }));
    }
    // A saw its own edit replaced by one made without it.
    assert_eq!(*a.owner.conflicts.lock().unwrap(), vec!["p1".to_string()]);
    assert!(b.owner.conflicts.lock().unwrap().is_empty());
    // A later edit made after seeing the other one is no conflict.
    a.owner.set("p1", json!({ "v": "a2" }), vec![]);
    settle(&[&a, &b]).await;
    assert_eq!(b.owner.get("p1").unwrap().value, json!({ "v": "a2" }));
    assert!(b.owner.conflicts.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_deletion_travels_as_a_tombstone() {
    let a = device("a", &[]);
    let b = device("b", &[]);
    pair(&a, &b);
    a.owner.set("p1", json!({ "v": 1 }), vec![]);
    a.owner.set("p2", json!({ "v": 2 }), vec![]);
    settle(&[&a, &b]).await;
    b.owner.items.lock().unwrap().remove("p1");
    settle(&[&a, &b]).await;
    assert!(a.owner.get("p1").is_none());
    assert!(a.owner.get("p2").is_some());
    assert!(a
        .port
        .records(COLLECTION)
        .iter()
        .any(|record| record.id == "p1" && record.value.is_none()));
}

#[tokio::test]
async fn large_files_travel_in_chunks_and_wait_until_reachable() {
    let a = device("a", &[]);
    let b = device("b", &[]);
    pair(&a, &b);
    let big: Vec<u8> = (0..(MAX_CHUNK_BYTES + 1024))
        .map(|i| (i % 251) as u8)
        .collect();
    a.owner.set(
        "p1",
        json!({}),
        vec![ItemFile {
            path: "sprite.webp".into(),
            bytes: big.clone(),
        }],
    );
    a.sync.round().await;
    let record = a.port.records(COLLECTION).remove(0);
    assert_eq!(record.blobs.len(), 2, "two chunks");
    // b has the record but a (the only holder) is offline: it waits.
    MemoryRecordPort::exchange(&a.port, &b.port);
    a.port.set_online(false);
    b.sync.round().await;
    assert!(b.owner.get("p1").is_none());
    assert_eq!(b.sync.status().waiting, 1);
    a.port.set_online(true);
    b.sync.round().await;
    assert_eq!(b.owner.get("p1").unwrap().files[0].bytes, big);
    assert_eq!(b.sync.status().waiting, 0);
}

#[tokio::test]
async fn secrets_in_values_or_files_stay_on_the_device() {
    let a = device("a", &[]);
    a.owner.set("p1", json!({ "apiKey": "abc" }), vec![]);
    a.owner.set(
        "p2",
        json!({}),
        vec![file(
            "notes.md",
            "use token ghp_abcdefghijklmnopqrstuvwxyz0123456789 here",
        )],
    );
    a.owner.set("p3", json!({ "name": "fine" }), vec![]);
    a.sync.round().await;
    let ids: Vec<_> = a
        .port
        .records(COLLECTION)
        .into_iter()
        .map(|r| r.id)
        .collect();
    assert_eq!(ids, vec!["p3".to_string()]);
    let refused: Vec<_> = a
        .sync
        .status()
        .refused
        .into_iter()
        .map(|r| (r.id, r.reason))
        .collect();
    assert!(refused.contains(&("p1".into(), "secret".into())));
    assert!(refused.contains(&("p2".into(), "secret".into())));
    // The owner keeps them.
    assert!(a.owner.get("p1").is_some() && a.owner.get("p2").is_some());
}

#[tokio::test]
async fn an_item_over_the_budget_is_refused_loudly_and_kept() {
    let a = device("a", &[]);
    let budget = collection_budget(COLLECTION).unwrap();
    for index in 0..=budget.max_records {
        a.owner
            .set(&format!("p{index}"), json!({ "i": index }), vec![]);
    }
    a.sync.round().await;
    assert_eq!(a.port.records(COLLECTION).len(), budget.max_records);
    let refused = a.sync.status().refused;
    assert_eq!(refused.len(), 1);
    assert_eq!(refused[0].reason, "budget");
    assert_eq!(a.owner.items.lock().unwrap().len(), budget.max_records + 1);
}

#[tokio::test]
async fn the_switch_and_sign_out_stop_the_binder() {
    let a = device("a", &[]);
    a.switch.0.store(false, Ordering::SeqCst);
    a.owner.set("p1", json!({}), vec![]);
    a.sync.round().await;
    assert!(a.port.records(COLLECTION).is_empty());
    assert!(!a.sync.status().enabled);
    a.switch.0.store(true, Ordering::SeqCst);
    a.sync.round().await;
    assert_eq!(a.port.records(COLLECTION).len(), 1);
}

#[test]
fn file_paths_stay_inside_the_item() {
    for path in ["SOUL.md", "scripts/run.sh", "a/b/c.txt"] {
        assert!(safe_relative_path(path), "{path}");
    }
    for path in ["", "/etc/passwd", "../x", "a/../b", "a//b", "a\\b", "./a"] {
        assert!(!safe_relative_path(path), "{path}");
    }
}

// ── Bot binding metadata ─────────────────────────────────────────────────

fn bot_data() -> crate::remote_connect::bot::BotPersistenceData {
    serde_json::from_value(json!({
        "connections": [{
            "account_user_id": "u1",
            "bot_type": "telegram",
            "chat_id": "42",
            "config": { "bot_type": "telegram", "bot_token": "123456789:AAHsecretsecretsecretsecretsecret00" },
            "chat_state": { "chat_id": "42", "paired": true },
            "connected_at": 1700000000
        }, {
            "account_user_id": "u1",
            "bot_type": "feishu",
            "chat_id": "c",
            "config": { "bot_type": "feishu", "app_id": "cli_a", "app_secret": "feishu-app-secret-value" },
            "chat_state": { "chat_id": "c", "paired": false },
            "connected_at": 1700000001
        }],
        "form_state": { "telegram_bot_token": "123456789:AAHsecretsecretsecretsecretsecret00" },
        "disabled_bots": ["feishu"]
    }))
    .expect("bot persistence (1.x shape)")
}

#[tokio::test]
async fn bot_bindings_replicate_only_their_metadata() {
    let data = bot_data();
    let device = DeviceContext {
        device_id: "a".into(),
        device_name: "Studio".into(),
    };
    let items = bots::bot_items(&data, &device);
    assert_eq!(items.len(), 2);
    let port = MemoryRecordPort::new("acct", "a");
    for item in &items {
        port.put(BOTS_COLLECTION, &item.id, item.value.clone(), &[], false)
            .unwrap();
    }
    let text = serde_json::to_string(&port.all()).unwrap();
    for secret in ["AAHsecret", "feishu-app-secret-value", "cli_a", "\"42\""] {
        assert!(!text.contains(secret), "{secret} leaked: {text}");
    }
    let telegram = port
        .records(BOTS_COLLECTION)
        .into_iter()
        .find(|r| r.id == "telegram")
        .unwrap();
    assert_eq!(
        telegram.value.unwrap(),
        json!({
            "botType": "telegram", "ownerDeviceId": "a", "ownerDeviceName": "Studio",
            "enabled": true, "paired": true, "connectedAt": 1700000000
        })
    );
    // The guard would refuse the raw config anyway.
    let raw = serde_json::to_value(&data.connections[0].config).unwrap();
    assert!(port.put(BOTS_COLLECTION, "raw", raw, &[], false).is_err());
}

#[tokio::test]
async fn bot_metadata_from_two_owners_settles_without_ping_pong() {
    let data = bot_data();
    let a = MemoryRecordPort::new("acct", "a");
    let b = MemoryRecordPort::new("acct", "b");
    struct Fixed(Vec<LocalItem>);
    #[async_trait]
    impl LocalCollection for Fixed {
        fn collection(&self) -> &'static str {
            BOTS_COLLECTION
        }
        async fn list(&self, _device: &DeviceContext) -> Result<Vec<LocalItem>> {
            Ok(self.0.clone())
        }
        async fn apply(&self, _: &RemoteItem, _: &ApplyContext) -> Result<()> {
            Ok(())
        }
        async fn remove(&self, _: &str) -> Result<()> {
            Ok(())
        }
    }
    let make = |port: &Arc<MemoryRecordPort>, id: &str| {
        let items = bots::bot_items(
            &data,
            &DeviceContext {
                device_id: id.into(),
                device_name: id.into(),
            },
        );
        AccountRecordsSync::new(
            vec![Arc::new(Fixed(items))],
            Arc::new(Provider {
                port: Arc::clone(port),
                attached: AtomicBool::new(true),
            }),
            Arc::new(MemoryStore::default()),
            Arc::new(AlwaysOn),
        )
    };
    let sync_a = make(&a, "a");
    let sync_b = make(&b, "b");
    for _ in 0..3 {
        sync_a.round().await;
        sync_b.round().await;
        MemoryRecordPort::exchange(&a, &b);
    }
    let stamps = |port: &MemoryRecordPort| {
        port.records(BOTS_COLLECTION)
            .into_iter()
            .map(|r| r.stamp)
            .collect::<Vec<_>>()
    };
    let settled = stamps(&a);
    for _ in 0..3 {
        sync_a.round().await;
        sync_b.round().await;
        MemoryRecordPort::exchange(&a, &b);
    }
    assert_eq!(stamps(&a), settled, "no further writes");
    assert_eq!(stamps(&b), settled);
}

#[tokio::test]
async fn a_replica_that_lost_its_records_gets_them_offered_again() {
    let a = device("a", &[]);
    a.owner
        .set("p1", json!({ "v": 1 }), vec![file("SOUL.md", "kept")]);
    a.sync.round().await;
    assert_eq!(a.port.records(COLLECTION).len(), 1);
    // The device's replica starts over (set aside, or a new device id) while
    // the binding state survives: the items are offered again.
    let fresh = MemoryRecordPort::new("acct", "a2");
    let sync = AccountRecordsSync::new(
        vec![Arc::new(Binding(COLLECTION, Arc::clone(&a.owner)))],
        Arc::new(Provider {
            port: Arc::clone(&fresh),
            attached: AtomicBool::new(true),
        }),
        Arc::new(MemoryStore(StdMutex::new(
            a.sync.state.lock().await.clone(),
        ))),
        Arc::new(AlwaysOn),
    );
    sync.round().await;
    let records = fresh.records(COLLECTION);
    assert_eq!(records.len(), 1);
    assert!(
        records[0].stamp.starts_with("0000000000000000-"),
        "an offer"
    );
    // A refused item is not retried every round.
    a.owner.set("p2", json!({ "token": "x" }), vec![]);
    sync.round().await;
    sync.round().await;
    assert_eq!(fresh.records(COLLECTION).len(), 1);
}

#[tokio::test]
async fn content_this_device_lost_is_put_back_from_its_files() {
    let a = device("a", &[]);
    a.owner.set("p1", json!({}), vec![file("SOUL.md", "kept")]);
    a.sync.round().await;
    let hash = a.port.records(COLLECTION)[0].blobs[0].clone();
    a.port.forget_blob(&hash);
    assert!(!a.port.has_blob(&hash));
    a.sync.round().await;
    assert!(a.port.has_blob(&hash));
}

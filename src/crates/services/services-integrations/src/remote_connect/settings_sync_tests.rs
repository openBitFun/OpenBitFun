use super::*;
use serde_json::json;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex as StdMutex;

/// A device's replica: last writer wins per key by `(wall, counter, device)`,
/// the order of the real replica (obp `fleet::replica`).
struct FakeReplica {
    device: &'static str,
    records: StdMutex<BTreeMap<String, (Option<Value>, (u64, u32, String))>>,
    clock: AtomicU64,
    changes: watch::Sender<u64>,
    online: AtomicBool,
    undelivered: StdMutex<std::collections::BTreeSet<String>>,
    peers: usize,
}

fn stamp((wall, counter, device): &(u64, u32, String)) -> String {
    format!("{wall:016x}-{counter:08x}-{device}")
}

impl FakeReplica {
    fn new(device: &'static str, peers: usize) -> Arc<Self> {
        Arc::new(Self {
            device,
            records: StdMutex::new(BTreeMap::new()),
            clock: AtomicU64::new(1000),
            changes: watch::channel(0).0,
            online: AtomicBool::new(true),
            undelivered: StdMutex::new(Default::default()),
            peers,
        })
    }

    fn write(&self, key: &str, value: Value, hlc: (u64, u32, String)) -> Option<String> {
        let mut records = self.records.lock().unwrap();
        if records
            .get(key)
            .is_some_and(|(current, _)| current.as_ref() == Some(&value))
        {
            return None;
        }
        let stamp = stamp(&hlc);
        records.insert(key.to_string(), (Some(value), hlc));
        self.undelivered.lock().unwrap().insert(key.to_string());
        self.changes.send_modify(|seq| *seq += 1);
        Some(stamp)
    }

    fn value(&self, key: &str) -> Option<Value> {
        self.records
            .lock()
            .unwrap()
            .get(key)
            .and_then(|(value, _)| value.clone())
    }
}

/// Both replicas take each other's newer records (one exchange over Link).
fn exchange(a: &FakeReplica, b: &FakeReplica) -> bool {
    if !a.online.load(Ordering::SeqCst) || !b.online.load(Ordering::SeqCst) {
        return false;
    }
    for (from, to) in [(a, b), (b, a)] {
        let incoming = from.records.lock().unwrap().clone();
        let mut changed = false;
        {
            let mut records = to.records.lock().unwrap();
            for (key, (value, hlc)) in incoming {
                if records
                    .get(&key)
                    .is_some_and(|(_, current)| *current >= hlc)
                {
                    continue;
                }
                to.clock.fetch_max(hlc.0, Ordering::SeqCst);
                records.insert(key, (value, hlc));
                changed = true;
            }
        }
        if changed {
            to.changes.send_modify(|seq| *seq += 1);
        }
    }
    a.undelivered.lock().unwrap().clear();
    b.undelivered.lock().unwrap().clear();
    true
}

impl SettingsReplica for FakeReplica {
    fn account_id(&self) -> String {
        "acct".into()
    }

    fn entries(&self) -> Vec<ReplicaEntry> {
        self.records
            .lock()
            .unwrap()
            .iter()
            .map(|(key, (value, hlc))| ReplicaEntry {
                key: key.clone(),
                value: value.clone(),
                stamp: stamp(hlc),
            })
            .collect()
    }

    fn put(&self, key: &str, value: Value) -> Result<Option<String>> {
        let wall = self.clock.fetch_add(1, Ordering::SeqCst) + 1;
        Ok(self.write(key, value, (wall, 0, self.device.into())))
    }

    fn seed(&self, key: &str, value: Value) -> Result<Option<String>> {
        // An earlier offer wins (the real replica counts down from its time).
        static OFFERS: AtomicU64 = AtomicU64::new(0);
        let order = u32::MAX - OFFERS.fetch_add(1, Ordering::SeqCst) as u32;
        let seed = (0, order, self.device.to_string());
        if self
            .records
            .lock()
            .unwrap()
            .get(key)
            .is_some_and(|(_, hlc)| *hlc >= seed)
        {
            return Ok(None);
        }
        Ok(self.write(key, value, seed))
    }

    fn changes(&self) -> watch::Receiver<u64> {
        self.changes.subscribe()
    }

    fn state(&self) -> ReplicaState {
        let online = self.online.load(Ordering::SeqCst);
        ReplicaState {
            peers: self.peers,
            peers_online: if online { self.peers } else { 0 },
            undelivered: self.undelivered.lock().unwrap().len(),
            exchanging: false,
            last_exchange_ms: Some(1),
        }
    }
}

struct Provider {
    replica: StdMutex<Option<Arc<FakeReplica>>>,
    signed_in: AtomicBool,
}

impl ReplicaProvider for Provider {
    fn replica(&self) -> Option<Arc<dyn SettingsReplica>> {
        self.replica
            .lock()
            .unwrap()
            .clone()
            .map(|replica| replica as Arc<dyn SettingsReplica>)
    }

    fn signed_in(&self) -> bool {
        self.signed_in.load(Ordering::SeqCst)
    }
}

/// A host config: values by path, the defaults of a fresh config, and the
/// applies it received.
#[derive(Default)]
struct Config {
    values: StdMutex<HashMap<String, Value>>,
    defaults: HashMap<String, Value>,
    applies: StdMutex<Vec<String>>,
    disabled: AtomicBool,
}

impl Config {
    fn new(values: &[(&str, Value)]) -> Arc<Self> {
        let defaults: HashMap<String, Value> = [
            ("app.language", json!("zh-CN")),
            ("appearance.selection", json!("system")),
            ("app.auto_update", json!(true)),
            ("tool_permissions.policy.preset", json!("ask")),
        ]
        .into_iter()
        .map(|(key, value)| (key.to_string(), value))
        .collect();
        let config = Self {
            values: StdMutex::new(defaults.clone()),
            defaults,
            ..Self::default()
        };
        for (key, value) in values {
            config.set(key, value.clone());
        }
        Arc::new(config)
    }

    fn set(&self, key: &str, value: Value) {
        self.values.lock().unwrap().insert(key.into(), value);
    }

    fn get(&self, key: &str) -> Option<Value> {
        self.values.lock().unwrap().get(key).cloned()
    }

    fn applies(&self) -> usize {
        self.applies.lock().unwrap().len()
    }
}

#[async_trait]
impl LocalSettings for Config {
    async fn enabled(&self) -> bool {
        !self.disabled.load(Ordering::SeqCst)
    }

    async fn read(&self, key: &str) -> Result<Option<Value>> {
        Ok(self.get(key))
    }

    async fn default_value(&self, key: &str) -> Option<Value> {
        self.defaults.get(key).cloned()
    }

    async fn apply(&self, key: &str, value: &Value) -> Result<()> {
        self.applies.lock().unwrap().push(key.into());
        self.set(key, value.clone());
        Ok(())
    }
}

#[derive(Default)]
struct MemoryStore(StdMutex<HashMap<String, SyncState>>);

#[async_trait]
impl SyncStateStore for MemoryStore {
    async fn load(&self, account_id: &str) -> Result<Option<SyncState>> {
        Ok(self.0.lock().unwrap().get(account_id).cloned())
    }

    async fn save(&self, state: &SyncState) -> Result<()> {
        self.0
            .lock()
            .unwrap()
            .insert(state.account_id.clone(), state.clone());
        Ok(())
    }
}

#[derive(Default)]
struct Observer {
    applied: StdMutex<Vec<Vec<String>>>,
}

impl SyncObserver for Observer {
    fn settings_applied(&self, keys: &[String]) {
        self.applied.lock().unwrap().push(keys.to_vec());
    }

    fn status_changed(&self, _status: &SyncStatus) {}
}

struct Host {
    replica: Arc<FakeReplica>,
    config: Arc<Config>,
    provider: Arc<Provider>,
    store: Arc<MemoryStore>,
    observer: Arc<Observer>,
    sync: Arc<SettingsSync>,
}

fn host(device: &'static str, values: &[(&str, Value)]) -> Host {
    let replica = FakeReplica::new(device, 1);
    let config = Config::new(values);
    let provider = Arc::new(Provider {
        replica: StdMutex::new(Some(Arc::clone(&replica))),
        signed_in: AtomicBool::new(true),
    });
    let store = Arc::new(MemoryStore::default());
    let observer = Arc::new(Observer::default());
    let sync = SettingsSync::new(
        config.clone(),
        provider.clone(),
        store.clone(),
        observer.clone(),
    );
    Host {
        replica,
        config,
        provider,
        store,
        observer,
        sync,
    }
}

async fn settle(hosts: &[&Host]) {
    for _ in 0..3 {
        for host in hosts {
            host.sync.round().await;
        }
        for (index, left) in hosts.iter().enumerate() {
            for right in &hosts[index + 1..] {
                exchange(&left.replica, &right.replica);
            }
        }
    }
    for host in hosts {
        host.sync.round().await;
    }
}

#[tokio::test]
async fn two_devices_merge_their_edits() {
    let laptop = host("laptop", &[]);
    let desktop = host("desktop", &[]);
    settle(&[&laptop, &desktop]).await;

    laptop
        .config
        .set("appearance.selection", json!("openbitfun-dark"));
    desktop.config.set("app.language", json!("zh-TW"));
    desktop
        .config
        .set("tool_permissions.policy.preset", json!("full_access"));
    settle(&[&laptop, &desktop]).await;
    for host in [&laptop, &desktop] {
        assert_eq!(
            host.config.get("appearance.selection"),
            Some(json!("openbitfun-dark"))
        );
        assert_eq!(host.config.get("app.language"), Some(json!("zh-TW")));
        assert_eq!(
            host.config.get("tool_permissions.policy.preset"),
            Some(json!("full_access"))
        );
    }
    assert_eq!(
        laptop
            .observer
            .applied
            .lock()
            .unwrap()
            .last()
            .unwrap()
            .len(),
        2
    );
    assert_eq!(laptop.sync.status().phase, SyncPhase::Synced);
    assert!(laptop.sync.status().active);
}

#[tokio::test]
async fn an_apply_does_not_echo_back_as_an_edit() {
    let laptop = host("laptop", &[]);
    let desktop = host("desktop", &[]);
    settle(&[&laptop, &desktop]).await;
    laptop
        .config
        .set("font", json!({ "uiSize": { "level": "large" } }));
    settle(&[&laptop, &desktop]).await;
    let records = desktop.replica.entries();
    let applies = desktop.config.applies();
    for _ in 0..4 {
        settle(&[&laptop, &desktop]).await;
    }
    assert_eq!(
        desktop.replica.entries(),
        records,
        "no write after the apply"
    );
    assert_eq!(desktop.config.applies(), applies);
}

#[tokio::test]
async fn a_conflict_goes_to_the_later_write() {
    let laptop = host("laptop", &[]);
    let desktop = host("desktop", &[]);
    settle(&[&laptop, &desktop]).await;
    // Both change the font before they exchange; the desktop's clock is later.
    laptop
        .config
        .set("font", json!({ "uiSize": { "level": "compact" } }));
    laptop.sync.round().await;
    desktop.replica.clock.fetch_add(100, Ordering::SeqCst);
    desktop
        .config
        .set("font", json!({ "uiSize": { "level": "large" } }));
    desktop.sync.round().await;
    settle(&[&laptop, &desktop]).await;
    for host in [&laptop, &desktop] {
        assert_eq!(
            host.config.get("font"),
            Some(json!({ "uiSize": { "level": "large" } }))
        );
    }
}

#[tokio::test]
async fn offline_edits_wait_and_merge_on_reconnect() {
    let laptop = host("laptop", &[]);
    let desktop = host("desktop", &[]);
    settle(&[&laptop, &desktop]).await;

    laptop.replica.online.store(false, Ordering::SeqCst);
    laptop.config.set("app.auto_update", json!(false));
    laptop.config.set(
        "app.keybindings",
        json!({ "version": 1, "overrides": { "send": "mod+enter" } }),
    );
    settle(&[&laptop, &desktop]).await;
    let status = laptop.sync.status();
    assert_eq!(status.phase, SyncPhase::Offline);
    assert!(status.active, "the caption stays while offline");
    assert_eq!(status.pending, 2);
    assert_eq!(desktop.config.get("app.auto_update"), Some(json!(true)));

    laptop.replica.online.store(true, Ordering::SeqCst);
    settle(&[&laptop, &desktop]).await;
    assert_eq!(desktop.config.get("app.auto_update"), Some(json!(false)));
    assert_eq!(
        desktop.config.get("app.keybindings"),
        Some(json!({ "version": 1, "overrides": { "send": "mod+enter" } }))
    );
    assert_eq!(laptop.sync.status().phase, SyncPhase::Synced);
}

#[tokio::test]
async fn a_new_device_takes_the_account_values_from_a_peer() {
    let laptop = host(
        "laptop",
        &[
            ("app.language", json!("zh-TW")),
            ("appearance.selection", json!("openbitfun-midnight")),
        ],
    );
    settle(&[&laptop]).await;
    // The laptop's own choices were offered to the account.
    assert_eq!(laptop.replica.value("app.language"), Some(json!("zh-TW")));
    laptop
        .config
        .set("font", json!({ "uiSize": { "level": "small" } }));
    settle(&[&laptop]).await;

    // A new device with its defaults (and one value of its own) signs in.
    let phone_host = host("zz-new", &[("app.auto_update", json!(false))]);
    settle(&[&laptop, &phone_host]).await;
    assert_eq!(phone_host.config.get("app.language"), Some(json!("zh-TW")));
    assert_eq!(
        phone_host.config.get("appearance.selection"),
        Some(json!("openbitfun-midnight"))
    );
    assert_eq!(
        phone_host.config.get("font"),
        Some(json!({ "uiSize": { "level": "small" } }))
    );
    // Its defaults did not overwrite the account; its own choice filled a gap.
    assert_eq!(laptop.config.get("app.language"), Some(json!("zh-TW")));
    assert_eq!(laptop.config.get("app.auto_update"), Some(json!(false)));

    // With no peer reachable a new device keeps its values and syncs later.
    let late = host("late", &[("app.language", json!("en-US"))]);
    late.replica.online.store(false, Ordering::SeqCst);
    settle(&[&laptop, &late]).await;
    assert_eq!(late.config.get("app.language"), Some(json!("en-US")));
    late.replica.online.store(true, Ordering::SeqCst);
    settle(&[&laptop, &late]).await;
    // Its offered value is a seed: the account's real choice wins.
    assert_eq!(late.config.get("app.language"), Some(json!("zh-TW")));
}

#[tokio::test]
async fn only_the_synced_keys_travel() {
    let laptop = host(
        "laptop",
        &[
            ("superagent.acceptDispatch", json!(false)),
            ("app.prevent_sleep", json!(true)),
            ("ai.models", json!([{ "id": "m" }])),
        ],
    );
    settle(&[&laptop]).await;
    laptop.config.set("superagent.acceptDispatch", json!(true));
    laptop.config.set("app.language", json!("en-US"));
    settle(&[&laptop]).await;
    let keys: Vec<String> = laptop
        .replica
        .entries()
        .into_iter()
        .map(|entry| entry.key)
        .collect();
    assert_eq!(keys, vec!["app.language".to_string()]);
}

#[tokio::test]
async fn off_signed_out_and_no_device_network_say_so() {
    let laptop = host("laptop", &[]);
    laptop.config.disabled.store(true, Ordering::SeqCst);
    laptop.config.set("app.language", json!("en-US"));
    assert_eq!(laptop.sync.round().await, SyncPhase::Off);
    assert!(!laptop.sync.status().active);
    assert!(
        laptop.replica.entries().is_empty(),
        "nothing is written while off"
    );

    laptop.config.disabled.store(false, Ordering::SeqCst);
    *laptop.provider.replica.lock().unwrap() = None;
    assert_eq!(
        laptop.sync.round().await,
        SyncPhase::Offline,
        "signed in, device network off"
    );
    laptop.provider.signed_in.store(false, Ordering::SeqCst);
    assert_eq!(laptop.sync.round().await, SyncPhase::SignedOut);
    assert!(!laptop.sync.status().active);

    // The only device of the account is in sync with itself.
    let single = SettingsSync::new(
        Config::new(&[]),
        Arc::new(Provider {
            replica: StdMutex::new(Some(FakeReplica::new("solo", 0))),
            signed_in: AtomicBool::new(true),
        }),
        Arc::new(MemoryStore::default()),
        Arc::new(Observer::default()),
    );
    assert_eq!(single.round().await, SyncPhase::Synced);
}

#[tokio::test]
async fn an_old_or_damaged_state_file_starts_a_fresh_binding() {
    let state: SyncState = serde_json::from_value(json!({ "accountId": "acct" })).unwrap();
    assert_eq!(state, SyncState::new("acct"));
    let state: SyncState = serde_json::from_value(json!({
        "accountId": "acct",
        "keys": { "app.language": { "stamp": "x" } },
        "futureField": true
    }))
    .unwrap();
    assert_eq!(state.keys["app.language"].digest, "");

    let directory = tempfile::tempdir().unwrap();
    let store = FileSyncStateStore::new(directory.path());
    assert!(store.load("acct").await.unwrap().is_none());
    let mut saved = SyncState::new("acct");
    saved.seeded = true;
    store.save(&saved).await.unwrap();
    assert_eq!(store.load("acct").await.unwrap(), Some(saved));
    assert!(store.load("other").await.unwrap().is_none());
    std::fs::write(store.path("acct"), b"{not json").unwrap();
    assert!(store.load("acct").await.unwrap().is_none());
    assert!(store
        .path("acct")
        .with_extension("json.unreadable")
        .exists());
}

#[tokio::test]
async fn the_binding_survives_a_restart_without_rewriting() {
    let laptop = host("laptop", &[("app.language", json!("zh-TW"))]);
    settle(&[&laptop]).await;
    let records = laptop.replica.entries();
    // A new process with the same config, replica and state writes nothing.
    let restarted = SettingsSync::new(
        laptop.config.clone(),
        laptop.provider.clone(),
        laptop.store.clone(),
        laptop.observer.clone(),
    );
    restarted.round().await;
    assert_eq!(laptop.replica.entries(), records);
}

#[tokio::test]
async fn the_loop_writes_a_local_change() {
    let laptop = host("laptop", &[]);
    let (changes, receiver) = watch::channel(());
    let task = tokio::spawn(Arc::clone(&laptop.sync).run(receiver));
    tokio::time::sleep(Duration::from_millis(50)).await;
    laptop.config.set("app.language", json!("en-US"));
    changes.send_replace(());
    let started = std::time::Instant::now();
    while laptop.replica.value("app.language") != Some(json!("en-US")) {
        assert!(started.elapsed() < Duration::from_secs(5), "not written");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    task.abort();
}

#[test]
fn digests_ignore_key_order() {
    assert_eq!(
        value_digest(&json!({ "a": 1, "b": { "c": [1, 2], "d": null } })),
        value_digest(&json!({ "b": { "d": null, "c": [1, 2] }, "a": 1 }))
    );
    assert_ne!(value_digest(&json!([1, 2])), value_digest(&json!([2, 1])));
}

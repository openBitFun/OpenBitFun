//! Account settings sync: a small set of this host's settings (Preferences
//! and permission configuration) follows the account from device to device.
//!
//! Nothing is stored on a server. Every runtime device (desktop and CLI)
//! keeps the account's synced settings in its copy of the **account
//! replica** (obp `fleet::replica`, collection [`SETTINGS_COLLECTION`]) and
//! the replica exchanges them peer to peer over Link: last writer wins per
//! key by a hybrid logical clock, offline edits stay queued in the replica
//! and merge on reconnect, and a new device takes the values of the first
//! peer it reaches. Phones and browsers read and write through the device
//! they are connected to.
//!
//! This module binds the replica to the host's config:
//!
//! - **What syncs** is [`SYNCED_SETTINGS`], a fixed list of config paths
//!   (record id = config path). Models, credentials, device switches
//!   (`superagent.*`), paths and hardware choices stay on the device.
//! - **Local edits** (a config value that differs from what this device last
//!   wrote or applied) become replica writes.
//! - **Account values** (a record that changed since this device last saw
//!   it) apply through the host's typed settings mutation
//!   ([`LocalSettings::apply`]); the value read back afterwards is what is
//!   recorded, so an apply never echoes back as a local edit.
//! - **First sync on a device** offers the device's own non-default values
//!   as seeds (the lowest clock): they fill keys nobody set on the account
//!   and lose to every real write, so a new device takes the account's
//!   values instead of overwriting them with its defaults.
//!
//! The host supplies the config ([`LocalSettings`]), the replica of the
//! signed-in account ([`ReplicaProvider`]), where the per-account binding
//! state lives ([`SyncStateStore`]) and what to tell its UI ([`SyncObserver`]).

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, Result};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::{watch, Mutex};

/// The replica collection of the synced settings.
pub const SETTINGS_COLLECTION: &str = "settings";
/// Quiet time after the last local change before it is written.
pub const LOCAL_DEBOUNCE: Duration = Duration::from_millis(500);
/// How often the binder checks replica delivery state while an exchange is
/// actively in progress (`SyncPhase::Syncing`); idle phases do not poll.
const ACTIVE_STATUS_POLL: Duration = Duration::from_secs(2);

/// The group a synced setting belongs to (what the UI names).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SyncedGroup {
    Preferences,
    Permissions,
}

/// One synced setting: its config path (also its replica record id).
#[derive(Debug, Clone, Copy)]
pub struct SyncedSetting {
    pub key: &'static str,
    pub group: SyncedGroup,
}

const fn preference(key: &'static str) -> SyncedSetting {
    SyncedSetting {
        key,
        group: SyncedGroup::Preferences,
    }
}

const fn permission(key: &'static str) -> SyncedSetting {
    SyncedSetting {
        key,
        group: SyncedGroup::Permissions,
    }
}

/// Everything that syncs. Preferences are the Settings › Preferences pages
/// (General, Appearance, Input, Shortcuts) minus what belongs to the machine
/// (keeping it awake, the microphone); permissions are the mode and rules.
/// The Super Agent device switches stay per device.
pub const SYNCED_SETTINGS: &[SyncedSetting] = &[
    preference("app.language"),
    preference("appearance.selection"),
    preference("appearance.content_width"),
    preference("font"),
    preference("app.close_button_behavior"),
    preference("app.notifications.dialog_completion_notify"),
    preference("app.notifications.permission_request_notify"),
    preference("app.auto_update"),
    preference("app.flow_chat.auto_show_selection_toolbar"),
    preference("app.flow_chat.send_during_turn"),
    preference("app.ai_experience.voice_input.enabled"),
    preference("app.ai_experience.voice_input.default_language"),
    preference("app.ai_experience.voice_input.max_recording_seconds"),
    preference("app.keybindings"),
    permission("tool_permissions.policy.preset"),
    permission("tool_permissions.policy.rules"),
    permission("tool_permissions.interaction"),
    permission("tool_permissions.approval"),
    permission("app.flow_chat.show_permission_mode_control"),
];

pub fn is_synced_key(key: &str) -> bool {
    SYNCED_SETTINGS.iter().any(|setting| setting.key == key)
}

// ── The replica, as this module sees it ─────────────────────────────────

/// One record of the settings collection.
#[derive(Debug, Clone, PartialEq)]
pub struct ReplicaEntry {
    pub key: String,
    /// `None`: a tombstone.
    pub value: Option<Value>,
    /// Orders like the record's clock; equal stamps are the same write.
    pub stamp: String,
}

/// The replica's exchange state.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ReplicaState {
    /// Other runtime devices of the account that serve the replica.
    pub peers: usize,
    pub peers_online: usize,
    /// Local writes no peer acknowledged yet.
    pub undelivered: usize,
    pub exchanging: bool,
    pub last_exchange_ms: Option<u64>,
}

/// The account replica of the signed-in account on this device.
pub trait SettingsReplica: Send + Sync {
    fn account_id(&self) -> String;
    /// Every record of [`SETTINGS_COLLECTION`].
    fn entries(&self) -> Vec<ReplicaEntry>;
    /// A real write; returns the record's stamp (`None`: already stored).
    fn put(&self, key: &str, value: Value) -> Result<Option<String>>;
    /// An offer with the lowest clock (stored only when the key is absent).
    fn seed(&self, key: &str, value: Value) -> Result<Option<String>>;
    /// Changes of the replica (local writes and merged peer records).
    fn changes(&self) -> watch::Receiver<u64>;
    fn state(&self) -> ReplicaState;
}

/// Where the replica comes from (the device network's fleet layer).
pub trait ReplicaProvider: Send + Sync {
    /// `None` while signed out or while the device network is off.
    fn replica(&self) -> Option<Arc<dyn SettingsReplica>>;
    /// Whether an account is signed in (tells "signed out" from "offline").
    fn signed_in(&self) -> bool;
}

// ── Local side ───────────────────────────────────────────────────────────

/// The host's config, as the binder reads and changes it.
#[async_trait]
pub trait LocalSettings: Send + Sync {
    /// Whether account sync is switched on for this device.
    async fn enabled(&self) -> bool;
    /// The stored value at `key` (`None`: not stored).
    async fn read(&self, key: &str) -> Result<Option<Value>>;
    /// The value a fresh config has at `key` (`None`: none).
    async fn default_value(&self, key: &str) -> Option<Value>;
    /// Stores `value` at `key` through the host's typed settings mutation.
    async fn apply(&self, key: &str, value: &Value) -> Result<()>;
}

/// What the binder tells the host's UI.
pub trait SyncObserver: Send + Sync {
    /// Settings from the account were applied here (their keys).
    fn settings_applied(&self, keys: &[String]);
    /// The sync state changed.
    fn status_changed(&self, status: &SyncStatus);
}

/// Where the per-account binding state is kept.
#[async_trait]
pub trait SyncStateStore: Send + Sync {
    async fn load(&self, account_id: &str) -> Result<Option<SyncState>>;
    async fn save(&self, state: &SyncState) -> Result<()>;
}

/// One JSON file per account under a directory.
pub struct FileSyncStateStore {
    directory: PathBuf,
}

impl FileSyncStateStore {
    pub fn new(directory: impl Into<PathBuf>) -> Self {
        Self {
            directory: directory.into(),
        }
    }

    fn path(&self, account_id: &str) -> PathBuf {
        use sha2::Digest;
        let digest = sha2::Sha256::digest(account_id.as_bytes());
        let name: String = digest[..12]
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect();
        self.directory.join(format!("settings-{name}.json"))
    }
}

#[async_trait]
impl SyncStateStore for FileSyncStateStore {
    async fn load(&self, account_id: &str) -> Result<Option<SyncState>> {
        let path = self.path(account_id);
        let bytes = match tokio::fs::read(&path).await {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(anyhow!("read {}: {error}", path.display())),
        };
        match serde_json::from_slice::<SyncState>(&bytes) {
            Ok(state) if state.account_id == account_id => Ok(Some(state)),
            Ok(_) => Ok(None),
            Err(error) => {
                // An unreadable state only costs a fresh first sync; the file
                // is kept beside it for diagnosis.
                log::warn!("Account settings sync state unreadable, starting over: {error}");
                let _ = tokio::fs::rename(&path, path.with_extension("json.unreadable")).await;
                Ok(None)
            }
        }
    }

    async fn save(&self, state: &SyncState) -> Result<()> {
        tokio::fs::create_dir_all(&self.directory)
            .await
            .map_err(|error| anyhow!("create {}: {error}", self.directory.display()))?;
        let path = self.path(&state.account_id);
        let temporary = path.with_extension("json.tmp");
        tokio::fs::write(&temporary, serde_json::to_vec_pretty(state)?)
            .await
            .map_err(|error| anyhow!("write {}: {error}", temporary.display()))?;
        tokio::fs::rename(&temporary, &path)
            .await
            .map_err(|error| anyhow!("replace {}: {error}", path.display()))
    }
}

// ── State ────────────────────────────────────────────────────────────────

/// What this device last wrote or applied for one key.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct KeyState {
    /// The replica record's stamp at that point (empty: none).
    pub stamp: String,
    /// Digest of the local value at that point.
    pub digest: String,
}

/// The per-account binding state (persisted; every field tolerates absence).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SyncState {
    pub account_id: String,
    /// Whether this device offered its own values to the account once.
    pub seeded: bool,
    pub keys: BTreeMap<String, KeyState>,
}

impl SyncState {
    pub fn new(account_id: &str) -> Self {
        Self {
            account_id: account_id.to_string(),
            ..Self::default()
        }
    }
}

/// A stable digest of a JSON value (object keys sorted).
pub fn value_digest(value: &Value) -> String {
    fn canonical(value: &Value) -> Value {
        match value {
            Value::Object(fields) => {
                let mut entries: Vec<_> = fields.iter().collect();
                entries.sort_by(|left, right| left.0.cmp(right.0));
                Value::Object(
                    entries
                        .into_iter()
                        .map(|(key, value)| (key.clone(), canonical(value)))
                        .collect(),
                )
            }
            Value::Array(items) => Value::Array(items.iter().map(canonical).collect()),
            other => other.clone(),
        }
    }
    use sha2::Digest;
    let text = serde_json::to_string(&canonical(value)).unwrap_or_default();
    let digest = sha2::Sha256::digest(text.as_bytes());
    digest[..16]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn digest_of(value: Option<&Value>) -> String {
    value.map(value_digest).unwrap_or_default()
}

// ── Status ───────────────────────────────────────────────────────────────

/// Where sync stands, as Settings shows it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SyncPhase {
    /// Switched off on this device.
    Off,
    /// No account is signed in.
    SignedOut,
    /// Exchanging with the account's other devices.
    Syncing,
    /// Up to date with every reachable device (or the only device).
    Synced,
    /// No other device of the account is reachable (or the device network is
    /// off); changes wait and merge on reconnect.
    Offline,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    pub enabled: bool,
    pub phase: SyncPhase,
    /// Local writes waiting for another device.
    pub pending: usize,
    /// When another device last acknowledged an exchange (unix ms).
    pub last_synced_at_ms: Option<u64>,
    /// Other devices of the account that sync, and how many are online.
    pub peers: usize,
    pub peers_online: usize,
    /// Whether the "Synced with your account" caption applies (the backend
    /// decides): sync is on and the device takes part.
    pub active: bool,
    /// The groups that sync.
    pub groups: Vec<SyncedGroup>,
}

impl SyncStatus {
    fn of(enabled: bool, phase: SyncPhase, replica: Option<&ReplicaState>) -> Self {
        let replica = replica.cloned().unwrap_or_default();
        Self {
            enabled,
            phase,
            pending: replica.undelivered,
            last_synced_at_ms: replica.last_exchange_ms,
            peers: replica.peers,
            peers_online: replica.peers_online,
            active: enabled
                && matches!(
                    phase,
                    SyncPhase::Syncing | SyncPhase::Synced | SyncPhase::Offline
                ),
            groups: vec![SyncedGroup::Preferences, SyncedGroup::Permissions],
        }
    }
}

fn phase_of(state: &ReplicaState) -> SyncPhase {
    if state.peers == 0 {
        SyncPhase::Synced
    } else if state.peers_online == 0 {
        SyncPhase::Offline
    } else if state.undelivered > 0 || state.exchanging {
        SyncPhase::Syncing
    } else {
        SyncPhase::Synced
    }
}

// ── Binder ───────────────────────────────────────────────────────────────

/// The settings binder of one host process.
pub struct SettingsSync {
    local: Arc<dyn LocalSettings>,
    provider: Arc<dyn ReplicaProvider>,
    store: Arc<dyn SyncStateStore>,
    observer: Arc<dyn SyncObserver>,
    state: Mutex<Option<SyncState>>,
    status: watch::Sender<SyncStatus>,
    /// Wakes the loop: sign-in, sign-out, the switch, the device network.
    wake: tokio::sync::Notify,
}

impl SettingsSync {
    pub fn new(
        local: Arc<dyn LocalSettings>,
        provider: Arc<dyn ReplicaProvider>,
        store: Arc<dyn SyncStateStore>,
        observer: Arc<dyn SyncObserver>,
    ) -> Arc<Self> {
        Arc::new(Self {
            local,
            provider,
            store,
            observer,
            state: Mutex::new(None),
            status: watch::channel(SyncStatus::of(true, SyncPhase::Offline, None)).0,
            wake: tokio::sync::Notify::new(),
        })
    }

    pub fn status(&self) -> SyncStatus {
        let current = self.status.borrow().clone();
        if !current.enabled {
            return current;
        }
        if let Some(replica) = self.provider.replica() {
            let replica_state = replica.state();
            let phase = phase_of(&replica_state);
            let fresh = SyncStatus::of(true, phase, Some(&replica_state));
            if fresh != current {
                self.publish(fresh.clone());
            }
            return fresh;
        }
        current
    }

    pub fn subscribe_status(&self) -> watch::Receiver<SyncStatus> {
        self.status.subscribe()
    }

    /// A sign-in or sign-out, the switch, or the device network changed.
    pub fn wake(&self) {
        self.wake.notify_one();
    }

    fn publish(&self, status: SyncStatus) {
        let changed = self.status.send_if_modified(|current| {
            if *current == status {
                false
            } else {
                *current = status.clone();
                true
            }
        });
        if changed {
            self.observer.status_changed(&status);
        }
    }

    async fn save(&self, state: &SyncState) {
        if let Err(error) = self.store.save(state).await {
            log::warn!("Account settings sync state not saved: {error:#}");
        }
    }

    async fn local_value(&self, key: &str) -> Option<Value> {
        match self.local.read(key).await {
            Ok(value) => value,
            Err(error) => {
                log::debug!("Synced setting not read: key={key}, error={error:#}");
                None
            }
        }
    }

    /// Offers this device's non-default values once per account.
    async fn seed(&self, replica: &dyn SettingsReplica, state: &mut SyncState) {
        for setting in SYNCED_SETTINGS {
            let current = self.local_value(setting.key).await;
            if let Some(value) = current.as_ref() {
                let default = self.local.default_value(setting.key).await;
                if default.as_ref() != Some(value) {
                    if let Err(error) = replica.seed(setting.key, value.clone()) {
                        log::warn!(
                            "Synced setting not offered: key={}, error={error:#}",
                            setting.key
                        );
                    }
                }
            }
            state.keys.insert(
                setting.key.to_string(),
                KeyState {
                    stamp: String::new(),
                    digest: digest_of(current.as_ref()),
                },
            );
        }
        state.seeded = true;
    }

    /// One pass over the synced keys: local edits become writes, account
    /// values that changed apply here.
    pub async fn round(&self) -> SyncPhase {
        let enabled = self.local.enabled().await;
        if !enabled {
            self.publish(SyncStatus::of(false, SyncPhase::Off, None));
            return SyncPhase::Off;
        }
        let Some(replica) = self.provider.replica() else {
            let phase = if self.provider.signed_in() {
                SyncPhase::Offline
            } else {
                SyncPhase::SignedOut
            };
            self.publish(SyncStatus::of(true, phase, None));
            return phase;
        };
        let account_id = replica.account_id();
        let mut slot = self.state.lock().await;
        if slot.as_ref().map(|state| state.account_id.as_str()) != Some(account_id.as_str()) {
            let loaded = match self.store.load(&account_id).await {
                Ok(state) => state,
                Err(error) => {
                    log::warn!("Account settings sync state not read: {error:#}");
                    None
                }
            };
            *slot = Some(loaded.unwrap_or_else(|| SyncState::new(&account_id)));
        }
        let state = slot.as_mut().expect("state was just set");
        let before = state.clone();
        if !state.seeded {
            self.seed(replica.as_ref(), state).await;
        }

        // Local edits first: a value changed here since this device last
        // wrote or applied it is the newest write.
        for setting in SYNCED_SETTINGS {
            let Some(value) = self.local_value(setting.key).await else {
                continue;
            };
            let digest = value_digest(&value);
            let known = state.keys.get(setting.key).cloned().unwrap_or_default();
            if known.digest == digest {
                continue;
            }
            match replica.put(setting.key, value) {
                Ok(stamp) => {
                    let stamp = stamp.unwrap_or_else(|| {
                        replica
                            .entries()
                            .into_iter()
                            .find(|entry| entry.key == setting.key)
                            .map(|entry| entry.stamp)
                            .unwrap_or_default()
                    });
                    state
                        .keys
                        .insert(setting.key.to_string(), KeyState { stamp, digest });
                }
                Err(error) => log::warn!(
                    "Synced setting not written: key={}, error={error:#}",
                    setting.key
                ),
            }
        }

        // Account values that changed since this device last saw them.
        let mut applied = Vec::new();
        for entry in replica.entries() {
            if !is_synced_key(&entry.key) {
                continue;
            }
            let known = state.keys.get(&entry.key).cloned().unwrap_or_default();
            if known.stamp == entry.stamp {
                continue;
            }
            let current = self.local_value(&entry.key).await;
            let Some(value) = entry.value.as_ref() else {
                // Settings are never deleted; a tombstone only moves the mark.
                state.keys.insert(
                    entry.key.clone(),
                    KeyState {
                        stamp: entry.stamp.clone(),
                        digest: digest_of(current.as_ref()),
                    },
                );
                continue;
            };
            if current.as_ref().map(value_digest) != Some(value_digest(value)) {
                match self.local.apply(&entry.key, value).await {
                    Ok(()) => applied.push(entry.key.clone()),
                    Err(error) => log::warn!(
                        "Account setting not applied: key={}, error={error:#}",
                        entry.key
                    ),
                }
            }
            // Record what is stored now, so the apply is not a local edit.
            let stored = self.local_value(&entry.key).await;
            state.keys.insert(
                entry.key.clone(),
                KeyState {
                    stamp: entry.stamp.clone(),
                    digest: digest_of(stored.as_ref()),
                },
            );
        }
        let snapshot = (*state != before).then(|| state.clone());
        drop(slot);
        if let Some(snapshot) = snapshot {
            self.save(&snapshot).await;
        }
        if !applied.is_empty() {
            log::info!("Account settings applied: keys={}", applied.join(","));
            self.observer.settings_applied(&applied);
        }
        let replica_state = replica.state();
        let phase = phase_of(&replica_state);
        self.publish(SyncStatus::of(true, phase, Some(&replica_state)));
        phase
    }

    /// Lightweight status-only refresh from the current replica without
    /// re-reading or hashing local settings.
    fn refresh_status(&self) -> SyncPhase {
        let current = self.status.borrow().clone();
        if !current.enabled {
            return SyncPhase::Off;
        }
        let Some(replica) = self.provider.replica() else {
            let phase = if self.provider.signed_in() {
                SyncPhase::Offline
            } else {
                SyncPhase::SignedOut
            };
            self.publish(SyncStatus::of(true, phase, None));
            return phase;
        };
        let replica_state = replica.state();
        let phase = phase_of(&replica_state);
        self.publish(SyncStatus::of(true, phase, Some(&replica_state)));
        phase
    }

    /// Runs rounds until the process ends: after a local change (debounced),
    /// a replica change, or an explicit wake. While actively syncing, only
    /// lightweight status checks run until delivery settles; idle phases do
    /// not poll.
    pub async fn run(self: Arc<Self>, local_changes: watch::Receiver<()>) {
        let mut changes = LocalChanges {
            receiver: local_changes,
            alive: true,
        };
        let mut replica_changes: Option<(String, watch::Receiver<u64>)> = None;
        let mut run_full_round = true;
        loop {
            let phase = if run_full_round {
                self.round().await
            } else {
                self.refresh_status()
            };
            // Follow the current replica's changes (it moves with the account).
            match self.provider.replica() {
                Some(replica) => {
                    let account = replica.account_id();
                    if replica_changes.as_ref().map(|(id, _)| id) != Some(&account) {
                        replica_changes = Some((account, replica.changes()));
                    }
                }
                None => replica_changes = None,
            }
            let replica_changed = async {
                match replica_changes.as_mut() {
                    Some((_, receiver)) => {
                        if receiver.changed().await.is_err() {
                            std::future::pending::<()>().await;
                        }
                    }
                    None => std::future::pending::<()>().await,
                }
            };
            let active_status_tick = async {
                if phase == SyncPhase::Syncing {
                    tokio::time::sleep(ACTIVE_STATUS_POLL).await;
                } else {
                    std::future::pending::<()>().await;
                }
            };
            run_full_round = tokio::select! {
                _ = changes.next() => true,
                _ = replica_changed => true,
                _ = self.wake.notified() => true,
                _ = active_status_tick => false,
            };
        }
    }
}

/// The config's local-change signal, debounced.
struct LocalChanges {
    receiver: watch::Receiver<()>,
    alive: bool,
}

impl LocalChanges {
    /// The next burst of local changes, once it has been quiet for
    /// [`LOCAL_DEBOUNCE`]. Never resolves once the config service is gone.
    async fn next(&mut self) {
        if !self.alive || self.receiver.changed().await.is_err() {
            self.alive = false;
            return std::future::pending().await;
        }
        loop {
            match tokio::time::timeout(LOCAL_DEBOUNCE, self.receiver.changed()).await {
                Ok(Ok(())) => continue,
                Ok(Err(_)) => {
                    self.alive = false;
                    return;
                }
                Err(_) => return,
            }
        }
    }
}

#[cfg(test)]
#[path = "settings_sync_tests.rs"]
mod tests;

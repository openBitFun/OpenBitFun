//! Persistent desktop card storage.
//!
//! A card has two halves that are stored apart:
//!
//! - its **definition** (title, template, data, data source, link, origin),
//!   behind [`CardDefinitionStore`]. Today that is the device's
//!   `desktop-cards/cards.json` ([`FileCardDefinitions`]); a later step can move
//!   definitions to the account replica without touching the service or the UI.
//! - its **local state** (window position and size, visibility, stacking,
//!   desktop pinning and the last fetched data), which always stays on the
//!   device that shows the card ([`LocalStateStore`],
//!   `desktop-cards/local-state.json`).
//!
//! [`CardStore`] joins both into the `DesktopCardRecord` every command and the
//! Agent tool already speak. The display fields inside a stored definition are
//! the values the card was created with; once a card exists, only the local
//! state changes them, so the definition file never carries one device's
//! window geometry. A card without a local entry (every card written by an
//! older build) shows with the display fields its record already has.
//!
//! Both files are read by older and newer builds. Cards this build cannot
//! parse are kept verbatim and written back unchanged, unknown fields survive a
//! rewrite, and an unreadable file is moved aside instead of being overwritten.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use openbitfun_core::agentic::tools::desktop_card_host::{
    DesktopCardDataSnapshot, DesktopCardPosition, DesktopCardRecord, DesktopCardSize,
    DESKTOP_CARD_STORE_VERSION,
};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{Map, Value};

/// Extension-map keys that are device-local display state.
pub(crate) const LOCAL_EXTRA_KEYS: [&str; 3] = [
    super::DESKTOP_PINNED_KEY,
    super::PIN_RESTORE_ON_TOP_KEY,
    super::PIN_FAILURE_KEY,
];

const LOCAL_STATE_VERSION: u32 = 1;

/// Where card definitions live. Implementations keep records they cannot
/// parse and fields they do not know.
pub(crate) trait CardDefinitionStore: Send {
    fn definitions(&self) -> Vec<DesktopCardRecord>;
    fn definition(&self, id: &str) -> Option<DesktopCardRecord>;
    /// Inserts a new definition or replaces the one with the same id.
    fn put_definition(&mut self, card: DesktopCardRecord);
    fn remove_definition(&mut self, id: &str) -> Option<DesktopCardRecord>;
    fn save(&mut self) -> Result<(), String>;
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub(crate) enum StoredCard {
    Card(Box<DesktopCardRecord>),
    Raw(Value),
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopCardsFile {
    #[serde(default)]
    pub version: u32,
    #[serde(default)]
    pub cards: Vec<StoredCard>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

/// Card definitions in the device's `cards.json` (format v1, unchanged).
pub(crate) struct FileCardDefinitions {
    path: PathBuf,
    file: DesktopCardsFile,
}

impl FileCardDefinitions {
    pub(crate) fn load(path: PathBuf) -> Self {
        let file = load_json_file::<DesktopCardsFile>(&path, "desktop card store");
        Self { path, file }
    }

    fn cards(&self) -> impl Iterator<Item = &DesktopCardRecord> {
        self.file.cards.iter().filter_map(|card| match card {
            StoredCard::Card(card) => Some(card.as_ref()),
            StoredCard::Raw(_) => None,
        })
    }
}

impl CardDefinitionStore for FileCardDefinitions {
    fn definitions(&self) -> Vec<DesktopCardRecord> {
        self.cards().cloned().collect()
    }

    fn definition(&self, id: &str) -> Option<DesktopCardRecord> {
        self.cards().find(|card| card.id == id).cloned()
    }

    fn put_definition(&mut self, card: DesktopCardRecord) {
        let existing = self.file.cards.iter_mut().find_map(|stored| match stored {
            StoredCard::Card(stored) if stored.id == card.id => Some(stored),
            _ => None,
        });
        match existing {
            Some(stored) => **stored = card,
            None => self.file.cards.push(StoredCard::Card(Box::new(card))),
        }
    }

    fn remove_definition(&mut self, id: &str) -> Option<DesktopCardRecord> {
        let index = self
            .file
            .cards
            .iter()
            .position(|card| matches!(card, StoredCard::Card(card) if card.id == id))?;
        match self.file.cards.remove(index) {
            StoredCard::Card(card) => Some(*card),
            StoredCard::Raw(_) => None,
        }
    }

    fn save(&mut self) -> Result<(), String> {
        self.file.version = self.file.version.max(DESKTOP_CARD_STORE_VERSION);
        let bytes = serde_json::to_vec_pretty(&self.file)
            .map_err(|error| format!("Failed to serialize desktop cards: {error}"))?;
        write_atomically(&self.path, &bytes)
    }
}

/// One card's device-local state. Every field is optional so a partial or
/// newer entry still reads.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CardLocalState {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub position: Option<DesktopCardPosition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<DesktopCardSize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visible: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub always_on_top: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_data: Option<DesktopCardDataSnapshot>,
    /// Desktop pinning and its bookkeeping (`LOCAL_EXTRA_KEYS`).
    #[serde(default, skip_serializing_if = "Map::is_empty")]
    pub display: Map<String, Value>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

impl CardLocalState {
    fn from_record(card: &DesktopCardRecord, previous: Option<&CardLocalState>) -> Self {
        let mut display = Map::new();
        for key in LOCAL_EXTRA_KEYS {
            if let Some(value) = card.extra.get(key) {
                display.insert(key.to_string(), value.clone());
            }
        }
        Self {
            position: card.position,
            size: card.size,
            visible: Some(card.visible),
            always_on_top: Some(card.always_on_top),
            last_data: card.last_data.clone(),
            display,
            extra: previous
                .map(|state| state.extra.clone())
                .unwrap_or_default(),
        }
    }

    fn apply_to(&self, card: &mut DesktopCardRecord) {
        if self.position.is_some() {
            card.position = self.position;
        }
        if self.size.is_some() {
            card.size = self.size;
        }
        if let Some(visible) = self.visible {
            card.visible = visible;
        }
        if let Some(always_on_top) = self.always_on_top {
            card.always_on_top = always_on_top;
        }
        // The local entry owns the snapshot once it exists (a changed data
        // source clears it there).
        card.last_data = self.last_data.clone();
        for key in LOCAL_EXTRA_KEYS {
            match self.display.get(key) {
                Some(value) => {
                    card.extra.insert(key.to_string(), value.clone());
                }
                None => {
                    card.extra.remove(key);
                }
            }
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalStateFile {
    #[serde(default)]
    pub version: u32,
    #[serde(default)]
    pub cards: BTreeMap<String, Value>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

/// Device-local card state in `local-state.json`.
pub(crate) struct LocalStateStore {
    path: PathBuf,
    file: LocalStateFile,
}

impl LocalStateStore {
    pub(crate) fn load(path: PathBuf) -> Self {
        let file = load_json_file::<LocalStateFile>(&path, "desktop card local state");
        Self { path, file }
    }

    pub(crate) fn get(&self, id: &str) -> Option<CardLocalState> {
        let value = self.file.cards.get(id)?;
        match serde_json::from_value::<CardLocalState>(value.clone()) {
            Ok(state) => Some(state),
            Err(error) => {
                log::debug!(
                    "Desktop card local state unreadable, using the definition: card_id={}, error={}",
                    id,
                    error
                );
                None
            }
        }
    }

    pub(crate) fn put(&mut self, id: &str, state: &CardLocalState) {
        match serde_json::to_value(state) {
            Ok(value) => {
                self.file.cards.insert(id.to_string(), value);
            }
            Err(error) => log::warn!(
                "Failed to serialize desktop card local state: card_id={}, error={}",
                id,
                error
            ),
        }
    }

    pub(crate) fn remove(&mut self, id: &str) {
        self.file.cards.remove(id);
    }

    pub(crate) fn save(&mut self) -> Result<(), String> {
        self.file.version = self.file.version.max(LOCAL_STATE_VERSION);
        let bytes = serde_json::to_vec_pretty(&self.file)
            .map_err(|error| format!("Failed to serialize desktop card state: {error}"))?;
        write_atomically(&self.path, &bytes)
    }
}

/// The card records the service works with: definitions joined with this
/// device's local state.
pub(crate) struct CardStore {
    definitions: Box<dyn CardDefinitionStore>,
    local: LocalStateStore,
    definitions_dirty: bool,
    local_dirty: bool,
}

impl CardStore {
    pub(crate) fn new(definitions: Box<dyn CardDefinitionStore>, local: LocalStateStore) -> Self {
        Self {
            definitions,
            local,
            definitions_dirty: false,
            local_dirty: false,
        }
    }

    /// The device store under `desktop-cards/`.
    pub(crate) fn load_dir(dir: &Path) -> Self {
        Self::new(
            Box::new(FileCardDefinitions::load(dir.join("cards.json"))),
            LocalStateStore::load(dir.join("local-state.json")),
        )
    }

    fn join(&self, mut card: DesktopCardRecord) -> DesktopCardRecord {
        if let Some(state) = self.local.get(&card.id) {
            state.apply_to(&mut card);
        }
        card
    }

    /// The definitions alone (no device-local state): what the account
    /// replica carries (`desktop_cards::replica`).
    pub(crate) fn definitions(&self) -> Vec<DesktopCardRecord> {
        self.definitions.definitions()
    }

    pub(crate) fn card_count(&self) -> usize {
        self.definitions.definitions().len()
    }

    pub(crate) fn get(&self, id: &str) -> Option<DesktopCardRecord> {
        self.definitions.definition(id).map(|card| self.join(card))
    }

    pub(crate) fn snapshot(&self) -> Vec<DesktopCardRecord> {
        self.definitions
            .definitions()
            .into_iter()
            .map(|card| self.join(card))
            .collect()
    }

    /// Stores a joined record: its definition fields go to the definition
    /// store, its display fields to the local state.
    pub(crate) fn put(&mut self, card: DesktopCardRecord) {
        let previous_local = self.local.get(&card.id);
        let local = CardLocalState::from_record(&card, previous_local.as_ref());
        let definition_changed = match self.definitions.definition(&card.id) {
            Some(existing) => {
                let updated = definition_keeping_display(card.clone(), &existing);
                if updated != existing {
                    self.definitions.put_definition(updated);
                    true
                } else {
                    false
                }
            }
            None => {
                self.definitions.put_definition(card.clone());
                true
            }
        };
        if definition_changed {
            self.definitions_dirty = true;
        }
        self.local.put(&card.id, &local);
        self.local_dirty = true;
    }

    pub(crate) fn remove(&mut self, id: &str) -> Option<DesktopCardRecord> {
        let removed = self.get(id);
        self.definitions.remove_definition(id)?;
        self.local.remove(id);
        self.definitions_dirty = true;
        self.local_dirty = true;
        removed
    }

    /// Saves only the dirty halves; the first failure is reported after both tried.
    pub(crate) fn save(&mut self) -> Result<(), String> {
        let definitions = if self.definitions_dirty {
            let res = self.definitions.save();
            if res.is_ok() {
                self.definitions_dirty = false;
            }
            res
        } else {
            Ok(())
        };
        let local = if self.local_dirty {
            let res = self.local.save();
            if res.is_ok() {
                self.local_dirty = false;
            }
            res
        } else {
            Ok(())
        };
        definitions.and(local)
    }
}

/// `card` with the display fields of the stored definition: only the local
/// state changes those once a card exists.
fn definition_keeping_display(
    mut card: DesktopCardRecord,
    existing: &DesktopCardRecord,
) -> DesktopCardRecord {
    card.position = existing.position;
    card.size = existing.size;
    card.visible = existing.visible;
    card.always_on_top = existing.always_on_top;
    card.last_data = existing.last_data.clone();
    for key in LOCAL_EXTRA_KEYS {
        match existing.extra.get(key) {
            Some(value) => {
                card.extra.insert(key.to_string(), value.clone());
            }
            None => {
                card.extra.remove(key);
            }
        }
    }
    card
}

fn load_json_file<T: DeserializeOwned + Default>(path: &Path, what: &str) -> T {
    match std::fs::read(path) {
        Ok(bytes) => match serde_json::from_slice::<T>(&bytes) {
            Ok(file) => file,
            Err(error) => {
                let backup = corrupt_backup_path(path);
                log::warn!(
                    "The {} is unreadable, moving it aside: path={}, backup={}, error={}",
                    what,
                    path.display(),
                    backup.display(),
                    error
                );
                if let Err(error) = std::fs::rename(path, &backup) {
                    log::warn!(
                        "Failed to move the unreadable {} aside: error={}",
                        what,
                        error
                    );
                }
                T::default()
            }
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => T::default(),
        Err(error) => {
            log::warn!(
                "Failed to read the {}: path={}, error={}",
                what,
                path.display(),
                error
            );
            T::default()
        }
    }
}

fn corrupt_backup_path(path: &Path) -> PathBuf {
    let stamp = chrono::Utc::now().format("%Y%m%d%H%M%S");
    path.with_extension(format!("json.corrupt-{stamp}"))
}

fn write_atomically(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create desktop card directory: {error}"))?;
    }
    let temp = path.with_extension("json.tmp");
    std::fs::write(&temp, bytes)
        .map_err(|error| format!("Failed to write desktop cards: {error}"))?;
    std::fs::rename(&temp, path).map_err(|error| format!("Failed to save desktop cards: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn temp_dir(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "openbitfun-desktop-cards-{}-{}",
            name,
            uuid::Uuid::new_v4().simple()
        ))
    }

    #[test]
    fn desktop_pinning_is_additive_and_survives_legacy_record_rewrites() {
        let legacy = json!({
            "id": "a", "title": "Note", "template": { "kind": "note", "text": "x" }
        });
        let record: DesktopCardRecord = serde_json::from_value(legacy.clone()).unwrap();
        assert!(record.always_on_top);
        assert!(!super::super::desktop_pinned(&record));
        let rewritten = serde_json::to_value(record).unwrap();
        for (key, value) in legacy.as_object().unwrap() {
            assert_eq!(&rewritten[key], value);
        }

        let mut pinned = legacy;
        pinned["alwaysOnTop"] = json!(false);
        pinned["desktopPinned"] = json!(true);
        let mut record: DesktopCardRecord = serde_json::from_value(pinned).unwrap();
        assert!(super::super::desktop_pinned(&record));
        record.title = "Renamed by an older client".to_string();
        let restored: DesktopCardRecord =
            serde_json::from_value(serde_json::to_value(record).unwrap()).unwrap();
        assert!(super::super::desktop_pinned(&restored));
        assert_eq!(restored.extra["desktopPinned"], json!(true));
    }

    #[test]
    fn a_legacy_v1_store_reads_unchanged_and_keeps_unknown_fields() {
        let dir = temp_dir("legacy");
        std::fs::create_dir_all(&dir).unwrap();
        let original = json!({
            "version": 1,
            "cards": [
                {
                    "id": "a", "title": "Note", "template": { "kind": "note", "text": "x" },
                    "position": { "x": 40.0, "y": 60.0 }, "visible": false,
                    "lastData": { "fetchedAtMs": 5, "value": 1 },
                    "futureField": { "kept": true }
                },
                { "broken": true },
            ],
            "layoutHints": { "grid": true }
        });
        std::fs::write(
            dir.join("cards.json"),
            serde_json::to_vec(&original).unwrap(),
        )
        .unwrap();

        let mut store = CardStore::load_dir(&dir);
        assert_eq!(store.card_count(), 1);
        let card = store.get("a").unwrap();
        // A card without a local entry shows with the display fields it has.
        assert_eq!(
            card.position,
            Some(DesktopCardPosition { x: 40.0, y: 60.0 })
        );
        assert!(!card.visible);
        assert_eq!(card.extra["futureField"], json!({ "kept": true }));

        // Moving and showing it changes only the local state.
        let mut moved = card.clone();
        moved.position = Some(DesktopCardPosition { x: 400.0, y: 10.0 });
        moved.visible = true;
        moved.title = "Renamed".to_string();
        store.put(moved);
        store.save().unwrap();

        let written: Value =
            serde_json::from_slice(&std::fs::read(dir.join("cards.json")).unwrap()).unwrap();
        assert_eq!(written["version"], json!(1));
        assert_eq!(written["cards"][0]["title"], json!("Renamed"));
        assert_eq!(
            written["cards"][0]["position"],
            json!({ "x": 40.0, "y": 60.0 })
        );
        assert_eq!(written["cards"][0]["visible"], json!(false));
        assert_eq!(written["cards"][0]["futureField"], json!({ "kept": true }));
        assert_eq!(written["cards"][1], json!({ "broken": true }));
        assert_eq!(written["layoutHints"], json!({ "grid": true }));

        let local: Value =
            serde_json::from_slice(&std::fs::read(dir.join("local-state.json")).unwrap()).unwrap();
        assert_eq!(
            local["cards"]["a"]["position"],
            json!({ "x": 400.0, "y": 10.0 })
        );
        assert_eq!(local["cards"]["a"]["visible"], json!(true));

        // Reloaded, the joined record is the moved one.
        let reloaded = CardStore::load_dir(&dir);
        let card = reloaded.get("a").unwrap();
        assert_eq!(
            card.position,
            Some(DesktopCardPosition { x: 400.0, y: 10.0 })
        );
        assert!(card.visible);
        assert_eq!(card.title, "Renamed");
        assert_eq!(
            card.last_data.as_ref().map(|data| data.fetched_at_ms),
            Some(5)
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn local_pinning_keys_do_not_leak_into_the_definition() {
        let dir = temp_dir("pin");
        let mut store = CardStore::load_dir(&dir);
        let card: DesktopCardRecord = serde_json::from_value(json!({
            "id": "b", "title": "Pin", "template": { "kind": "note", "text": "x" }
        }))
        .unwrap();
        store.put(card.clone());
        let mut pinned = card;
        pinned.always_on_top = false;
        pinned
            .extra
            .insert(super::super::DESKTOP_PINNED_KEY.to_string(), json!(true));
        store.put(pinned);
        store.save().unwrap();
        let written: Value =
            serde_json::from_slice(&std::fs::read(dir.join("cards.json")).unwrap()).unwrap();
        assert!(written["cards"][0].get("desktopPinned").is_none());
        assert_eq!(written["cards"][0]["alwaysOnTop"], json!(true));
        let joined = CardStore::load_dir(&dir).get("b").unwrap();
        assert!(super::super::desktop_pinned(&joined));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn unreadable_store_is_moved_aside_not_overwritten() {
        let dir = temp_dir("corrupt");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("cards.json"), b"{not json").unwrap();

        let mut store = CardStore::load_dir(&dir);
        assert_eq!(store.card_count(), 0);
        store.save().unwrap();

        let backups = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().contains("corrupt"))
            .count();
        assert_eq!(backups, 1);
        let _ = std::fs::remove_dir_all(dir);
    }
}

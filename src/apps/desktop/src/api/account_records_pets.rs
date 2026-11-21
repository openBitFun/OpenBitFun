//! Pets on the account replica (`pets`, wave24-replica).
//!
//! - Every imported pet package (`<user data>/agent-companions/pet-<id>/`,
//!   read in place) is a record `pkg:<dir>` whose files (`pet.json` and the
//!   sprite sheet, up to 32 MiB) are content blobs, chunked to the replica's
//!   blob limit, pinned by two devices and fetched on demand elsewhere. The
//!   import receipt (it names a device path) stays local.
//! - The pet choice is the record `selection`: a built-in pet by its
//!   logical path, an imported one by its package directory, never by a
//!   device path; each device resolves it to its own copy of the package.

use std::path::PathBuf;
use std::sync::Arc;

use anyhow::{anyhow, Result};
use async_trait::async_trait;
use openbitfun_core::service::config::types::AgentCompanionPetSelection;
use openbitfun_core::service::config::ConfigService;
use openbitfun_core::service::remote_connect::account_records::{
    read_tree, replace_tree, valid_record_id, ApplyContext, DeviceContext, LocalCollection,
    LocalItem, RemoteItem, TreeLimits, PETS_COLLECTION,
};
use serde_json::{json, Value};

const SELECTION_PATH: &str = "app.ai_experience.agent_companion_pet";
const SELECTION_ID: &str = "selection";
const BUILTIN_PREFIX: &str = "builtin:";
/// A package is a manifest and one sprite sheet (32 MiB at most).
const PACKAGE_LIMITS: TreeLimits = TreeLimits {
    max_files: 8,
    max_bytes: 33 * 1024 * 1024,
};

/// Where the device keeps its pet choice.
#[async_trait]
pub(crate) trait PetChoice: Send + Sync {
    async fn get(&self) -> Option<AgentCompanionPetSelection>;
    async fn set(&self, selection: AgentCompanionPetSelection) -> Result<()>;
}

#[async_trait]
impl PetChoice for ConfigService {
    async fn get(&self) -> Option<AgentCompanionPetSelection> {
        self.get_config::<Option<AgentCompanionPetSelection>>(Some(SELECTION_PATH))
            .await
            .ok()
            .flatten()
    }

    async fn set(&self, selection: AgentCompanionPetSelection) -> Result<()> {
        self.set_config(SELECTION_PATH, selection)
            .await
            .map_err(|error| anyhow!("write {SELECTION_PATH}: {error}"))
    }
}

pub(crate) struct PetRecords {
    root: PathBuf,
    choice: Arc<dyn PetChoice>,
}

impl PetRecords {
    pub(crate) fn new(root: PathBuf, choice: Arc<dyn PetChoice>) -> Self {
        Self { root, choice }
    }

    async fn selection(&self) -> Option<AgentCompanionPetSelection> {
        self.choice.get().await
    }

    fn package_dir(&self, name: &str) -> Option<PathBuf> {
        (name.starts_with("pet-") && valid_record_id(name) && !name.contains('/'))
            .then(|| self.root.join(name))
    }

    /// The selection as the account names it.
    fn selection_record(&self, selection: &AgentCompanionPetSelection) -> Option<Value> {
        if selection.package_path.starts_with(BUILTIN_PREFIX) {
            return serde_json::to_value(selection)
                .ok()
                .map(|value| json!({ "kind": "builtin", "pet": value }));
        }
        let package = PathBuf::from(&selection.package_path);
        let name = package.file_name()?.to_string_lossy().to_string();
        if package.parent()? != self.root.as_path() || self.package_dir(&name).is_none() {
            return None;
        }
        let sprite = PathBuf::from(&selection.spritesheet_path)
            .file_name()?
            .to_string_lossy()
            .to_string();
        Some(json!({
            "kind": "imported",
            "package": name,
            "spritesheetFile": sprite,
            "id": selection.id,
            "displayName": selection.display_name,
            "description": selection.description,
            "source": selection.source,
            "spritesheetMimeType": selection.spritesheet_mime_type,
            "spriteVersionNumber": selection.sprite_version_number,
        }))
    }
}

fn default_selection() -> Option<AgentCompanionPetSelection> {
    openbitfun_core::service::config::types::GlobalConfig::default()
        .app
        .ai_experience
        .agent_companion_pet
}

#[async_trait]
impl LocalCollection for PetRecords {
    fn collection(&self) -> &'static str {
        PETS_COLLECTION
    }

    async fn list(&self, _device: &DeviceContext) -> Result<Vec<LocalItem>> {
        let mut items = Vec::new();
        let mut entries: Vec<_> = std::fs::read_dir(&self.root)
            .map(|entries| entries.flatten().collect())
            .unwrap_or_default();
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            let name = entry.file_name().to_string_lossy().to_string();
            if self.package_dir(&name).is_none()
                || !entry.file_type().is_ok_and(|kind| kind.is_dir())
            {
                continue;
            }
            let Ok(dto) = super::commands::pet_package_dto_from_dir(&entry.path(), "imported")
            else {
                continue;
            };
            let Some(files) = read_tree(&entry.path(), PACKAGE_LIMITS) else {
                log::debug!("Pet package stays on this device (over the sync limits): {name}");
                continue;
            };
            items.push(
                LocalItem::new(
                    format!("pkg:{name}"),
                    json!({
                        "displayName": dto.display_name,
                        "description": dto.description,
                        "spriteVersionNumber": dto.sprite_version_number,
                    }),
                )
                .with_files(files),
            );
        }
        if let Some(selection) = self.selection().await {
            if let Some(value) = self.selection_record(&selection) {
                let is_default = default_selection().as_ref() == Some(&selection);
                items.push(LocalItem::new(SELECTION_ID, value).offered(!is_default));
            }
        }
        Ok(items)
    }

    async fn apply(&self, item: &RemoteItem, _context: &ApplyContext) -> Result<()> {
        if let Some(name) = item.id.strip_prefix("pkg:") {
            let dir = self
                .package_dir(name)
                .ok_or_else(|| anyhow!("invalid pet package {name}"))?;
            replace_tree(&dir, &item.files)?;
            if let Err(error) = super::commands::pet_package_dto_from_dir(&dir, "imported") {
                let _ = std::fs::remove_dir_all(&dir);
                return Err(anyhow!("account pet package is not valid here: {error}"));
            }
            return Ok(());
        }
        if item.id != SELECTION_ID {
            return Err(anyhow!("unknown pets record {}", item.id));
        }
        let selection: AgentCompanionPetSelection = match item.value["kind"].as_str() {
            Some("builtin") => serde_json::from_value(item.value["pet"].clone())?,
            Some("imported") => {
                let name = item.value["package"].as_str().unwrap_or_default();
                let dir = self
                    .package_dir(name)
                    .filter(|dir| dir.is_dir())
                    // Retried once the package's content reached this device.
                    .ok_or_else(|| anyhow!("pet package {name} not here yet"))?;
                let sprite = item.value["spritesheetFile"].as_str().unwrap_or_default();
                let value = &item.value;
                AgentCompanionPetSelection {
                    id: value["id"].as_str().unwrap_or_default().to_string(),
                    display_name: value["displayName"]
                        .as_str()
                        .unwrap_or_default()
                        .to_string(),
                    description: value["description"].as_str().map(str::to_string),
                    source: value["source"].as_str().unwrap_or("imported").to_string(),
                    package_path: dir.to_string_lossy().to_string(),
                    spritesheet_path: dir.join(sprite).to_string_lossy().to_string(),
                    spritesheet_mime_type: value["spritesheetMimeType"]
                        .as_str()
                        .unwrap_or_default()
                        .to_string(),
                    sprite_version_number: value["spriteVersionNumber"]
                        .as_u64()
                        .map(|version| version as u32),
                }
            }
            other => return Err(anyhow!("unknown pet selection kind {other:?}")),
        };
        self.choice.set(selection).await
    }

    async fn remove(&self, id: &str) -> Result<()> {
        if let Some(name) = id.strip_prefix("pkg:") {
            if let Some(dir) = self.package_dir(name).filter(|dir| dir.is_dir()) {
                std::fs::remove_dir_all(&dir)
                    .map_err(|error| anyhow!("remove {}: {error}", dir.display()))?;
            }
        }
        // The choice is never deleted; a later choice replaces it.
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::super::account_records_api::test_harness::*;
    use super::*;
    use openbitfun_core::service::remote_connect::account_records::collection_budget;

    /// The device's pet choice (the config path's value).
    #[derive(Default)]
    struct Choice(std::sync::Mutex<Option<AgentCompanionPetSelection>>);

    #[async_trait]
    impl PetChoice for Choice {
        async fn get(&self) -> Option<AgentCompanionPetSelection> {
            self.0.lock().unwrap().clone().or_else(default_selection)
        }
        async fn set(&self, selection: AgentCompanionPetSelection) -> Result<()> {
            *self.0.lock().unwrap() = Some(selection);
            Ok(())
        }
    }

    impl Choice {
        async fn set_config(
            &self,
            _path: &str,
            selection: AgentCompanionPetSelection,
        ) -> Result<()> {
            self.set(selection).await
        }
    }

    struct Side {
        dir: tempfile::TempDir,
        config: Arc<Choice>,
        device: Device,
    }

    async fn side(id: &str) -> Side {
        let dir = tempfile::tempdir().unwrap();
        let config = Arc::new(Choice::default());
        let binding = PetRecords::new(
            dir.path().join("agent-companions"),
            Arc::clone(&config) as Arc<dyn PetChoice>,
        );
        Side {
            device: device(id, Arc::new(binding)),
            dir,
            config,
        }
    }

    fn root(side: &Side) -> PathBuf {
        side.dir.path().join("agent-companions")
    }

    /// A 1.x imported package: manifest, sprite sheet and import receipt.
    fn import(side: &Side, name: &str, sprite: &[u8]) {
        let dir = root(side).join(name);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("pet.json"),
            serde_json::to_vec(&json!({
                "id": "otter", "displayName": "Otter", "spritesheetPath": "spritesheet.webp", "spriteVersionNumber": 1
            }))
            .unwrap(),
        )
        .unwrap();
        std::fs::write(dir.join("spritesheet.webp"), sprite).unwrap();
        std::fs::write(
            dir.join(".openbitfun-import.json"),
            r#"{"schema_version":1,"source_key":"/Users/a/Downloads/otter.zip"}"#,
        )
        .unwrap();
    }

    fn sprite(bytes: usize) -> Vec<u8> {
        (0..bytes).map(|i| (i * 31 % 251) as u8).collect()
    }

    async fn select_imported(side: &Side, name: &str) {
        let dir = root(side).join(name);
        side.config
            .set_config(
                SELECTION_PATH,
                AgentCompanionPetSelection {
                    id: "otter".into(),
                    display_name: "Otter".into(),
                    description: None,
                    source: "imported".into(),
                    package_path: dir.to_string_lossy().to_string(),
                    spritesheet_path: dir.join("spritesheet.webp").to_string_lossy().to_string(),
                    spritesheet_mime_type: "image/webp".into(),
                    sprite_version_number: Some(1),
                },
            )
            .await
            .unwrap();
    }

    async fn selection(side: &Side) -> AgentCompanionPetSelection {
        side.config.get().await.unwrap()
    }

    #[tokio::test]
    async fn an_imported_pet_and_the_choice_reach_another_device_by_package_not_path() {
        let a = side("a").await;
        let b = side("b").await;
        // Large enough to travel in several chunks.
        let big = sprite(9 * 1024 * 1024);
        import(&a, "pet-0a1b2c", &big);
        select_imported(&a, "pet-0a1b2c").await;
        settle(&[&a.device, &b.device]).await;
        let package = live(&a.device, PETS_COLLECTION)
            .into_iter()
            .find(|record| record.id == "pkg:pet-0a1b2c")
            .unwrap();
        assert!(package.blobs.len() >= 3, "{}", package.blobs.len());
        assert_eq!(
            std::fs::read(root(&b).join("pet-0a1b2c/spritesheet.webp")).unwrap(),
            big
        );
        assert!(!root(&b).join("pet-0a1b2c/.openbitfun-import.json").exists());
        let on_b = selection(&b).await;
        assert_eq!(
            PathBuf::from(&on_b.package_path),
            root(&b).join("pet-0a1b2c")
        );
        let text = replica_text(&a.device);
        assert!(
            !text.contains(&root(&a).to_string_lossy().to_string()),
            "no device path"
        );
        assert!(!text.contains("Downloads/otter.zip"));
        // Every device that holds the package pins it.
        for hash in &package.blobs {
            assert!(a.device.replica.is_pinned(hash));
        }
        // The old package still reads on a.
        assert!(super::super::commands::pet_package_dto_from_dir(
            &root(&a).join("pet-0a1b2c"),
            "imported"
        )
        .is_ok());
    }

    #[tokio::test]
    async fn concurrent_choices_converge_and_a_deleted_package_goes_everywhere() {
        let a = side("a").await;
        let b = side("b").await;
        import(&a, "pet-0a1b2c", &sprite(1024));
        settle(&[&a.device, &b.device]).await;
        // a picks the imported pet, b a built-in one, later.
        select_imported(&a, "pet-0a1b2c").await;
        a.device.sync.round().await;
        std::thread::sleep(std::time::Duration::from_millis(3));
        let mut builtin = default_selection().unwrap();
        builtin.id = "pixel".into();
        builtin.package_path = "builtin:pixel".into();
        builtin.spritesheet_path = "builtin:pixel/spritesheet.webp".into();
        b.config
            .set_config(SELECTION_PATH, builtin.clone())
            .await
            .unwrap();
        b.device.sync.round().await;
        settle(&[&a.device, &b.device]).await;
        assert_eq!(selection(&a).await, builtin);
        assert_eq!(selection(&b).await, builtin);
        std::fs::remove_dir_all(root(&b).join("pet-0a1b2c")).unwrap();
        settle(&[&a.device, &b.device]).await;
        assert!(!root(&a).join("pet-0a1b2c").exists());
    }

    #[tokio::test]
    async fn pets_never_carry_a_secret_and_keep_their_budget() {
        let a = side("a").await;
        // A manifest field named like a secret is refused, the package stays.
        let dir = root(&a).join("pet-leaky");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("pet.json"),
            br#"{"id":"leak","displayName":"Leak","spritesheetPath":"s.webp","apiToken":"ghp_abcdefghijklmnopqrstuvwxyz0123456789"}"#,
        )
        .unwrap();
        std::fs::write(dir.join("s.webp"), sprite(64)).unwrap();
        let budget = collection_budget(PETS_COLLECTION).unwrap();
        for index in 0..=budget.max_records {
            import(&a, &format!("pet-{index:04}"), &sprite(64 + index));
        }
        settle(&[&a.device]).await;
        assert!(!replica_text(&a.device).contains("ghp_"));
        let refused = a.device.sync.status().refused;
        assert!(
            refused
                .iter()
                .any(|r| r.id == "pkg:pet-leaky" && r.reason == "secret"),
            "{refused:?}"
        );
        assert_eq!(live(&a.device, PETS_COLLECTION).len(), budget.max_records);
        assert!(refused.iter().any(|r| r.reason == "budget"));
        assert!(dir.join("pet.json").exists());
    }
}

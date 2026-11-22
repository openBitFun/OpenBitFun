//! User-authored skills (`skills`): each top-level directory of the user
//! skills root (`skill:<dir>`, its files as content blobs; the built-in
//! `.system` set, staging directories and import provenance stay local), the
//! skill settings (`settings:disabled`, `settings:groups`) and the skill
//! market sources (`settings:market`) with their API tokens replaced by
//! per-device placeholders: each device keeps its own token. The 1.x
//! directories and config are read in place.

use std::path::PathBuf;
use std::sync::Arc;

use anyhow::{anyhow, Result};
use async_trait::async_trait;
use serde_json::{json, Value};

use super::{
    read_tree, replace_tree, secret_ref, secret_ref_id, valid_record_id, ApplyContext,
    DeviceContext, Hook, LocalCollection, LocalItem, RemoteItem, TreeLimits, SKILLS_COLLECTION,
};
use crate::service::config::types::{GlobalConfig, SkillMarketSource};
use crate::service::config::ConfigService;

const DISABLED_PATH: &str = "ai.skill_settings.globally_disabled_user_skills";
const GROUPS_PATH: &str = "app.user_skill_groups";
const MARKET_PATH: &str = "app.skill_market.sources";
/// A skill larger than this stays on its device.
const SKILL_LIMITS: TreeLimits = TreeLimits {
    max_files: 256,
    max_bytes: 8 * 1024 * 1024,
};

pub struct SkillRecords {
    root: PathBuf,
    config: Arc<ConfigService>,
    refresh: Option<Hook>,
}

/// Invalidates the process's skill registry cache.
pub fn registry_refresh() -> Hook {
    Arc::new(|| {
        Box::pin(async {
            crate::agentic::tools::implementations::skills::SkillRegistry::global()
                .refresh()
                .await;
        })
    })
}

fn market_placeholder(source_id: &str) -> Value {
    secret_ref(format!("skills:market:{source_id}:api_token"))
}

impl SkillRecords {
    pub fn new(root: PathBuf, config: Arc<ConfigService>, refresh: Option<Hook>) -> Self {
        Self {
            root,
            config,
            refresh,
        }
    }

    async fn read(&self, path: &str) -> Value {
        self.config
            .get_config::<Value>(Some(path))
            .await
            .unwrap_or(Value::Null)
    }

    async fn write(&self, path: &str, value: Value) -> Result<()> {
        self.config
            .set_config(path, value)
            .await
            .map_err(|error| anyhow!("write {path}: {error}"))
    }

    async fn refresh(&self) {
        if let Some(refresh) = self.refresh.as_ref() {
            refresh().await;
        }
    }

    fn skill_dir(&self, name: &str) -> Option<PathBuf> {
        (!name.is_empty() && !name.starts_with('.') && !name.contains('/') && !name.contains('\\'))
            .then(|| self.root.join(name))
    }

    async fn market(&self) -> Vec<SkillMarketSource> {
        serde_json::from_value(self.read(MARKET_PATH).await).unwrap_or_default()
    }
}

#[async_trait]
impl LocalCollection for SkillRecords {
    fn collection(&self) -> &'static str {
        SKILLS_COLLECTION
    }

    async fn list(&self, _device: &DeviceContext) -> Result<Vec<LocalItem>> {
        let root = self.root.clone();
        let mut items = tokio::task::spawn_blocking(move || {
            let mut items = Vec::new();
            let mut dirs: Vec<_> = std::fs::read_dir(&root)
                .map(|entries| entries.flatten().collect())
                .unwrap_or_default();
            dirs.sort_by_key(|entry| entry.file_name());
            for entry in dirs {
                let name = entry.file_name().to_string_lossy().to_string();
                let id = format!("skill:{name}");
                if name.starts_with('.')
                    || !valid_record_id(&id)
                    || !entry.file_type().is_ok_and(|kind| kind.is_dir())
                {
                    continue;
                }
                let Some(files) = read_tree(&entry.path(), SKILL_LIMITS) else {
                    log::debug!("Skill stays on this device (over the sync limits): name={name}");
                    continue;
                };
                if !files.iter().any(|file| file.path.ends_with("SKILL.md")) {
                    continue;
                }
                items.push(LocalItem::new(id, json!({ "dir": name })).with_files(files));
            }
            items
        })
        .await
        .map_err(|error| anyhow!("scan skills directory: {error}"))?;
        let defaults = serde_json::to_value(GlobalConfig::default()).unwrap_or(Value::Null);
        let disabled = self.read(DISABLED_PATH).await;
        let disabled = if disabled.is_null() {
            json!([])
        } else {
            disabled
        };
        items.push(
            LocalItem::new("settings:disabled", json!({ "keys": disabled }))
                .offered(disabled.as_array().is_some_and(|keys| !keys.is_empty())),
        );
        let groups = self.read(GROUPS_PATH).await;
        let has_groups = groups["groups"]
            .as_array()
            .is_some_and(|groups| !groups.is_empty());
        items.push(
            LocalItem::new("settings:groups", json!({ "groups": groups })).offered(has_groups),
        );
        let market = self.market().await;
        let default_market: Vec<SkillMarketSource> = defaults
            .pointer("/app/skill_market/sources")
            .cloned()
            .and_then(|value| serde_json::from_value(value).ok())
            .unwrap_or_default();
        let is_default = market.len() == default_market.len()
            && market.iter().zip(&default_market).all(|(left, right)| {
                left.id == right.id
                    && left.url == right.url
                    && left.provider == right.provider
                    && left.enabled == right.enabled
                    && left.name == right.name
            });
        let sources: Vec<Value> = market
            .iter()
            .map(|source| {
                json!({
                    "id": source.id,
                    "name": source.name,
                    "provider": source.provider,
                    "url": source.url,
                    "enabled": source.enabled,
                    "api_token": if source.api_token.is_empty() {
                        json!("")
                    } else {
                        market_placeholder(&source.id)
                    },
                })
            })
            .collect();
        items.push(
            LocalItem::new("settings:market", json!({ "sources": sources })).offered(!is_default),
        );
        Ok(items)
    }

    async fn apply(&self, item: &RemoteItem, _context: &ApplyContext) -> Result<()> {
        if let Some(name) = item.id.strip_prefix("skill:") {
            let dir = self
                .skill_dir(name)
                .ok_or_else(|| anyhow!("invalid skill directory {name}"))?;
            replace_tree(&dir, &item.files)?;
            self.refresh().await;
            return Ok(());
        }
        match item.id.as_str() {
            "settings:disabled" => self.write(DISABLED_PATH, item.value["keys"].clone()).await,
            "settings:groups" => self.write(GROUPS_PATH, item.value["groups"].clone()).await,
            "settings:market" => {
                // Every device keeps its own token for a source.
                let local = self.market().await;
                let mut sources = Vec::new();
                for source in item.value["sources"]
                    .as_array()
                    .cloned()
                    .unwrap_or_default()
                {
                    let id = source["id"].as_str().unwrap_or_default().to_string();
                    let token = if secret_ref_id(&source["api_token"]).is_some() {
                        local
                            .iter()
                            .find(|existing| existing.id == id)
                            .map(|existing| existing.api_token.clone())
                            .unwrap_or_default()
                    } else {
                        String::new()
                    };
                    let mut source = source.clone();
                    source["api_token"] = Value::String(token);
                    sources.push(source);
                }
                self.write(MARKET_PATH, Value::Array(sources)).await
            }
            other => Err(anyhow!("unknown skills record {other}")),
        }
    }

    async fn remove(&self, id: &str) -> Result<()> {
        if let Some(name) = id.strip_prefix("skill:") {
            if let Some(dir) = self.skill_dir(name).filter(|dir| dir.is_dir()) {
                std::fs::remove_dir_all(&dir)
                    .map_err(|error| anyhow!("remove {}: {error}", dir.display()))?;
                self.refresh().await;
            }
        }
        // Settings are never deleted.
        Ok(())
    }
}

/// Which market sources lack their token on this device (a synced source
/// whose token is set on another device).
pub fn market_sources_needing_token(record: &Value, local: &[SkillMarketSource]) -> Vec<String> {
    record["v"]["sources"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|source| secret_ref_id(&source["api_token"]).is_some())
        .filter_map(|source| source["id"].as_str())
        .filter(|id| {
            local
                .iter()
                .find(|existing| existing.id == *id)
                .is_none_or(|existing| existing.api_token.is_empty())
        })
        .map(str::to_string)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::super::test_support::*;
    use super::*;
    use std::path::Path;

    struct Side {
        dir: tempfile::TempDir,
        config: Arc<ConfigService>,
        device: TestDevice,
    }

    async fn side(id: &str) -> Side {
        let dir = tempfile::tempdir().unwrap();
        let config = super::super::quick_actions::tests_support_config(dir.path()).await;
        let binding = SkillRecords::new(dir.path().join("skills"), Arc::clone(&config), None);
        Side {
            device: test_device(id, Arc::new(binding)),
            dir,
            config,
        }
    }

    fn root(side: &Side) -> PathBuf {
        side.dir.path().join("skills")
    }

    fn write(path: &Path, text: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }

    #[tokio::test]
    async fn legacy_skill_dirs_reach_a_new_device_without_builtins_or_provenance() {
        let a = side("a").await;
        let b = side("b").await;
        link(&a.device, &b.device);
        write(
            &root(&a).join("writer/SKILL.md"),
            "---\nname: writer\n---\nWrite well.",
        );
        write(&root(&a).join("writer/scripts/lint.sh"), "echo lint");
        write(
            &root(&a).join("writer/.openbitfun-import.json"),
            "{\"source_path\":\"/Users/a/src\"}",
        );
        write(&root(&a).join(".system/builtin/SKILL.md"), "built in");
        write(&root(&a).join("notes/README.md"), "not a skill");
        a.config
            .set_config(DISABLED_PATH, json!(["user::openbitfun::writer"]))
            .await
            .unwrap();
        settle(&[&a.device, &b.device]).await;
        assert_eq!(
            std::fs::read_to_string(root(&b).join("writer/scripts/lint.sh")).unwrap(),
            "echo lint"
        );
        assert!(!root(&b).join("writer/.openbitfun-import.json").exists());
        assert!(!root(&b).join(".system").exists());
        assert!(!root(&b).join("notes").exists());
        assert!(!replica_text(&a.device).contains("/Users/a/src"));
        assert_eq!(
            b.config
                .get_config::<Value>(Some(DISABLED_PATH))
                .await
                .unwrap(),
            json!(["user::openbitfun::writer"])
        );
        // The old directory is untouched.
        assert!(root(&a).join("writer/.openbitfun-import.json").exists());
        // An edit and a deletion travel.
        write(
            &root(&b).join("writer/SKILL.md"),
            "---\nname: writer\n---\nWrite better.",
        );
        settle(&[&a.device, &b.device]).await;
        assert!(std::fs::read_to_string(root(&a).join("writer/SKILL.md"))
            .unwrap()
            .contains("better"));
        std::fs::remove_dir_all(root(&a).join("writer")).unwrap();
        settle(&[&a.device, &b.device]).await;
        assert!(!root(&b).join("writer").exists());
    }

    #[tokio::test]
    async fn concurrent_skill_edits_converge_on_the_later_one() {
        let a = side("a").await;
        let b = side("b").await;
        link(&a.device, &b.device);
        write(&root(&a).join("s/SKILL.md"), "v1");
        settle(&[&a.device, &b.device]).await;
        a.device.port.set_online(false);
        write(&root(&a).join("s/SKILL.md"), "from a");
        a.device.sync.round().await;
        std::thread::sleep(std::time::Duration::from_millis(3));
        write(&root(&b).join("s/SKILL.md"), "from b");
        b.device.sync.round().await;
        a.device.port.set_online(true);
        settle(&[&a.device, &b.device]).await;
        for side in [&a, &b] {
            assert_eq!(
                std::fs::read_to_string(root(side).join("s/SKILL.md")).unwrap(),
                "from b"
            );
        }
    }

    #[tokio::test]
    async fn market_tokens_and_secret_files_stay_on_the_device() {
        let a = side("a").await;
        let b = side("b").await;
        link(&a.device, &b.device);
        a.config
            .set_config(
                MARKET_PATH,
                json!([{ "id": "corp", "name": "Corp", "provider": "skillhub", "url": "https://skills.corp", "enabled": true, "api_token": "corp-token-very-secret" }]),
            )
            .await
            .unwrap();
        write(&root(&a).join("deploy/SKILL.md"), "Deploy");
        write(
            &root(&a).join("deploy/creds.txt"),
            "AWS AKIAIOSFODNN7EXAMPLE",
        );
        write(&root(&a).join("ok/SKILL.md"), "fine");
        settle(&[&a.device, &b.device]).await;
        let text = replica_text(&a.device);
        assert!(!text.contains("corp-token-very-secret"));
        assert!(!text.contains("AKIAIOSFODNN7EXAMPLE"));
        assert!(a
            .device
            .sync
            .status()
            .refused
            .iter()
            .any(|r| r.id == "skill:deploy" && r.reason == "secret"));
        // b gets the source, asks for its own token.
        let sources: Vec<SkillMarketSource> = serde_json::from_value(
            b.config
                .get_config::<Value>(Some(MARKET_PATH))
                .await
                .unwrap(),
        )
        .unwrap();
        assert_eq!(sources[0].url, "https://skills.corp");
        assert_eq!(sources[0].api_token, "");
        let record = live(&b.device, SKILLS_COLLECTION)
            .into_iter()
            .find(|r| r.id == "settings:market")
            .unwrap();
        assert_eq!(
            market_sources_needing_token(record.value.as_ref().unwrap(), &sources),
            vec!["corp".to_string()]
        );
        // a keeps its token after b's apply round-trips.
        let local: Vec<SkillMarketSource> = serde_json::from_value(
            a.config
                .get_config::<Value>(Some(MARKET_PATH))
                .await
                .unwrap(),
        )
        .unwrap();
        assert_eq!(local[0].api_token, "corp-token-very-secret");
        assert!(root(&b).join("ok/SKILL.md").exists());
        assert!(!root(&b).join("deploy").exists());
    }

    #[tokio::test]
    async fn skills_keep_their_budget() {
        let a = side("a").await;
        let budget = budget_of(SKILLS_COLLECTION);
        // The stock settings records are not offered; skills fill it.
        for index in 0..=budget.max_records {
            write(
                &root(&a).join(format!("s{index}/SKILL.md")),
                &format!("skill {index}"),
            );
        }
        settle(&[&a.device]).await;
        assert_eq!(live(&a.device, SKILLS_COLLECTION).len(), budget.max_records);
        assert_eq!(
            a.device
                .sync
                .status()
                .refused
                .iter()
                .filter(|r| r.reason == "budget")
                .count(),
            1
        );
    }
}

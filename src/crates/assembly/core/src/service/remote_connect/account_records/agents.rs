//! Custom agents and modes (`agents`): the user-level custom agent files
//! (`<user root>/agents/<id>.md`, a record `agent:<id>` with the markdown)
//! and the agent profiles of `ai.agent_profiles` (a record `profile:<mode
//! id>`). Project-level agents stay with their workspace. The 1.x files are
//! read in place.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{anyhow, Result};
use async_trait::async_trait;
use serde_json::{json, Map, Value};

use super::{
    atomic_write, valid_record_id, ApplyContext, DeviceContext, Hook, LocalCollection, LocalItem,
    RemoteItem, AGENTS_COLLECTION,
};
use crate::service::config::ConfigService;
use openbitfun_agent_runtime::custom_agent::{custom_agent_read_markdown_str, CustomAgentLevel};

/// The config path of the agent profiles.
pub const AGENT_PROFILES_PATH: &str = "ai.agent_profiles";

pub struct AgentRecords {
    dir: PathBuf,
    config: Arc<ConfigService>,
    reload: Option<Hook>,
}

/// Rescans the user custom agents in the process's agent registry.
pub fn registry_reload() -> Hook {
    Arc::new(|| {
        Box::pin(async {
            crate::agentic::agents::get_agent_registry()
                .load_custom_agents(None)
                .await;
        })
    })
}

fn agent_id(markdown: &str) -> Option<String> {
    custom_agent_read_markdown_str(markdown, CustomAgentLevel::User)
        .ok()
        .map(|parsed| parsed.definition.id.to_lowercase())
        .filter(|id| !id.is_empty())
}

impl AgentRecords {
    pub fn new(dir: PathBuf, config: Arc<ConfigService>, reload: Option<Hook>) -> Self {
        Self {
            dir,
            config,
            reload,
        }
    }

    /// `id -> (file, markdown)` of the agent files here.
    fn files(&self) -> BTreeMap<String, (PathBuf, String)> {
        let mut files = BTreeMap::new();
        let Ok(entries) = std::fs::read_dir(&self.dir) else {
            return files;
        };
        let mut entries: Vec<_> = entries.flatten().map(|entry| entry.path()).collect();
        entries.sort();
        for path in entries {
            let is_markdown = path.extension().is_some_and(|ext| ext == "md")
                && !path
                    .file_name()
                    .is_some_and(|name| name.to_string_lossy().starts_with('.'));
            if !is_markdown || !path.is_file() {
                continue;
            }
            let Ok(markdown) = std::fs::read_to_string(&path) else {
                continue;
            };
            if let Some(id) = agent_id(&markdown) {
                files.entry(id).or_insert((path, markdown));
            }
        }
        files
    }

    async fn profiles(&self) -> Map<String, Value> {
        self.config
            .get_config::<Map<String, Value>>(Some(AGENT_PROFILES_PATH))
            .await
            .unwrap_or_default()
    }

    async fn reload(&self) {
        if let Some(reload) = self.reload.as_ref() {
            reload().await;
        }
    }

    fn target(&self, id: &str, file_name: &str) -> PathBuf {
        if let Some((path, _)) = self.files().remove(id) {
            return path;
        }
        let safe = Path::new(file_name)
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .filter(|name| name.ends_with(".md") && !name.starts_with('.'))
            .unwrap_or_else(|| format!("{id}.md"));
        self.dir.join(safe)
    }
}

#[async_trait]
impl LocalCollection for AgentRecords {
    fn collection(&self) -> &'static str {
        AGENTS_COLLECTION
    }

    async fn list(&self, _device: &DeviceContext) -> Result<Vec<LocalItem>> {
        let mut items = Vec::new();
        for (id, (path, markdown)) in self.files() {
            let record_id = format!("agent:{id}");
            if !valid_record_id(&record_id) {
                continue;
            }
            let file_name = path
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_default();
            items.push(LocalItem::new(
                record_id,
                json!({ "fileName": file_name, "markdown": markdown }),
            ));
        }
        for (mode, profile) in self.profiles().await {
            let record_id = format!("profile:{mode}");
            if valid_record_id(&record_id) {
                items.push(LocalItem::new(record_id, json!({ "profile": profile })));
            }
        }
        Ok(items)
    }

    async fn apply(&self, item: &RemoteItem, _context: &ApplyContext) -> Result<()> {
        if let Some(id) = item.id.strip_prefix("agent:") {
            let markdown = item.value["markdown"]
                .as_str()
                .ok_or_else(|| anyhow!("agent record without markdown"))?;
            if agent_id(markdown).as_deref() != Some(id) {
                return Err(anyhow!("agent record does not define agent {id}"));
            }
            let file_name = item.value["fileName"].as_str().unwrap_or_default();
            atomic_write(&self.target(id, file_name), markdown.as_bytes())?;
            self.reload().await;
            return Ok(());
        }
        if let Some(mode) = item.id.strip_prefix("profile:") {
            let mut profiles = self.profiles().await;
            profiles.insert(mode.to_string(), item.value["profile"].clone());
            self.config
                .set_config(AGENT_PROFILES_PATH, profiles)
                .await
                .map_err(|error| anyhow!("write {AGENT_PROFILES_PATH}: {error}"))?;
            return Ok(());
        }
        Err(anyhow!("unknown agents record {}", item.id))
    }

    async fn remove(&self, id: &str) -> Result<()> {
        if let Some(id) = id.strip_prefix("agent:") {
            if let Some((path, _)) = self.files().remove(id) {
                std::fs::remove_file(&path)
                    .map_err(|error| anyhow!("remove {}: {error}", path.display()))?;
                self.reload().await;
            }
            return Ok(());
        }
        if let Some(mode) = id.strip_prefix("profile:") {
            let mut profiles = self.profiles().await;
            if profiles.remove(mode).is_some() {
                self.config
                    .set_config(AGENT_PROFILES_PATH, profiles)
                    .await
                    .map_err(|error| anyhow!("write {AGENT_PROFILES_PATH}: {error}"))?;
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::super::test_support::*;
    use super::*;

    async fn config_service(dir: &Path) -> Arc<ConfigService> {
        super::super::quick_actions::tests_support_config(dir).await
    }

    fn agent(id: &str, prompt: &str) -> String {
        format!(
            "---\nschema_version: 1\nkind: subagent\nid: {id}\nname: {id}\ndescription: test agent\n---\n{prompt}\n"
        )
    }

    struct Side {
        dir: tempfile::TempDir,
        config: Arc<ConfigService>,
        device: TestDevice,
    }

    async fn side(id: &str) -> Side {
        let dir = tempfile::tempdir().unwrap();
        let config = config_service(dir.path()).await;
        let binding = AgentRecords::new(dir.path().join("agents"), Arc::clone(&config), None);
        Side {
            device: test_device(id, Arc::new(binding)),
            dir,
            config,
        }
    }

    fn agents_dir(side: &Side) -> PathBuf {
        side.dir.path().join("agents")
    }

    #[tokio::test]
    async fn legacy_agent_files_and_profiles_reach_a_new_device() {
        let a = side("a").await;
        let b = side("b").await;
        link(&a.device, &b.device);
        // 1.x files on disk, with a name that is not the id.
        std::fs::create_dir_all(agents_dir(&a)).unwrap();
        std::fs::write(
            agents_dir(&a).join("My Reviewer.md"),
            agent("Reviewer", "Review carefully."),
        )
        .unwrap();
        a.config
            .set_config(
                AGENT_PROFILES_PATH,
                json!({ "Standard": { "profile_id": "Standard", "removed_tools": ["Bash"] } }),
            )
            .await
            .unwrap();
        settle(&[&a.device, &b.device]).await;
        let copied = std::fs::read_to_string(agents_dir(&b).join("My Reviewer.md")).unwrap();
        assert!(copied.contains("Review carefully."));
        // The old file is untouched and still parses.
        assert_eq!(
            agent_id(&std::fs::read_to_string(agents_dir(&a).join("My Reviewer.md")).unwrap())
                .as_deref(),
            Some("reviewer")
        );
        let profiles = b
            .config
            .get_config::<Map<String, Value>>(Some(AGENT_PROFILES_PATH))
            .await
            .unwrap();
        assert_eq!(profiles["Standard"]["removed_tools"], json!(["Bash"]));
        // A deletion travels.
        std::fs::remove_file(agents_dir(&b).join("My Reviewer.md")).unwrap();
        settle(&[&a.device, &b.device]).await;
        assert!(!agents_dir(&a).join("My Reviewer.md").exists());
    }

    #[tokio::test]
    async fn concurrent_agent_edits_converge_on_the_later_one() {
        let a = side("a").await;
        let b = side("b").await;
        link(&a.device, &b.device);
        std::fs::create_dir_all(agents_dir(&a)).unwrap();
        std::fs::write(agents_dir(&a).join("helper.md"), agent("helper", "v1")).unwrap();
        settle(&[&a.device, &b.device]).await;
        a.device.port.set_online(false);
        std::fs::write(agents_dir(&a).join("helper.md"), agent("helper", "from a")).unwrap();
        a.device.sync.round().await;
        std::thread::sleep(std::time::Duration::from_millis(3));
        std::fs::write(agents_dir(&b).join("helper.md"), agent("helper", "from b")).unwrap();
        b.device.sync.round().await;
        a.device.port.set_online(true);
        settle(&[&a.device, &b.device]).await;
        for side in [&a, &b] {
            let text = std::fs::read_to_string(agents_dir(side).join("helper.md")).unwrap();
            assert!(text.contains("from b"), "{text}");
        }
    }

    #[tokio::test]
    async fn agents_never_carry_a_secret_and_keep_their_budget() {
        let a = side("a").await;
        std::fs::create_dir_all(agents_dir(&a)).unwrap();
        std::fs::write(
            agents_dir(&a).join("leaky.md"),
            agent(
                "leaky",
                "Call the API with ghp_abcdefghijklmnopqrstuvwxyz0123456789",
            ),
        )
        .unwrap();
        let budget = budget_of(AGENTS_COLLECTION);
        for index in 0..=budget.max_records {
            std::fs::write(
                agents_dir(&a).join(format!("a{index}.md")),
                agent(&format!("a{index}"), "ok"),
            )
            .unwrap();
        }
        settle(&[&a.device]).await;
        assert!(!replica_text(&a.device).contains("ghp_"));
        let refused = a.device.sync.status().refused;
        assert!(refused
            .iter()
            .any(|r| r.id == "agent:leaky" && r.reason == "secret"));
        assert_eq!(live(&a.device, AGENTS_COLLECTION).len(), budget.max_records);
        assert_eq!(refused.iter().filter(|r| r.reason == "budget").count(), 1);
        assert!(agents_dir(&a).join("leaky.md").exists());
    }
}

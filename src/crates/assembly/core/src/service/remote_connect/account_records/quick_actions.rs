//! Quick actions (`quick_actions`): the prompt templates of the chat's
//! post-coding actions menu, one record per action id, from
//! `app.ai_experience.quick_actions` (the 1.x config list, read in place).
//! The order travels as a field; the stock actions every device has are not
//! offered at a device's first sync.

use std::sync::Arc;

use anyhow::{anyhow, Result};
use async_trait::async_trait;
use serde_json::{json, Value};

use super::{
    valid_record_id, ApplyContext, DeviceContext, LocalCollection, LocalItem, RemoteItem,
    QUICK_ACTIONS_COLLECTION,
};
use crate::service::config::types::{AiExperienceQuickAction, GlobalConfig};
use crate::service::config::ConfigService;

/// The config path of the list.
pub const QUICK_ACTIONS_PATH: &str = "app.ai_experience.quick_actions";

pub struct QuickActionRecords {
    config: Arc<ConfigService>,
}

impl QuickActionRecords {
    pub fn new(config: Arc<ConfigService>) -> Self {
        Self { config }
    }

    async fn read(&self) -> Result<Vec<AiExperienceQuickAction>> {
        match self
            .config
            .get_config::<Vec<AiExperienceQuickAction>>(Some(QUICK_ACTIONS_PATH))
            .await
        {
            Ok(actions) => Ok(actions),
            Err(error) if error.to_string().to_lowercase().contains("not found") => Ok(Vec::new()),
            Err(error) => Err(anyhow!("read {QUICK_ACTIONS_PATH}: {error}")),
        }
    }

    async fn write(&self, actions: Vec<AiExperienceQuickAction>) -> Result<()> {
        self.config
            .set_config(QUICK_ACTIONS_PATH, actions)
            .await
            .map_err(|error| anyhow!("write {QUICK_ACTIONS_PATH}: {error}"))
    }
}

fn defaults() -> Vec<AiExperienceQuickAction> {
    GlobalConfig::default().app.ai_experience.quick_actions
}

fn projection(action: &AiExperienceQuickAction, order: usize) -> Value {
    json!({
        "id": action.id,
        "label": action.label,
        "prompt": action.prompt,
        "enabled": action.enabled,
        "order": order,
    })
}

#[async_trait]
impl LocalCollection for QuickActionRecords {
    fn collection(&self) -> &'static str {
        QUICK_ACTIONS_COLLECTION
    }

    async fn list(&self, _device: &DeviceContext) -> Result<Vec<LocalItem>> {
        let stock = defaults();
        Ok(self
            .read()
            .await?
            .iter()
            .enumerate()
            .filter(|(_, action)| valid_record_id(&action.id))
            .map(|(order, action)| {
                let is_stock = stock.contains(action);
                LocalItem::new(action.id.clone(), projection(action, order)).offered(!is_stock)
            })
            .collect())
    }

    async fn apply(&self, item: &RemoteItem, _context: &ApplyContext) -> Result<()> {
        let value = &item.value;
        let action = AiExperienceQuickAction {
            id: item.id.clone(),
            label: value["label"].as_str().unwrap_or_default().to_string(),
            prompt: value["prompt"].as_str().unwrap_or_default().to_string(),
            enabled: value["enabled"].as_bool().unwrap_or(true),
        };
        let order = value["order"].as_u64().unwrap_or(u64::MAX) as usize;
        let mut actions = self.read().await?;
        actions.retain(|existing| existing.id != action.id);
        let at = order.min(actions.len());
        actions.insert(at, action);
        self.write(actions).await
    }

    async fn remove(&self, id: &str) -> Result<()> {
        let mut actions = self.read().await?;
        let before = actions.len();
        actions.retain(|existing| existing.id != id);
        if actions.len() != before {
            self.write(actions).await?;
        }
        Ok(())
    }
}

/// A config service in `dir` (tests of every Core binding).
#[cfg(test)]
pub(crate) async fn tests_support_config(dir: &std::path::Path) -> Arc<ConfigService> {
    tests::config_service(dir).await
}

#[cfg(test)]
pub(crate) mod tests {
    use super::super::test_support::*;
    use super::*;
    use crate::infrastructure::PathManager;
    use crate::service::config::ConfigManagerSettings;

    pub(crate) async fn config_service(dir: &std::path::Path) -> Arc<ConfigService> {
        let path_manager = Arc::new(PathManager::with_user_root_for_tests(dir.join("user")));
        Arc::new(
            ConfigService::with_settings(ConfigManagerSettings {
                path_manager: Some(path_manager),
                auto_save: true,
                backup_count: 0,
            })
            .await
            .expect("config service"),
        )
    }

    fn action(id: &str, label: &str) -> AiExperienceQuickAction {
        AiExperienceQuickAction {
            id: id.into(),
            label: label.into(),
            prompt: format!("prompt of {label}"),
            enabled: true,
        }
    }

    async fn actions(config: &ConfigService) -> Vec<String> {
        config
            .get_config::<Vec<AiExperienceQuickAction>>(Some(QUICK_ACTIONS_PATH))
            .await
            .unwrap()
            .into_iter()
            .map(|action| format!("{}={}", action.id, action.label))
            .collect()
    }

    #[tokio::test]
    async fn legacy_list_seeds_the_account_and_converges_on_a_second_device() {
        let dir_a = tempfile::tempdir().unwrap();
        // A 1.x config file with a custom action, read in place.
        let user = dir_a.path().join("user").join("config");
        std::fs::create_dir_all(&user).unwrap();
        let mut legacy = serde_json::to_value(GlobalConfig::default()).unwrap();
        legacy["app"]["ai_experience"]["quick_actions"] = json!([
            { "id": "commit", "label": "Commit", "prompt": "Commit all current code changes", "enabled": true },
            { "id": "custom-review", "label": "Review", "prompt": "Review the diff", "enabled": true }
        ]);
        std::fs::write(user.join("app.json"), serde_json::to_vec(&legacy).unwrap()).unwrap();
        let config_a = config_service(dir_a.path()).await;
        let dir_b = tempfile::tempdir().unwrap();
        let config_b = config_service(dir_b.path()).await;
        let a = test_device(
            "a",
            Arc::new(QuickActionRecords::new(Arc::clone(&config_a))),
        );
        let b = test_device(
            "b",
            Arc::new(QuickActionRecords::new(Arc::clone(&config_b))),
        );
        link(&a, &b);
        settle(&[&a]).await;
        // Only the custom action is offered; the stock one every device has.
        let ids: Vec<_> = live(&a, QUICK_ACTIONS_COLLECTION)
            .into_iter()
            .map(|r| r.id)
            .collect();
        assert_eq!(ids, vec!["custom-review".to_string()]);
        // The old file still reads the same.
        let reread = config_service(dir_a.path()).await;
        assert_eq!(
            actions(&reread).await,
            vec!["commit=Commit", "custom-review=Review"]
        );
        settle(&[&a, &b]).await;
        assert_eq!(
            actions(&config_b).await,
            vec![
                "commit=Commit",
                "custom-review=Review",
                "create_pr=Create PR"
            ]
        );
        // An edit and a deletion on b reach a.
        let mut list = config_b
            .get_config::<Vec<AiExperienceQuickAction>>(Some(QUICK_ACTIONS_PATH))
            .await
            .unwrap();
        list.retain(|action| action.id != "create_pr");
        list.iter_mut()
            .find(|action| action.id == "custom-review")
            .unwrap()
            .label = "Review v2".into();
        config_b.set_config(QUICK_ACTIONS_PATH, list).await.unwrap();
        settle(&[&a, &b]).await;
        assert!(actions(&config_a)
            .await
            .contains(&"custom-review=Review v2".to_string()));
        // b's stock create_pr was never on the account: deleting it there
        // tombstones nothing.
        assert_eq!(
            actions(&config_b).await,
            vec!["commit=Commit", "custom-review=Review v2"]
        );
        assert!(live(&a, QUICK_ACTIONS_COLLECTION)
            .iter()
            .all(|r| r.id != "create_pr"));
    }

    #[tokio::test]
    async fn concurrent_edits_converge_on_the_later_one() {
        let dir_a = tempfile::tempdir().unwrap();
        let dir_b = tempfile::tempdir().unwrap();
        let config_a = config_service(dir_a.path()).await;
        let config_b = config_service(dir_b.path()).await;
        let a = test_device(
            "a",
            Arc::new(QuickActionRecords::new(Arc::clone(&config_a))),
        );
        let b = test_device(
            "b",
            Arc::new(QuickActionRecords::new(Arc::clone(&config_b))),
        );
        link(&a, &b);
        config_a
            .set_config(QUICK_ACTIONS_PATH, vec![action("x", "one")])
            .await
            .unwrap();
        settle(&[&a, &b]).await;
        a.port.set_online(false);
        config_a
            .set_config(QUICK_ACTIONS_PATH, vec![action("x", "from a")])
            .await
            .unwrap();
        a.sync.round().await;
        std::thread::sleep(std::time::Duration::from_millis(3));
        config_b
            .set_config(QUICK_ACTIONS_PATH, vec![action("x", "from b")])
            .await
            .unwrap();
        b.sync.round().await;
        a.port.set_online(true);
        settle(&[&a, &b]).await;
        assert_eq!(actions(&config_a).await, vec!["x=from b"]);
        assert_eq!(actions(&config_b).await, vec!["x=from b"]);
    }

    #[tokio::test]
    async fn quick_actions_never_carry_a_secret_and_keep_their_budget() {
        let dir = tempfile::tempdir().unwrap();
        let config = config_service(dir.path()).await;
        let mut list = vec![AiExperienceQuickAction {
            id: "leaky".into(),
            label: "Deploy".into(),
            prompt: "Deploy with sk-proj-abcdefghijklmnopqrstuvwxyz0123456789".into(),
            enabled: true,
        }];
        let budget = budget_of(QUICK_ACTIONS_COLLECTION);
        for index in 0..=budget.max_records {
            list.push(action(&format!("a{index}"), "x"));
        }
        config.set_config(QUICK_ACTIONS_PATH, list).await.unwrap();
        let a = test_device("a", Arc::new(QuickActionRecords::new(Arc::clone(&config))));
        settle(&[&a]).await;
        assert!(!replica_text(&a).contains("sk-proj-"));
        let refused = a.sync.status().refused;
        assert!(refused
            .iter()
            .any(|r| r.id == "leaky" && r.reason == "secret"));
        // One over the budget is refused loudly, never dropped silently.
        assert_eq!(live(&a, QUICK_ACTIONS_COLLECTION).len(), budget.max_records);
        assert_eq!(refused.iter().filter(|r| r.reason == "budget").count(), 1);
        // The device keeps every action.
        assert_eq!(actions(&config).await.len(), budget.max_records + 2);
    }
}

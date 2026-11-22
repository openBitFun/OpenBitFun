//! Assistant personas (`assistants.personas`): the persona documents
//! (`IDENTITY.md`, `SOUL.md`, `USER.md`) of every assistant workspace under
//! `~/.openbitfun/personal_assistant` (`workspace` is the record `default`,
//! `workspace-<id>` the record `<id>`), read in place, as content blobs. The
//! rest of an assistant workspace (what the assistant made, its bootstrap
//! state) stays on the device. Personas are prose: when the account's
//! version replaces local content the writer never saw, the local file is
//! kept beside it (`SOUL.<device>.conflict.md`). Deleting an assistant on one
//! device keeps its workspace on the others.

use std::path::PathBuf;
use std::sync::Arc;

use anyhow::{anyhow, Result};
use async_trait::async_trait;
use serde_json::json;

use super::{
    atomic_write, conflict_copy_path, valid_record_id, ApplyContext, DeviceContext, ItemFile,
    LocalCollection, LocalItem, RemoteItem, PERSONAS_COLLECTION,
};

/// The persona documents that travel.
pub const PERSONA_FILES: &[&str] = &["IDENTITY.md", "SOUL.md", "USER.md"];
const TEMPLATES: &[(&str, &str)] = &[
    (
        "IDENTITY.md",
        include_str!("../../bootstrap/templates/IDENTITY.md"),
    ),
    ("SOUL.md", include_str!("../../bootstrap/templates/SOUL.md")),
    ("USER.md", include_str!("../../bootstrap/templates/USER.md")),
];

/// Creates an assistant workspace (the owner's typed creation) before its
/// persona lands here.
pub type CreateAssistant = Arc<
    dyn Fn(String) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send>>
        + Send
        + Sync,
>;

/// Creates a named assistant through the process's workspace service.
pub fn workspace_create() -> CreateAssistant {
    Arc::new(|id: String| {
        Box::pin(async move {
            #[cfg(feature = "workspace-runtime")]
            if let Some(service) = crate::service::workspace::get_global_workspace_service() {
                service
                    .create_assistant_workspace(Some(id))
                    .await
                    .map(|_| ())
                    .map_err(|error| anyhow!("{error}"))?;
                return Ok(());
            }
            let _ = id;
            Err(anyhow!("workspace service not available"))
        })
    })
}

pub struct PersonaRecords {
    base: PathBuf,
    create: Option<CreateAssistant>,
}

fn normalized(text: &[u8]) -> String {
    String::from_utf8_lossy(text).replace("\r\n", "\n")
}

fn is_template(file: &ItemFile) -> bool {
    TEMPLATES.iter().any(|(name, template)| {
        *name == file.path && normalized(&file.bytes) == normalized(template.as_bytes())
    })
}

impl PersonaRecords {
    pub fn new(base: PathBuf, create: Option<CreateAssistant>) -> Self {
        Self { base, create }
    }

    fn dir(&self, id: &str) -> Option<PathBuf> {
        if id == "default" {
            return Some(self.base.join("workspace"));
        }
        (valid_record_id(id) && !id.contains('/') && !id.contains(':'))
            .then(|| self.base.join(format!("workspace-{id}")))
    }
}

#[async_trait]
impl LocalCollection for PersonaRecords {
    fn collection(&self) -> &'static str {
        PERSONAS_COLLECTION
    }

    async fn list(&self, _device: &DeviceContext) -> Result<Vec<LocalItem>> {
        let base = self.base.clone();
        tokio::task::spawn_blocking(move || {
            let mut items = Vec::new();
            let mut entries: Vec<_> = std::fs::read_dir(&base)
                .map(|entries| entries.flatten().collect())
                .unwrap_or_default();
            entries.sort_by_key(|entry| entry.file_name());
            for entry in entries {
                let name = entry.file_name().to_string_lossy().to_string();
                let id = match name.as_str() {
                    "workspace" => "default".to_string(),
                    other => match other.strip_prefix("workspace-") {
                        Some(id) if valid_record_id(id) && !id.contains(':') => id.to_string(),
                        _ => continue,
                    },
                };
                if !entry.file_type().is_ok_and(|kind| kind.is_dir()) {
                    continue;
                }
                let files: Vec<ItemFile> = PERSONA_FILES
                    .iter()
                    .filter_map(|file| {
                        std::fs::read(entry.path().join(file))
                            .ok()
                            .map(|bytes| ItemFile {
                                path: (*file).to_string(),
                                bytes,
                            })
                    })
                    .collect();
                if files.is_empty() {
                    continue;
                }
                let offer = !files.iter().all(is_template);
                items.push(
                    LocalItem::new(id, json!({ "kind": "persona" }))
                        .with_files(files)
                        .offered(offer),
                );
            }
            items
        })
        .await
        .map_err(|error| anyhow!("scan personas directory: {error}"))
    }

    async fn apply(&self, item: &RemoteItem, context: &ApplyContext) -> Result<()> {
        let dir = self
            .dir(&item.id)
            .ok_or_else(|| anyhow!("invalid assistant id {}", item.id))?;
        if !dir.exists() && item.id != "default" {
            if let Some(create) = self.create.as_ref() {
                if let Err(error) = create(item.id.clone()).await {
                    log::debug!("Assistant workspace not created through its owner: {error:#}");
                }
            }
        }
        std::fs::create_dir_all(&dir)
            .map_err(|error| anyhow!("create {}: {error}", dir.display()))?;
        for file in &item.files {
            if !PERSONA_FILES.contains(&file.path.as_str()) {
                return Err(anyhow!("unexpected persona file {:?}", file.path));
            }
            let path = dir.join(&file.path);
            if context.concurrent {
                if let Ok(current) = std::fs::read(&path) {
                    let current_file = ItemFile {
                        path: file.path.clone(),
                        bytes: current.clone(),
                    };
                    if current != file.bytes && !is_template(&current_file) {
                        atomic_write(
                            &conflict_copy_path(&path, &context.device.device_id),
                            &current,
                        )?;
                    }
                }
            }
            atomic_write(&path, &file.bytes)?;
        }
        Ok(())
    }

    /// Another device deleted the assistant: its workspace here holds what
    /// the assistant made on this device, so it stays.
    async fn remove(&self, id: &str) -> Result<()> {
        log::info!("Assistant deleted on another device, its workspace here is kept: id={id}");
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::super::test_support::*;
    use super::*;

    fn side(id: &str) -> (tempfile::TempDir, TestDevice) {
        let dir = tempfile::tempdir().unwrap();
        let device = test_device(
            id,
            Arc::new(PersonaRecords::new(dir.path().to_path_buf(), None)),
        );
        (dir, device)
    }

    fn write(dir: &tempfile::TempDir, workspace: &str, file: &str, text: &str) {
        let path = dir.path().join(workspace);
        std::fs::create_dir_all(&path).unwrap();
        std::fs::write(path.join(file), text).unwrap();
    }

    fn read(dir: &tempfile::TempDir, workspace: &str, file: &str) -> Option<String> {
        std::fs::read_to_string(dir.path().join(workspace).join(file)).ok()
    }

    #[tokio::test]
    async fn legacy_personas_reach_a_new_device_and_stock_ones_are_not_offered() {
        let (dir_a, a) = side("a");
        let (dir_b, b) = side("b");
        link(&a, &b);
        write(&dir_a, "workspace-1a2b3c4d", "SOUL.md", "Warm, brief.");
        write(
            &dir_a,
            "workspace-1a2b3c4d",
            "IDENTITY.md",
            "---\nname: Ada\n---\n",
        );
        write(&dir_a, "workspace-1a2b3c4d", "BOOTSTRAP.md", "pending");
        write(
            &dir_a,
            "workspace-1a2b3c4d",
            "notes.txt",
            "assistant's own file",
        );
        // Both devices have the stock default assistant.
        for dir in [&dir_a, &dir_b] {
            for (name, template) in TEMPLATES {
                write(dir, "workspace", name, template);
            }
        }
        settle(&[&a, &b]).await;
        let ids: Vec<_> = live(&a, PERSONAS_COLLECTION)
            .into_iter()
            .map(|r| r.id)
            .collect();
        assert_eq!(ids, vec!["1a2b3c4d".to_string()]);
        assert_eq!(
            read(&dir_b, "workspace-1a2b3c4d", "SOUL.md").as_deref(),
            Some("Warm, brief.")
        );
        assert!(read(&dir_b, "workspace-1a2b3c4d", "BOOTSTRAP.md").is_none());
        assert!(read(&dir_b, "workspace-1a2b3c4d", "notes.txt").is_none());
        assert_eq!(
            read(&dir_a, "workspace-1a2b3c4d", "notes.txt").as_deref(),
            Some("assistant's own file")
        );
        // A deletion on one device keeps the workspace on the other.
        std::fs::remove_dir_all(dir_b.path().join("workspace-1a2b3c4d")).unwrap();
        settle(&[&a, &b]).await;
        assert!(read(&dir_a, "workspace-1a2b3c4d", "SOUL.md").is_some());
    }

    #[tokio::test]
    async fn concurrent_persona_edits_keep_a_conflict_copy() {
        let (dir_a, a) = side("a");
        let (dir_b, b) = side("b");
        link(&a, &b);
        write(&dir_a, "workspace", "SOUL.md", "v1");
        settle(&[&a, &b]).await;
        a.port.set_online(false);
        write(&dir_a, "workspace", "SOUL.md", "from a");
        a.sync.round().await;
        std::thread::sleep(std::time::Duration::from_millis(3));
        write(&dir_b, "workspace", "SOUL.md", "from b");
        b.sync.round().await;
        a.port.set_online(true);
        settle(&[&a, &b]).await;
        assert_eq!(
            read(&dir_a, "workspace", "SOUL.md").as_deref(),
            Some("from b")
        );
        assert_eq!(
            read(&dir_a, "workspace", "SOUL.a.conflict.md").as_deref(),
            Some("from a")
        );
        assert!(read(&dir_b, "workspace", "SOUL.b.conflict.md").is_none());
    }

    #[tokio::test]
    async fn personas_never_carry_a_secret_and_keep_their_budget() {
        let (dir_a, a) = side("a");
        write(
            &dir_a,
            "workspace-leak",
            "USER.md",
            concat!("My token is xo", "xb-1234567890-abcdefghijklmnopq"),
        );
        let budget = budget_of(PERSONAS_COLLECTION);
        for index in 0..=budget.max_records {
            write(
                &dir_a,
                &format!("workspace-p{index}"),
                "SOUL.md",
                &format!("persona {index}"),
            );
        }
        settle(&[&a]).await;
        assert!(!replica_text(&a).contains("xoxb-"));
        let refused = a.sync.status().refused;
        assert!(refused
            .iter()
            .any(|r| r.id == "leak" && r.reason == "secret"));
        assert_eq!(live(&a, PERSONAS_COLLECTION).len(), budget.max_records);
        assert_eq!(refused.iter().filter(|r| r.reason == "budget").count(), 1);
    }
}

//! The consolidated memory document (`memory`): `MEMORY.md` and
//! `memory_summary.md` of the memory root (`~/.openbitfun/memories`, read in
//! place), one record (`consolidated`) with both files as content blobs.
//! Raw stage-1 memories and rollout summaries stay on the device (they are
//! rebuilt from its own sessions). When the account's document replaces one
//! this device wrote without the other device seeing it, the local copy is
//! kept beside it (`MEMORY.<device>.conflict.md`).

use std::path::PathBuf;

use anyhow::{anyhow, Result};
use async_trait::async_trait;
use serde_json::json;

use super::{
    atomic_write, conflict_copy_path, safe_relative_path, ApplyContext, DeviceContext, ItemFile,
    LocalCollection, LocalItem, RemoteItem, MEMORY_COLLECTION,
};

/// The files of the consolidated document.
pub const MEMORY_FILES: &[&str] = &["MEMORY.md", "memory_summary.md"];
const RECORD_ID: &str = "consolidated";

pub struct MemoryRecords {
    root: PathBuf,
}

impl MemoryRecords {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }
}

#[async_trait]
impl LocalCollection for MemoryRecords {
    fn collection(&self) -> &'static str {
        MEMORY_COLLECTION
    }

    async fn list(&self, _device: &DeviceContext) -> Result<Vec<LocalItem>> {
        let files: Vec<ItemFile> = MEMORY_FILES
            .iter()
            .filter_map(|name| {
                std::fs::read(self.root.join(name))
                    .ok()
                    .map(|bytes| ItemFile {
                        path: (*name).to_string(),
                        bytes,
                    })
            })
            .collect();
        if files.is_empty() {
            return Ok(Vec::new());
        }
        let offer = files
            .iter()
            .any(|file| !file.bytes.iter().all(u8::is_ascii_whitespace));
        Ok(vec![LocalItem::new(
            RECORD_ID,
            json!({ "kind": "consolidated" }),
        )
        .with_files(files)
        .offered(offer)])
    }

    async fn apply(&self, item: &RemoteItem, context: &ApplyContext) -> Result<()> {
        for file in &item.files {
            if !MEMORY_FILES.contains(&file.path.as_str()) || !safe_relative_path(&file.path) {
                return Err(anyhow!("unexpected memory file {:?}", file.path));
            }
            let path = self.root.join(&file.path);
            if context.concurrent {
                if let Ok(current) = std::fs::read(&path) {
                    if current != file.bytes {
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

    /// The account reset its memory: the consolidated files go (the device's
    /// raw memories stay and the next consolidation rebuilds them).
    async fn remove(&self, _id: &str) -> Result<()> {
        for name in MEMORY_FILES {
            let _ = std::fs::remove_file(self.root.join(name));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::super::test_support::*;
    use super::*;
    use std::sync::Arc;

    fn side(id: &str) -> (tempfile::TempDir, TestDevice) {
        let dir = tempfile::tempdir().unwrap();
        let device = test_device(id, Arc::new(MemoryRecords::new(dir.path().to_path_buf())));
        (dir, device)
    }

    fn read(dir: &tempfile::TempDir, name: &str) -> Option<String> {
        std::fs::read_to_string(dir.path().join(name)).ok()
    }

    #[tokio::test]
    async fn the_legacy_document_reaches_a_new_device_and_raw_memories_stay() {
        let (dir_a, a) = side("a");
        let (dir_b, b) = side("b");
        link(&a, &b);
        std::fs::write(dir_a.path().join("MEMORY.md"), "# Memory\n- prefers rust\n").unwrap();
        std::fs::write(dir_a.path().join("memory_summary.md"), "Rust person.").unwrap();
        std::fs::write(dir_a.path().join("raw_memories.md"), "raw transcript facts").unwrap();
        settle(&[&a, &b]).await;
        assert_eq!(
            read(&dir_b, "MEMORY.md").as_deref(),
            Some("# Memory\n- prefers rust\n")
        );
        assert_eq!(
            read(&dir_b, "memory_summary.md").as_deref(),
            Some("Rust person.")
        );
        assert!(read(&dir_b, "raw_memories.md").is_none());
        assert!(!replica_text(&a).contains("raw transcript"));
        // The old files read the same.
        assert_eq!(
            read(&dir_a, "memory_summary.md").as_deref(),
            Some("Rust person.")
        );
    }

    #[tokio::test]
    async fn concurrent_consolidations_keep_the_loser_as_a_conflict_copy() {
        let (dir_a, a) = side("a");
        let (dir_b, b) = side("b");
        link(&a, &b);
        std::fs::write(dir_a.path().join("MEMORY.md"), "v1").unwrap();
        settle(&[&a, &b]).await;
        a.port.set_online(false);
        std::fs::write(dir_a.path().join("MEMORY.md"), "from a").unwrap();
        a.sync.round().await;
        std::thread::sleep(std::time::Duration::from_millis(3));
        std::fs::write(dir_b.path().join("MEMORY.md"), "from b").unwrap();
        b.sync.round().await;
        a.port.set_online(true);
        settle(&[&a, &b]).await;
        assert_eq!(read(&dir_a, "MEMORY.md").as_deref(), Some("from b"));
        assert_eq!(read(&dir_b, "MEMORY.md").as_deref(), Some("from b"));
        assert_eq!(
            read(&dir_a, "MEMORY.a.conflict.md").as_deref(),
            Some("from a")
        );
    }

    #[tokio::test]
    async fn memory_never_carries_a_secret_and_keeps_its_budget() {
        let (dir_a, a) = side("a");
        // Built at run time so the source carries no key marker.
        let key = format!("- deploy key -----BEGIN OPENSSH {} KEY----- abc", "PRIVATE");
        std::fs::write(dir_a.path().join("MEMORY.md"), key).unwrap();
        settle(&[&a]).await;
        assert!(live(&a, MEMORY_COLLECTION).is_empty());
        assert!(a.sync.status().refused.iter().any(|r| r.reason == "secret"));
        // One record only, far inside the budget; a document over the
        // per-blob limit is chunked, not refused.
        let budget = budget_of(MEMORY_COLLECTION);
        assert!(budget.max_records >= 1);
        let big = "fact\n".repeat(1_000_000);
        std::fs::write(dir_a.path().join("MEMORY.md"), &big).unwrap();
        settle(&[&a]).await;
        let record = live(&a, MEMORY_COLLECTION).remove(0);
        assert_eq!(record.blobs.len(), 2);
    }
}

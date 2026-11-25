//! Account records for a product host (desktop backend, CLI host): the
//! account-level data beyond settings, bound to the account replica.
//!
//! The binder lives in
//! `openbitfun_services_integrations::remote_connect::account_records`; the
//! data in the account replica the device network exchanges between the
//! account's devices (obp `fleet::replica`). Nothing is stored on a server.
//! This module holds the bindings whose owners live in Core (quick actions,
//! custom agents and modes, skills, routines, MCP server shapes, the
//! consolidated memory) and starts the binder with the host's own bindings
//! added (the desktop adds cards, pets and SSH profiles). Assistants are the
//! device's own: their persona documents (`IDENTITY.md`, `SOUL.md`,
//! `USER.md`) are not bound, so one device's assistant never replaces
//! another's (records older builds still publish under
//! `assistants.personas` are neither applied nor answered here).
//! The switch is the device's account sync switch
//! (`settings_sync::SWITCH_PATH`); the binding state is kept per account
//! under `<user data>/account_sync/`.

use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};

use anyhow::{anyhow, Result};
use async_trait::async_trait;

pub use openbitfun_services_integrations::remote_connect::account_records::*;

use crate::service::config::ConfigService;

pub mod agents;
#[cfg(feature = "mcp-runtime")]
pub mod mcp;
pub mod memory_document;
pub mod quick_actions;
#[cfg(feature = "scheduled-jobs")]
pub mod routines;
pub mod skills;

/// An owner's follow-up after an apply (a registry reload, a rescan).
pub type Hook =
    Arc<dyn Fn() -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>> + Send + Sync>;

/// The UI event after account items were applied here
/// (`{collection, ids}`; the UI re-reads what it draws).
pub const RECORDS_APPLIED_EVENT: &str = "account://records-applied";

/// The device's account sync switch over the config service.
pub struct ConfigSwitch(pub Arc<ConfigService>);

#[async_trait]
impl RecordsSwitch for ConfigSwitch {
    async fn enabled(&self) -> bool {
        self.0
            .get_config::<bool>(Some(super::settings_sync::SWITCH_PATH))
            .await
            .unwrap_or(true)
    }
}

/// The Core-owned bindings over this process's services.
pub fn core_collections(config: Arc<ConfigService>) -> Vec<Arc<dyn LocalCollection>> {
    let paths = crate::infrastructure::get_path_manager_arc();
    #[allow(unused_mut)]
    let mut collections: Vec<Arc<dyn LocalCollection>> = vec![
        Arc::new(quick_actions::QuickActionRecords::new(Arc::clone(&config))),
        Arc::new(agents::AgentRecords::new(
            paths.user_agents_dir(),
            Arc::clone(&config),
            Some(agents::registry_reload()),
        )),
        Arc::new(skills::SkillRecords::new(
            paths.user_skills_dir(),
            Arc::clone(&config),
            Some(skills::registry_refresh()),
        )),
        Arc::new(memory_document::MemoryRecords::new(
            paths.memories_root_dir(),
        )),
        Arc::new(bots::BotBindingRecords),
    ];
    #[cfg(feature = "scheduled-jobs")]
    collections.push(Arc::new(routines::RoutineRecords::new(Arc::new(
        routines::GlobalCron,
    ))));
    #[cfg(feature = "mcp-runtime")]
    collections.push(Arc::new(mcp::McpRecords::new(Arc::clone(&config))));
    collections
}

static ENGINE: OnceLock<Arc<AccountRecordsSync>> = OnceLock::new();

/// The process's binder, once a host started it.
pub fn engine() -> Option<Arc<AccountRecordsSync>> {
    ENGINE.get().cloned()
}

/// Wakes the binder (sign-in, sign-out, the switch, an owner's change).
pub fn wake() {
    if let Some(engine) = ENGINE.get() {
        engine.wake();
    }
}

/// Starts the process's binder once over `collections` (Core's plus the
/// host's); later calls return the first one.
pub fn start(
    config: Arc<ConfigService>,
    collections: Vec<Arc<dyn LocalCollection>>,
    provider: Arc<dyn RecordPortProvider>,
    observer: Option<Arc<dyn RecordsObserver>>,
) -> Result<Arc<AccountRecordsSync>> {
    if let Some(engine) = ENGINE.get() {
        return Ok(Arc::clone(engine));
    }
    let store = Arc::new(FileRecordsStateStore::new(
        super::settings_sync::state_directory()?,
    ));
    let config_changes = config.subscribe_local_changes();
    let engine =
        AccountRecordsSync::new(collections, provider, store, Arc::new(ConfigSwitch(config)));
    if let Some(observer) = observer {
        engine.set_observer(observer);
    }
    if ENGINE.set(Arc::clone(&engine)).is_err() {
        return Ok(Arc::clone(ENGINE.get().expect("engine was set")));
    }
    let handle = tokio::runtime::Handle::try_current()
        .map_err(|_| anyhow!("account records sync needs a runtime"))?;

    #[cfg(feature = "file-watch")]
    let (merged_tx, merged_rx) = tokio::sync::watch::channel(());
    #[cfg(feature = "file-watch")]
    let fs_watcher = {
        let paths = crate::infrastructure::get_path_manager_arc();
        let watch_targets = vec![
            (paths.user_agents_dir(), false),
            (paths.user_skills_dir(), true),
            (paths.memories_root_dir(), false),
        ];
        let tx = merged_tx.clone();
        openbitfun_services_integrations::file_watch::PathChangeWatcher::watch_paths(
            &watch_targets,
            move || {
                tx.send_replace(());
            },
        )
    };
    #[cfg(feature = "file-watch")]
    {
        let mut config_rx = config_changes;
        let tx = merged_tx;
        handle.spawn(async move {
            while config_rx.changed().await.is_ok() {
                tx.send_replace(());
            }
        });
        let run_engine = Arc::clone(&engine);
        handle.spawn(async move {
            let _watcher = fs_watcher;
            run_engine.run(merged_rx).await;
        });
    }
    #[cfg(not(feature = "file-watch"))]
    handle.spawn(Arc::clone(&engine).run(config_changes));
    log::info!(
        "Account records sync started: collections={}",
        engine.collection_names().join(",")
    );
    Ok(engine)
}

// ── Helpers for file-backed owners ───────────────────────────────────────

/// Limits of a directory an item carries.
#[derive(Debug, Clone, Copy)]
pub struct TreeLimits {
    pub max_files: usize,
    pub max_bytes: u64,
}

/// Names that never travel with a directory (provenance with device paths,
/// staging leftovers, VCS data, environment files).
fn skipped_name(name: &str) -> bool {
    name.starts_with('.') || name.ends_with(".conflict.md") || name == "node_modules"
}

/// Every file under `dir` (relative POSIX paths, sorted), or `None` when the
/// directory is over `limits` (it then stays on this device).
pub fn read_tree(dir: &Path, limits: TreeLimits) -> Option<Vec<ItemFile>> {
    fn walk(
        root: &Path,
        dir: &Path,
        limits: TreeLimits,
        files: &mut Vec<ItemFile>,
        total: &mut u64,
    ) -> Option<()> {
        let mut entries: Vec<_> = std::fs::read_dir(dir).ok()?.flatten().collect();
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            let name = entry.file_name().to_string_lossy().to_string();
            if skipped_name(&name) {
                continue;
            }
            let path = entry.path();
            let kind = entry.file_type().ok()?;
            if kind.is_symlink() {
                continue;
            }
            if kind.is_dir() {
                walk(root, &path, limits, files, total)?;
            } else if kind.is_file() {
                let bytes = std::fs::read(&path).ok()?;
                *total += bytes.len() as u64;
                if files.len() >= limits.max_files || *total > limits.max_bytes {
                    return None;
                }
                let relative = path.strip_prefix(root).ok()?;
                let relative = relative
                    .components()
                    .map(|part| part.as_os_str().to_string_lossy().to_string())
                    .collect::<Vec<_>>()
                    .join("/");
                files.push(ItemFile {
                    path: relative,
                    bytes,
                });
            }
        }
        Some(())
    }
    let mut files = Vec::new();
    let mut total = 0;
    walk(dir, dir, limits, &mut files, &mut total)?;
    Some(files)
}

/// Writes a file through a temporary file and a rename.
pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| anyhow!("create {}: {error}", parent.display()))?;
    }
    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_default();
    let temporary = path.with_file_name(format!(".{file_name}.replica-tmp"));
    std::fs::write(&temporary, bytes)
        .map_err(|error| anyhow!("write {}: {error}", temporary.display()))?;
    std::fs::rename(&temporary, path)
        .map_err(|error| anyhow!("replace {}: {error}", path.display()))
}

/// Replaces the directory `target` with exactly `files` (staged beside it,
/// then swapped in), so a reader never sees a half-written directory.
pub fn replace_tree(target: &Path, files: &[ItemFile]) -> Result<()> {
    let parent = target
        .parent()
        .ok_or_else(|| anyhow!("no parent: {}", target.display()))?;
    let name = target
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .ok_or_else(|| anyhow!("no name: {}", target.display()))?;
    let staging = parent.join(format!(".{name}.replica-staging"));
    let previous = parent.join(format!(".{name}.replica-previous"));
    let _ = std::fs::remove_dir_all(&staging);
    for file in files {
        if !safe_relative_path(&file.path) {
            return Err(anyhow!("unsafe path {:?}", file.path));
        }
        let path = staging.join(&file.path);
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        std::fs::write(&path, &file.bytes)?;
    }
    std::fs::create_dir_all(&staging)?;
    let _ = std::fs::remove_dir_all(&previous);
    if target.exists() {
        std::fs::rename(target, &previous)?;
    }
    if let Err(error) = std::fs::rename(&staging, target) {
        if previous.exists() {
            let _ = std::fs::rename(&previous, target);
        }
        return Err(anyhow!("swap {}: {error}", target.display()));
    }
    let _ = std::fs::remove_dir_all(&previous);
    Ok(())
}

/// The path of a conflict copy of `path` (`SOUL.md` → `SOUL.<tag>.conflict.md`).
pub fn conflict_copy_path(path: &Path, tag: &str) -> PathBuf {
    let stem = path
        .file_stem()
        .map(|stem| stem.to_string_lossy().to_string())
        .unwrap_or_default();
    let tag: String = tag
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
        .take(48)
        .collect();
    path.with_file_name(format!("{stem}.{tag}.conflict.md"))
}

#[cfg(test)]
pub(crate) mod test_support;

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn assistants_stay_on_their_device() {
        let dir = tempfile::tempdir().unwrap();
        let config = quick_actions::tests_support_config(dir.path()).await;
        let names: Vec<&str> = core_collections(config)
            .iter()
            .map(|collection| collection.collection())
            .collect();
        // One device's assistant persona must never replace another device's.
        assert!(!names.contains(&PERSONAS_COLLECTION));
        assert!(names.contains(&MEMORY_COLLECTION));
    }
}

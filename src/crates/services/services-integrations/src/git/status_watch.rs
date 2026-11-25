//! Backend-owned Git status liveness.
//!
//! Clients used to poll `git_get_status` on a timer (every 2 s locally, 30 s
//! over SSH) for every open Git view. The backend now watches the repository
//! once and publishes [`GIT_STATUS_CHANGED_EVENT`] with the new status and a
//! per-repository revision whenever the status actually changed, so every
//! client (local window, browser, phone, peer controller) re-renders from the
//! same read instead of each one polling.
//!
//! Sources of change:
//! - working-tree edits arrive as the file-watch service's debounced batches
//!   for the workspace root the explorer registered (`start_file_watch`);
//! - Git metadata (`HEAD`, `index`, `packed-refs`, `refs/**`) is watched here
//!   directly, because the file-watch service deliberately skips `.git`;
//! - a local root that no file-watch registration covers is re-read on a slow
//!   timer, and a repository on another machine (SSH workspace) is polled by
//!   the backend, one poll for all clients;
//! - mutating Git commands [`GitStatusMonitor::poke`] the repository so the
//!   status after an operation is published at once.
//!
//! Interest is leased per watcher id (`git_watch_status` / `git_unwatch_status`):
//! a repository nobody watches costs nothing.

use async_trait::async_trait;
use log::{debug, warn};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use openbitfun_events::EventEmitter;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex as StdMutex, OnceLock, RwLock as StdRwLock};
use std::time::Duration;
use tokio::sync::{broadcast, mpsc};

use super::types::GitStatus;
use crate::file_watch::{get_global_file_watch_service, FileWatchEvent};

/// Event carrying [`GitStatusChanged`].
pub const GIT_STATUS_CHANGED_EVENT: &str = "git://status-changed";

/// Quiet period after the last change before the status is re-read.
const DEBOUNCE: Duration = Duration::from_millis(300);
/// Upper bound on how long a continuous stream of changes delays a read.
const MAX_DEBOUNCE: Duration = Duration::from_secs(2);
/// Re-read interval for a repository on another machine.
pub const REMOTE_POLL_INTERVAL: Duration = Duration::from_secs(30);
/// Re-read interval for a local root no file-watch registration covers.
pub const UNWATCHED_LOCAL_POLL_INTERVAL: Duration = Duration::from_secs(10);

/// Reads the current status of one repository (locally or over SSH).
#[async_trait]
pub trait GitStatusReader: Send + Sync {
    async fn read_status(&self) -> Result<GitStatus, String>;
}

/// The repository a watcher is interested in.
#[derive(Debug, Clone)]
pub struct GitStatusWatchTarget {
    pub workspace_id: String,
    pub repository_path: String,
    /// The local working tree; `None` for a repository on another machine.
    pub local_root: Option<PathBuf>,
}

/// Payload of [`GIT_STATUS_CHANGED_EVENT`].
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusChanged {
    pub workspace_id: String,
    pub repository_path: String,
    /// Increases by one per published change of this repository's status.
    pub revision: u64,
    pub status: GitStatus,
    /// `watch`, `poll` or `operation`.
    pub cause: &'static str,
}

/// Answer of a watch registration: the status now and how it stays live.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusWatchSnapshot {
    pub workspace_id: String,
    pub repository_path: String,
    pub revision: u64,
    pub status: Option<GitStatus>,
    /// The read error, when the first read failed (the watch stays active).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// `watch` (filesystem events) or `poll` (backend timer, SSH workspaces).
    pub mode: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub poll_interval_ms: Option<u64>,
    /// The event clients listen to.
    pub event: &'static str,
}

#[derive(Default)]
struct RepoState {
    revision: u64,
    /// [`GitStatus::fingerprint_u64`] of the last published status.
    last: Option<u64>,
}

struct RepoEntry {
    watchers: HashSet<String>,
    trigger: mpsc::UnboundedSender<&'static str>,
    state: Arc<tokio::sync::Mutex<RepoState>>,
    reader: Arc<dyn GitStatusReader>,
    task: tokio::task::JoinHandle<()>,
    local: bool,
}

fn repo_key(workspace_id: &str, repository_path: &str) -> String {
    format!("{workspace_id}\n{repository_path}")
}

type Emitter = Arc<StdRwLock<Option<Arc<dyn EventEmitter>>>>;

/// Process-wide Git status monitor.
pub struct GitStatusMonitor {
    emitter: Emitter,
    repos: StdMutex<HashMap<String, RepoEntry>>,
}

impl Default for GitStatusMonitor {
    fn default() -> Self {
        Self {
            emitter: Arc::new(StdRwLock::new(None)),
            repos: StdMutex::new(HashMap::new()),
        }
    }
}

static GLOBAL: OnceLock<Arc<GitStatusMonitor>> = OnceLock::new();

pub fn get_global_git_status_monitor() -> Arc<GitStatusMonitor> {
    GLOBAL
        .get_or_init(|| Arc::new(GitStatusMonitor::default()))
        .clone()
}

fn lock<T>(mutex: &StdMutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl GitStatusMonitor {
    pub fn set_emitter(&self, emitter: Arc<dyn EventEmitter>) {
        *self
            .emitter
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(emitter);
    }

    /// Registers `watcher_id`'s interest in a repository (idempotent per
    /// watcher) and returns the current status with its revision.
    pub async fn watch(
        &self,
        target: GitStatusWatchTarget,
        watcher_id: &str,
        reader: Arc<dyn GitStatusReader>,
    ) -> GitStatusWatchSnapshot {
        let key = repo_key(&target.workspace_id, &target.repository_path);
        let (state, reader, local) = {
            let mut repos = lock(&self.repos);
            let entry = repos.entry(key).or_insert_with(|| {
                let (trigger, receiver) = mpsc::unbounded_channel();
                let state = Arc::new(tokio::sync::Mutex::new(RepoState::default()));
                let task = tokio::spawn(run_repo(
                    target.clone(),
                    reader.clone(),
                    state.clone(),
                    self.emitter.clone(),
                    receiver,
                ));
                RepoEntry {
                    watchers: HashSet::new(),
                    trigger,
                    state,
                    reader: reader.clone(),
                    task,
                    local: target.local_root.is_some(),
                }
            });
            entry.watchers.insert(watcher_id.to_string());
            (entry.state.clone(), entry.reader.clone(), entry.local)
        };
        let read = reader.read_status().await;
        let mut state = state.lock().await;
        let (status, error) = match read {
            Ok(status) => {
                let fingerprint = Some(status.fingerprint_u64());
                if state.last.is_some() && state.last != fingerprint {
                    state.revision += 1;
                }
                state.last = fingerprint;
                (Some(status), None)
            }
            Err(error) => (None, Some(error)),
        };
        GitStatusWatchSnapshot {
            workspace_id: target.workspace_id,
            repository_path: target.repository_path,
            revision: state.revision,
            status,
            error,
            mode: if local { "watch" } else { "poll" },
            poll_interval_ms: (!local).then(|| REMOTE_POLL_INTERVAL.as_millis() as u64),
            event: GIT_STATUS_CHANGED_EVENT,
        }
    }

    /// Drops `watcher_id`'s interest; the last one stops the repository watch.
    pub fn unwatch(&self, workspace_id: &str, repository_path: &str, watcher_id: &str) -> bool {
        let key = repo_key(workspace_id, repository_path);
        let mut repos = lock(&self.repos);
        let Some(entry) = repos.get_mut(&key) else {
            return false;
        };
        let removed = entry.watchers.remove(watcher_id);
        if entry.watchers.is_empty() {
            if let Some(entry) = repos.remove(&key) {
                entry.task.abort();
            }
        }
        removed
    }

    /// Re-reads (and publishes, when changed) every watched repository of
    /// `workspace_id`, or at `repository_path`, right away.
    pub fn poke(&self, workspace_id: Option<&str>, repository_path: &str) {
        let repos = lock(&self.repos);
        for (key, entry) in repos.iter() {
            let (id, path) = key.split_once('\n').unwrap_or((key.as_str(), ""));
            if workspace_id == Some(id) || (!repository_path.is_empty() && path == repository_path)
            {
                let _ = entry.trigger.send("operation");
            }
        }
    }

    /// Number of repositories currently watched (diagnostics and tests).
    pub fn watched_repository_count(&self) -> usize {
        lock(&self.repos).len()
    }
}

/// Whether a working-tree path change can affect `git status` of `root`.
fn affects_worktree(root: &Path, path: &str) -> bool {
    let path = Path::new(path);
    path.starts_with(root)
}

/// Whether a change under the Git directory can affect `git status`.
pub fn affects_git_metadata(path: &Path) -> bool {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    if name.ends_with(".lock") {
        return false;
    }
    let text = path.to_string_lossy().replace('\\', "/");
    if text.contains("/objects/") || text.contains("/logs/") {
        return false;
    }
    matches!(
        name,
        "HEAD"
            | "index"
            | "packed-refs"
            | "MERGE_HEAD"
            | "ORIG_HEAD"
            | "FETCH_HEAD"
            | "CHERRY_PICK_HEAD"
    ) || text.contains("/refs/")
}

async fn root_is_watched(root: &Path) -> bool {
    get_global_file_watch_service()
        .get_watched_paths()
        .await
        .iter()
        .any(|watched| root.starts_with(Path::new(watched)))
}

/// Watches the Git directory (non-recursive) and its refs (recursive).
fn watch_git_metadata(
    root: &Path,
    changes: mpsc::UnboundedSender<&'static str>,
) -> Option<RecommendedWatcher> {
    let repo = git2::Repository::open(root).ok()?;
    let git_dir = std::fs::canonicalize(repo.path()).unwrap_or_else(|_| repo.path().to_path_buf());
    let common_dir =
        std::fs::canonicalize(repo.commondir()).unwrap_or_else(|_| repo.commondir().to_path_buf());
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        if let Ok(event) = event {
            if event.paths.iter().any(|path| affects_git_metadata(path)) {
                let _ = changes.send("watch");
            }
        }
    })
    .map_err(|error| warn!("Git metadata watch unavailable: {error}"))
    .ok()?;
    // One recursive registration per directory: some backends restart their
    // stream per added path. Objects, logs and lock files are filtered above.
    let mut targets = vec![(git_dir.clone(), RecursiveMode::Recursive)];
    if !git_dir.starts_with(&common_dir) {
        targets.push((common_dir, RecursiveMode::Recursive));
    }
    for (path, mode) in targets {
        if let Err(error) = watcher.watch(&path, mode) {
            debug!(
                "Git metadata watch skipped: path={} error={}",
                path.display(),
                error
            );
        }
    }
    Some(watcher)
}

async fn publish(
    target: &GitStatusWatchTarget,
    reader: &Arc<dyn GitStatusReader>,
    state: &Arc<tokio::sync::Mutex<RepoState>>,
    emitter: &Emitter,
    cause: &'static str,
) {
    let status = match reader.read_status().await {
        Ok(status) => status,
        Err(error) => {
            debug!(
                "Git status re-read failed: repository={} error={}",
                target.repository_path, error
            );
            return;
        }
    };
    let fingerprint = Some(status.fingerprint_u64());
    let revision = {
        let mut state = state.lock().await;
        if state.last == fingerprint {
            return;
        }
        state.last = fingerprint;
        state.revision += 1;
        state.revision
    };
    let emitter = emitter
        .read()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone();
    let Some(emitter) = emitter else {
        return;
    };
    let payload = GitStatusChanged {
        workspace_id: target.workspace_id.clone(),
        repository_path: target.repository_path.clone(),
        revision,
        status,
        cause,
    };
    match serde_json::to_value(payload) {
        Ok(payload) => {
            if let Err(error) = emitter.emit(GIT_STATUS_CHANGED_EVENT, payload).await {
                warn!("Failed to emit {GIT_STATUS_CHANGED_EVENT}: {error}");
            }
        }
        Err(error) => warn!("Failed to encode {GIT_STATUS_CHANGED_EVENT}: {error}"),
    }
}

async fn run_repo(
    target: GitStatusWatchTarget,
    reader: Arc<dyn GitStatusReader>,
    state: Arc<tokio::sync::Mutex<RepoState>>,
    emitter: Emitter,
    mut triggers: mpsc::UnboundedReceiver<&'static str>,
) {
    let (metadata_sender, mut metadata) = mpsc::unbounded_channel();
    let root = target.local_root.clone();
    let _metadata_watcher = match &root {
        Some(root) => {
            let root = root.clone();
            let sender = metadata_sender.clone();
            tokio::task::spawn_blocking(move || watch_git_metadata(&root, sender))
                .await
                .ok()
                .flatten()
        }
        None => None,
    };
    drop(metadata_sender);
    if root.is_some() {
        // Starting a native watch can take a moment; whatever changed while it
        // started is published now instead of waiting for the next change.
        publish(&target, &reader, &state, &emitter, "watch").await;
    }
    let mut file_batches: Option<broadcast::Receiver<Vec<FileWatchEvent>>> = root
        .as_ref()
        .map(|_| get_global_file_watch_service().subscribe());

    loop {
        let poll_interval = match &root {
            None => REMOTE_POLL_INTERVAL,
            Some(root) if root_is_watched(root).await => Duration::from_secs(3600),
            Some(_) => UNWATCHED_LOCAL_POLL_INTERVAL,
        };
        let cause = tokio::select! {
            trigger = triggers.recv() => match trigger {
                Some(cause) => cause,
                None => return,
            },
            Some(cause) = metadata.recv() => cause,
            batch = async {
                match file_batches.as_mut() {
                    Some(receiver) => Some(receiver.recv().await),
                    None => std::future::pending().await,
                }
            } => match batch {
                Some(Ok(events)) => {
                    let Some(root) = root.as_ref() else { continue };
                    if !events.iter().any(|event| affects_worktree(root, &event.path)) {
                        continue;
                    }
                    "watch"
                }
                Some(Err(broadcast::error::RecvError::Lagged(_))) => "watch",
                Some(Err(broadcast::error::RecvError::Closed)) | None => {
                    file_batches = None;
                    continue;
                }
            },
            _ = tokio::time::sleep(poll_interval) => "poll",
        };
        // Coalesce a burst (a checkout touches many files) into one read.
        let started = tokio::time::Instant::now();
        let mut cause = cause;
        loop {
            let remaining = MAX_DEBOUNCE.saturating_sub(started.elapsed());
            if remaining.is_zero() {
                break;
            }
            tokio::select! {
                Some(next) = triggers.recv() => { if next == "operation" { cause = next; } }
                Some(_) = metadata.recv() => {}
                _ = tokio::time::sleep(DEBOUNCE.min(remaining)) => break,
            }
        }
        publish(&target, &reader, &state, &emitter, cause).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    struct Counter {
        reads: AtomicUsize,
        branch: StdMutex<String>,
    }

    #[async_trait]
    impl GitStatusReader for Counter {
        async fn read_status(&self) -> Result<GitStatus, String> {
            self.reads.fetch_add(1, Ordering::SeqCst);
            Ok(GitStatus {
                staged: Vec::new(),
                unstaged: Vec::new(),
                untracked: Vec::new(),
                conflicts: Vec::new(),
                current_branch: lock(&self.branch).clone(),
                ahead: 0,
                behind: 0,
            })
        }
    }

    struct Recorder(StdMutex<Vec<serde_json::Value>>);

    #[async_trait]
    impl EventEmitter for Recorder {
        async fn emit(&self, event: &str, payload: serde_json::Value) -> anyhow::Result<()> {
            assert_eq!(event, GIT_STATUS_CHANGED_EVENT);
            lock(&self.0).push(payload);
            Ok(())
        }
    }

    #[test]
    fn metadata_filter_ignores_locks_objects_and_logs() {
        assert!(affects_git_metadata(Path::new("/r/.git/HEAD")));
        assert!(affects_git_metadata(Path::new("/r/.git/index")));
        assert!(affects_git_metadata(Path::new("/r/.git/refs/heads/main")));
        assert!(!affects_git_metadata(Path::new("/r/.git/index.lock")));
        assert!(!affects_git_metadata(Path::new("/r/.git/objects/ab/cd")));
        assert!(!affects_git_metadata(Path::new(
            "/r/.git/logs/refs/heads/main"
        )));
        assert!(!affects_git_metadata(Path::new("/r/.git/config")));
    }

    struct LocalReader(PathBuf);

    #[async_trait]
    impl GitStatusReader for LocalReader {
        async fn read_status(&self) -> Result<GitStatus, String> {
            crate::git::GitService::get_status(&self.0)
                .await
                .map_err(|error| error.to_string())
        }
    }

    #[tokio::test]
    async fn a_commit_made_outside_the_backend_is_published() {
        use crate::git::compound::{GitCommandRunner, LocalGitRunner};
        let dir = tempfile::tempdir().unwrap();
        let root = std::fs::canonicalize(dir.path()).unwrap();
        let runner = LocalGitRunner::new(root.to_string_lossy());
        for args in [
            vec!["init", "-q", "-b", "main"],
            vec!["config", "user.email", "t@example.com"],
            vec!["config", "user.name", "t"],
            vec!["commit", "-q", "--allow-empty", "-m", "init"],
        ] {
            let args: Vec<String> = args.into_iter().map(String::from).collect();
            assert_eq!(runner.run(&args).await.unwrap().exit_code, 0);
        }
        let monitor = GitStatusMonitor::default();
        let recorder = Arc::new(Recorder(StdMutex::new(Vec::new())));
        monitor.set_emitter(recorder.clone());
        let target = GitStatusWatchTarget {
            workspace_id: "ws".into(),
            repository_path: root.to_string_lossy().into_owned(),
            local_root: Some(root.clone()),
        };
        let snapshot = monitor
            .watch(target, "a", Arc::new(LocalReader(root.clone())))
            .await;
        assert_eq!(snapshot.mode, "watch");
        tokio::time::sleep(Duration::from_millis(300)).await;
        // `.git` only: staging a file touches the index, nothing the explorer watch sees.
        std::fs::write(root.join("f.txt"), "x").unwrap();
        let add: Vec<String> = ["add", "f.txt"].into_iter().map(String::from).collect();
        assert_eq!(runner.run(&add).await.unwrap().exit_code, 0);
        let deadline = tokio::time::Instant::now() + Duration::from_secs(8);
        loop {
            if let Some(event) = lock(&recorder.0).last().cloned() {
                if event["status"]["staged"]
                    .as_array()
                    .is_some_and(|staged| !staged.is_empty())
                {
                    assert_eq!(event["cause"], "watch");
                    break;
                }
            }
            assert!(
                tokio::time::Instant::now() < deadline,
                "no git://status-changed after git add"
            );
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        monitor.unwatch("ws", &root.to_string_lossy(), "a");
    }

    #[tokio::test]
    async fn operation_poke_publishes_only_real_changes_with_a_revision() {
        let monitor = GitStatusMonitor::default();
        let recorder = Arc::new(Recorder(StdMutex::new(Vec::new())));
        monitor.set_emitter(recorder.clone());
        let reader = Arc::new(Counter {
            reads: AtomicUsize::new(0),
            branch: StdMutex::new("main".into()),
        });
        let target = GitStatusWatchTarget {
            workspace_id: "ws".into(),
            repository_path: "/remote/repo".into(),
            local_root: None,
        };
        let first = monitor.watch(target.clone(), "a", reader.clone()).await;
        assert_eq!(first.revision, 0);
        assert_eq!(first.mode, "poll");
        // Same watcher twice is one lease.
        monitor.watch(target.clone(), "a", reader.clone()).await;
        monitor.watch(target.clone(), "b", reader.clone()).await;

        monitor.poke(Some("ws"), "");
        tokio::time::sleep(DEBOUNCE * 2).await;
        assert!(
            lock(&recorder.0).is_empty(),
            "unchanged status is not published"
        );

        *lock(&reader.branch) = "feat".into();
        monitor.poke(None, "/remote/repo");
        tokio::time::sleep(DEBOUNCE * 3).await;
        let events = lock(&recorder.0).clone();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0]["revision"], 1);
        assert_eq!(events[0]["cause"], "operation");
        assert_eq!(events[0]["status"]["current_branch"], "feat");
        // The pushed status carries its fingerprint, and it moved with the change.
        let pushed = events[0]["status"]["fingerprint"].as_str().unwrap();
        let snapshot = serde_json::to_value(&first).unwrap();
        let initial = snapshot["status"]["fingerprint"].as_str().unwrap();
        assert_eq!(pushed.len(), 16);
        assert_ne!(pushed, initial);

        assert!(monitor.unwatch("ws", "/remote/repo", "a"));
        assert_eq!(monitor.watched_repository_count(), 1);
        assert!(monitor.unwatch("ws", "/remote/repo", "b"));
        assert_eq!(monitor.watched_repository_count(), 0);
    }
}

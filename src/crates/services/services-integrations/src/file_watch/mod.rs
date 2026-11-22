//! File watch service.
//!
//! Exposes filesystem watching as a product-facing service instead of a raw infrastructure detail.

pub mod service;
pub mod types;

pub use service::{
    get_file_watch_status, get_global_file_watch_service, get_watched_paths,
    initialize_file_watch_service, retry_file_watch, start_file_watch, stop_file_watch,
    FileWatchService, FILE_WATCH_STATUS_CHANGED_EVENT,
};
pub use types::{
    FileWatchEvent, FileWatchEventKind, FileWatchFailure, FileWatchFailureCode, FileWatchStatus,
    FileWatcherConfig,
};

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};

/// Lightweight filesystem watcher guard that invokes a callback whenever a
/// watched directory changes (excluding pure access events).
pub struct PathChangeWatcher {
    _watcher: RecommendedWatcher,
}

impl PathChangeWatcher {
    /// Watches the provided `(path, recursive)` pairs and invokes `on_change`
    /// on filesystem mutations. If a target path does not yet exist, its
    /// nearest existing ancestor is watched non-recursively so creation is
    /// observed. Returns `None` if no OS watch could be installed.
    pub fn watch_paths<F>(targets: &[(PathBuf, bool)], on_change: F) -> Option<Self>
    where
        F: Fn() + Send + 'static,
    {
        let mut watcher =
            notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
                if let Ok(event) = event {
                    if !matches!(event.kind, EventKind::Access(_)) {
                        on_change();
                    }
                }
            })
            .ok()?;

        let mut watched_any = false;
        let mut seen: HashSet<(PathBuf, bool)> = HashSet::new();
        for (target, recursive) in targets {
            let (watch_path, mode_recursive) = if target.exists() {
                (target.clone(), *recursive)
            } else {
                let Some(ancestor) = nearest_existing_ancestor(target) else {
                    continue;
                };
                (ancestor, false)
            };
            if !seen.insert((watch_path.clone(), mode_recursive)) {
                continue;
            }
            let mode = if mode_recursive {
                RecursiveMode::Recursive
            } else {
                RecursiveMode::NonRecursive
            };
            if watcher.watch(&watch_path, mode).is_ok() {
                watched_any = true;
            }
        }

        watched_any.then_some(Self { _watcher: watcher })
    }
}

fn nearest_existing_ancestor(path: &Path) -> Option<PathBuf> {
    let mut current = path.parent();
    while let Some(dir) = current {
        if dir.exists() {
            return Some(dir.to_path_buf());
        }
        current = dir.parent();
    }
    None
}

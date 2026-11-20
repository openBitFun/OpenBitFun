//! The workspace navigator view model.
//!
//! Every client used to merge the opened list, the recent list and the current
//! workspace on its own, and decide which workspace a surface without a
//! selection should show. This projection owns those rules so the desktop, a
//! browser, a phone and a Peer controller show the same navigator.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;

/// Why `selected_id` is the workspace the navigator shows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceNavigatorSelection {
    /// The caller's selection is still opened; keep it.
    Kept,
    /// The host's current workspace (the caller had none, or its selection closed).
    HostCurrent,
    /// No usable current workspace; the first opened one. The caller should make
    /// it the host's active workspace.
    FirstOpened,
    /// Nothing is opened. `reopen_candidate_id` names the recent workspace a
    /// surface that reopens on startup should open.
    None,
}

/// Opened and recent workspaces, deduplicated, with the selection resolved.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceNavigator<T> {
    pub opened: Vec<T>,
    /// Remembered but not opened; never contains an opened workspace.
    pub recent: Vec<T>,
    pub selected_id: Option<String>,
    pub selection: WorkspaceNavigatorSelection,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reopen_candidate_id: Option<String>,
}

fn unique_by_id<T>(list: Vec<T>, id: &impl Fn(&T) -> &str, exclude: &HashSet<String>) -> Vec<T> {
    let mut seen = HashSet::new();
    list.into_iter()
        .filter(|item| {
            let key = id(item).trim();
            !key.is_empty() && !exclude.contains(key) && seen.insert(key.to_string())
        })
        .collect()
}

/// Projects the navigator. `selected_id` is the caller's current selection, if
/// any; `current_id` is the host's active workspace.
pub fn project_workspace_navigator<T>(
    opened: Vec<T>,
    recent: Vec<T>,
    current_id: Option<&str>,
    selected_id: Option<&str>,
    id: impl Fn(&T) -> &str,
) -> WorkspaceNavigator<T> {
    let opened = unique_by_id(opened, &id, &HashSet::new());
    let opened_ids: HashSet<String> = opened.iter().map(|item| id(item).to_string()).collect();
    let recent = unique_by_id(recent, &id, &opened_ids);
    let usable = |candidate: Option<&str>| {
        candidate
            .map(str::trim)
            .filter(|value| opened_ids.contains(*value))
            .map(str::to_string)
    };

    let (selected_id, selection) = if let Some(kept) = usable(selected_id) {
        (Some(kept), WorkspaceNavigatorSelection::Kept)
    } else if let Some(current) = usable(current_id) {
        (Some(current), WorkspaceNavigatorSelection::HostCurrent)
    } else if let Some(first) = opened.first() {
        (
            Some(id(first).to_string()),
            WorkspaceNavigatorSelection::FirstOpened,
        )
    } else {
        (None, WorkspaceNavigatorSelection::None)
    };
    let reopen_candidate_id = (selection == WorkspaceNavigatorSelection::None)
        .then(|| recent.first().map(|item| id(item).to_string()))
        .flatten();

    WorkspaceNavigator {
        opened,
        recent,
        selected_id,
        selection,
        reopen_candidate_id,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(list: &[&'static str]) -> Vec<&'static str> {
        list.to_vec()
    }

    fn project(
        opened: &[&'static str],
        recent: &[&'static str],
        current: Option<&str>,
        selected: Option<&str>,
    ) -> WorkspaceNavigator<&'static str> {
        project_workspace_navigator(ids(opened), ids(recent), current, selected, |item| item)
    }

    #[test]
    fn dedupes_and_never_lists_an_opened_workspace_as_recent() {
        let view = project(&["a", "b", "a", ""], &["b", "c", "c", "d"], None, None);
        assert_eq!(view.opened, vec!["a", "b"]);
        assert_eq!(view.recent, vec!["c", "d"]);
    }

    #[test]
    fn keeps_a_selection_that_is_still_opened() {
        let view = project(&["a", "b"], &[], Some("a"), Some("b"));
        assert_eq!(view.selected_id.as_deref(), Some("b"));
        assert_eq!(view.selection, WorkspaceNavigatorSelection::Kept);
    }

    #[test]
    fn falls_back_to_host_current_then_first_opened() {
        let view = project(&["a", "b"], &[], Some("b"), Some("closed"));
        assert_eq!(view.selected_id.as_deref(), Some("b"));
        assert_eq!(view.selection, WorkspaceNavigatorSelection::HostCurrent);

        let view = project(&["a", "b"], &[], Some("gone"), None);
        assert_eq!(view.selected_id.as_deref(), Some("a"));
        assert_eq!(view.selection, WorkspaceNavigatorSelection::FirstOpened);
        assert_eq!(view.reopen_candidate_id, None);
    }

    #[test]
    fn nothing_opened_names_the_most_recent_as_reopen_candidate() {
        let view = project(&[], &["r1", "r2"], None, Some("old"));
        assert_eq!(view.selected_id, None);
        assert_eq!(view.selection, WorkspaceNavigatorSelection::None);
        assert_eq!(view.reopen_candidate_id.as_deref(), Some("r1"));
    }

    #[test]
    fn serializes_camel_case_with_snake_case_selection() {
        let view = project(&["a"], &[], None, None);
        let value = serde_json::to_value(&view).unwrap();
        assert_eq!(value["selectedId"], "a");
        assert_eq!(value["selection"], "first_opened");
        assert!(value.get("reopenCandidateId").is_none());
    }
}

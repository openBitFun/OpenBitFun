//! Transcript view (logic batch 4).
//!
//! `get_session_transcript_view` answers the conversation as typed transcript
//! turns from the same projection mobile and IM bots read
//! (`remote_connect::transcript_view`), so clients no longer parse persisted
//! turn records themselves. Each turn says whether it is `settled` (the host
//! persisted a terminal status), which is the only signal a client needs to
//! replace its live stream with the durable record. A `cursor` from the last
//! read makes the next read return only the turns after the last settled one.
//!
//! A client that opens a session while a turn runs also gets `runningTurn`:
//! the runtime journal's projection of that turn as the same `agentic://*`
//! events the live wire carries, with the delivery cursor they reached. The
//! client replays them through its live handlers and drops live events at or
//! below that cursor, so the running turn appears exactly as an attached
//! client sees it. The live channel itself stays the `agentic://*` events.

use crate::api::agentic_api::{
    desktop_session_scope, running_turn_event_snapshot, FrontendSessionEventProjectionSnapshot,
};
use crate::host::State;
use crate::runtime::DesktopRuntimeContext;
use openbitfun_core::service::snapshot::open_snapshot_history_for_workspace;
use openbitfun_core::{
    is_prompt_suggestion_enabled, resolved_transcript_prompt_suggestion,
    session_transcript_view_before_from_turns, session_transcript_view_from_turns,
    SessionTranscriptView, TranscriptTurnFileChange,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

/// The transcript view plus the turn running right now, when one is.
///
/// `runningTurn` is additive: older clients ignore it, and a client of an
/// older host simply never hydrates a turn it did not see start.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSessionTranscriptView {
    #[serde(flatten)]
    pub view: SessionTranscriptView,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub running_turn: Option<FrontendSessionEventProjectionSnapshot>,
}

/// Field names follow `load_session_turns` (`session_id`, `workspace_id`), the
/// shape session commands already use; camelCase is accepted too.
#[derive(Debug, Deserialize)]
pub struct GetSessionTranscriptViewRequest {
    #[serde(alias = "sessionId")]
    pub session_id: String,
    #[serde(default, alias = "workspaceId")]
    pub workspace_id: Option<String>,
    #[serde(default, alias = "workspacePath")]
    pub workspace_path: String,
    #[serde(default, alias = "remoteConnectionId")]
    pub remote_connection_id: Option<String>,
    #[serde(default, alias = "remoteSshHost")]
    pub remote_ssh_host: Option<String>,
    /// The most recent turns to answer; all of them when omitted.
    #[serde(default)]
    pub limit: Option<usize>,
    /// The `cursor` the previous read returned.
    #[serde(default)]
    pub cursor: Option<String>,
    /// Exclusive upper bound on storage `turn_index` for backward pagination.
    /// When set, returns up to `limit` visible turns strictly older than this
    /// index (`mode: "before"`) without re-reading newer turns.
    #[serde(default, alias = "beforeTurnIndex")]
    pub before_turn_index: Option<usize>,
}

/// Whether the host holds turns older than a window read with `limit`.
#[cfg(test)]
pub(crate) fn window_has_earlier(
    limit: Option<usize>,
    loaded: usize,
    first_index: Option<usize>,
) -> bool {
    match limit {
        Some(limit) => loaded >= limit && first_index.is_some_and(|index| index > 0),
        None => false,
    }
}

// @backend-command
pub async fn get_session_transcript_view(
    runtime: State<'_, DesktopRuntimeContext>,
    request: GetSessionTranscriptViewRequest,
) -> Result<DesktopSessionTranscriptView, String> {
    let session_id = request.session_id.trim().to_string();
    if session_id.is_empty() {
        return Err("session_id is required".to_string());
    }
    let limit = request.limit.filter(|limit| *limit > 0);
    let before_turn_index = request.before_turn_index;
    let request_workspace_id = request.workspace_id.clone();
    let scope = desktop_session_scope(
        request.workspace_id,
        request.workspace_path,
        request.remote_connection_id,
        request.remote_ssh_host,
    );
    let page = runtime
        .session_application()
        .load_session_turns_page(scope.clone(), &session_id, before_turn_index, limit)
        .await
        .map_err(|error| format!("Failed to load session transcript: {error}"))?;
    let is_before_page = before_turn_index.is_some();
    let mut view = if is_before_page {
        session_transcript_view_before_from_turns(&session_id, &page.turns, page.has_earlier)
    } else {
        session_transcript_view_from_turns(
            &session_id,
            &page.turns,
            request
                .cursor
                .as_deref()
                .filter(|cursor| !cursor.is_empty()),
            page.has_earlier,
        )
    };
    let running_turn = if is_before_page {
        None
    } else {
        runtime
            .session_application()
            .running_turn_projection(&session_id)
            .and_then(|(snapshot, acp)| running_turn_event_snapshot(snapshot, acp))
            // A turn the view already reports settled is not running any more,
            // whatever the journal still holds for late subscribers.
            .filter(|snapshot| {
                snapshot.active_turn_id.as_deref().is_some_and(|turn_id| {
                    !view
                        .turns
                        .iter()
                        .any(|turn| turn.turn_id == turn_id && turn.settled)
                })
            })
    };
    let explicit_workspace_id = request_workspace_id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .map(str::to_string);
    let need_prompt_suggestion = !is_before_page && running_turn.is_none();
    let settled_turn_indices: BTreeSet<usize> = view
        .turns
        .iter()
        .filter(|turn| turn.settled)
        .map(|turn| turn.turn_index)
        .collect();
    let need_metadata = need_prompt_suggestion
        || (explicit_workspace_id.is_none() && !settled_turn_indices.is_empty());
    let metadata = if need_metadata {
        runtime
            .session_application()
            .load_session_metadata(scope, &session_id)
            .await
            .ok()
            .flatten()
    } else {
        None
    };
    let workspace_id_for_snapshot = explicit_workspace_id.or_else(|| {
        metadata
            .as_ref()
            .and_then(|meta| meta.workspace_id.as_deref())
            .map(str::trim)
            .filter(|id| !id.is_empty())
            .map(str::to_string)
    });
    if !settled_turn_indices.is_empty() {
        if let Some(workspace_id) = workspace_id_for_snapshot.as_deref() {
            if let Ok(manager) = open_snapshot_history_for_workspace(workspace_id).await {
                if let Ok(by_turn) = manager
                    .get_turn_file_change_summaries_for_turns(&session_id, &settled_turn_indices)
                    .await
                {
                    for turn in &mut view.turns {
                        if !turn.settled {
                            continue;
                        }
                        if let Some(changes) = by_turn.get(&turn.turn_index) {
                            turn.file_changes = changes
                                .iter()
                                .map(|entry| TranscriptTurnFileChange {
                                    file_path: entry.file_path.clone(),
                                    lines_added: entry.lines_added,
                                    lines_removed: entry.lines_removed,
                                    change_kind: entry.change_kind.clone(),
                                    operation_id: Some(entry.operation_id.clone()),
                                })
                                .collect();
                        }
                    }
                }
            }
        }
    }
    if need_prompt_suggestion && is_prompt_suggestion_enabled().await {
        view.prompt_suggestion =
            resolved_transcript_prompt_suggestion(metadata.as_ref(), &page.turns);
    }
    Ok(DesktopSessionTranscriptView { view, running_turn })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_reads_session_command_and_camel_case_shapes() {
        let snake: GetSessionTranscriptViewRequest = serde_json::from_value(serde_json::json!({
            "session_id": "s1", "workspace_id": "w1", "limit": 30
        }))
        .unwrap();
        assert_eq!(snake.session_id, "s1");
        assert_eq!(snake.workspace_id.as_deref(), Some("w1"));
        assert_eq!(snake.limit, Some(30));
        assert!(snake.cursor.is_none());
        assert!(snake.before_turn_index.is_none());
        let camel: GetSessionTranscriptViewRequest = serde_json::from_value(serde_json::json!({
            "sessionId": "s2", "workspaceId": "w2", "cursor": "tv1:0:abc:t", "beforeTurnIndex": 12
        }))
        .unwrap();
        assert_eq!(camel.session_id, "s2");
        assert_eq!(camel.cursor.as_deref(), Some("tv1:0:abc:t"));
        assert_eq!(camel.before_turn_index, Some(12));
        assert_eq!(camel.workspace_path, "");
        let snake_before: GetSessionTranscriptViewRequest =
            serde_json::from_value(serde_json::json!({
                "session_id": "s3", "limit": 10, "before_turn_index": 5
            }))
            .unwrap();
        assert_eq!(snake_before.before_turn_index, Some(5));
        assert_eq!(snake_before.limit, Some(10));
    }

    #[test]
    fn earlier_turns_exist_only_behind_a_full_window() {
        assert!(!window_has_earlier(None, 100, Some(5)));
        assert!(!window_has_earlier(Some(30), 12, Some(0)));
        assert!(!window_has_earlier(Some(30), 30, Some(0)));
        assert!(window_has_earlier(Some(30), 30, Some(4)));
    }
}

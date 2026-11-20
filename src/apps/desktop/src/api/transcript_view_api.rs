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
use openbitfun_core::{session_transcript_view_from_turns, SessionTranscriptView};
use serde::{Deserialize, Serialize};

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
}

/// Whether the host holds turns older than a window read with `limit`.
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
    let turns = runtime
        .session_application()
        .load_session_turns(
            desktop_session_scope(
                request.workspace_id,
                request.workspace_path,
                request.remote_connection_id,
                request.remote_ssh_host,
            ),
            &session_id,
            limit,
        )
        .await
        .map_err(|error| format!("Failed to load session transcript: {error}"))?;
    let has_earlier = window_has_earlier(
        limit,
        turns.len(),
        turns.first().map(|turn| turn.turn_index),
    );
    let view = session_transcript_view_from_turns(
        &session_id,
        &turns,
        request
            .cursor
            .as_deref()
            .filter(|cursor| !cursor.is_empty()),
        has_earlier,
    );
    let running_turn = runtime
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
        });
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
        let camel: GetSessionTranscriptViewRequest = serde_json::from_value(serde_json::json!({
            "sessionId": "s2", "workspaceId": "w2", "cursor": "tv1:0:abc:t"
        }))
        .unwrap();
        assert_eq!(camel.session_id, "s2");
        assert_eq!(camel.cursor.as_deref(), Some("tv1:0:abc:t"));
        assert_eq!(camel.workspace_path, "");
    }

    #[test]
    fn earlier_turns_exist_only_behind_a_full_window() {
        assert!(!window_has_earlier(None, 100, Some(5)));
        assert!(!window_has_earlier(Some(30), 12, Some(0)));
        assert!(!window_has_earlier(Some(30), 30, Some(0)));
        assert!(window_has_earlier(Some(30), 30, Some(4)));
    }
}

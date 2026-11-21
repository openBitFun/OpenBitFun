//! Event publication of the CLI Peer Device host to OBP controllers.
//!
//! Every agentic event this host produces is journaled and published to the
//! host's own OBP event ring (`crate::obp_host::publish_event`), not only the
//! Turns a controller submitted. Peer ownership is a cancellation and
//! bookkeeping boundary; it is not a visibility boundary. OBP connections
//! replay from that ring by cursor, so a controller that was away re-reads
//! instead of depending on per-controller delivery.

use std::collections::HashSet;

use openbitfun_agent_runtime::sdk::{
    attach_session_event_cursor, AgentEventReceiver, PermissionRequestEvent,
};
use openbitfun_agent_tools::effective_tool_invocation;
use openbitfun_events::{project_agentic_frontend_event, AgenticEvent, ToolEventData};
use tokio::sync::broadcast;

use super::state::{PeerHostState, PeerTurnKey};

/// Resolve the ownership bookkeeping an event carries, after visibility has
/// already been decided without it.
///
/// Peer ownership answers "may this host release Peer tracking for the Turn and
/// dedup its terminal delivery", never "may a controller see this". This host is
/// a Peer of the account, not a remote-execution proxy for one controller: a
/// Turn started in its own TUI belongs to the same Session an attached
/// controller renders, so it is journaled and forwarded like any other. Note
/// the return type — an unowned Turn yields no bookkeeping, and "suppress the
/// event" is deliberately not expressible through this seam.
fn owned_terminal_turn(
    turns: &super::state::PeerTurnTracker,
    session_id: &str,
    event_turn: Option<&PeerTurnKey>,
    terminal_turn: Option<PeerTurnKey>,
) -> Option<PeerTurnKey> {
    let peer_owned = turns.owns(session_id, event_turn.map(|turn| turn.turn_id.as_str()));
    terminal_turn.filter(|_| peer_owned)
}

fn settle_record_only_event(turns: &super::state::PeerTurnTracker, terminal: Option<&PeerTurnKey>) {
    if let Some(turn) = terminal {
        turns.finish_turn(turn);
    }
}

/// Subscribe to the invocation-scoped event source and publish this host's turns.
pub(crate) fn start_peer_event_fanout(state: PeerHostState, mut rx: AgentEventReceiver) {
    start_peer_permission_event_fanout(state.clone());
    state.turns.mark_event_stream_ready();
    tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(envelope) => {
                    if let Err(error) = handle_agentic_event(&state, envelope.event) {
                        tracing::error!("CLI session event publication failed: {error}");
                    }
                }
                Err(broadcast::error::RecvError::Lagged(skipped)) => {
                    tracing::error!("CLI session event source lagged by {skipped} events");
                }
                Err(broadcast::error::RecvError::Closed) => {
                    tracing::error!("CLI session event source closed");
                    break;
                }
            }
        }
    });
}

fn start_peer_permission_event_fanout(state: PeerHostState) {
    let Ok(mut receiver) = state.agent_runtime.subscribe_permission_requests() else {
        tracing::warn!("CLI permission event publication is unavailable");
        return;
    };
    tokio::spawn(async move {
        // Every pending request on this host is forwarded, not only the ones a
        // controller's own Turn raised. A controller rendering a Turn this host
        // started locally would otherwise watch it block forever with nothing
        // on screen to answer. The Runtime mailbox stays the single arbiter, so
        // whichever surface answers first settles the request.
        let mut forwarded_request_ids = HashSet::new();
        loop {
            match receiver.recv().await {
                Ok(event) => match &event {
                    PermissionRequestEvent::Asked { request } => {
                        forwarded_request_ids.insert(request.request_id.clone());
                        fanout_permission_event(event);
                    }
                    PermissionRequestEvent::Replied { request_id, .. }
                    | PermissionRequestEvent::Cancelled { request_id, .. } => {
                        if forwarded_request_ids.remove(request_id) {
                            fanout_permission_event(event);
                        }
                    }
                },
                Err(broadcast::error::RecvError::Lagged(skipped)) => {
                    tracing::warn!("CLI permission event publication lagged by {skipped} events");
                    let pending = state
                        .agent_runtime
                        .pending_permission_requests()
                        .unwrap_or_default();
                    let pending_ids = pending
                        .iter()
                        .map(|request| request.request_id.clone())
                        .collect::<HashSet<_>>();
                    let stale_request_ids = forwarded_request_ids
                        .difference(&pending_ids)
                        .cloned()
                        .collect::<Vec<_>>();
                    for request_id in stale_request_ids {
                        fanout_permission_event(PermissionRequestEvent::Cancelled {
                            request_id,
                            reason: "Permission event stream resynchronized".to_string(),
                        });
                    }
                    forwarded_request_ids = pending_ids;
                    for request in pending {
                        fanout_permission_event(PermissionRequestEvent::Asked { request });
                    }
                }
                Err(broadcast::error::RecvError::Closed) => {
                    tracing::error!("Peer permission event source closed; runtime turns and permission mailbox remain owned by the host");
                    break;
                }
            }
        }
    });
}

fn fanout_permission_event(event: PermissionRequestEvent) {
    match serde_json::to_value(event) {
        Ok(payload) => publish_host_event("permission://event", &payload),
        Err(error) => tracing::warn!("CLI permission event serialization failed: {error}"),
    }
}

/// Returns true when the sender side closed while the stale backlog was drained.
#[cfg(test)]
fn drain_broadcast_receiver(
    rx: &mut broadcast::Receiver<openbitfun_events::AgenticEventEnvelope>,
) -> bool {
    loop {
        match rx.try_recv() {
            Ok(_) | Err(broadcast::error::TryRecvError::Lagged(_)) => continue,
            Err(broadcast::error::TryRecvError::Empty) => return false,
            Err(broadcast::error::TryRecvError::Closed) => return true,
        }
    }
}

fn handle_agentic_event(state: &PeerHostState, event: AgenticEvent) -> Result<(), String> {
    let event_turn = event_turn_key(&event);
    let terminal_turn = terminal_turn_key(&event);
    if terminal_turn
        .as_ref()
        .is_some_and(|turn| state.turns.is_interrupted_terminal(turn))
    {
        return Ok(());
    }
    if let AgenticEvent::DialogTurnStarted {
        user_message_metadata,
        ..
    } = &event
    {
        let background_lineage = user_message_metadata
            .as_ref()
            .and_then(serde_json::Value::as_object)
            .filter(|metadata| {
                metadata.get("kind").and_then(serde_json::Value::as_str)
                    == Some("background_result")
                    && metadata
                        .get("sourceKind")
                        .and_then(serde_json::Value::as_str)
                        == Some("subagent")
            })
            .and_then(|metadata| {
                Some((
                    PeerTurnKey::new(
                        metadata.get("parentSessionId")?.as_str()?,
                        metadata.get("parentDialogTurnId")?.as_str()?,
                    ),
                    PeerTurnKey::new(
                        metadata.get("subagentSessionId")?.as_str()?,
                        metadata.get("subagentDialogTurnId")?.as_str()?,
                    ),
                ))
            });
        if let Some((parent, source_child)) = background_lineage {
            if let Some(turn) = event_turn.as_ref() {
                state
                    .turns
                    .register_background_follow_up(&parent, &source_child, turn.clone())?;
            }
        }
    }

    if let AgenticEvent::SubagentSessionLinked {
        session_id,
        subagent_dialog_turn_id,
        parent_session_id,
        parent_dialog_turn_id,
        parent_tool_call_id,
        ..
    } = &event
    {
        state.turns.register_linked_child(
            &PeerTurnKey::new(parent_session_id, parent_dialog_turn_id),
            PeerTurnKey::new(session_id, subagent_dialog_turn_id),
            parent_tool_call_id,
        )?;
    }

    if matches!(&event, AgenticEvent::DialogTurnStarted { .. }) {
        if let Some(turn) = event_turn.as_ref() {
            // Only a Peer-registered root enters `started`. A Turn this host
            // started on its own has no Peer ownership to record, and that is
            // not a reason to hide it.
            state.turns.mark_started(turn);
        }
    }

    let Some(session_id) = event.session_id() else {
        return Ok(());
    };

    let terminal_turn =
        owned_terminal_turn(&state.turns, session_id, event_turn.as_ref(), terminal_turn);
    if let Some(turn) = terminal_turn.as_ref() {
        if !state.turns.claim_terminal_delivery(turn)? {
            return Ok(());
        }
    }

    if let AgenticEvent::UserSteeringInjected {
        session_id,
        turn_id,
        steering_id,
        ..
    } = &event
    {
        state
            .turns
            .finish_background_injection(&PeerTurnKey::new(session_id, turn_id), steering_id);
    }

    if let AgenticEvent::ToolEvent {
        session_id,
        turn_id,
        tool_event: ToolEventData::Started {
            identity, params, ..
        },
        ..
    } = &event
    {
        let (tool_name, params) = effective_tool_invocation(&identity.tool_name, params);
        debug_assert_eq!(identity.effective_name(), tool_name);
        if matches!(tool_name, "AgentSpawn" | "AgentFork")
            || (tool_name == "Task"
                && params
                    .get("run_in_background")
                    .and_then(serde_json::Value::as_bool)
                    == Some(true))
        {
            state.turns.record_background_task_call(
                &PeerTurnKey::new(session_id, turn_id),
                identity.tool_id.clone(),
            )?;
        } else if tool_name == "Task"
            && params.get("action").and_then(serde_json::Value::as_str) == Some("cancel")
        {
            if let Some(target_session_id) =
                params.get("session_id").and_then(serde_json::Value::as_str)
            {
                state.turns.record_background_task_cancellation(
                    &PeerTurnKey::new(session_id, turn_id),
                    identity.tool_id.clone(),
                    target_session_id.to_string(),
                )?;
            }
        }
    }

    if let AgenticEvent::ToolEvent {
        session_id,
        turn_id,
        tool_event,
        ..
    } = &event
    {
        let terminal_task_call = match tool_event {
            ToolEventData::Completed {
                identity, result, ..
            } if matches!(
                identity.effective_name(),
                "Task" | "AgentSpawn" | "AgentFork"
            ) =>
            {
                Some((
                    identity.tool_id.as_str(),
                    result
                        .get("bg_task_id")
                        .or_else(|| result.get("background_task_id"))
                        .and_then(serde_json::Value::as_str),
                    result
                        .get("cancelled_background_tasks")
                        .and_then(serde_json::Value::as_u64),
                ))
            }
            ToolEventData::Failed { identity, .. } | ToolEventData::Cancelled { identity, .. }
                if matches!(
                    identity.effective_name(),
                    "Task" | "AgentSpawn" | "AgentFork"
                ) =>
            {
                Some((identity.tool_id.as_str(), None, None))
            }
            _ => None,
        };
        if let Some((tool_id, background_task_id, cancelled_background_tasks)) = terminal_task_call
        {
            state.turns.finish_task_call(
                &PeerTurnKey::new(session_id, turn_id),
                tool_id,
                background_task_id,
                cancelled_background_tasks,
            );
        }
    }

    openbitfun_core::service::remote_connect::notify_session_catalog_event(&event);
    let cursor = state.session_event_journal.record(&event);
    let Some(mut projected) = project_agentic_frontend_event(event.clone()) else {
        if let Some(turn) = terminal_turn {
            state.turns.finish_turn(&turn);
        }
        return Ok(());
    };
    if let Some(cursor) = cursor {
        attach_session_event_cursor(&mut projected.payload, cursor);
    }
    // OBP controllers (over OpenBitFun Link) read this host's ordered event
    // stream with the payloads every OBP host publishes (canonical identity).
    crate::obp_host::publish_event(&projected.event_name, &projected.payload);
    // Publication is delivery: release Peer ownership on the terminal event.
    settle_record_only_event(&state.turns, terminal_turn.as_ref());
    Ok(())
}

fn event_turn_key(event: &AgenticEvent) -> Option<PeerTurnKey> {
    let (session_id, turn_id) = match event {
        AgenticEvent::DialogTurnStarted {
            session_id,
            turn_id,
            ..
        }
        | AgenticEvent::DialogTurnCompleted {
            session_id,
            turn_id,
            ..
        }
        | AgenticEvent::DialogTurnCancelled {
            session_id,
            turn_id,
            ..
        }
        | AgenticEvent::DialogTurnFailed {
            session_id,
            turn_id,
            ..
        }
        | AgenticEvent::TokenUsageUpdated {
            session_id,
            turn_id,
            ..
        }
        | AgenticEvent::ContextCompressionStarted {
            session_id,
            turn_id,
            ..
        }
        | AgenticEvent::ContextCompressionCompleted {
            session_id,
            turn_id,
            ..
        }
        | AgenticEvent::ContextCompressionFailed {
            session_id,
            turn_id,
            ..
        }
        | AgenticEvent::ModelRoundStarted {
            session_id,
            turn_id,
            ..
        }
        | AgenticEvent::ModelRoundCompleted {
            session_id,
            turn_id,
            ..
        }
        | AgenticEvent::TextChunk {
            session_id,
            turn_id,
            ..
        }
        | AgenticEvent::ThinkingChunk {
            session_id,
            turn_id,
            ..
        }
        | AgenticEvent::ToolEvent {
            session_id,
            turn_id,
            ..
        }
        | AgenticEvent::DeepReviewQueueStateChanged {
            session_id,
            turn_id,
            ..
        }
        | AgenticEvent::UserSteeringInjected {
            session_id,
            turn_id,
            ..
        } => (session_id, turn_id),
        AgenticEvent::SubagentSessionLinked {
            session_id,
            subagent_dialog_turn_id,
            ..
        } => (session_id, subagent_dialog_turn_id),
        _ => return None,
    };
    Some(PeerTurnKey::new(session_id, turn_id))
}

fn terminal_turn_key(event: &AgenticEvent) -> Option<PeerTurnKey> {
    match event {
        AgenticEvent::DialogTurnCompleted {
            session_id,
            turn_id,
            ..
        }
        | AgenticEvent::DialogTurnCancelled {
            session_id,
            turn_id,
            ..
        }
        | AgenticEvent::DialogTurnFailed {
            session_id,
            turn_id,
            ..
        } => Some(PeerTurnKey::new(session_id, turn_id)),
        _ => None,
    }
}

/// Host-local UI hints (for example the workspace catalog invalidation) have
/// no webview on a CLI host; OBP controllers are their only consumer, so the
/// emitter publishes them straight to the host's event ring.
pub(crate) struct PeerControllerEventEmitter;

#[async_trait::async_trait]
impl openbitfun_events::EventEmitter for PeerControllerEventEmitter {
    async fn emit(&self, event_name: &str, payload: serde_json::Value) -> anyhow::Result<()> {
        publish_host_event(event_name, &payload);
        Ok(())
    }
}

/// Publish one host event to OBP controllers (no-op until the host runs).
pub(crate) fn publish_host_event(event: &str, payload: &serde_json::Value) {
    crate::obp_host::publish_event(event, payload);
}

#[cfg(test)]
fn interrupted_turn_failure_projection(
    turn: &PeerTurnKey,
    reason: &str,
) -> (String, serde_json::Value) {
    let projected = project_agentic_frontend_event(AgenticEvent::DialogTurnFailed {
        session_id: turn.session_id.clone(),
        turn_id: turn.turn_id.clone(),
        error: reason.to_string(),
        error_category: None,
        error_detail: None,
    })
    .expect("DialogTurnFailed must have a frontend projection");
    (projected.event_name, projected.payload)
}

#[cfg(test)]
mod tests {
    use openbitfun_events::{AgenticEvent, AgenticEventEnvelope, AgenticEventPriority};

    use super::{
        drain_broadcast_receiver, event_turn_key, interrupted_turn_failure_projection,
        owned_terminal_turn, settle_record_only_event,
    };
    use crate::peer_host::state::{PeerTurnKey, PeerTurnTracker};

    #[test]
    fn zero_controllers_keep_running_turn_owned_until_reattach() {
        let tracker = PeerTurnTracker::new();
        tracker.mark_event_stream_ready();
        let turn = PeerTurnKey::new("session-1", "turn-1");
        tracker.register_root(turn.clone()).expect("register root");
        assert!(tracker.mark_started(&turn));

        settle_record_only_event(&tracker, None);

        assert!(tracker.owns("session-1", Some("turn-1")));
    }

    #[test]
    fn record_only_terminal_releases_peer_turn_ownership() {
        let tracker = PeerTurnTracker::new();
        tracker.mark_event_stream_ready();
        let turn = PeerTurnKey::new("session-1", "turn-1");
        tracker.register_root(turn.clone()).expect("register root");
        assert!(tracker.mark_started(&turn));
        assert!(tracker
            .claim_terminal_delivery(&turn)
            .expect("claim terminal"));

        settle_record_only_event(&tracker, Some(&turn));

        assert!(!tracker.owns("session-1", Some("turn-1")));
    }

    #[test]
    fn queued_peer_turn_does_not_authorize_session_scoped_events() {
        let tracker = PeerTurnTracker::new();
        tracker.mark_event_stream_ready();
        let turn = PeerTurnKey::new("session-1", "peer-turn");
        tracker.register_root(turn.clone()).expect("register root");
        let event = AgenticEvent::ImageAnalysisStarted {
            session_id: turn.session_id.clone(),
            image_count: 1,
            user_input: "local input".to_string(),
            image_metadata: None,
        };

        assert!(event_turn_key(&event).is_none());
        assert!(!tracker.owns(&turn.session_id, None));

        assert!(tracker.mark_started(&turn));
        assert!(tracker.owns(&turn.session_id, None));
        tracker.finish_turn(&turn);
        assert!(!tracker.owns(&turn.session_id, None));
    }

    #[test]
    fn interrupted_turn_projects_an_existing_failed_terminal_event() {
        let (event, payload) = interrupted_turn_failure_projection(
            &PeerTurnKey::new("session-1", "turn-1"),
            "Peer event stream lagged",
        );

        assert_eq!(event, "agentic://dialog-turn-failed");
        assert_eq!(payload["sessionId"], "session-1");
        assert_eq!(payload["turnId"], "turn-1");
        assert_eq!(payload["error"], "Peer event stream lagged");
    }

    #[test]
    fn draining_distinguishes_an_empty_live_stream_from_a_closed_stream() {
        let (tx, mut live_rx) = tokio::sync::broadcast::channel(1);
        assert!(!drain_broadcast_receiver(&mut live_rx));

        let mut closed_rx = tx.subscribe();
        drop(tx);
        assert!(drain_broadcast_receiver(&mut closed_rx));
    }

    #[test]
    fn draining_stale_backlog_does_not_release_interrupted_turn_quarantine() {
        let turns = PeerTurnTracker::new();
        turns.mark_event_stream_ready();
        let turn = PeerTurnKey::new("session-1", "turn-1");
        turns.register_root(turn.clone()).expect("register root");
        turns.interrupt_event_stream(false);
        turns.mark_event_stream_ready();

        let (tx, mut rx) = tokio::sync::broadcast::channel(2);
        tx.send(AgenticEventEnvelope::new(
            AgenticEvent::DialogTurnCancelled {
                session_id: turn.session_id.clone(),
                turn_id: turn.turn_id.clone(),
            },
            AgenticEventPriority::Normal,
        ))
        .expect("queue stale terminal");

        assert!(!drain_broadcast_receiver(&mut rx));
        assert!(turns.register_root(turn).is_err());
    }

    #[test]
    fn a_locally_started_turn_carries_no_peer_bookkeeping_and_is_still_forwarded() {
        let tracker = PeerTurnTracker::new();
        tracker.mark_event_stream_ready();
        let peer_turn = PeerTurnKey::new("session-1", "peer-turn");
        tracker
            .register_root(peer_turn.clone())
            .expect("register Peer-owned turn");
        let local_turn = PeerTurnKey::new("session-1", "local-turn");

        // A Turn the controller submitted still settles Peer tracking on its
        // terminal event.
        assert_eq!(
            owned_terminal_turn(
                &tracker,
                "session-1",
                Some(&peer_turn),
                Some(peer_turn.clone()),
            ),
            Some(peer_turn),
        );

        // A Turn this host started on its own has no Peer tracking to settle.
        // The caller keeps journaling and forwarding it regardless: there is no
        // value of this function that means "drop the event".
        assert_eq!(
            owned_terminal_turn(
                &tracker,
                "session-1",
                Some(&local_turn),
                Some(local_turn.clone()),
            ),
            None,
        );
        assert!(!tracker.owns("session-1", Some("local-turn")));
    }
}

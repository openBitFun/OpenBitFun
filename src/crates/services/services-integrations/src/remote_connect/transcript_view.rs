//! The one transcript projection every client reads (logic batch 4).
//!
//! A persisted dialog turn is projected here once into typed transcript items:
//! the user's message as the user wrote it, then the turn's thinking, answer
//! text and tool calls in the order they happened. The NSH UI reads it through
//! `get_session_transcript_view`; mobile and IM bots read the legacy
//! [`ChatMessage`] shape, which is derived from the same view by
//! [`chat_messages_from_transcript`], so the two can no longer disagree about
//! ordering, hidden subagent items, empty shells or a turn's status.
//!
//! The view also answers *when a turn is settled*: `settled` is true once the
//! host has persisted a terminal status for the turn. A client keeps its live
//! stream on screen until a view read reports the streaming turn settled, so no
//! client guesses from item counts or retries on a timer.

use serde::{Deserialize, Serialize};

use super::{
    make_slim_tool_params, project_remote_plan_tool, ChatImageAttachment, ChatMessage,
    ChatMessageItem, RemoteChatHistoryTurn, RemotePlanTool, RemoteToolStatus,
};

/// Tool names whose full input travels to mobile clients (they render it).
const CHAT_TOOL_INPUT_NAMES: &[&str] = &[
    "AskUserQuestion",
    "Task",
    "AgentSpawn",
    "AgentFork",
    "AgentSendInput",
    "AgentControl",
    "TodoWrite",
];

/// The cursor format version; an unknown prefix is answered with a full view.
const CURSOR_PREFIX: &str = "tv1";

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptImage {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data_url: Option<String>,
    /// The host path the attachment was taken from. Only meaningful on the
    /// host that wrote it; other clients name the image instead.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image_path: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptTokenUsage {
    pub input_tokens: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_tokens: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cached_tokens: Option<u64>,
    pub total_tokens: u64,
}

/// A recovery the host offers for an interrupted turn.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptTurnRecovery {
    /// `interrupted` or `recovering`.
    pub status: String,
    pub execution_generation: u32,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptUserMessage {
    pub id: String,
    /// What the user wrote, without prompt markup the host added.
    pub text: String,
    pub timestamp_ms: u64,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub images: Vec<TranscriptImage>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptToolView {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub input: serde_json::Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input_preview: Option<String>,
    /// `running`, `completed`, `error`, `cancelled`, ... as the host recorded it;
    /// `completed` / `running` when it recorded none.
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub success: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result_for_assistant: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    pub start_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan: Option<RemotePlanTool>,
    /// What a subagent this call started did, in order. Never drawn as the
    /// parent's own answer.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub subagent_items: Vec<TranscriptItemView>,
}

/// One thing a reader sees in a turn, in the order it happened.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TranscriptItemView {
    #[serde(rename_all = "camelCase")]
    Text {
        id: String,
        round_index: usize,
        text: String,
    },
    #[serde(rename_all = "camelCase")]
    Thinking {
        id: String,
        round_index: usize,
        text: String,
        /// `reasoning` or `summary`, when the provider said.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        reasoning_kind: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    Tool {
        round_index: usize,
        tool: TranscriptToolView,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptTurnView {
    pub turn_id: String,
    pub turn_index: usize,
    /// `user_dialog` or `manual_compaction`.
    pub kind: String,
    /// `active`, `done`, `failed` or `cancelled`.
    pub status: String,
    /// The host persisted a terminal status: the turn will not change unless it
    /// is resumed, so a client may replace its live stream with this record.
    pub settled: bool,
    pub user: TranscriptUserMessage,
    pub items: Vec<TranscriptItemView>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_detail: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effective_model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    pub start_time_ms: u64,
    /// When the assistant last wrote: the last round's end (or start), else the
    /// turn's start.
    pub assistant_timestamp_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub token_usage: Option<TranscriptTokenUsage>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recovery: Option<TranscriptTurnRecovery>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background_delivery: Option<openbitfun_core_types::background_delivery::BackgroundDelivery>,
}

impl TranscriptTurnView {
    /// Whether the assistant produced anything a reader would see.
    pub fn has_assistant_content(&self) -> bool {
        self.items.iter().any(|item| match item {
            TranscriptItemView::Text { text, .. } | TranscriptItemView::Thinking { text, .. } => {
                !text.trim().is_empty()
            }
            TranscriptItemView::Tool { .. } => true,
        }) || self
            .error
            .as_deref()
            .is_some_and(|error| !error.trim().is_empty())
    }
}

/// Persisted next-input prompt suggestion attached to a transcript view read.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptPromptSuggestion {
    #[serde(alias = "source_turn_id")]
    pub source_turn_id: String,
    pub suggestion: String,
}

/// The answer to `get_session_transcript_view`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionTranscriptView {
    pub session_id: String,
    /// `full`: the turns replace what the client holds. `after`: the client keeps
    /// its turns up to and including `keptThroughIndex`, drops the rest and
    /// appends `turns`.
    pub mode: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kept_through_index: Option<usize>,
    pub turns: Vec<TranscriptTurnView>,
    /// Pass back on the next read to receive only what changed after the last
    /// settled turn. Absent until a turn has settled.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor: Option<String>,
    /// The host holds turns older than this window.
    pub has_earlier: bool,
    /// Last persisted next-input suggestion when it still applies to the latest
    /// completed turn. Additive: older clients ignore it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt_suggestion: Option<TranscriptPromptSuggestion>,
}

struct OrderedEntry {
    order_index: Option<usize>,
    sequence: usize,
    round_idx: usize,
    parent_task_tool_id: Option<String>,
    is_subagent: bool,
    item: TranscriptItemView,
}

fn tool_status(status: Option<&str>, has_result: bool) -> String {
    status
        .unwrap_or(if has_result { "completed" } else { "running" })
        .to_string()
}

/// Project history turns into typed transcript turns.
pub fn build_transcript_view(turns: Vec<RemoteChatHistoryTurn>) -> Vec<TranscriptTurnView> {
    turns.into_iter().map(transcript_turn_view).collect()
}

fn transcript_turn_view(turn: RemoteChatHistoryTurn) -> TranscriptTurnView {
    let mut ordered = Vec::new();
    let mut sequence = 0usize;
    let assistant_timestamp_ms = turn
        .rounds
        .last()
        .map(|round| round.end_time_ms.unwrap_or(round.start_time_ms))
        .unwrap_or(turn.start_time_ms);
    let effective_model = turn
        .rounds
        .iter()
        .rev()
        .find_map(|round| {
            round
                .effective_model_name
                .as_deref()
                .map(str::trim)
                .filter(|name| !name.is_empty())
        })
        .map(ToOwned::to_owned);
    let duration_ms = turn.duration_ms.or_else(|| {
        let durations = turn
            .rounds
            .iter()
            .filter_map(|round| round.duration_ms)
            .collect::<Vec<_>>();
        (!durations.is_empty()).then(|| durations.iter().sum())
    });

    for (round_idx, round) in turn.rounds.into_iter().enumerate() {
        for item in round.thinking_items {
            if item.content.is_empty() {
                continue;
            }
            ordered.push(OrderedEntry {
                order_index: item.order_index,
                sequence,
                round_idx,
                parent_task_tool_id: item.parent_task_tool_id,
                is_subagent: item.is_subagent,
                item: TranscriptItemView::Thinking {
                    id: item.id,
                    round_index: round_idx,
                    text: item.content,
                    reasoning_kind: item.reasoning_kind,
                },
            });
            sequence += 1;
        }
        for item in round.text_items {
            if item.content.is_empty() {
                continue;
            }
            ordered.push(OrderedEntry {
                order_index: item.order_index,
                sequence,
                round_idx,
                parent_task_tool_id: item.parent_task_tool_id,
                is_subagent: item.is_subagent,
                item: TranscriptItemView::Text {
                    id: item.id,
                    round_index: round_idx,
                    text: item.content,
                },
            });
            sequence += 1;
        }
        for item in round.tool_items {
            let status = tool_status(item.status.as_deref(), item.has_result);
            let plan =
                project_remote_plan_tool(&item.name, Some(&item.call.input), item.result.as_ref());
            ordered.push(OrderedEntry {
                order_index: item.order_index,
                sequence,
                round_idx,
                parent_task_tool_id: item.parent_task_tool_id,
                is_subagent: item.is_subagent,
                item: TranscriptItemView::Tool {
                    round_index: round_idx,
                    tool: TranscriptToolView {
                        id: item.id,
                        name: item.name,
                        input_preview: make_slim_tool_params(&item.call.input),
                        input: item.call.input,
                        status,
                        success: item.success,
                        error: item.error,
                        result: item.result,
                        result_for_assistant: item.result_for_assistant,
                        duration_ms: item.duration_ms,
                        start_ms: item.start_ms,
                        plan,
                        subagent_items: Vec::new(),
                    },
                },
            });
            sequence += 1;
        }
    }

    ordered.sort_by(|a, b| {
        let round_cmp = a.round_idx.cmp(&b.round_idx);
        if round_cmp != std::cmp::Ordering::Equal {
            return round_cmp;
        }
        match (a.order_index, b.order_index) {
            (Some(a_idx), Some(b_idx)) => a_idx.cmp(&b_idx).then(a.sequence.cmp(&b.sequence)),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => a.sequence.cmp(&b.sequence),
        }
    });

    // Subagent items belong to the call that started the subagent. One whose
    // parent call is not in this turn has nowhere to be drawn and is dropped,
    // which is what remote clients always did.
    let mut items: Vec<TranscriptItemView> = Vec::new();
    let mut subagent: Vec<(String, TranscriptItemView)> = Vec::new();
    for entry in ordered {
        if entry.is_subagent {
            if let Some(parent) = entry.parent_task_tool_id {
                subagent.push((parent, entry.item));
            }
            continue;
        }
        items.push(entry.item);
    }
    for (parent, child) in subagent {
        if let Some(TranscriptItemView::Tool { tool, .. }) = items
            .iter_mut()
            .find(|item| matches!(item, TranscriptItemView::Tool { tool, .. } if tool.id == parent))
        {
            tool.subagent_items.push(child);
        }
    }

    let images = if turn.user_image_refs.is_empty() {
        turn.user_images
            .into_iter()
            .map(|image| TranscriptImage {
                name: image.name,
                data_url: Some(image.data_url).filter(|url| !url.is_empty()),
                image_path: None,
            })
            .collect()
    } else {
        turn.user_image_refs
    };

    TranscriptTurnView {
        settled: !turn.is_in_progress,
        turn_id: turn.turn_id,
        turn_index: turn.turn_index,
        kind: turn.kind.unwrap_or_else(|| "user_dialog".to_string()),
        status: turn.status,
        user: TranscriptUserMessage {
            id: turn.user_message_id,
            text: turn.user_display_content,
            timestamp_ms: turn.user_timestamp_ms,
            images,
        },
        items,
        error: turn.error,
        error_detail: turn.error_detail,
        effective_model,
        duration_ms,
        start_time_ms: turn.start_time_ms,
        assistant_timestamp_ms,
        token_usage: turn.token_usage,
        recovery: turn.recovery,
        background_delivery: turn.background_delivery,
    }
}

fn chat_item(item: &TranscriptItemView) -> ChatMessageItem {
    match item {
        TranscriptItemView::Thinking { text, .. } => ChatMessageItem {
            item_type: "thinking".to_string(),
            steering_id: None,
            round_index: None,
            content: Some(text.clone()),
            tool: None,
            is_subagent: None,
        },
        TranscriptItemView::Text { text, .. } => ChatMessageItem {
            item_type: "text".to_string(),
            steering_id: None,
            round_index: None,
            content: Some(text.clone()),
            tool: None,
            is_subagent: None,
        },
        TranscriptItemView::Tool { tool, .. } => ChatMessageItem {
            item_type: "tool".to_string(),
            steering_id: None,
            round_index: None,
            content: None,
            tool: Some(remote_tool_status(tool)),
            is_subagent: None,
        },
    }
}

fn remote_tool_status(tool: &TranscriptToolView) -> RemoteToolStatus {
    RemoteToolStatus {
        id: tool.id.clone(),
        name: tool.name.clone(),
        status: tool.status.clone(),
        duration_ms: tool.duration_ms,
        start_ms: Some(tool.start_ms),
        input_preview: tool.input_preview.clone(),
        tool_input: CHAT_TOOL_INPUT_NAMES
            .contains(&tool.name.as_str())
            .then(|| tool.input.clone()),
        plan: tool.plan.clone(),
    }
}

/// The legacy mobile/bot shape, derived from the shared transcript view.
pub fn chat_messages_from_transcript(turns: Vec<TranscriptTurnView>) -> Vec<ChatMessage> {
    let mut result = Vec::new();
    for turn in turns {
        let delivery_metadata = turn
            .background_delivery
            .as_ref()
            .map(|delivery| serde_json::json!({"backgroundDelivery":delivery}));
        let images = turn
            .user
            .images
            .iter()
            .map(|image| ChatImageAttachment {
                name: image.name.clone(),
                data_url: image.data_url.clone().unwrap_or_default(),
            })
            .collect::<Vec<_>>();
        result.push(ChatMessage {
            id: turn.user.id.clone(),
            role: "user".to_string(),
            content: turn.user.text.clone(),
            timestamp: (turn.user.timestamp_ms / 1000).to_string(),
            metadata: delivery_metadata.clone(),
            turn_id: Some(turn.turn_id.clone()),
            turn_index: Some(turn.turn_index),
            status: turn
                .background_delivery
                .as_ref()
                .map(|_| turn.status.clone()),
            error: None,
            tools: None,
            thinking: None,
            items: None,
            images: (!images.is_empty()).then_some(images),
        });

        // A turn is persisted as soon as it starts, before the assistant has
        // produced any content. That durable turn shell is not an assistant
        // message: while the turn is running, its live state is carried by
        // `active_turn`. Materializing the empty shell here would expose the
        // same turn through both history and live state and make clients render
        // two pending replies.
        if !turn.has_assistant_message_for_chat() {
            continue;
        }

        let mut text_parts = Vec::new();
        let mut thinking_parts = Vec::new();
        let mut tools = Vec::new();
        for item in &turn.items {
            match item {
                TranscriptItemView::Text { text, .. } => text_parts.push(text.clone()),
                TranscriptItemView::Thinking { text, .. } => thinking_parts.push(text.clone()),
                TranscriptItemView::Tool { tool, .. } => tools.push(remote_tool_status(tool)),
            }
        }
        let items = turn.items.iter().map(chat_item).collect::<Vec<_>>();
        result.push(ChatMessage {
            id: format!("{}_assistant", turn.turn_id),
            role: "assistant".to_string(),
            content: text_parts.join("\n\n"),
            timestamp: (turn.assistant_timestamp_ms / 1000).to_string(),
            metadata: delivery_metadata,
            turn_id: Some(turn.turn_id),
            // Rollback targets user turns only, so the assistant projection
            // deliberately carries no storage index.
            turn_index: None,
            status: Some(turn.status),
            error: turn.error,
            tools: (!tools.is_empty()).then_some(tools),
            thinking: (!thinking_parts.is_empty()).then(|| thinking_parts.join("\n\n")),
            items: (!items.is_empty()).then_some(items),
            images: None,
        });
    }
    result
}

impl TranscriptTurnView {
    fn has_assistant_message_for_chat(&self) -> bool {
        self.has_assistant_content()
    }
}

/// A stable fingerprint of what a client holds for one turn.
fn turn_fingerprint(turn: &TranscriptTurnView) -> String {
    // FNV-1a over the facts that change when a settled turn is rewritten
    // (resumed, rolled back, recovered): its id, status, item shape and
    // recovery state.
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    let mut feed = |bytes: &[u8]| {
        for byte in bytes {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(0x0100_0000_01b3);
        }
        hash ^= 0xff;
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    };
    feed(turn.turn_id.as_bytes());
    feed(turn.status.as_bytes());
    feed(turn.items.len().to_string().as_bytes());
    for item in &turn.items {
        match item {
            TranscriptItemView::Text { id, text, .. }
            | TranscriptItemView::Thinking { id, text, .. } => {
                feed(id.as_bytes());
                feed(text.len().to_string().as_bytes());
            }
            TranscriptItemView::Tool { tool, .. } => {
                feed(tool.id.as_bytes());
                feed(tool.status.as_bytes());
            }
        }
    }
    if let Some(recovery) = &turn.recovery {
        feed(recovery.status.as_bytes());
        feed(recovery.execution_generation.to_string().as_bytes());
    }
    format!("{hash:016x}")
}

fn cursor_for(turn: &TranscriptTurnView) -> String {
    format!(
        "{CURSOR_PREFIX}:{}:{}:{}",
        turn.turn_index,
        turn_fingerprint(turn),
        turn.turn_id
    )
}

struct ParsedCursor<'a> {
    turn_index: usize,
    fingerprint: &'a str,
    turn_id: &'a str,
}

fn parse_cursor(cursor: &str) -> Option<ParsedCursor<'_>> {
    let mut parts = cursor.splitn(4, ':');
    if parts.next()? != CURSOR_PREFIX {
        return None;
    }
    let turn_index = parts.next()?.parse().ok()?;
    let fingerprint = parts.next()?;
    let turn_id = parts.next()?;
    (!turn_id.is_empty()).then_some(ParsedCursor {
        turn_index,
        fingerprint,
        turn_id,
    })
}

/// The last turn of the settled prefix of `turns`, when `prefix_settled`.
fn last_settled_prefix(turns: &[TranscriptTurnView]) -> Option<&TranscriptTurnView> {
    turns.iter().take_while(|turn| turn.settled).last()
}

/// Build the answer to one view read. `turns` is the window the host loaded,
/// oldest first; `cursor` is what the client passed back from its last read.
pub fn session_transcript_view(
    session_id: impl Into<String>,
    turns: Vec<TranscriptTurnView>,
    cursor: Option<&str>,
    has_earlier: bool,
) -> SessionTranscriptView {
    let session_id = session_id.into();
    let anchor = cursor.and_then(parse_cursor).and_then(|parsed| {
        turns
            .iter()
            .position(|turn| {
                turn.turn_index == parsed.turn_index
                    && turn.turn_id == parsed.turn_id
                    && turn.settled
                    && turn_fingerprint(turn) == parsed.fingerprint
            })
            .map(|position| (position, parsed.turn_index))
    });

    match anchor {
        Some((position, kept_through_index)) => {
            let after = turns[position + 1..].to_vec();
            let next_cursor = last_settled_prefix(&after)
                .map(cursor_for)
                .or_else(|| cursor.map(ToOwned::to_owned));
            SessionTranscriptView {
                session_id,
                mode: "after".to_string(),
                kept_through_index: Some(kept_through_index),
                turns: after,
                cursor: next_cursor,
                has_earlier,
                prompt_suggestion: None,
            }
        }
        None => SessionTranscriptView {
            session_id,
            mode: "full".to_string(),
            kept_through_index: None,
            cursor: last_settled_prefix(&turns).map(cursor_for),
            turns,
            has_earlier,
            prompt_suggestion: None,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::remote_connect::{
        RemoteChatHistoryRound, RemoteChatHistoryTextItem, RemoteChatHistoryThinkingItem,
        RemoteChatHistoryToolCall, RemoteChatHistoryToolItem,
    };

    fn history_turn(index: usize, in_progress: bool) -> RemoteChatHistoryTurn {
        RemoteChatHistoryTurn {
            turn_id: format!("turn-{index}"),
            turn_index: index,
            user_message_id: format!("user-{index}"),
            user_display_content: format!("question {index}"),
            user_timestamp_ms: 1_000 * (index as u64 + 1),
            is_in_progress: in_progress,
            status: if in_progress { "active" } else { "done" }.to_string(),
            start_time_ms: 1_000,
            rounds: vec![RemoteChatHistoryRound {
                id: "round-0".to_string(),
                start_time_ms: 1_100,
                end_time_ms: Some(2_500),
                effective_model_name: Some("model-a".to_string()),
                duration_ms: Some(1_400),
                text_items: vec![
                    RemoteChatHistoryTextItem {
                        id: "text-sub".to_string(),
                        content: "subagent words".to_string(),
                        order_index: Some(3),
                        is_subagent: true,
                        parent_task_tool_id: Some("tool-task".to_string()),
                    },
                    RemoteChatHistoryTextItem {
                        id: "text-1".to_string(),
                        content: "answer".to_string(),
                        order_index: Some(1),
                        ..Default::default()
                    },
                    RemoteChatHistoryTextItem {
                        id: "text-empty".to_string(),
                        content: String::new(),
                        order_index: Some(5),
                        ..Default::default()
                    },
                ],
                thinking_items: vec![RemoteChatHistoryThinkingItem {
                    id: "think-1".to_string(),
                    content: "pondering".to_string(),
                    order_index: Some(0),
                    reasoning_kind: Some("summary".to_string()),
                    ..Default::default()
                }],
                tool_items: vec![RemoteChatHistoryToolItem {
                    id: "tool-task".to_string(),
                    name: "Task".to_string(),
                    call: RemoteChatHistoryToolCall {
                        id: "call-1".to_string(),
                        input: serde_json::json!({"description": "look around"}),
                    },
                    result: Some(serde_json::json!({"ok": true})),
                    has_result: true,
                    success: Some(true),
                    result_for_assistant: Some("done".to_string()),
                    duration_ms: Some(30),
                    start_ms: 1_200,
                    order_index: Some(2),
                    ..Default::default()
                }],
            }],
            ..Default::default()
        }
    }

    #[test]
    fn view_orders_items_and_nests_subagent_work_under_its_call() {
        let view = build_transcript_view(vec![history_turn(0, false)]);
        let turn = &view[0];
        assert!(turn.settled);
        assert_eq!(turn.kind, "user_dialog");
        assert_eq!(turn.effective_model.as_deref(), Some("model-a"));
        assert_eq!(turn.duration_ms, Some(1_400));
        assert_eq!(turn.items.len(), 3);
        assert!(matches!(
            &turn.items[0],
            TranscriptItemView::Thinking { reasoning_kind: Some(kind), .. } if kind == "summary"
        ));
        assert!(
            matches!(&turn.items[1], TranscriptItemView::Text { text, .. } if text == "answer")
        );
        let TranscriptItemView::Tool { tool, .. } = &turn.items[2] else {
            panic!("tool item");
        };
        assert_eq!(tool.status, "completed");
        assert_eq!(tool.success, Some(true));
        assert_eq!(tool.result_for_assistant.as_deref(), Some("done"));
        assert_eq!(tool.subagent_items.len(), 1);
    }

    #[test]
    fn view_wire_shape_is_camel_case_and_tagged() {
        let view = build_transcript_view(vec![history_turn(0, false)]);
        let json = serde_json::to_value(&view[0]).unwrap();
        assert_eq!(json["turnId"], "turn-0");
        assert_eq!(json["user"]["text"], "question 0");
        assert_eq!(json["items"][0]["kind"], "thinking");
        assert_eq!(json["items"][0]["reasoningKind"], "summary");
        assert_eq!(json["items"][2]["kind"], "tool");
        assert_eq!(json["items"][2]["tool"]["resultForAssistant"], "done");
        assert_eq!(json["items"][2]["tool"]["subagentItems"][0]["kind"], "text");
        // A client that predates a field reads the view back without it.
        let parsed: TranscriptTurnView = serde_json::from_value(serde_json::json!({
            "turnId": "t", "turnIndex": 0, "kind": "user_dialog", "status": "done",
            "settled": true, "user": {"id": "u", "text": "hi", "timestampMs": 1},
            "items": [{"kind": "text", "id": "x", "roundIndex": 0, "text": "yo"}],
            "startTimeMs": 1, "assistantTimestampMs": 2
        }))
        .unwrap();
        assert_eq!(parsed.items.len(), 1);
    }

    #[test]
    fn chat_messages_derive_from_the_view_without_subagent_or_empty_items() {
        let messages =
            chat_messages_from_transcript(build_transcript_view(vec![history_turn(0, false)]));
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[1].content, "answer");
        assert_eq!(messages[1].thinking.as_deref(), Some("pondering"));
        assert_eq!(messages[1].timestamp, "2");
        let items = messages[1].items.as_ref().unwrap();
        assert_eq!(
            items
                .iter()
                .map(|item| item.item_type.as_str())
                .collect::<Vec<_>>(),
            ["thinking", "text", "tool"]
        );
        assert_eq!(
            items[2].tool.as_ref().unwrap().tool_input.as_ref().unwrap()["description"],
            "look around"
        );
    }

    #[test]
    fn cursor_returns_only_turns_after_the_last_settled_one() {
        let first = build_transcript_view(vec![history_turn(0, false), history_turn(1, true)]);
        let full = session_transcript_view("s", first, None, false);
        assert_eq!(full.mode, "full");
        assert_eq!(full.turns.len(), 2);
        let cursor = full.cursor.clone().expect("a settled turn gives a cursor");
        assert!(cursor.starts_with("tv1:0:"));

        // Turn 1 settles: the next read carries just that turn.
        let second = build_transcript_view(vec![history_turn(0, false), history_turn(1, false)]);
        let delta = session_transcript_view("s", second, Some(&cursor), false);
        assert_eq!(delta.mode, "after");
        assert_eq!(delta.kept_through_index, Some(0));
        assert_eq!(delta.turns.len(), 1);
        assert!(delta.turns[0].settled);
        assert!(delta.cursor.as_deref().unwrap().starts_with("tv1:1:"));

        // Nothing new: the cursor survives an empty answer.
        let third = build_transcript_view(vec![history_turn(0, false), history_turn(1, false)]);
        let idle = session_transcript_view("s", third, delta.cursor.as_deref(), false);
        assert_eq!(idle.mode, "after");
        assert!(idle.turns.is_empty());
        assert_eq!(idle.cursor, delta.cursor);
    }

    #[test]
    fn a_rewritten_or_unknown_cursor_answers_with_the_full_window() {
        let turns = build_transcript_view(vec![history_turn(0, false)]);
        let cursor = session_transcript_view("s", turns, None, false)
            .cursor
            .unwrap();

        // The turn was rolled back and replaced by another with the same index.
        let mut replaced = history_turn(0, false);
        replaced.turn_id = "turn-other".to_string();
        let view = session_transcript_view(
            "s",
            build_transcript_view(vec![replaced]),
            Some(&cursor),
            true,
        );
        assert_eq!(view.mode, "full");
        assert!(view.has_earlier);

        // The turn was resumed: same id, no longer settled.
        let resumed = build_transcript_view(vec![history_turn(0, true)]);
        let view = session_transcript_view("s", resumed, Some(&cursor), false);
        assert_eq!(view.mode, "full");
        assert_eq!(view.cursor, None);

        for junk in ["", "tv0:0:abc:turn-0", "tv1:x:abc:turn-0", "tv1:0:abc:"] {
            let view = session_transcript_view(
                "s",
                build_transcript_view(vec![history_turn(0, false)]),
                Some(junk),
                false,
            );
            assert_eq!(view.mode, "full", "{junk}");
        }
    }

    #[test]
    fn user_image_refs_win_over_mobile_thumbnails() {
        let mut turn = history_turn(0, false);
        turn.user_images = vec![ChatImageAttachment {
            name: "thumb.jpg".to_string(),
            data_url: "data:image/jpeg;base64,AA".to_string(),
        }];
        let view = build_transcript_view(vec![turn.clone()]);
        assert_eq!(
            view[0].user.images[0].data_url.as_deref(),
            Some("data:image/jpeg;base64,AA")
        );
        turn.user_image_refs = vec![TranscriptImage {
            name: "shot.png".to_string(),
            data_url: None,
            image_path: Some("/tmp/shot.png".to_string()),
        }];
        let view = build_transcript_view(vec![turn]);
        assert_eq!(view[0].user.images.len(), 1);
        assert_eq!(
            view[0].user.images[0].image_path.as_deref(),
            Some("/tmp/shot.png")
        );
    }
}

//! Conversations and their turns.
//!
//! A conversation keeps its last [`WINDOW_TURNS`] turns resident (they are
//! the model's context and what a frontend opens first); older messages move
//! to the conversation's history record when they leave the window.
//!
//! A turn is a persisted state machine, written after every step:
//! `model_round` -> `tools` (each call written ahead) -> `parked` (no model
//! call, no memory beyond this record) -> `done` | `failed` | `cancelled`.
//! A parked turn resumes on an event or a timer with no frontend attached.

use std::collections::BTreeMap;

use openbitfun_product_domains::superagent::{SuperagentJobState, WaitUntil};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::model::ModelToolCall;

pub const CONVERSATION_VERSION: u32 = 1;
/// Turns kept resident (and sent to the model).
pub const WINDOW_TURNS: usize = 20;
/// Text kept per message.
pub const MAX_MESSAGE_TEXT_BYTES: usize = 32 * 1024;
/// Text kept per tool result.
pub const MAX_TOOL_RESULT_BYTES: usize = 16 * 1024;
/// History messages kept per conversation (oldest dropped first).
pub const MAX_HISTORY_MESSAGES: usize = 2_000;
/// Serialized bytes the history record may take (oldest dropped first), so
/// it stays well under the store's record cap.
pub const MAX_HISTORY_BYTES: usize = 4 * 1024 * 1024;
/// Serialized bytes the conversation record (the resident window) may take
/// before whole older turns move to history early.
pub const MAX_CONVERSATION_BYTES: usize = 4 * 1024 * 1024;
/// What an old tool result in the window shrinks to when a single running
/// turn alone is over [`MAX_CONVERSATION_BYTES`].
const COMPACTED_TOOL_RESULT_BYTES: usize = 1024;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    #[default]
    User,
    Assistant,
    Tool,
    /// A backend card (a notice, a confirmation, a job card reference).
    Card,
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Message {
    pub id: String,
    pub role: Role,
    pub text: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub tool_calls: Vec<ModelToolCall>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_message_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
    /// For cards: `{kind, ...}` (a notice code, a confirmation, job ids).
    #[serde(skip_serializing_if = "Value::is_null")]
    pub card: Value,
    pub at_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Wait {
    /// No device can hold a model round; resume when one can.
    Holder,
    /// `fleet_wait`: resume when the condition holds or the deadline passes.
    Jobs {
        tool_call_id: String,
        job_ids: Vec<String>,
        until: WaitUntil,
        before: Vec<SuperagentJobState>,
    },
    /// A tool that runs only after the user confirms its card.
    Confirmation {
        tool_call_id: String,
        card_id: String,
        #[serde(default)]
        decision: Option<String>,
    },
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(tag = "step", rename_all = "snake_case")]
pub enum Step {
    #[default]
    ModelRound,
    Tools,
    Parked {
        wait: Wait,
        since_ms: u64,
        deadline_ms: Option<u64>,
    },
    Done,
    Failed {
        reason: String,
    },
    Cancelled,
}

impl Step {
    pub fn is_finished(&self) -> bool {
        matches!(self, Self::Done | Self::Failed { .. } | Self::Cancelled)
    }

    pub fn name(&self) -> &'static str {
        match self {
            Self::ModelRound => "model_round",
            Self::Tools => "tools",
            Self::Parked { .. } => "parked",
            Self::Done => "done",
            Self::Failed { .. } => "failed",
            Self::Cancelled => "cancelled",
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Turn {
    pub id: String,
    pub step: Step,
    pub started_ms: u64,
    pub updated_ms: u64,
    /// Model rounds used (a user-visible quota).
    pub rounds: u32,
    pub max_rounds: u32,
    /// The calls of the last model round and how far they ran.
    pub calls: Vec<ModelToolCall>,
    pub next_call: usize,
    /// Holders that failed during the current round (retry elsewhere).
    pub lost_holders: Vec<String>,
    /// Jobs this turn submitted (a quota as well).
    pub dispatched: u32,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Conversation {
    pub version: u32,
    pub id: String,
    pub title: String,
    pub created_ms: u64,
    pub updated_ms: u64,
    /// The resident window (the last turns).
    pub messages: Vec<Message>,
    /// Messages that moved to the history record.
    pub history_count: u64,
    pub turn: Option<Turn>,
    pub last_holder: Option<String>,
    /// Client message ids already taken (exactly-once `superagent_send`).
    pub client_ids: BTreeMap<String, String>,
    /// The device the user picked for this conversation's model rounds
    /// (with [`Self::model_id`]); both absent is Auto.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pinned_holder: Option<String>,
    /// The model of [`Self::pinned_holder`] the rounds run on.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
    /// Where the conversation's history stands on the account's devices
    /// (`archive`); absent in records of earlier builds.
    #[serde(skip_serializing_if = "crate::archive::ConversationArchive::is_empty")]
    pub archive: crate::archive::ConversationArchive,
}

impl Conversation {
    pub fn new(id: String, title: String, now: u64) -> Self {
        Self {
            version: CONVERSATION_VERSION,
            id,
            title,
            created_ms: now,
            updated_ms: now,
            ..Self::default()
        }
    }

    /// The user's pick, or `None` for Auto (a half-set pick reads as Auto).
    pub fn model_pick(
        &self,
    ) -> Option<openbitfun_product_domains::superagent::SuperagentModelPick> {
        let device_id = self.pinned_holder.as_deref()?.trim();
        let model_id = self.model_id.as_deref()?.trim();
        (!device_id.is_empty() && !model_id.is_empty()).then(|| {
            openbitfun_product_domains::superagent::SuperagentModelPick {
                device_id: device_id.to_string(),
                model_id: model_id.to_string(),
            }
        })
    }

    /// Sets the pick (`None`: Auto).
    pub fn set_model_pick(
        &mut self,
        pick: Option<openbitfun_product_domains::superagent::SuperagentModelPick>,
    ) {
        match pick {
            Some(pick) => {
                self.pinned_holder = Some(pick.device_id);
                self.model_id = Some(pick.model_id);
            }
            None => {
                self.pinned_holder = None;
                self.model_id = None;
            }
        }
    }

    pub fn active_turn(&self) -> Option<&Turn> {
        self.turn.as_ref().filter(|turn| !turn.step.is_finished())
    }

    /// Splits off the messages older than the resident window.
    pub fn take_overflow(&mut self) -> Vec<Message> {
        let mut user_turns = 0usize;
        let mut cut = 0usize;
        for (index, message) in self.messages.iter().enumerate().rev() {
            if message.role == Role::User {
                user_turns += 1;
                if user_turns == WINDOW_TURNS {
                    cut = index;
                    break;
                }
            }
        }
        if user_turns < WINDOW_TURNS || cut == 0 {
            return Vec::new();
        }
        let older: Vec<Message> = self.messages.drain(..cut).collect();
        self.history_count += older.len() as u64;
        // Keep the client-id map bounded with the window.
        if self.client_ids.len() > 4 * WINDOW_TURNS {
            let keep: std::collections::BTreeSet<&str> = self
                .messages
                .iter()
                .filter_map(|message| message.client_message_id.as_deref())
                .collect();
            self.client_ids
                .retain(|client, _| keep.contains(client.as_str()));
        }
        older
    }
}

/// The history record of one conversation (oldest first).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct History {
    pub messages: Vec<Message>,
    pub dropped: u64,
}

impl History {
    /// Appends messages that left the window, then drops the oldest past
    /// [`MAX_HISTORY_MESSAGES`] or [`MAX_HISTORY_BYTES`] (counted in
    /// `dropped`). Also compacts a legacy record that was over the bounds.
    pub fn append(&mut self, older: Vec<Message>) {
        self.messages.extend(older);
        self.trim_to(MAX_HISTORY_MESSAGES, MAX_HISTORY_BYTES);
    }

    fn trim_to(&mut self, max_messages: usize, max_bytes: usize) {
        let mut excess = self.messages.len().saturating_sub(max_messages);
        let sizes: Vec<usize> = self.messages.iter().map(|m| json_len(m) + 1).collect();
        let mut total: usize = sizes[excess..].iter().sum::<usize>() + 64;
        while excess < self.messages.len() && total > max_bytes {
            total -= sizes[excess];
            excess += 1;
        }
        if excess > 0 {
            self.messages.drain(..excess);
            self.dropped += excess as u64;
        }
    }
}

fn json_len<T: Serialize>(value: &T) -> usize {
    serde_json::to_vec(value).map(|v| v.len()).unwrap_or(0)
}

impl Conversation {
    /// [`Self::take_overflow`], then keeps the record under
    /// [`MAX_CONVERSATION_BYTES`]: whole older turns move to history first;
    /// if the last turn alone is still over, its oldest tool results shrink
    /// (the store refuses records over its cap, so the window must fit).
    pub fn take_overflow_bounded(&mut self) -> Vec<Message> {
        self.take_overflow_within(MAX_CONVERSATION_BYTES)
    }

    fn take_overflow_within(&mut self, max_bytes: usize) -> Vec<Message> {
        let mut older = self.take_overflow();
        let mut total = json_len(self);
        if total <= max_bytes {
            return older;
        }
        // Move whole turns (up to the next user message), never the last one.
        while total > max_bytes {
            let Some(last_user) = self
                .messages
                .iter()
                .rposition(|message| message.role == Role::User)
            else {
                break;
            };
            let Some(next_user) = self
                .messages
                .iter()
                .skip(1)
                .position(|message| message.role == Role::User)
                .map(|index| index + 1)
            else {
                break;
            };
            if next_user > last_user {
                break;
            }
            let moved: Vec<Message> = self.messages.drain(..next_user).collect();
            total = total.saturating_sub(moved.iter().map(|m| json_len(m) + 1).sum::<usize>());
            self.history_count += moved.len() as u64;
            older.extend(moved);
        }
        // The last turn alone: shrink its oldest tool results.
        for message in self.messages.iter_mut() {
            if total <= max_bytes {
                break;
            }
            if message.role == Role::Tool && message.text.len() > COMPACTED_TOOL_RESULT_BYTES {
                let before = json_len(message);
                message.text = truncate_text(&message.text, COMPACTED_TOOL_RESULT_BYTES);
                total = total.saturating_sub(before.saturating_sub(json_len(message)));
            }
        }
        older
    }
}

/// The conversation list entry.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ConversationSummary {
    pub id: String,
    pub title: String,
    pub updated_ms: u64,
    /// `idle`, `running`, `parked`, `failed`.
    pub status: String,
    /// When a frontend last opened the conversation (Unix ms).
    pub seen_ms: u64,
}

pub fn truncate_text(text: &str, max: usize) -> String {
    if text.len() <= max {
        return text.to_string();
    }
    let mut end = max;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}…", &text[..end])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_window_keeps_the_last_turns_and_moves_the_rest_to_history() {
        let mut conversation = Conversation::new("c".into(), "t".into(), 0);
        for index in 0..(WINDOW_TURNS + 5) {
            conversation.messages.push(Message {
                id: format!("u{index}"),
                role: Role::User,
                ..Message::default()
            });
            conversation.messages.push(Message {
                id: format!("a{index}"),
                role: Role::Assistant,
                ..Message::default()
            });
        }
        let older = conversation.take_overflow();
        assert_eq!(older.len(), 10);
        assert_eq!(conversation.messages.len(), WINDOW_TURNS * 2);
        assert_eq!(conversation.messages[0].id, "u5");
        assert_eq!(conversation.history_count, 10);
        assert!(conversation.take_overflow().is_empty());
        assert_eq!(truncate_text("héllo", 2), "h…");
    }
}

#[cfg(test)]
mod model_pick_tests {
    use super::*;

    #[test]
    fn a_conversation_without_a_pick_reads_as_auto_and_a_pick_round_trips() {
        // A record written before the picker.
        let old: Conversation =
            serde_json::from_value(serde_json::json!({"version": 1, "id": "c", "title": "t"}))
                .unwrap();
        assert_eq!(old.model_pick(), None);
        let mut conversation = old;
        conversation.set_model_pick(Some(
            openbitfun_product_domains::superagent::SuperagentModelPick {
                device_id: "desk".into(),
                model_id: "big".into(),
            },
        ));
        let wire = serde_json::to_value(&conversation).unwrap();
        assert_eq!(wire["pinnedHolder"], "desk");
        assert_eq!(wire["modelId"], "big");
        let back: Conversation = serde_json::from_value(wire).unwrap();
        assert_eq!(back.model_pick().unwrap().model_id, "big");
        conversation.set_model_pick(None);
        let wire = serde_json::to_value(&conversation).unwrap();
        assert!(wire.get("pinnedHolder").is_none());
        // A half-set pick is Auto.
        let half: Conversation =
            serde_json::from_value(serde_json::json!({"id": "c", "pinnedHolder": "desk"})).unwrap();
        assert_eq!(half.model_pick(), None);
    }
}

#[cfg(test)]
mod byte_budget_tests {
    use super::*;

    fn message(id: String, role: Role, text_bytes: usize) -> Message {
        Message {
            id,
            role,
            text: "x".repeat(text_bytes),
            ..Message::default()
        }
    }

    #[test]
    fn history_is_trimmed_by_bytes_as_well_as_count() {
        let mut history = History::default();
        // 400 messages of 32 KiB: under the count, about 12.5 MiB of bytes.
        history.append(
            (0..400)
                .map(|index| message(format!("m{index}"), Role::Assistant, MAX_MESSAGE_TEXT_BYTES))
                .collect(),
        );
        let bytes = serde_json::to_vec(&history).unwrap().len();
        assert!(bytes <= MAX_HISTORY_BYTES, "{bytes}");
        assert!(bytes <= crate::store::MAX_RECORD_BYTES);
        assert_eq!(history.messages.last().unwrap().id, "m399");
        assert_eq!(history.dropped as usize + history.messages.len(), 400);
        assert!(history.dropped > 0);
        // Small messages are still bounded by count.
        let mut small = History::default();
        small.append(
            (0..(MAX_HISTORY_MESSAGES + 5))
                .map(|index| message(format!("s{index}"), Role::User, 1))
                .collect(),
        );
        assert_eq!(small.messages.len(), MAX_HISTORY_MESSAGES);
        assert_eq!(small.dropped, 5);
    }

    #[test]
    fn a_legacy_oversize_history_compacts_on_the_next_append_and_round_trips() {
        // A record an older build wrote past today's byte budget.
        let legacy = serde_json::json!({
            "messages": (0..300).map(|index| serde_json::json!({
                "id": format!("m{index}"), "role": "tool", "text": "y".repeat(MAX_MESSAGE_TEXT_BYTES),
                "atMs": index
            })).collect::<Vec<_>>(),
            "dropped": 7
        });
        let mut history: History = serde_json::from_value(legacy).unwrap();
        assert_eq!(history.messages.len(), 300);
        history.append(vec![message("new".into(), Role::User, 10)]);
        assert!(serde_json::to_vec(&history).unwrap().len() <= MAX_HISTORY_BYTES);
        assert_eq!(history.messages.last().unwrap().id, "new");
        assert_eq!(history.dropped as usize + history.messages.len(), 7 + 301);
        let back: History = serde_json::from_slice(&serde_json::to_vec(&history).unwrap()).unwrap();
        assert_eq!(back, history);
    }

    #[test]
    fn an_oversize_window_moves_whole_older_turns_then_shrinks_the_last_turn() {
        let mut conversation = Conversation::new("c".into(), "t".into(), 0);
        // 5 turns of 1 user message plus 40 tool results of 16 KiB (~640 KiB each).
        for turn in 0..5 {
            conversation
                .messages
                .push(message(format!("u{turn}"), Role::User, 10));
            for call in 0..40 {
                conversation.messages.push(message(
                    format!("t{turn}-{call}"),
                    Role::Tool,
                    MAX_TOOL_RESULT_BYTES,
                ));
            }
        }
        let budget = 1024 * 1024;
        let older = conversation.take_overflow_within(budget);
        assert!(json_len(&conversation) <= budget);
        // Whole turns moved, starting at a user message; the last turn stays.
        assert_eq!(older.first().unwrap().id, "u0");
        assert_eq!(conversation.messages[0].role, Role::User);
        assert!(conversation.messages.iter().any(|m| m.id == "u4"));
        assert_eq!(conversation.history_count as usize, older.len());
        // A single turn over the budget keeps its messages, with shrunk results.
        let mut single = Conversation::new("s".into(), "t".into(), 0);
        single.messages.push(message("u".into(), Role::User, 10));
        for call in 0..100 {
            single.messages.push(message(
                format!("t{call}"),
                Role::Tool,
                MAX_TOOL_RESULT_BYTES,
            ));
        }
        assert!(single.take_overflow_within(budget).is_empty());
        assert_eq!(single.messages.len(), 101);
        assert!(json_len(&single) <= budget);
        // Under the budget nothing changes.
        let mut small = Conversation::new("x".into(), "t".into(), 0);
        small.messages.push(message("u".into(), Role::User, 10));
        let before = small.clone();
        assert!(small.take_overflow_bounded().is_empty());
        assert_eq!(small, before);
    }
}

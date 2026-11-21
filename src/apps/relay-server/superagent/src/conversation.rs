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
    pub fn append(&mut self, older: Vec<Message>) {
        self.messages.extend(older);
        if self.messages.len() > MAX_HISTORY_MESSAGES {
            let excess = self.messages.len() - MAX_HISTORY_MESSAGES;
            self.messages.drain(..excess);
            self.dropped += excess as u64;
        }
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

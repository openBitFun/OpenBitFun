//! Durable model context and attachment redaction shared by session providers.
use super::{Message, MessageContent};
use serde::{Deserialize, Serialize};
use std::borrow::Cow;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredTurnContextSnapshotFile {
    pub schema_version: u32,
    pub session_id: String,
    pub turn_index: usize,
    pub messages: Vec<Message>,
}

/// Borrowed write-side counterpart of [`StoredTurnContextSnapshotFile`]; lets
/// snapshot writes serialize messages without cloning ones that need no
/// sanitization. Field names/order must stay in sync with the stored struct.
#[derive(Debug, Serialize)]
pub struct TurnContextSnapshotWriteFile<'a> {
    pub schema_version: u32,
    pub session_id: &'a str,
    pub turn_index: usize,
    pub messages: Vec<Cow<'a, Message>>,
}

pub fn sanitize_messages_for_persistence(messages: &[Message]) -> Vec<Cow<'_, Message>> {
    messages
        .iter()
        .map(sanitize_message_for_persistence)
        .collect()
}

/// Returns whether a message would be modified by
/// [`sanitize_message_for_persistence`]. Used to avoid deep-cloning
/// messages that need no sanitization (the vast majority).
fn message_needs_persistence_sanitization(message: &Message) -> bool {
    match &message.content {
        MessageContent::Multimodal { images, .. } => images
            .iter()
            .any(|image| image.data_url.as_ref().is_some_and(|v| !v.is_empty())),
        MessageContent::ToolResult {
            result,
            image_attachments,
            ..
        } => image_attachments.is_some() || json_contains_data_url(result),
        _ => false,
    }
}

fn json_contains_data_url(value: &serde_json::Value) -> bool {
    match value {
        serde_json::Value::Object(map) => {
            map.contains_key("data_url") || map.values().any(json_contains_data_url)
        }
        serde_json::Value::Array(arr) => arr.iter().any(json_contains_data_url),
        _ => false,
    }
}

pub fn sanitize_message_for_persistence(message: &Message) -> Cow<'_, Message> {
    if !message_needs_persistence_sanitization(message) {
        return Cow::Borrowed(message);
    }

    let mut sanitized = message.clone();

    match &mut sanitized.content {
        MessageContent::Multimodal { images, .. } => {
            for image in images.iter_mut() {
                if image.data_url.as_ref().is_some_and(|v| !v.is_empty()) {
                    image.data_url = None;

                    let mut metadata = image
                        .metadata
                        .take()
                        .unwrap_or_else(|| serde_json::json!({}));
                    if !metadata.is_object() {
                        metadata = serde_json::json!({ "raw_metadata": metadata });
                    }
                    if let Some(obj) = metadata.as_object_mut() {
                        obj.insert("has_data_url".to_string(), serde_json::json!(true));
                    }
                    image.metadata = Some(metadata);
                }
            }
        }
        MessageContent::ToolResult {
            result,
            image_attachments,
            ..
        } => {
            redact_data_url_in_json(result);
            if image_attachments.is_some() {
                *image_attachments = None;
            }
        }
        _ => {}
    }

    Cow::Owned(sanitized)
}

fn redact_data_url_in_json(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::Object(map) => {
            let had_data_url = map.remove("data_url").is_some();
            if had_data_url {
                map.insert("has_data_url".to_string(), serde_json::json!(true));
            }
            for child in map.values_mut() {
                redact_data_url_in_json(child);
            }
        }
        serde_json::Value::Array(arr) => {
            for child in arr {
                redact_data_url_in_json(child);
            }
        }
        _ => {}
    }
}

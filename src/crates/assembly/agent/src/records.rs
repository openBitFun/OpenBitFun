//! Transcript projections shared with the product session manager.
use openbitfun_agent_runtime::message::{
    ImageContextData, Message, MessageContent, MessageRole, MessageSemanticKind,
};
use openbitfun_services_core::session::{
    DialogTurnData, ModelRoundData, TextItemData, ThinkingItemData, ToolCallData, ToolItemData,
    ToolResultData,
};

pub fn build_messages_from_turns(turns: &[DialogTurnData]) -> Vec<Message> {
    project_messages(turns)
}

/// Restore the latest checkpoint plus later model-visible transcript entries.
/// Product listing migrations run on the checkpoint before it reaches here.
pub fn restore_history(
    turns: &[DialogTurnData],
    snapshot: Option<(usize, Vec<Message>)>,
) -> Vec<Message> {
    let Some((index, mut messages)) = snapshot else {
        return build_messages_from_turns(turns);
    };
    messages.extend(project_messages(
        turns.iter().filter(|turn| turn.turn_index > index),
    ));
    messages
}

fn project_messages<'a>(turns: impl IntoIterator<Item = &'a DialogTurnData>) -> Vec<Message> {
    let mut messages = Vec::new();

    for turn in turns {
        if !turn.kind.is_model_visible() {
            continue;
        }

        let user_message = if let Some(metadata) = &turn.user_message.metadata {
            let images = metadata
                .get("images")
                .and_then(|value| value.as_array())
                .map(|values| {
                    values
                        .iter()
                        .map(|value| ImageContextData {
                            id: value
                                .get("id")
                                .and_then(|v| v.as_str())
                                .unwrap_or_default()
                                .to_string(),
                            image_path: value
                                .get("image_path")
                                .and_then(|v| v.as_str())
                                .map(str::to_string),
                            data_url: value
                                .get("data_url")
                                .and_then(|v| v.as_str())
                                .map(str::to_string),
                            mime_type: value
                                .get("mime_type")
                                .and_then(|v| v.as_str())
                                .unwrap_or("image/png")
                                .to_string(),
                            metadata: Some(value.clone()),
                        })
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();

            if images.is_empty() {
                Message::user(turn.user_message.content.clone())
            } else {
                Message::user_multimodal(turn.user_message.content.clone(), images)
            }
        } else {
            Message::user(turn.user_message.content.clone())
        };
        messages.push(
            user_message
                .with_turn_id(turn.turn_id.clone())
                .with_semantic_kind(MessageSemanticKind::ActualUserInput),
        );

        let assistant_text = turn
            .model_rounds
            .iter()
            .flat_map(|round| round.text_items.iter())
            .map(|item| item.content.clone())
            .filter(|value| !value.trim().is_empty())
            .collect::<Vec<_>>()
            .join("\n\n");

        let assistant_thinking = turn
            .model_rounds
            .iter()
            .flat_map(|round| round.thinking_items.iter())
            .map(|item| item.content.clone())
            .filter(|value| !value.trim().is_empty())
            .collect::<Vec<_>>()
            .join("\n\n");

        let has_text = !assistant_text.trim().is_empty();
        let has_thinking = !assistant_thinking.trim().is_empty();

        if has_text || has_thinking {
            let reasoning_content = if has_thinking {
                Some(assistant_thinking)
            } else {
                None
            };
            messages.push(
                Message::assistant_with_reasoning(reasoning_content, assistant_text, Vec::new())
                    .with_turn_id(turn.turn_id.clone()),
            );
        }
    }

    messages
}

pub fn build_model_rounds_from_messages(
    messages: &[Message],
    turn_id: &str,
    timestamp: u64,
) -> Vec<ModelRoundData> {
    let mut rounds: Vec<ModelRoundData> = Vec::new();

    for msg in messages {
        match msg.role {
            MessageRole::Assistant => {
                let round_index = rounds.len();
                let round_id = msg
                    .metadata
                    .round_id
                    .as_deref()
                    .map(str::trim)
                    .filter(|round_id| !round_id.is_empty())
                    .map(str::to_string)
                    .unwrap_or_else(|| format!("{}-round-{}", turn_id, round_index));

                let mut text_items = Vec::new();
                let mut thinking_items = Vec::new();
                let mut tool_items = Vec::new();
                let mut order_index = 0usize;

                match &msg.content {
                    MessageContent::Text(text) => {
                        if !text.trim().is_empty() {
                            text_items.push(make_text_item(
                                &format!("{}-text-{}", round_id, order_index),
                                text,
                                timestamp,
                                order_index,
                            ));
                        }
                    }
                    MessageContent::Mixed {
                        reasoning_content,
                        text,
                        tool_calls,
                    } => {
                        // Thinking / reasoning content
                        if let Some(reasoning) = reasoning_content {
                            if !reasoning.trim().is_empty() {
                                thinking_items.push(ThinkingItemData {
                                    id: format!("{}-think-{}", round_id, order_index),
                                    content: reasoning.clone(),
                                    reasoning_kind: msg.metadata.reasoning_content_kind,
                                    is_streaming: false,
                                    is_collapsed: true,
                                    timestamp,
                                    order_index: Some(order_index),
                                    status: Some("completed".to_string()),
                                    is_subagent_item: None,
                                    parent_task_tool_id: None,
                                    subagent_session_id: None,
                                    attempt_id: None,
                                    attempt_index: None,
                                });
                                order_index += 1;
                            }
                        }
                        // Text content
                        if !text.trim().is_empty() {
                            text_items.push(make_text_item(
                                &format!("{}-text-{}", round_id, order_index),
                                text,
                                timestamp,
                                order_index,
                            ));
                            order_index += 1;
                        }
                        // Tool calls
                        for tc in tool_calls {
                            tool_items.push(ToolItemData {
                                id: tc.tool_id.clone(),
                                tool_name: tc.tool_name.clone(),
                                tool_call: ToolCallData {
                                    input: tc.arguments.clone(),
                                    id: tc.tool_id.clone(),
                                },
                                tool_result: None,
                                ai_intent: None,
                                start_time: timestamp,
                                end_time: None,
                                duration_ms: None,
                                queue_wait_ms: None,
                                preflight_ms: None,
                                confirmation_wait_ms: None,
                                execution_ms: None,
                                order_index: Some(order_index),
                                is_subagent_item: None,
                                parent_task_tool_id: None,
                                subagent_session_id: None,
                                subagent_dialog_turn_id: None,
                                attempt_id: None,
                                attempt_index: None,
                                subagent_model_id: None,
                                subagent_model_display_name: None,
                                status: Some("completed".to_string()),
                                interruption_reason: None,
                            });
                            order_index += 1;
                        }
                    }
                    MessageContent::Multimodal { text, .. } if !text.trim().is_empty() => {
                        text_items.push(make_text_item(
                            &format!("{}-text-{}", round_id, order_index),
                            text,
                            timestamp,
                            order_index,
                        ));
                    }
                    _ => {}
                }

                // Only add the round if it has any content
                if !text_items.is_empty() || !tool_items.is_empty() || !thinking_items.is_empty() {
                    // Messages written before the Runtime recorded round
                    // timing leave these unknown rather than claiming 0 ms.
                    let timing = msg
                        .metadata
                        .model_execution
                        .as_ref()
                        .and_then(|facts| facts.timing)
                        .unwrap_or_default();
                    rounds.push(ModelRoundData {
                        id: round_id,
                        turn_id: turn_id.to_string(),
                        round_index,
                        round_group_id: None,
                        timestamp,
                        text_items,
                        tool_items,
                        thinking_items,
                        start_time: timestamp,
                        end_time: Some(timestamp),
                        duration_ms: timing.duration_ms,
                        provider_id: None,
                        model_config_id: msg
                            .metadata
                            .model_execution
                            .as_ref()
                            .map(|facts| facts.model_config_id.clone()),
                        effective_model_name: msg
                            .metadata
                            .model_execution
                            .as_ref()
                            .map(|facts| facts.effective_model_name.clone()),
                        routing: msg
                            .metadata
                            .model_execution
                            .as_ref()
                            .and_then(|facts| facts.routing.clone()),
                        first_chunk_ms: timing.first_chunk_ms,
                        first_visible_output_ms: timing.first_visible_output_ms,
                        stream_duration_ms: timing.stream_duration_ms,
                        ttft_ms: timing.ttft_ms,
                        attempt_count: timing.attempt_count,
                        attempt_diagnostics: vec![],
                        failure_category: None,
                        token_details: None,
                        status: "completed".to_string(),
                    });
                }
            }
            MessageRole::Tool => {
                // Attach tool result to the matching tool item in the last round
                if let MessageContent::ToolResult {
                    tool_id,
                    result,
                    result_for_assistant,
                    image_attachments,
                    is_error,
                    ..
                } = &msg.content
                {
                    if let Some(last_round) = rounds.last_mut() {
                        for tool_item in &mut last_round.tool_items {
                            if tool_item.id == *tool_id {
                                let assistant_text = result_for_assistant
                                    .clone()
                                    .or_else(|| serde_json::to_string(result).ok());
                                tool_item.tool_result = Some(ToolResultData {
                                    result: result.clone(),
                                    success: !is_error,
                                    result_for_assistant: assistant_text,
                                    image_attachments: image_attachments.clone(),
                                    error: if *is_error {
                                        result
                                            .get("error")
                                            .and_then(serde_json::Value::as_str)
                                            .map(str::to_owned)
                                            .or_else(|| serde_json::to_string(result).ok())
                                    } else {
                                        None
                                    },
                                    duration_ms: None,
                                });
                                tool_item.status =
                                    Some(if *is_error { "error" } else { "completed" }.to_string());
                                tool_item.end_time = Some(timestamp);
                                break;
                            }
                        }
                    }
                }
            }
            _ => {}
        }
    }

    rounds
}

/// Helper to create a `TextItemData` with common defaults.
pub fn make_text_item(id: &str, content: &str, timestamp: u64, order_index: usize) -> TextItemData {
    TextItemData {
        id: id.to_string(),
        content: content.to_string(),
        is_streaming: false,
        timestamp,
        is_markdown: true,
        order_index: Some(order_index),
        is_subagent_item: None,
        parent_task_tool_id: None,
        subagent_session_id: None,
        status: Some("completed".to_string()),
        attempt_id: None,
        attempt_index: None,
    }
}

/// Use the same context codec and redaction rules on both sides of a host handoff.
pub async fn save_context(
    path: &std::path::Path,
    session_id: &str,
    turn_index: usize,
    messages: &[Message],
) -> Result<(), openbitfun_services_core::json_store::JsonFileStoreError> {
    use openbitfun_agent_runtime::message::snapshot::{
        sanitize_messages_for_persistence, TurnContextSnapshotWriteFile,
    };
    let snapshot = TurnContextSnapshotWriteFile {
        schema_version: openbitfun_services_core::session::SESSION_STORAGE_SCHEMA_VERSION,
        session_id,
        turn_index,
        messages: sanitize_messages_for_persistence(messages),
    };
    openbitfun_services_core::json_store::JsonFileStore
        .write_atomic(path, &snapshot)
        .await
}

pub async fn load_context(
    path: &std::path::Path,
) -> Result<
    Option<openbitfun_agent_runtime::message::snapshot::StoredTurnContextSnapshotFile>,
    openbitfun_services_core::json_store::JsonFileStoreError,
> {
    openbitfun_services_core::json_store::JsonFileStore
        .read_optional(path)
        .await
}

pub async fn save_turn(
    path: &std::path::Path,
    turn: &DialogTurnData,
) -> Result<(), openbitfun_services_core::json_store::JsonFileStoreError> {
    let file = openbitfun_services_core::session::StoredDialogTurnFile::new(turn.clone());
    openbitfun_services_core::json_store::JsonFileStore
        .write_atomic(path, &file)
        .await
}

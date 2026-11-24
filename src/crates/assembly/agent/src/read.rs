//! The local text Read provider uses the same batch executor, permission
//! mailbox, bounded line reader and result presentation as product hosts.
use anyhow::{anyhow, bail, ensure, Context, Result};
use openbitfun_agent_runtime::{
    message::{Message, ToolCall, ToolResult},
    permission::{PermissionRequestManager, PermissionWaitOutcome},
};
use openbitfun_core_types::ToolDefinition;
use openbitfun_runtime_ports::{
    PermissionReply, PermissionRequest, PermissionRequestSource, PermissionRequestSourceKind,
};
use serde_json::{json, Value};
use std::path::Path;
use tokio_util::sync::CancellationToken;
use tool_runtime::{
    fs::read_file::{
        build_read_file_presentation, read_file_from_reader, DEFAULT_READ_MAX_LINES,
        DEFAULT_READ_MAX_TOTAL_CHARS,
    },
    pipeline::{
        execution::{execute_segments, ToolAdmission, ToolBatchOperations},
        SubagentBatchExecutionPolicy,
    },
};

pub(crate) fn definition() -> ToolDefinition {
    ToolDefinition {
        name: "Read".into(),
        description: "Read lines from a text file in the bound workspace.".into(),
        parameters: json!({
            "type": "object",
            "required": ["file_path"],
            "properties": {
                "file_path": { "type": "string" },
                "offset": { "type": "integer", "minimum": 1 },
                "limit": { "type": "integer", "minimum": 1 }
            },
            "additionalProperties": false
        }),
    }
}

pub(crate) struct Reads<'a> {
    pub calls: &'a [ToolCall],
    pub reader: &'a openbitfun_services_core::workspace_reader::WorkspaceReader,
    pub workspace: &'a Path,
    pub project: &'a str,
    pub agent_id: &'a str,
    pub session: &'a str,
    pub turn: &'a str,
    pub round: &'a str,
    pub permissions: &'a PermissionRequestManager,
    pub cancel: &'a CancellationToken,
}

impl Reads<'_> {
    pub(crate) async fn execute(&self) -> Result<Vec<Message>> {
        let ids: Vec<_> = self.calls.iter().map(|c| c.tool_id.clone()).collect();
        let mut seen = std::collections::HashSet::new();
        ensure!(
            ids.iter().all(|id| !id.is_empty() && seen.insert(id)),
            "duplicate or missing tool call ID"
        );
        execute_segments(
            self,
            &ids,
            vec![ids.clone()],
            false,
            0,
            SubagentBatchExecutionPolicy::Serial,
            || self.cancel.is_cancelled(),
        )
        .await
    }

    fn find_call(&self, id: &str) -> Result<(usize, &ToolCall)> {
        self.calls
            .iter()
            .enumerate()
            .find(|(_, c)| c.tool_id == id)
            .context("unknown tool call")
    }

    fn result(&self, id: &str, value: Value, text: String, failed: bool) -> Message {
        let name = self
            .find_call(id)
            .map(|(_, c)| c.tool_name.clone())
            .unwrap_or_default();
        Message::tool_result(ToolResult {
            tool_id: id.into(),
            tool_name: name,
            effective_tool_name: None,
            result: value,
            result_for_assistant: Some(text),
            is_error: failed,
            duration_ms: None,
            image_attachments: None,
        })
        .with_turn_id(self.turn.to_owned())
        .with_round_id(self.round.to_owned())
    }

    async fn read(&self, order: usize, call: &ToolCall) -> Result<Message> {
        ensure!(
            call.is_valid() && call.tool_name == "Read",
            "unsupported or invalid tool: {}",
            call.tool_name
        );
        let args = call
            .arguments
            .as_object()
            .context("Read requires an object")?;
        ensure!(
            args.keys()
                .all(|k| matches!(k.as_str(), "file_path" | "offset" | "limit")),
            "unsupported Read argument"
        );
        let file = args
            .get("file_path")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .context("missing file_path")?;
        let number = |key: &str, default: usize| -> Result<usize> {
            match args.get(key) {
                None => Ok(default),
                Some(n) => n
                    .as_u64()
                    .and_then(|n| usize::try_from(n).ok())
                    .filter(|n| *n > 0)
                    .context("expected a positive line number"),
            }
        };
        let start = number("offset", 1)?;
        let limit = number("limit", DEFAULT_READ_MAX_LINES)?.min(DEFAULT_READ_MAX_LINES);
        let request_id = uuid::Uuid::new_v4().to_string();
        let req = PermissionRequest {
            request_id: request_id.clone(),
            round_id: self.round.into(),
            order: order.try_into()?,
            tool_call_id: Some(call.tool_id.clone()),
            project_path: Some(self.workspace.display().to_string()),
            project_id: self.project.into(),
            session_id: self.session.into(),
            agent_id: self.agent_id.into(),
            action: "read".into(),
            resources: vec![file.into()],
            save_resources: Vec::new(),
            source: PermissionRequestSource {
                kind: PermissionRequestSourceKind::ToolCall,
                identity: "Read".into(),
            },
            delegation: None,
            display_metadata: Default::default(),
        };
        let wait = self
            .permissions
            .register_batch_for_turn(vec![req], self.turn)
            .await?
            .pop()
            .context("missing approval receiver")?;
        let outcome = tokio::select! { biased;
            _ = self.cancel.cancelled() => {
                self.permissions.cancel_request(&request_id, "turn cancelled").await?;
                bail!("turn cancelled")
            }
            result = wait.wait() => result,
        };
        match outcome {
            PermissionWaitOutcome::Replied(PermissionReply::Once) => (),
            PermissionWaitOutcome::Replied(PermissionReply::Reject { feedback }) => {
                bail!("Read rejected: {}", feedback.unwrap_or_default())
            }
            PermissionWaitOutcome::Cancelled { reason } => bail!("Read cancelled: {reason}"),
            _ => bail!("unsupported approval for the local Read provider"),
        }
        ensure!(!self.cancel.is_cancelled(), "turn cancelled");
        let path = Path::new(file);
        let relative = if path.is_absolute() {
            path.strip_prefix(self.workspace)
                .context("Read path is outside the workspace")?
        } else {
            path
        };
        let handle = self.reader.open_file(relative).await?;
        let result = read_file_from_reader(
            handle,
            file,
            start,
            limit,
            2000,
            DEFAULT_READ_MAX_TOTAL_CHARS,
        )
        .await
        .map_err(anyhow::Error::msg)?;
        let view = build_read_file_presentation(file, &result);
        Ok(self.result(
            &call.tool_id,
            json!({"file_path":file,"content":result.content}),
            view.result_for_assistant,
            false,
        ))
    }
}

impl ToolBatchOperations for Reads<'_> {
    type Error = anyhow::Error;
    type Output = Message;
    async fn pre_tool_hooks(&self, _: &[String]) {}
    async fn concurrency_after_hooks(
        &self,
        ids: &[String],
        _: usize,
        _: SubagentBatchExecutionPolicy,
    ) -> Vec<bool> {
        vec![false; ids.len()]
    }
    async fn prepare_permissions(&self, _: &[String]) -> Result<()> {
        Ok(())
    }
    async fn cleanup_permissions(&self, _: &[String], _: &str) {}
    fn batch_interrupted(&self, _: &str) -> bool {
        self.cancel.is_cancelled()
    }
    async fn interrupted_results(&self, ids: Vec<String>) -> Vec<Message> {
        ids.iter()
            .map(|id| self.failed_result(id, anyhow!("turn cancelled")))
            .collect()
    }
    fn start_unit(&self, _: &[String], _: bool) -> ToolAdmission {
        if self.cancel.is_cancelled() {
            ToolAdmission::Interrupted
        } else {
            ToolAdmission::Run(None)
        }
    }
    async fn execute_task(&self, id: String) -> Result<Message> {
        let (order, c) = self.find_call(&id)?;
        self.read(order, c).await
    }
    fn failed_result(&self, id: &str, error: anyhow::Error) -> Message {
        self.result(
            id,
            json!({"error":error.to_string()}),
            error.to_string(),
            true,
        )
    }
}

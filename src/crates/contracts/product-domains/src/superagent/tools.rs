//! The superagent's closed tool set.
//!
//! The model may call exactly these tools. Arguments are parsed strictly
//! (`deny_unknown_fields`) and checked against the bounds below before the
//! cloud node acts on them, so a malformed or oversized call is answered with
//! a stable error the model can read instead of being guessed at. Budgets are
//! user-visible quotas enforced by the turn loop; nothing here inspects call
//! patterns.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// Instructions handed to one job (the dispatch prompt bound).
pub const MAX_INSTRUCTIONS_BYTES: usize = 32 * 1024;
/// A follow-up or steering message.
pub const MAX_MESSAGE_BYTES: usize = 32 * 1024;
pub const MAX_TITLE_CHARS: usize = 120;
pub const MAX_LABEL_CHARS: usize = 64;
pub const MAX_ID_BYTES: usize = 128;
/// Permission request ids are minted by the device runtime.
pub const MAX_PROMPT_ID_BYTES: usize = 512;
pub const MAX_ANSWERS: usize = 16;
pub const MAX_REF_BYTES: usize = 255;
pub const MAX_REMOTE_URL_BYTES: usize = 2048;
/// `fleet_wait` parks for at most an hour per call.
pub const MAX_WAIT_SECONDS: u32 = 3600;
pub const DEFAULT_WAIT_SECONDS: u32 = 600;
pub const MAX_JOB_IDS: usize = 64;

/// Every tool, by name.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SuperagentTool {
    FleetListRuntimes,
    FleetDispatch,
    FleetWait,
    FleetJobStatus,
    FleetJobResult,
    FleetJobTranscript,
    FleetJobMessage,
    FleetJobCancel,
    FleetJobAnswer,
    FleetPublishBranch,
}

impl SuperagentTool {
    pub const ALL: [Self; 10] = [
        Self::FleetListRuntimes,
        Self::FleetDispatch,
        Self::FleetWait,
        Self::FleetJobStatus,
        Self::FleetJobResult,
        Self::FleetJobTranscript,
        Self::FleetJobMessage,
        Self::FleetJobCancel,
        Self::FleetJobAnswer,
        Self::FleetPublishBranch,
    ];

    pub const fn name(self) -> &'static str {
        match self {
            Self::FleetListRuntimes => "fleet_list_runtimes",
            Self::FleetDispatch => "fleet_dispatch",
            Self::FleetWait => "fleet_wait",
            Self::FleetJobStatus => "fleet_job_status",
            Self::FleetJobResult => "fleet_job_result",
            Self::FleetJobTranscript => "fleet_job_transcript",
            Self::FleetJobMessage => "fleet_job_message",
            Self::FleetJobCancel => "fleet_job_cancel",
            Self::FleetJobAnswer => "fleet_job_answer",
            Self::FleetPublishBranch => "fleet_publish_branch",
        }
    }

    pub fn from_name(name: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|tool| tool.name() == name)
    }

    /// The step is written ahead to the ledger before it runs, because it
    /// changes something on a device (a retry after a crash reconciles
    /// through status/list instead of repeating it).
    pub const fn is_mutation(self) -> bool {
        matches!(
            self,
            Self::FleetDispatch
                | Self::FleetJobMessage
                | Self::FleetJobCancel
                | Self::FleetJobAnswer
                | Self::FleetPublishBranch
        )
    }

    /// The turn parks (no model call, no memory) until an event or timer.
    pub const fn parks(self) -> bool {
        matches!(self, Self::FleetWait)
    }

    /// The result is shown to the user as well (the transcript is read only
    /// on an explicit, visible request).
    pub const fn is_user_visible(self) -> bool {
        matches!(self, Self::FleetJobTranscript | Self::FleetPublishBranch)
    }
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ListRuntimesInput {
    /// List offline devices too (with their last known facts).
    #[serde(default)]
    pub include_offline: bool,
}

/// Where a job's code comes from. Resolved on the target, never a path.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum DispatchSourceInput {
    /// A workspace of the target device, by its fleet workspace id.
    #[serde(rename_all = "camelCase")]
    Workspace {
        workspace_id: String,
        #[serde(default, rename = "ref", skip_serializing_if = "Option::is_none")]
        git_ref: Option<String>,
    },
    /// A Git remote the target can fetch with its own credentials.
    #[serde(rename_all = "camelCase")]
    Remote {
        remote_url: String,
        #[serde(rename = "ref")]
        git_ref: String,
    },
    /// The result branch of an earlier job (peer import, phase S2).
    #[serde(rename_all = "camelCase")]
    Job { job_id: String },
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ApprovalChoice {
    /// The job runs without waiting for anyone to approve (the default). A
    /// device refuses it only when its user turned
    /// `superagent.allowAutoApproval` off (reason
    /// `auto_approval_disabled_on_device`).
    #[default]
    Auto,
    /// Prompts wait for an answer, from the user's tray or `fleet_job_answer`.
    Remote,
    RejectAndReport,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WorktreeMode {
    /// Every job gets its own new worktree (the only mode).
    #[default]
    New,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DispatchInput {
    pub target: String,
    pub source: DispatchSourceInput,
    pub instructions: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning_preset: Option<String>,
    #[serde(default)]
    pub approval: ApprovalChoice,
    #[serde(default)]
    pub worktree: WorktreeMode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default)]
    pub queue_if_offline: bool,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WaitUntil {
    #[default]
    StateChange,
    AnyBlocked,
    /// Any job is done, failed or cancelled.
    AnyTerminal,
    /// Every job is done, failed or cancelled.
    AllTerminal,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WaitInput {
    /// Exactly one of `jobIds` and `groupId`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub job_ids: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group_id: Option<String>,
    #[serde(default)]
    pub until: WaitUntil,
    /// Seconds; at most [`MAX_WAIT_SECONDS`].
    #[serde(default = "default_wait_seconds")]
    pub timeout: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JobStatusInput {
    /// Exactly one of `jobIds` and `groupId`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub job_ids: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JobRefInput {
    pub job_id: String,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum JobMessageMode {
    /// Steer a running turn, or start the next turn of a finished one.
    #[default]
    Auto,
    Steer,
    FollowUp,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JobMessageInput {
    pub job_id: String,
    pub message: String,
    #[serde(default)]
    pub mode: JobMessageMode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AnswerDecision {
    /// Allow this request once.
    Once,
    /// Allow this and matching later requests of the job.
    Always,
    Reject,
}

/// One answer to a worker question, by question id when it has several.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QuestionAnswerInput {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub question_id: Option<String>,
    pub answer: String,
}

/// Answer a waiting prompt of a job: a permission (`decision`, with optional
/// `feedback` on a reject) or a question (`answers`). Exactly one of the two.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JobAnswerInput {
    pub job_id: String,
    pub prompt_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub decision: Option<AnswerDecision>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub feedback: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub answers: Option<Vec<QuestionAnswerInput>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublishBranchInput {
    pub job_id: String,
    /// Remote name on the device; `origin` when absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remote: Option<String>,
}

/// One parsed, validated tool call.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SuperagentToolCall {
    FleetListRuntimes(ListRuntimesInput),
    FleetDispatch(DispatchInput),
    FleetWait(WaitInput),
    FleetJobStatus(JobStatusInput),
    FleetJobResult(JobRefInput),
    FleetJobTranscript(JobRefInput),
    FleetJobMessage(JobMessageInput),
    FleetJobCancel(JobRefInput),
    FleetJobAnswer(JobAnswerInput),
    FleetPublishBranch(PublishBranchInput),
}

impl SuperagentToolCall {
    pub const fn tool(&self) -> SuperagentTool {
        match self {
            Self::FleetListRuntimes(_) => SuperagentTool::FleetListRuntimes,
            Self::FleetDispatch(_) => SuperagentTool::FleetDispatch,
            Self::FleetWait(_) => SuperagentTool::FleetWait,
            Self::FleetJobStatus(_) => SuperagentTool::FleetJobStatus,
            Self::FleetJobResult(_) => SuperagentTool::FleetJobResult,
            Self::FleetJobTranscript(_) => SuperagentTool::FleetJobTranscript,
            Self::FleetJobMessage(_) => SuperagentTool::FleetJobMessage,
            Self::FleetJobCancel(_) => SuperagentTool::FleetJobCancel,
            Self::FleetJobAnswer(_) => SuperagentTool::FleetJobAnswer,
            Self::FleetPublishBranch(_) => SuperagentTool::FleetPublishBranch,
        }
    }
}

/// Why a tool call was refused. `code` is stable; `message` is for the model.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolInputError {
    pub code: String,
    pub message: String,
}

pub const TOOL_ERROR_UNKNOWN_TOOL: &str = "unknown_tool";
pub const TOOL_ERROR_INVALID_ARGUMENTS: &str = "invalid_arguments";
pub const TOOL_ERROR_OUT_OF_BOUNDS: &str = "out_of_bounds";

impl ToolInputError {
    fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.to_string(),
            message: message.into(),
        }
    }

    fn bounds(message: impl Into<String>) -> Self {
        Self::new(TOOL_ERROR_OUT_OF_BOUNDS, message)
    }

    fn invalid(message: impl Into<String>) -> Self {
        Self::new(TOOL_ERROR_INVALID_ARGUMENTS, message)
    }
}

impl std::fmt::Display for ToolInputError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for ToolInputError {}

/// Parse and validate one model tool call. An absent or `null` argument
/// object reads as `{}`.
pub fn parse_tool_call(
    name: &str,
    arguments: &Value,
) -> Result<SuperagentToolCall, ToolInputError> {
    let tool = SuperagentTool::from_name(name).ok_or_else(|| {
        ToolInputError::new(TOOL_ERROR_UNKNOWN_TOOL, format!("no tool named '{name}'"))
    })?;
    let arguments = if arguments.is_null() {
        json!({})
    } else {
        arguments.clone()
    };
    fn decode<T: serde::de::DeserializeOwned>(value: Value) -> Result<T, ToolInputError> {
        serde_json::from_value(value).map_err(|error| ToolInputError::invalid(error.to_string()))
    }
    let call = match tool {
        SuperagentTool::FleetListRuntimes => {
            SuperagentToolCall::FleetListRuntimes(decode(arguments)?)
        }
        SuperagentTool::FleetDispatch => SuperagentToolCall::FleetDispatch(decode(arguments)?),
        SuperagentTool::FleetWait => SuperagentToolCall::FleetWait(decode(arguments)?),
        SuperagentTool::FleetJobStatus => SuperagentToolCall::FleetJobStatus(decode(arguments)?),
        SuperagentTool::FleetJobResult => SuperagentToolCall::FleetJobResult(decode(arguments)?),
        SuperagentTool::FleetJobTranscript => {
            SuperagentToolCall::FleetJobTranscript(decode(arguments)?)
        }
        SuperagentTool::FleetJobMessage => SuperagentToolCall::FleetJobMessage(decode(arguments)?),
        SuperagentTool::FleetJobCancel => SuperagentToolCall::FleetJobCancel(decode(arguments)?),
        SuperagentTool::FleetJobAnswer => SuperagentToolCall::FleetJobAnswer(decode(arguments)?),
        SuperagentTool::FleetPublishBranch => {
            SuperagentToolCall::FleetPublishBranch(decode(arguments)?)
        }
    };
    validate_tool_call(&call)?;
    Ok(call)
}

/// Check the bounds of an already decoded call.
pub fn validate_tool_call(call: &SuperagentToolCall) -> Result<(), ToolInputError> {
    match call {
        SuperagentToolCall::FleetListRuntimes(_) => Ok(()),
        SuperagentToolCall::FleetDispatch(input) => {
            check_id("target", &input.target)?;
            check_source(&input.source)?;
            check_instructions(&input.instructions)?;
            check_optional_chars("title", input.title.as_deref(), MAX_TITLE_CHARS)?;
            check_optional_chars("label", input.label.as_deref(), MAX_LABEL_CHARS)?;
            check_optional_id("group", input.group.as_deref())?;
            check_optional_id("agent", input.agent.as_deref())?;
            check_optional_bytes("model", input.model.as_deref(), 256)?;
            check_optional_id("reasoningPreset", input.reasoning_preset.as_deref())
        }
        SuperagentToolCall::FleetWait(input) => {
            check_job_selection(input.job_ids.as_deref(), input.group_id.as_deref())?;
            if input.timeout == 0 || input.timeout > MAX_WAIT_SECONDS {
                return Err(ToolInputError::bounds(format!(
                    "'timeout' must be 1-{MAX_WAIT_SECONDS} seconds"
                )));
            }
            Ok(())
        }
        SuperagentToolCall::FleetJobStatus(input) => {
            check_job_selection(input.job_ids.as_deref(), input.group_id.as_deref())
        }
        SuperagentToolCall::FleetJobResult(input)
        | SuperagentToolCall::FleetJobTranscript(input)
        | SuperagentToolCall::FleetJobCancel(input) => check_id("jobId", &input.job_id),
        SuperagentToolCall::FleetJobMessage(input) => {
            check_id("jobId", &input.job_id)?;
            if input.message.trim().is_empty() {
                return Err(ToolInputError::invalid("'message' cannot be empty"));
            }
            if input.message.len() > MAX_MESSAGE_BYTES {
                return Err(ToolInputError::bounds(format!(
                    "'message' exceeds {MAX_MESSAGE_BYTES} bytes"
                )));
            }
            Ok(())
        }
        SuperagentToolCall::FleetJobAnswer(input) => {
            check_id("jobId", &input.job_id)?;
            if input.prompt_id.is_empty() || input.prompt_id.len() > MAX_PROMPT_ID_BYTES {
                return Err(ToolInputError::bounds(format!(
                    "'promptId' must contain 1-{MAX_PROMPT_ID_BYTES} bytes"
                )));
            }
            match (&input.decision, &input.answers) {
                (Some(decision), None) => {
                    if input.feedback.is_some() && *decision != AnswerDecision::Reject {
                        return Err(ToolInputError::invalid(
                            "'feedback' goes only with decision 'reject'",
                        ));
                    }
                }
                (None, Some(answers)) => {
                    if input.feedback.is_some() {
                        return Err(ToolInputError::invalid(
                            "'feedback' goes only with a permission decision",
                        ));
                    }
                    if answers.is_empty() || answers.len() > MAX_ANSWERS {
                        return Err(ToolInputError::bounds(format!(
                            "'answers' must hold 1-{MAX_ANSWERS} answers"
                        )));
                    }
                    let total: usize = answers.iter().map(|answer| answer.answer.len()).sum();
                    if total > MAX_MESSAGE_BYTES {
                        return Err(ToolInputError::bounds(format!(
                            "'answers' exceed {MAX_MESSAGE_BYTES} bytes"
                        )));
                    }
                    for answer in answers {
                        check_optional_id("answers[].questionId", answer.question_id.as_deref())?;
                    }
                }
                _ => {
                    return Err(ToolInputError::invalid(
                        "give exactly one of 'decision' and 'answers'",
                    ))
                }
            }
            if input
                .feedback
                .as_ref()
                .is_some_and(|feedback| feedback.len() > MAX_MESSAGE_BYTES)
            {
                return Err(ToolInputError::bounds(format!(
                    "'feedback' exceeds {MAX_MESSAGE_BYTES} bytes"
                )));
            }
            Ok(())
        }
        SuperagentToolCall::FleetPublishBranch(input) => {
            check_id("jobId", &input.job_id)?;
            if let Some(remote) = input.remote.as_deref() {
                check_id("remote", remote)?;
            }
            Ok(())
        }
    }
}

fn default_wait_seconds() -> u32 {
    DEFAULT_WAIT_SECONDS
}

fn check_id(field: &str, value: &str) -> Result<(), ToolInputError> {
    if value.is_empty() || value.len() > MAX_ID_BYTES {
        return Err(ToolInputError::bounds(format!(
            "'{field}' must contain 1-{MAX_ID_BYTES} bytes"
        )));
    }
    if value.starts_with('-')
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
    {
        return Err(ToolInputError::invalid(format!(
            "'{field}' may contain only letters, digits, '-', '_', '.' and ':'"
        )));
    }
    Ok(())
}

fn check_optional_id(field: &str, value: Option<&str>) -> Result<(), ToolInputError> {
    value.map_or(Ok(()), |value| check_id(field, value))
}

fn check_chars(field: &str, value: &str, max: usize) -> Result<(), ToolInputError> {
    if value.trim().is_empty() || value.chars().count() > max {
        return Err(ToolInputError::bounds(format!(
            "'{field}' must contain 1-{max} characters"
        )));
    }
    if value.chars().any(char::is_control) {
        return Err(ToolInputError::invalid(format!(
            "'{field}' must not contain control characters"
        )));
    }
    Ok(())
}

fn check_optional_chars(
    field: &str,
    value: Option<&str>,
    max: usize,
) -> Result<(), ToolInputError> {
    value.map_or(Ok(()), |value| check_chars(field, value, max))
}

fn check_optional_bytes(
    field: &str,
    value: Option<&str>,
    max: usize,
) -> Result<(), ToolInputError> {
    match value {
        Some(value) if value.trim().is_empty() || value.len() > max => Err(ToolInputError::bounds(
            format!("'{field}' must contain 1-{max} bytes"),
        )),
        _ => Ok(()),
    }
}

fn check_instructions(instructions: &str) -> Result<(), ToolInputError> {
    if instructions.trim().is_empty() {
        return Err(ToolInputError::invalid("'instructions' cannot be empty"));
    }
    if instructions.len() > MAX_INSTRUCTIONS_BYTES {
        return Err(ToolInputError::bounds(format!(
            "'instructions' exceed {MAX_INSTRUCTIONS_BYTES} bytes"
        )));
    }
    Ok(())
}

fn check_git_ref(git_ref: &str) -> Result<(), ToolInputError> {
    if git_ref.is_empty() || git_ref.len() > MAX_REF_BYTES || git_ref.starts_with('-') {
        return Err(ToolInputError::bounds(
            "'ref' is outside the accepted range",
        ));
    }
    if !git_ref
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'/' | b'-' | b'_' | b'.'))
        || git_ref.contains("..")
    {
        return Err(ToolInputError::invalid(
            "'ref' is not a plain Git ref or commit id",
        ));
    }
    Ok(())
}

fn check_source(source: &DispatchSourceInput) -> Result<(), ToolInputError> {
    match source {
        DispatchSourceInput::Workspace {
            workspace_id,
            git_ref,
        } => {
            check_id("source.workspaceId", workspace_id)?;
            git_ref.as_deref().map_or(Ok(()), check_git_ref)
        }
        DispatchSourceInput::Remote {
            remote_url,
            git_ref,
        } => {
            if remote_url.is_empty()
                || remote_url.len() > MAX_REMOTE_URL_BYTES
                || remote_url.starts_with('-')
                || remote_url.bytes().any(|byte| byte.is_ascii_control())
                || remote_url.to_ascii_lowercase().starts_with("ext::")
            {
                return Err(ToolInputError::invalid(
                    "'source.remoteUrl' is not an acceptable Git remote",
                ));
            }
            check_git_ref(git_ref)
        }
        DispatchSourceInput::Job { job_id } => check_id("source.jobId", job_id),
    }
}

fn check_job_selection(
    job_ids: Option<&[String]>,
    group_id: Option<&str>,
) -> Result<(), ToolInputError> {
    match (job_ids, group_id) {
        (Some(_), Some(_)) | (None, None) => Err(ToolInputError::invalid(
            "give exactly one of 'jobIds' and 'groupId'",
        )),
        (Some(ids), None) => {
            if ids.is_empty() || ids.len() > MAX_JOB_IDS {
                return Err(ToolInputError::bounds(format!(
                    "'jobIds' must name 1-{MAX_JOB_IDS} jobs"
                )));
            }
            ids.iter().try_for_each(|id| check_id("jobIds[]", id))
        }
        (None, Some(group)) => check_id("groupId", group),
    }
}

// ---------------------------------------------------------------------------
// Tool descriptions for the model
// ---------------------------------------------------------------------------

/// The JSON Schema of one tool's arguments, as offered to the model. The
/// schemas mirror the strict inputs above (`additionalProperties: false`).
pub fn tool_input_schema(tool: SuperagentTool) -> Value {
    let source = json!({
        "oneOf": [
            {"type": "object", "additionalProperties": false, "required": ["kind", "workspaceId"],
             "properties": {"kind": {"const": "workspace"}, "workspaceId": {"type": "string"},
                            "ref": {"type": "string"}}},
            {"type": "object", "additionalProperties": false, "required": ["kind", "remoteUrl", "ref"],
             "properties": {"kind": {"const": "remote"}, "remoteUrl": {"type": "string"},
                            "ref": {"type": "string"}}},
            {"type": "object", "additionalProperties": false, "required": ["kind", "jobId"],
             "properties": {"kind": {"const": "job"}, "jobId": {"type": "string"}}}
        ]
    });
    let approval = json!({"type": "string", "enum": ["auto", "remote", "reject-and-report"],
                          "default": "auto"});
    let selection = json!({
        "jobIds": {"type": "array", "items": {"type": "string"}, "maxItems": MAX_JOB_IDS},
        "groupId": {"type": "string"}
    });
    let object = |required: Value, properties: Value| {
        json!({"type": "object", "additionalProperties": false,
               "required": required, "properties": properties})
    };
    match tool {
        SuperagentTool::FleetListRuntimes => {
            object(json!([]), json!({"includeOffline": {"type": "boolean"}}))
        }
        SuperagentTool::FleetDispatch => object(
            json!(["target", "source", "instructions"]),
            json!({
                "target": {"type": "string"}, "source": source,
                "instructions": {"type": "string", "maxLength": MAX_INSTRUCTIONS_BYTES},
                "title": {"type": "string", "maxLength": MAX_TITLE_CHARS},
                "agent": {"type": "string"}, "model": {"type": "string"},
                "reasoningPreset": {"type": "string"}, "approval": approval,
                "worktree": {"const": "new"}, "group": {"type": "string"},
                "label": {"type": "string", "maxLength": MAX_LABEL_CHARS},
                "queueIfOffline": {"type": "boolean"}
            }),
        ),
        SuperagentTool::FleetWait => {
            let mut properties = selection.clone();
            properties["until"] = json!({"type": "string",
                "enum": ["state_change", "any_blocked", "any_terminal", "all_terminal"]});
            properties["timeout"] =
                json!({"type": "integer", "minimum": 1, "maximum": MAX_WAIT_SECONDS});
            object(json!([]), properties)
        }
        SuperagentTool::FleetJobStatus => object(json!([]), selection),
        SuperagentTool::FleetJobResult
        | SuperagentTool::FleetJobTranscript
        | SuperagentTool::FleetJobCancel => {
            object(json!(["jobId"]), json!({"jobId": {"type": "string"}}))
        }
        SuperagentTool::FleetJobMessage => object(
            json!(["jobId", "message"]),
            json!({"jobId": {"type": "string"},
                   "message": {"type": "string", "maxLength": MAX_MESSAGE_BYTES},
                   "mode": {"type": "string", "enum": ["auto", "steer", "followUp"]}}),
        ),
        SuperagentTool::FleetJobAnswer => object(
            json!(["jobId", "promptId"]),
            json!({"jobId": {"type": "string"}, "promptId": {"type": "string"},
                   "decision": {"type": "string", "enum": ["once", "always", "reject"]},
                   "feedback": {"type": "string", "maxLength": MAX_MESSAGE_BYTES},
                   "answers": {"type": "array", "maxItems": MAX_ANSWERS, "items": {
                       "type": "object", "additionalProperties": false, "required": ["answer"],
                       "properties": {"questionId": {"type": "string"},
                                      "answer": {"type": "string"}}}}}),
        ),
        SuperagentTool::FleetPublishBranch => object(
            json!(["jobId"]),
            json!({"jobId": {"type": "string"}, "remote": {"type": "string"}}),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dispatch_args() -> Value {
        json!({
            "target": "dev-1",
            "source": {"kind": "workspace", "workspaceId": "local_abc", "ref": "main"},
            "instructions": "fix the build"
        })
    }

    #[test]
    fn tool_names_round_trip_and_are_closed() {
        for tool in SuperagentTool::ALL {
            assert_eq!(SuperagentTool::from_name(tool.name()), Some(tool));
            assert_eq!(serde_json::to_value(tool).unwrap(), tool.name());
            let schema = tool_input_schema(tool);
            assert_eq!(schema["additionalProperties"], false, "{}", tool.name());
        }
        let error = parse_tool_call("shell_exec", &json!({})).unwrap_err();
        assert_eq!(error.code, TOOL_ERROR_UNKNOWN_TOOL);
        assert!(SuperagentTool::FleetWait.parks());
        assert!(SuperagentTool::FleetDispatch.is_mutation());
        assert!(!SuperagentTool::FleetJobStatus.is_mutation());
    }

    #[test]
    fn dispatch_parses_with_defaults() {
        let call = parse_tool_call("fleet_dispatch", &dispatch_args()).unwrap();
        let SuperagentToolCall::FleetDispatch(input) = call else {
            panic!("wrong call");
        };
        assert_eq!(input.approval, ApprovalChoice::Auto);
        assert_eq!(input.worktree, WorktreeMode::New);
        assert!(!input.queue_if_offline);
        assert_eq!(
            input.source,
            DispatchSourceInput::Workspace {
                workspace_id: "local_abc".into(),
                git_ref: Some("main".into())
            }
        );
        // Re-encoding gives the wire names back.
        let encoded = serde_json::to_value(&input).unwrap();
        assert_eq!(encoded["source"]["ref"], "main");
        assert_eq!(encoded["approval"], "auto");
    }

    #[test]
    fn unknown_fields_and_values_are_refused() {
        let mut args = dispatch_args();
        args["shell"] = json!("rm -rf /");
        assert_eq!(
            parse_tool_call("fleet_dispatch", &args).unwrap_err().code,
            TOOL_ERROR_INVALID_ARGUMENTS
        );
        let mut args = dispatch_args();
        args["source"]["path"] = json!("/etc");
        assert!(parse_tool_call("fleet_dispatch", &args).is_err());
        let mut args = dispatch_args();
        args["source"] = json!({"kind": "path", "path": "/etc"});
        assert!(parse_tool_call("fleet_dispatch", &args).is_err());
        let mut args = dispatch_args();
        args["worktree"] = json!("reuse");
        assert!(parse_tool_call("fleet_dispatch", &args).is_err());
        let mut args = dispatch_args();
        args["approval"] = json!("always");
        assert!(parse_tool_call("fleet_dispatch", &args).is_err());
        assert!(parse_tool_call("fleet_list_runtimes", &json!({"x": 1})).is_err());
        assert!(parse_tool_call("fleet_list_runtimes", &Value::Null).is_ok());
    }

    #[test]
    fn job_answers_take_a_decision_or_answers() {
        let answer = |args: Value| parse_tool_call("fleet_job_answer", &args);
        let SuperagentToolCall::FleetJobAnswer(input) =
            answer(json!({"jobId": "j", "promptId": "perm-1", "decision": "once"})).unwrap()
        else {
            panic!("wrong call");
        };
        assert_eq!(input.decision, Some(AnswerDecision::Once));
        assert!(SuperagentTool::FleetJobAnswer.is_mutation());
        assert!(answer(json!({
            "jobId": "j", "promptId": "p", "decision": "reject", "feedback": "use read-only"
        }))
        .is_ok());
        assert!(answer(json!({
            "jobId": "j", "promptId": "q", "answers": [{"questionId": "q1", "answer": "yes"}]
        }))
        .is_ok());
        for bad in [
            json!({"jobId": "j", "promptId": "p"}),
            json!({"jobId": "j", "promptId": "p", "decision": "once", "answers": [{"answer": "a"}]}),
            json!({"jobId": "j", "promptId": "p", "decision": "once", "feedback": "x"}),
            json!({"jobId": "j", "promptId": "p", "decision": "allow"}),
            json!({"jobId": "j", "promptId": "p", "answers": []}),
            json!({"jobId": "j", "promptId": "", "decision": "once"}),
            json!({"jobId": "j", "promptId": "p", "decision": "once", "by": "user"}),
        ] {
            assert!(answer(bad.clone()).is_err(), "{bad}");
        }
    }

    #[test]
    fn bounds_are_enforced() {
        let mut args = dispatch_args();
        args["instructions"] = json!("x".repeat(MAX_INSTRUCTIONS_BYTES + 1));
        assert_eq!(
            parse_tool_call("fleet_dispatch", &args).unwrap_err().code,
            TOOL_ERROR_OUT_OF_BOUNDS
        );
        let mut args = dispatch_args();
        args["instructions"] = json!("   ");
        assert!(parse_tool_call("fleet_dispatch", &args).is_err());
        let mut args = dispatch_args();
        args["source"]["ref"] = json!("--upload-pack=evil");
        assert!(parse_tool_call("fleet_dispatch", &args).is_err());
        let mut args = dispatch_args();
        args["source"] = json!({"kind": "remote", "remoteUrl": "ext::sh -c id", "ref": "main"});
        assert!(parse_tool_call("fleet_dispatch", &args).is_err());
        let mut args = dispatch_args();
        args["target"] = json!("../../etc");
        assert!(parse_tool_call("fleet_dispatch", &args).is_err());

        let wait = |timeout: u32| {
            parse_tool_call(
                "fleet_wait",
                &json!({"groupId": "g", "until": "all_terminal", "timeout": timeout}),
            )
        };
        assert!(wait(MAX_WAIT_SECONDS).is_ok());
        assert_eq!(
            wait(MAX_WAIT_SECONDS + 1).unwrap_err().code,
            TOOL_ERROR_OUT_OF_BOUNDS
        );
        assert!(wait(0).is_err());
        let SuperagentToolCall::FleetWait(input) =
            parse_tool_call("fleet_wait", &json!({"jobIds": ["a"]})).unwrap()
        else {
            panic!("wrong call");
        };
        assert_eq!(
            (input.until, input.timeout),
            (WaitUntil::StateChange, DEFAULT_WAIT_SECONDS)
        );
        assert!(parse_tool_call("fleet_wait", &json!({"jobIds": ["a"], "groupId": "g"})).is_err());
        assert!(parse_tool_call("fleet_job_status", &json!({})).is_err());
        assert!(parse_tool_call("fleet_job_status", &json!({"jobIds": []})).is_err());

        let message = |text: &str| {
            parse_tool_call(
                "fleet_job_message",
                &json!({"jobId": "j", "message": text, "mode": "followUp"}),
            )
        };
        assert!(message("continue").is_ok());
        assert!(message(" ").is_err());
        assert!(message(&"y".repeat(MAX_MESSAGE_BYTES + 1)).is_err());
    }
}

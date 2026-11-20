//! Review launch: resolves a workspace Review target with Git, builds the
//! launch plan (`openbitfun_agent_runtime::deep_review::launch_plan`) and
//! starts the read-only reviewer as a child session of the session that asked.
//!
//! Clients only send the intent, an optional file or folder scope and an
//! optional focus; they never build manifests or prompts. Remote workspaces
//! are refused explicitly: bounded exact diff evidence and the restricted read
//! envelope are local-only today (see `docs/architecture/deep-review.md`).

use crate::api::agentic_api::{
    create_session, start_dialog_turn, CreateSessionRequest, StartDialogTurnRequest,
};
use crate::api::app_state::AppState;
use crate::host::{HostHandle, State};
use crate::runtime::DesktopRuntimeContext;
use log::{info, warn};
use openbitfun_agent_runtime::deep_review::launch_plan::{
    parse_review_command, plan_workspace_review, review_child_session_id, scope_workspace_changes,
    stable_review_fingerprint, ReviewLaunchIntent, ReviewLaunchPlan, ReviewLaunchRefusal,
    UntrackedContentFact, WorkspaceChange, WorkspaceReviewSnapshot,
};
use openbitfun_core::agentic::coordination::ConversationCoordinator;
use openbitfun_core::service::git::{
    trust, GitChangedFileStatus, GitChangedFilesParams, GitDiffParams, GitError, GitService,
    GitStatus,
};
use openbitfun_core::service::workspace::WorkspaceKind;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::BTreeMap;
use std::path::Path;
use std::sync::Arc;

/// Untracked files larger than this are reported as unavailable content.
const UNTRACKED_CONTENT_READ_LIMIT: u64 = 2 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchReviewRequest {
    /// The session the Review belongs to; the reviewer runs as its child.
    pub parent_session_id: String,
    #[serde(default)]
    pub workspace_id: Option<String>,
    #[serde(default)]
    pub workspace_path: Option<String>,
    /// `review` (default) or `strict`.
    #[serde(default)]
    pub intent: Option<String>,
    /// A typed `/review …` / `/DeepReview …` line; its intent and focus win
    /// over `intent` / `focus`.
    #[serde(default)]
    pub command_text: Option<String>,
    /// Files or folders, relative to the workspace root; empty means every change.
    #[serde(default)]
    pub files: Vec<String>,
    #[serde(default)]
    pub focus: Option<String>,
    /// Idempotency key: a retry with the same id finds the child it created.
    #[serde(default)]
    pub request_id: Option<String>,
    /// Resolve and plan only; nothing is created.
    #[serde(default)]
    pub dry_run: bool,
    #[serde(default)]
    pub child_session_name: Option<String>,
    /// What the child's first user message shows instead of the prompt.
    #[serde(default)]
    pub display_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReviewLaunchFile {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_path: Option<String>,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LaunchReviewResponse {
    /// `prepared` (dry run), `started`, `uncertain` (the child exists but its
    /// first turn was not acknowledged) or `refused`.
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    pub intent: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_type: Option<String>,
    pub file_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub changed_line_count: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completeness: Option<String>,
    pub limitations: Vec<String>,
    pub files: Vec<ReviewLaunchFile>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub child_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub child_session_name: Option<String>,
    /// The requested paths a scope refusal names.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub paths: Vec<String>,
}

fn refused(
    intent: ReviewLaunchIntent,
    code: &str,
    message: impl Into<String>,
) -> LaunchReviewResponse {
    LaunchReviewResponse {
        status: "refused".to_string(),
        code: Some(code.to_string()),
        message: Some(message.into()),
        intent: intent.as_str().to_string(),
        ..Default::default()
    }
}

fn refusal_response(
    intent: ReviewLaunchIntent,
    refusal: &ReviewLaunchRefusal,
) -> LaunchReviewResponse {
    let mut response = refused(intent, refusal.code(), refusal.to_string());
    match refusal {
        ReviewLaunchRefusal::ManagedReviewUnavailable { file_count } => {
            response.file_count = *file_count;
        }
        ReviewLaunchRefusal::MissingScope { paths } | ReviewLaunchRefusal::EmptyScope { paths } => {
            response.paths = paths.clone();
        }
        ReviewLaunchRefusal::PathOutsideWorkspace { path } => {
            response.paths = vec![path.clone()];
        }
        ReviewLaunchRefusal::NoWorkspaceChanges => {}
    }
    response
}

fn launch_files(changes: &[WorkspaceChange]) -> Vec<ReviewLaunchFile> {
    changes
        .iter()
        .map(|change| ReviewLaunchFile {
            path: change.path.clone(),
            previous_path: change.previous_path.clone(),
            status: change.status.clone(),
        })
        .collect()
}

fn git_refusal(intent: ReviewLaunchIntent, error: &GitError) -> Option<LaunchReviewResponse> {
    if let Some(path) = error.untrusted_repository_path() {
        return Some(refused(
            intent,
            "review_repository_untrusted",
            trust::untrusted_repository_error_message(path),
        ));
    }
    if matches!(error, GitError::RepositoryNotFound(_)) {
        return Some(refused(
            intent,
            "review_not_git_repository",
            "No Git repository was found in the current workspace. Review requires a Git repository with an existing commit.",
        ));
    }
    None
}

fn status_from_letters(status: &str) -> &'static str {
    if status.contains('C') {
        "unknown"
    } else if status.contains('R') {
        "renamed"
    } else if status.contains('A') || status.contains('?') {
        "added"
    } else if status.contains('D') {
        "deleted"
    } else if status.contains('M') || status.contains('T') {
        "modified"
    } else {
        "unknown"
    }
}

fn changed_file_status(status: &GitChangedFileStatus) -> &'static str {
    match status {
        GitChangedFileStatus::Added => "added",
        GitChangedFileStatus::Modified => "modified",
        GitChangedFileStatus::Deleted => "deleted",
        GitChangedFileStatus::Renamed => "renamed",
        GitChangedFileStatus::Copied => "copied",
        GitChangedFileStatus::Unknown => "unknown",
    }
}

fn clean_path(path: &str) -> String {
    let unified = path.replace('\\', "/");
    unified.trim_start_matches("./").to_string()
}

/// Every path `git status` reports, with renames and statuses from the
/// `HEAD` name-status listing when the repository has a commit.
fn collect_workspace_changes(
    status: &GitStatus,
    changed: &[openbitfun_core::service::git::GitChangedFile],
) -> Vec<WorkspaceChange> {
    let mut by_path: BTreeMap<String, WorkspaceChange> = BTreeMap::new();
    let mut order: Vec<String> = Vec::new();
    fn add(
        by_path: &mut BTreeMap<String, WorkspaceChange>,
        order: &mut Vec<String>,
        change: WorkspaceChange,
    ) {
        if !by_path.contains_key(&change.path) {
            order.push(change.path.clone());
        }
        by_path.insert(change.path.clone(), change);
    }
    for file in status.staged.iter().chain(status.unstaged.iter()) {
        let path = clean_path(&file.path);
        if by_path.contains_key(&path) {
            continue;
        }
        add(
            &mut by_path,
            &mut order,
            WorkspaceChange {
                path: path.clone(),
                previous_path: None,
                status: status_from_letters(&file.status).to_string(),
                untracked: false,
                conflicted: false,
            },
        );
    }
    for file in changed {
        let path = clean_path(&file.path);
        let previous_path = file.old_path.as_deref().map(clean_path);
        if let Some(previous) = previous_path.as_deref() {
            // A rename listed by status under its old path is one change.
            if by_path.remove(previous).is_some() {
                order.retain(|item| item != previous);
            }
        }
        add(
            &mut by_path,
            &mut order,
            WorkspaceChange {
                path,
                previous_path,
                status: changed_file_status(&file.status).to_string(),
                untracked: false,
                conflicted: false,
            },
        );
    }
    for path in &status.untracked {
        let path = clean_path(path);
        let directory = path.ends_with('/');
        add(
            &mut by_path,
            &mut order,
            WorkspaceChange {
                path: path.trim_end_matches('/').to_string(),
                previous_path: None,
                status: if directory { "unknown" } else { "added" }.to_string(),
                untracked: true,
                conflicted: false,
            },
        );
    }
    for path in &status.conflicts {
        let path = clean_path(path);
        let previous_path = by_path
            .get(&path)
            .and_then(|change| change.previous_path.clone());
        add(
            &mut by_path,
            &mut order,
            WorkspaceChange {
                path,
                previous_path,
                status: "unknown".to_string(),
                untracked: false,
                conflicted: true,
            },
        );
    }
    order
        .into_iter()
        .filter_map(|path| by_path.remove(&path))
        .collect()
}

async fn untracked_fact(root: &Path, relative: &str) -> UntrackedContentFact {
    let full = root.join(relative);
    let Ok(metadata) = tokio::fs::metadata(&full).await else {
        return UntrackedContentFact::default();
    };
    if !metadata.is_file() || metadata.len() > UNTRACKED_CONTENT_READ_LIMIT {
        return UntrackedContentFact::default();
    }
    let Ok(bytes) = tokio::fs::read(&full).await else {
        return UntrackedContentFact::default();
    };
    let text = String::from_utf8_lossy(&bytes);
    let fingerprint = stable_review_fingerprint(&json!(text));
    let line_count = std::str::from_utf8(&bytes)
        .ok()
        .map(|text| text.lines().count() as u64);
    UntrackedContentFact {
        fingerprint: Some(fingerprint),
        line_count,
    }
}

fn plan_files(plan: &ReviewLaunchPlan) -> Vec<ReviewLaunchFile> {
    plan.target_evidence["files"]
        .as_array()
        .map(|files| {
            files
                .iter()
                .map(|file| ReviewLaunchFile {
                    path: file["path"].as_str().unwrap_or_default().to_string(),
                    previous_path: file
                        .get("previousPath")
                        .and_then(|value| value.as_str())
                        .map(str::to_string),
                    status: file["status"].as_str().unwrap_or("unknown").to_string(),
                })
                .collect()
        })
        .unwrap_or_default()
}

fn resolve_intent(request: &LaunchReviewRequest) -> Result<(ReviewLaunchIntent, String), String> {
    if let Some(text) = request
        .command_text
        .as_deref()
        .filter(|text| !text.trim().is_empty())
    {
        let command = parse_review_command(text)
            .ok_or_else(|| format!("Not a Review command: {}", text.trim()))?;
        return Ok((command.intent, command.focus));
    }
    let intent =
        ReviewLaunchIntent::parse(request.intent.as_deref().unwrap_or("")).ok_or_else(|| {
            format!(
                "Unknown Review intent: {}",
                request.intent.as_deref().unwrap_or_default()
            )
        })?;
    Ok((intent, request.focus.clone().unwrap_or_default()))
}

/// Resolves, plans and (unless `dryRun`) launches a Review of the workspace
/// changes as a read-only child of `parentSessionId`.
// @backend-command
pub async fn launch_review(
    app: HostHandle,
    coordinator: State<'_, Arc<ConversationCoordinator>>,
    app_state: State<'_, AppState>,
    runtime: State<'_, DesktopRuntimeContext>,
    request: LaunchReviewRequest,
) -> Result<LaunchReviewResponse, String> {
    let parent_session_id = request.parent_session_id.trim().to_string();
    if parent_session_id.is_empty() {
        return Err("parentSessionId is required".to_string());
    }
    let (intent, focus) = resolve_intent(&request)?;

    let parent = coordinator
        .get_session_manager()
        .get_session(&parent_session_id);
    let parent_config = parent.as_ref().map(|session| &session.config);
    let workspace_id = request
        .workspace_id
        .clone()
        .filter(|id| !id.trim().is_empty())
        .or_else(|| parent_config.and_then(|config| config.workspace_id.clone()));
    let requested_path = request
        .workspace_path
        .clone()
        .filter(|path| !path.trim().is_empty())
        .or_else(|| parent_config.and_then(|config| config.workspace_path.clone()))
        .unwrap_or_default();
    let workspace = match workspace_id.as_deref() {
        Some(id) => app_state
            .workspace_service
            .require_workspace(id)
            .await
            .map_err(|error| error.to_string())?,
        None => app_state
            .workspace_service
            .resolve_legacy_workspace_reference(None, &requested_path, None, None)
            .await
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "Review needs an open workspace".to_string())?,
    };
    if workspace.workspace_kind == WorkspaceKind::Remote
        || parent_config.is_some_and(|config| config.remote_connection_id.is_some())
    {
        return Ok(refused(
            intent,
            "review_remote_workspace_unsupported",
            "Remote workspace Review is not supported until bounded exact diff evidence is available. Use a local checkout.",
        ));
    }

    // The reviewer runs where the parent executes (a managed worktree keeps
    // its own changes); persistence stays with the project workspace.
    let project_root = workspace.root_path.to_string_lossy().into_owned();
    let execution_root = parent_config
        .and_then(|config| config.workspace_path.clone())
        .filter(|path| !path.trim().is_empty())
        .unwrap_or_else(|| project_root.clone());
    let repo = Path::new(&execution_root);

    let status = match GitService::get_status(repo).await {
        Ok(status) => status,
        Err(error) => {
            return git_refusal(intent, &error)
                .map(Ok)
                .unwrap_or_else(|| Err(format!("Failed to read workspace changes: {error}")));
        }
    };
    let changed = GitService::get_changed_files(
        repo,
        &GitChangedFilesParams {
            source: Some("HEAD".to_string()),
            review_safe: Some(true),
            ..Default::default()
        },
    )
    .await
    .unwrap_or_default();
    let all_changes = collect_workspace_changes(&status, &changed);
    let (changes, unmatched) = match scope_workspace_changes(&all_changes, &request.files) {
        Ok(scoped) => scoped,
        Err(refusal) => return Ok(refusal_response(intent, &refusal)),
    };
    if !unmatched.is_empty() {
        let missing = unmatched
            .iter()
            .filter(|entry| !repo.join(entry.as_str()).exists())
            .cloned()
            .collect::<Vec<_>>();
        if !missing.is_empty() {
            return Ok(refusal_response(
                intent,
                &ReviewLaunchRefusal::MissingScope { paths: missing },
            ));
        }
        if changes.is_empty() {
            return Ok(refusal_response(
                intent,
                &ReviewLaunchRefusal::EmptyScope { paths: unmatched },
            ));
        }
    }

    let tracked_paths = changes
        .iter()
        .filter(|change| !change.untracked)
        .flat_map(|change| std::iter::once(change.path.clone()).chain(change.previous_path.clone()))
        .collect::<Vec<_>>();
    let base_revision = GitService::resolve_revision(repo, "HEAD").await.ok();
    let diff = if tracked_paths.is_empty() {
        Some(String::new())
    } else if base_revision.is_none() {
        None
    } else {
        GitService::get_diff(
            repo,
            &GitDiffParams {
                source: Some("HEAD".to_string()),
                target: None,
                files: Some(tracked_paths),
                staged: None,
                stat: None,
                review_safe: Some(true),
            },
        )
        .await
        .map_err(|error| warn!("Review diff unavailable: {error}"))
        .ok()
    };
    let mut untracked = BTreeMap::new();
    for change in changes.iter().filter(|change| change.untracked) {
        untracked.insert(
            change.path.clone(),
            untracked_fact(repo, &change.path).await,
        );
    }
    let snapshot = WorkspaceReviewSnapshot {
        base_revision,
        changes,
        diff,
        untracked,
    };
    let plan = match plan_workspace_review(&snapshot, intent, &focus, &execution_root) {
        Ok(plan) => plan,
        Err(refusal) => {
            // A target too large for one reviewer still lists its files, so
            // the user can narrow the scope instead of starting over.
            let mut response = refusal_response(intent, &refusal);
            response.files = launch_files(&snapshot.changes);
            return Ok(response);
        }
    };

    let mut response = LaunchReviewResponse {
        status: "prepared".to_string(),
        intent: intent.as_str().to_string(),
        mode: Some(plan.mode.to_string()),
        agent_type: Some(plan.agent_type.to_string()),
        file_count: plan.file_count,
        changed_line_count: plan.changed_line_count,
        completeness: Some(plan.completeness.clone()),
        limitations: plan.limitations.clone(),
        files: plan_files(&plan),
        ..Default::default()
    };
    if request.dry_run {
        return Ok(response);
    }

    let request_id = request
        .request_id
        .clone()
        .filter(|id| !id.trim().is_empty())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let child_session_id = review_child_session_id(&request_id);
    let child_session_name = request
        .child_session_name
        .clone()
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| match intent {
            ReviewLaunchIntent::Review => "Review".to_string(),
            ReviewLaunchIntent::Strict => "Review: Strict".to_string(),
        });
    let model_name = parent_config
        .and_then(|config| config.model_id.clone())
        .filter(|model| !model.trim().is_empty())
        .unwrap_or_else(|| "default".to_string());
    let create_payload = json!({
        "sessionId": child_session_id,
        "sessionName": child_session_name,
        "agentType": plan.agent_type,
        "workspacePath": execution_root,
        "projectWorkspacePath": project_root,
        "workspaceId": workspace.id,
        "relationship": {
            "kind": plan.session_kind,
            "parentSessionId": parent_session_id,
            "parentRequestId": request_id,
        },
        "deepReviewRunManifest": plan.manifest,
        "reviewTargetEvidence": plan.target_evidence,
        "config": {
            "modelName": model_name,
            "enableTools": true,
            "safeMode": true,
            "autoCompact": true,
            "enableContextCompression": true,
        },
    });
    let create = || -> Result<CreateSessionRequest, String> {
        serde_json::from_value(create_payload.clone())
            .map_err(|error| format!("Invalid Review session request: {error}"))
    };
    let created = match create_session(coordinator, app_state, runtime, create()?).await {
        Ok(created) => created,
        Err(first) => {
            // Creation is idempotent for a Review child with a parent request id.
            warn!("Review child creation was uncertain; retrying: {first}");
            create_session(coordinator, app_state, runtime, create()?).await?
        }
    };
    response.request_id = Some(request_id.clone());
    response.child_session_id = Some(created.session_id.clone());
    response.child_session_name = Some(created.session_name.clone());

    let display_message = request
        .display_message
        .clone()
        .filter(|text| !text.trim().is_empty())
        .unwrap_or_else(|| child_session_name.clone());
    let mut turn = json!({
        "sessionId": created.session_id,
        "userInput": plan.prompt,
        "originalUserInput": display_message,
        "agentType": plan.agent_type,
        "workspaceId": workspace.id,
        "workspacePath": execution_root,
        "projectWorkspacePath": project_root,
        "turnId": format!("review_turn_{request_id}"),
    });
    if intent == ReviewLaunchIntent::Strict {
        turn["userMessageMetadata"] = json!({ "deepReviewRunManifest": plan.manifest });
    }
    let turn: StartDialogTurnRequest = serde_json::from_value(turn)
        .map_err(|error| format!("Invalid Review turn request: {error}"))?;
    match start_dialog_turn(app, runtime, turn).await {
        Ok(_) => {
            info!(
                "Review launched: parent={}, child={}, mode={}, files={}",
                parent_session_id, created.session_id, plan.mode, plan.file_count
            );
            response.status = "started".to_string();
        }
        Err(error) => {
            // The child exists and may be running: keep it, never resubmit.
            warn!(
                "Review start acknowledgement was uncertain: child={}, error={}",
                created.session_id, error
            );
            response.status = "uncertain".to_string();
            response.message = Some(error);
        }
    }
    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::*;
    use openbitfun_core::service::git::{GitChangedFile, GitFileStatus};

    fn file(path: &str, status: &str) -> GitFileStatus {
        GitFileStatus {
            path: path.to_string(),
            status: status.to_string(),
            index_status: None,
            workdir_status: Some(status.to_string()),
        }
    }

    #[test]
    fn workspace_changes_merge_status_renames_untracked_and_conflicts() {
        let status = GitStatus {
            staged: vec![file("src/old.rs", "R")],
            unstaged: vec![file("src/lib.rs", "M"), file("src/gone.rs", "D")],
            untracked: vec!["notes.md".to_string(), "assets/".to_string()],
            conflicts: vec!["src/conflict.rs".to_string()],
            current_branch: "main".to_string(),
            ahead: 0,
            behind: 0,
        };
        let changed = vec![GitChangedFile {
            path: "src/new.rs".to_string(),
            old_path: Some("src/old.rs".to_string()),
            status: GitChangedFileStatus::Renamed,
        }];
        let changes = collect_workspace_changes(&status, &changed);
        let summary = changes
            .iter()
            .map(|change| {
                (
                    change.path.as_str(),
                    change.previous_path.as_deref(),
                    change.status.as_str(),
                    change.untracked,
                    change.conflicted,
                )
            })
            .collect::<Vec<_>>();
        assert_eq!(
            summary,
            [
                ("src/lib.rs", None, "modified", false, false),
                ("src/gone.rs", None, "deleted", false, false),
                ("src/new.rs", Some("src/old.rs"), "renamed", false, false),
                ("notes.md", None, "added", true, false),
                ("assets", None, "unknown", true, false),
                ("src/conflict.rs", None, "unknown", false, true),
            ]
        );
    }

    #[test]
    fn requests_accept_intent_or_command_text() {
        let request: LaunchReviewRequest = serde_json::from_value(json!({
            "parentSessionId": "s1",
            "commandText": "/review strict check locking",
            "intent": "review",
        }))
        .unwrap();
        assert_eq!(
            resolve_intent(&request).unwrap(),
            (ReviewLaunchIntent::Strict, "check locking".to_string())
        );
        let request: LaunchReviewRequest = serde_json::from_value(json!({
            "parentSessionId": "s1",
            "focus": "auth",
        }))
        .unwrap();
        assert_eq!(
            resolve_intent(&request).unwrap(),
            (ReviewLaunchIntent::Review, "auth".to_string())
        );
        let request: LaunchReviewRequest = serde_json::from_value(json!({
            "parentSessionId": "s1",
            "commandText": "/compact",
        }))
        .unwrap();
        assert!(resolve_intent(&request).is_err());
    }

    #[test]
    fn refusals_carry_a_code_and_the_planner_sentence() {
        let response = refusal_response(
            ReviewLaunchIntent::Review,
            &ReviewLaunchRefusal::ManagedReviewUnavailable { file_count: 120 },
        );
        let value = serde_json::to_value(&response).unwrap();
        assert_eq!(value["status"], "refused");
        assert_eq!(value["code"], "review_target_too_large");
        assert!(value["message"].as_str().unwrap().contains("120 files"));
        assert_eq!(value["intent"], "review");
        assert!(value.get("childSessionId").is_none());
        assert_eq!(value["fileCount"], 120);
        let scope = serde_json::to_value(refusal_response(
            ReviewLaunchIntent::Review,
            &ReviewLaunchRefusal::EmptyScope {
                paths: vec!["docs".to_string()],
            },
        ))
        .unwrap();
        assert_eq!(scope["paths"], json!(["docs"]));
        let git = git_refusal(
            ReviewLaunchIntent::Strict,
            &GitError::RepositoryNotFound("/tmp/x".to_string()),
        )
        .unwrap();
        assert_eq!(git.code.as_deref(), Some("review_not_git_repository"));
    }

    #[tokio::test]
    async fn untracked_facts_read_text_and_skip_directories() {
        let dir = std::env::temp_dir().join(format!("obf-review-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        std::fs::write(dir.join("a.txt"), "one\ntwo\n").unwrap();
        let fact = untracked_fact(&dir, "a.txt").await;
        assert!(fact.fingerprint.is_some());
        assert_eq!(fact.line_count, Some(2));
        assert_eq!(
            untracked_fact(&dir, "sub").await,
            UntrackedContentFact::default()
        );
        assert_eq!(
            untracked_fact(&dir, "missing").await,
            UntrackedContentFact::default()
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}

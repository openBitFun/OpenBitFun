//! Target-side detached-dispatch adapter for account device RPC.
//!
//! Desktop deliberately delegates execution to the same `openbitfun dispatch`
//! runner used by SSH and CLI Peer Host. This keeps one durable job/session
//! owner and avoids creating a second desktop-only dispatch implementation.

use std::path::{Path, PathBuf};
use std::time::Duration;

use anyhow::{anyhow, Context};
use serde_json::Value;
use tokio::io::AsyncWriteExt;

const TARGET_COMMAND_TIMEOUT: Duration = Duration::from_secs(110);
const MAX_TARGET_RESPONSE_BYTES: usize = 4 * 1024 * 1024;

pub(crate) async fn dispatch(command: &str, args: Value) -> anyhow::Result<Value> {
    let verb = target_cli_verb(command)
        .ok_or_else(|| anyhow!("Unknown detached dispatch target command '{command}'"))?;
    let executable = discover_cli_cached().await.ok_or_else(|| {
        anyhow!(
            "OpenBitFun CLI dispatch runner is not installed on this device; install `openbitfun` in ~/.local/bin or PATH"
        )
    })?;
    let workspace_path = args
        .get("workspacePath")
        .and_then(Value::as_str)
        .map(str::to_string);
    let answer = run_target_verb(executable, command, verb, args).await?;
    // The runner is another process: tell this host's catalog, digest, and prompt poller.
    wake_prompts_poller();
    crate::fleet::dispatch_target_answered(command, workspace_path).await;
    Ok(answer)
}

/// One target verb on the installed runner. Two verbs need this host: a
/// provision from another device's job (`workspace_peer_import_v1`) is pulled
/// over this host's Link connection, and the probe gains that capability
/// when the runner can store the bundle.
async fn run_target_verb(
    executable: PathBuf,
    command: &str,
    verb: &str,
    args: Value,
) -> anyhow::Result<Value> {
    use openbitfun_core::service::dispatch::{
        advertise_peer_import, is_peer_import_provision, peer_import_coordinator,
        MeshDeviceDispatchRpc,
    };
    if is_peer_import_provision(command, &args) {
        return peer_import_coordinator()
            .provision_source(
                std::sync::Arc::new(MeshDeviceDispatchRpc),
                std::sync::Arc::new(CliRunner { executable }),
                args,
            )
            .await;
    }
    let mut answer = invoke_cli(&executable, verb, args).await?;
    if command == "dispatch_target_probe" {
        advertise_peer_import(&mut answer);
    }
    Ok(answer)
}

/// The installed runner, for the peer import coordinator.
struct CliRunner {
    executable: PathBuf,
}

#[async_trait::async_trait]
impl openbitfun_core::service::dispatch::PeerImportLocalRunner for CliRunner {
    async fn run(
        &self,
        verb: openbitfun_core::service::dispatch::PeerImportLocalVerb,
        args: Value,
    ) -> anyhow::Result<Value> {
        use openbitfun_core::service::dispatch::PeerImportLocalVerb as Verb;
        let verb = match verb {
            Verb::ProvisionSource => "__workspace_provision_source",
            Verb::BundleBegin => "__workspace_bundle_begin",
            Verb::BundleChunk => "__workspace_bundle_chunk",
            Verb::PeerImportCommit => "__peer_import_commit",
        };
        invoke_cli(&self.executable, verb, args).await
    }
}

pub(crate) fn is_target_command(command: &str) -> bool {
    target_cli_verb(command).is_some()
}

fn target_cli_verb(command: &str) -> Option<&'static str> {
    match command {
        "dispatch_target_probe" => Some("probe"),
        "dispatch_target_submit" => Some("submit"),
        "dispatch_target_status" => Some("status"),
        "dispatch_target_cancel" => Some("cancel"),
        "dispatch_target_list" => Some("list"),
        "dispatch_target_answer" => Some("answer"),
        "dispatch_target_append" => Some("append"),
        "dispatch_target_continue" => Some("continue"),
        "dispatch_target_query" => Some("query"),
        "dispatch_target_workspace_provision" => Some("__workspace_provision"),
        // `workspace_target_source_v1`: the target resolves the source itself.
        "dispatch_target_workspace_provision_source" => Some("__workspace_provision_source"),
        "dispatch_target_workspace_bundle_begin" => Some("__workspace_bundle_begin"),
        "dispatch_target_workspace_bundle_chunk" => Some("__workspace_bundle_chunk"),
        "dispatch_target_workspace_bundle_commit" => Some("__workspace_bundle_commit"),
        "dispatch_target_workspace_sync" => Some("__workspace_sync"),
        "dispatch_target_workspace_sync_chunk" => Some("__workspace_sync_chunk"),
        // `workspace_publish_v1`.
        "dispatch_target_workspace_publish" => Some("__workspace_publish"),
        _ => None,
    }
}

async fn invoke_cli(executable: &Path, verb: &str, args: Value) -> anyhow::Result<Value> {
    let request = serde_json::to_vec(&args).context("serialize target dispatch request")?;
    let mut child = openbitfun_core::util::process_manager::create_tokio_command(executable)
        .arg("dispatch")
        .arg(verb)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .with_context(|| format!("start dispatch runner {}", executable.display()))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| anyhow!("Dispatch runner stdin was unavailable"))?;
    stdin
        .write_all(&request)
        .await
        .context("write target dispatch request")?;
    stdin.shutdown().await?;
    drop(stdin);

    let output = tokio::time::timeout(TARGET_COMMAND_TIMEOUT, child.wait_with_output())
        .await
        .map_err(|_| anyhow!("Target dispatch command timed out"))?
        .context("wait for target dispatch command")?;
    if output.stdout.len() > MAX_TARGET_RESPONSE_BYTES
        || output.stderr.len() > MAX_TARGET_RESPONSE_BYTES
    {
        anyhow::bail!("Target dispatch response exceeded the 4 MiB safety limit");
    }
    let stdout = std::str::from_utf8(&output.stdout)
        .context("Target dispatch runner returned non-UTF-8 output")?
        .trim();
    let response: Value = serde_json::from_str(stdout).with_context(|| {
        format!(
            "Target dispatch runner returned invalid JSON: {}",
            bounded_text(stdout)
        )
    })?;
    if !output.status.success() {
        let message = response
            .get("error")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| String::from_utf8_lossy(&output.stderr).trim().to_string());
        anyhow::bail!(
            "{}",
            if message.is_empty() {
                "Target dispatch runner failed".to_string()
            } else {
                message
            }
        );
    }
    Ok(response)
}

/// How often the desktop re-reads the dispatch store's pending permissions
/// while this host has at least one live (non-terminal) dispatch job.
const PENDING_PROMPTS_POLL: Duration = Duration::from_secs(15);
/// When no live dispatch jobs exist, the poller parks on `PROMPTS_WAKE` and
/// only re-checks the directory on this slow safety-net cadence (without
/// spawning any CLI process unless a live job appears).
const IDLE_PROMPTS_RECHECK: Duration = Duration::from_secs(300);

static PROMPTS_WAKE: std::sync::OnceLock<tokio::sync::Notify> = std::sync::OnceLock::new();
static CACHED_CLI_PATH: std::sync::OnceLock<std::sync::Mutex<Option<PathBuf>>> =
    std::sync::OnceLock::new();

pub(crate) fn wake_prompts_poller() {
    if let Some(notify) = PROMPTS_WAKE.get() {
        notify.notify_one();
    }
}

/// The Detached Dispatch permission mailbox of this host, for the fleet
/// digest (`dispatch` prompts).
///
/// The dispatch store is owned by the CLI runner, so the desktop reads it out
/// of process (`openbitfun dispatch __pending_prompts`, read-only). The digest
/// reads synchronously, so a background poller keeps a cached answer and
/// pokes the digest when it changes; a host with no live dispatch jobs never
/// spawns the runner and parks until woken.
#[derive(Default)]
pub(crate) struct DesktopDispatchPrompts {
    inner: std::sync::Arc<PromptsInner>,
}

#[derive(Default)]
struct PromptsInner {
    state: std::sync::Mutex<PromptsState>,
    on_change: std::sync::OnceLock<Box<dyn Fn() + Send + Sync>>,
}

#[derive(Default)]
struct PromptsState {
    raw: Value,
    prompts: Vec<openbitfun_core::service::fleet::FleetDispatchPrompt>,
    questions: Vec<openbitfun_core::service::fleet::FleetDispatchQuestion>,
    last_error: Option<String>,
    fetched: bool,
    poller: bool,
}

impl DesktopDispatchPrompts {
    /// Called after a refresh changed the answer (the digest re-reads).
    pub(crate) fn on_change(&self, notify: impl Fn() + Send + Sync + 'static) {
        let _ = self.inner.on_change.set(Box::new(notify));
    }

    fn ensure_poller(&self) {
        let mut state = self.inner.state.lock().unwrap_or_else(|e| e.into_inner());
        if state.poller {
            return;
        }
        let Ok(runtime) = tokio::runtime::Handle::try_current() else {
            return;
        };
        state.poller = true;
        let weak = std::sync::Arc::downgrade(&self.inner);
        let wake = PROMPTS_WAKE.get_or_init(tokio::sync::Notify::new);
        runtime.spawn(async move {
            loop {
                let Some(inner) = weak.upgrade() else {
                    return;
                };
                // Register interest before reading so a wake arriving mid-read is not lost.
                let notified = wake.notified();
                tokio::pin!(notified);
                notified.as_mut().enable();

                let (has_live, outcome) = read_pending_prompts().await;
                let changed = {
                    let mut state = inner.state.lock().unwrap_or_else(|e| e.into_inner());
                    let changed = match outcome {
                        Ok((raw, prompts, questions)) => {
                            let changed = !state.fetched || state.raw != raw;
                            state.raw = raw;
                            state.prompts = prompts;
                            state.questions = questions;
                            state.last_error = None;
                            changed
                        }
                        Err(error) => {
                            let message = format!("{error:#}");
                            let changed = state.last_error.as_deref() != Some(message.as_str());
                            state.last_error = Some(message);
                            changed
                        }
                    };
                    state.fetched = true;
                    changed
                };
                if changed {
                    if let Some(notify) = inner.on_change.get() {
                        notify();
                    }
                }
                drop(inner);
                let sleep_duration = if has_live {
                    PENDING_PROMPTS_POLL
                } else {
                    IDLE_PROMPTS_RECHECK
                };
                tokio::select! {
                    _ = &mut notified => {}
                    _ = tokio::time::sleep(sleep_duration) => {}
                }
            }
        });
    }
}

impl openbitfun_core::service::fleet::FleetDispatchPromptSource for DesktopDispatchPrompts {
    fn pending_dispatch_prompts(
        &self,
    ) -> Result<Vec<openbitfun_core::service::fleet::FleetDispatchPrompt>, String> {
        self.ensure_poller();
        let state = self.inner.state.lock().unwrap_or_else(|e| e.into_inner());
        match (&state.last_error, state.prompts.is_empty()) {
            // A failed refresh keeps the last good answer rather than
            // reporting the prompts as answered.
            (Some(error), true) => Err(error.clone()),
            _ => Ok(state.prompts.clone()),
        }
    }

    fn pending_dispatch_questions(
        &self,
    ) -> Result<Vec<openbitfun_core::service::fleet::FleetDispatchQuestion>, String> {
        self.ensure_poller();
        let state = self.inner.state.lock().unwrap_or_else(|e| e.into_inner());
        Ok(state.questions.clone())
    }
}

type PendingPromptsPayload = (
    Value,
    Vec<openbitfun_core::service::fleet::FleetDispatchPrompt>,
    Vec<openbitfun_core::service::fleet::FleetDispatchQuestion>,
);

/// Inspects `<product_home>/dispatch/jobs` off the Tokio worker pool and
/// returns `true` only if at least one non-terminal (live) job exists.
fn has_live_dispatch_jobs(jobs_dir: &Path) -> bool {
    let Ok(entries) = std::fs::read_dir(jobs_dir) else {
        return false;
    };
    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_dir() {
            continue;
        }
        let job_dir = entry.path();
        if job_dir_is_live(&job_dir) {
            return true;
        }
    }
    false
}

fn job_dir_is_live(job_dir: &Path) -> bool {
    let state_path = job_dir.join("state");
    if let Ok(raw) = std::fs::read(&state_path) {
        #[derive(serde::Deserialize)]
        struct MinimalState {
            #[serde(default)]
            state: String,
        }
        if let Ok(parsed) = serde_json::from_slice::<MinimalState>(&raw) {
            return !matches!(parsed.state.as_str(), "succeeded" | "failed" | "cancelled");
        }
        // Unparseable or in-flight write: conservatively treat as live.
        return true;
    }
    // Before `state` is written, a freshly submitted job holds `preparing` or `job.json`.
    job_dir.join("preparing").exists() || job_dir.join("job.json").exists()
}

async fn discover_cli_cached() -> Option<PathBuf> {
    let cache = CACHED_CLI_PATH.get_or_init(|| std::sync::Mutex::new(None));
    let cached = cache.lock().unwrap_or_else(|e| e.into_inner()).clone();
    if let Some(path) = cached {
        let still_exists = tokio::fs::try_exists(&path).await.unwrap_or(false);
        if still_exists {
            return Some(path);
        }
        *cache.lock().unwrap_or_else(|e| e.into_inner()) = None;
    }
    let discovered = tokio::task::spawn_blocking(discover_cli)
        .await
        .ok()
        .flatten();
    if let Some(ref path) = discovered {
        *cache.lock().unwrap_or_else(|e| e.into_inner()) = Some(path.clone());
    }
    discovered
}

/// One read of the CLI dispatch store's pending permissions and questions.
/// Returns `(has_live_jobs, outcome)`.
async fn read_pending_prompts() -> (bool, anyhow::Result<PendingPromptsPayload>) {
    let jobs = match openbitfun_core::infrastructure::PathManager::new() {
        Ok(pm) => pm.product_home_dir().join("dispatch").join("jobs"),
        Err(error) => {
            return (
                false,
                Err(anyhow!("resolve OpenBitFun storage root: {error}")),
            );
        }
    };
    let has_live = tokio::task::spawn_blocking(move || has_live_dispatch_jobs(&jobs))
        .await
        .unwrap_or(false);
    if !has_live {
        return (
            false,
            Ok((Value::Array(Vec::new()), Vec::new(), Vec::new())),
        );
    }
    let Some(executable) = discover_cli_cached().await else {
        return (
            true,
            Err(anyhow!(
                "OpenBitFun CLI dispatch runner is not installed on this device"
            )),
        );
    };
    let permissions =
        match invoke_cli(&executable, "__pending_prompts", serde_json::json!({})).await {
            Ok(value) => value,
            Err(error) => return (true, Err(error)),
        };
    let prompts = match parse_pending_prompts(&permissions) {
        Ok(prompts) => prompts,
        Err(error) => return (true, Err(error)),
    };
    // An older runner has no question mailbox (and no verb for it): no
    // questions, not an error for the permission half.
    let raw_questions = invoke_cli(&executable, "__pending_questions", serde_json::json!({}))
        .await
        .unwrap_or_else(|error| {
            log::debug!("Dispatch runner without a question mailbox: {error:#}");
            Value::Array(Vec::new())
        });
    let questions = match parse_pending_questions(&raw_questions) {
        Ok(questions) => questions,
        Err(error) => return (true, Err(error)),
    };
    let raw = serde_json::json!({ "permissions": permissions, "questions": raw_questions });
    (true, Ok((raw, prompts, questions)))
}

fn parse_pending_questions(
    raw: &Value,
) -> anyhow::Result<Vec<openbitfun_core::service::fleet::FleetDispatchQuestion>> {
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Entry {
        job_id: String,
        #[serde(default)]
        session_id: String,
        #[serde(default)]
        workspace_path: String,
        question: Question,
    }
    // Read tolerantly (the runner's `DispatchPendingQuestion`).
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase", default)]
    #[derive(Default)]
    struct Question {
        request_id: String,
        session_id: String,
        title: String,
        questions: Value,
        registered_at_ms: u64,
    }
    let entries: Vec<Entry> =
        serde_json::from_value(raw.clone()).context("decode dispatch pending questions")?;
    Ok(entries
        .into_iter()
        .filter(|entry| !entry.question.request_id.is_empty())
        .map(
            |entry| openbitfun_core::service::fleet::FleetDispatchQuestion {
                job_id: entry.job_id,
                session_id: if entry.question.session_id.is_empty() {
                    entry.session_id
                } else {
                    entry.question.session_id
                },
                workspace_path: entry.workspace_path,
                title: entry.question.title,
                request_id: entry.question.request_id,
                questions: entry.question.questions,
                registered_at_ms: entry.question.registered_at_ms,
            },
        )
        .collect())
}

fn parse_pending_prompts(
    raw: &Value,
) -> anyhow::Result<Vec<openbitfun_core::service::fleet::FleetDispatchPrompt>> {
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Entry {
        job_id: String,
        #[serde(default)]
        session_id: String,
        #[serde(default)]
        workspace_path: String,
        #[serde(default)]
        title: String,
        request: openbitfun_product_domains::tool_permissions::PermissionRequest,
    }
    let entries: Vec<Entry> =
        serde_json::from_value(raw.clone()).context("decode dispatch pending prompts")?;
    Ok(entries
        .into_iter()
        .map(
            |entry| openbitfun_core::service::fleet::FleetDispatchPrompt {
                job_id: entry.job_id,
                session_id: entry.session_id,
                workspace_path: entry.workspace_path,
                title: entry.title,
                request: entry.request,
            },
        )
        .collect())
}

fn discover_cli() -> Option<PathBuf> {
    let executable_name = if cfg!(windows) {
        "openbitfun.exe"
    } else {
        "openbitfun"
    };
    let mut candidates = Vec::new();
    if let Some(home) = dirs::home_dir() {
        candidates.push(home.join(".local").join("bin").join(executable_name));
    }
    if let Ok(current) = std::env::current_exe() {
        if let Some(parent) = current.parent() {
            candidates.push(parent.join(executable_name));
        }
    }
    if let Some(path) = std::env::var_os("PATH") {
        candidates
            .extend(std::env::split_paths(&path).map(|directory| directory.join(executable_name)));
    }
    candidates.into_iter().find_map(resolve_cli_candidate)
}

fn resolve_cli_candidate(candidate: PathBuf) -> Option<PathBuf> {
    let canonical = candidate.canonicalize().ok()?;
    std::fs::symlink_metadata(&canonical)
        .is_ok_and(|metadata| !metadata.file_type().is_symlink() && metadata.is_file())
        .then_some(canonical)
}

fn bounded_text(value: &str) -> String {
    const MAX_CHARS: usize = 240;
    let mut result = value.chars().take(MAX_CHARS).collect::<String>();
    if value.chars().count() > MAX_CHARS {
        result.push_str("...");
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn outbound_controller_commands_are_not_target_commands() {
        assert!(is_target_command("dispatch_target_status"));
        assert!(!is_target_command("dispatch_status"));
        assert!(!is_target_command("account_device_rpc"));
    }

    /// The registry marks every `dispatch_target_*` name as host control plane
    /// (routed to the dispatch runner before the peer bridge); this table must
    /// answer exactly that family, no more and no less.
    #[test]
    fn target_command_family_matches_registry() {
        use openbitfun_product_domains::remote_surface::{operations, PeerStance};
        for op in operations() {
            let registry_says_target = op.id.starts_with("dispatch_target_");
            assert_eq!(
                is_target_command(op.id),
                registry_says_target,
                "{} target-command classification disagrees with the registry",
                op.id
            );
            if registry_says_target {
                assert_eq!(op.peer, PeerStance::HostControlPlane, "{}", op.id);
            }
        }
    }

    #[test]
    fn source_provision_is_a_target_command() {
        assert_eq!(
            target_cli_verb(
                openbitfun_services_core::dispatch_contract::DISPATCH_TARGET_PROVISION_SOURCE_COMMAND
            ),
            Some("__workspace_provision_source")
        );
    }

    #[test]
    fn pending_questions_parse_the_cli_answer() {
        let raw = serde_json::json!([{
            "jobId": "job-1", "sessionId": "session-1", "workspacePath": "/w", "title": "Task",
            "question": {
                "requestId": "tool-1", "sessionId": "", "title": "Which?",
                "questions": {"questions": [{"question": "Which?", "header": "Pick", "options": []}]},
                "registeredAtMs": 7, "newerField": 1
            }
        }]);
        let questions = parse_pending_questions(&raw).expect("parse");
        assert_eq!(questions.len(), 1);
        assert_eq!(questions[0].request_id, "tool-1");
        assert_eq!(questions[0].session_id, "session-1");
        assert_eq!(questions[0].registered_at_ms, 7);
        assert!(parse_pending_questions(&serde_json::json!([]))
            .unwrap()
            .is_empty());
    }

    #[test]
    fn pending_prompts_parse_the_cli_answer() {
        use openbitfun_product_domains::tool_permissions::{
            PermissionRequest, PermissionRequestSource, PermissionRequestSourceKind,
        };
        let request = PermissionRequest {
            request_id: "permission-1".to_string(),
            round_id: "round-1".to_string(),
            order: 0,
            tool_call_id: None,
            project_path: None,
            project_id: "project-1".to_string(),
            session_id: "session-1".to_string(),
            agent_id: "agentic".to_string(),
            action: "write".to_string(),
            resources: vec!["src/main.rs".to_string()],
            save_resources: Vec::new(),
            source: PermissionRequestSource {
                kind: PermissionRequestSourceKind::ToolCall,
                identity: "Write".to_string(),
            },
            delegation: None,
            display_metadata: serde_json::Map::new(),
        };
        let raw = serde_json::json!([{
            "jobId": "job-1", "sessionId": "session-1", "workspacePath": "/w",
            "title": "Task", "request": request, "newerField": true
        }]);
        let prompts = parse_pending_prompts(&raw).expect("parse");
        assert_eq!(prompts.len(), 1);
        assert_eq!(prompts[0].job_id, "job-1");
        assert_eq!(prompts[0].request.request_id, "permission-1");
        assert!(parse_pending_prompts(&serde_json::json!([]))
            .unwrap()
            .is_empty());
        assert!(parse_pending_prompts(&serde_json::json!({"error": "x"})).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn cli_discovery_accepts_a_symlink_to_a_regular_binary() {
        use std::os::unix::fs::symlink;

        let temp = tempfile::tempdir().expect("tempdir");
        let binary = temp.path().join("openbitfun-real");
        std::fs::write(&binary, b"binary").expect("binary");
        let link = temp.path().join("openbitfun");
        symlink(&binary, &link).expect("symlink");

        assert_eq!(
            resolve_cli_candidate(link),
            Some(binary.canonicalize().expect("canonical binary"))
        );
    }

    #[test]
    fn has_live_dispatch_jobs_ignores_historical_terminal_jobs() {
        let temp = tempfile::tempdir().expect("tempdir");
        let jobs = temp.path();
        assert!(!has_live_dispatch_jobs(jobs));

        for (id, state) in [
            ("job-done", "succeeded"),
            ("job-fail", "failed"),
            ("job-cancel", "cancelled"),
        ] {
            let dir = jobs.join(id);
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(dir.join("job.json"), "{}").unwrap();
            std::fs::write(dir.join("state"), format!(r#"{{"state":"{state}"}}"#)).unwrap();
        }
        assert!(
            !has_live_dispatch_jobs(jobs),
            "terminal historical job directories must not wake the CLI poller"
        );

        let preparing = jobs.join("job-preparing");
        std::fs::create_dir_all(&preparing).unwrap();
        std::fs::write(preparing.join("preparing"), "").unwrap();
        assert!(has_live_dispatch_jobs(jobs));
        std::fs::remove_dir_all(&preparing).unwrap();

        let running = jobs.join("job-running");
        std::fs::create_dir_all(&running).unwrap();
        std::fs::write(running.join("state"), r#"{"state":"running"}"#).unwrap();
        assert!(has_live_dispatch_jobs(jobs));
    }
}

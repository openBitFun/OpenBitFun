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
    let executable = discover_cli().ok_or_else(|| {
        anyhow!(
            "OpenBitFun CLI dispatch runner is not installed on this device; install `openbitfun` in ~/.local/bin or PATH"
        )
    })?;
    let workspace_path = args
        .get("workspacePath")
        .and_then(Value::as_str)
        .map(str::to_string);
    let answer = invoke_cli(&executable, verb, args).await?;
    // The runner is another process: tell this host's catalog and digest.
    crate::fleet::dispatch_target_answered(command, workspace_path).await;
    Ok(answer)
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
/// while this host has dispatch jobs at all.
const PENDING_PROMPTS_POLL: Duration = Duration::from_secs(15);

/// The Detached Dispatch permission mailbox of this host, for the fleet
/// digest (`dispatch` prompts).
///
/// The dispatch store is owned by the CLI runner, so the desktop reads it out
/// of process (`openbitfun dispatch __pending_prompts`, read-only). The digest
/// reads synchronously, so a background poller keeps a cached answer and
/// pokes the digest when it changes; a host with no dispatch jobs never
/// spawns the runner.
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
        runtime.spawn(async move {
            loop {
                let Some(inner) = weak.upgrade() else {
                    return;
                };
                let outcome = read_pending_prompts().await;
                let changed = {
                    let mut state = inner.state.lock().unwrap_or_else(|e| e.into_inner());
                    let changed = match outcome {
                        Ok((raw, prompts)) => {
                            let changed = !state.fetched || state.raw != raw;
                            state.raw = raw;
                            state.prompts = prompts;
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
                tokio::time::sleep(PENDING_PROMPTS_POLL).await;
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
}

/// One read of the CLI dispatch store's pending permissions.
async fn read_pending_prompts() -> anyhow::Result<(
    Value,
    Vec<openbitfun_core::service::fleet::FleetDispatchPrompt>,
)> {
    let jobs = openbitfun_core::infrastructure::PathManager::new()
        .map_err(|error| anyhow!("resolve OpenBitFun storage root: {error}"))?
        .product_home_dir()
        .join("dispatch")
        .join("jobs");
    let has_jobs = std::fs::read_dir(&jobs)
        .map(|mut entries| entries.any(|entry| entry.is_ok_and(|entry| entry.path().is_dir())))
        .unwrap_or(false);
    if !has_jobs {
        return Ok((Value::Array(Vec::new()), Vec::new()));
    }
    let executable = discover_cli()
        .ok_or_else(|| anyhow!("OpenBitFun CLI dispatch runner is not installed on this device"))?;
    let raw = invoke_cli(&executable, "__pending_prompts", serde_json::json!({})).await?;
    let prompts = parse_pending_prompts(&raw)?;
    Ok((raw, prompts))
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
}

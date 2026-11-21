//! Target-resolved job sources (`workspace_target_source_v1`).
//!
//! A controller with no checkout of its own (the account's cloud superagent)
//! cannot prepare a baseline the way `workspace-provision` expects. Instead it
//! names a source and this target resolves it:
//!
//! - a workspace of this device, by its fleet workspace id, looked up in this
//!   device's own workspace catalog — never a path from the wire;
//! - a network Git remote, fetched with this device's own credentials, with any
//!   credential embedded in the URL stripped first.
//!
//! Either way the source is pinned to one commit, the resolution is recorded
//! per job so every poll and retry provisions the same baseline, and the
//! existing worktree provisioning (shared clone, job branch, detached Git
//! worker) does the rest.

use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant};

use anyhow::{bail, Context, Result};
use openbitfun_services_core::dispatch_contract::strip_remote_url_credentials;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::protocol::{
    DispatchProvisionSource, DispatchWorkspaceProbe, DispatchWorkspaceProvisionRequest,
    DispatchWorkspaceProvisionResponse, DispatchWorkspaceProvisionSourceRequest,
    DispatchWorkspaceProvisionSourceResponse, DISPATCH_PROTOCOL_VERSION,
};
use super::store::{atomic_write_json, create_private_dir, read_json, DispatchStore, JobLock};
use super::workspace::{
    git, git_command, kill_process_tree, remote_basename, truncate_utf8, validate_branch,
    validate_remote_url,
};

const SOURCE_RECORD_FILE: &str = "source.json";
const SOURCE_LOCK_FILE: &str = "source.lock";
const WORKSPACE_CATALOG_FILE: &str = "workspace_data.json";
const MAX_WORKSPACE_ID_BYTES: usize = 128;
const MAX_REF_BYTES: usize = 255;
/// `ls-remote` lists refs only; a remote that cannot answer that quickly will
/// not serve the fetch either.
const LS_REMOTE_TIMEOUT: Duration = Duration::from_secs(60);
const LS_REMOTE_MAX_BYTES: usize = 4 * 1024 * 1024;

/// One record of this device's workspace catalog, read tolerantly: only the
/// fields resolution needs, so a newer catalog with more fields still reads.
#[derive(Clone, Debug, Deserialize)]
struct CatalogRecord {
    #[serde(default)]
    id: String,
    #[serde(default)]
    name: String,
    #[serde(rename = "rootPath", default)]
    root_path: Option<PathBuf>,
    #[serde(rename = "workspaceKind", default)]
    workspace_kind: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize)]
struct CatalogFile {
    #[serde(default)]
    workspaces: HashMap<String, CatalogRecord>,
}

/// A catalog workspace resolved to a local directory.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct CatalogWorkspace {
    pub(super) id: String,
    pub(super) name: String,
    pub(super) root: PathBuf,
}

/// The catalog the desktop and CLI workspace services persist (read only).
pub(super) fn default_workspace_catalog() -> Result<PathBuf> {
    let path_manager = openbitfun_core::infrastructure::PathManager::new()
        .map_err(|error| anyhow::anyhow!("resolve OpenBitFun storage root: {error}"))?;
    Ok(path_manager.user_data_dir().join(WORKSPACE_CATALOG_FILE))
}

pub(super) fn validate_workspace_id(workspace_id: &str) -> Result<()> {
    if workspace_id.is_empty()
        || workspace_id.len() > MAX_WORKSPACE_ID_BYTES
        || workspace_id.starts_with('-')
        || !workspace_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
    {
        bail!("dispatch workspaceId must be 1-{MAX_WORKSPACE_ID_BYTES} bytes of [A-Za-z0-9._:-]");
    }
    Ok(())
}

/// Resolve a fleet workspace id through this device's own catalog.
///
/// Only a workspace the user opened on this device resolves, and only to the
/// root the catalog recorded for it. Remote (SSH) workspaces belong to another
/// machine and are refused rather than resolved to a local path.
pub(super) fn resolve_catalog_workspace(
    catalog: &Path,
    workspace_id: &str,
) -> Result<CatalogWorkspace> {
    validate_workspace_id(workspace_id)?;
    let not_found =
        || anyhow::anyhow!("workspace '{workspace_id}' is not in this device's workspace catalog");
    let raw = match std::fs::read_to_string(catalog) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Err(not_found()),
        Err(error) => {
            return Err(error).with_context(|| format!("read {}", catalog.display()));
        }
    };
    let file: CatalogFile = serde_json::from_str(&raw)
        .with_context(|| format!("decode the workspace catalog {}", catalog.display()))?;
    let record = file
        .workspaces
        .get(workspace_id)
        .filter(|record| record.id == workspace_id)
        .ok_or_else(not_found)?;
    if record
        .workspace_kind
        .as_deref()
        .is_some_and(|kind| kind.eq_ignore_ascii_case("remote"))
    {
        bail!(
            "workspace '{workspace_id}' is a remote workspace; it is not a dispatch source on this device"
        );
    }
    let root = record.root_path.clone().ok_or_else(not_found)?;
    if !root.is_absolute() {
        bail!("workspace '{workspace_id}' has no absolute root in the catalog");
    }
    let root = root.canonicalize().with_context(|| {
        format!("workspace '{workspace_id}' root no longer exists on this device")
    })?;
    if !root.is_dir() {
        bail!("workspace '{workspace_id}' root is not a directory");
    }
    Ok(CatalogWorkspace {
        id: workspace_id.to_string(),
        name: record.name.clone(),
        root,
    })
}

/// The facts a probe by `workspaceId` adds to the usual workspace probe.
pub(super) fn probe_repository_facts(
    mut probe: DispatchWorkspaceProbe,
    workspace: &CatalogWorkspace,
) -> DispatchWorkspaceProbe {
    probe.workspace_id = Some(workspace.id.clone());
    probe.name = Some(workspace.name.clone()).filter(|name| !name.trim().is_empty());
    if probe.is_git_repository && probe.trust_required != Some(true) {
        probe.head_commit = git(&workspace.root, &["rev-parse", "--verify", "HEAD^{commit}"])
            .ok()
            .map(|head| head.trim().to_string())
            .filter(|head| is_full_commit(head));
        probe.remote_url = git(&workspace.root, &["remote", "get-url", "origin"])
            .ok()
            .map(|url| strip_remote_url_credentials(url.trim()))
            .filter(|url| !url.is_empty());
    }
    probe
}

fn is_full_commit(value: &str) -> bool {
    value.len() == 40 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn validate_git_ref(git_ref: &str) -> Result<()> {
    if git_ref.is_empty() || git_ref.len() > MAX_REF_BYTES || git_ref.starts_with('-') {
        bail!("dispatch source ref is outside the accepted range");
    }
    if !git_ref
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'/' | b'-' | b'_' | b'.'))
        || git_ref.contains("..")
        || git_ref.ends_with('/')
        || git_ref.ends_with(".lock")
    {
        bail!("dispatch source ref must be a plain branch, tag or commit id");
    }
    Ok(())
}

/// A remote source must name a network remote. A path, `file://` URL or
/// anything else that reads this device's disk would turn the remote kind into
/// the arbitrary-path source this verb exists to refuse.
fn validate_network_remote(url: &str) -> Result<()> {
    validate_remote_url(url)?;
    let lower = url.to_ascii_lowercase();
    if let Some((scheme, rest)) = lower.split_once("://") {
        if !matches!(
            scheme,
            "https" | "http" | "ssh" | "git" | "git+ssh" | "ssh+git"
        ) {
            bail!("dispatch remote sources must use https, http, ssh or git URLs");
        }
        if rest.is_empty() || rest.starts_with('/') {
            bail!("dispatch remote source URL has no host");
        }
        return Ok(());
    }
    // scp-like `[user@]host:path`: Git reads it as SSH when no '/' comes
    // before the first ':'. A one-letter host is a Windows drive, not a host.
    match url.split_once(':') {
        Some((host, path))
            if host.rsplit('@').next().is_some_and(|name| name.len() > 1)
                && !host.contains('/')
                && !host.contains('\\')
                && !host.starts_with('.')
                && !host.starts_with('~')
                && !path.is_empty() =>
        {
            Ok(())
        }
        _ => bail!("dispatch remote sources must be network Git remotes, not paths"),
    }
}

fn repo_key(kind: &str, location: &str) -> String {
    let digest = Sha256::digest(format!("{kind}\n{location}").as_bytes());
    format!("{digest:x}").chars().take(32).collect()
}

/// The recorded resolution of one job's source. Written once, then reused.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct SourceRecord {
    request: DispatchWorkspaceProvisionSourceRequest,
    provision: DispatchWorkspaceProvisionRequest,
    #[serde(default)]
    source_ref: Option<String>,
    /// The remote as reported (credentials stripped); for a remote source
    /// it is also the URL used.
    #[serde(default)]
    remote_url: Option<String>,
    #[serde(default)]
    source_dirty: Option<bool>,
    resolved_at: String,
}

fn validate_source_request(request: &DispatchWorkspaceProvisionSourceRequest) -> Result<()> {
    if request.protocol_version != DISPATCH_PROTOCOL_VERSION {
        bail!(
            "unsupported dispatch protocolVersion {}; target requires {}",
            request.protocol_version,
            DISPATCH_PROTOCOL_VERSION
        );
    }
    super::store::validate_id("jobId", &request.job_id)?;
    validate_branch(&request.branch)?;
    match &request.source {
        DispatchProvisionSource::Workspace {
            workspace_id,
            git_ref,
        } => {
            validate_workspace_id(workspace_id)?;
            if let Some(git_ref) = git_ref {
                validate_git_ref(git_ref)?;
            }
        }
        DispatchProvisionSource::Remote {
            remote_url,
            git_ref,
        } => {
            validate_network_remote(&strip_remote_url_credentials(remote_url))?;
            validate_git_ref(git_ref)?;
        }
    }
    Ok(())
}

fn resolve_source(
    catalog: &Path,
    request: &DispatchWorkspaceProvisionSourceRequest,
) -> Result<SourceRecord> {
    let (provision, source_ref, remote_url, source_dirty) = match &request.source {
        DispatchProvisionSource::Workspace {
            workspace_id,
            git_ref,
        } => {
            let workspace = resolve_catalog_workspace(catalog, workspace_id)?;
            let top = git(&workspace.root, &["rev-parse", "--show-toplevel"])
                .with_context(|| format!("workspace '{workspace_id}' is not a Git repository"))?;
            let top = PathBuf::from(top.trim())
                .canonicalize()
                .context("resolve the workspace repository root")?;
            let wanted = git_ref.as_deref().unwrap_or("HEAD");
            let commit = git(
                &top,
                &[
                    "rev-parse",
                    "--verify",
                    "--quiet",
                    &format!("{wanted}^{{commit}}"),
                ],
            )
            .with_context(|| format!("ref '{wanted}' does not name a commit in '{workspace_id}'"))?
            .trim()
            .to_string();
            if !is_full_commit(&commit) {
                bail!("ref '{wanted}' did not resolve to a commit in '{workspace_id}'");
            }
            let dirty = git(&top, &["status", "--porcelain"])
                .ok()
                .map(|status| !status.trim().is_empty());
            let reported_remote = git(&top, &["remote", "get-url", "origin"])
                .ok()
                .map(|url| strip_remote_url_credentials(url.trim()))
                .filter(|url| !url.is_empty());
            let location = top.to_string_lossy().to_string();
            let label = Some(workspace.name.clone())
                .filter(|name| !name.trim().is_empty())
                .or_else(|| {
                    top.file_name()
                        .map(|name| name.to_string_lossy().to_string())
                });
            (
                DispatchWorkspaceProvisionRequest {
                    protocol_version: request.protocol_version,
                    job_id: request.job_id.clone(),
                    repo_key: repo_key("workspace", &location),
                    // The shared clone fetches the pinned commit from the
                    // user's own checkout; the checkout itself is never
                    // touched (no ref, worktree or hook of it changes).
                    remote_url: Some(location),
                    project_label: label,
                    base_commit: commit,
                    branch: request.branch.clone(),
                },
                Some(wanted.to_string()),
                reported_remote,
                dirty,
            )
        }
        DispatchProvisionSource::Remote {
            remote_url,
            git_ref,
        } => {
            let url = strip_remote_url_credentials(remote_url);
            validate_network_remote(&url)?;
            let commit = if is_full_commit(git_ref) {
                git_ref.to_ascii_lowercase()
            } else {
                let listing = git_stdout_within(
                    &std::env::temp_dir(),
                    LS_REMOTE_TIMEOUT,
                    &["ls-remote", "--", &url, git_ref, &format!("{git_ref}^{{}}")],
                )
                .context("list the source remote's refs")?;
                pick_remote_ref(&listing, git_ref).ok_or_else(|| {
                    anyhow::anyhow!("the source remote has no branch or tag named '{git_ref}'")
                })?
            };
            (
                DispatchWorkspaceProvisionRequest {
                    protocol_version: request.protocol_version,
                    job_id: request.job_id.clone(),
                    repo_key: repo_key("remote", &url),
                    remote_url: Some(url.clone()),
                    project_label: Some(remote_basename(&url)).filter(|label| !label.is_empty()),
                    base_commit: commit,
                    branch: request.branch.clone(),
                },
                Some(git_ref.clone()),
                Some(url),
                None,
            )
        }
    };
    Ok(SourceRecord {
        request: request.clone(),
        provision,
        source_ref,
        remote_url,
        source_dirty,
        resolved_at: chrono::Utc::now().to_rfc3339(),
    })
}

/// Pick the commit `git_ref` names from `git ls-remote` output: a branch,
/// then a tag (peeled to its commit), then an exact full ref name or `HEAD`.
pub(super) fn pick_remote_ref(listing: &str, git_ref: &str) -> Option<String> {
    let entries: Vec<(&str, &str)> = listing
        .lines()
        .filter_map(|line| line.split_once('\t'))
        .map(|(sha, name)| (sha.trim(), name.trim()))
        .filter(|(sha, _)| is_full_commit(sha))
        .collect();
    let find = |name: &str| {
        entries
            .iter()
            .find(|(_, candidate)| *candidate == name)
            .map(|(sha, _)| sha.to_ascii_lowercase())
    };
    find(&format!("refs/heads/{git_ref}"))
        .or_else(|| find(&format!("refs/tags/{git_ref}^{{}}")))
        .or_else(|| find(&format!("refs/tags/{git_ref}")))
        .or_else(|| find(git_ref))
}

/// Run git with a deadline and return its stdout (bounded).
fn git_stdout_within(dir: &Path, timeout: Duration, args: &[&str]) -> Result<String> {
    let mut command = git_command(dir);
    command
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    std::os::unix::process::CommandExt::process_group(&mut command, 0);
    let mut child = command
        .spawn()
        .with_context(|| format!("run git {}", args.first().copied().unwrap_or_default()))?;
    let mut stdout = child.stdout.take();
    let mut stderr = child.stderr.take();
    let out = std::thread::spawn(move || {
        let mut captured = Vec::new();
        if let Some(pipe) = stdout.as_mut() {
            let _ = pipe
                .take(LS_REMOTE_MAX_BYTES as u64 + 1)
                .read_to_end(&mut captured);
        }
        captured
    });
    let err = std::thread::spawn(move || {
        let mut captured = String::new();
        if let Some(pipe) = stderr.as_mut() {
            let _ = pipe.read_to_string(&mut captured);
        }
        captured
    });
    let deadline = Instant::now() + timeout;
    let status = loop {
        if let Some(status) = child.try_wait().context("wait for git")? {
            break status;
        }
        if Instant::now() >= deadline {
            kill_process_tree(&mut child);
            bail!(
                "git {} did not finish within {} seconds",
                args[0],
                timeout.as_secs()
            );
        }
        std::thread::sleep(Duration::from_millis(100));
    };
    let stdout = out.join().unwrap_or_default();
    let stderr = err.join().unwrap_or_default();
    if !status.success() {
        bail!("git {} failed: {}", args[0], truncate_utf8(stderr.trim()));
    }
    if stdout.len() > LS_REMOTE_MAX_BYTES {
        bail!("git {} output exceeded the safety limit", args[0]);
    }
    Ok(String::from_utf8_lossy(&stdout).to_string())
}

/// `dispatch_target_workspace_provision_source` on the default store.
pub(crate) fn provision_source(
    request: DispatchWorkspaceProvisionSourceRequest,
) -> Result<DispatchWorkspaceProvisionSourceResponse> {
    let store = DispatchStore::open_default()?;
    let catalog = default_workspace_catalog()?;
    provision_source_in_store(&store, &catalog, request, |_, provision| {
        super::workspace::provision(provision)
    })
}

pub(super) fn provision_source_in_store(
    store: &DispatchStore,
    catalog: &Path,
    request: DispatchWorkspaceProvisionSourceRequest,
    provision: impl FnOnce(
        &DispatchStore,
        DispatchWorkspaceProvisionRequest,
    ) -> Result<DispatchWorkspaceProvisionResponse>,
) -> Result<DispatchWorkspaceProvisionSourceResponse> {
    validate_source_request(&request)?;
    let job_dir = store.workspace_upload_dir(&request.job_id)?;
    create_private_dir(&job_dir)?;
    let record = {
        let _lock = JobLock::exclusive(&job_dir.join(SOURCE_LOCK_FILE))?;
        let record_path = job_dir.join(SOURCE_RECORD_FILE);
        if record_path.exists() {
            let existing: SourceRecord = read_json(&record_path)?;
            if existing.request != request {
                bail!("dispatch job is already bound to a different source");
            }
            existing
        } else {
            let resolved = resolve_source(catalog, &request)?;
            atomic_write_json(&record_path, &resolved)?;
            resolved
        }
    };
    let response = provision(store, record.provision.clone())?;
    if response.needs_bundle {
        let detail = response
            .fetch_error
            .as_deref()
            .map(|error| format!(": {error}"))
            .unwrap_or_default();
        bail!(
            "the target could not fetch source commit {} for this job{detail}",
            record.provision.base_commit
        );
    }
    Ok(DispatchWorkspaceProvisionSourceResponse {
        pending: response.pending,
        provisioned: response.provisioned,
        workspace_path: response.workspace_path,
        base_commit: record.provision.base_commit,
        branch: record.provision.branch,
        source_ref: record.source_ref,
        remote_url: record.remote_url,
        source_dirty: record.source_dirty,
        fetch_error: response.fetch_error,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn init_repository(path: &Path) -> String {
        fs::create_dir_all(path).expect("source directory");
        git(path, &["init", "--quiet"]).expect("init");
        git(path, &["symbolic-ref", "HEAD", "refs/heads/main"]).expect("branch");
        git(path, &["config", "user.email", "dispatch@example.com"]).expect("email");
        git(path, &["config", "user.name", "Dispatch Test"]).expect("name");
        fs::write(path.join("file.txt"), b"base").expect("seed");
        git(path, &["add", "-A"]).expect("stage");
        git(path, &["commit", "--quiet", "-m", "base"]).expect("commit");
        git(path, &["rev-parse", "HEAD"])
            .expect("head")
            .trim()
            .to_string()
    }

    fn write_catalog(path: &Path, records: serde_json::Value) {
        fs::write(
            path,
            serde_json::to_vec(&serde_json::json!({
                "format_version": 1,
                "workspaces": records,
                "opened_workspace_ids": [],
                "current_workspace_id": null,
                "saved_at": "2026-01-01T00:00:00Z",
                "a_newer_field": {"ignored": true}
            }))
            .unwrap(),
        )
        .unwrap();
    }

    fn record(id: &str, root: &Path, kind: &str) -> serde_json::Value {
        serde_json::json!({
            "id": id, "name": "My App", "rootPath": root, "workspaceKind": kind,
            "workspaceType": "Other", "status": "Active", "languages": [],
            "openedAt": "2026-01-01T00:00:00Z", "lastAccessed": "2026-01-01T00:00:00Z",
            "description": null, "tags": [], "statistics": null, "metadata": {}
        })
    }

    fn source_request(
        job_id: &str,
        source: DispatchProvisionSource,
    ) -> DispatchWorkspaceProvisionSourceRequest {
        DispatchWorkspaceProvisionSourceRequest {
            protocol_version: DISPATCH_PROTOCOL_VERSION,
            job_id: job_id.to_string(),
            source,
            branch: format!("openbitfun/dispatch/{job_id}"),
        }
    }

    #[test]
    fn a_catalog_workspace_provisions_a_pinned_worktree() {
        let temp = tempfile::tempdir().expect("tempdir");
        let source = temp.path().join("app");
        let base = init_repository(&source);
        // Uncommitted work is reported, not carried.
        fs::write(source.join("file.txt"), b"edited").unwrap();
        let catalog = temp.path().join("workspace_data.json");
        write_catalog(
            &catalog,
            serde_json::json!({"local_app": record("local_app", &source, "normal")}),
        );
        let store = DispatchStore::open(temp.path().join("dispatch")).expect("store");
        let request = source_request(
            "job-src-1",
            DispatchProvisionSource::Workspace {
                workspace_id: "local_app".into(),
                git_ref: None,
            },
        );

        let response =
            provision_source_in_store(&store, &catalog, request.clone(), |store, provision| {
                super::super::workspace::provision_in_store(store, provision)
            })
            .expect("provision from the catalog workspace");
        assert!(response.provisioned);
        assert_eq!(response.base_commit, base);
        assert_eq!(response.source_ref.as_deref(), Some("HEAD"));
        assert_eq!(response.source_dirty, Some(true));
        let worktree = PathBuf::from(response.workspace_path.clone().expect("worktree path"));
        assert_ne!(worktree, source.canonicalize().unwrap());
        assert_eq!(fs::read(worktree.join("file.txt")).unwrap(), b"base");
        assert_eq!(git(&worktree, &["rev-parse", "HEAD"]).unwrap().trim(), base);

        // A new commit in the source after resolution does not move the job.
        fs::write(source.join("file.txt"), b"second").unwrap();
        git(&source, &["commit", "--quiet", "-am", "second"]).unwrap();
        let again =
            provision_source_in_store(&store, &catalog, request.clone(), |store, provision| {
                super::super::workspace::provision_in_store(store, provision)
            })
            .expect("idempotent poll");
        assert_eq!(again.base_commit, base);
        assert_eq!(again.workspace_path, response.workspace_path);

        // The same job cannot be rebound to another source.
        let mut other = request;
        other.source = DispatchProvisionSource::Workspace {
            workspace_id: "local_app".into(),
            git_ref: Some("main".into()),
        };
        assert!(provision_source_in_store(&store, &catalog, other, |_, _| unreachable!()).is_err());

        // The user's checkout gained no ref and no worktree.
        let refs = git(&source, &["for-each-ref", "--format=%(refname)"]).unwrap();
        assert_eq!(refs.trim(), "refs/heads/main");
        let worktrees = git(&source, &["worktree", "list", "--porcelain"]).unwrap();
        assert_eq!(worktrees.matches("worktree ").count(), 1);
    }

    #[test]
    fn only_catalog_workspaces_resolve() {
        let temp = tempfile::tempdir().expect("tempdir");
        let source = temp.path().join("app");
        init_repository(&source);
        let catalog = temp.path().join("workspace_data.json");
        write_catalog(
            &catalog,
            serde_json::json!({
                "local_app": record("local_app", &source, "normal"),
                "remote_x": record("remote_x", Path::new("/srv/x"), "remote"),
                "local_gone": record("local_gone", &temp.path().join("gone"), "normal"),
                "local_mismatch": record("local_other", &source, "normal")
            }),
        );
        assert!(resolve_catalog_workspace(&catalog, "local_app").is_ok());
        for id in [
            "remote_x",
            "local_gone",
            "local_mismatch",
            "local_missing",
            "../etc",
            "/etc",
        ] {
            assert!(resolve_catalog_workspace(&catalog, id).is_err(), "{id}");
        }
        assert!(resolve_catalog_workspace(&temp.path().join("absent.json"), "local_app").is_err());
    }

    #[test]
    fn remote_sources_must_be_network_remotes_and_lose_credentials() {
        for url in [
            "/home/user/secret",
            "file:///home/user/secret",
            "./relative",
            "~/repo",
            "C:\\repo",
            "D:/repo",
            "ext::sh -c id",
            "-uoops",
        ] {
            let request = source_request(
                "job-r",
                DispatchProvisionSource::Remote {
                    remote_url: url.into(),
                    git_ref: "main".into(),
                },
            );
            assert!(validate_source_request(&request).is_err(), "{url}");
        }
        for url in [
            "https://github.com/acme/app.git",
            "ssh://git@host/app.git",
            "git@github.com:acme/app.git",
            "buildhost:repos/app.git",
        ] {
            assert!(validate_network_remote(url).is_ok(), "{url}");
        }

        let temp = tempfile::tempdir().expect("tempdir");
        let request = source_request(
            "job-r2",
            DispatchProvisionSource::Remote {
                remote_url: "https://user:ghp_secret@github.com/acme/app.git".into(),
                git_ref: "a".repeat(40),
            },
        );
        let record = resolve_source(&temp.path().join("none.json"), &request).unwrap();
        assert_eq!(
            record.provision.remote_url.as_deref(),
            Some("https://github.com/acme/app.git")
        );
        assert_eq!(
            record.remote_url.as_deref(),
            Some("https://github.com/acme/app.git")
        );
        assert_eq!(record.provision.project_label.as_deref(), Some("app"));
        assert!(!serde_json::to_string(&record.provision)
            .unwrap()
            .contains("ghp_secret"));
    }

    #[test]
    fn ls_remote_output_picks_branch_then_peeled_tag() {
        let listing = format!(
            "{a}\trefs/heads/main\n{b}\trefs/tags/v1\n{c}\trefs/tags/v1^{{}}\n{d}\tHEAD\n",
            a = "a".repeat(40),
            b = "b".repeat(40),
            c = "c".repeat(40),
            d = "d".repeat(40)
        );
        assert_eq!(pick_remote_ref(&listing, "main"), Some("a".repeat(40)));
        assert_eq!(pick_remote_ref(&listing, "v1"), Some("c".repeat(40)));
        assert_eq!(pick_remote_ref(&listing, "HEAD"), Some("d".repeat(40)));
        assert_eq!(pick_remote_ref(&listing, "missing"), None);
    }

    #[test]
    fn hostile_refs_are_refused() {
        for git_ref in ["--upload-pack=x", "a..b", "main/", "x.lock", "a b", ""] {
            assert!(validate_git_ref(git_ref).is_err(), "{git_ref}");
        }
        assert!(validate_git_ref("feature/x-1.2").is_ok());
    }
}

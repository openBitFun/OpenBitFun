//! Compound Git workbench operations owned by the backend.
//!
//! Each operation used to be assembled by the client from several primitive
//! commands (unstage then restore, push then retry with `-u`, add + commit then
//! checkout, read a file to fake an untracked diff). Every client re-implemented
//! the sequence differently, and a remote controller paid one round trip per
//! step. These functions decide the sequence once, over a [`GitCommandRunner`],
//! so a local repository and a repository on an SSH host follow the same rules.
//!
//! Paths given by callers are repository-relative (as `git status` reports
//! them) or absolute paths inside the working tree. Relative paths are passed
//! to Git as `:(top,literal)` pathspecs, so a file name with glob characters or
//! a workspace opened in a repository subdirectory cannot widen the operation.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};

use super::error::GitError;
use super::types::{GitCommandOutput, GitDiffParams, GitOperationResult};
use super::utils::execute_git_command_raw;

/// Runs one Git invocation in a repository and returns its raw output.
#[async_trait]
pub trait GitCommandRunner: Send + Sync {
    async fn run(&self, args: &[String]) -> Result<GitCommandOutput, GitError>;
}

/// Runs Git in a local repository directory.
pub struct LocalGitRunner {
    repository_path: String,
}

impl LocalGitRunner {
    pub fn new(repository_path: impl Into<String>) -> Self {
        Self {
            repository_path: repository_path.into(),
        }
    }
}

#[async_trait]
impl GitCommandRunner for LocalGitRunner {
    async fn run(&self, args: &[String]) -> Result<GitCommandOutput, GitError> {
        let refs: Vec<&str> = args.iter().map(String::as_str).collect();
        execute_git_command_raw(&self.repository_path, &refs).await
    }
}

fn failure_text(output: &GitCommandOutput) -> String {
    let text = if output.stderr.trim().is_empty() {
        output.stdout.trim()
    } else {
        output.stderr.trim()
    };
    if text.is_empty() {
        format!("git exited with code {}", output.exit_code)
    } else {
        text.to_string()
    }
}

async fn run_ok(runner: &dyn GitCommandRunner, args: Vec<String>) -> Result<String, GitError> {
    let output = runner.run(&args).await?;
    if output.exit_code == 0 {
        Ok(output.stdout)
    } else {
        Err(GitError::CommandFailed(failure_text(&output)))
    }
}

fn args<const N: usize>(items: [&str; N]) -> Vec<String> {
    items.iter().map(|item| item.to_string()).collect()
}

fn is_absolute_path(path: &str) -> bool {
    path.starts_with('/')
        || path.starts_with('\\')
        || (path.len() > 2
            && path.as_bytes()[1] == b':'
            && path.as_bytes()[0].is_ascii_alphabetic())
}

/// A caller path as a pathspec that matches exactly that path.
pub fn literal_pathspec(path: &str) -> String {
    if is_absolute_path(path) {
        path.to_string()
    } else {
        format!(":(top,literal){}", path.trim_start_matches("./"))
    }
}

fn clean_paths(files: &[String]) -> Vec<String> {
    let mut seen = std::collections::BTreeSet::new();
    files
        .iter()
        .map(|file| file.trim())
        .filter(|file| !file.is_empty())
        .filter(|file| seen.insert(file.to_string()))
        .map(str::to_string)
        .collect()
}

fn result(data: serde_json::Value, output: String, started: Instant) -> GitOperationResult {
    GitOperationResult {
        success: true,
        data: Some(data),
        error: None,
        output: Some(output),
        duration: Some(started.elapsed().as_millis() as u64),
    }
}

// ── Status porcelain ────────────────────────────────────────────────

/// One entry of `git status --porcelain=v1 -z`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PorcelainEntry {
    pub index: char,
    pub worktree: char,
    pub path: String,
    /// The source path of a rename or copy.
    pub original_path: Option<String>,
}

impl PorcelainEntry {
    pub fn is_untracked(&self) -> bool {
        self.index == '?' && self.worktree == '?'
    }

    pub fn is_unmerged(&self) -> bool {
        matches!(
            (self.index, self.worktree),
            ('U', _) | (_, 'U') | ('A', 'A') | ('D', 'D')
        )
    }
}

/// Parses `git status --porcelain=v1 -z` (without `--branch`).
pub fn parse_porcelain_z(output: &str) -> Vec<PorcelainEntry> {
    let mut entries = Vec::new();
    let mut fields = output.split('\0').filter(|field| !field.is_empty());
    while let Some(field) = fields.next() {
        if field.len() < 4 || field.starts_with("##") {
            continue;
        }
        let mut chars = field.chars();
        let index = chars.next().unwrap_or(' ');
        let worktree = chars.next().unwrap_or(' ');
        let path = field[3..].to_string();
        let original_path = if matches!(index, 'R' | 'C') || matches!(worktree, 'R' | 'C') {
            fields.next().map(str::to_string)
        } else {
            None
        };
        entries.push(PorcelainEntry {
            index,
            worktree,
            path,
            original_path,
        });
    }
    entries
}

async fn status_entries(
    runner: &dyn GitCommandRunner,
    files: &[String],
) -> Result<Vec<PorcelainEntry>, GitError> {
    let mut command = args(["status", "--porcelain=v1", "-z"]);
    if !files.is_empty() {
        command.push("--".to_string());
        command.extend(files.iter().map(|file| literal_pathspec(file)));
    }
    Ok(parse_porcelain_z(&run_ok(runner, command).await?))
}

// ── Discard ─────────────────────────────────────────────────────────

/// What discarding a set of paths does to each of them.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiscardPlan {
    /// Tracked paths restored to `HEAD` in the index and the working tree.
    pub restore: Vec<String>,
    /// Paths added in the index but absent from `HEAD`: removed.
    pub remove_added: Vec<String>,
    /// Untracked files and directories: deleted (needs `include_untracked`).
    pub delete_untracked: Vec<String>,
    /// Requested paths with nothing to discard.
    pub unchanged: Vec<String>,
}

/// Classifies the requested paths from a status read.
pub fn plan_discard(requested: &[String], entries: &[PorcelainEntry]) -> GitDiscardPlan {
    let mut plan = GitDiscardPlan::default();
    let normalize = |path: &str| {
        path.trim_start_matches("./")
            .trim_end_matches('/')
            .to_string()
    };
    let mut matched = std::collections::BTreeSet::new();
    for entry in entries {
        if entry.is_untracked() {
            plan.delete_untracked.push(entry.path.clone());
        } else if let Some(original) = &entry.original_path {
            // A staged rename: the new path goes, the old one comes back.
            plan.remove_added.push(entry.path.clone());
            plan.restore.push(original.clone());
            matched.insert(normalize(original));
        } else if entry.index == 'A' && !entry.is_unmerged() {
            plan.remove_added.push(entry.path.clone());
        } else {
            plan.restore.push(entry.path.clone());
        }
        matched.insert(normalize(&entry.path));
    }
    for path in requested {
        let key = normalize(path);
        let covered = matched
            .iter()
            .any(|entry| entry == &key || entry.starts_with(&format!("{key}/")));
        if !covered && !is_absolute_path(path) {
            plan.unchanged.push(path.clone());
        }
    }
    plan
}

/// Discards the working-tree and index changes of `files`.
///
/// Tracked paths are restored to `HEAD`; paths only added in the index are
/// removed. Untracked paths are deleted only when `include_untracked` is set,
/// and refused otherwise, so a caller cannot delete user files by accident.
pub async fn discard_files(
    runner: &dyn GitCommandRunner,
    files: &[String],
    include_untracked: bool,
) -> Result<GitOperationResult, GitError> {
    let started = Instant::now();
    let files = clean_paths(files);
    if files.is_empty() {
        return Err(GitError::CommandFailed("No files to discard".to_string()));
    }
    let entries = status_entries(runner, &files).await?;
    let plan = plan_discard(&files, &entries);
    if !include_untracked && !plan.delete_untracked.is_empty() {
        return Err(GitError::CommandFailed(format!(
            "Refusing to delete untracked files without includeUntracked: {}",
            plan.delete_untracked.join(", ")
        )));
    }
    let mut output = String::new();
    if !plan.restore.is_empty() {
        let mut command = args(["restore", "--source=HEAD", "--staged", "--worktree", "--"]);
        command.extend(plan.restore.iter().map(|path| literal_pathspec(path)));
        output.push_str(&run_ok(runner, command).await?);
    }
    if !plan.remove_added.is_empty() {
        let mut command = args(["rm", "-f", "-q", "--"]);
        command.extend(plan.remove_added.iter().map(|path| literal_pathspec(path)));
        output.push_str(&run_ok(runner, command).await?);
    }
    if !plan.delete_untracked.is_empty() {
        // `clean` never touches tracked or ignored files, whatever the path.
        let mut command = args(["clean", "-f", "-d", "--"]);
        command.extend(
            plan.delete_untracked
                .iter()
                .map(|path| literal_pathspec(path)),
        );
        output.push_str(&run_ok(runner, command).await?);
    }
    let data = serde_json::to_value(&plan).unwrap_or_default();
    Ok(result(data, output, started))
}

// ── Push ────────────────────────────────────────────────────────────

/// Plain `git push` arguments from the legacy push params.
pub fn push_args(
    remote: Option<&str>,
    branch: Option<&str>,
    force: bool,
    set_upstream: bool,
) -> Vec<String> {
    let mut command = vec!["push".to_string()];
    if force {
        command.push("--force".to_string());
    }
    if set_upstream {
        command.push("-u".to_string());
    }
    if let Some(remote) = remote.filter(|value| !value.trim().is_empty()) {
        command.push(remote.to_string());
    }
    if let Some(branch) = branch.filter(|value| !value.trim().is_empty()) {
        command.push(branch.to_string());
    }
    command
}

/// The remote a new branch is published to: `origin` when it exists,
/// otherwise the only remote. Several remotes without `origin` are ambiguous.
pub fn choose_publish_remote(remotes_output: &str) -> Result<String, GitError> {
    let remotes: Vec<&str> = remotes_output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect();
    if remotes.contains(&"origin") {
        return Ok("origin".to_string());
    }
    match remotes.as_slice() {
        [only] => Ok((*only).to_string()),
        [] => Err(GitError::CommandFailed(
            "This repository has no remote to publish the branch to".to_string(),
        )),
        _ => Err(GitError::CommandFailed(format!(
            "Choose a remote to publish the branch to: {}",
            remotes.join(", ")
        ))),
    }
}

/// Request for [`push`].
#[derive(Debug, Clone, Default)]
pub struct GitPushPlan {
    pub remote: Option<String>,
    pub branch: Option<String>,
    pub force: bool,
    pub set_upstream: bool,
    /// Publish the current branch (`push -u <remote> <branch>`) when it has
    /// no upstream and the caller named neither remote nor branch.
    pub publish_if_no_upstream: bool,
    pub timeout: Option<Duration>,
}

async fn run_push(
    runner: &dyn GitCommandRunner,
    command: Vec<String>,
    timeout: Option<Duration>,
) -> Result<String, GitError> {
    match timeout {
        Some(limit) => tokio::time::timeout(limit, run_ok(runner, command))
            .await
            .map_err(|_| GitError::NetworkError("Push operation timed out".to_string()))?,
        None => run_ok(runner, command).await,
    }
}

/// Pushes, publishing a branch that has no upstream when asked to.
pub async fn push(
    runner: &dyn GitCommandRunner,
    plan: GitPushPlan,
) -> Result<GitOperationResult, GitError> {
    let started = Instant::now();
    let names_target = plan.remote.as_deref().is_some_and(|v| !v.trim().is_empty())
        || plan.branch.as_deref().is_some_and(|v| !v.trim().is_empty());
    if plan.publish_if_no_upstream && !names_target && !plan.set_upstream {
        let upstream = runner
            .run(&args([
                "rev-parse",
                "--abbrev-ref",
                "--symbolic-full-name",
                "@{u}",
            ]))
            .await?;
        if upstream.exit_code != 0 {
            let branch = run_ok(runner, args(["symbolic-ref", "--short", "-q", "HEAD"]))
                .await
                .map(|value| value.trim().to_string())
                .map_err(|_| {
                    GitError::CommandFailed(
                        "HEAD is detached; check out a branch before publishing".to_string(),
                    )
                })?;
            if branch.is_empty() {
                return Err(GitError::CommandFailed(
                    "HEAD is detached; check out a branch before publishing".to_string(),
                ));
            }
            let remote = choose_publish_remote(&run_ok(runner, args(["remote"])).await?)?;
            let command = push_args(Some(&remote), Some(&branch), plan.force, true);
            let output = run_push(runner, command, plan.timeout).await?;
            return Ok(result(
                serde_json::json!({
                    "remote": remote,
                    "branch": branch,
                    "force": plan.force,
                    "set_upstream": true,
                    "published": true,
                }),
                output,
                started,
            ));
        }
    }
    let command = push_args(
        plan.remote.as_deref(),
        plan.branch.as_deref(),
        plan.force,
        plan.set_upstream,
    );
    let output = run_push(runner, command, plan.timeout).await?;
    Ok(result(
        serde_json::json!({
            "remote": plan.remote,
            "branch": plan.branch,
            "force": plan.force,
            "set_upstream": plan.set_upstream,
            "published": false,
        }),
        output,
        started,
    ))
}

// ── Commit and checkout ─────────────────────────────────────────────

/// Commit the given (or already staged) changes, then switch branches.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitAndCheckoutParams {
    pub message: String,
    /// Paths staged before the commit (usually the files that blocked the
    /// checkout). Empty commits what is already staged.
    #[serde(default)]
    pub files: Vec<String>,
    pub target_branch: String,
    /// Creates `target_branch` from this start point (a remote-tracking
    /// branch checks out as a local branch that tracks it).
    #[serde(default)]
    pub start_point: Option<String>,
    #[serde(default)]
    pub no_verify: Option<bool>,
}

const CHECKOUT_OVERWRITE_HEADERS: &[(&str, &str)] = &[
    (
        "tracked",
        "your local changes to the following files would be overwritten by checkout:",
    ),
    (
        "untracked",
        "the following untracked working tree files would be overwritten by checkout:",
    ),
];

/// Reads Git's (C-locale) checkout diagnostic: which files block the switch.
pub fn parse_checkout_overwrite_failure(error: &str) -> Option<(&'static str, Vec<String>)> {
    let text = error.replace("\r\n", "\n");
    let lines: Vec<&str> = text.split('\n').collect();
    let (header_index, kind) = lines.iter().enumerate().find_map(|(index, line)| {
        let lower = line.to_lowercase();
        CHECKOUT_OVERWRITE_HEADERS
            .iter()
            .find(|(_, header)| lower.contains(header))
            .map(|(kind, _)| (index, *kind))
    })?;
    let mut files = Vec::new();
    for line in &lines[header_index + 1..] {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let lower = trimmed.to_lowercase();
        if lower.starts_with("please ")
            || lower.starts_with("aborting")
            || lower.starts_with("error:")
            || lower.starts_with("fatal:")
        {
            break;
        }
        if !files.iter().any(|file| file == trimmed) {
            files.push(trimmed.to_string());
        }
    }
    Some((kind, files))
}

pub const UNRESOLVED_CONFLICTS_MESSAGE: &str =
    "Resolve the merge conflicts in the working copy before switching branches.";

/// Stages `files`, commits, then checks out the target branch, as one
/// operation. Refuses before committing when the index has unresolved
/// conflicts. A checkout that still fails after the commit returns
/// `success: false` with `data.committed = true` and the blocking files, so
/// the caller never loses track of the commit it just made.
pub async fn commit_and_checkout(
    runner: &dyn GitCommandRunner,
    params: GitCommitAndCheckoutParams,
) -> Result<GitOperationResult, GitError> {
    let started = Instant::now();
    let message = params.message.trim().to_string();
    let target = params.target_branch.trim().to_string();
    if message.is_empty() {
        return Err(GitError::CommandFailed(
            "A commit message is required".to_string(),
        ));
    }
    if target.is_empty() {
        return Err(GitError::CommandFailed(
            "A target branch is required".to_string(),
        ));
    }
    let entries = status_entries(runner, &[]).await?;
    if entries.iter().any(PorcelainEntry::is_unmerged) {
        return Err(GitError::CommandFailed(
            UNRESOLVED_CONFLICTS_MESSAGE.to_string(),
        ));
    }
    let files = clean_paths(&params.files);
    let mut output = String::new();
    if !files.is_empty() {
        let mut command = args(["add", "--"]);
        command.extend(files.iter().map(|path| literal_pathspec(path)));
        output.push_str(&run_ok(runner, command).await?);
    }
    let mut command = vec!["commit".to_string(), "-m".to_string(), message.clone()];
    if params.no_verify.unwrap_or(false) {
        command.push("--no-verify".to_string());
    }
    output.push_str(&run_ok(runner, command).await?);
    let commit = run_ok(runner, args(["rev-parse", "HEAD"]))
        .await
        .map(|value| value.trim().to_string())
        .unwrap_or_default();

    let start_point = params
        .start_point
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let checkout = match start_point {
        Some(start) => vec![
            "checkout".to_string(),
            "-b".to_string(),
            target.clone(),
            start.to_string(),
        ],
        None => vec!["checkout".to_string(), target.clone()],
    };
    let switched = runner.run(&checkout).await?;
    if switched.exit_code != 0 {
        let failure = failure_text(&switched);
        let blocking = parse_checkout_overwrite_failure(&failure);
        return Ok(GitOperationResult {
            success: false,
            data: Some(serde_json::json!({
                "committed": true,
                "commit": commit,
                "branch": target,
                "blockingKind": blocking.as_ref().map(|(kind, _)| *kind),
                "blockingFiles": blocking.map(|(_, files)| files).unwrap_or_default(),
            })),
            error: Some(failure),
            output: Some(output),
            duration: Some(started.elapsed().as_millis() as u64),
        });
    }
    output.push_str(&switched.stdout);
    Ok(result(
        serde_json::json!({
            "committed": true,
            "commit": commit,
            "branch": target,
        }),
        output,
        started,
    ))
}

// ── Untracked diff ──────────────────────────────────────────────────

/// An untracked file larger than this is not drawn as additions.
pub const UNTRACKED_PATCH_LIMIT: usize = 512 * 1024;

/// Whether a working-tree diff request should also describe untracked paths:
/// an unstaged diff of named files, not a revision range or a stat.
pub fn diff_covers_untracked(
    files: Option<&[String]>,
    staged: bool,
    has_revision: bool,
    stat: bool,
) -> bool {
    !staged && !has_revision && !stat && files.is_some_and(|files| !files.is_empty())
}

/// Patches that show each untracked file among `files` as all additions,
/// the shape `git diff` gives a newly added file.
pub async fn untracked_file_patches(
    runner: &dyn GitCommandRunner,
    files: &[String],
) -> Result<String, GitError> {
    let files = clean_paths(files);
    if files.is_empty() {
        return Ok(String::new());
    }
    let mut command = args(["ls-files", "--others", "--exclude-standard", "-z", "--"]);
    command.extend(files.iter().map(|path| literal_pathspec(path)));
    let listed = run_ok(runner, command).await?;
    let mut patches = String::new();
    for path in listed.split('\0').filter(|path| !path.is_empty()) {
        let output = runner
            .run(&args([
                "diff",
                "--no-index",
                "--no-color",
                "--no-ext-diff",
                "--no-textconv",
                "--",
                "/dev/null",
                path,
            ]))
            .await?;
        // `--no-index` exits 1 when the files differ, which is the normal case.
        if output.exit_code > 1 {
            return Err(GitError::CommandFailed(failure_text(&output)));
        }
        if output.stdout.len() > UNTRACKED_PATCH_LIMIT {
            patches.push_str(&format!(
                "diff --git a/{path} b/{path}\nnew file mode 100644\n--- /dev/null\n+++ b/{path}\n"
            ));
            continue;
        }
        patches.push_str(&output.stdout);
    }
    Ok(patches)
}

/// Appends untracked-file patches to a working-tree diff of named files
/// (`git diff` alone says nothing about a file it does not track). Revision
/// ranges, staged diffs, stats and review-safe reads are returned unchanged.
pub async fn append_untracked_patches(
    runner: &dyn GitCommandRunner,
    params: &GitDiffParams,
    mut diff: String,
) -> Result<String, GitError> {
    let has_revision = params.source.is_some() || params.target.is_some();
    if params.review_safe.unwrap_or(false)
        || !diff_covers_untracked(
            params.files.as_deref(),
            params.staged.unwrap_or(false),
            has_revision,
            params.stat.unwrap_or(false),
        )
    {
        return Ok(diff);
    }
    let patches =
        untracked_file_patches(runner, params.files.as_deref().unwrap_or_default()).await?;
    if !patches.is_empty() {
        if !diff.is_empty() && !diff.ends_with('\n') {
            diff.push('\n');
        }
        diff.push_str(&patches);
    }
    Ok(diff)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    #[test]
    fn porcelain_reads_renames_and_untracked() {
        let entries = parse_porcelain_z(" M a.txt\0R  c.txt\0b.txt\0?? d/\0A  n.txt\0UU m.txt\0");
        assert_eq!(entries.len(), 5);
        assert_eq!(entries[1].original_path.as_deref(), Some("b.txt"));
        assert!(entries[2].is_untracked());
        assert!(entries[4].is_unmerged());
    }

    #[test]
    fn discard_plan_classifies_each_path() {
        let entries = parse_porcelain_z(" M a.txt\0R  c.txt\0b.txt\0?? d/\0A  n.txt\0UU m.txt\0");
        let requested: Vec<String> = ["a.txt", "c.txt", "d/", "n.txt", "m.txt", "gone.txt"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        let plan = plan_discard(&requested, &entries);
        assert_eq!(plan.restore, vec!["a.txt", "b.txt", "m.txt"]);
        assert_eq!(plan.remove_added, vec!["c.txt", "n.txt"]);
        assert_eq!(plan.delete_untracked, vec!["d/"]);
        assert_eq!(plan.unchanged, vec!["gone.txt"]);
    }

    #[test]
    fn pathspecs_are_literal_and_root_relative() {
        assert_eq!(literal_pathspec("src/[a].ts"), ":(top,literal)src/[a].ts");
        assert_eq!(literal_pathspec("./x"), ":(top,literal)x");
        assert_eq!(literal_pathspec("/repo/x"), "/repo/x");
        assert_eq!(literal_pathspec("C:\\repo\\x"), "C:\\repo\\x");
    }

    #[test]
    fn publish_remote_prefers_origin() {
        assert_eq!(
            choose_publish_remote("upstream\norigin\n").unwrap(),
            "origin"
        );
        assert_eq!(choose_publish_remote("fork\n").unwrap(), "fork");
        assert!(choose_publish_remote("").is_err());
        assert!(choose_publish_remote("a\nb\n").is_err());
    }

    #[test]
    fn checkout_overwrite_failure_lists_blocking_files() {
        let error = "error: Your local changes to the following files would be overwritten by checkout:\n\tsrc/a.ts\n\tsrc/b.ts\nPlease commit your changes or stash them before you switch branches.\nAborting";
        let (kind, files) = parse_checkout_overwrite_failure(error).unwrap();
        assert_eq!(kind, "tracked");
        assert_eq!(files, vec!["src/a.ts", "src/b.ts"]);
        assert!(parse_checkout_overwrite_failure("fatal: other").is_none());
    }

    #[test]
    fn untracked_diff_applies_to_unstaged_file_diffs_only() {
        let files = vec!["a".to_string()];
        assert!(diff_covers_untracked(Some(&files), false, false, false));
        assert!(!diff_covers_untracked(Some(&files), true, false, false));
        assert!(!diff_covers_untracked(Some(&files), false, true, false));
        assert!(!diff_covers_untracked(None, false, false, false));
    }

    /// Scripted runner: answers by the first argument, records every call.
    struct Scripted {
        calls: Mutex<Vec<Vec<String>>>,
        answer: fn(&[String]) -> GitCommandOutput,
    }

    #[async_trait]
    impl GitCommandRunner for Scripted {
        async fn run(&self, args: &[String]) -> Result<GitCommandOutput, GitError> {
            self.calls.lock().unwrap().push(args.to_vec());
            Ok((self.answer)(args))
        }
    }

    fn ok(stdout: &str) -> GitCommandOutput {
        GitCommandOutput {
            stdout: stdout.to_string(),
            stderr: String::new(),
            exit_code: 0,
        }
    }

    fn fail(stderr: &str, code: i32) -> GitCommandOutput {
        GitCommandOutput {
            stdout: String::new(),
            stderr: stderr.to_string(),
            exit_code: code,
        }
    }

    #[tokio::test]
    async fn push_publishes_a_branch_without_upstream() {
        let runner = Scripted {
            calls: Mutex::new(Vec::new()),
            answer: |args| match args[0].as_str() {
                "rev-parse" => fail("fatal: no upstream configured", 128),
                "symbolic-ref" => ok("feat/x\n"),
                "remote" => ok("origin\n"),
                _ => ok("pushed"),
            },
        };
        let outcome = push(
            &runner,
            GitPushPlan {
                publish_if_no_upstream: true,
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(outcome.data.unwrap()["published"], true);
        let calls = runner.calls.lock().unwrap();
        assert_eq!(
            calls.last().unwrap(),
            &args(["push", "-u", "origin", "feat/x"])
        );
    }

    #[tokio::test]
    async fn push_without_publish_flag_keeps_the_legacy_command() {
        let runner = Scripted {
            calls: Mutex::new(Vec::new()),
            answer: |_| ok(""),
        };
        push(&runner, GitPushPlan::default()).await.unwrap();
        assert_eq!(runner.calls.lock().unwrap().as_slice(), &[args(["push"])]);
    }

    #[tokio::test]
    async fn commit_and_checkout_refuses_on_conflicts() {
        let runner = Scripted {
            calls: Mutex::new(Vec::new()),
            answer: |_| ok("UU m.txt\0"),
        };
        let error = commit_and_checkout(
            &runner,
            GitCommitAndCheckoutParams {
                message: "wip".into(),
                target_branch: "main".into(),
                ..Default::default()
            },
        )
        .await
        .unwrap_err();
        assert!(error.to_string().contains("merge conflicts"));
        assert_eq!(runner.calls.lock().unwrap().len(), 1, "nothing committed");
    }

    async fn git(runner: &LocalGitRunner, items: &[&str]) -> String {
        let command: Vec<String> = items.iter().map(|item| item.to_string()).collect();
        run_ok(runner, command).await.expect("git fixture command")
    }

    #[tokio::test]
    async fn local_repository_discard_diff_and_commit_and_checkout() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let runner = LocalGitRunner::new(root.to_string_lossy());
        git(&runner, &["init", "-q", "-b", "main"]).await;
        git(&runner, &["config", "user.email", "t@example.com"]).await;
        git(&runner, &["config", "user.name", "t"]).await;
        std::fs::write(root.join("a.txt"), "a\n").unwrap();
        std::fs::write(root.join("b.txt"), "b\n").unwrap();
        git(&runner, &["add", "."]).await;
        git(&runner, &["commit", "-q", "-m", "init"]).await;

        // Untracked file diff is drawn as additions.
        std::fs::write(root.join("[u].txt"), "new line\n").unwrap();
        let params = GitDiffParams {
            files: Some(vec!["[u].txt".into()]),
            ..Default::default()
        };
        let diff = append_untracked_patches(&runner, &params, String::new())
            .await
            .unwrap();
        assert!(diff.contains("+new line"), "{diff}");
        assert!(diff.contains("new file mode"), "{diff}");

        // Discard: modified, staged, staged-new and (consented) untracked.
        std::fs::write(root.join("a.txt"), "a2\n").unwrap();
        std::fs::write(root.join("b.txt"), "b2\n").unwrap();
        std::fs::write(root.join("n.txt"), "n\n").unwrap();
        git(&runner, &["add", "b.txt", "n.txt"]).await;
        let files: Vec<String> = ["a.txt", "b.txt", "n.txt", "[u].txt"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        assert!(discard_files(&runner, &files, false).await.is_err());
        discard_files(&runner, &files, true).await.unwrap();
        assert_eq!(git(&runner, &["status", "--porcelain"]).await, "");
        assert_eq!(std::fs::read_to_string(root.join("a.txt")).unwrap(), "a\n");
        assert!(!root.join("n.txt").exists());

        // Commit & switch: the blocking change is committed, then the switch runs.
        git(&runner, &["checkout", "-q", "-b", "other"]).await;
        std::fs::write(root.join("a.txt"), "other\n").unwrap();
        git(&runner, &["commit", "-q", "-am", "other"]).await;
        git(&runner, &["checkout", "-q", "main"]).await;
        std::fs::write(root.join("a.txt"), "main wip\n").unwrap();
        let outcome = commit_and_checkout(
            &runner,
            GitCommitAndCheckoutParams {
                message: "wip".into(),
                files: vec!["a.txt".into()],
                target_branch: "other".into(),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert!(outcome.success, "{outcome:?}");
        assert_eq!(
            git(&runner, &["symbolic-ref", "--short", "HEAD"])
                .await
                .trim(),
            "other"
        );
        assert_eq!(
            git(&runner, &["log", "-1", "--format=%s", "main"])
                .await
                .trim(),
            "wip"
        );
    }

    #[tokio::test]
    async fn discard_refuses_untracked_without_consent() {
        let runner = Scripted {
            calls: Mutex::new(Vec::new()),
            answer: |_| ok("?? u.txt\0"),
        };
        let error = discard_files(&runner, &["u.txt".to_string()], false)
            .await
            .unwrap_err();
        assert!(error.to_string().contains("includeUntracked"));
        assert_eq!(runner.calls.lock().unwrap().len(), 1, "nothing deleted");
    }
}

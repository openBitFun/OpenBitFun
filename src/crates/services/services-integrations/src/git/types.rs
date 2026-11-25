/**
 * Git-related type definitions
 */
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct GitRepository {
    pub path: String,
    pub name: String,
    pub current_branch: String,
    pub is_bare: bool,
    pub has_changes: bool,
    pub remotes: Vec<String>,
}

/// The working-tree state of a repository.
///
/// Serializes with a derived `fingerprint` field (see [`GitStatus::fingerprint`])
/// so clients can tell an unchanged status apart without comparing the whole
/// payload. The field is computed from the content on every write and ignored
/// on read, so it can never disagree with the status it describes, and payloads
/// written without it (older hosts) still deserialize.
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct GitStatus {
    pub staged: Vec<GitFileStatus>,
    pub unstaged: Vec<GitFileStatus>,
    pub untracked: Vec<String>,
    #[serde(default)]
    pub conflicts: Vec<String>,
    pub current_branch: String,
    pub ahead: i32,
    pub behind: i32,
}

/// 64-bit FNV-1a over a length-prefixed encoding of every status field.
///
/// Stable across processes, platforms and Rust versions (unlike `std`'s
/// hasher), so a status read on one host and one read on another compare.
struct StatusHasher(u64);

impl StatusHasher {
    const OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
    const PRIME: u64 = 0x0000_0100_0000_01b3;

    fn bytes(&mut self, bytes: &[u8]) {
        for byte in bytes {
            self.0 ^= u64::from(*byte);
            self.0 = self.0.wrapping_mul(Self::PRIME);
        }
    }

    fn u64(&mut self, value: u64) {
        self.bytes(&value.to_le_bytes());
    }

    fn str(&mut self, value: &str) {
        self.u64(value.len() as u64);
        self.bytes(value.as_bytes());
    }

    fn opt_str(&mut self, value: Option<&str>) {
        match value {
            Some(value) => {
                self.bytes(&[1]);
                self.str(value);
            }
            None => self.bytes(&[0]),
        }
    }

    fn files(&mut self, files: &[GitFileStatus]) {
        self.u64(files.len() as u64);
        for file in files {
            self.str(&file.path);
            self.str(&file.status);
            self.opt_str(file.index_status.as_deref());
            self.opt_str(file.workdir_status.as_deref());
        }
    }

    fn strings(&mut self, values: &[String]) {
        self.u64(values.len() as u64);
        for value in values {
            self.str(value);
        }
    }
}

impl GitStatus {
    /// A stable 64-bit hash of the whole status (files, conflicts, branch,
    /// ahead/behind): equal statuses share it, and any change of a field
    /// changes it. Order-sensitive, like the lists themselves.
    pub fn fingerprint_u64(&self) -> u64 {
        let mut hasher = StatusHasher(StatusHasher::OFFSET);
        hasher.files(&self.staged);
        hasher.files(&self.unstaged);
        hasher.strings(&self.untracked);
        hasher.strings(&self.conflicts);
        hasher.str(&self.current_branch);
        hasher.u64(i64::from(self.ahead) as u64);
        hasher.u64(i64::from(self.behind) as u64);
        hasher.0
    }

    /// [`Self::fingerprint_u64`] as 16 hex digits: a string on the wire, since a
    /// 64-bit number does not survive a JavaScript `number`.
    pub fn fingerprint(&self) -> String {
        format!("{:016x}", self.fingerprint_u64())
    }
}

impl Serialize for GitStatus {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        #[derive(Serialize)]
        struct Wire<'a> {
            staged: &'a [GitFileStatus],
            unstaged: &'a [GitFileStatus],
            untracked: &'a [String],
            conflicts: &'a [String],
            current_branch: &'a str,
            ahead: i32,
            behind: i32,
            fingerprint: String,
        }
        Wire {
            staged: &self.staged,
            unstaged: &self.unstaged,
            untracked: &self.untracked,
            conflicts: &self.conflicts,
            current_branch: &self.current_branch,
            ahead: self.ahead,
            behind: self.behind,
            fingerprint: self.fingerprint(),
        }
        .serialize(serializer)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct GitFileStatus {
    pub path: String,
    pub status: String,
    pub index_status: Option<String>,
    pub workdir_status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct GitBranch {
    pub name: String,
    pub current: bool,
    pub remote: bool,
    pub upstream: Option<String>,
    pub ahead: i32,
    pub behind: i32,
    pub last_commit: Option<String>,
    pub last_commit_date: Option<String>,

    pub base_branch: Option<String>,
    pub child_branches: Option<Vec<String>>,
    pub merged_branches: Option<Vec<String>>,

    pub branch_type: Option<String>,
    pub has_conflicts: Option<bool>,
    pub can_merge: Option<bool>,
    pub is_stale: Option<bool>,
    pub merge_status: Option<String>,

    pub stats: Option<GitBranchStats>,
    pub created_at: Option<String>,
    pub last_activity_at: Option<String>,

    pub tags: Option<Vec<String>>,
    pub description: Option<String>,
    pub linked_issues: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct GitBranchStats {
    pub commit_count: i32,
    pub contributor_count: i32,
    pub file_changes: i32,
    pub lines_changed: GitLinesChanged,
    pub activity_score: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ts", derive(ts_rs::TS), ts(export))]
pub struct GitLinesChanged {
    pub additions: i32,
    pub deletions: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitCommit {
    pub hash: String,
    pub short_hash: String,
    pub message: String,
    pub author: String,
    pub author_email: String,
    pub date: String,
    pub parents: Vec<String>,
    pub additions: Option<i32>,
    pub deletions: Option<i32>,
    pub files_changed: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct GitLogParams {
    pub max_count: Option<i32>,
    pub skip: Option<i32>,
    pub author: Option<String>,
    pub grep: Option<String>,
    pub since: Option<String>,
    pub until: Option<String>,
    pub stat: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitAddParams {
    pub files: Vec<String>,
    pub all: Option<bool>,
    pub update: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitCommitParams {
    pub message: String,
    pub amend: Option<bool>,
    pub all: Option<bool>,
    #[serde(rename = "noVerify")]
    pub no_verify: Option<bool>,
    pub author: Option<GitAuthor>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitAuthor {
    pub name: String,
    pub email: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct GitPushParams {
    pub remote: Option<String>,
    pub branch: Option<String>,
    pub force: Option<bool>,
    pub set_upstream: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct GitPullParams {
    pub remote: Option<String>,
    pub branch: Option<String>,
    pub rebase: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitMergeParams {
    pub branch: String,
    pub strategy: Option<String>,
    pub message: Option<String>,
    pub no_ff: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitStashParams {
    pub message: Option<String>,
    pub include_untracked: Option<bool>,
    pub keep_index: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct GitDiffParams {
    pub source: Option<String>,
    pub target: Option<String>,
    pub files: Option<Vec<String>>,
    pub staged: Option<bool>,
    pub stat: Option<bool>,
    #[serde(default, alias = "reviewSafe")]
    pub review_safe: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct GitChangedFilesParams {
    pub source: Option<String>,
    pub target: Option<String>,
    pub staged: Option<bool>,
    #[serde(default, alias = "reviewSafe")]
    pub review_safe: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GitChangedFileStatus {
    Added,
    Modified,
    Deleted,
    Renamed,
    Copied,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GitChangedFile {
    pub path: String,
    pub old_path: Option<String>,
    pub status: GitChangedFileStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitOperationResult {
    pub success: bool,
    pub data: Option<serde_json::Value>,
    pub error: Option<String>,
    pub output: Option<String>,
    pub duration: Option<u64>,
}

/// Raw result of executing a git command, preserving exit code and both streams.
#[derive(Debug, Clone)]
pub struct GitCommandOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitDiffResult {
    pub files: Vec<GitDiffFile>,
    pub total_additions: i32,
    pub total_deletions: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitDiffFile {
    pub path: String,
    pub old_path: Option<String>,
    pub status: String,
    pub additions: i32,
    pub deletions: i32,
    pub diff: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitStash {
    pub index: i32,
    pub message: String,
    pub branch: String,
    pub date: String,
    pub hash: String,
}

/// Git worktree information
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktreeInfo {
    /// Worktree path
    pub path: String,
    /// Associated branch name
    pub branch: Option<String>,
    /// HEAD commit hash
    pub head: String,
    /// Whether this is the main worktree (the main directory of a bare repository)
    pub is_main: bool,
    /// Whether the worktree is locked
    pub is_locked: bool,
    /// Whether the worktree is prunable
    pub is_prunable: bool,
}

/// Local changes that can be copied into a freshly-created detached worktree.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitLocalChangeSummary {
    pub staged: Vec<String>,
    pub unstaged: Vec<String>,
    pub untracked: Vec<String>,
    pub included_ignored: Vec<String>,
}

impl GitLocalChangeSummary {
    pub fn is_empty(&self) -> bool {
        self.staged.is_empty()
            && self.unstaged.is_empty()
            && self.untracked.is_empty()
            && self.included_ignored.is_empty()
    }
}

/// Repository identity used to share worktree topology across linked checkouts.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitWorktreeRepositoryInfo {
    /// A working directory suitable for running `git worktree list`.
    pub query_path: PathBuf,
    /// The common Git directory shared by the main and linked worktrees.
    pub common_git_dir: PathBuf,
    /// The current worktree's `.git` marker. Linked worktrees use a file here.
    pub worktree_git_marker: PathBuf,
}

/// Git graph node.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphNode {
    /// Commit hash.
    pub hash: String,
    /// Commit message (first line).
    pub message: String,
    /// Full commit message.
    pub full_message: String,
    /// Author name.
    pub author_name: String,
    /// Author email.
    pub author_email: String,
    /// Commit time (Unix timestamp).
    pub timestamp: i64,
    /// Parent commit hashes.
    pub parents: Vec<String>,
    /// Child commit hashes (filled when building the graph).
    pub children: Vec<String>,
    /// Associated refs (branches, tags, etc.).
    pub refs: Vec<GraphRef>,
    /// Lane position.
    pub lane: i32,
    /// Lanes that fork out.
    pub forking_lanes: Vec<i32>,
    /// Lanes that merge in.
    pub merging_lanes: Vec<i32>,
    /// Lanes that pass through.
    pub passing_lanes: Vec<i32>,
}

/// Git ref information.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphRef {
    /// Ref name.
    pub name: String,
    /// Ref type: `branch`, `remote`, `tag`.
    pub ref_type: String,
    /// Whether this is the current branch.
    pub is_current: bool,
    /// Whether this is `HEAD`.
    pub is_head: bool,
}

/// Git graph data.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitGraph {
    /// Node list.
    pub nodes: Vec<GraphNode>,
    /// Maximum lane count.
    pub max_lane: i32,
    /// Current branch name.
    pub current_branch: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(path: &str, status: &str, index: Option<&str>, workdir: Option<&str>) -> GitFileStatus {
        GitFileStatus {
            path: path.to_string(),
            status: status.to_string(),
            index_status: index.map(str::to_string),
            workdir_status: workdir.map(str::to_string),
        }
    }

    fn sample() -> GitStatus {
        GitStatus {
            staged: vec![file("a.rs", "M", Some("M"), None)],
            unstaged: vec![file("b.rs", "M", None, Some("M"))],
            untracked: vec!["c.txt".to_string()],
            conflicts: vec!["d.rs".to_string()],
            current_branch: "main".to_string(),
            ahead: 1,
            behind: 2,
        }
    }

    #[test]
    fn equal_statuses_share_a_fingerprint() {
        assert_eq!(sample().fingerprint(), sample().fingerprint());
        assert_eq!(sample().fingerprint().len(), 16);
    }

    #[test]
    fn the_fingerprint_is_stable_across_builds() {
        // Pinned: clients may compare fingerprints from different hosts, so the
        // encoding must not drift with the toolchain.
        let empty = GitStatus {
            staged: Vec::new(),
            unstaged: Vec::new(),
            untracked: Vec::new(),
            conflicts: Vec::new(),
            current_branch: String::new(),
            ahead: 0,
            behind: 0,
        };
        // Values computed independently of this implementation (FNV-1a 64 over
        // the documented length-prefixed encoding).
        assert_eq!(empty.fingerprint(), "8ac123d6f7dce585");
        assert_eq!(sample().fingerprint(), "15c53654d07e99e9");
    }

    #[test]
    fn any_field_change_changes_the_fingerprint() {
        let base = sample().fingerprint();
        let variants: Vec<Box<dyn Fn(&mut GitStatus)>> = vec![
            Box::new(|s| s.staged.push(file("e.rs", "A", Some("A"), None))),
            Box::new(|s| s.staged[0].status = "A".to_string()),
            Box::new(|s| s.staged[0].index_status = None),
            Box::new(|s| s.unstaged[0].path = "bb.rs".to_string()),
            Box::new(|s| s.unstaged[0].workdir_status = Some("D".to_string())),
            Box::new(|s| s.untracked.push("f.txt".to_string())),
            Box::new(|s| s.conflicts.clear()),
            Box::new(|s| s.current_branch = "dev".to_string()),
            Box::new(|s| s.ahead = 0),
            Box::new(|s| s.behind = 3),
            // The same file moving from one list to another is a change.
            Box::new(|s| {
                let moved = s.staged.remove(0);
                s.unstaged.insert(0, moved);
            }),
            // Field boundaries are length-prefixed: "ab"+"c" is not "a"+"bc".
            Box::new(|s| {
                s.untracked = vec!["c.tx".to_string(), "t".to_string()];
            }),
        ];
        for (index, change) in variants.iter().enumerate() {
            let mut status = sample();
            change(&mut status);
            assert_ne!(
                status.fingerprint(),
                base,
                "variant {index} kept the fingerprint"
            );
        }
    }

    #[test]
    fn the_wire_carries_the_fingerprint_and_old_payloads_still_read() {
        let status = sample();
        let value = serde_json::to_value(&status).unwrap();
        assert_eq!(value["fingerprint"], status.fingerprint());
        assert_eq!(value["current_branch"], "main");
        assert_eq!(value["staged"][0]["index_status"], "M");

        // Round trip: the field is derived, so reading it back changes nothing.
        let back: GitStatus = serde_json::from_value(value).unwrap();
        assert_eq!(back.fingerprint(), status.fingerprint());

        // A payload from a host without fingerprints (and without `conflicts`).
        let legacy: GitStatus = serde_json::from_value(serde_json::json!({
            "staged": [],
            "unstaged": [{"path": "x", "status": "M", "index_status": null, "workdir_status": "M"}],
            "untracked": ["y"],
            "current_branch": "main",
            "ahead": 0,
            "behind": 0
        }))
        .unwrap();
        assert!(legacy.conflicts.is_empty());
        assert_eq!(legacy.unstaged[0].path, "x");

        // A stale fingerprint on the wire never wins over the content.
        let tampered: GitStatus = serde_json::from_value(serde_json::json!({
            "staged": [], "unstaged": [], "untracked": [],
            "current_branch": "main", "ahead": 0, "behind": 0,
            "fingerprint": "0000000000000000"
        }))
        .unwrap();
        assert_ne!(tampered.fingerprint(), "0000000000000000");
    }
}

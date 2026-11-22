//! Diff API - backend commands for diff comparison and patch application

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComputeDiffRequest {
    #[serde(rename = "oldContent")]
    pub old_content: String,
    #[serde(rename = "newContent")]
    pub new_content: String,
    pub options: Option<DiffOptions>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffOptions {
    #[serde(default, alias = "ignoreWhitespace")]
    pub ignore_whitespace: Option<bool>,
    #[serde(default, alias = "contextLines")]
    pub context_lines: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffResult {
    pub hunks: Vec<DiffHunk>,
    pub additions: usize,
    pub deletions: usize,
    pub changes: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffHunk {
    pub old_start: usize,
    pub old_lines: usize,
    pub new_start: usize,
    pub new_lines: usize,
    pub lines: Vec<DiffLine>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffLine {
    pub line_type: String, // "context" | "add" | "delete"
    pub content: String,
    pub old_line_number: Option<usize>,
    pub new_line_number: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApplyPatchRequest {
    pub content: String,
    pub patch: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaveMergedContentRequest {
    #[serde(rename = "filePath")]
    pub file_path: String,
    pub content: String,
    #[serde(default, rename = "workspaceId", alias = "workspace_id")]
    pub workspace_id: Option<String>,
    #[serde(default, rename = "remoteConnectionId", alias = "remote_connection_id")]
    pub remote_connection_id: Option<String>,
    #[serde(default, rename = "controllerLocal", alias = "controller_local")]
    pub controller_local: bool,
}

fn normalize_whitespace_key(line: &str) -> String {
    line.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn compute_diff_sync(request: ComputeDiffRequest) -> DiffResult {
    let old_lines: Vec<&str> = request.old_content.lines().collect();
    let new_lines: Vec<&str> = request.new_content.lines().collect();
    let ignore_whitespace = request
        .options
        .as_ref()
        .and_then(|o| o.ignore_whitespace)
        .unwrap_or(false);
    let context_lines = request
        .options
        .as_ref()
        .and_then(|o| o.context_lines)
        .unwrap_or(3);

    let grouped_ops = if ignore_whitespace {
        let old_keys: Vec<String> = old_lines
            .iter()
            .map(|l| normalize_whitespace_key(l))
            .collect();
        let new_keys: Vec<String> = new_lines
            .iter()
            .map(|l| normalize_whitespace_key(l))
            .collect();
        let old_refs: Vec<&str> = old_keys.iter().map(String::as_str).collect();
        let new_refs: Vec<&str> = new_keys.iter().map(String::as_str).collect();
        let diff = similar::TextDiff::from_slices(&old_refs, &new_refs);
        diff.grouped_ops(context_lines)
    } else {
        let diff = similar::TextDiff::from_slices(&old_lines, &new_lines);
        diff.grouped_ops(context_lines)
    };

    let mut hunks = Vec::new();
    let mut additions = 0;
    let mut deletions = 0;

    for group in grouped_ops {
        let mut hunk_lines = Vec::new();
        let mut old_start = 0;
        let mut new_start = 0;
        let mut old_count = 0;
        let mut new_count = 0;

        for op in &group {
            match op {
                similar::DiffOp::Equal {
                    old_index,
                    new_index,
                    len,
                } => {
                    if old_start == 0 {
                        old_start = *old_index + 1;
                    }
                    if new_start == 0 {
                        new_start = *new_index + 1;
                    }
                    for i in 0..*len {
                        hunk_lines.push(DiffLine {
                            line_type: "context".to_string(),
                            content: old_lines.get(*old_index + i).unwrap_or(&"").to_string(),
                            old_line_number: Some(*old_index + i + 1),
                            new_line_number: Some(*new_index + i + 1),
                        });
                        old_count += 1;
                        new_count += 1;
                    }
                }
                similar::DiffOp::Delete {
                    old_index, old_len, ..
                } => {
                    if old_start == 0 {
                        old_start = *old_index + 1;
                    }
                    for i in 0..*old_len {
                        hunk_lines.push(DiffLine {
                            line_type: "delete".to_string(),
                            content: old_lines.get(*old_index + i).unwrap_or(&"").to_string(),
                            old_line_number: Some(*old_index + i + 1),
                            new_line_number: None,
                        });
                        old_count += 1;
                        deletions += 1;
                    }
                }
                similar::DiffOp::Insert {
                    new_index, new_len, ..
                } => {
                    if new_start == 0 {
                        new_start = *new_index + 1;
                    }
                    for i in 0..*new_len {
                        hunk_lines.push(DiffLine {
                            line_type: "add".to_string(),
                            content: new_lines.get(*new_index + i).unwrap_or(&"").to_string(),
                            old_line_number: None,
                            new_line_number: Some(*new_index + i + 1),
                        });
                        new_count += 1;
                        additions += 1;
                    }
                }
                similar::DiffOp::Replace {
                    old_index,
                    old_len,
                    new_index,
                    new_len,
                } => {
                    if old_start == 0 {
                        old_start = *old_index + 1;
                    }
                    if new_start == 0 {
                        new_start = *new_index + 1;
                    }
                    for i in 0..*old_len {
                        hunk_lines.push(DiffLine {
                            line_type: "delete".to_string(),
                            content: old_lines.get(*old_index + i).unwrap_or(&"").to_string(),
                            old_line_number: Some(*old_index + i + 1),
                            new_line_number: None,
                        });
                        old_count += 1;
                        deletions += 1;
                    }
                    for i in 0..*new_len {
                        hunk_lines.push(DiffLine {
                            line_type: "add".to_string(),
                            content: new_lines.get(*new_index + i).unwrap_or(&"").to_string(),
                            old_line_number: None,
                            new_line_number: Some(*new_index + i + 1),
                        });
                        new_count += 1;
                        additions += 1;
                    }
                }
            }
        }

        if !hunk_lines.is_empty() {
            hunks.push(DiffHunk {
                old_start,
                old_lines: old_count,
                new_start,
                new_lines: new_count,
                lines: hunk_lines,
            });
        }
    }

    DiffResult {
        hunks,
        additions,
        deletions,
        changes: additions + deletions,
    }
}

// @backend-command
pub async fn compute_diff(request: ComputeDiffRequest) -> Result<DiffResult, String> {
    tokio::task::spawn_blocking(move || compute_diff_sync(request))
        .await
        .map_err(|e| format!("Failed to compute diff: {}", e))
}

fn parse_hunk_header(header: &str) -> Result<(usize, usize), String> {
    let rest = header
        .strip_prefix("@@ ")
        .ok_or_else(|| format!("Invalid unified diff hunk header: {}", header))?;
    let range_part = rest
        .split(" @@")
        .next()
        .ok_or_else(|| format!("Invalid unified diff hunk header: {}", header))?;
    let mut parts = range_part.split_whitespace();
    let old_range = parts
        .next()
        .and_then(|s| s.strip_prefix('-'))
        .ok_or_else(|| format!("Missing old range in hunk header: {}", header))?;
    let mut old_nums = old_range.split(',');
    let old_start: usize = old_nums
        .next()
        .ok_or_else(|| format!("Missing old start in hunk header: {}", header))?
        .parse()
        .map_err(|_| format!("Invalid old start in hunk header: {}", header))?;
    let old_count: usize = match old_nums.next() {
        Some(n) => n
            .parse()
            .map_err(|_| format!("Invalid old count in hunk header: {}", header))?,
        None => 1,
    };
    Ok((old_start, old_count))
}

fn apply_unified_patch(content: &str, patch: &str) -> Result<String, String> {
    let trimmed_patch = patch.trim();
    if trimmed_patch.is_empty() {
        return Err("Patch is empty".to_string());
    }

    let trailing_newline = content.ends_with('\n');
    let line_ending = if content.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let original_lines: Vec<&str> = if content.is_empty() {
        Vec::new()
    } else {
        content.lines().collect()
    };

    let patch_lines: Vec<&str> = patch.lines().collect();
    let mut i = 0usize;
    let mut cursor = 0usize; // 0-based index into original_lines
    let mut output: Vec<String> = Vec::with_capacity(original_lines.len());
    let mut hunks_applied = 0usize;
    let mut suppress_trailing_newline = false;

    while i < patch_lines.len() {
        let line = patch_lines[i];
        if line.starts_with("--- ")
            || line.starts_with("+++ ")
            || line.starts_with("diff ")
            || line.starts_with("index ")
        {
            i += 1;
            continue;
        }
        if !line.starts_with("@@ ") {
            if line.trim().is_empty() {
                i += 1;
                continue;
            }
            return Err(format!("Unexpected line outside hunk in patch: {}", line));
        }

        let (old_start, _old_count) = parse_hunk_header(line)?;
        let target_idx = if old_start == 0 { 0 } else { old_start - 1 };
        if target_idx < cursor || target_idx > original_lines.len() {
            return Err(format!(
                "Patch hunk at line {} is out of bounds for content ({} lines)",
                old_start,
                original_lines.len()
            ));
        }
        while cursor < target_idx {
            output.push(original_lines[cursor].to_string());
            cursor += 1;
        }

        i += 1;
        hunks_applied += 1;
        while i < patch_lines.len() && !patch_lines[i].starts_with("@@ ") {
            let hunk_line = patch_lines[i];
            if let Some(expected) = hunk_line.strip_prefix(' ') {
                let actual = original_lines.get(cursor).copied().ok_or_else(|| {
                    format!(
                        "Patch context mismatch at line {}: unexpected end of file",
                        cursor + 1
                    )
                })?;
                if actual != expected {
                    return Err(format!(
                        "Patch context mismatch at line {}: expected '{}', found '{}'",
                        cursor + 1,
                        expected,
                        actual
                    ));
                }
                output.push(actual.to_string());
                cursor += 1;
            } else if let Some(expected) = hunk_line.strip_prefix('-') {
                let actual = original_lines.get(cursor).copied().ok_or_else(|| {
                    format!(
                        "Patch deletion mismatch at line {}: unexpected end of file",
                        cursor + 1
                    )
                })?;
                if actual != expected {
                    return Err(format!(
                        "Patch deletion mismatch at line {}: expected '{}', found '{}'",
                        cursor + 1,
                        expected,
                        actual
                    ));
                }
                cursor += 1;
            } else if let Some(added) = hunk_line.strip_prefix('+') {
                output.push(added.to_string());
            } else if hunk_line.starts_with("\\ No newline at end of file") {
                suppress_trailing_newline = true;
            } else {
                return Err(format!("Malformed patch line inside hunk: {}", hunk_line));
            }
            i += 1;
        }
    }

    if hunks_applied == 0 {
        return Err("Patch contains no valid unified diff hunks".to_string());
    }

    while cursor < original_lines.len() {
        output.push(original_lines[cursor].to_string());
        cursor += 1;
    }

    let mut result = output.join(line_ending);
    if !output.is_empty() && trailing_newline && !suppress_trailing_newline {
        result.push_str(line_ending);
    }
    Ok(result)
}

// @backend-command
pub async fn apply_patch(request: ApplyPatchRequest) -> Result<String, String> {
    tokio::task::spawn_blocking(move || apply_unified_patch(&request.content, &request.patch))
        .await
        .map_err(|e| format!("Failed to apply patch: {}", e))?
}

// @backend-command
pub async fn save_merged_diff_content(request: SaveMergedContentRequest) -> Result<(), String> {
    let explicit_remote_cid = request
        .remote_connection_id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .map(str::to_owned);

    let is_remote = explicit_remote_cid.is_some()
        || openbitfun_core::service::workspace::remote_io_for_legacy_or_id(
            request.workspace_id.as_deref(),
            request.controller_local,
            request.file_path.trim(),
        )
        .await
        .map_err(|e| e.to_string())?;

    if is_remote {
        let manager = openbitfun_core::service::remote_ssh::get_remote_workspace_manager()
            .ok_or_else(|| {
                format!(
                    "Cannot save merged diff to remote workspace path '{}': remote workspace manager is unavailable; local filesystem fallback was not attempted",
                    request.file_path
                )
            })?;
        let connection_id = match explicit_remote_cid {
            Some(cid) => cid,
            None => manager
                .lookup_connection(request.file_path.trim(), None)
                .await
                .map(|entry| entry.connection_id)
                .ok_or_else(|| {
                    format!(
                        "Cannot save merged diff to remote workspace path '{}': no active remote connection found; local filesystem fallback was not attempted",
                        request.file_path
                    )
                })?,
        };
        let file_service = manager.get_file_service().await.ok_or_else(|| {
            format!(
                "Cannot save merged diff to remote workspace path '{}': remote file service is unavailable; local filesystem fallback was not attempted",
                request.file_path
            )
        })?;
        return file_service
            .write_file(
                &connection_id,
                request.file_path.trim(),
                request.content.as_bytes(),
            )
            .await
            .map_err(|e| {
                format!(
                    "Failed to write merged diff to remote file '{}': {}",
                    request.file_path, e
                )
            });
    }

    let path = PathBuf::from(&request.file_path);

    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    tokio::fs::write(&path, &request.content)
        .await
        .map_err(|e| format!("Failed to write file: {}", e))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn apply_unified_patch_applies_hunks_and_rejects_mismatches() {
        let original = "line1\nline2\nline3\n";
        let patch = "@@ -1,3 +1,3 @@\n line1\n-line2\n+line2-updated\n line3\n";
        let patched = apply_unified_patch(original, patch).unwrap();
        assert_eq!(patched, "line1\nline2-updated\nline3\n");

        let bad_patch = "@@ -1,3 +1,3 @@\n line1\n-wrong\n+new\n line3\n";
        assert!(apply_unified_patch(original, bad_patch).is_err());
        assert!(apply_unified_patch(original, "").is_err());
    }

    #[test]
    fn compute_diff_honors_ignore_whitespace() {
        let req = ComputeDiffRequest {
            old_content: "let x = 1;\n".into(),
            new_content: "  let   x   =   1;\n".into(),
            options: Some(DiffOptions {
                ignore_whitespace: Some(true),
                context_lines: Some(3),
            }),
        };
        let res = compute_diff_sync(req);
        assert_eq!(res.changes, 0);
        assert!(res.hunks.is_empty());
    }

    #[tokio::test]
    async fn save_merged_diff_content_refuses_remote_fallback_when_disconnected() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("should-not-exist.txt");
        let err = save_merged_diff_content(SaveMergedContentRequest {
            file_path: target.to_string_lossy().into_owned(),
            content: "remote content".into(),
            workspace_id: None,
            remote_connection_id: Some("ssh-conn-missing".into()),
            controller_local: false,
        })
        .await
        .unwrap_err();
        assert!(err.contains("remote"), "expected remote error, got: {err}");
        assert!(
            !target.exists(),
            "remote save must never fall back to writing controller-local files"
        );
    }
}

//! Clipboard file paste API. Reading and writing the system clipboard is the
//! UI shell's job (`clipboard.*` shell operations, `backend_protocol::native_commands`).

use serde::{Deserialize, Serialize};
use std::path::Path;

/// Returns the first path in `paths` that belongs to a registered remote workspace.
async fn first_remote_path<'a>(
    workspace_id: Option<&str>,
    controller_local: bool,
    paths: impl Iterator<Item = &'a str>,
) -> Result<Option<String>, String> {
    for path in paths {
        if openbitfun_core::service::workspace::remote_io_for_legacy_or_id(
            workspace_id,
            controller_local,
            path.trim(),
        )
        .await
        .map_err(|e| e.to_string())?
        {
            return Ok(Some(path.to_string()));
        }
    }
    Ok(None)
}

#[derive(Debug, Serialize)]
pub struct ClipboardFilesResponse {
    pub files: Vec<String>,
    pub is_cut: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PasteFilesRequest {
    #[serde(default)]
    pub controller_local: bool,
    #[serde(default)]
    pub workspace_id: Option<String>,
    pub source_paths: Vec<String>,
    pub target_directory: String,
    pub is_cut: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PasteFilesResponse {
    pub success_count: usize,
    pub failed_files: Vec<FailedFile>,
    pub directory_count: usize,
}

#[derive(Debug, Serialize)]
pub struct FailedFile {
    pub path: String,
    pub error: String,
}

// @backend-command
pub async fn paste_files(request: PasteFilesRequest) -> Result<PasteFilesResponse, String> {
    if let Some(remote_path) = first_remote_path(
        request.workspace_id.as_deref(),
        request.controller_local,
        std::iter::once(request.target_directory.as_str())
            .chain(request.source_paths.iter().map(String::as_str)),
    )
    .await?
    {
        return Err(format!(
            "paste_files cannot copy remote workspace path '{}': the remote file provider has no copy primitive; local filesystem fallback was not attempted",
            remote_path
        ));
    }

    tokio::task::spawn_blocking(move || paste_files_local_sync(request))
        .await
        .map_err(|e| format!("Failed to paste files: {}", e))?
}

fn paste_files_local_sync(request: PasteFilesRequest) -> Result<PasteFilesResponse, String> {
    let target_dir = Path::new(&request.target_directory);

    if !target_dir.exists() {
        return Err(format!(
            "Target directory does not exist: {}",
            request.target_directory
        ));
    }

    if !target_dir.is_dir() {
        return Err(format!(
            "Target path is not a directory: {}",
            request.target_directory
        ));
    }

    let canonical_target_dir = std::fs::canonicalize(target_dir).ok();
    let mut success_count = 0;
    let mut directory_count = 0;
    let mut failed_files = Vec::new();

    for source_path in &request.source_paths {
        let source = Path::new(source_path);

        if !source.exists() {
            failed_files.push(FailedFile {
                path: source_path.clone(),
                error: "Source file does not exist".to_string(),
            });
            continue;
        }

        let file_name = match source.file_name() {
            Some(name) => name,
            None => {
                failed_files.push(FailedFile {
                    path: source_path.clone(),
                    error: "Failed to get file name".to_string(),
                });
                continue;
            }
        };

        let target_path = target_dir.join(file_name);

        let final_target = if target_path.exists() {
            generate_unique_path(&target_path)
        } else {
            target_path
        };

        let is_dir = std::fs::symlink_metadata(source)
            .map(|m| m.is_dir())
            .unwrap_or(false);
        if is_dir {
            if let (Ok(canonical_source), Some(canonical_target)) =
                (std::fs::canonicalize(source), canonical_target_dir.as_ref())
            {
                if canonical_target.starts_with(&canonical_source) {
                    failed_files.push(FailedFile {
                        path: source_path.clone(),
                        error: "Cannot copy a directory into itself or one of its subdirectories"
                            .to_string(),
                    });
                    continue;
                }
            }
        }
        let result = if is_dir {
            copy_directory_recursive(source, &final_target)
        } else {
            std::fs::copy(source, &final_target)
                .map(|_| ())
                .map_err(|e| e.to_string())
        };

        match result {
            Ok(_) => {
                success_count += 1;
                if is_dir {
                    directory_count += 1;
                }

                if request.is_cut {
                    if is_dir {
                        if let Err(e) = std::fs::remove_dir_all(source) {
                            log::warn!("Failed to remove source directory after cut: {}", e);
                        }
                    } else if let Err(e) = std::fs::remove_file(source) {
                        log::warn!("Failed to remove source file after cut: {}", e);
                    }
                }
            }
            Err(e) => {
                failed_files.push(FailedFile {
                    path: source_path.clone(),
                    error: e,
                });
            }
        }
    }

    Ok(PasteFilesResponse {
        success_count,
        failed_files,
        directory_count,
    })
}

fn generate_unique_path(path: &Path) -> std::path::PathBuf {
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
    let extension = path.extension().and_then(|s| s.to_str());

    let mut counter = 1;
    loop {
        let new_name = if let Some(ext) = extension {
            format!("{} ({}).{}", stem, counter, ext)
        } else {
            format!("{} ({})", stem, counter)
        };

        let new_path = parent.join(&new_name);
        if !new_path.exists() {
            return new_path;
        }
        counter += 1;
    }
}

const MAX_COPY_DEPTH: usize = 128;

pub(crate) fn copy_directory_recursive(source: &Path, target: &Path) -> Result<(), String> {
    copy_directory_recursive_bounded(source, target, 0)
}

fn copy_directory_recursive_bounded(
    source: &Path,
    target: &Path,
    depth: usize,
) -> Result<(), String> {
    if depth >= MAX_COPY_DEPTH {
        return Err(format!(
            "Directory nesting exceeded maximum copy depth ({})",
            MAX_COPY_DEPTH
        ));
    }
    std::fs::create_dir_all(target).map_err(|e| format!("Failed to create directory: {}", e))?;

    for entry in
        std::fs::read_dir(source).map_err(|e| format!("Failed to read directory: {}", e))?
    {
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
        let file_type = entry
            .file_type()
            .map_err(|e| format!("Failed to inspect directory entry: {}", e))?;
        if file_type.is_symlink() {
            continue;
        }
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());

        if file_type.is_dir() {
            copy_directory_recursive_bounded(&source_path, &target_path, depth + 1)?;
        } else if file_type.is_file() {
            std::fs::copy(&source_path, &target_path)
                .map_err(|e| format!("Failed to copy file: {}", e))?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{copy_directory_recursive, generate_unique_path};
    use std::path::Path;

    #[test]
    fn generate_unique_path_uses_current_dir_when_parent_missing() {
        let unique = generate_unique_path(Path::new("example.txt"));
        assert_eq!(
            unique.file_name(),
            Some(std::ffi::OsStr::new("example (1).txt"))
        );
    }

    #[test]
    fn copy_directory_recursive_copies_nested_binary_files() {
        let root = std::env::temp_dir().join(format!(
            "openbitfun-directory-copy-test-{}",
            uuid::Uuid::new_v4()
        ));
        let source = root.join("source");
        let target = root.join("target");
        std::fs::create_dir_all(source.join("nested")).expect("create source directory");
        std::fs::write(source.join("root.bin"), [0_u8, 255, 128]).expect("write root file");
        std::fs::write(source.join("nested").join("child.txt"), b"child")
            .expect("write nested file");

        copy_directory_recursive(&source, &target).expect("copy directory recursively");

        assert_eq!(
            std::fs::read(target.join("root.bin")).expect("read copied root file"),
            [0_u8, 255, 128]
        );
        assert_eq!(
            std::fs::read(target.join("nested").join("child.txt"))
                .expect("read copied nested file"),
            b"child"
        );

        std::fs::remove_dir_all(root).expect("remove test directory");
    }

    #[cfg(unix)]
    #[test]
    fn copy_directory_recursive_skips_symlink_cycles() {
        use std::os::unix::fs::symlink;

        let temp = tempfile::tempdir().expect("tempdir");
        let source = temp.path().join("source");
        let target = temp.path().join("target");
        std::fs::create_dir_all(&source).unwrap();
        std::fs::write(source.join("ok.txt"), b"hello").unwrap();
        symlink(&source, source.join("loop")).unwrap();

        copy_directory_recursive(&source, &target).expect("should skip symlink cycle");
        assert_eq!(std::fs::read(target.join("ok.txt")).unwrap(), b"hello");
        assert!(!target.join("loop").exists());
    }
}

#[cfg(test)]
mod remote_guard_tests {
    use super::{paste_files, PasteFilesRequest};
    use openbitfun_core::service::remote_ssh::workspace_state::init_remote_workspace_manager;

    const REMOTE_ROOT: &str = "/remote-audit-paste";
    const CONNECTION_ID: &str = "remote-audit-paste-connection";

    #[tokio::test]
    async fn paste_files_refuses_remote_target_and_leaves_controller_untouched() {
        init_remote_workspace_manager()
            .register_remote_workspace(
                REMOTE_ROOT.to_string(),
                CONNECTION_ID.to_string(),
                "remote-audit-paste".to_string(),
                "remote-audit-paste.invalid".to_string(),
            )
            .await;

        let source = std::env::temp_dir().join("openbitfun-remote-audit-paste-source.txt");
        std::fs::write(&source, b"local bytes").expect("write controller source");
        let sentinel = std::env::temp_dir().join("openbitfun-remote-audit-paste-source.txt.copy");
        let _ = std::fs::remove_file(&sentinel);

        let error = paste_files(PasteFilesRequest {
            controller_local: false,
            workspace_id: None,
            source_paths: vec![source.to_string_lossy().to_string()],
            target_directory: format!("{REMOTE_ROOT}/src"),
            is_cut: true,
        })
        .await
        .expect_err("remote paste target must be refused");

        assert!(error.starts_with("paste_files cannot copy remote workspace path"));
        assert!(error.contains("local filesystem fallback was not attempted"));
        assert!(
            source.exists(),
            "a refused cut must not delete the controller source"
        );
        assert!(!sentinel.exists());

        let _ = std::fs::remove_file(&source);
        init_remote_workspace_manager()
            .unregister_remote_workspace(CONNECTION_ID, REMOTE_ROOT)
            .await;
    }
}

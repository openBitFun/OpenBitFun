//! System API

use openbitfun_core::service::system;
use serde::{Deserialize, Serialize};
use std::path::Path;

/// Updater manifest origins, in fallback order (the native updater,
/// `backend_protocol/native_commands/update.rs`). Release builds may override
/// both at compile time (`scripts/ci/desktop-release-env.mjs`).
pub(crate) const GITHUB_UPDATER_ENDPOINT: &str =
    match option_env!("OPENBITFUN_UPDATER_PRIMARY_ENDPOINT") {
        Some(endpoint) => endpoint,
        None => "https://github.com/openBitFun/OpenBitFun/releases/latest/download/latest-v1.json",
    };
pub(crate) const OPENBITFUN_UPDATER_ENDPOINT: &str =
    match option_env!("OPENBITFUN_UPDATER_FALLBACK_ENDPOINT") {
        Some(endpoint) => endpoint,
        None => "https://openbitfun.com/release/latest-v1.json",
    };

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfoResponse {
    pub platform: String,
    pub arch: String,
    pub os_version: Option<String>,
    #[serde(default)]
    pub home_dir: Option<String>,
}

// @backend-command
pub async fn get_system_info() -> Result<SystemInfoResponse, String> {
    let info = system::get_system_info();

    Ok(SystemInfoResponse {
        platform: info.platform,
        arch: info.arch,
        os_version: info.os_version,
        home_dir: info.home_dir,
    })
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GetAppVersionRequest {}

/// Returns the current application version (from `Cargo.toml` / bundle metadata).
// @backend-command
pub async fn get_app_version(
    app: crate::host::HostHandle,
    request: GetAppVersionRequest,
) -> Result<String, String> {
    let _ = request;
    Ok(app.app_version())
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CheckForUpdatesRequest {}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckForUpdatesResponse {
    pub update_available: bool,
    pub current_version: String,
    pub latest_version: Option<String>,
    pub release_notes: Option<String>,
    pub release_date: Option<String>,
}

/// Checks the remote updater endpoint for a newer signed release (no download).

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct InstallUpdateRequest {}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenHtmlFileInBrowserRequest {
    pub path: String,
}

fn is_html_file_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| {
            extension.eq_ignore_ascii_case("html") || extension.eq_ignore_ascii_case("htm")
        })
        .unwrap_or(false)
}

/// The checks both hosts run before opening a file in the browser.
pub(crate) fn validate_html_file(path: &str) -> Result<(), String> {
    let path = Path::new(path);

    if !is_html_file_path(path) {
        return Err("Only HTML files can be opened in the browser".to_string());
    }

    let metadata = std::fs::metadata(path)
        .map_err(|error| format!("Failed to read HTML file metadata: {}", error))?;
    if !metadata.is_file() {
        return Err("HTML path is not a file".to_string());
    }
    Ok(())
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RestartAppRequest {}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckCommandResponse {
    pub exists: bool,
    pub path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunCommandRequest {
    #[serde(default)]
    pub controller_local: bool,
    #[serde(default)]
    pub workspace_id: Option<String>,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    pub cwd: Option<String>,
    pub env: Option<Vec<EnvVar>>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvVar {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandOutputResponse {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub success: bool,
}

// @backend-command
pub async fn check_command_exists(command: String) -> Result<CheckCommandResponse, String> {
    let result = tokio::task::spawn_blocking(move || system::check_command(&command))
        .await
        .map_err(|e| format!("Failed to check command: {}", e))?;

    Ok(CheckCommandResponse {
        exists: result.exists,
        path: result.path,
    })
}

// @backend-command
pub async fn check_commands_exist(
    commands: Vec<String>,
) -> Result<Vec<(String, CheckCommandResponse)>, String> {
    let results = tokio::task::spawn_blocking(move || {
        let cmd_refs: Vec<&str> = commands.iter().map(|s| s.as_str()).collect();
        system::check_commands(&cmd_refs)
    })
    .await
    .map_err(|e| format!("Failed to check commands: {}", e))?;

    Ok(results
        .into_iter()
        .map(|(name, result)| {
            (
                name,
                CheckCommandResponse {
                    exists: result.exists,
                    path: result.path,
                },
            )
        })
        .collect())
}

/// Runs a process on the controller. A remote workspace working directory is refused because this
/// command has no SSH transport: honouring it locally would run the process on the wrong machine.
// @backend-command
pub async fn run_system_command(
    request: RunCommandRequest,
) -> Result<CommandOutputResponse, String> {
    if request.workspace_id.is_some() || request.cwd.is_some() {
        let cwd = request.cwd.as_deref().unwrap_or_default();
        if openbitfun_core::service::workspace::remote_io_for_legacy_or_id(
            request.workspace_id.as_deref(),
            request.controller_local,
            cwd.trim(),
        )
        .await
        .map_err(|e| e.to_string())?
        {
            return Err(format!(
                "run_system_command cannot execute '{}' in remote workspace directory '{}': this command spawns controller-local processes only; local filesystem fallback was not attempted",
                request.command, cwd
            ));
        }
    }

    let env_vars: Option<Vec<(String, String)>> = request
        .env
        .map(|vars| vars.into_iter().map(|v| (v.key, v.value)).collect());

    let env_ref: Option<&[(String, String)]> = env_vars.as_deref();

    let result = system::run_command(
        &request.command,
        &request.args,
        request.cwd.as_deref(),
        env_ref,
    )
    .await
    .map_err(|e| e.to_string())?;

    Ok(CommandOutputResponse {
        exit_code: result.exit_code,
        stdout: result.stdout,
        stderr: result.stderr,
        success: result.success,
    })
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendNotificationRequest {
    pub title: String,
    pub body: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ToggleMainWindowFullscreenRequest {}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToggleMainWindowFullscreenResponse {
    pub is_fullscreen: bool,
    pub is_maximized: bool,
}

#[cfg(test)]
mod tests {
    #[tokio::test]
    async fn system_info_home_contract_accepts_legacy_and_reports_serving_host() {
        let legacy =
            serde_json::json!({"platform": "windows", "arch": "x86_64", "osVersion": null});
        let old: super::SystemInfoResponse = serde_json::from_value(legacy).unwrap();
        assert!(old.home_dir.is_none());
        let round_trip: super::SystemInfoResponse =
            serde_json::from_value(serde_json::to_value(old).unwrap()).unwrap();
        assert_eq!(round_trip.platform, "windows");
        assert!(round_trip.home_dir.is_none());

        let response = serde_json::to_value(super::get_system_info().await.unwrap()).unwrap();
        assert_eq!(
            response["homeDir"],
            serde_json::json!(super::system::get_system_info().home_dir)
        );
        assert!(response.get("home_dir").is_none());
    }
}

#[cfg(test)]
mod remote_guard_tests {
    use super::{run_system_command, RunCommandRequest};
    use openbitfun_core::service::remote_ssh::workspace_state::init_remote_workspace_manager;

    const REMOTE_ROOT: &str = "/remote-audit-run-command";
    const CONNECTION_ID: &str = "remote-audit-run-command-connection";

    #[tokio::test]
    async fn run_system_command_refuses_remote_working_directory() {
        init_remote_workspace_manager()
            .register_remote_workspace(
                REMOTE_ROOT.to_string(),
                CONNECTION_ID.to_string(),
                "remote-audit-run-command".to_string(),
                "remote-audit-run-command.invalid".to_string(),
            )
            .await;

        let error = run_system_command(RunCommandRequest {
            controller_local: false,
            workspace_id: None,
            command: "git".to_string(),
            args: vec!["status".to_string()],
            cwd: Some(format!("{REMOTE_ROOT}/repo")),
            env: None,
        })
        .await
        .expect_err("remote working directory must be refused");

        assert!(error.starts_with("run_system_command cannot execute 'git'"));
        assert!(error.contains("local filesystem fallback was not attempted"));

        init_remote_workspace_manager()
            .unregister_remote_workspace(CONNECTION_ID, REMOTE_ROOT)
            .await;
    }
}

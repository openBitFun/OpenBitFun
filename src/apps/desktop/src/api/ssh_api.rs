//! SSH Remote Connection API
//!
//! Tauri commands for SSH connection management and remote file operations.

use crate::host::HostHandle;
use crate::host::State;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use crate::api::app_state::SSHServiceError;
use crate::startup_trace::DesktopStartupTrace;
use crate::AppState;
use openbitfun_core::service::remote_ssh::{
    list_remote_listening_ports, ConnectionTestReport, DockerContainerInfo, PortForward,
    PortForwardRequest, RemoteListeningPort, RemoteTreeNode, SSHAuthMethod, SSHConfigEntry,
    SSHConfigLookupResult, SSHConnectionConfig, SSHConnectionManager, SSHConnectionResult,
    SavedConnection, ServerInfo,
};
use openbitfun_services_integrations::remote_ssh::link_supervisor::{
    ReconnectError, ReconnectReadiness, RemoteLinkFailure, RemoteLinkPhase, RemoteLinkPolicy,
    RemoteLinkState, RemoteLinkSupervisor, RemoteLinkTransport, REMOTE_LINK_STATE_EVENT,
};

impl From<SSHServiceError> for String {
    fn from(e: SSHServiceError) -> Self {
        e.to_string()
    }
}

// === SSH Connection Management ===

async fn hydrate_stored_password(
    manager: &SSHConnectionManager,
    config: &mut SSHConnectionConfig,
) -> Result<(), String> {
    // Local Docker Exec/Auto profiles do not require SSH credentials. Older
    // saved profiles may therefore legitimately contain an empty Password
    // auth placeholder with no vault entry.
    if config.uses_local_process() {
        return Ok(());
    }
    if let SSHAuthMethod::Password { ref password } = config.auth {
        if password.is_empty() {
            match manager.load_stored_password(&config.id).await {
                Ok(Some(password)) => {
                    config.auth = SSHAuthMethod::Password { password };
                }
                Ok(None) => {
                    return Err(
                        "SSH password is required (no saved password for this connection)"
                            .to_string(),
                    );
                }
                Err(error) => return Err(error.to_string()),
            }
        }
    }
    Ok(())
}

// @backend-command
pub async fn ssh_list_wsl_distributions(
) -> Result<openbitfun_core::service::remote_ssh::WslDistributions, String> {
    openbitfun_services_integrations::remote_ssh::wsl::list_distributions()
        .await
        .map_err(|error| error.to_string())
}

// @backend-command
pub async fn ssh_list_saved_connections(
    state: State<'_, AppState>,
) -> Result<Vec<SavedConnection>, String> {
    let manager = state.get_ssh_manager_async().await?;
    let connections = manager.get_saved_connections().await;
    log::info!(
        "ssh_list_saved_connections returning {} connections",
        connections.len()
    );
    for conn in &connections {
        log::info!(
            "  - id={}, name={}, host={}:{}",
            conn.id,
            conn.name,
            conn.host,
            conn.port
        );
    }
    Ok(connections)
}

// @backend-command
pub async fn ssh_save_connection(
    state: State<'_, AppState>,
    config: SSHConnectionConfig,
) -> Result<(), String> {
    log::info!(
        "ssh_save_connection called: id={}, host={}, port={}, username={}",
        config.id,
        config.host,
        config.port,
        config.username
    );
    let manager = state.get_ssh_manager_async().await?;
    manager
        .save_connection(&config)
        .await
        .map_err(|e| e.to_string())?;
    match state
        .workspace_service
        .update_remote_connection_name(&config.id, &config.name)
        .await
    {
        Ok(updated) if updated > 0 => {
            crate::fleet::refresh_local_now().await;
        }
        Ok(_) => {}
        Err(error) => {
            log::warn!(
                "Failed to sync remote workspace alias after ssh_save_connection: connection_id={}, error={}",
                config.id,
                error
            );
        }
    }
    Ok(())
}

// @backend-command
pub async fn ssh_delete_connection(
    state: State<'_, AppState>,
    connection_id: String,
) -> Result<(), String> {
    let manager = state.get_ssh_manager_async().await?;
    manager
        .delete_saved_connection(&connection_id)
        .await
        .map_err(|e| e.to_string())
}

// @backend-command
pub async fn ssh_has_stored_password(
    state: State<'_, AppState>,
    connection_id: String,
) -> Result<bool, String> {
    let manager = state.get_ssh_manager_async().await?;
    Ok(manager.has_stored_password(&connection_id).await)
}

// @backend-command
pub async fn ssh_connect(
    app: HostHandle,
    state: State<'_, AppState>,
    mut config: SSHConnectionConfig,
) -> Result<SSHConnectionResult, String> {
    log::info!(
        "ssh_connect called: id={}, host={}, port={}, username={}",
        config.id,
        config.host,
        config.port,
        config.username
    );

    let manager = match state.get_ssh_manager_async().await {
        Ok(m) => {
            log::info!("ssh_connect: got SSH manager OK");
            m
        }
        Err(e) => {
            log::error!("ssh_connect: failed to get SSH manager: {}", e);
            return Err(e.to_string());
        }
    };

    hydrate_stored_password(&manager, &mut config).await?;

    log::info!("ssh_connect: about to establish connection");
    let config_to_save = config.clone();
    let result = manager.connect(config).await.map_err(|e| e.to_string());
    if result.as_ref().is_ok_and(|connected| connected.success) {
        log::info!("ssh_connect: about to save successful connection config");
        if let Err(e) = manager.save_connection(&config_to_save).await {
            log::warn!(
                "ssh_connect: Failed to save successful connection config: {}",
                e
            );
        } else {
            log::info!("ssh_connect: Connection config saved successfully");
            if let Ok(updated) = state
                .workspace_service
                .update_remote_connection_name(&config_to_save.id, &config_to_save.name)
                .await
            {
                if updated > 0 {
                    crate::fleet::refresh_local_now().await;
                }
            }
        }
    }
    log::info!("ssh_connect result: {:?}", result);
    if let Ok(connected) = &result {
        if connected.success {
            // A connect made by a client (the credential prompt, a new host)
            // is supervised like one the backend restored.
            let supervisor = remote_link_supervisor(&app, &state);
            supervisor.mark_connected(&config_to_save.id);
            if let Some(resolved) = connected
                .connection_id
                .as_deref()
                .filter(|id| !id.is_empty() && *id != config_to_save.id)
            {
                supervisor.mark_connected(resolved);
            }
        }
    }
    result
}

// @backend-command
pub async fn ssh_test_connection(
    state: State<'_, AppState>,
    mut config: SSHConnectionConfig,
) -> Result<ConnectionTestReport, String> {
    let manager = state.get_ssh_manager_async().await?;
    hydrate_stored_password(&manager, &mut config).await?;
    Ok(manager.test_connection(&config).await)
}

// @backend-command
pub async fn ssh_list_docker_containers(
    state: State<'_, AppState>,
    mut config: SSHConnectionConfig,
) -> Result<Vec<DockerContainerInfo>, String> {
    let manager = state.get_ssh_manager_async().await?;
    hydrate_stored_password(&manager, &mut config).await?;
    manager
        .list_docker_containers_for_config(&config)
        .await
        .map_err(|error| error.to_string())
}

// @backend-command
pub async fn ssh_disconnect(
    app: HostHandle,
    state: State<'_, AppState>,
    connection_id: String,
) -> Result<(), String> {
    let manager = state.get_ssh_manager_async().await?;
    remote_link_supervisor(&app, &state).forget(&connection_id);
    // Tear the forwards down first. They are listeners whose only meaning is
    // this session, and leaving one running would let a later connection on it
    // reconnect the host the user just closed.
    state
        .port_forward_manager
        .stop_for_connection(&connection_id)
        .await;
    manager
        .disconnect(&connection_id)
        .await
        .map_err(|e| e.to_string())
}

// @backend-command
pub async fn ssh_disconnect_all(app: HostHandle, state: State<'_, AppState>) -> Result<(), String> {
    let manager = state.get_ssh_manager_async().await?;
    remote_link_supervisor(&app, &state).forget_all();
    state.port_forward_manager.stop_all().await;
    manager.disconnect_all().await;
    Ok(())
}

// @backend-command
pub async fn ssh_is_connected(
    state: State<'_, AppState>,
    connection_id: String,
) -> Result<bool, String> {
    let manager = state.get_ssh_manager_async().await?;
    let is_connected = manager.is_connected(&connection_id).await;
    log::info!(
        "ssh_is_connected: connection_id={}, is_connected={}",
        connection_id,
        is_connected
    );
    Ok(is_connected)
}

// @backend-command
pub async fn ssh_get_server_info(
    state: State<'_, AppState>,
    connection_id: String,
) -> Result<Option<ServerInfo>, String> {
    let manager = state.get_ssh_manager_async().await?;
    Ok(manager.resolve_remote_home_if_missing(&connection_id).await)
}

// @backend-command
pub async fn ssh_get_config(
    state: State<'_, AppState>,
    host: String,
) -> Result<SSHConfigLookupResult, String> {
    let manager = state.get_ssh_manager_async().await?;
    Ok(manager.get_ssh_config(&host).await)
}

// @backend-command
pub async fn ssh_list_config_hosts(
    state: State<'_, AppState>,
) -> Result<Vec<SSHConfigEntry>, String> {
    let manager = state.get_ssh_manager_async().await?;
    Ok(manager.list_ssh_config_hosts().await)
}

// === Remote File System Operations ===

// @backend-command
pub async fn remote_read_file(
    state: State<'_, AppState>,
    connection_id: String,
    path: String,
) -> Result<String, String> {
    let remote_fs = state.get_remote_file_service_async().await?;
    let bytes = remote_fs
        .read_file(&connection_id, &path)
        .await
        .map_err(|e| e.to_string())?;
    String::from_utf8(bytes).map_err(|e| e.to_string())
}

// @backend-command
pub async fn remote_write_file(
    state: State<'_, AppState>,
    connection_id: String,
    path: String,
    content: String,
) -> Result<(), String> {
    let remote_fs = state.get_remote_file_service_async().await?;
    remote_fs
        .write_file(&connection_id, &path, content.as_bytes())
        .await
        .map_err(|e| e.to_string())
}

// @backend-command
pub async fn remote_exists(
    state: State<'_, AppState>,
    connection_id: String,
    path: String,
) -> Result<bool, String> {
    let remote_fs = state.get_remote_file_service_async().await?;
    remote_fs
        .exists(&connection_id, &path)
        .await
        .map_err(|e| e.to_string())
}

// @backend-command
pub async fn remote_read_dir(
    state: State<'_, AppState>,
    connection_id: String,
    path: String,
) -> Result<Vec<openbitfun_core::service::remote_ssh::RemoteDirEntry>, String> {
    let remote_fs = state.get_remote_file_service_async().await?;
    remote_fs
        .read_dir(&connection_id, &path)
        .await
        .map_err(|e| e.to_string())
}

// @backend-command
pub async fn remote_get_tree(
    state: State<'_, AppState>,
    connection_id: String,
    path: String,
    depth: Option<u32>,
) -> Result<RemoteTreeNode, String> {
    let remote_fs = state.get_remote_file_service_async().await?;
    remote_fs
        .build_tree(&connection_id, &path, depth)
        .await
        .map_err(|e| e.to_string())
}

// @backend-command
pub async fn remote_create_dir(
    state: State<'_, AppState>,
    connection_id: String,
    path: String,
    recursive: bool,
) -> Result<(), String> {
    let remote_fs = state.get_remote_file_service_async().await?;
    if recursive {
        remote_fs.create_dir_all(&connection_id, &path).await
    } else {
        remote_fs.create_dir(&connection_id, &path).await
    }
    .map_err(|e| e.to_string())
}

// @backend-command
pub async fn remote_remove(
    state: State<'_, AppState>,
    connection_id: String,
    path: String,
    recursive: bool,
) -> Result<(), String> {
    let remote_fs = state.get_remote_file_service_async().await?;
    if recursive {
        remote_fs.remove_dir_all(&connection_id, &path).await
    } else {
        // A non-recursive request must never delete directory contents. Use
        // no-follow metadata so directory links are unlinked as files, and
        // preserve metadata errors instead of guessing the path's type.
        let entry = remote_fs
            .symlink_stat(&connection_id, &path)
            .await
            .map_err(|error| error.to_string())?
            .ok_or_else(|| format!("Remote path does not exist: {path}"))?;
        if entry.is_dir && !entry.is_symlink {
            remote_fs.remove_dir(&connection_id, &path).await
        } else {
            remote_fs.remove_file(&connection_id, &path).await
        }
    }
    .map_err(|e| e.to_string())
}

// @backend-command
pub async fn remote_rename(
    state: State<'_, AppState>,
    connection_id: String,
    old_path: String,
    new_path: String,
) -> Result<(), String> {
    let remote_fs = state.get_remote_file_service_async().await?;
    remote_fs
        .rename(&connection_id, &old_path, &new_path)
        .await
        .map_err(|e| e.to_string())
}

/// Bytes read or written per transfer step. Matches the chunk the remote file
/// service uses, so one progress step is one protocol round trip.
const TRANSFER_CHUNK_BYTES: usize = 256 * 1024;

/// Progress events are throttled to one per interval, plus the terminal event.
const TRANSFER_PROGRESS_INTERVAL_MS: u128 = 100;

/// Cancellation and cooperative abort share one message so a user-initiated
/// stop is recognizable on every transfer path.
const TRANSFER_CANCELLED: &str = "Transfer cancelled";

/// Cancellation registry shared with the `cancel_transfer` command.
type TransferRegistry = Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>;

/// One in-flight transfer's cancellation slot.
///
/// The entry is removed on every exit path — including `?` early returns and
/// panics — so a failed or rejected transfer cannot leave a stale flag behind
/// that would abort a later transfer reusing the same id.
struct ActiveTransfer {
    registry: TransferRegistry,
    transfer_id: String,
    cancel_flag: Arc<AtomicBool>,
}

impl ActiveTransfer {
    fn register(registry: &TransferRegistry, transfer_id: &str) -> Result<Self, String> {
        let cancel_flag = Arc::new(AtomicBool::new(false));
        registry
            .lock()
            .map_err(|error| error.to_string())?
            .insert(transfer_id.to_string(), cancel_flag.clone());
        Ok(Self {
            registry: registry.clone(),
            transfer_id: transfer_id.to_string(),
            cancel_flag,
        })
    }

    fn is_cancelled(&self) -> bool {
        self.cancel_flag.load(Ordering::Relaxed)
    }
}

impl Drop for ActiveTransfer {
    fn drop(&mut self) {
        let Ok(mut registry) = self.registry.lock() else {
            return;
        };
        // A reused id may already belong to a newer transfer; only this
        // transfer's own flag may be removed.
        if registry
            .get(&self.transfer_id)
            .is_some_and(|flag| Arc::ptr_eq(flag, &self.cancel_flag))
        {
            registry.remove(&self.transfer_id);
        }
    }
}

/// Emit a throttled progress event; `terminal` always emits.
fn emit_transfer_progress(
    app_handle: &HostHandle,
    event: &str,
    payload: impl Serialize + Clone,
    last_emit: &mut Instant,
    terminal: bool,
) {
    let now = Instant::now();
    if !terminal && now.duration_since(*last_emit).as_millis() < TRANSFER_PROGRESS_INTERVAL_MS {
        return;
    }
    *last_emit = now;
    let _ = app_handle.emit(event, payload);
}

fn emit_download_progress(
    app_handle: &HostHandle,
    transfer_id: &str,
    downloaded: u64,
    total: u64,
    last_emit: &mut Instant,
    terminal: bool,
) {
    emit_transfer_progress(
        app_handle,
        "download_progress",
        DownloadProgressPayload {
            transfer_id: transfer_id.to_string(),
            downloaded,
            total,
        },
        last_emit,
        terminal,
    );
}

/// Local staging for a streamed remote download.
///
/// Bytes land in a private temporary file beside the destination and replace it
/// only after the transfer completed, so a cancelled or failed download never
/// truncates an existing local file. This mirrors the controller-local peer
/// sink in [`crate::api::local_file_download`].
struct LocalDownloadStaging {
    file: tokio::fs::File,
    temp_path: tempfile::TempPath,
    destination: PathBuf,
}

impl LocalDownloadStaging {
    async fn begin(destination: &Path) -> Result<Self, String> {
        let parent = destination
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
            .unwrap_or_else(|| Path::new("."));
        tokio::fs::create_dir_all(parent).await.map_err(|error| {
            format!(
                "Failed to prepare local download directory '{}': {}",
                parent.display(),
                error
            )
        })?;
        let (file, temp_path) = tempfile::Builder::new()
            .prefix(".openbitfun-download-")
            .tempfile_in(parent)
            .map_err(|error| {
                format!(
                    "Failed to stage local download beside '{}': {}",
                    destination.display(),
                    error
                )
            })?
            .into_parts();
        Ok(Self {
            file: tokio::fs::File::from_std(file),
            temp_path,
            destination: destination.to_path_buf(),
        })
    }

    async fn write(&mut self, chunk: &[u8]) -> Result<(), String> {
        use tokio::io::AsyncWriteExt;
        self.file.write_all(chunk).await.map_err(|error| {
            format!(
                "Failed to write local download '{}': {}",
                self.destination.display(),
                error
            )
        })
    }

    async fn publish(self) -> Result<(), String> {
        let Self {
            file,
            temp_path,
            destination,
        } = self;
        file.sync_all().await.map_err(|error| {
            format!(
                "Failed to flush local download '{}': {}",
                destination.display(),
                error
            )
        })?;
        drop(file);
        let failure_path = destination.clone();
        tokio::task::spawn_blocking(move || temp_path.persist(&destination))
            .await
            .map_err(|error| error.to_string())?
            .map_err(|error| {
                format!(
                    "Failed to publish local download '{}': {}",
                    failure_path.display(),
                    error
                )
            })
    }
}

/// Stream one remote file into a staged local file and publish it.
///
/// `on_progress` receives the bytes read for this file after every chunk; the
/// caller owns throttling and the cumulative total it reports to the frontend.
/// The remote reader bounds every protocol request, so a cancelled transfer
/// stops at the next chunk boundary instead of waiting for the whole file.
async fn download_remote_file_to_local(
    remote_fs: &openbitfun_core::service::remote_ssh::RemoteFileService,
    connection_id: &str,
    remote_path: &str,
    destination: &Path,
    transfer: &ActiveTransfer,
    on_progress: &mut impl FnMut(u64),
) -> Result<u64, String> {
    let mut reader = remote_fs
        .open_read(connection_id, remote_path)
        .await
        .map_err(|error| format!("Failed to open remote file '{remote_path}': {error}"))?;
    let mut staging = LocalDownloadStaging::begin(destination).await?;
    let mut buffer = vec![0_u8; TRANSFER_CHUNK_BYTES];
    let mut downloaded = 0_u64;
    loop {
        if transfer.is_cancelled() {
            return Err(TRANSFER_CANCELLED.to_string());
        }
        use tokio::io::AsyncReadExt;
        let read = reader
            .read(&mut buffer)
            .await
            .map_err(|error| format!("Failed to read remote file '{remote_path}': {error}"))?;
        if read == 0 {
            break;
        }
        staging.write(&buffer[..read]).await?;
        downloaded = downloaded.saturating_add(read as u64);
        on_progress(downloaded);
    }
    // Stop can arrive during the final read (including an empty file). Do not
    // replace a destination after that stop just because the stream reached EOF.
    if transfer.is_cancelled() {
        return Err(TRANSFER_CANCELLED.to_string());
    }
    staging.publish().await?;
    Ok(downloaded)
}

/// Remote file size used only to keep the reported percentage sane; the actual
/// byte count always comes from the stream.
async fn remote_declared_size(
    remote_fs: &openbitfun_core::service::remote_ssh::RemoteFileService,
    connection_id: &str,
    remote_path: &str,
) -> u64 {
    remote_fs
        .workspace_metadata(connection_id, remote_path, true)
        .await
        .ok()
        .flatten()
        .and_then(|metadata| metadata.size)
        .unwrap_or(0)
}

/// Payload emitted via `download_progress` events during a remote download.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgressPayload {
    pub transfer_id: String,
    pub downloaded: u64,
    pub total: u64,
}

/// Read a remote file or directory and stream it to a local path.
///
/// If `remote_path` is a file, its bytes are streamed to `local_path`
/// (binary-safe) through a staged temporary file that replaces the destination
/// only after the transfer completed. If it is a directory, the directory tree
/// is recreated locally: subdirectories are created with `create_dir_all`, and
/// each file is streamed the same way.
///
/// Emits `download_progress` events with `{ transferId, downloaded, total }`
/// (bytes) during the read so the frontend can render a determinate progress
/// bar with speed display. The `transfer_id` lets the frontend distinguish
/// concurrent downloads and cancel individual transfers. Events are throttled
/// to at most one per 100 ms (plus a guaranteed final event) to avoid flooding
/// the webview.
// @backend-command
pub async fn remote_download_to_local_path(
    app_handle: HostHandle,
    state: State<'_, AppState>,
    connection_id: String,
    remote_path: String,
    local_path: String,
    transfer_id: String,
) -> Result<(), String> {
    let transfer = ActiveTransfer::register(&state.active_transfers, &transfer_id)?;
    let remote_fs = state.get_remote_file_service_async().await?;
    let mut last_emit = Instant::now();

    // Check if the remote path is a directory.
    let is_dir = remote_fs
        .is_dir(&connection_id, &remote_path)
        .await
        .map_err(|e| e.to_string())?;

    if is_dir {
        return download_directory_from_remote(
            &app_handle,
            &state,
            &connection_id,
            &remote_path,
            &local_path,
            &transfer_id,
            &transfer,
            &mut last_emit,
        )
        .await;
    }

    let declared_total = remote_declared_size(&remote_fs, &connection_id, &remote_path).await;
    let downloaded = download_remote_file_to_local(
        &remote_fs,
        &connection_id,
        &remote_path,
        Path::new(&local_path),
        &transfer,
        &mut |downloaded| {
            // A file that grew while it was being read must not report over 100%.
            emit_download_progress(
                &app_handle,
                &transfer_id,
                downloaded,
                declared_total.max(downloaded),
                &mut last_emit,
                false,
            );
        },
    )
    .await?;
    emit_download_progress(
        &app_handle,
        &transfer_id,
        downloaded,
        declared_total.max(downloaded),
        &mut last_emit,
        true,
    );
    Ok(())
}

fn validate_remote_name_for_local_download(name: &str) -> Result<(), String> {
    if name.is_empty() || matches!(name, "." | "..") || name.contains('/') || name.contains('\0') {
        return Err(format!(
            "Remote entry name cannot be represented as a local path component: {:?}",
            name
        ));
    }
    #[cfg(windows)]
    {
        if name.chars().any(|character| {
            matches!(character, '<' | '>' | '"' | ':' | '\\' | '|' | '?' | '*')
                || character.is_control()
        }) || name.ends_with('.')
            || name.ends_with(' ')
        {
            return Err(format!(
                "Remote entry name is not supported by Windows filesystems: {:?}",
                name
            ));
        }
        let stem = name
            .split('.')
            .next()
            .unwrap_or_default()
            .to_ascii_uppercase();
        if matches!(
            stem.as_str(),
            "CON"
                | "PRN"
                | "AUX"
                | "NUL"
                | "COM1"
                | "COM2"
                | "COM3"
                | "COM4"
                | "COM5"
                | "COM6"
                | "COM7"
                | "COM8"
                | "COM9"
                | "LPT1"
                | "LPT2"
                | "LPT3"
                | "LPT4"
                | "LPT5"
                | "LPT6"
                | "LPT7"
                | "LPT8"
                | "LPT9"
        ) {
            return Err(format!(
                "Remote entry name is reserved by Windows: {:?}",
                name
            ));
        }
    }
    Ok(())
}

fn local_download_name_key(name: &str) -> String {
    #[cfg(any(windows, target_os = "macos"))]
    {
        name.trim_end_matches(['.', ' ']).to_lowercase()
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        name.to_string()
    }
}

/// Recursively download a remote directory to a local path.
///
/// Pre-scans the remote tree to determine total file size, then walks the tree
/// and streams each file through a staged local file. Emits cumulative
/// `download_progress` events so the frontend can show overall directory
/// download progress.
#[allow(clippy::too_many_arguments)]
async fn download_directory_from_remote(
    app_handle: &HostHandle,
    state: &State<'_, AppState>,
    connection_id: &str,
    remote_dir: &str,
    local_dir: &str,
    transfer_id: &str,
    transfer: &ActiveTransfer,
    last_emit: &mut Instant,
) -> Result<(), String> {
    let remote_fs = state.get_remote_file_service_async().await?;

    // Create the top-level local directory.
    let local_dir_path = PathBuf::from(local_dir);
    tokio::task::spawn_blocking(move || {
        std::fs::create_dir_all(&local_dir_path).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;

    // Pre-scan the remote directory to determine total bytes for progress reporting.
    let mut total_bytes: u64 = 0;
    let mut scan_stack = vec![remote_dir.to_string()];
    while let Some(current) = scan_stack.pop() {
        if transfer.is_cancelled() {
            return Err(TRANSFER_CANCELLED.to_string());
        }
        let entries = remote_fs
            .read_dir(connection_id, &current)
            .await
            .map_err(|e| e.to_string())?;
        for entry in entries {
            if transfer.is_cancelled() {
                return Err(TRANSFER_CANCELLED.to_string());
            }
            validate_remote_name_for_local_download(&entry.name)?;
            if entry.is_symlink {
                return Err(format!(
                    "Symbolic links are not supported in directory downloads: '{}'",
                    entry.path
                ));
            }
            if entry.is_dir {
                scan_stack.push(entry.path);
            } else if let Some(size) = entry.size {
                total_bytes += size;
            }
        }
    }

    let mut downloaded: u64 = 0;

    // Walk the remote directory tree.
    let mut stack: Vec<(String, PathBuf)> =
        vec![(remote_dir.to_string(), PathBuf::from(local_dir))];

    while let Some((remote_current, local_current)) = stack.pop() {
        if transfer.is_cancelled() {
            return Err(TRANSFER_CANCELLED.to_string());
        }

        let entries = remote_fs
            .read_dir(connection_id, &remote_current)
            .await
            .map_err(|e| e.to_string())?;
        let mut local_name_keys = std::collections::HashSet::new();

        for entry in entries {
            validate_remote_name_for_local_download(&entry.name)?;
            if entry.is_symlink {
                return Err(format!(
                    "Symbolic links are not supported in directory downloads: '{}'",
                    entry.path
                ));
            }
            if !local_name_keys.insert(local_download_name_key(&entry.name)) {
                return Err(format!(
                    "Remote directory contains names that collide on the local filesystem: {:?}",
                    entry.name
                ));
            }
            let remote_child = entry.path;
            let local_child = local_current.join(&entry.name);

            if entry.is_dir {
                tokio::task::spawn_blocking({
                    let local_child = local_child.clone();
                    move || std::fs::create_dir_all(&local_child).map_err(|e| e.to_string())
                })
                .await
                .map_err(|e| e.to_string())??;
                stack.push((remote_child, local_child));
            } else {
                let base_downloaded = downloaded;
                let file_size = download_remote_file_to_local(
                    &remote_fs,
                    connection_id,
                    &remote_child,
                    &local_child,
                    transfer,
                    &mut |file_bytes| {
                        let cumulative = base_downloaded.saturating_add(file_bytes);
                        emit_download_progress(
                            app_handle,
                            transfer_id,
                            cumulative,
                            total_bytes.max(cumulative),
                            last_emit,
                            false,
                        );
                    },
                )
                .await?;

                downloaded = base_downloaded.saturating_add(file_size);
                emit_download_progress(
                    app_handle,
                    transfer_id,
                    downloaded,
                    total_bytes.max(downloaded),
                    last_emit,
                    true,
                );
            }
        }
    }

    Ok(())
}

/// Result of uploading a local path to a remote server.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteUploadResult {
    pub was_directory: bool,
}

/// Payload emitted via `upload_progress` events during a remote upload.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadProgressPayload {
    pub transfer_id: String,
    pub uploaded: u64,
    pub total: u64,
}

fn emit_upload_progress(
    app_handle: &HostHandle,
    transfer_id: &str,
    uploaded: u64,
    total: u64,
    last_emit: &mut Instant,
    terminal: bool,
) {
    emit_transfer_progress(
        app_handle,
        "upload_progress",
        UploadProgressPayload {
            transfer_id: transfer_id.to_string(),
            uploaded,
            total,
        },
        last_emit,
        terminal,
    );
}

/// Recursively scan a local directory and return the total size of all
/// regular files in bytes. Used for pre-scanning before directory upload
/// so that overall progress can be reported.
fn scan_directory_total_size(dir: &std::path::Path) -> Result<u64, String> {
    let mut total: u64 = 0;
    let mut stack = vec![dir.to_path_buf()];
    while let Some(current) = stack.pop() {
        let entries = std::fs::read_dir(&current).map_err(|error| {
            format!(
                "Failed to scan local upload directory '{}': {}",
                current.display(),
                error
            )
        })?;
        for entry in entries {
            let entry = entry.map_err(|error| error.to_string())?;
            let path = entry.path();
            let file_type = entry.file_type().map_err(|error| error.to_string())?;
            if file_type.is_symlink() {
                return Err(format!(
                    "Symbolic links are not supported in directory uploads: '{}'",
                    path.display()
                ));
            }
            if file_type.is_dir() {
                stack.push(path);
            } else if file_type.is_file() {
                total = total
                    .saturating_add(entry.metadata().map_err(|error| error.to_string())?.len());
            } else {
                return Err(format!(
                    "Unsupported local entry type in directory upload: '{}'",
                    path.display()
                ));
            }
        }
    }
    Ok(total)
}

/// Upload a local file or directory tree to a remote path.
///
/// If `local_path` is a file, its bytes are streamed to `remote_path` without
/// buffering the file in memory. If it is a directory, the directory tree is
/// recreated on the remote side: subdirectories are created with
/// `create_dir_all`, and each file is streamed the same way.
///
/// An upload stages its bytes on the remote side and publishes them only after
/// the transfer completed, so a cancelled or failed upload never truncates a
/// valid destination with partial content.
///
/// Emits `upload_progress` events with `{ transferId, uploaded, total }`
/// (bytes) during the write so the frontend can render a determinate progress
/// bar with speed display. The `transfer_id` lets the frontend distinguish
/// concurrent uploads and cancel individual transfers. Events are throttled to
/// at most one per 100 ms (plus a guaranteed final event).
// @backend-command
pub async fn remote_upload_from_local_path(
    app_handle: HostHandle,
    state: State<'_, AppState>,
    connection_id: String,
    local_path: String,
    remote_path: String,
    transfer_id: String,
) -> Result<RemoteUploadResult, String> {
    let transfer = ActiveTransfer::register(&state.active_transfers, &transfer_id)?;
    let local_path = std::path::Path::new(&local_path);
    let local_metadata = std::fs::symlink_metadata(local_path).map_err(|error| {
        format!(
            "Failed to inspect local upload path '{}': {}",
            local_path.display(),
            error
        )
    })?;
    if local_metadata.file_type().is_symlink() {
        return Err(format!(
            "Symbolic links are not supported for upload: '{}'",
            local_path.display()
        ));
    }
    if !local_metadata.is_dir() && !local_metadata.is_file() {
        return Err(format!(
            "Unsupported local upload path type: '{}'",
            local_path.display()
        ));
    }

    // A directory needs to be walked locally and recreated on the remote side.
    if local_path.is_dir() {
        upload_directory_to_remote(
            &app_handle,
            &state,
            &connection_id,
            local_path,
            &remote_path,
            &transfer_id,
            &transfer,
        )
        .await?;
        return Ok(RemoteUploadResult {
            was_directory: true,
        });
    }

    // Regular file: stream it to the remote without buffering it in memory.
    let remote_fs = state.get_remote_file_service_async().await?;
    let mut last_emit = Instant::now();
    remote_fs
        .write_file_from_local_path_with_progress(
            &connection_id,
            &remote_path,
            local_path,
            &mut |written, total| {
                emit_upload_progress(
                    &app_handle,
                    &transfer_id,
                    written,
                    total,
                    &mut last_emit,
                    written >= total,
                );
                !transfer.is_cancelled()
            },
        )
        .await
        .map_err(|e| e.to_string())?;

    Ok(RemoteUploadResult {
        was_directory: false,
    })
}

/// Recursively upload a local directory to a remote path.
///
/// Pre-scans the directory to determine total file size, then walks the tree
/// and uploads each file with chunked progress reporting. Emits cumulative
/// `upload_progress` events so the frontend can show overall directory upload
/// progress.
async fn upload_directory_to_remote(
    app_handle: &HostHandle,
    state: &State<'_, AppState>,
    connection_id: &str,
    local_dir: &std::path::Path,
    remote_dir: &str,
    transfer_id: &str,
    transfer: &ActiveTransfer,
) -> Result<(), String> {
    let remote_fs = state.get_remote_file_service_async().await?;

    // Create the top-level remote directory.
    remote_fs
        .create_dir_all(connection_id, remote_dir)
        .await
        .map_err(|e| e.to_string())?;

    // Pre-scan the directory to determine total bytes for progress reporting.
    let local_dir_owned = local_dir.to_path_buf();
    let total_bytes =
        tokio::task::spawn_blocking(move || scan_directory_total_size(&local_dir_owned))
            .await
            .map_err(|e| e.to_string())??;

    let mut uploaded: u64 = 0;
    let mut last_emit = Instant::now();

    // Walk the local directory tree.
    let mut stack: Vec<(std::path::PathBuf, String)> =
        vec![(local_dir.to_path_buf(), remote_dir.to_string())];

    while let Some((local_current, remote_current)) = stack.pop() {
        let entries = tokio::task::spawn_blocking(move || {
            std::fs::read_dir(&local_current)
                .map_err(|e| e.to_string())
                .and_then(|dir| {
                    dir.collect::<Result<Vec<_>, _>>()
                        .map_err(|e| e.to_string())
                })
        })
        .await
        .map_err(|e| e.to_string())??;

        for entry in entries {
            if transfer.is_cancelled() {
                return Err(TRANSFER_CANCELLED.to_string());
            }
            let entry_path = entry.path();
            let file_name = entry.file_name().into_string().map_err(|name| {
                format!(
                    "Local entry name is not valid UTF-8 and cannot be represented in a remote workspace: {:?}",
                    name
                )
            })?;
            let file_type = entry.file_type().map_err(|error| error.to_string())?;
            if file_type.is_symlink() {
                return Err(format!(
                    "Symbolic links are not supported in directory uploads: '{}'",
                    entry_path.display()
                ));
            }
            let remote_child = if remote_current.ends_with('/') {
                format!("{}{}", remote_current, file_name)
            } else {
                format!("{}/{}", remote_current, file_name)
            };

            if file_type.is_dir() {
                remote_fs
                    .create_dir_all(connection_id, &remote_child)
                    .await
                    .map_err(|e| e.to_string())?;
                stack.push((entry_path, remote_child));
            } else if file_type.is_file() {
                let base_uploaded = uploaded;
                let file_size = remote_fs
                    .write_file_from_local_path_with_progress(
                        connection_id,
                        &remote_child,
                        &entry_path,
                        &mut |written, _| {
                            let cumulative = base_uploaded.saturating_add(written);
                            emit_upload_progress(
                                app_handle,
                                transfer_id,
                                cumulative,
                                total_bytes.max(cumulative),
                                &mut last_emit,
                                false,
                            );
                            !transfer.is_cancelled()
                        },
                    )
                    .await
                    .map_err(|e| e.to_string())?;

                uploaded = base_uploaded.saturating_add(file_size);
                emit_upload_progress(
                    app_handle,
                    transfer_id,
                    uploaded,
                    total_bytes.max(uploaded),
                    &mut last_emit,
                    true,
                );
            } else {
                return Err(format!(
                    "Unsupported local entry type in directory upload: '{}'",
                    entry_path.display()
                ));
            }
        }
    }

    Ok(())
}

/// Cancel an in-progress file transfer by setting its cancellation flag.
///
/// The transfer will abort at the next chunk boundary and the original
/// download/upload command will return an error.
// @backend-command
pub async fn cancel_transfer(
    state: State<'_, AppState>,
    transfer_id: String,
) -> Result<(), String> {
    let map = state.active_transfers.lock().map_err(|e| e.to_string())?;
    if let Some(flag) = map.get(&transfer_id) {
        flag.store(true, Ordering::Relaxed);
    }
    Ok(())
}

// @backend-command
pub async fn remote_execute(
    state: State<'_, AppState>,
    connection_id: String,
    command: String,
) -> Result<(String, String, i32), String> {
    let manager = state.get_ssh_manager_async().await?;
    manager
        .execute_command(&connection_id, &command)
        .await
        .map_err(|e| e.to_string())
}

// === Remote Workspace Management ===

// @backend-command
pub async fn remote_open_workspace(
    state: State<'_, AppState>,
    connection_id: String,
    remote_path: String,
) -> Result<(), String> {
    activate_remote_workspace(&state, connection_id, remote_path).await
}

/// Makes `remote_path` on a connected `connection_id` the active remote
/// workspace (the body of `remote_open_workspace`).
async fn activate_remote_workspace(
    state: &AppState,
    connection_id: String,
    remote_path: String,
) -> Result<(), String> {
    let remote_path =
        openbitfun_core::service::remote_ssh::normalize_remote_workspace_path(&remote_path);
    let manager = state.get_ssh_manager_async().await?;

    // Verify connection exists
    if !manager.is_connected(&connection_id).await {
        return Err("Not connected to remote server".to_string());
    }

    // Verify remote path exists
    let remote_fs = state.get_remote_file_service_async().await?;
    let exists = remote_fs
        .exists(&connection_id, &remote_path)
        .await
        .map_err(|e| e.to_string())?;

    if !exists {
        return Err(format!("Remote path does not exist: {}", remote_path));
    }

    // Get connection info for workspace
    let connections = manager.get_saved_connections().await;
    let conn = connections.iter().find(|c| c.id == connection_id);

    let ssh_host = manager
        .get_connection_config(&connection_id)
        .await
        .map(|c| c.host)
        .unwrap_or_default();

    let workspace = crate::api::RemoteWorkspace {
        connection_id: connection_id.clone(),
        connection_name: conn.map(|c| c.name.clone()).unwrap_or_default(),
        remote_path: remote_path.clone(),
        ssh_host,
    };

    state
        .set_remote_workspace(workspace)
        .await
        .map_err(|e| e.to_string())?;

    log::info!(
        "Opened remote workspace: {} on connection {}",
        remote_path,
        connection_id
    );
    Ok(())
}

// @backend-command
pub async fn remote_close_workspace(state: State<'_, AppState>) -> Result<(), String> {
    state.clear_remote_workspace().await;
    log::info!("Closed remote workspace");
    Ok(())
}

// @backend-command
pub async fn remote_remove_workspace(
    state: State<'_, AppState>,
    connection_id: String,
    remote_path: String,
) -> Result<(), String> {
    state
        .unregister_remote_workspace_entry(&connection_id, &remote_path)
        .await;
    log::info!(
        "Removed remote workspace restore entry: connection_id={}, remote_path={}",
        connection_id,
        remote_path
    );
    Ok(())
}

// @backend-command
pub async fn remote_get_workspace_info(
    state: State<'_, AppState>,
    startup_trace: State<'_, DesktopStartupTrace>,
) -> Result<Option<crate::api::RemoteWorkspace>, String> {
    let trace_started = Instant::now();
    let workspace = state.get_remote_workspace_async().await;
    log::info!("remote_get_workspace_info: returning {:?}", workspace);
    startup_trace.record_command_elapsed("remote_get_workspace_info", None, trace_started);
    Ok(workspace)
}

// === Remote workspace link (logic batch 5) ===
//
// The backend owns liveness, reconnect and backoff for remote workspaces
// (`remote_ssh::link_supervisor`); clients call `remote_workspace_ensure_connected`
// and render `remote://link-state`.

/// The supervisor's view of the SSH manager, which is created after startup.
struct DesktopSshLinkTransport {
    manager: Arc<tokio::sync::RwLock<Option<SSHConnectionManager>>>,
}

impl DesktopSshLinkTransport {
    async fn manager(&self) -> Result<SSHConnectionManager, String> {
        self.manager
            .read()
            .await
            .clone()
            .ok_or_else(|| SSHServiceError::ManagerNotInitialized.to_string())
    }
}

#[async_trait::async_trait]
impl RemoteLinkTransport for DesktopSshLinkTransport {
    async fn probe(&self, connection_id: &str) -> Result<bool, String> {
        self.manager().await?.probe(connection_id).await
    }

    async fn readiness(&self, connection_id: &str) -> ReconnectReadiness {
        match self.manager().await {
            Ok(manager) => manager.readiness(connection_id).await,
            Err(_) => ReconnectReadiness::ProfileMissing,
        }
    }

    async fn reconnect(&self, connection_id: &str) -> Result<(), ReconnectError> {
        let manager = self.manager().await.map_err(|message| ReconnectError {
            message,
            needs_credentials: false,
        })?;
        manager.reconnect(connection_id).await
    }
}

static REMOTE_LINK_SUPERVISOR: std::sync::OnceLock<RemoteLinkSupervisor> =
    std::sync::OnceLock::new();

/// The process's link supervisor; its states are emitted on `remote://link-state`.
fn remote_link_supervisor(app: &HostHandle, state: &AppState) -> &'static RemoteLinkSupervisor {
    REMOTE_LINK_SUPERVISOR.get_or_init(|| {
        let emitter = app.clone();
        RemoteLinkSupervisor::new(
            Arc::new(DesktopSshLinkTransport {
                manager: state.ssh_manager.clone(),
            }),
            Arc::new(move |link: &RemoteLinkState| {
                if let Err(error) = emitter.emit(REMOTE_LINK_STATE_EVENT, link.clone()) {
                    log::warn!("Failed to emit remote link state: {}", error);
                }
            }),
            RemoteLinkPolicy::default(),
        )
    })
}

fn default_true() -> bool {
    true
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteWorkspaceEnsureConnectedRequest {
    /// The SSH connection to check. Optional when `workspace_id` names a remote workspace.
    #[serde(default)]
    pub connection_id: Option<String>,
    /// A remote workspace; its saved connection and root are used.
    #[serde(default)]
    pub workspace_id: Option<String>,
    /// POSIX root to activate once the link is up (defaults to the workspace's root).
    #[serde(default)]
    pub remote_path: Option<String>,
    /// Activate the remote workspace once connected (default true).
    #[serde(default = "default_true")]
    pub activate: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteWorkspaceEnsureConnectedResponse {
    pub link: RemoteLinkState,
    /// Whether this call made the workspace the active remote workspace.
    pub activated: bool,
}

/// Makes sure the transport behind a remote workspace is up: probes it,
/// reconnects from the saved profile (vault password, key or agent) within the
/// backend's budget and keeps a heartbeat on it. Progress is published on
/// `remote://link-state`; the answer is the state the call ended in. A link
/// that needs credentials ends `failed { reason: auth_required }` so the
/// client can ask the user and reconnect through `ssh_connect`.
// @backend-command
pub async fn remote_workspace_ensure_connected(
    app: HostHandle,
    state: State<'_, AppState>,
    request: RemoteWorkspaceEnsureConnectedRequest,
) -> Result<RemoteWorkspaceEnsureConnectedResponse, String> {
    let mut connection_id = request
        .connection_id
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty());
    let mut remote_path = request
        .remote_path
        .map(|path| path.trim().to_string())
        .filter(|path| !path.is_empty());
    if let Some(workspace_id) = request
        .workspace_id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty())
    {
        let workspace = state
            .workspace_service
            .get_workspace(workspace_id)
            .await
            .ok_or_else(|| format!("Workspace not found: {workspace_id}"))?;
        let workspace_connection = workspace
            .filesystem_connection_id()?
            .ok_or_else(|| {
                format!("remote_workspace_not_remote: workspace {workspace_id} is local")
            })?
            .to_string();
        if connection_id.is_none() {
            connection_id = Some(workspace_connection);
        }
        if remote_path.is_none() {
            // The stored root is the POSIX string the workspace was opened
            // with; it is passed through, never re-joined with host path rules.
            remote_path = Some(workspace.root_path.to_string_lossy().into_owned());
        }
    }
    let connection_id =
        connection_id.ok_or_else(|| "connection_id or workspace_id is required".to_string())?;
    let supervisor = remote_link_supervisor(&app, &state);
    let link = supervisor.ensure(&connection_id).await;
    if link.state != RemoteLinkPhase::Connected || !request.activate {
        return Ok(RemoteWorkspaceEnsureConnectedResponse {
            link,
            activated: false,
        });
    }
    let Some(remote_path) = remote_path else {
        return Ok(RemoteWorkspaceEnsureConnectedResponse {
            link,
            activated: false,
        });
    };
    let normalized =
        openbitfun_core::service::remote_ssh::normalize_remote_workspace_path(&remote_path);
    if is_remote_workspace_registered_and_active(&state, &connection_id, &normalized).await {
        return Ok(RemoteWorkspaceEnsureConnectedResponse {
            link,
            activated: false,
        });
    }
    match activate_remote_workspace(&state, connection_id.clone(), normalized).await {
        Ok(()) => Ok(RemoteWorkspaceEnsureConnectedResponse {
            link,
            activated: true,
        }),
        Err(error) => Ok(RemoteWorkspaceEnsureConnectedResponse {
            link: supervisor.mark_failed(
                &connection_id,
                RemoteLinkFailure::WorkspaceUnavailable,
                Some(error),
            ),
            activated: false,
        }),
    }
}

async fn is_remote_workspace_entry_active(
    slot: Option<&crate::api::RemoteWorkspace>,
    manager: Option<&openbitfun_core::service::remote_ssh::RemoteWorkspaceStateManager>,
    connection_id: &str,
    normalized_path: &str,
) -> bool {
    let slot_matches = slot.is_some_and(|active| {
        active.connection_id == connection_id && active.remote_path == normalized_path
    });
    if !slot_matches {
        return false;
    }
    let Some(manager) = manager else {
        return false;
    };
    manager.get_ssh_manager().await.is_some()
        && manager.get_file_service().await.is_some()
        && manager
            .lookup_scoped_connection(normalized_path, connection_id)
            .await
            .is_some()
}

/// True only when both `AppState::remote_workspace` and the process-wide
/// `RemoteWorkspaceStateManager` hold `(connection_id, normalized_path)` with
/// live SSH and file service handles. A persisted startup slot alone is not
/// enough to skip `activate_remote_workspace`.
async fn is_remote_workspace_registered_and_active(
    state: &AppState,
    connection_id: &str,
    normalized_path: &str,
) -> bool {
    let slot = state.get_remote_workspace_async().await;
    let manager = openbitfun_core::service::remote_ssh::get_remote_workspace_manager();
    is_remote_workspace_entry_active(
        slot.as_ref(),
        manager.as_deref(),
        connection_id,
        normalized_path,
    )
    .await
}

/// The last link state of every connection this backend supervises (a client
/// re-hydrates with it after a reload or an `events-dropped`).
// @backend-command
pub async fn remote_workspace_link_states(
    app: HostHandle,
    state: State<'_, AppState>,
) -> Result<Vec<RemoteLinkState>, String> {
    Ok(remote_link_supervisor(&app, &state).states())
}

// === Port Forwarding ===

/// Start a local (`-L`) forward and return the mapping that was established.
///
/// The returned `localPort` is not always the requested one: an unavailable
/// port is replaced rather than refused, and `requestedLocalPort` carries what
/// was asked for so the UI can say so.
// @backend-command
pub async fn ssh_start_port_forward(
    state: State<'_, AppState>,
    request: PortForwardRequest,
) -> Result<PortForward, String> {
    log::info!(
        "ssh_start_port_forward: connection={}, remote={}:{}, requested local port={:?}",
        request.connection_id,
        request.effective_remote_host(),
        request.remote_port,
        request.preferred_local_port()
    );
    state
        .port_forward_manager
        .start_local_forward(&request)
        .await
        .map_err(|error| format!("{error:#}"))
}

// @backend-command
pub async fn ssh_stop_port_forward(
    state: State<'_, AppState>,
    forward_id: String,
) -> Result<(), String> {
    state
        .port_forward_manager
        .stop_forward(&forward_id)
        .await
        .map_err(|error| format!("{error:#}"))
}

/// List forwards, optionally narrowed to one connection.
// @backend-command
pub async fn ssh_list_port_forwards(
    state: State<'_, AppState>,
    connection_id: Option<String>,
) -> Result<Vec<PortForward>, String> {
    Ok(match connection_id {
        Some(connection_id) => {
            state
                .port_forward_manager
                .list_forwards_for_connection(&connection_id)
                .await
        }
        None => state.port_forward_manager.list_forwards().await,
    })
}

/// List the TCP ports currently accepting connections on the remote host.
///
/// Discovery only. Nothing is forwarded as a result of calling this; it exists
/// so users can pick a real port instead of guessing one.
// @backend-command
pub async fn ssh_list_remote_listening_ports(
    state: State<'_, AppState>,
    connection_id: String,
) -> Result<Vec<RemoteListeningPort>, String> {
    let manager = state.get_ssh_manager_async().await?;
    list_remote_listening_ports(&manager, &connection_id)
        .await
        .map_err(|error| format!("{error:#}"))
}

#[cfg(test)]
mod tests {
    use super::{
        hydrate_stored_password, local_download_name_key, validate_remote_name_for_local_download,
        ActiveTransfer, LocalDownloadStaging,
    };
    use std::sync::atomic::Ordering;
    use std::sync::{Arc, Mutex};

    #[tokio::test]
    async fn staged_local_download_publishes_only_after_it_completed() {
        let directory = tempfile::tempdir().unwrap();
        let destination = directory.path().join("existing.txt");
        tokio::fs::write(&destination, b"original").await.unwrap();

        // A staging that never publishes keeps the destination and leaves no
        // temporary behind, so a cancelled download cannot corrupt local data.
        {
            let mut staging = LocalDownloadStaging::begin(&destination).await.unwrap();
            staging.write(b"partial").await.unwrap();
        }
        assert_eq!(
            tokio::fs::read(&destination).await.unwrap(),
            b"original".to_vec()
        );
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);

        let mut staging = LocalDownloadStaging::begin(&destination).await.unwrap();
        staging.write(b"complete").await.unwrap();
        staging.publish().await.unwrap();
        assert_eq!(
            tokio::fs::read(&destination).await.unwrap(),
            b"complete".to_vec()
        );
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[test]
    fn active_transfer_registration_is_removed_on_every_exit_path() {
        let registry: super::TransferRegistry = Arc::new(Mutex::new(Default::default()));

        {
            let transfer = ActiveTransfer::register(&registry, "transfer-1").unwrap();
            let map = registry.lock().unwrap();
            assert!(map.contains_key("transfer-1"));
            drop(map);
            drop(transfer);
        }
        // `?` early returns and panics drop the guard the same way.
        assert!(registry.lock().unwrap().is_empty());

        let transfer = ActiveTransfer::register(&registry, "transfer-2").unwrap();
        assert!(!transfer.is_cancelled());
        let flag = {
            let map = registry.lock().unwrap();
            map.get("transfer-2").cloned().unwrap()
        };
        flag.store(true, Ordering::Relaxed);
        assert!(transfer.is_cancelled());

        // A newer transfer reusing the id keeps its own flag when an older
        // guard is dropped afterwards.
        let newer = ActiveTransfer::register(&registry, "transfer-2").unwrap();
        drop(transfer);
        assert!(!newer.is_cancelled());
        assert!(registry.lock().unwrap().contains_key("transfer-2"));
    }

    #[test]
    fn download_names_cannot_escape_the_selected_local_directory() {
        for name in ["", ".", "..", "nested/name", "nul\0name"] {
            assert!(validate_remote_name_for_local_download(name).is_err());
        }
        assert!(validate_remote_name_for_local_download("目录.txt").is_ok());
    }

    #[tokio::test]
    async fn local_docker_profiles_do_not_require_a_legacy_password_vault_entry() {
        use openbitfun_core::service::remote_ssh::{
            ContainerAccess, ContainerWorkspaceConfig, SSHAuthMethod, SSHConnectionConfig,
            SSHConnectionManager,
        };

        let data_dir = tempfile::tempdir().unwrap();
        let manager = SSHConnectionManager::new(data_dir.path().to_path_buf());
        let mut config = SSHConnectionConfig {
            id: "docker-local-legacy".to_string(),
            name: "local container".to_string(),
            host: String::new(),
            port: 22,
            username: String::new(),
            auth: SSHAuthMethod::Password {
                password: String::new(),
            },
            default_workspace: Some("/workspace".to_string()),
            proxy_jump: None,
            proxy_command: None,
            container: Some(ContainerWorkspaceConfig {
                name: "dev".to_string(),
                access: ContainerAccess::DockerExec,
                local: true,
                docker_path: "docker".to_string(),
                shell: "/bin/sh".to_string(),
                user: None,
                interactive: true,
            }),
            wsl: None,
            options: Default::default(),
        };

        hydrate_stored_password(&manager, &mut config)
            .await
            .expect("local Docker must not require an SSH password");
        assert!(matches!(
            config.auth,
            SSHAuthMethod::Password { ref password } if password.is_empty()
        ));
    }

    #[cfg(any(windows, target_os = "macos"))]
    #[test]
    fn download_collision_keys_are_case_insensitive_on_common_local_filesystems() {
        assert_eq!(
            local_download_name_key("Readme.md"),
            local_download_name_key("README.md")
        );
    }

    #[cfg(windows)]
    #[test]
    fn download_names_reject_windows_reserved_components() {
        for name in ["CON", "nul.txt", "bad:name", "trailing."] {
            assert!(validate_remote_name_for_local_download(name).is_err());
        }
    }

    #[tokio::test]
    async fn startup_preloaded_remote_slot_without_registry_entry_is_not_treated_as_active() {
        use openbitfun_core::service::remote_ssh::{
            RemoteFileService, RemoteWorkspaceStateManager, SSHConnectionManager,
        };

        let slot = crate::api::RemoteWorkspace {
            connection_id: "ssh-root@190.92.203.184".to_string(),
            remote_path: "/root/repos".to_string(),
            connection_name: "Prod".to_string(),
            ssh_host: "190.92.203.184".to_string(),
        };

        assert!(
            !super::is_remote_workspace_entry_active(
                Some(&slot),
                None,
                "ssh-root@190.92.203.184",
                "/root/repos",
            )
            .await
        );

        let data_dir = tempfile::tempdir().unwrap();
        let ssh = SSHConnectionManager::new(data_dir.path().to_path_buf());
        let fs = RemoteFileService::new(Arc::new(tokio::sync::RwLock::new(Some(ssh.clone()))));
        let state_manager = RemoteWorkspaceStateManager::new();
        state_manager.set_ssh_manager(ssh).await;
        state_manager.set_file_service(fs).await;
        assert!(
            !super::is_remote_workspace_entry_active(
                Some(&slot),
                Some(&state_manager),
                "ssh-root@190.92.203.184",
                "/root/repos",
            )
            .await
        );

        state_manager
            .register_remote_workspace(
                "/root/repos".to_string(),
                "ssh-root@190.92.203.184".to_string(),
                "Prod".to_string(),
                "190.92.203.184".to_string(),
            )
            .await;
        assert!(
            super::is_remote_workspace_entry_active(
                Some(&slot),
                Some(&state_manager),
                "ssh-root@190.92.203.184",
                "/root/repos",
            )
            .await
        );
    }
}

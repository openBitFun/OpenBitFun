//! In-app updates of the native (NSH) desktop.
//!
//! The native app keeps OpenBitFun's own update channel instead of NSH's
//! package updater: the same release manifests (`latest-v1.json` on GitHub,
//! mirrored on openbitfun.com), the same minisign release key, the same
//! staged-download semantics (download never installs; `pending.json` is
//! committed last; an unreadable record is kept, never deleted) and the same
//! command and event shapes, so the UI's update menu works unchanged.
//!
//! The native bundle is its own installation format: it reads the manifest's
//! `<os>-<arch>-nsh` platform entry (for example `darwin-aarch64-nsh`), keeps
//! its cache apart from the Tauri build's (`app-updates-nsh`), and only an
//! archive whose bundle carries the running executable (`openbitfun-nsh`)
//! can replace it. Release artifact (see
//! `scripts/package-desktop-nsh-macos.mjs --updater-archive`):
//! `OpenBitFun-nsh_<version>_<arch>.app.tar.gz` plus its minisign signature,
//! listed as `platforms["darwin-<arch>-nsh"] = { url, signature }`.

use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use super::{arg_or_default, DispatchFuture};
use crate::api::update_api::{
    self, DownloadCancellation, InstallPendingUpdateRequest, PendingUpdateRecord, CANCEL_DOWNLOAD,
    PROGRESS_EVENT, UPDATE,
};
use crate::host::NativeHost;

/// `package_kind` of a staged native bundle.
const NATIVE_PACKAGE_KIND: &str = "nsh-app";

/// The release key the build was signed for. Packaging passes the public key
/// the Tauri build injects into its updater config (`TAURI_UPDATER_PUBKEY`).
fn release_pubkey() -> Option<&'static str> {
    option_env!("OPENBITFUN_NATIVE_UPDATER_PUBKEY")
        .or(option_env!("TAURI_UPDATER_PUBKEY"))
        .map(str::trim)
        .filter(|key| !key.is_empty())
}

const NO_RELEASE_KEY: &str = "In-app updates are not available in this build: it was not packaged with the release signing key. Download the latest version from openbitfun.com";

/// The manifest platform entry of the native bundle on this machine.
fn platform_key() -> String {
    let os = match std::env::consts::OS {
        "macos" => "darwin",
        other => other,
    };
    format!("{os}-{}-nsh", std::env::consts::ARCH)
}

/// Manifest URLs in the order they are tried. Development builds may point at
/// a local manifest with `OPENBITFUN_NATIVE_UPDATER_ENDPOINT`.
fn endpoints() -> Vec<String> {
    if cfg!(any(debug_assertions, feature = "devtools")) {
        if let Ok(endpoint) = std::env::var("OPENBITFUN_NATIVE_UPDATER_ENDPOINT") {
            if !endpoint.trim().is_empty() {
                return vec![endpoint.trim().to_string()];
            }
        }
    }
    vec![
        crate::api::system_api::GITHUB_UPDATER_ENDPOINT.to_string(),
        crate::api::system_api::OPENBITFUN_UPDATER_ENDPOINT.to_string(),
    ]
}

fn current_version() -> Result<semver::Version, String> {
    semver::Version::parse(crate::VERSION).map_err(|error| error.to_string())
}

fn cache_dir() -> Result<PathBuf, String> {
    if crate::e2e_storage_guard_enabled() {
        return Ok(openbitfun_core::infrastructure::get_path_manager_arc()
            .user_data_dir()
            .join("app-updates-nsh"));
    }
    dirs::cache_dir()
        .map(|dir| dir.join("com.openbitfun.desktop").join("app-updates-nsh"))
        .ok_or_else(|| "The cache directory of this user is unavailable".to_string())
}

#[derive(Debug, Clone, Deserialize)]
struct ManifestPlatform {
    url: String,
    signature: String,
}

#[derive(Debug, Clone, Deserialize)]
struct Manifest {
    version: String,
    #[serde(default)]
    notes: Option<String>,
    #[serde(default)]
    pub_date: Option<String>,
    #[serde(default)]
    platforms: std::collections::HashMap<String, ManifestPlatform>,
}

/// A newer native release, as the manifest describes it.
#[derive(Debug, Clone)]
struct Release {
    version: semver::Version,
    notes: Option<String>,
    date: Option<String>,
    platform: Option<ManifestPlatform>,
}

/// Reads `manifest` for `platform`: `None` when it is not newer than
/// `current`.
fn release_from_manifest(
    manifest: Manifest,
    current: &semver::Version,
    platform: &str,
) -> Result<Option<Release>, String> {
    let version = semver::Version::parse(manifest.version.trim_start_matches('v'))
        .map_err(|error| format!("The update manifest has an invalid version: {error}"))?;
    if version <= *current {
        return Ok(None);
    }
    Ok(Some(Release {
        version,
        notes: manifest.notes,
        date: manifest.pub_date,
        platform: manifest.platforms.get(platform).cloned(),
    }))
}

fn http_client() -> Result<reqwest::Client, String> {
    crate::ensure_rustls_crypto_provider();
    reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(20))
        .read_timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|error| error.to_string())
}

/// Asks the endpoints in order; like Tauri's updater, only an unreachable
/// endpoint or an HTTP error falls through to the next one.
async fn latest_release(client: &reqwest::Client) -> Result<Option<Release>, String> {
    let current = current_version()?;
    let platform = platform_key();
    let mut last_error = String::from("no update endpoint is configured");
    for endpoint in endpoints() {
        let response = match client
            .get(&endpoint)
            .header(reqwest::header::ACCEPT, "application/json")
            .send()
            .await
            .and_then(reqwest::Response::error_for_status)
        {
            Ok(response) => response,
            Err(error) => {
                log::warn!(
                    "Native updater endpoint unavailable: endpoint={}, error={}",
                    endpoint,
                    error
                );
                last_error = error.to_string();
                continue;
            }
        };
        let manifest: Manifest = response
            .json()
            .await
            .map_err(|error| format!("The update manifest could not be read: {error}"))?;
        return release_from_manifest(manifest, &current, &platform);
    }
    Err(format!("Could not reach the update service: {last_error}"))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CheckResponse {
    update_available: bool,
    current_version: String,
    latest_version: Option<String>,
    release_notes: Option<String>,
    release_date: Option<String>,
}

fn check_response(release: Option<&Release>) -> CheckResponse {
    match release {
        Some(release) if release.platform.is_some() => CheckResponse {
            update_available: true,
            current_version: crate::VERSION.to_string(),
            latest_version: Some(release.version.to_string()),
            release_notes: release.notes.clone(),
            release_date: release.date.clone(),
        },
        _ => CheckResponse {
            update_available: false,
            current_version: crate::VERSION.to_string(),
            latest_version: None,
            release_notes: None,
            release_date: None,
        },
    }
}

pub(in crate::backend_protocol) fn check_for_updates(
    host: &Arc<NativeHost>,
    args: Value,
) -> DispatchFuture<'_> {
    let _ = (host, args);
    Box::pin(async move {
        if release_pubkey().is_none() {
            return Err(NO_RELEASE_KEY.to_string());
        }
        let release = latest_release(&http_client()?).await?;
        if let Some(release) = release
            .as_ref()
            .filter(|release| release.platform.is_none())
        {
            log::info!(
                "A newer release has no native desktop package yet: version={}, platform={}",
                release.version,
                platform_key()
            );
        }
        serde_json::to_value(check_response(release.as_ref())).map_err(|error| error.to_string())
    })
}

pub(in crate::backend_protocol) fn get_pending_update(
    host: &Arc<NativeHost>,
    args: Value,
) -> DispatchFuture<'_> {
    let _ = (host, args);
    Box::pin(async move {
        let dir = cache_dir()?;
        let current = current_version()?;
        let pending = tokio::task::spawn_blocking(move || {
            update_api::read_record_for_kind(
                &dir,
                &current,
                &update_api::platform(),
                NATIVE_PACKAGE_KIND,
            )?
            .map(|record| update_api::pending_response(&dir, record))
            .transpose()
        })
        .await
        .map_err(|error| error.to_string())??;
        serde_json::to_value(pending).map_err(|error| error.to_string())
    })
}

const MAX_ARCHIVE_BYTES: u64 = 512 * 1024 * 1024;
const PROGRESS_EMIT_INTERVAL: std::time::Duration = std::time::Duration::from_millis(100);
const UNSUPPORTED_IN_PLACE_UPDATE: &str = "Installing updates in place is available for the native desktop on macOS only; download the new version from openbitfun.com";

async fn download(
    host: &NativeHost,
    request: update_api::DownloadUpdateRequest,
) -> Result<update_api::PendingUpdateResponse, String> {
    if cfg!(not(target_os = "macos")) {
        return Err(UNSUPPORTED_IN_PLACE_UPDATE.to_string());
    }
    let pubkey = release_pubkey().ok_or_else(|| NO_RELEASE_KEY.to_string())?;
    let _operation = UPDATE
        .get_or_init(Default::default)
        .try_lock()
        .map_err(|_| "An update operation is already in progress".to_string())?;
    let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel();
    *CANCEL_DOWNLOAD
        .get_or_init(Default::default)
        .lock()
        .map_err(|_| "Download cancellation state is unavailable".to_string())? = Some(cancel_tx);
    let cancellation = DownloadCancellation;
    let dir = cache_dir()?;
    let transfer_dir = dir.clone();
    let transfer = async {
        use futures::StreamExt;
        use tokio::io::AsyncWriteExt;

        let client = http_client()?;
        let release = latest_release(&client)
            .await?
            .ok_or_else(|| "No update available".to_string())?;
        let platform = release.platform.clone().ok_or_else(|| {
            format!(
                "Version {} has no package for this installation format yet",
                release.version
            )
        })?;
        request.validate_version(&release.version.to_string())?;
        let response = client
            .get(&platform.url)
            .send()
            .await
            .and_then(reqwest::Response::error_for_status)
            .map_err(|error| format!("The update download failed: {error}"))?;
        let total = response.content_length();
        if let Some(len) = total {
            if len > MAX_ARCHIVE_BYTES {
                return Err(format!(
                    "Update archive exceeds maximum size limit ({} MiB)",
                    MAX_ARCHIVE_BYTES / (1024 * 1024)
                ));
            }
        }
        // Stream directly to a temporary file inside the update cache directory
        // so large archives never sit in RAM.
        let temp_file = tokio::task::spawn_blocking(move || {
            std::fs::create_dir_all(&transfer_dir).map_err(|e| e.to_string())?;
            tempfile::NamedTempFile::new_in(&transfer_dir).map_err(|e| e.to_string())
        })
        .await
        .map_err(|error| error.to_string())??;
        let async_file = temp_file
            .as_file()
            .try_clone()
            .map_err(|error| format!("Failed to prepare update temp file: {error}"))?;
        let mut writer =
            tokio::io::BufWriter::with_capacity(64 * 1024, tokio::fs::File::from_std(async_file));
        let mut hasher = Sha256::new();
        let mut downloaded: u64 = 0;
        let mut last_emit = std::time::Instant::now()
            .checked_sub(PROGRESS_EMIT_INTERVAL)
            .unwrap_or_else(std::time::Instant::now);
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|error| format!("The update download failed: {error}"))?;
            downloaded = downloaded.saturating_add(chunk.len() as u64);
            if downloaded > MAX_ARCHIVE_BYTES {
                return Err(format!(
                    "Update archive exceeds maximum size limit ({} MiB)",
                    MAX_ARCHIVE_BYTES / (1024 * 1024)
                ));
            }
            hasher.update(&chunk);
            writer
                .write_all(&chunk)
                .await
                .map_err(|error| format!("Failed to write update archive: {error}"))?;
            if last_emit.elapsed() >= PROGRESS_EMIT_INTERVAL {
                last_emit = std::time::Instant::now();
                let _ = host.emit(
                    PROGRESS_EVENT,
                    json!({ "downloaded": downloaded, "total": total }),
                );
            }
        }
        writer
            .flush()
            .await
            .map_err(|error| format!("Failed to flush update archive: {error}"))?;
        drop(writer);
        let _ = host.emit(
            PROGRESS_EVENT,
            json!({ "downloaded": downloaded, "total": total }),
        );
        let sha256 = format!("{:x}", hasher.finalize());
        Ok::<_, String>((release, platform, temp_file, sha256))
    };
    let (release, platform, temp_file, sha256) = tokio::select! {
        result = transfer => result?,
        _ = cancel_rx => return Err("Update download canceled".into()),
    };
    // Finalization cannot be canceled midway through committing pending.json.
    drop(cancellation);
    let record = PendingUpdateRecord {
        version: release.version.to_string(),
        platform: update_api::platform(),
        signature: platform.signature,
        sha256,
        package_kind: Some(NATIVE_PACKAGE_KIND.to_string()),
    };
    let pubkey = pubkey.to_string();
    tokio::task::spawn_blocking(move || {
        // Verify before anything is committed: a bad signature leaves no record.
        update_api::verify_package_file(temp_file.path(), &record, &pubkey)?;
        let reader = std::io::BufReader::new(
            std::fs::File::open(temp_file.path()).map_err(|error| error.to_string())?,
        );
        validate_native_archive_reader(reader)?;
        update_api::commit_package_file(&dir, &record, temp_file)?;
        Ok::<_, String>(record.response())
    })
    .await
    .map_err(|error| error.to_string())?
}

/// The archive must hold exactly one application bundle with the native
/// runner in it, so a Tauri package can never be staged for this install.
#[cfg(test)]
fn validate_native_archive(bytes: &[u8]) -> Result<(), String> {
    validate_native_archive_reader(bytes)
}

fn validate_native_archive_reader<R: std::io::Read>(reader: R) -> Result<(), String> {
    let runner = std::env::current_exe()
        .ok()
        .and_then(|exe| {
            exe.file_name()
                .map(|name| name.to_string_lossy().into_owned())
        })
        .unwrap_or_else(|| "openbitfun-nsh".to_string());
    let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(reader));
    let mut bundles = std::collections::HashSet::new();
    let mut has_runner = false;
    let mut has_ui_bundle = false;
    for entry in archive.entries().map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry
            .path()
            .map_err(|error| error.to_string())?
            .into_owned();
        let parts: Vec<String> = path
            .components()
            .filter_map(|part| match part {
                std::path::Component::Normal(part) => Some(part.to_string_lossy().into_owned()),
                std::path::Component::CurDir => None,
                _ => Some(String::from("..")),
            })
            .collect();
        if parts.iter().any(|part| part == "..") {
            return Err("The update archive has an invalid path".to_string());
        }
        if let Some(bundle) = parts.first().filter(|part| part.ends_with(".app")) {
            bundles.insert(bundle.clone());
            if parts.len() == 4
                && parts[1] == "Contents"
                && parts[2] == "MacOS"
                && parts[3] == runner
            {
                has_runner = true;
            }
            // The NSH UI bundle tells a native bundle from a Tauri one, whose
            // executable may carry the same name.
            if parts.len() == 5
                && parts[1] == "Contents"
                && parts[2] == "Resources"
                && parts[3] == "nsh"
                && parts[4] == "bundle.nshc"
            {
                has_ui_bundle = true;
            }
        }
    }
    if bundles.len() != 1 {
        return Err("The update archive must contain one application bundle".to_string());
    }
    if !has_runner || !has_ui_bundle {
        return Err(format!(
            "The update archive is not a native desktop bundle (it needs Contents/MacOS/{runner} and Contents/Resources/nsh/bundle.nshc)"
        ));
    }
    Ok(())
}

pub(in crate::backend_protocol) fn download_update(
    host: &Arc<NativeHost>,
    args: Value,
) -> DispatchFuture<'_> {
    Box::pin(async move {
        let request: update_api::DownloadUpdateRequest =
            arg_or_default(&args, "request", "download_update")?;
        let response = download(host, request).await?;
        serde_json::to_value(response).map_err(|error| error.to_string())
    })
}

async fn install(host: &NativeHost, version: String) -> Result<(), String> {
    if cfg!(not(target_os = "macos")) {
        return Err(UNSUPPORTED_IN_PLACE_UPDATE.to_string());
    }
    let pubkey = release_pubkey().ok_or_else(|| NO_RELEASE_KEY.to_string())?;
    let _operation = UPDATE
        .get_or_init(Default::default)
        .try_lock()
        .map_err(|_| "An update operation is already in progress".to_string())?;
    let dir = cache_dir()?;
    let current = current_version()?;
    let pubkey = pubkey.to_string();
    let package_path = tokio::task::spawn_blocking(move || {
        let record = update_api::read_record_for_kind(
            &dir,
            &current,
            &update_api::platform(),
            NATIVE_PACKAGE_KIND,
        )?
        .ok_or_else(|| "No downloaded update is available".to_string())?;
        if record.version != version {
            return Err(
                "The downloaded update has changed; reopen About before installing".to_string(),
            );
        }
        let package_path = dir.join(record.package_name()?);
        update_api::verify_package_file(&package_path, &record, &pubkey)?;
        Ok::<_, String>(package_path)
    })
    .await
    .map_err(|error| error.to_string())??;
    // Unpack and validate once directly from the verified package file on disk.
    install_bundle_file(package_path).await?;
    // The shell restarts the app: the new bundle starts once this run exited.
    log::info!("Native desktop update installed; restarting");
    host.shell_request(
        "app.restart",
        Value::Null,
        crate::host::shell::SHELL_REQUEST_TIMEOUT,
    )
    .await
    .map(|_| ())
}

#[cfg(target_os = "macos")]
async fn install_bundle_file(path: std::path::PathBuf) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        crate::update_maintenance::install_native_app_bundle_file(&path)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(not(target_os = "macos"))]
async fn install_bundle_file(path: std::path::PathBuf) -> Result<(), String> {
    let _ = path;
    Err(UNSUPPORTED_IN_PLACE_UPDATE.to_string())
}

pub(in crate::backend_protocol) fn install_pending_update(
    host: &Arc<NativeHost>,
    args: Value,
) -> DispatchFuture<'_> {
    Box::pin(async move {
        let request: InstallPendingUpdateRequest =
            super::arg(&args, "request", "install_pending_update")?;
        install(host, request.version).await?;
        Ok(Value::Null)
    })
}

/// The legacy one-step install: download, then install and restart.
pub(in crate::backend_protocol) fn install_update(
    host: &Arc<NativeHost>,
    args: Value,
) -> DispatchFuture<'_> {
    let _ = args;
    Box::pin(async move {
        let pending = download(host, Default::default()).await?;
        install(host, pending.version).await?;
        Ok(Value::Null)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest(version: &str, platforms: Value) -> Manifest {
        serde_json::from_value(json!({
            "version": version,
            "notes": "n",
            "pub_date": "2026-11-20T00:00:00Z",
            "platforms": platforms,
            "futureField": true,
        }))
        .unwrap()
    }

    #[test]
    fn only_the_native_platform_entry_of_a_newer_release_is_offered() {
        let current = semver::Version::parse("1.0.0").unwrap();
        let platforms = json!({
            "darwin-aarch64": { "url": "https://x/tauri.app.tar.gz", "signature": "s" },
            "darwin-aarch64-nsh": { "url": "https://x/nsh.app.tar.gz", "signature": "s2" },
        });
        let release = release_from_manifest(
            manifest("v1.1.0", platforms.clone()),
            &current,
            "darwin-aarch64-nsh",
        )
        .unwrap()
        .unwrap();
        assert_eq!(
            release.platform.as_ref().unwrap().url,
            "https://x/nsh.app.tar.gz"
        );
        let response = check_response(Some(&release));
        assert!(response.update_available);
        assert_eq!(response.latest_version.as_deref(), Some("1.1.0"));
        // A release without a native package is not offered to the native app.
        let tauri_only = release_from_manifest(
            manifest(
                "1.1.0",
                json!({ "darwin-aarch64": platforms["darwin-aarch64"] }),
            ),
            &current,
            "darwin-aarch64-nsh",
        )
        .unwrap();
        assert!(!check_response(tauri_only.as_ref()).update_available);
        // Same or older versions are not updates.
        assert!(release_from_manifest(
            manifest("1.0.0", platforms),
            &current,
            "darwin-aarch64-nsh"
        )
        .unwrap()
        .is_none());
        assert_eq!(
            serde_json::to_value(check_response(None)).unwrap()["updateAvailable"],
            false
        );
    }

    #[test]
    fn platform_keys_name_the_native_format() {
        assert!(platform_key().ends_with("-nsh"));
        if cfg!(target_os = "macos") {
            assert!(platform_key().starts_with("darwin-"));
        }
    }

    fn archive(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        let mut tar = tar::Builder::new(encoder);
        for (name, contents) in entries {
            let mut header = tar::Header::new_gnu();
            header.set_size(contents.len() as u64);
            header.set_mode(0o755);
            header.set_cksum();
            tar.append_data(&mut header, name, *contents).unwrap();
        }
        tar.into_inner().unwrap().finish().unwrap()
    }

    #[test]
    fn only_a_bundle_with_the_running_executable_can_be_staged() {
        let runner = std::env::current_exe()
            .unwrap()
            .file_name()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let own = format!("OpenBitFun.app/Contents/MacOS/{runner}");
        assert!(validate_native_archive(&archive(&[
            ("OpenBitFun.app/Contents/Info.plist", b"p"),
            (own.as_str(), b"x"),
            ("OpenBitFun.app/Contents/Resources/nsh/bundle.nshc", b"b"),
        ]))
        .is_ok());
        // A Tauri bundle whose executable has the same name is refused.
        assert!(validate_native_archive(&archive(&[
            ("OpenBitFun.app/Contents/Info.plist", b"p"),
            (own.as_str(), b"x"),
        ]))
        .is_err());
        assert!(validate_native_archive(&archive(&[(
            "OpenBitFun.app/Contents/MacOS/OpenBitFun",
            b"x"
        )]))
        .is_err());
        assert!(validate_native_archive(&archive(&[
            (own.as_str(), b"x"),
            ("Other.app/Contents/Info.plist", b"p"),
        ]))
        .is_err());
    }

    #[test]
    fn native_records_are_kept_apart_from_tauri_records() {
        let dir = tempfile::tempdir().unwrap();
        let bytes = b"package";
        let record = PendingUpdateRecord {
            version: "2.0.0".into(),
            platform: update_api::platform(),
            signature: "sig".into(),
            sha256: format!("{:x}", Sha256::digest(bytes)),
            package_kind: Some(NATIVE_PACKAGE_KIND.into()),
        };
        update_api::save_package(dir.path(), &record, bytes).unwrap();
        let current = semver::Version::parse("1.0.0").unwrap();
        assert!(update_api::read_record_for_kind(
            dir.path(),
            &current,
            &update_api::platform(),
            NATIVE_PACKAGE_KIND
        )
        .unwrap()
        .is_some());
        let error =
            update_api::read_record_for_kind(dir.path(), &current, &update_api::platform(), "app")
                .unwrap_err();
        assert!(error.contains("installation format"), "{error}");
    }
}

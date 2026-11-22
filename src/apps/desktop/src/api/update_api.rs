//! Desktop-owned staged application updates. Download never starts an installer.

use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{io::Write, path::Path, sync::OnceLock};

pub(crate) const PROGRESS_EVENT: &str = "openbitfun-update-progress";
const RECORD_NAME: &str = "pending.json";
const RECEIPT_NAME: &str = "install-result.json";

// Serialize downloads and installs at the host, including calls from multiple windows.
pub(crate) static UPDATE: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
pub(crate) static CANCEL_DOWNLOAD: OnceLock<
    std::sync::Mutex<Option<tokio::sync::oneshot::Sender<()>>>,
> = OnceLock::new();

pub(crate) struct DownloadCancellation;
impl Drop for DownloadCancellation {
    fn drop(&mut self) {
        if let Ok(mut sender) = CANCEL_DOWNLOAD.get_or_init(Default::default).lock() {
            sender.take();
        }
    }
}

// @backend-command
pub async fn cancel_app_update_download(request: PendingUpdateRequest) -> Result<(), String> {
    let _ = request;
    let sender = CANCEL_DOWNLOAD
        .get_or_init(Default::default)
        .lock()
        .map_err(|_| "Download cancellation state is unavailable".to_string())?
        .take();
    if let Some(sender) = sender {
        let _ = sender.send(());
        Ok(())
    } else {
        Err("No cancellable update download is running; package finalization may already be in progress".into())
    }
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PendingUpdateRequest {}

#[derive(Debug, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DownloadUpdateRequest {
    #[serde(default)]
    pub expected_version: Option<String>,
}

impl DownloadUpdateRequest {
    pub(crate) fn validate_version(&self, available: &str) -> Result<(), String> {
        if let Some(expected) = &self.expected_version {
            if expected != available {
                return Err(format!(
                    "Update version changed from {expected} to {available}; check for updates again"
                ));
            }
        }
        Ok(())
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallPendingUpdateRequest {
    pub version: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingUpdateResponse {
    pub version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub install_error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reboot_required: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PendingUpdateRecord {
    pub(crate) version: String,
    pub(crate) platform: String,
    pub(crate) signature: String,
    pub(crate) sha256: String,
    #[serde(default)]
    pub(crate) package_kind: Option<String>,
}

impl PendingUpdateRecord {
    pub(crate) fn response(&self) -> PendingUpdateResponse {
        PendingUpdateResponse {
            version: self.version.clone(),
            install_error: None,
            reboot_required: None,
        }
    }

    fn applies_to(&self, current: &semver::Version, platform: &str) -> Result<bool, String> {
        let version = semver::Version::parse(&self.version).map_err(|e| e.to_string())?;
        Ok(version > *current && self.platform == platform)
    }

    pub(crate) fn package_name(&self) -> Result<String, String> {
        if self.sha256.len() != 64 || !self.sha256.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err("Invalid pending update checksum".into());
        }
        Ok(format!("{}.package", self.sha256))
    }
}

pub(crate) fn platform() -> String {
    format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstallationReceipt {
    version: String,
    success: bool,
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    reboot_required: bool,
}

pub(crate) fn pending_response(
    dir: &Path,
    record: PendingUpdateRecord,
) -> Result<PendingUpdateResponse, String> {
    let mut response = record.response();
    match std::fs::read(dir.join(RECEIPT_NAME)) {
        Ok(bytes) => {
            let receipt: InstallationReceipt = serde_json::from_slice(&bytes).map_err(|e| {
                format!("Cannot read update installation result; preserved for repair: {e}")
            })?;
            // A matching pending record is offered only while the running
            // version is older. Even exit code zero must not hide that fact.
            if receipt.version == record.version {
                response.reboot_required =
                    (receipt.success && receipt.reboot_required).then_some(true);
                response.install_error = Some(receipt.error.unwrap_or_else(|| {
                    if receipt.reboot_required {
                        "Restart Windows to finish installing the OpenBitFun update.".into()
                    } else if receipt.success {
                        "The installer finished, but the running version is still older; restart or repair the installation".into()
                    } else {
                        "The previous update installation failed; retry or reinstall manually".into()
                    }
                }));
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("Cannot read update installation result: {error}")),
    }
    Ok(response)
}

/// Reads the staged update record of `kind` from the update cache `dir`.
pub(crate) fn read_record_for_kind(
    dir: &Path,
    current: &semver::Version,
    platform: &str,
    kind: &str,
) -> Result<Option<PendingUpdateRecord>, String> {
    let bytes = match std::fs::read(dir.join(RECORD_NAME)) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("Cannot read pending update: {e}")),
    };
    // Never remove an unreadable record as a recovery mechanism.
    let record: PendingUpdateRecord = serde_json::from_slice(&bytes)
        .map_err(|e| format!("Cannot read pending update metadata: {e}"))?;
    if !record.applies_to(current, platform)? {
        return Ok(None);
    }
    if record
        .package_kind
        .as_deref()
        .is_some_and(|recorded| recorded != kind)
    {
        return Err(
            "Update package belongs to another installation format; download it again".into(),
        );
    }
    let package = dir.join(record.package_name()?);
    if !package.is_file() {
        return Err("Pending update package is missing; download the update again".into());
    }
    Ok(Some(record))
}

fn atomic_write(dir: &Path, name: &str, bytes: &[u8]) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let mut file = tempfile::NamedTempFile::new_in(dir).map_err(|e| e.to_string())?;
    file.write_all(bytes).map_err(|e| e.to_string())?;
    file.as_file().sync_all().map_err(|e| e.to_string())?;
    file.persist(dir.join(name)).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
pub(crate) fn save_package(
    dir: &Path,
    record: &PendingUpdateRecord,
    bytes: &[u8],
) -> Result<(), String> {
    // Commit the metadata last. A partial download can never become installable.
    atomic_write(dir, &record.package_name()?, bytes)?;
    atomic_write(
        dir,
        RECORD_NAME,
        &serde_json::to_vec(record).map_err(|e| e.to_string())?,
    )
}

/// Persists an already-written temporary package file into `dir` and commits
/// `pending.json` last, avoiding buffering the archive in RAM.
pub(crate) fn commit_package_file(
    dir: &Path,
    record: &PendingUpdateRecord,
    temp_file: tempfile::NamedTempFile,
) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    temp_file
        .as_file()
        .sync_all()
        .map_err(|e| format!("Failed to sync update package: {e}"))?;
    temp_file
        .persist(dir.join(record.package_name()?))
        .map_err(|e| format!("Failed to commit update package: {}", e.error))?;
    atomic_write(
        dir,
        RECORD_NAME,
        &serde_json::to_vec(record).map_err(|e| e.to_string())?,
    )
}

pub(crate) fn verify_package(
    bytes: &[u8],
    record: &PendingUpdateRecord,
    pubkey: &str,
) -> Result<(), String> {
    if format!("{:x}", Sha256::digest(bytes)) != record.sha256 {
        return Err(
            "Pending update signature verification failed: package checksum mismatch".into(),
        );
    }
    let (public_key, signature) = decode_minisign_key_and_sig(pubkey, &record.signature)?;
    public_key
        .verify(bytes, &signature, true)
        .map_err(|e| format!("Update signature verification failed: {e}"))
}

/// Streams a package file from disk to verify both its SHA-256 digest and its
/// minisign signature without loading the archive into RAM.
pub(crate) fn verify_package_file(
    path: &Path,
    record: &PendingUpdateRecord,
    pubkey: &str,
) -> Result<(), String> {
    use std::io::Read;

    let (public_key, signature) = decode_minisign_key_and_sig(pubkey, &record.signature)?;
    let mut file =
        std::fs::File::open(path).map_err(|e| format!("Failed to open update package: {e}"))?;
    let mut sha = Sha256::new();
    match public_key.verify_stream(&signature) {
        Ok(mut stream_verifier) => {
            let mut buf = [0u8; 64 * 1024];
            loop {
                let n = file
                    .read(&mut buf)
                    .map_err(|e| format!("Failed to read update package: {e}"))?;
                if n == 0 {
                    break;
                }
                sha.update(&buf[..n]);
                stream_verifier.update(&buf[..n]);
            }
            if format!("{:x}", sha.finalize()) != record.sha256 {
                return Err(
                    "Pending update signature verification failed: package checksum mismatch"
                        .into(),
                );
            }
            stream_verifier
                .finalize()
                .map_err(|e| format!("Update signature verification failed: {e}"))
        }
        Err(minisign_verify::Error::UnsupportedLegacyMode) => {
            // Legacy (non-prehashed) minisign signatures require the full byte slice.
            let bytes =
                std::fs::read(path).map_err(|e| format!("Failed to read update package: {e}"))?;
            verify_package(&bytes, record, pubkey)
        }
        Err(e) => Err(format!("Update signature verification failed: {e}")),
    }
}

fn decode_minisign_key_and_sig(
    pubkey: &str,
    sig: &str,
) -> Result<(minisign_verify::PublicKey, minisign_verify::Signature), String> {
    // The official downloader verified the original transfer. Re-verify cached
    // bytes against the bundled trust root before handing them to our adapter.
    let decode = |value: &str| -> Result<String, String> {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(value.trim())
            .map_err(|e| format!("Update signature decoding failed: {e}"))?;
        String::from_utf8(bytes).map_err(|e| format!("Update signature decoding failed: {e}"))
    };
    let public_key = minisign_verify::PublicKey::decode(&decode(pubkey)?)
        .map_err(|e| format!("Update signature public key is invalid: {e}"))?;
    let signature = minisign_verify::Signature::decode(&decode(sig)?)
        .map_err(|e| format!("Update signature is invalid: {e}"))?;
    Ok((public_key, signature))
}

#[cfg(test)]
mod tests {
    fn package_kind() -> &'static str {
        "nsh-app"
    }

    fn read_record(
        dir: &Path,
        current: &semver::Version,
        platform: &str,
    ) -> Result<Option<PendingUpdateRecord>, String> {
        read_record_for_kind(dir, current, platform, package_kind())
    }

    use super::*;

    #[test]
    fn download_request_preserves_legacy_payloads_and_checks_the_selected_version() {
        let legacy: DownloadUpdateRequest = serde_json::from_str("{}").unwrap();
        assert!(legacy.validate_version("2.0.0").is_ok());
        let roundtrip: DownloadUpdateRequest =
            serde_json::from_str(&serde_json::to_string(&legacy).unwrap()).unwrap();
        assert!(roundtrip.expected_version.is_none());
        let request: DownloadUpdateRequest =
            serde_json::from_str(r#"{"expectedVersion":"2.0.0","futureField":true}"#).unwrap();
        assert!(request.validate_version("2.0.0").is_ok());
        assert!(request
            .validate_version("2.1.0")
            .unwrap_err()
            .contains("Update version changed"));
    }

    fn record(bytes: &[u8]) -> PendingUpdateRecord {
        PendingUpdateRecord {
            version: "2.0.0".into(),
            platform: "test".into(),
            signature: "invalid".into(),
            sha256: format!("{:x}", Sha256::digest(bytes)),
            package_kind: Some(package_kind().into()),
        }
    }

    #[test]
    fn staged_update_survives_reload_and_is_not_offered_after_upgrade() {
        let dir = tempfile::tempdir().unwrap();
        let record = record(b"package");
        save_package(dir.path(), &record, b"package").unwrap();
        assert_eq!(
            read_record(dir.path(), &"1.0.0".parse().unwrap(), "test")
                .unwrap()
                .unwrap()
                .version,
            "2.0.0"
        );
        assert!(read_record(dir.path(), &"2.0.0".parse().unwrap(), "test")
            .unwrap()
            .is_none());
        assert!(read_record(dir.path(), &"1.0.0".parse().unwrap(), "other")
            .unwrap()
            .is_none());
    }

    #[test]
    fn corrupt_metadata_is_preserved_and_invalid_package_paths_are_rejected() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(RECORD_NAME), b"invalid").unwrap();
        assert!(read_record(dir.path(), &"1.0.0".parse().unwrap(), "test").is_err());
        assert_eq!(
            std::fs::read(dir.path().join(RECORD_NAME)).unwrap(),
            b"invalid"
        );
        let mut record = record(b"package");
        record.sha256 = "../outside".into();
        assert!(record.package_name().is_err());
    }

    #[test]
    fn cached_bytes_cannot_bypass_signature_verification() {
        assert!(verify_package(b"tampered", &record(b"package"), "invalid").is_err());
        assert!(verify_package(b"package", &record(b"package"), "invalid").is_err());
    }

    #[test]
    fn explicit_redownload_atomically_replaces_the_pending_package() {
        let dir = tempfile::tempdir().unwrap();
        let first = record(b"first");
        save_package(dir.path(), &first, b"first").unwrap();
        // Retrying the same download must also work on Windows.
        save_package(dir.path(), &first, b"first").unwrap();
        let mut replacement = record(b"replacement");
        replacement.version = "2.1.0".into();
        save_package(dir.path(), &replacement, b"replacement").unwrap();
        let restored = read_record(dir.path(), &"1.0.0".parse().unwrap(), "test")
            .unwrap()
            .unwrap();
        assert_eq!(restored.version, "2.1.0");
        assert_eq!(
            std::fs::read(dir.path().join(restored.package_name().unwrap())).unwrap(),
            b"replacement"
        );
    }

    #[test]
    fn signed_cache_verifies_after_reload_and_rejects_tampering_even_with_a_new_checksum() {
        // Public fixture shared with the release-verification contract tests.
        let key = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IERENTQzQUM5RUY0NTIzRTMKUldUakkwWHZ5VHBVM1NOMXJWMHhLVlljSDBOY2x4YlpxVHA2clN1NEJPMWcyY2Qvd2U4VUR2b3AK";
        let signature = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVUakkwWHZ5VHBVM2RVVFdoR3FNZDltSWNUeEQ1K2ZnNWRUSnYxWk5lUkZzd0h0MkdzSUhUSlV6a0haUTdNZm1aemM5QVBQWW50UWgvaWpFcEp1Zkp4SERWdnhIc1g2YUFrPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzg4NDg2NTU4CWZpbGU6Lm9wZW5iaXRmdW4tbWluaXNpZ24tZml4dHVyZS50eHQKa1QxdDQ3bWtLVlhaZUdFSjR4R0V5R1Z3REVnUlI0RGJqbHFoZkVHdkdLSlFyTGJ5Z05JRTI5V3dwdXRkSFpZckUrK0RaUVVJYUJod1dzcmVydHZnQXc9PQo=";
        let bytes = b"hello-openbitfun\n";
        let mut record = record(bytes);
        record.signature = signature.into();
        let dir = tempfile::tempdir().unwrap();
        save_package(dir.path(), &record, bytes).unwrap();
        let mut restored = read_record(dir.path(), &"1.0.0".parse().unwrap(), "test")
            .unwrap()
            .unwrap();
        verify_package(bytes, &restored, key).unwrap();
        restored.sha256 = format!("{:x}", Sha256::digest(b"tampered"));
        assert!(verify_package(b"tampered", &restored, key).is_err());
    }

    #[test]
    fn record_accepts_additive_fields() {
        let mut json = serde_json::to_value(record(b"package")).unwrap();
        json["futureField"] = true.into();
        let decoded: PendingUpdateRecord = serde_json::from_value(json).unwrap();
        let roundtrip: PendingUpdateRecord =
            serde_json::from_slice(&serde_json::to_vec(&decoded).unwrap()).unwrap();
        assert_eq!(roundtrip.version, "2.0.0");
    }

    #[test]
    fn successful_reboot_receipts_preserve_legacy_receipt_compatibility() {
        let dir = tempfile::tempdir().unwrap();
        for reboot in [false, true] {
            let mut receipt = serde_json::json!({"version":"2.0.0", "success":true});
            if reboot {
                receipt["rebootRequired"] = true.into();
            }
            std::fs::write(
                dir.path().join(RECEIPT_NAME),
                serde_json::to_vec(&receipt).unwrap(),
            )
            .unwrap();
            let response = pending_response(dir.path(), record(b"package")).unwrap();
            assert_eq!(response.reboot_required, reboot.then_some(true));
            if reboot {
                assert!(response.install_error.unwrap().contains("Restart"));
            }
        }
    }

    #[test]
    fn installation_receipts_report_failures_and_a_still_running_old_version() {
        let dir = tempfile::tempdir().unwrap();
        for success in [false, true] {
            std::fs::write(
                dir.path().join(RECEIPT_NAME),
                serde_json::to_vec(&serde_json::json!({"version":"2.0.0", "success":success}))
                    .unwrap(),
            )
            .unwrap();
            assert!(pending_response(dir.path(), record(b"package"))
                .unwrap()
                .install_error
                .is_some());
        }
        std::fs::write(
            dir.path().join(RECEIPT_NAME),
            br#"{"version":"1.5.0", "success":false,"error":"old failure"}"#,
        )
        .unwrap();
        assert!(pending_response(dir.path(), record(b"package"))
            .unwrap()
            .install_error
            .is_none());
        std::fs::write(dir.path().join(RECEIPT_NAME), b"invalid").unwrap();
        assert!(pending_response(dir.path(), record(b"package")).is_err());
        assert_eq!(
            std::fs::read(dir.path().join(RECEIPT_NAME)).unwrap(),
            b"invalid"
        );
    }
}

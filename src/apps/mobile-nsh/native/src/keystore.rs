//! Where the phone keeps its secrets: the device key, the account tokens
//! and the directory token, as one record.
//!
//! - iOS: the Keychain, `AfterFirstUnlockThisDeviceOnly` (readable while the
//!   phone runs after its first unlock, never synced or restored to another
//!   phone). The simulator, which grants no keychain group to ad hoc builds,
//!   keeps it in the app container.
//! - macOS (development hosts): the login Keychain.
//! - Android: sealed with an AES-256-GCM key in the Android Keystore into a
//!   0600 file in the app's private data directory (`keystore_android.rs`);
//!   the owner-only private file alone where the module cannot reach the
//!   app's JVM (Android 8 to 11).
//! - Others: a 0600 file in the app's private data directory, which only
//!   this app's user can read.

use std::path::PathBuf;

/// A record sealed with a platform key (Android Keystore), as stored:
/// `{ version, scheme, alias, iv, data }` with base64 `iv` and `data`
/// (ciphertext and GCM tag). Unknown fields are tolerated.
#[cfg_attr(not(any(target_os = "android", test)), allow(dead_code))]
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub(crate) struct SealedRecord {
    version: u32,
    scheme: String,
    alias: String,
    iv: String,
    data: String,
}

#[cfg_attr(not(any(target_os = "android", test)), allow(dead_code))]
impl SealedRecord {
    const VERSION: u32 = 1;
    const SCHEME: &'static str = "android_keystore_aes256_gcm";

    pub(crate) fn new(alias: &str, iv: &[u8], data: &[u8]) -> Self {
        use base64::Engine as _;
        let engine = base64::engine::general_purpose::STANDARD;
        Self {
            version: Self::VERSION,
            scheme: Self::SCHEME.to_string(),
            alias: alias.to_string(),
            iv: engine.encode(iv),
            data: engine.encode(data),
        }
    }

    pub(crate) fn parse(bytes: &[u8]) -> Result<Self, String> {
        let sealed: Self = serde_json::from_slice(bytes)
            .map_err(|error| format!("the sealed device key file is malformed: {error}"))?;
        if sealed.scheme != Self::SCHEME {
            return Err(format!(
                "the sealed device key uses an unknown scheme `{}`; update the app",
                sealed.scheme
            ));
        }
        Ok(sealed)
    }

    /// The IV and the ciphertext.
    pub(crate) fn parts(&self) -> Result<(Vec<u8>, Vec<u8>), String> {
        use base64::Engine as _;
        let engine = base64::engine::general_purpose::STANDARD;
        let iv = engine
            .decode(&self.iv)
            .map_err(|_| "the sealed device key's IV is malformed".to_string())?;
        let data = engine
            .decode(&self.data)
            .map_err(|_| "the sealed device key is malformed".to_string())?;
        if iv.len() != 12 || data.len() < 16 {
            return Err("the sealed device key is truncated".to_string());
        }
        Ok((iv, data))
    }

    pub(crate) fn to_bytes(&self) -> Vec<u8> {
        serde_json::to_vec(self).unwrap_or_default()
    }
}

/// The record's store.
pub(crate) trait SecretStore: Send + Sync + 'static {
    /// The record, `None` when none was saved.
    fn load(&self) -> Result<Option<Vec<u8>>, String>;
    fn save(&self, bytes: &[u8]) -> Result<(), String>;
    /// Where it lives, for diagnostics (`keychain`, `private_file`).
    fn kind(&self) -> &'static str;
}

#[cfg(any(all(target_os = "ios", not(target_abi = "sim")), target_os = "macos"))]
const SERVICE: &str = "com.openbitfun.mobile.controller";
#[cfg(any(all(target_os = "ios", not(target_abi = "sim")), target_os = "macos"))]
const ACCOUNT: &str = "identity";
#[cfg(any(all(target_os = "ios", not(target_abi = "sim")), target_os = "macos"))]
const ERR_SEC_ITEM_NOT_FOUND: i32 = -25300;

/// The platform's store for this app.
pub(crate) fn platform_store(data_dir: &std::path::Path) -> Box<dyn SecretStore> {
    // The iOS simulator grants no keychain group to an ad hoc signed app
    // (`errSecMissingEntitlement`): simulator builds keep the record in the
    // app's container. Devices are signed with a profile and use the Keychain.
    #[cfg(all(target_os = "ios", target_abi = "sim"))]
    {
        log::warn!(
            "iOS simulator build: the device key is kept in the app container, not the Keychain"
        );
        Box::new(PrivateFile {
            path: data_dir.join("controller").join("identity.json"),
        })
    }
    #[cfg(any(all(target_os = "ios", not(target_abi = "sim")), target_os = "macos"))]
    {
        let _ = data_dir;
        Box::new(Keychain)
    }
    #[cfg(target_os = "android")]
    {
        crate::keystore_android::store(data_dir)
    }
    #[cfg(not(any(target_os = "ios", target_os = "macos", target_os = "android")))]
    {
        Box::new(PrivateFile {
            path: data_dir.join("controller").join("identity.json"),
        })
    }
}

#[cfg(any(all(target_os = "ios", not(target_abi = "sim")), target_os = "macos"))]
struct Keychain;

#[cfg(any(all(target_os = "ios", not(target_abi = "sim")), target_os = "macos"))]
impl SecretStore for Keychain {
    fn load(&self) -> Result<Option<Vec<u8>>, String> {
        use security_framework::passwords::get_generic_password;
        match get_generic_password(SERVICE, ACCOUNT) {
            Ok(bytes) => Ok(Some(bytes)),
            Err(error) if error.code() == ERR_SEC_ITEM_NOT_FOUND => Ok(None),
            Err(error) => Err(format!(
                "the Keychain refused to read the device key: {error}"
            )),
        }
    }

    fn save(&self, bytes: &[u8]) -> Result<(), String> {
        use core_foundation::data::CFData;
        use security_framework::item::{
            update_item, ItemClass, ItemSearchOptions, ItemUpdateOptions, ItemUpdateValue,
        };
        use security_framework::passwords::set_generic_password_options;
        use security_framework::passwords_options::PasswordOptions;

        // Update the existing item in place (`SecItemUpdate`) before falling
        // back to `SecItemAdd`, so a failed write or crash never leaves a
        // window with the previous device key deleted.
        let mut search = ItemSearchOptions::new();
        search
            .class(ItemClass::generic_password())
            .service(SERVICE)
            .account(ACCOUNT);
        let mut update = ItemUpdateOptions::new();
        update.set_value(ItemUpdateValue::Data(CFData::from_buffer(bytes)));

        match update_item(&search, &update) {
            Ok(()) => Ok(()),
            Err(error) if error.code() == ERR_SEC_ITEM_NOT_FOUND => {
                #[cfg_attr(not(target_os = "ios"), allow(unused_mut))]
                let mut options = PasswordOptions::new_generic_password(SERVICE, ACCOUNT);
                #[cfg(target_os = "ios")]
                {
                    use security_framework::access_control::{ProtectionMode, SecAccessControl};
                    let access = SecAccessControl::create_with_protection(
                        Some(ProtectionMode::AccessibleAfterFirstUnlockThisDeviceOnly),
                        0,
                    )
                    .map_err(|error| format!("the Keychain access control failed: {error}"))?;
                    options.set_access_control(access);
                }
                match set_generic_password_options(bytes, options) {
                    Ok(()) => Ok(()),
                    Err(add_error) => {
                        // A concurrent writer may have added the item after our
                        // first update saw errSecItemNotFound; retry update once.
                        if update_item(&search, &update).is_ok() {
                            return Ok(());
                        }
                        Err(format!(
                            "the Keychain refused to keep the device key: {add_error}"
                        ))
                    }
                }
            }
            Err(error) => Err(format!(
                "the Keychain refused to keep the device key: {error}"
            )),
        }
    }

    fn kind(&self) -> &'static str {
        "keychain"
    }
}

/// Platform key sealing backend (Android Keystore).
#[cfg_attr(not(any(target_os = "android", test)), allow(dead_code))]
pub(crate) trait RecordSealer: Send + Sync + 'static {
    fn seal(&self, plaintext: &[u8]) -> Result<SealedRecord, String>;
    fn open(&self, sealed: &SealedRecord) -> Result<Vec<u8>, String>;
}

/// A 0600 sealed record file (`identity.sealed`) with one-time migration from
/// an older build's plaintext file (`identity.json`). Once sealing is in use,
/// Keystore errors fail loudly instead of downgrading to plaintext.
#[cfg_attr(not(any(target_os = "android", test)), allow(dead_code))]
pub(crate) struct SealedFileStore<S> {
    sealer: S,
    sealed: PathBuf,
    legacy: PathBuf,
    /// True only when an existing legacy plaintext file could not yet be
    /// migrated on read; `save()` always requires sealing.
    legacy_active: std::sync::atomic::AtomicBool,
}

#[cfg_attr(not(any(target_os = "android", test)), allow(dead_code))]
impl<S: RecordSealer> SealedFileStore<S> {
    pub(crate) fn new(sealer: S, sealed: PathBuf, legacy: PathBuf) -> Self {
        Self {
            sealer,
            sealed,
            legacy,
            legacy_active: std::sync::atomic::AtomicBool::new(false),
        }
    }

    fn read_sealed(&self) -> Result<Option<Vec<u8>>, String> {
        let bytes = match std::fs::read(&self.sealed) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(format!("the sealed device key file is unreadable: {error}")),
        };
        let sealed = SealedRecord::parse(&bytes)?;
        self.sealer
            .open(&sealed)
            .map(Some)
            .map_err(|error| format!("the Android Keystore could not open the device key: {error}"))
    }

    fn write_sealed(&self, bytes: &[u8]) -> Result<(), String> {
        let sealed = self.sealer.seal(bytes)?;
        write_private(&self.sealed, &sealed.to_bytes())
            .map_err(|error| format!("the sealed device key file could not be written: {error}"))
    }
}

#[cfg_attr(not(any(target_os = "android", test)), allow(dead_code))]
impl<S: RecordSealer> SecretStore for SealedFileStore<S> {
    fn load(&self) -> Result<Option<Vec<u8>>, String> {
        use std::sync::atomic::Ordering;
        if let Some(bytes) = self.read_sealed()? {
            self.legacy_active.store(false, Ordering::Relaxed);
            return Ok(Some(bytes));
        }
        let plaintext = match std::fs::read(&self.legacy) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(format!("the device key file is unreadable: {error}")),
        };
        // A record of an older build: seal it, check it opens, then remove
        // the plaintext copy.
        match self
            .write_sealed(&plaintext)
            .and_then(|()| self.read_sealed())
        {
            Ok(Some(reopened)) if reopened == plaintext => {
                if let Err(error) = std::fs::remove_file(&self.legacy) {
                    log::warn!(
                        "The plaintext device key file could not be removed after sealing: {error}"
                    );
                }
                self.legacy_active.store(false, Ordering::Relaxed);
                log::info!("The device key record is now sealed with the Android Keystore");
            }
            Ok(_) => {
                let _ = std::fs::remove_file(&self.sealed);
                log::warn!("The sealed device key did not match; the legacy private file is kept");
                self.legacy_active.store(true, Ordering::Relaxed);
            }
            Err(error) => {
                let _ = std::fs::remove_file(&self.sealed);
                log::warn!(
                    "The device key could not be sealed; the legacy private file is kept: {error}"
                );
                self.legacy_active.store(true, Ordering::Relaxed);
            }
        }
        Ok(Some(plaintext))
    }

    fn save(&self, bytes: &[u8]) -> Result<(), String> {
        use std::sync::atomic::Ordering;
        match self.write_sealed(bytes) {
            Ok(()) => {
                if self.legacy.exists() {
                    if let Err(error) = std::fs::remove_file(&self.legacy) {
                        log::warn!("The plaintext device key file could not be removed: {error}");
                    }
                }
                self.legacy_active.store(false, Ordering::Relaxed);
                Ok(())
            }
            Err(error) => {
                log::warn!("The Android Keystore refused to seal the device key: {error}");
                Err(format!(
                    "the Android Keystore could not seal the device key: {error}"
                ))
            }
        }
    }

    fn kind(&self) -> &'static str {
        if self
            .legacy_active
            .load(std::sync::atomic::Ordering::Relaxed)
        {
            "private_file"
        } else {
            "android_keystore"
        }
    }
}

/// A 0600 file in a private directory.
#[cfg_attr(
    any(all(target_os = "ios", not(target_abi = "sim")), target_os = "macos"),
    allow(dead_code)
)]
pub(crate) struct PrivateFile {
    pub(crate) path: PathBuf,
}

#[cfg_attr(
    any(all(target_os = "ios", not(target_abi = "sim")), target_os = "macos"),
    allow(dead_code)
)]
impl SecretStore for PrivateFile {
    fn load(&self) -> Result<Option<Vec<u8>>, String> {
        match std::fs::read(&self.path) {
            Ok(bytes) => Ok(Some(bytes)),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(format!("the device key file is unreadable: {error}")),
        }
    }

    fn save(&self, bytes: &[u8]) -> Result<(), String> {
        write_private(&self.path, bytes)
            .map_err(|error| format!("the device key file could not be written: {error}"))
    }

    fn kind(&self) -> &'static str {
        "private_file"
    }
}

/// Writes `bytes` through a temporary file (0600, directory 0700) and
/// renames it into place, so a crash never leaves half a record.
#[cfg_attr(
    any(all(target_os = "ios", not(target_abi = "sim")), target_os = "macos"),
    allow(dead_code)
)]
pub(crate) fn write_private(path: &std::path::Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700));
        }
    }
    let temporary = path.with_extension("tmp");
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&temporary)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    std::fs::rename(&temporary, path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sealed_records_round_trip_and_reject_what_they_cannot_open() {
        let sealed = SealedRecord::new("alias", &[7u8; 12], &[9u8; 40]);
        let parsed = SealedRecord::parse(&sealed.to_bytes()).unwrap();
        assert_eq!(parsed, sealed);
        assert_eq!(parsed.parts().unwrap(), (vec![7u8; 12], vec![9u8; 40]));
        // Newer writers may add fields.
        let mut value: serde_json::Value = serde_json::from_slice(&sealed.to_bytes()).unwrap();
        value["note"] = "future".into();
        assert!(SealedRecord::parse(value.to_string().as_bytes()).is_ok());
        // Another scheme, a truncated record, or plain JSON are refused.
        value["scheme"] = "other".into();
        assert!(SealedRecord::parse(value.to_string().as_bytes())
            .unwrap_err()
            .contains("unknown scheme"));
        let short = SealedRecord::new("alias", &[7u8; 12], &[9u8; 4]);
        assert!(short.parts().is_err());
        assert!(SealedRecord::parse(b"{\"version\":1,\"deviceId\":\"x\"}").is_err());
    }

    #[test]
    fn private_file_round_trips_with_owner_only_permissions() {
        let dir = std::env::temp_dir().join(format!(
            "obf-mobile-store-{}",
            crate::crypto::new_device_id()
        ));
        let store = PrivateFile {
            path: dir.join("controller").join("identity.json"),
        };
        assert_eq!(store.load().unwrap(), None);
        store.save(b"{\"version\":1}").unwrap();
        assert_eq!(
            store.load().unwrap().as_deref(),
            Some(&b"{\"version\":1}"[..])
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&store.path).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600);
        }
        store.save(b"{\"version\":2}").unwrap();
        assert_eq!(
            store.load().unwrap().as_deref(),
            Some(&b"{\"version\":2}"[..])
        );
        assert!(!store.path.with_extension("tmp").exists());
        let _ = std::fs::remove_dir_all(dir);
    }

    struct StubSealer {
        fail_seal: std::sync::atomic::AtomicBool,
    }

    impl RecordSealer for StubSealer {
        fn seal(&self, plaintext: &[u8]) -> Result<SealedRecord, String> {
            if self.fail_seal.load(std::sync::atomic::Ordering::Relaxed) {
                return Err("binder unavailable".to_string());
            }
            let mut data = plaintext.to_vec();
            data.extend_from_slice(&[0xAA; 16]);
            Ok(SealedRecord::new("test-alias", &[1u8; 12], &data))
        }

        fn open(&self, sealed: &SealedRecord) -> Result<Vec<u8>, String> {
            let (_iv, data) = sealed.parts()?;
            Ok(data[..data.len() - 16].to_vec())
        }
    }

    #[test]
    fn sealed_store_fails_loudly_without_downgrading_to_plaintext() {
        use std::sync::atomic::{AtomicBool, Ordering};
        let dir = std::env::temp_dir().join(format!(
            "obf-mobile-sealed-{}",
            crate::crypto::new_device_id()
        ));
        let sealed_path = dir.join("controller").join("identity.sealed");
        let legacy_path = dir.join("controller").join("identity.json");
        let store = SealedFileStore::new(
            StubSealer {
                fail_seal: AtomicBool::new(true),
            },
            sealed_path.clone(),
            legacy_path.clone(),
        );

        // Initial Keystore failure must fail loudly and never write plaintext.
        assert!(store.save(b"{\"version\":1}").is_err());
        assert!(!sealed_path.exists());
        assert!(!legacy_path.exists());

        // Succeeding seal writes identity.sealed and never identity.json.
        store.sealer.fail_seal.store(false, Ordering::Relaxed);
        store.save(b"{\"version\":1,\"deviceId\":\"a\"}").unwrap();
        assert!(sealed_path.exists());
        assert!(!legacy_path.exists());
        assert_eq!(store.kind(), "android_keystore");
        assert_eq!(
            store.load().unwrap().as_deref(),
            Some(&b"{\"version\":1,\"deviceId\":\"a\"}"[..])
        );

        // A transient Keystore error on a subsequent save must fail loudly,
        // keep the existing identity.sealed intact, and never write identity.json.
        store.sealer.fail_seal.store(true, Ordering::Relaxed);
        assert!(store.save(b"{\"version\":1,\"deviceId\":\"b\"}").is_err());
        assert!(sealed_path.exists());
        assert!(!legacy_path.exists());
        assert_eq!(store.kind(), "android_keystore");
        assert_eq!(
            store.load().unwrap().as_deref(),
            Some(&b"{\"version\":1,\"deviceId\":\"a\"}"[..])
        );

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn sealed_store_migrates_legacy_plaintext_and_never_rewrites_it_on_error() {
        use std::sync::atomic::{AtomicBool, Ordering};
        let dir = std::env::temp_dir().join(format!(
            "obf-mobile-sealed-mig-{}",
            crate::crypto::new_device_id()
        ));
        let sealed_path = dir.join("controller").join("identity.sealed");
        let legacy_path = dir.join("controller").join("identity.json");
        write_private(&legacy_path, b"{\"version\":1,\"legacy\":true}").unwrap();

        let store = SealedFileStore::new(
            StubSealer {
                fail_seal: AtomicBool::new(true),
            },
            sealed_path.clone(),
            legacy_path.clone(),
        );
        // When migration fails on load, the legacy file remains readable.
        assert_eq!(
            store.load().unwrap().as_deref(),
            Some(&b"{\"version\":1,\"legacy\":true}"[..])
        );
        assert!(legacy_path.exists());
        assert!(!sealed_path.exists());
        assert_eq!(store.kind(), "private_file");
        // Saving while Keystore is failing must still fail loudly (no plaintext write).
        assert!(store.save(b"{\"version\":1,\"new\":true}").is_err());
        assert_eq!(
            std::fs::read(&legacy_path).unwrap(),
            b"{\"version\":1,\"legacy\":true}"
        );

        // Once Keystore recovers, save seals and removes the legacy file.
        store.sealer.fail_seal.store(false, Ordering::Relaxed);
        store.save(b"{\"version\":1,\"new\":true}").unwrap();
        assert!(sealed_path.exists());
        assert!(!legacy_path.exists());
        assert_eq!(store.kind(), "android_keystore");
        assert_eq!(
            store.load().unwrap().as_deref(),
            Some(&b"{\"version\":1,\"new\":true}"[..])
        );

        let _ = std::fs::remove_dir_all(dir);
    }
}

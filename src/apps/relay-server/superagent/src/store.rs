//! The encrypted per-account store.
//!
//! `<root>/accounts/<dir>/` (`dir` = an HMAC of the account id) holds:
//!
//! - `key.wrap`: the account's 32-byte data key, sealed with AES-256-GCM
//!   under a key derived from the server master key (mode 0600 file);
//! - `<name>.rec`: one record each (ledger, conversations, metadata), sealed
//!   with AES-256-GCM under the data key, with the account directory and the
//!   record name as associated data (a record cannot be moved to another
//!   account or name).
//!
//! Deleting the account removes `key.wrap` first and syncs the directory:
//! from then on every record is unreadable even if a backup kept it
//! (crypto-shred); the records are deleted after.
//!
//! This protects disks and backups, not against the operator of the running
//! process, which holds the master key.

use std::path::{Path, PathBuf};

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::{Deserialize, Serialize};

use crate::crypto;

const KEY_FILE: &str = "key.wrap";
const RECORD_SUFFIX: &str = ".rec";
const RECORD_VERSION: u8 = 1;
const NONCE_LEN: usize = 12;
/// The largest record the store reads back.
pub const MAX_RECORD_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug)]
pub enum StoreError {
    /// The data key is gone (deleted account) or the record was sealed for
    /// another account or name.
    Unreadable(String),
    Io(String),
}

impl std::fmt::Display for StoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Unreadable(message) | Self::Io(message) => f.write_str(message),
        }
    }
}

impl std::error::Error for StoreError {}

impl From<std::io::Error> for StoreError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error.to_string())
    }
}

#[derive(Serialize, Deserialize)]
struct WrappedKey {
    v: u32,
    nonce: String,
    key: String,
}

/// Every account's records under one root.
pub struct Store {
    root: PathBuf,
    master: [u8; 32],
    kek: [u8; 32],
}

impl Store {
    pub fn open(root: &Path, master: [u8; 32]) -> Result<Self, StoreError> {
        let accounts = root.join("accounts");
        create_private_dir(root)?;
        create_private_dir(&accounts)?;
        Ok(Self {
            root: root.to_path_buf(),
            kek: crypto::derive_key(&master, "openbitfun-superagent kek v1"),
            master,
        })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn master(&self) -> &[u8; 32] {
        &self.master
    }

    pub fn dir_name(&self, account_id: &str) -> String {
        crypto::account_dir_name(&self.master, account_id)
    }

    fn account_path(&self, dir: &str) -> PathBuf {
        self.root.join("accounts").join(dir)
    }

    /// Whether the account has a data key (it was enabled and not deleted).
    pub fn exists(&self, account_id: &str) -> bool {
        self.account_path(&self.dir_name(account_id))
            .join(KEY_FILE)
            .is_file()
    }

    /// The account's store, creating its data key when `create`.
    pub fn account(&self, account_id: &str, create: bool) -> Result<AccountStore, StoreError> {
        let dir = self.dir_name(account_id);
        let path = self.account_path(&dir);
        let key_path = path.join(KEY_FILE);
        let aad = format!("openbitfun-superagent dek v1\n{dir}");
        let cipher = Aes256Gcm::new_from_slice(&self.kek).expect("32-byte key");
        let data_key = if key_path.is_file() {
            let wrapped: WrappedKey = serde_json::from_slice(&std::fs::read(&key_path)?)
                .map_err(|_| StoreError::Unreadable("the wrapped data key is unreadable".into()))?;
            let nonce = BASE64
                .decode(&wrapped.nonce)
                .ok()
                .filter(|nonce| nonce.len() == NONCE_LEN)
                .ok_or_else(|| {
                    StoreError::Unreadable("the wrapped data key is unreadable".into())
                })?;
            let sealed = BASE64
                .decode(&wrapped.key)
                .map_err(|_| StoreError::Unreadable("the wrapped data key is unreadable".into()))?;
            let plain = cipher
                .decrypt(
                    Nonce::from_slice(&nonce),
                    Payload {
                        msg: &sealed,
                        aad: aad.as_bytes(),
                    },
                )
                .map_err(|_| {
                    StoreError::Unreadable(
                        "the data key does not open under this server's master key".into(),
                    )
                })?;
            <[u8; 32]>::try_from(plain.as_slice())
                .map_err(|_| StoreError::Unreadable("the data key has the wrong size".into()))?
        } else if create {
            create_private_dir(&path)?;
            let key: [u8; 32] = crypto::random_bytes();
            let nonce: [u8; NONCE_LEN] = crypto::random_bytes();
            let sealed = cipher
                .encrypt(
                    Nonce::from_slice(&nonce),
                    Payload {
                        msg: &key,
                        aad: aad.as_bytes(),
                    },
                )
                .map_err(|_| StoreError::Io("data key sealing failed".into()))?;
            let wrapped = serde_json::to_vec(&WrappedKey {
                v: 1,
                nonce: BASE64.encode(nonce),
                key: BASE64.encode(sealed),
            })
            .map_err(|error| StoreError::Io(error.to_string()))?;
            write_private_atomic(&key_path, &wrapped)?;
            key
        } else {
            return Err(StoreError::Unreadable(
                "this account has no cloud agent data".into(),
            ));
        };
        Ok(AccountStore {
            path,
            dir,
            cipher: Aes256Gcm::new_from_slice(&data_key).expect("32-byte key"),
        })
    }

    /// Crypto-shreds an account: the data key first (synced), then the
    /// records. Returns whether anything existed.
    pub fn shred(&self, account_id: &str) -> Result<bool, StoreError> {
        let path = self.account_path(&self.dir_name(account_id));
        if !path.exists() {
            return Ok(false);
        }
        let key_path = path.join(KEY_FILE);
        if key_path.exists() {
            // Overwrite before unlinking: a file system without copy-on-write
            // loses the sealed key bytes too.
            if let Ok(meta) = std::fs::metadata(&key_path) {
                let _ = std::fs::write(&key_path, vec![0u8; meta.len() as usize]);
            }
            std::fs::remove_file(&key_path)?;
            sync_dir(&path);
        }
        std::fs::remove_dir_all(&path)?;
        sync_dir(&self.root.join("accounts"));
        Ok(true)
    }

    /// The account directories present (their HMAC names).
    pub fn account_dirs(&self) -> Vec<String> {
        std::fs::read_dir(self.root.join("accounts"))
            .map(|entries| {
                entries
                    .filter_map(Result::ok)
                    .filter(|entry| entry.path().join(KEY_FILE).is_file())
                    .filter_map(|entry| entry.file_name().into_string().ok())
                    .collect()
            })
            .unwrap_or_default()
    }
}

/// One account's records.
pub struct AccountStore {
    path: PathBuf,
    dir: String,
    cipher: Aes256Gcm,
}

pub fn valid_record_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 96
        && name.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'-' | b'_')
        })
}

impl AccountStore {
    fn aad(&self, name: &str) -> String {
        format!("openbitfun-superagent record v1\n{}\n{name}", self.dir)
    }

    fn record_path(&self, name: &str) -> Result<PathBuf, StoreError> {
        if !valid_record_name(name) {
            return Err(StoreError::Io(format!("invalid record name {name}")));
        }
        Ok(self.path.join(format!("{name}{RECORD_SUFFIX}")))
    }

    pub fn write(&self, name: &str, plaintext: &[u8]) -> Result<usize, StoreError> {
        let path = self.record_path(name)?;
        let nonce: [u8; NONCE_LEN] = crypto::random_bytes();
        let aad = self.aad(name);
        let sealed = self
            .cipher
            .encrypt(
                Nonce::from_slice(&nonce),
                Payload {
                    msg: plaintext,
                    aad: aad.as_bytes(),
                },
            )
            .map_err(|_| StoreError::Io("record sealing failed".into()))?;
        let mut body = Vec::with_capacity(1 + NONCE_LEN + sealed.len());
        body.push(RECORD_VERSION);
        body.extend_from_slice(&nonce);
        body.extend_from_slice(&sealed);
        write_private_atomic(&path, &body)?;
        Ok(body.len())
    }

    pub fn read(&self, name: &str) -> Result<Option<Vec<u8>>, StoreError> {
        let path = self.record_path(name)?;
        let body = match std::fs::read(&path) {
            Ok(body) => body,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error.into()),
        };
        if body.len() > MAX_RECORD_BYTES + 64 || body.len() < 1 + NONCE_LEN + 16 {
            return Err(StoreError::Unreadable(format!(
                "record {name} has a bad size"
            )));
        }
        if body[0] != RECORD_VERSION {
            return Err(StoreError::Unreadable(format!(
                "record {name} has an unknown version {}",
                body[0]
            )));
        }
        let aad = self.aad(name);
        self.cipher
            .decrypt(
                Nonce::from_slice(&body[1..1 + NONCE_LEN]),
                Payload {
                    msg: &body[1 + NONCE_LEN..],
                    aad: aad.as_bytes(),
                },
            )
            .map(Some)
            .map_err(|_| StoreError::Unreadable(format!("record {name} does not open")))
    }

    pub fn write_json<T: Serialize>(&self, name: &str, value: &T) -> Result<usize, StoreError> {
        let bytes = serde_json::to_vec(value).map_err(|error| StoreError::Io(error.to_string()))?;
        self.write(name, &bytes)
    }

    /// A JSON record; `Ok(None)` when absent. An unparseable record is an
    /// error the caller keeps (never deleted).
    pub fn read_json<T: for<'de> Deserialize<'de>>(
        &self,
        name: &str,
    ) -> Result<Option<T>, StoreError> {
        match self.read(name)? {
            None => Ok(None),
            Some(bytes) => serde_json::from_slice(&bytes)
                .map(Some)
                .map_err(|error| StoreError::Unreadable(format!("record {name}: {error}"))),
        }
    }

    pub fn delete(&self, name: &str) -> Result<(), StoreError> {
        match std::fs::remove_file(self.record_path(name)?) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.into()),
        }
    }

    pub fn names(&self) -> Vec<String> {
        std::fs::read_dir(&self.path)
            .map(|entries| {
                entries
                    .filter_map(Result::ok)
                    .filter_map(|entry| entry.file_name().into_string().ok())
                    .filter_map(|name| name.strip_suffix(RECORD_SUFFIX).map(str::to_string))
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

fn create_private_dir(path: &Path) -> Result<(), StoreError> {
    std::fs::create_dir_all(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

fn write_private_atomic(path: &Path, bytes: &[u8]) -> Result<(), StoreError> {
    use std::io::Write;
    let parent = path
        .parent()
        .ok_or_else(|| StoreError::Io("record path has no parent".into()))?;
    let temp = parent.join(format!(
        ".{}.{}.tmp",
        path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("record"),
        crypto::hex(&crypto::random_bytes::<6>())
    ));
    {
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
    }
    if let Err(error) = std::fs::rename(&temp, path) {
        let _ = std::fs::remove_file(&temp);
        return Err(error.into());
    }
    sync_dir(parent);
    Ok(())
}

fn sync_dir(path: &Path) {
    #[cfg(unix)]
    if let Ok(dir) = std::fs::File::open(path) {
        let _ = dir.sync_all();
    }
    #[cfg(not(unix))]
    let _ = path;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn records_round_trip_encrypted_and_bound_to_their_account_and_name() {
        let temp = tempfile::tempdir().unwrap();
        let store = Store::open(temp.path(), [9u8; 32]).unwrap();
        let account = store.account("email-alice", true).unwrap();
        account
            .write("ledger", b"secret plan for the build")
            .unwrap();
        assert_eq!(
            account.read("ledger").unwrap().unwrap(),
            b"secret plan for the build"
        );
        // Nothing on disk holds the plaintext or the account id.
        for entry in walk(temp.path()) {
            let bytes = std::fs::read(&entry).unwrap();
            assert!(!contains(&bytes, b"secret plan"), "{}", entry.display());
            assert!(!entry.display().to_string().contains("alice"));
        }
        // A record moved to another name does not open.
        std::fs::copy(
            account.path().join("ledger.rec"),
            account.path().join("other.rec"),
        )
        .unwrap();
        assert!(matches!(
            account.read("other"),
            Err(StoreError::Unreadable(_))
        ));
        // Another account's key does not open it either.
        let bob = store.account("email-bob", true).unwrap();
        std::fs::copy(
            account.path().join("ledger.rec"),
            bob.path().join("ledger.rec"),
        )
        .unwrap();
        assert!(bob.read("ledger").is_err());
        // A different master key cannot unwrap the data key.
        let other = Store::open(temp.path(), [8u8; 32]).unwrap();
        assert!(other.account("email-alice", false).is_err());
        assert!(!valid_record_name("../x"));
    }

    #[test]
    fn shred_makes_backups_unreadable() {
        let temp = tempfile::tempdir().unwrap();
        let store = Store::open(temp.path(), [9u8; 32]).unwrap();
        let account = store.account("email-alice", true).unwrap();
        account.write("ledger", b"x").unwrap();
        let backup = temp.path().join("backup.rec");
        std::fs::copy(account.path().join("ledger.rec"), &backup).unwrap();
        assert!(store.shred("email-alice").unwrap());
        assert!(!store.exists("email-alice"));
        assert!(store.account("email-alice", false).is_err());
        // A new data key never opens the old record.
        let again = store.account("email-alice", true).unwrap();
        std::fs::copy(&backup, again.path().join("ledger.rec")).unwrap();
        assert!(again.read("ledger").is_err());
    }

    pub(crate) fn walk(root: &Path) -> Vec<PathBuf> {
        let mut out = Vec::new();
        if let Ok(entries) = std::fs::read_dir(root) {
            for entry in entries.filter_map(Result::ok) {
                let path = entry.path();
                if path.is_dir() {
                    out.extend(walk(&path));
                } else {
                    out.push(path);
                }
            }
        }
        out
    }

    pub(crate) fn contains(haystack: &[u8], needle: &[u8]) -> bool {
        haystack
            .windows(needle.len())
            .any(|window| window == needle)
    }
}

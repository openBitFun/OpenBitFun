//! Persistent and per-launch secrets of the backend-protocol listener.
//!
//! Files under `<data dir>/obp/` (owner-only permissions on Unix):
//!
//! - `owner-token`: the per-launch loopback token, rewritten on every start
//!   and removed at shutdown;
//! - `paired-clients.json`: revocable phone/browser credentials, stored as
//!   SHA-256 digests only;
//! - `lan-identity.json`: the self-signed TLS certificate and key of the mesh
//!   listener, kept across launches so paired clients keep their pinned
//!   fingerprint (the name dates from the retired LAN listener and is kept so
//!   upgrades keep the same certificate).
//!
//! `settings.json` (`{lanEnabled, lanPort}`) belonged to the retired LAN
//! listener: it is no longer read and is left on disk untouched.
//!
//! Every reader is tolerant (unknown fields ignored, missing fields
//! defaulted). An unreadable file is moved aside, never silently overwritten.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use base64::Engine;
use rand::RngCore;
use serde::{Deserialize, Serialize};

/// How long a pairing code stays valid.
pub(crate) const PAIRING_CODE_TTL: Duration = Duration::from_secs(5 * 60);
/// Pending pairing codes kept at once (older ones are dropped).
const MAX_PENDING_CODES: usize = 8;

#[cfg(test)]
const LEGACY_SETTINGS_FILE: &str = "settings.json";
const CLIENTS_FILE: &str = "paired-clients.json";
const IDENTITY_FILE: &str = "lan-identity.json";
pub(crate) const OWNER_TOKEN_FILE: &str = "owner-token";

/// A random URL-safe secret of `bytes` random bytes.
pub(crate) fn random_secret(bytes: usize) -> String {
    let mut buffer = vec![0u8; bytes];
    rand::rngs::OsRng.fill_bytes(&mut buffer);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(buffer)
}

pub(crate) use crate::{now_ms, sha256_hex};

/// Constant-time equality of two secrets (length leaks, content does not).
pub(crate) fn secrets_equal(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// Writes `contents` atomically with owner-only permissions where supported.
pub(crate) fn write_private(path: &Path, contents: &[u8]) -> std::io::Result<()> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    std::fs::create_dir_all(parent)?;
    let temp = parent.join(format!(
        ".{}.tmp",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("obp")
    ));
    {
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temp)?;
        std::io::Write::write_all(&mut file, contents)?;
        file.sync_all()?;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&temp, std::fs::Permissions::from_mode(0o600))?;
    }
    std::fs::rename(&temp, path)
}

/// Reads a JSON file: `Ok(None)` when absent; an unreadable file is moved
/// aside (kept for the user) and reported as absent.
fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Option<T> {
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return None,
        Err(error) => {
            log::warn!(
                "OBP state file unreadable: path={}, error={}",
                path.display(),
                error
            );
            return None;
        }
    };
    match serde_json::from_slice(&bytes) {
        Ok(value) => Some(value),
        Err(error) => {
            let aside = path.with_extension(format!("unreadable-{}.json", now_ms()));
            log::warn!(
                "OBP state file could not be parsed; kept aside: path={}, kept={}, error={}",
                path.display(),
                aside.display(),
                error
            );
            let _ = std::fs::rename(path, &aside);
            None
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PairedClientRecord {
    pub id: String,
    #[serde(default)]
    pub name: String,
    /// SHA-256 (hex) of the credential; the credential itself is never stored.
    pub credential_sha256: String,
    #[serde(default)]
    pub created_at_ms: u64,
    #[serde(default)]
    pub last_seen_at_ms: Option<u64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct ClientsFile {
    version: u32,
    clients: Vec<PairedClientRecord>,
}

/// The persisted TLS identity of the mesh listener (`lan-identity.json`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ListenerIdentity {
    /// Base64 DER certificate.
    pub cert_der: String,
    /// Base64 PKCS#8 DER private key.
    pub key_der: String,
    /// `sha256:<hex>` of the certificate DER.
    pub fingerprint: String,
    #[serde(default)]
    pub created_at_ms: u64,
}

struct PendingCode {
    name: String,
    expires: Instant,
}

/// What a successful pairing returns to the client (once).
#[derive(Debug, Clone)]
pub(crate) struct IssuedCredential {
    pub client_id: String,
    pub credential: String,
}

/// The listener's secrets and records.
pub(crate) struct ObpStore {
    dir: PathBuf,
    owner_token: String,
    clients: Vec<PairedClientRecord>,
    pending: HashMap<String, PendingCode>,
}

impl ObpStore {
    /// Loads the records under `dir` and writes a fresh owner token.
    pub(crate) fn open(dir: PathBuf) -> std::io::Result<Self> {
        std::fs::create_dir_all(&dir)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700));
        }
        let owner_token = random_secret(32);
        write_private(&dir.join(OWNER_TOKEN_FILE), owner_token.as_bytes())?;
        let clients = read_json::<ClientsFile>(&dir.join(CLIENTS_FILE))
            .map(|file| file.clients)
            .unwrap_or_default();
        Ok(Self {
            dir,
            owner_token,
            clients,
            pending: HashMap::new(),
        })
    }

    pub(crate) fn owner_token(&self) -> &str {
        &self.owner_token
    }

    pub(crate) fn clients(&self) -> &[PairedClientRecord] {
        &self.clients
    }

    fn save_clients(&self) -> std::io::Result<()> {
        let file = ClientsFile {
            version: 1,
            clients: self.clients.clone(),
        };
        let json = serde_json::to_vec_pretty(&file).map_err(std::io::Error::other)?;
        write_private(&self.dir.join(CLIENTS_FILE), &json)
    }

    /// A new one-time pairing code for a client called `name`.
    pub(crate) fn create_code(&mut self, name: String) -> String {
        let now = Instant::now();
        self.pending.retain(|_, pending| pending.expires > now);
        while self.pending.len() >= MAX_PENDING_CODES {
            let oldest = self
                .pending
                .iter()
                .min_by_key(|(_, pending)| pending.expires)
                .map(|(key, _)| key.clone());
            match oldest {
                Some(key) => {
                    self.pending.remove(&key);
                }
                None => break,
            }
        }
        let code = random_secret(16);
        self.pending.insert(
            sha256_hex(code.as_bytes()),
            PendingCode {
                name,
                expires: now + PAIRING_CODE_TTL,
            },
        );
        code
    }

    /// Consumes a pairing code and issues a credential for it.
    pub(crate) fn redeem_code(
        &mut self,
        code: &str,
        name_override: Option<String>,
    ) -> Result<IssuedCredential, String> {
        let key = sha256_hex(code.as_bytes());
        let pending = self
            .pending
            .remove(&key)
            .ok_or_else(|| "the pairing code is unknown or was already used".to_string())?;
        if pending.expires <= Instant::now() {
            return Err("the pairing code expired; create a new one on the desktop".to_string());
        }
        let credential = random_secret(32);
        let client_id = uuid::Uuid::new_v4().to_string();
        let name = name_override
            .map(|name| name.trim().chars().take(80).collect::<String>())
            .filter(|name| !name.is_empty())
            .unwrap_or(pending.name);
        self.clients.push(PairedClientRecord {
            id: client_id.clone(),
            name,
            credential_sha256: sha256_hex(credential.as_bytes()),
            created_at_ms: now_ms(),
            last_seen_at_ms: None,
        });
        self.save_clients()
            .map_err(|error| format!("failed to store the paired client: {error}"))?;
        Ok(IssuedCredential {
            client_id,
            credential,
        })
    }

    /// The paired client a credential belongs to.
    pub(crate) fn client_for_credential(&self, credential: &str) -> Option<&PairedClientRecord> {
        let digest = sha256_hex(credential.as_bytes());
        self.clients
            .iter()
            .find(|client| secrets_equal(&client.credential_sha256, &digest))
    }

    /// Records that a client connected (in memory; persisted with the next write).
    pub(crate) fn touch_client(&mut self, client_id: &str) {
        if let Some(client) = self
            .clients
            .iter_mut()
            .find(|client| client.id == client_id)
        {
            client.last_seen_at_ms = Some(now_ms());
        }
        let _ = self.save_clients();
    }

    /// Revokes a paired client. Returns whether it existed.
    pub(crate) fn revoke(&mut self, client_id: &str) -> std::io::Result<bool> {
        let before = self.clients.len();
        self.clients.retain(|client| client.id != client_id);
        if self.clients.len() == before {
            return Ok(false);
        }
        self.save_clients()?;
        Ok(true)
    }

    /// The listener TLS identity, generated (and persisted) on first use. The
    /// name dates from the retired LAN listener; the mesh listener uses it.
    pub(crate) fn lan_identity(&self) -> Result<ListenerIdentity, String> {
        let path = self.dir.join(IDENTITY_FILE);
        if let Some(identity) = read_json::<ListenerIdentity>(&path) {
            return Ok(identity);
        }
        let identity = super::tls::generate_identity()?;
        let json = serde_json::to_vec_pretty(&identity).map_err(|error| error.to_string())?;
        write_private(&path, &json)
            .map_err(|error| format!("failed to store the listener certificate: {error}"))?;
        Ok(identity)
    }

    /// Removes the per-launch owner token file.
    pub(crate) fn remove_owner_token(&self) {
        let _ = std::fs::remove_file(self.dir.join(OWNER_TOKEN_FILE));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_are_single_use_and_credentials_are_stored_hashed() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = ObpStore::open(dir.path().to_path_buf()).unwrap();
        let code = store.create_code("Phone".into());
        let issued = store.redeem_code(&code, None).unwrap();
        assert!(store.redeem_code(&code, None).is_err());
        let client = store.client_for_credential(&issued.credential).unwrap();
        assert_eq!(client.name, "Phone");
        let on_disk = std::fs::read_to_string(dir.path().join(CLIENTS_FILE)).unwrap();
        assert!(!on_disk.contains(&issued.credential));
        // A reopened store (next launch) still knows the client; the token changes.
        let token = store.owner_token().to_string();
        let reopened = ObpStore::open(dir.path().to_path_buf()).unwrap();
        assert!(reopened.client_for_credential(&issued.credential).is_some());
        assert_ne!(reopened.owner_token(), token);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(dir.path().join(OWNER_TOKEN_FILE))
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o600);
        }
    }

    #[test]
    fn legacy_and_unreadable_records_are_tolerated() {
        let dir = tempfile::tempdir().unwrap();
        // An older/newer shape: missing optional fields, extra unknown ones.
        std::fs::write(
            dir.path().join(CLIENTS_FILE),
            r#"{"clients":[{"id":"a","credentialSha256":"00","future":1}]}"#,
        )
        .unwrap();
        std::fs::write(dir.path().join(IDENTITY_FILE), "{not json").unwrap();
        let store = ObpStore::open(dir.path().to_path_buf()).unwrap();
        assert_eq!(store.clients().len(), 1);
        // An unreadable identity is kept aside (not deleted) and replaced.
        let identity = store.lan_identity().unwrap();
        assert!(identity.fingerprint.starts_with("sha256:"));
        let kept = std::fs::read_dir(dir.path())
            .unwrap()
            .filter_map(Result::ok)
            .any(|entry| entry.file_name().to_string_lossy().contains("unreadable"));
        assert!(kept);
    }

    #[test]
    fn the_retired_lan_settings_file_is_left_untouched() {
        let dir = tempfile::tempdir().unwrap();
        let legacy = r#"{"lanEnabled":true,"lanPort":47611}"#;
        std::fs::write(dir.path().join(LEGACY_SETTINGS_FILE), legacy).unwrap();
        let mut store = ObpStore::open(dir.path().to_path_buf()).unwrap();
        let code = store.create_code("Phone".into());
        store.redeem_code(&code, None).unwrap();
        // Read by older builds after a downgrade; never rewritten or removed.
        assert_eq!(
            std::fs::read_to_string(dir.path().join(LEGACY_SETTINGS_FILE)).unwrap(),
            legacy
        );
    }
}

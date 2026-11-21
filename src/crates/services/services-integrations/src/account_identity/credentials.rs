use serde::{Deserialize, Serialize};
#[cfg(not(target_os = "macos"))]
use std::sync::{Mutex, OnceLock};

#[cfg(not(target_os = "macos"))]
const KEYRING_SERVICE: &str = "openbitfun.miniapp-market.v1";
const CREDENTIAL_ENTRY: &str = "github-oauth";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredMarketCredentials {
    pub access_token: String,
    pub access_expires_at: i64,
    pub refresh_token: String,
    pub refresh_expires_at: i64,
}

#[cfg(not(target_os = "macos"))]
fn keyring_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

#[cfg(not(target_os = "macos"))]
fn open_entry() -> Result<keyring_core::Entry, String> {
    if keyring_core::get_default_store().is_none() {
        #[cfg(target_os = "windows")]
        let store = windows_native_keyring_store::Store::new();
        #[cfg(all(
            unix,
            not(any(target_os = "macos", target_os = "ios", target_os = "android"))
        ))]
        let store = zbus_secret_service_keyring_store::Store::new();
        #[cfg(not(any(
            target_os = "windows",
            all(
                unix,
                not(any(target_os = "macos", target_os = "ios", target_os = "android"))
            )
        )))]
        let store: keyring_core::Result<std::sync::Arc<keyring_core::CredentialStore>> =
            Err(keyring_core::Error::NoDefaultStore);

        let store =
            store.map_err(|error| format!("initialize system credential store: {error}"))?;
        keyring_core::set_default_store(store);
    }
    keyring_core::Entry::new(KEYRING_SERVICE, CREDENTIAL_ENTRY)
        .map_err(|error| format!("open market credential entry: {error}"))
}

#[cfg(target_os = "macos")]
fn macos_credential_vault(
) -> Result<openbitfun_services_core::credential_vault::CredentialVault, String> {
    profile_credential_vault()
}

/// The profile's prompt-free local credential vault (`<user root>/data`). The
/// account sign-in uses it on macOS; host credentials that must follow the
/// profile (the account directory session) use it on every OS.
pub(crate) fn profile_credential_vault(
) -> Result<openbitfun_services_core::credential_vault::CredentialVault, String> {
    // A profile with its own user root (`OPENBITFUN_USER_ROOT`, as the path
    // manager resolves it) keeps its account sign-in there, so a scratch or
    // test profile never reads, replaces or deletes the default profile's.
    let user_root = ["OPENBITFUN_USER_ROOT", "OPENBITFUN_E2E_USER_ROOT"]
        .iter()
        .filter_map(|name| std::env::var_os(name))
        .find(|value| !value.is_empty())
        .map(std::path::PathBuf::from);
    let base = match user_root {
        Some(root) => root,
        None => dirs::config_dir()
            .ok_or_else(|| "system config directory unavailable".to_string())?
            .join(openbitfun_services_core::product_identity::data_namespace()),
    }
    .join("data");
    Ok(
        openbitfun_services_core::credential_vault::CredentialVault::new(
            base.join(".market_credentials_vault.key"),
            base.join("market_credentials_vault.json"),
        ),
    )
}

pub async fn load_market_credentials() -> Result<Option<StoredMarketCredentials>, String> {
    #[cfg(target_os = "macos")]
    {
        let Some(secret) = macos_credential_vault()?
            .get(CREDENTIAL_ENTRY)
            .await
            .map_err(|error| format!("read market credentials: {error:#}"))?
        else {
            return Ok(None);
        };
        return serde_json::from_slice(&secret)
            .map(Some)
            .map_err(|error| format!("parse market credentials: {error}"));
    }
    #[cfg(not(target_os = "macos"))]
    {
        tokio::task::spawn_blocking(move || {
            let _guard = keyring_lock()
                .lock()
                .map_err(|_| "market credential lock poisoned".to_string())?;
            let entry = open_entry()?;
            let secret = match entry.get_secret() {
                Ok(secret) => secret,
                Err(keyring_core::Error::NoEntry) => return Ok(None),
                Err(error) => return Err(format!("read market credentials: {error}")),
            };
            serde_json::from_slice(&secret)
                .map(Some)
                .map_err(|error| format!("parse market credentials: {error}"))
        })
        .await
        .map_err(|error| format!("join market credential read: {error}"))?
    }
}

pub async fn save_market_credentials(credentials: &StoredMarketCredentials) -> Result<(), String> {
    let secret = serde_json::to_vec(credentials)
        .map_err(|error| format!("serialize market credentials: {error}"))?;
    #[cfg(target_os = "macos")]
    {
        return macos_credential_vault()?
            .set(CREDENTIAL_ENTRY, &secret)
            .await
            .map_err(|error| format!("write market credentials: {error:#}"));
    }
    #[cfg(not(target_os = "macos"))]
    {
        tokio::task::spawn_blocking(move || {
            let _guard = keyring_lock()
                .lock()
                .map_err(|_| "market credential lock poisoned".to_string())?;
            open_entry()?
                .set_secret(&secret)
                .map_err(|error| format!("write market credentials: {error}"))
        })
        .await
        .map_err(|error| format!("join market credential write: {error}"))?
    }
}

pub async fn clear_market_credentials() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        return macos_credential_vault()?
            .remove(CREDENTIAL_ENTRY)
            .await
            .map_err(|error| format!("delete market credentials: {error:#}"));
    }
    #[cfg(not(target_os = "macos"))]
    {
        tokio::task::spawn_blocking(move || {
            let _guard = keyring_lock()
                .lock()
                .map_err(|_| "market credential lock poisoned".to_string())?;
            match open_entry()?.delete_credential() {
                Ok(()) | Err(keyring_core::Error::NoEntry) => Ok(()),
                Err(error) => Err(format!("delete market credentials: {error}")),
            }
        })
        .await
        .map_err(|error| format!("join market credential delete: {error}"))?
    }
}

/// Where a client keeps its account sign-in. `Profile` is the product store
/// (the profile vault on macOS, the OS credential store elsewhere); a test
/// uses a vault of its own.
#[derive(Debug, Clone, Default)]
pub(crate) enum CredentialStore {
    #[default]
    Profile,
    #[cfg(test)]
    Vault(openbitfun_services_core::credential_vault::CredentialVault),
}

impl CredentialStore {
    pub(crate) async fn load(&self) -> Result<Option<StoredMarketCredentials>, String> {
        match self {
            Self::Profile => load_market_credentials().await,
            #[cfg(test)]
            Self::Vault(vault) => match vault
                .get(CREDENTIAL_ENTRY)
                .await
                .map_err(|error| format!("{error:#}"))?
            {
                Some(secret) => serde_json::from_slice(&secret)
                    .map(Some)
                    .map_err(|error| error.to_string()),
                None => Ok(None),
            },
        }
    }

    pub(crate) async fn save(&self, credentials: &StoredMarketCredentials) -> Result<(), String> {
        match self {
            Self::Profile => save_market_credentials(credentials).await,
            #[cfg(test)]
            Self::Vault(vault) => vault
                .set(
                    CREDENTIAL_ENTRY,
                    &serde_json::to_vec(credentials).map_err(|error| error.to_string())?,
                )
                .await
                .map_err(|error| format!("{error:#}")),
        }
    }

    pub(crate) async fn clear(&self) -> Result<(), String> {
        match self {
            Self::Profile => clear_market_credentials().await,
            #[cfg(test)]
            Self::Vault(vault) => vault
                .remove(CREDENTIAL_ENTRY)
                .await
                .map_err(|error| format!("{error:#}")),
        }
    }

    /// Serializes changes to the stored token pair: one task at a time in
    /// this process and one process at a time per profile (the profile
    /// vault's update lock, which a desktop and a CLI daemon on the same
    /// profile share). It is held across a refresh request, so a second
    /// refresher waits and then reads the rotated pair instead of spending the
    /// refresh token the first one already consumed.
    pub(crate) async fn update_guard(&self) -> CredentialUpdateGuard {
        static IN_PROCESS: std::sync::OnceLock<tokio::sync::Mutex<()>> = std::sync::OnceLock::new();
        let in_process = IN_PROCESS
            .get_or_init(|| tokio::sync::Mutex::new(()))
            .lock()
            .await;
        let vault = match self {
            Self::Profile => profile_credential_vault(),
            #[cfg(test)]
            Self::Vault(vault) => Ok(vault.clone()),
        };
        let across_processes = match vault {
            Ok(vault) => match vault.update_lock().await {
                Ok(lock) => Some(lock),
                Err(error) => {
                    log::warn!("Account credential update lock unavailable: {error:#}");
                    None
                }
            },
            Err(error) => {
                log::warn!("Account credential update lock unavailable: {error}");
                None
            }
        };
        CredentialUpdateGuard {
            _across_processes: across_processes,
            _in_process: in_process,
        }
    }
}

/// Held while a client changes the stored token pair; released on drop.
pub(crate) struct CredentialUpdateGuard {
    _across_processes:
        Option<openbitfun_services_core::credential_vault::CredentialVaultUpdateLock>,
    _in_process: tokio::sync::MutexGuard<'static, ()>,
}

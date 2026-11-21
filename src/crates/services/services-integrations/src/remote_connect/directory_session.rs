//! The new-version account directory session.
//!
//! New-version hosts (the native desktop backend and the CLI host) keep the
//! account's device rows and X25519 keys in the account directory of the new
//! service (`https://super.openbitfun.com/directory`, a relay-service
//! instance with its own database). Everything the device network, the fleet
//! and the cloud node need (pair keys, row kinds, device names) goes through
//! this session. The legacy relay login (`DEFAULT_RELAY_URL`) is kept only for
//! the legacy paths that serve older clients (Remote Connect invitations,
//! HostInvoke for older peers, Pages, delegated tokens); nothing here reads it.
//!
//! The session is created from the account identity alone (the identity
//! access token): it does not need, and never waits for, a legacy relay
//! session. It is cached per device, renewed when it ages out or the
//! directory answers 401, and revoked on sign-out or account change. The
//! device's X25519 secret is scoped to the directory URL
//! (`session_store::device_secret`), and every new-version path uses this
//! session for both its own secret and peer keys, so the two always match.
//!
//! The first session of an account in a process also asks the account's cloud
//! node to exist (`POST <origin>/agent/api/v1/ensure`), best effort: it never
//! blocks or fails the caller.
//!
//! The session is kept in the profile's credential vault
//! ([`VaultDirectorySessions`], under `OPENBITFUN_USER_ROOT` when a profile has
//! its own user root), so a host start reuses the token the directory issued
//! instead of minting another 30-day one. It is reused while it is younger than
//! [`RENEW_AFTER`] and the signed-in identity is still its account; a token
//! that is replaced is revoked at the directory.

use std::collections::HashMap;
use std::future::Future;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};

use anyhow::{anyhow, Result};
use async_trait::async_trait;
use tokio::sync::Mutex;

use super::account::{
    error_indicates_expired_token, validate_relay_base_url, AccountClient, AccountSession,
};
use super::DeviceIdentity;

/// Overrides the account directory base URL (scratch profiles, self-hosting).
pub const DIRECTORY_URL_ENV: &str = "OPENBITFUN_ACCOUNT_DIRECTORY_URL";
/// The cloud node's provisioning route, under the directory's origin.
pub const ENSURE_PATH: &str = "/agent/api/v1/ensure";
/// A cached session is renewed after this long (it also re-checks the
/// identity). Directory tokens live 30 days.
const MAX_SESSION_AGE: Duration = Duration::from_secs(12 * 3600);
/// A failed `ensure` is retried no sooner than this.
const ENSURE_RETRY: Duration = Duration::from_secs(10 * 60);
/// A directory token is replaced once it is this old (they live 30 days), so
/// a reused token never runs out mid-use.
pub const RENEW_AFTER: Duration = Duration::from_secs(15 * 86400);

/// The directory base URL: [`DIRECTORY_URL_ENV`] when it is a valid relay
/// base URL, else [`openbitfun_product_domains::account::DEFAULT_ACCOUNT_DIRECTORY_URL`].
pub fn account_directory_url() -> String {
    directory_url_from(std::env::var(DIRECTORY_URL_ENV).ok().as_deref())
}

fn directory_url_from(value: Option<&str>) -> String {
    let default = openbitfun_product_domains::account::DEFAULT_ACCOUNT_DIRECTORY_URL;
    match value.map(str::trim).filter(|value| !value.is_empty()) {
        Some(value) if validate_relay_base_url(value).is_ok() => {
            value.trim_end_matches('/').to_string()
        }
        Some(_) => {
            log::warn!("Ignoring an invalid {DIRECTORY_URL_ENV}; using the default directory");
            default.to_string()
        }
        None => default.to_string(),
    }
}

/// `<scheme>://<host>[:port]/agent/api/v1/ensure` for a directory URL.
pub fn ensure_url(directory_url: &str) -> Option<String> {
    let url = validate_relay_base_url(directory_url).ok()?;
    let origin = url.origin();
    if !origin.is_tuple() {
        return None;
    }
    Some(format!("{}{ENSURE_PATH}", origin.ascii_serialization()))
}

/// How a directory session is made and retired (the network part, so the
/// cache is tested without it).
#[async_trait]
pub trait DirectoryLogin: Send + Sync + 'static {
    /// Signs `device` in to the directory at `url` with the account identity.
    async fn login(&self, url: &str, device: &DeviceIdentity) -> Result<AccountSession>;
    /// Revokes a session's token (best effort).
    async fn revoke(&self, url: &str, session: &AccountSession);
    /// Asks the account's cloud node to exist.
    async fn ensure(&self, url: &str) -> Result<()>;
    /// The signed-in identity's account id (`None` when signed out). A kept
    /// session is reused only for this account; an implementation that cannot
    /// tell never reuses one.
    async fn current_account(&self) -> Result<Option<String>> {
        Err(anyhow!(
            "this directory login cannot name the signed-in account"
        ))
    }
}

/// A directory session as the profile's credential vault keeps it.
#[derive(Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedDirectorySession {
    pub url: String,
    pub device_id: String,
    pub user_id: String,
    pub token: String,
    /// The device's X25519 secret the session was issued for (base64).
    pub device_secret: String,
    /// When the directory issued the token (unix ms).
    pub issued_at_ms: i64,
}

impl std::fmt::Debug for PersistedDirectorySession {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PersistedDirectorySession")
            .field("url", &self.url)
            .field("device_id", &self.device_id)
            .field("user_id", &self.user_id)
            .field("issued_at_ms", &self.issued_at_ms)
            .finish_non_exhaustive()
    }
}

impl PersistedDirectorySession {
    fn of(url: &str, device_id: &str, session: &AccountSession, issued_at_ms: i64) -> Self {
        use base64::Engine;
        Self {
            url: url.to_string(),
            device_id: device_id.to_string(),
            user_id: session.user_id.clone(),
            token: session.token.clone(),
            device_secret: base64::engine::general_purpose::STANDARD.encode(session.master_key),
            issued_at_ms,
        }
    }

    fn session(&self) -> Option<AccountSession> {
        use base64::Engine;
        let secret: [u8; 32] = base64::engine::general_purpose::STANDARD
            .decode(&self.device_secret)
            .ok()?
            .try_into()
            .ok()?;
        Some(AccountSession::new(
            self.token.clone(),
            self.user_id.clone(),
            secret,
        ))
    }

    fn age(&self, now_ms: i64) -> Duration {
        Duration::from_millis(now_ms.saturating_sub(self.issued_at_ms).max(0) as u64)
    }
}

/// Where a device's directory session is kept across host starts.
#[async_trait]
pub trait DirectorySessionVault: Send + Sync + 'static {
    async fn load(&self, device_id: &str) -> Result<Option<PersistedDirectorySession>>;
    async fn save(&self, session: &PersistedDirectorySession) -> Result<()>;
    async fn clear(&self, device_id: &str) -> Result<()>;
}

/// The profile's credential vault (`<user root>/data`, the same vault as the
/// account sign-in), one entry per device id.
pub struct VaultDirectorySessions;

impl VaultDirectorySessions {
    fn entry(device_id: &str) -> String {
        format!("account-directory-session:{device_id}")
    }

    fn vault() -> Result<openbitfun_services_core::credential_vault::CredentialVault> {
        crate::account_identity::profile_credential_vault().map_err(|e| anyhow!(e))
    }
}

#[async_trait]
impl DirectorySessionVault for VaultDirectorySessions {
    async fn load(&self, device_id: &str) -> Result<Option<PersistedDirectorySession>> {
        let Some(bytes) = Self::vault()?.get(&Self::entry(device_id)).await? else {
            return Ok(None);
        };
        // A record this build cannot read is left alone and a new session is
        // made; it is replaced, never deleted here.
        Ok(serde_json::from_slice(&bytes).ok())
    }

    async fn save(&self, session: &PersistedDirectorySession) -> Result<()> {
        Self::vault()?
            .set(
                &Self::entry(&session.device_id),
                &serde_json::to_vec(session)?,
            )
            .await
    }

    async fn clear(&self, device_id: &str) -> Result<()> {
        Self::vault()?.remove(&Self::entry(device_id)).await
    }
}

fn unix_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or(0)
}

/// The real login: the identity access token, the directory's
/// `/api/auth/login`, its `/api/auth/logout`, and the cloud node's ensure.
pub struct IdentityDirectoryLogin {
    host_is_cli: bool,
}

impl IdentityDirectoryLogin {
    pub fn new(host_is_cli: bool) -> Self {
        Self { host_is_cli }
    }
}

#[async_trait]
impl DirectoryLogin for IdentityDirectoryLogin {
    async fn login(&self, url: &str, device: &DeviceIdentity) -> Result<AccountSession> {
        let client = AccountClient::new();
        let kind = client.reported_device_kind(url, self.host_is_cli).await;
        let (session, _) = client.login_with_identity(url, device, kind).await?;
        Ok(session)
    }

    async fn revoke(&self, url: &str, session: &AccountSession) {
        if let Err(error) = AccountClient::new().revoke_token(url, session).await {
            log::warn!("Account directory sign-out failed: {error}");
        }
    }

    async fn ensure(&self, url: &str) -> Result<()> {
        let endpoint = ensure_url(url).ok_or_else(|| anyhow!("no cloud node address"))?;
        let mut identity =
            crate::account_identity::AccountIdentityClient::from_environment().await?;
        let token = identity
            .access_token()
            .await?
            .ok_or_else(|| anyhow!("not signed in"))?;
        let response = super::relay_http::relay_http_client()
            .post(endpoint)
            .bearer_auth(token)
            .timeout(Duration::from_secs(20))
            .send()
            .await?;
        if response.status().is_success() {
            Ok(())
        } else {
            Err(anyhow!(
                "cloud node ensure answered HTTP {}",
                response.status()
            ))
        }
    }

    async fn current_account(&self) -> Result<Option<String>> {
        let mut identity =
            crate::account_identity::AccountIdentityClient::from_environment().await?;
        Ok(identity
            .me()
            .await?
            .and_then(|profile| profile.user.identity_id()))
    }
}

struct Entry {
    device_id: String,
    at: Instant,
    session: AccountSession,
    /// When the directory issued the token (unix ms).
    issued_at_ms: i64,
}

/// The process's directory session (one signed-in account at a time).
pub struct DirectorySessions {
    url: String,
    login: Arc<dyn DirectoryLogin>,
    entry: Mutex<Option<Entry>>,
    /// Account id -> when its ensure last ran and whether it succeeded.
    ensured: Arc<StdMutex<HashMap<String, (Instant, bool)>>>,
    /// Keeps the session across host starts (none in tests by default).
    vault: Option<Arc<dyn DirectorySessionVault>>,
}

impl DirectorySessions {
    pub fn new(url: impl Into<String>, login: Arc<dyn DirectoryLogin>) -> Self {
        Self {
            url: url.into(),
            login,
            entry: Mutex::new(None),
            ensured: Arc::new(StdMutex::new(HashMap::new())),
            vault: None,
        }
    }

    /// Keeps the session in `vault` across host starts.
    pub fn with_vault(mut self, vault: Arc<dyn DirectorySessionVault>) -> Self {
        self.vault = Some(vault);
        self
    }

    /// The directory from the environment with the real identity login.
    pub fn from_environment(host_is_cli: bool) -> Self {
        Self::new(
            account_directory_url(),
            Arc::new(IdentityDirectoryLogin::new(host_is_cli)),
        )
        .with_vault(Arc::new(VaultDirectorySessions))
    }

    /// The directory base URL every new-version path joins its API paths on.
    pub fn url(&self) -> &str {
        &self.url
    }

    /// The session for `device` and the directory URL, signing in when there
    /// is none, it belongs to another device, or it aged out.
    pub async fn context(&self, device: &DeviceIdentity) -> Result<(AccountSession, String)> {
        let mut entry = self.entry.lock().await;
        if let Some(current) = entry.as_mut() {
            if current.device_id == device.device_id && current.at.elapsed() < MAX_SESSION_AGE {
                return Ok((current.session.clone(), self.url.clone()));
            }
            // Aged out: a token that is not near its expiry is kept while the
            // identity is still its account.
            if current.device_id == device.device_id
                && Duration::from_millis(
                    unix_ms().saturating_sub(current.issued_at_ms).max(0) as u64
                ) < RENEW_AFTER
                && self.identity_owns(&current.session.user_id).await == Some(true)
            {
                current.at = Instant::now();
                return Ok((current.session.clone(), self.url.clone()));
            }
        }
        // The first session of this process: the one an earlier start kept.
        if entry.is_none() {
            if let Some((session, issued_at_ms)) = self.restore(device).await {
                log::info!(
                    "Account directory session restored: account={}, device={}",
                    session.user_id,
                    device.device_id
                );
                self.ensure_in_background(&session.user_id);
                *entry = Some(Entry {
                    device_id: device.device_id.clone(),
                    at: Instant::now(),
                    session: session.clone(),
                    issued_at_ms,
                });
                return Ok((session, self.url.clone()));
            }
        }
        let session = self.login.login(&self.url, device).await?;
        let issued_at_ms = unix_ms();
        if let Some(previous) = entry.take() {
            if previous.session.token != session.token {
                self.revoke_in_background(previous.session);
            }
        }
        log::info!(
            "Account directory session ready: account={}, device={}",
            session.user_id,
            device.device_id
        );
        self.ensure_in_background(&session.user_id);
        self.persist(PersistedDirectorySession::of(
            &self.url,
            &device.device_id,
            &session,
            issued_at_ms,
        ))
        .await;
        *entry = Some(Entry {
            device_id: device.device_id.clone(),
            at: Instant::now(),
            session: session.clone(),
            issued_at_ms,
        });
        Ok((session, self.url.clone()))
    }

    /// Whether the signed-in identity is `account_id` (`None`: unknown now).
    async fn identity_owns(&self, account_id: &str) -> Option<bool> {
        match self.login.current_account().await {
            Ok(current) => Some(current.as_deref() == Some(account_id)),
            Err(error) => {
                log::debug!("Account directory identity check unavailable: {error:#}");
                None
            }
        }
    }

    /// The kept session of `device`, when it is for this directory, young
    /// enough and the identity's. One that is definitely unusable (another
    /// directory or account, signed out, old) is revoked; the next sign-in
    /// replaces its record.
    async fn restore(&self, device: &DeviceIdentity) -> Option<(AccountSession, i64)> {
        let vault = self.vault.as_ref()?;
        let record = match vault.load(&device.device_id).await {
            Ok(record) => record?,
            Err(error) => {
                log::warn!("Account directory session not read from the vault: {error:#}");
                return None;
            }
        };
        let session = record.session();
        let usable = if session.is_none()
            || record.url != self.url
            || record.device_id != device.device_id
            || record.age(unix_ms()) >= RENEW_AFTER
        {
            Some(false)
        } else {
            self.identity_owns(&record.user_id).await
        };
        match usable {
            Some(true) => Some((session?, record.issued_at_ms)),
            Some(false) => {
                // Revoking needs only the token.
                let session = session.unwrap_or_else(|| {
                    AccountSession::new(record.token.clone(), record.user_id.clone(), [0; 32])
                });
                let login = Arc::clone(&self.login);
                if let Ok(handle) = tokio::runtime::Handle::try_current() {
                    handle.spawn(async move { login.revoke(&record.url, &session).await });
                }
                None
            }
            None => None,
        }
    }

    async fn persist(&self, record: PersistedDirectorySession) {
        if let Some(vault) = self.vault.as_ref() {
            if let Err(error) = vault.save(&record).await {
                log::warn!("Account directory session not kept in the vault: {error:#}");
            }
        }
    }

    async fn forget(&self, device_id: &str) {
        if let Some(vault) = self.vault.as_ref() {
            if let Err(error) = vault.clear(device_id).await {
                log::warn!("Account directory session not removed from the vault: {error:#}");
            }
        }
    }

    /// The cached session while it is fresh, without any network call.
    pub async fn cached(&self) -> Option<(AccountSession, String)> {
        self.entry
            .lock()
            .await
            .as_ref()
            .filter(|entry| entry.at.elapsed() < MAX_SESSION_AGE)
            .map(|entry| (entry.session.clone(), self.url.clone()))
    }

    /// Drops the cached session when it still holds `token` (the directory
    /// answered 401 for it); the next [`Self::context`] signs in again.
    pub async fn invalidate(&self, token: &str) {
        let mut entry = self.entry.lock().await;
        if entry
            .as_ref()
            .is_some_and(|entry| entry.session.token == token)
        {
            if let Some(dropped) = entry.take() {
                self.forget(&dropped.device_id).await;
            }
            *entry = None;
        }
    }

    /// Signs out: revokes and forgets the session. Idempotent.
    pub async fn sign_out(&self) {
        let previous = self.entry.lock().await.take();
        if let Some(previous) = previous {
            self.forget(&previous.device_id).await;
            self.login.revoke(&self.url, &previous.session).await;
            log::info!(
                "Account directory session closed: account={}",
                previous.session.user_id
            );
        }
    }

    /// Forgets the session when it belongs to another account than
    /// `account_id` (an account replacement), revoking it.
    pub async fn retire_other_account(&self, account_id: &str) {
        let stale = {
            let mut entry = self.entry.lock().await;
            if entry
                .as_ref()
                .is_some_and(|entry| entry.session.user_id != account_id)
            {
                entry.take()
            } else {
                None
            }
        };
        if let Some(stale) = stale {
            self.forget(&stale.device_id).await;
            self.login.revoke(&self.url, &stale.session).await;
        }
    }

    /// Runs `call` with the session; a 401 drops it and retries once with a
    /// fresh sign-in.
    pub async fn with_session<T, F, Fut>(&self, device: &DeviceIdentity, call: F) -> Result<T>
    where
        F: Fn(AccountSession, String) -> Fut,
        Fut: Future<Output = Result<T>>,
    {
        let (session, url) = self.context(device).await?;
        let token = session.token.clone();
        match call(session, url).await {
            Err(error) if error_indicates_expired_token(&format!("{error:#}")) => {
                self.invalidate(&token).await;
                let (session, url) = self.context(device).await?;
                call(session, url).await
            }
            other => other,
        }
    }

    fn revoke_in_background(&self, session: AccountSession) {
        let login = Arc::clone(&self.login);
        let url = self.url.clone();
        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            handle.spawn(async move { login.revoke(&url, &session).await });
        }
    }

    fn ensure_in_background(&self, account_id: &str) {
        {
            let mut ensured = self
                .ensured
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            match ensured.get(account_id) {
                Some((_, true)) => return,
                Some((at, false)) if at.elapsed() < ENSURE_RETRY => return,
                _ => {}
            }
            ensured.insert(account_id.to_string(), (Instant::now(), false));
        }
        let Ok(handle) = tokio::runtime::Handle::try_current() else {
            return;
        };
        let login = Arc::clone(&self.login);
        let url = self.url.clone();
        let ensured = Arc::clone(&self.ensured);
        let account_id = account_id.to_string();
        handle.spawn(async move {
            let result = login.ensure(&url).await;
            let ok = result.is_ok();
            match result {
                Ok(()) => log::info!("Cloud node ensured: account={account_id}"),
                Err(error) => {
                    log::warn!("Cloud node ensure failed: account={account_id}, error={error}")
                }
            }
            ensured
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .insert(account_id, (Instant::now(), ok));
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[derive(Default)]
    struct FakeLogin {
        logins: AtomicUsize,
        revoked: StdMutex<Vec<String>>,
        ensures: AtomicUsize,
        fail_ensure: bool,
        account: StdMutex<String>,
    }

    #[async_trait]
    impl DirectoryLogin for FakeLogin {
        async fn login(&self, url: &str, device: &DeviceIdentity) -> Result<AccountSession> {
            assert_eq!(url, "https://directory.test/directory");
            let n = self.logins.fetch_add(1, Ordering::SeqCst) + 1;
            let account = self.account.lock().unwrap().clone();
            Ok(AccountSession::new(
                format!("token-{n}-{}", device.device_id),
                account,
                [7; 32],
            ))
        }

        async fn revoke(&self, _url: &str, session: &AccountSession) {
            self.revoked.lock().unwrap().push(session.token.clone());
        }

        async fn ensure(&self, _url: &str) -> Result<()> {
            self.ensures.fetch_add(1, Ordering::SeqCst);
            if self.fail_ensure {
                Err(anyhow!("superagent_unavailable"))
            } else {
                Ok(())
            }
        }

        async fn current_account(&self) -> Result<Option<String>> {
            let account = self.account.lock().unwrap().clone();
            Ok(Some(account).filter(|account| !account.is_empty()))
        }
    }

    /// The vault of one profile, shared by the "processes" of a test.
    #[derive(Default)]
    struct MemoryVault(StdMutex<HashMap<String, PersistedDirectorySession>>);

    #[async_trait]
    impl DirectorySessionVault for MemoryVault {
        async fn load(&self, device_id: &str) -> Result<Option<PersistedDirectorySession>> {
            Ok(self.0.lock().unwrap().get(device_id).cloned())
        }

        async fn save(&self, session: &PersistedDirectorySession) -> Result<()> {
            self.0
                .lock()
                .unwrap()
                .insert(session.device_id.clone(), session.clone());
            Ok(())
        }

        async fn clear(&self, device_id: &str) -> Result<()> {
            self.0.lock().unwrap().remove(device_id);
            Ok(())
        }
    }

    fn kept(fake: &Arc<FakeLogin>, vault: &Arc<MemoryVault>) -> DirectorySessions {
        sessions(fake).with_vault(vault.clone())
    }

    #[tokio::test]
    async fn a_host_start_reuses_the_kept_session_instead_of_minting_another() {
        let fake = Arc::new(FakeLogin::default());
        let vault = Arc::new(MemoryVault::default());
        let (first, _) = kept(&fake, &vault).context(&device("dev-a")).await.unwrap();
        let record = vault.0.lock().unwrap()["dev-a"].clone();
        assert_eq!(record.token, first.token);
        assert_eq!(record.user_id, "acct-1");
        assert_eq!(record.url, "https://directory.test/directory");
        // Three more starts of the host.
        for _ in 0..3 {
            let (again, _) = kept(&fake, &vault).context(&device("dev-a")).await.unwrap();
            assert_eq!(again.token, first.token);
            assert_eq!(again.master_key, first.master_key);
        }
        assert_eq!(fake.logins.load(Ordering::SeqCst), 1);
        settle().await;
        assert!(fake.revoked.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn a_kept_session_near_expiry_or_of_another_account_is_revoked_and_replaced() {
        let fake = Arc::new(FakeLogin::default());
        let vault = Arc::new(MemoryVault::default());
        let (first, _) = kept(&fake, &vault).context(&device("dev-a")).await.unwrap();
        // Issued 16 days ago: replaced, and the old token revoked.
        vault
            .0
            .lock()
            .unwrap()
            .get_mut("dev-a")
            .unwrap()
            .issued_at_ms -= 16 * 86_400_000;
        let (second, _) = kept(&fake, &vault).context(&device("dev-a")).await.unwrap();
        assert_ne!(second.token, first.token);
        settle().await;
        assert_eq!(*fake.revoked.lock().unwrap(), vec![first.token.clone()]);
        assert_eq!(vault.0.lock().unwrap()["dev-a"].token, second.token);
        // Another account signed in while the host was down.
        *fake.account.lock().unwrap() = "acct-2".into();
        let other = DirectorySessions::new("https://directory.test/directory", fake.clone())
            .with_vault(vault.clone());
        let (third, _) = other.context(&device("dev-a")).await.unwrap();
        assert_eq!(third.user_id, "acct-2");
        settle().await;
        assert_eq!(
            *fake.revoked.lock().unwrap(),
            vec![first.token.clone(), second.token.clone()]
        );
        // A record for another directory is never sent to this one as a session.
        vault.0.lock().unwrap().get_mut("dev-a").unwrap().url = "https://old.test/directory".into();
        let (fourth, _) = other.context(&device("dev-a")).await.unwrap();
        assert_eq!(fourth.token, third.token, "the in-process session stays");
        assert_eq!(fake.logins.load(Ordering::SeqCst), 3);
    }

    #[tokio::test]
    async fn an_unreadable_kept_secret_signs_in_again_and_sign_out_forgets_the_record() {
        let fake = Arc::new(FakeLogin::default());
        let vault = Arc::new(MemoryVault::default());
        kept(&fake, &vault).context(&device("dev-a")).await.unwrap();
        vault
            .0
            .lock()
            .unwrap()
            .get_mut("dev-a")
            .unwrap()
            .device_secret = "not base64".into();
        let sessions = kept(&fake, &vault);
        let (second, _) = sessions.context(&device("dev-a")).await.unwrap();
        assert_eq!(fake.logins.load(Ordering::SeqCst), 2);
        assert_eq!(vault.0.lock().unwrap()["dev-a"].token, second.token);
        settle().await;
        assert_eq!(
            fake.revoked.lock().unwrap().len(),
            1,
            "the unreadable one is revoked"
        );
        sessions.sign_out().await;
        assert!(vault.0.lock().unwrap().is_empty());
        assert_eq!(fake.revoked.lock().unwrap().last(), Some(&second.token));
    }

    #[test]
    fn a_kept_record_round_trips_and_hides_its_secrets_from_debug() {
        let session = AccountSession::new("tok".into(), "acct-1".into(), [3; 32]);
        let record =
            PersistedDirectorySession::of("https://d.test/directory", "dev-a", &session, 42);
        let json = serde_json::to_value(&record).unwrap();
        assert_eq!(json["issuedAtMs"], 42);
        assert_eq!(json["deviceId"], "dev-a");
        let back: PersistedDirectorySession = serde_json::from_value(json).unwrap();
        assert_eq!(back.session().unwrap().master_key, [3; 32]);
        let debug = format!("{record:?}");
        assert!(!debug.contains("tok\"") && !debug.contains(&record.device_secret));
    }

    fn device(id: &str) -> DeviceIdentity {
        DeviceIdentity {
            device_id: id.to_string(),
            device_name: "Test".to_string(),
            mac_address: String::new(),
        }
    }

    fn sessions(fake: &Arc<FakeLogin>) -> DirectorySessions {
        *fake.account.lock().unwrap() = "acct-1".into();
        DirectorySessions::new("https://directory.test/directory", fake.clone())
    }

    async fn settle() {
        for _ in 0..20 {
            tokio::task::yield_now().await;
        }
    }

    #[test]
    fn directory_url_defaults_and_overrides() {
        assert_eq!(
            directory_url_from(None),
            openbitfun_product_domains::account::DEFAULT_ACCOUNT_DIRECTORY_URL
        );
        assert_eq!(
            directory_url_from(Some("http://127.0.0.1:19750/directory/")),
            "http://127.0.0.1:19750/directory"
        );
        // An unusable override falls back to the default, loudly.
        assert_eq!(
            directory_url_from(Some("ftp://x")),
            openbitfun_product_domains::account::DEFAULT_ACCOUNT_DIRECTORY_URL
        );
        assert_eq!(
            ensure_url("https://super.openbitfun.com/directory").as_deref(),
            Some("https://super.openbitfun.com/agent/api/v1/ensure")
        );
        assert_eq!(
            ensure_url("http://127.0.0.1:19750/directory").as_deref(),
            Some("http://127.0.0.1:19750/agent/api/v1/ensure")
        );
        assert_eq!(ensure_url("not a url"), None);
    }

    #[tokio::test]
    async fn signs_in_once_and_reuses_the_session() {
        let fake = Arc::new(FakeLogin::default());
        let sessions = sessions(&fake);
        let (first, url) = sessions.context(&device("dev-a")).await.unwrap();
        assert_eq!(url, "https://directory.test/directory");
        let (second, _) = sessions.context(&device("dev-a")).await.unwrap();
        assert_eq!(first.token, second.token);
        assert_eq!(fake.logins.load(Ordering::SeqCst), 1);
        assert_eq!(sessions.cached().await.unwrap().0.token, first.token);
        settle().await;
        // The cloud node was asked for once.
        assert_eq!(fake.ensures.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn unauthorized_signs_in_again_once() {
        let fake = Arc::new(FakeLogin::default());
        let sessions = sessions(&fake);
        let calls = AtomicUsize::new(0);
        let token = sessions
            .with_session(&device("dev-a"), |session, _| {
                let call = calls.fetch_add(1, Ordering::SeqCst);
                async move {
                    if call == 0 {
                        Err(anyhow!("invalid or expired token (HTTP 401 Unauthorized)"))
                    } else {
                        Ok(session.token)
                    }
                }
            })
            .await
            .unwrap();
        assert_eq!(token, "token-2-dev-a");
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        // Other errors are returned as they are.
        let error = sessions
            .with_session(&device("dev-a"), |_, _| async {
                Err::<(), _>(anyhow!("device key lookup failed (HTTP 404)"))
            })
            .await
            .unwrap_err();
        assert!(error.to_string().contains("404"));
        assert_eq!(fake.logins.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn sign_out_revokes_and_the_next_use_signs_in_again() {
        let fake = Arc::new(FakeLogin::default());
        let sessions = sessions(&fake);
        let (first, _) = sessions.context(&device("dev-a")).await.unwrap();
        sessions.sign_out().await;
        assert_eq!(*fake.revoked.lock().unwrap(), vec![first.token.clone()]);
        assert!(sessions.cached().await.is_none());
        sessions.sign_out().await;
        assert_eq!(fake.revoked.lock().unwrap().len(), 1);
        let (second, _) = sessions.context(&device("dev-a")).await.unwrap();
        assert_ne!(first.token, second.token);
    }

    #[tokio::test]
    async fn another_account_retires_the_session() {
        let fake = Arc::new(FakeLogin::default());
        let sessions = sessions(&fake);
        let (first, _) = sessions.context(&device("dev-a")).await.unwrap();
        sessions.retire_other_account("acct-1").await;
        assert!(sessions.cached().await.is_some());
        sessions.retire_other_account("acct-2").await;
        assert!(sessions.cached().await.is_none());
        assert_eq!(*fake.revoked.lock().unwrap(), vec![first.token]);
    }

    #[tokio::test]
    async fn a_failed_ensure_never_fails_the_session_and_is_not_repeated_at_once() {
        let fake = Arc::new(FakeLogin {
            fail_ensure: true,
            ..FakeLogin::default()
        });
        let sessions = sessions(&fake);
        sessions.context(&device("dev-a")).await.unwrap();
        settle().await;
        sessions.sign_out().await;
        sessions.context(&device("dev-a")).await.unwrap();
        settle().await;
        assert_eq!(fake.ensures.load(Ordering::SeqCst), 1);
        assert_eq!(fake.logins.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn another_device_id_signs_in_again() {
        let fake = Arc::new(FakeLogin::default());
        let sessions = sessions(&fake);
        let (first, _) = sessions.context(&device("dev-a")).await.unwrap();
        let (second, _) = sessions.context(&device("dev-b")).await.unwrap();
        assert_ne!(first.token, second.token);
        settle().await;
        assert_eq!(*fake.revoked.lock().unwrap(), vec![first.token]);
    }
}

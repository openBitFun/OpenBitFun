//! Shared account runtime owner for product Hosts.
//!
//! The runtime owns account identity transitions, persisted credentials,
//! and authenticated device connections. Product Hosts
//! inject device-routing and background-owner lifecycle effects without
//! exposing App Server wire DTOs to this owner.

use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, Result};
use async_trait::async_trait;
use tokio::sync::{Mutex, MutexGuard, RwLock};

use openbitfun_services_integrations::remote_connect::account::{
    AccountClient, AccountSession, RoutingIntent,
};
use openbitfun_services_integrations::remote_connect::directory_session::DirectorySessions;
use openbitfun_services_integrations::remote_connect::{session_store, DeviceIdentity};

use super::validate_relay_base_url;

#[derive(Debug, Clone)]
struct AccountContextState {
    session: AccountSession,
    relay_url: String,
}

#[derive(Debug, Clone)]
pub struct AccountRoutingStartRequest {
    pub session: AccountSession,
    pub relay_url: String,
    pub device_name: String,
    pub account_generation: u64,
}

#[derive(Debug)]
pub struct BackgroundRoutingOwnerRetirementError {
    pub error: anyhow::Error,
    pub owner_may_exit: bool,
}

#[async_trait]
pub trait AccountRuntimeHost: Send + Sync {
    /// Whether this host is headless (the CLI/TUI delivery profiles).
    ///
    /// Such a host reports itself as a CLI device, but only to a Relay that
    /// advertises the capability for it — see
    /// `AccountClient::reported_device_kind`. A Desktop host keeps the default.
    fn is_cli_host(&self) -> bool {
        false
    }

    async fn retire_background_routing_owner(
        &self,
    ) -> std::result::Result<bool, BackgroundRoutingOwnerRetirementError>;

    fn background_routing_owner_is_running(&self) -> bool;

    fn request_background_routing_owner_shutdown(&self) -> bool;

    async fn start_device_routing(&self, request: AccountRoutingStartRequest) -> Result<()>;

    async fn stop_device_routing(&self);

    async fn device_routing_is_active(&self) -> bool {
        false
    }

    /// Whether started routing is standing by because another host on this
    /// machine serves the shared device on the Relay.
    async fn device_routing_is_standby(&self) -> bool {
        false
    }
}

pub enum AccountLoginProgress {
    Authorization(openbitfun_product_domains::account::GitHubAuthStart),
    Waiting,
    Complete(AccountLoginResult),
}

#[derive(Debug, Clone)]
pub struct AccountLoginResult {
    pub user_id: String,
    pub relay_url: String,
    pub routing_owner_replaced: bool,
    pub routing_connected: bool,
    /// Routing started but waits for another local host to release the device.
    pub routing_standby: bool,
    pub routing_error: Option<String>,
}

#[derive(Debug, Clone)]
pub struct AccountInfo {
    pub user_id: String,
    pub relay_url: String,
    pub device_id: String,
    pub device_name: String,
}

#[derive(Debug, Clone)]
pub struct AccountDevice {
    pub device_id: String,
    pub device_name: String,
    /// Kind the device reported to the Relay (`desktop`, `cli`, …). Absent on
    /// legacy devices and older Relays.
    pub device_kind: Option<String>,
    pub device_alias: Option<String>,
    pub device_model: Option<String>,
    pub device_os: Option<String>,
    pub device_os_version: Option<String>,
    /// Build string the device last reported to the Relay; absent for legacy
    /// devices and older Relays.
    pub device_client_version: Option<String>,
    /// Control-contract protocol number the device last reported; absent for
    /// legacy devices and older Relays.
    pub device_client_protocol: Option<u32>,
    /// Relay-computed compatibility with our control contract. `None` means
    /// unknown (older Relay) and must be treated as compatible.
    pub compatible: Option<bool>,
    pub online: bool,
}

#[derive(Debug, Clone)]
pub struct AccountSnapshot {
    pub logged_in: bool,
    pub info: Option<AccountInfo>,
    pub devices: Vec<AccountDevice>,
}

pub struct AccountRuntime {
    host: Arc<dyn AccountRuntimeHost>,
    account_context: RwLock<Option<AccountContextState>>,
    account_context_generation: AtomicU64,
    account_context_transitions: AtomicUsize,
    account_login_lock: Mutex<()>,
    account_context_transition_lock: Mutex<()>,
    routing_intent: RoutingIntent,
    renewal_started: AtomicBool,
    renewal_wake: Arc<tokio::sync::Notify>,
    routing_recovery_generation: AtomicU64,
    token_expired: AtomicBool,
    /// The new-version account directory session (device network, fleet,
    /// cloud node). Independent of the legacy relay context above.
    directory: Arc<DirectorySessions>,
}

impl AccountRuntime {
    pub fn new(host: Arc<dyn AccountRuntimeHost>) -> Arc<Self> {
        let directory = Arc::new(DirectorySessions::from_environment(host.is_cli_host()));
        Self::new_with_directory(host, directory)
    }

    /// [`Self::new`] with an explicit directory (tests drive a local one).
    pub fn new_with_directory(
        host: Arc<dyn AccountRuntimeHost>,
        directory: Arc<DirectorySessions>,
    ) -> Arc<Self> {
        Arc::new(Self {
            directory,
            host,
            account_context: RwLock::new(None),
            account_context_generation: AtomicU64::new(1),
            account_context_transitions: AtomicUsize::new(0),
            account_login_lock: Mutex::new(()),
            account_context_transition_lock: Mutex::new(()),
            routing_intent: RoutingIntent::new(),
            renewal_started: AtomicBool::new(false),
            renewal_wake: Arc::new(tokio::sync::Notify::new()),
            routing_recovery_generation: AtomicU64::new(0),
            token_expired: AtomicBool::new(false),
        })
    }

    pub fn account_context_generation(&self) -> u64 {
        self.account_context_generation.load(Ordering::Acquire)
    }

    pub fn account_context_is_current(&self, generation: u64) -> bool {
        self.account_context_transitions.load(Ordering::Acquire) == 0
            && self.account_context_generation() == generation
    }

    pub fn is_token_expired(&self) -> bool {
        self.token_expired.load(Ordering::Relaxed)
    }

    pub fn mark_token_expired(&self) {
        self.token_expired.store(true, Ordering::Relaxed);
    }

    async fn begin_account_transition(&self) -> AccountContextTransitionGuard<'_> {
        let transition_guard = self.account_context_transition_lock.lock().await;
        self.account_context_transitions
            .fetch_add(1, Ordering::AcqRel);
        self.account_context_generation
            .fetch_add(1, Ordering::AcqRel);
        AccountContextTransitionGuard {
            runtime: self,
            transition_guard: Some(transition_guard),
            active: true,
        }
    }

    async fn begin_account_transition_if_current(
        &self,
        expected_generation: u64,
    ) -> Option<AccountContextTransitionGuard<'_>> {
        let transition_guard = self.account_context_transition_lock.lock().await;
        if !self.account_context_is_current(expected_generation) {
            return None;
        }
        self.account_context_transitions
            .fetch_add(1, Ordering::AcqRel);
        self.account_context_generation
            .fetch_add(1, Ordering::AcqRel);
        Some(AccountContextTransitionGuard {
            runtime: self,
            transition_guard: Some(transition_guard),
            active: true,
        })
    }

    async fn read_account_context_raw(&self) -> Result<(AccountSession, String)> {
        self.account_context
            .read()
            .await
            .clone()
            .map(|context| (context.session, context.relay_url))
            .ok_or_else(|| anyhow!("not logged in"))
    }

    pub async fn read_account_context(&self) -> Result<(AccountSession, String)> {
        let generation = self.account_context_generation();
        self.read_account_context_for_generation(generation).await
    }

    pub async fn read_account_context_for_generation(
        &self,
        generation: u64,
    ) -> Result<(AccountSession, String)> {
        if !self.account_context_is_current(generation) {
            return Err(anyhow!("account context changed"));
        }
        let context = self.read_account_context_raw().await?;
        if !self.account_context_is_current(generation) {
            return Err(anyhow!("account context changed"));
        }
        Ok(context)
    }

    /// The new-version account directory base URL.
    pub fn directory_url(&self) -> &str {
        self.directory.url()
    }

    /// The new-version account directory session and URL, signed in from the
    /// account identity alone (the legacy relay context is not needed).
    pub async fn read_directory_context(&self) -> Result<(AccountSession, String)> {
        if let Some(context) = self.directory.cached().await {
            return Ok(context);
        }
        let device = current_device_identity()?;
        self.directory
            .context(&device)
            .await
            .map_err(|error| anyhow!("account directory unavailable: {error}"))
    }

    /// Drops the directory session holding `token` after the directory
    /// answered 401; the next read signs in again.
    pub async fn invalidate_directory_session(&self, token: &str) {
        self.directory.invalidate(token).await;
    }

    /// This device in the new-version account directory (the device network's
    /// identity): `relay_url` is the directory URL.
    pub async fn directory_account_info(&self) -> Result<AccountInfo> {
        let (session, directory_url) = self.read_directory_context().await?;
        let device = current_device_identity()?;
        Ok(AccountInfo {
            user_id: session.user_id,
            relay_url: directory_url,
            device_id: device.device_id,
            device_name: device.device_name,
        })
    }

    pub async fn is_logged_in(&self) -> bool {
        self.read_account_context().await.is_ok()
    }

    pub fn record_authenticated_device(&self, token: &str, device_id: &str) -> Result<()> {
        if session_store::record_authenticated_device(token, device_id)? {
            self.renewal_wake.notify_one();
        }
        Ok(())
    }

    async fn maintain_device_session(&self) -> Result<()> {
        let generation = self.account_context_generation();
        let Ok((old, relay_url)) = self.read_account_context_for_generation(generation).await
        else {
            return Ok(());
        };
        let Some(saved) = session_store::renew_session_if_due(self.host.is_cli_host()).await?
        else {
            return Ok(());
        };
        let (session, generation) = if saved.replaces(&old, &relay_url) {
            let Some(transition) = self.begin_account_transition_if_current(generation).await
            else {
                return Ok(());
            };
            let session = AccountSession::new(saved.token, saved.user_id, saved.master_key);
            *self.account_context.write().await = Some(AccountContextState {
                session: session.clone(),
                relay_url: relay_url.clone(),
            });
            let next = transition.finish();
            self.routing_intent.rotated(generation, next);
            (session, next)
        } else if saved.token == old.token && !self.host.device_routing_is_active().await {
            (old, generation)
        } else {
            return Ok(());
        };
        if self.device_routing_requested(generation) {
            self.host
                .start_device_routing(AccountRoutingStartRequest {
                    session,
                    relay_url,
                    device_name: current_device_identity()?.device_name,
                    account_generation: generation,
                })
                .await?;
        }
        Ok(())
    }

    pub async fn try_restore_session(self: &Arc<Self>) -> Option<String> {
        if !self.renewal_started.swap(true, Ordering::AcqRel) {
            let error = session_store::renew_session_if_due(self.host.is_cli_host())
                .await
                .err();
            if let Some(error) = &error {
                log::warn!("Startup device credential maintenance failed: {error}");
            }
            let weak = Arc::downgrade(self);
            session_store::schedule_renewal_checks(
                self.renewal_wake.clone(),
                error.is_some(),
                move || {
                    let runtime = weak.upgrade();
                    async move {
                        let Some(runtime) = runtime else {
                            return Ok(false);
                        };
                        runtime.maintain_device_session().await?;
                        Ok(true)
                    }
                },
            );
        }
        if let Ok(Some(loaded)) = session_store::load_session_detailed() {
            if openbitfun_services_integrations::remote_connect::account::persisted_relay_requires_migration(
                &loaded.relay_url,
            ) {
                if let Some(device_id) = loaded.device_id.as_deref() {
                    if let Err(error) = DeviceIdentity::adopt_account_device_id(device_id) {
                        log::warn!("Failed to adopt migrating account device id: {error}");
                        return None;
                    }
                }
                return match self.login_with_identity().await {
                    Ok(result) => Some(result.user_id),
                    Err(error) => {
                        log::warn!(
                            "New Relay sign-in required; previous credential retained: {error}"
                        );
                        None
                    }
                };
            }
        }
        let transition = self.begin_account_transition().await;
        self.host.stop_device_routing().await;
        let mut metadata_device_id = None;
        let mut had_persisted_session = true;
        let restored = match session_store::load_session_detailed() {
            Ok(Some(loaded)) => {
                let relay_url = match normalize_relay_url(&loaded.relay_url) {
                    Ok(url) => url,
                    Err(error) => {
                        log::warn!("Ignoring invalid persisted relay URL: {error}");
                        transition.finish();
                        return None;
                    }
                };
                let user_id = loaded.user_id.clone();
                if let Some(device_id) = loaded.device_id.as_deref() {
                    match DeviceIdentity::adopt_account_device_id(device_id) {
                        Ok(_) => metadata_device_id = Some(device_id.to_string()),
                        Err(error) => {
                            log::warn!("Failed to adopt restored session device_id: {error}")
                        }
                    }
                }
                let session = AccountSession::new(loaded.token, user_id.clone(), loaded.master_key);
                *self.account_context.write().await =
                    Some(AccountContextState { session, relay_url });
                log::info!("Restored account session for user {user_id}");
                Some(user_id)
            }
            Ok(None) => {
                had_persisted_session = false;
                None
            }
            Err(error) => {
                log::warn!("Failed to load persisted session: {error}");
                None
            }
        };
        let generation = transition.finish();
        if restored.is_none() && !had_persisted_session {
            // OpenBitFun 2.0 signs in with the account identity alone: a
            // host whose identity is signed in (another surface of this
            // profile, or a sign-in before the directory session existed)
            // registers with the account directory instead of reporting
            // "not logged in". Without identity tokens this fails quietly.
            return match self.restore_from_identity().await {
                Ok(user_id) => Some(user_id),
                Err(error) => {
                    log::debug!("No account session to restore: {error}");
                    None
                }
            };
        }
        // Headless exec/Shared/dispatch hosts may never start routing. Report
        // their own persisted account identity here, not a controller's SSH
        // provisioning target. Legacy sessions without an id wait for AuthOk.
        if let Some(device_id) = metadata_device_id {
            if let Err(error) = self
                .report_local_device_metadata(generation, &device_id)
                .await
            {
                log::warn!("Failed to report restored host metadata: {error}");
            }
        }
        restored
    }

    /// Restores a host whose account identity is signed in but that has no
    /// persisted directory credential: registers this device with the
    /// account directory and installs the session exactly as a restore
    /// would. Unlike [`Self::login_with_identity`] it neither retires a
    /// background routing owner (the caller may be that owner, the daemon)
    /// nor starts routing; the caller restores routing as after any restore.
    async fn restore_from_identity(self: &Arc<Self>) -> Result<String> {
        let _login_guard = self.account_login_lock.lock().await;
        let relay_url = openbitfun_product_domains::account::DEFAULT_RELAY_URL.to_string();
        let device = current_device_identity()?;
        let client = AccountClient::new();
        let device_kind = client
            .reported_device_kind(&relay_url, self.host.is_cli_host())
            .await;
        let (session, profile) = client
            .login_with_identity(&relay_url, &device, device_kind)
            .await
            .map_err(|error| anyhow!("login failed: {error}"))?;
        let transition = self.begin_account_transition().await;
        let user_id = session.user_id.clone();
        *self.account_context.write().await = Some(AccountContextState {
            session: session.clone(),
            relay_url: relay_url.clone(),
        });
        session_store::save_credential_hint(&profile.login, &relay_url);
        self.token_expired.store(false, Ordering::Relaxed);
        if let Err(error) =
            session_store::save_issued_session(&session, &relay_url, Some(&device.device_id), None)
                .await
        {
            log::warn!("Failed to persist session: {error}");
        }
        transition.finish();
        log::info!("Account session restored from the signed-in identity for user {user_id}");
        Ok(user_id)
    }

    /// Called on the account-owning host, using its restored or authenticated id.
    pub async fn report_local_device_metadata(
        &self,
        generation: u64,
        device_id: &str,
    ) -> Result<()> {
        let (session, relay_url) = self.read_account_context_for_generation(generation).await?;
        AccountClient::new()
            .report_local_metadata(&relay_url, &session, device_id)
            .await
    }

    pub async fn advance_github_login(
        self: &Arc<Self>,
        transaction_id: Option<String>,
    ) -> Result<AccountLoginProgress> {
        if let Some(transaction_id) = transaction_id {
            let response = self.poll_github_auth(transaction_id).await?;
            match response.status.as_str() {
                "pending" => return Ok(AccountLoginProgress::Waiting),
                "authorized" => {}
                _ => {
                    return Err(anyhow!(
                        "GitHub authorization expired or was not completed; restart sign-in"
                    ))
                }
            }
        } else {
            let mut identity = openbitfun_services_integrations::account_identity::AccountIdentityClient::from_environment().await?;
            if identity.me().await?.is_none() {
                return Ok(AccountLoginProgress::Authorization(
                    self.start_github_auth().await?,
                ));
            }
        }
        Ok(AccountLoginProgress::Complete(
            self.login_with_identity().await?,
        ))
    }

    pub async fn start_github_auth(
        &self,
    ) -> Result<openbitfun_product_domains::account::GitHubAuthStart> {
        Ok(openbitfun_services_integrations::account_identity::start_auth_flow().await?)
    }

    pub async fn poll_github_auth(
        &self,
        transaction_id: String,
    ) -> Result<openbitfun_product_domains::account::GitHubAuthPollResponse> {
        Ok(
            openbitfun_services_integrations::account_identity::poll_auth_flow(
                openbitfun_product_domains::account::GitHubAuthPollRequest { transaction_id },
            )
            .await?,
        )
    }

    pub async fn login_with_identity(self: &Arc<Self>) -> Result<AccountLoginResult> {
        let _login_guard = self.account_login_lock.lock().await;
        let relay_url = openbitfun_product_domains::account::DEFAULT_RELAY_URL.to_string();
        let expected_generation = self.account_context_generation();
        if !self.account_context_is_current(expected_generation) {
            return Err(anyhow!("account context changed"));
        }

        let device = current_device_identity()?;
        let client = AccountClient::new();
        let device_kind = client
            .reported_device_kind(&relay_url, self.host.is_cli_host())
            .await;
        let (session, profile) = client
            .login_with_identity(&relay_url, &device, device_kind)
            .await
            .map_err(|error| anyhow!("login failed: {error}"))?;
        let previous_account_context = self.account_context.read().await.clone();
        let retired_background_owner = match self.host.retire_background_routing_owner().await {
            Ok(retired) => retired,
            Err(failure) => {
                if failure.owner_may_exit {
                    self.schedule_routing_recovery_after_background_owner_exit(
                        expected_generation,
                        device.device_name.clone(),
                    );
                }
                revoke_rejected_login_candidate(&client, &relay_url, &session).await;
                return Err(failure.error);
            }
        };
        let Some(transition) = self
            .begin_account_transition_if_current(expected_generation)
            .await
        else {
            revoke_rejected_login_candidate(&client, &relay_url, &session).await;
            return Err(anyhow!("account context changed"));
        };
        self.host.stop_device_routing().await;
        // A directory session of another account is retired with it.
        self.directory.retire_other_account(&session.user_id).await;
        if let Some(previous) = previous_account_context.as_ref() {
            if let Err(error) = crate::service::filesystem::upload::retire_account_uploads(
                &previous.session.user_id,
            )
            .await
            {
                log::warn!("Failed to clean up retired account uploads: {error}");
            }
        }
        // Atomic replacement preserves the previous credential if saving fails.

        let user_id = session.user_id.clone();
        let token = session.token.clone();
        *self.account_context.write().await = Some(AccountContextState {
            session: session.clone(),
            relay_url: relay_url.clone(),
        });
        session_store::save_credential_hint(&profile.login, &relay_url);
        self.token_expired.store(false, Ordering::Relaxed);

        if let Err(error) = session_store::save_issued_session(
            &session,
            &relay_url,
            Some(&device.device_id),
            previous_account_context
                .as_ref()
                .map(|context| context.session.token.as_str()),
        )
        .await
        {
            log::warn!("Failed to persist session: {error}");
        }
        let generation = transition.finish();
        self.routing_intent.request(generation);
        let routing = self
            .host
            .start_device_routing(AccountRoutingStartRequest {
                session,
                relay_url: relay_url.clone(),
                device_name: device.device_name,
                account_generation: generation,
            })
            .await;
        revoke_replaced_account_context(&client, previous_account_context, &relay_url, &token)
            .await;
        let routing_standby = routing.is_ok() && self.host.device_routing_is_standby().await;

        Ok(AccountLoginResult {
            user_id,
            relay_url,
            routing_owner_replaced: retired_background_owner,
            routing_connected: routing.is_ok()
                && !routing_standby
                && self.host.device_routing_is_active().await,
            routing_standby,
            routing_error: routing.err().map(|error| error.to_string()),
        })
    }

    pub fn cancel_device_routing(&self) {
        self.routing_intent.cancel();
    }

    pub fn device_routing_requested(&self, generation: u64) -> bool {
        self.account_context_is_current(generation) && self.routing_intent.requested(generation)
    }

    pub async fn restore_device_routing(self: &Arc<Self>, device_name: &str) -> Result<()> {
        let generation = self.account_context_generation();
        let (session, relay_url) = self.read_account_context_for_generation(generation).await?;
        self.routing_intent.request(generation);
        self.host
            .start_device_routing(AccountRoutingStartRequest {
                session,
                relay_url,
                device_name: device_name.to_string(),
                account_generation: generation,
            })
            .await
    }

    pub async fn logout(&self) -> Result<()> {
        let mut identity = openbitfun_services_integrations::account_identity::AccountIdentityClient::from_environment().await?;
        identity.logout().await?;
        // The new-version directory session goes with the identity.
        self.directory.sign_out().await;
        let transition = self.begin_account_transition().await;
        self.host.stop_device_routing().await;
        if self.host.request_background_routing_owner_shutdown() {
            log::info!("Signalled the background account routing owner to shut down");
        }
        let active = self.read_account_context_raw().await.ok();
        if let Some((session, _)) = &active {
            if let Err(error) =
                crate::service::filesystem::upload::retire_account_uploads(&session.user_id).await
            {
                log::warn!("Failed to clean up retired account uploads: {error}");
            }
        }
        *self.account_context.write().await = None;
        session_store::logout_session(active, true).await;
        session_store::clear_credential_hint();
        self.token_expired.store(false, Ordering::Relaxed);
        transition.finish();
        Ok(())
    }

    pub async fn expire_rejected_context(
        &self,
        account_generation: u64,
        expected_token: &str,
    ) -> bool {
        if let Ok((session, relay)) = self
            .read_account_context_for_generation(account_generation)
            .await
        {
            if session.token != expected_token {
                return false;
            }
            if session_store::has_saved_replacement(&session, &relay) {
                self.renewal_wake.notify_one();
                return false;
            }
        }
        let Some(transition) = self
            .begin_account_transition_if_current(account_generation)
            .await
        else {
            return false;
        };
        self.host.stop_device_routing().await;
        let mut context = self.account_context.write().await;
        if context
            .as_ref()
            .is_none_or(|context| context.session.token != expected_token)
        {
            transition.finish();
            return false;
        }
        let retired_user = context
            .as_ref()
            .map(|context| context.session.user_id.clone());
        *context = None;
        drop(context);
        if let Some(user_id) = retired_user {
            if let Err(error) =
                crate::service::filesystem::upload::retire_account_uploads(&user_id).await
            {
                log::warn!("Failed to clean up retired account uploads: {error}");
            }
        }
        self.token_expired.store(true, Ordering::Relaxed);
        if let Err(error) = session_store::clear_rejected_session(expected_token) {
            log::warn!("Failed to clear rejected session: {error}");
        }
        transition.finish();
        true
    }

    pub async fn account_info(&self) -> Result<AccountInfo> {
        let (session, relay_url) = self.read_account_context().await?;
        let device = current_device_identity()?;
        Ok(AccountInfo {
            user_id: session.user_id,
            relay_url,
            device_id: device.device_id,
            device_name: device.device_name,
        })
    }

    pub async fn update_device_alias(
        &self,
        device_id: &str,
        device_alias: Option<&str>,
    ) -> Result<()> {
        let generation = self.account_context_generation();
        let (session, relay_url) = self.read_account_context_for_generation(generation).await?;
        AccountClient::new()
            .update_device_alias(&relay_url, &session, device_id, device_alias)
            .await?;
        if !self.account_context_is_current(generation) {
            return Err(anyhow!("account context changed"));
        }
        Ok(())
    }

    pub async fn list_devices(&self) -> Result<Vec<AccountDevice>> {
        let (session, relay_url) = self.read_account_context().await?;
        let devices = AccountClient::new()
            .list_devices(&relay_url, &session)
            .await?;
        Ok(devices
            .into_iter()
            .map(|device| AccountDevice {
                device_id: device.device_id,
                device_name: device.device_name,
                device_kind: device.device_kind,
                device_alias: device.device_alias,
                device_model: device.device_model,
                device_os: device.device_os,
                device_os_version: device.device_os_version,
                device_client_version: device.device_client_version,
                device_client_protocol: device.device_client_protocol,
                compatible: device.compatible,
                online: device.online,
            })
            .collect())
    }

    pub async fn snapshot(&self) -> AccountSnapshot {
        let logged_in = self.is_logged_in().await;
        let info = if logged_in {
            self.account_info().await.ok()
        } else {
            None
        };
        let devices = if logged_in {
            self.list_devices().await.unwrap_or_default()
        } else {
            Vec::new()
        };
        AccountSnapshot {
            logged_in,
            info,
            devices,
        }
    }

    fn schedule_routing_recovery_after_background_owner_exit(
        self: &Arc<Self>,
        expected_generation: u64,
        device_name: String,
    ) {
        if !self.account_context_is_current(expected_generation)
            || self
                .routing_recovery_generation
                .swap(expected_generation, Ordering::AcqRel)
                == expected_generation
        {
            return;
        }
        let runtime = Arc::clone(self);
        tokio::spawn(async move {
            while runtime.routing_recovery_generation.load(Ordering::Acquire) == expected_generation
                && runtime.account_context_is_current(expected_generation)
                && runtime.host.background_routing_owner_is_running()
            {
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
            if runtime.routing_recovery_generation.load(Ordering::Acquire) == expected_generation
                && runtime.account_context_is_current(expected_generation)
                && !runtime.host.background_routing_owner_is_running()
            {
                if let Err(error) = runtime.restore_device_routing(&device_name).await {
                    log::warn!(
                        "Failed to restore account routing after background owner exit: {error}"
                    );
                }
            }
            let _ = runtime.routing_recovery_generation.compare_exchange(
                expected_generation,
                0,
                Ordering::AcqRel,
                Ordering::Acquire,
            );
        });
    }
}

struct AccountContextTransitionGuard<'a> {
    runtime: &'a AccountRuntime,
    transition_guard: Option<MutexGuard<'a, ()>>,
    active: bool,
}

impl AccountContextTransitionGuard<'_> {
    fn finish(mut self) -> u64 {
        self.release()
    }

    fn release(&mut self) -> u64 {
        if self.active {
            self.runtime
                .account_context_generation
                .fetch_add(1, Ordering::AcqRel);
            self.runtime
                .account_context_transitions
                .fetch_sub(1, Ordering::AcqRel);
            self.active = false;
        }
        let generation = self.runtime.account_context_generation();
        drop(self.transition_guard.take());
        generation
    }
}

impl Drop for AccountContextTransitionGuard<'_> {
    fn drop(&mut self) {
        self.release();
    }
}

fn normalize_relay_url(relay_url: &str) -> Result<String> {
    let parsed = validate_relay_base_url(relay_url.trim())?;
    Ok(parsed.as_str().trim_end_matches('/').to_string())
}

fn current_device_identity() -> Result<DeviceIdentity> {
    DeviceIdentity::from_current_machine().map_err(|error| anyhow!("detect device: {error}"))
}

async fn revoke_rejected_login_candidate(
    client: &AccountClient,
    relay_url: &str,
    session: &AccountSession,
) {
    if let Err(error) = client.revoke_token(relay_url, session).await {
        log::warn!("Failed to revoke rejected login candidate token: {error}");
    }
}

fn replaced_account_revocation_target(
    previous: Option<AccountContextState>,
    replacement_relay_url: &str,
    replacement_token: &str,
) -> Option<AccountContextState> {
    previous.filter(|context| {
        context.relay_url != replacement_relay_url || context.session.token != replacement_token
    })
}

async fn revoke_replaced_account_context(
    client: &AccountClient,
    previous: Option<AccountContextState>,
    replacement_relay_url: &str,
    replacement_token: &str,
) {
    let Some(previous) =
        replaced_account_revocation_target(previous, replacement_relay_url, replacement_token)
    else {
        return;
    };
    if let Err(error) = client
        .revoke_token(&previous.relay_url, &previous.session)
        .await
    {
        log::warn!("Failed to revoke replaced account token: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestAccountRuntimeHost;

    #[async_trait]
    impl AccountRuntimeHost for TestAccountRuntimeHost {
        async fn retire_background_routing_owner(
            &self,
        ) -> std::result::Result<bool, BackgroundRoutingOwnerRetirementError> {
            Ok(false)
        }

        fn background_routing_owner_is_running(&self) -> bool {
            false
        }

        fn request_background_routing_owner_shutdown(&self) -> bool {
            false
        }

        async fn start_device_routing(&self, _request: AccountRoutingStartRequest) -> Result<()> {
            Ok(())
        }

        async fn stop_device_routing(&self) {}
    }

    pub(super) fn test_runtime() -> Arc<AccountRuntime> {
        AccountRuntime::new(Arc::new(TestAccountRuntimeHost))
    }

    /// The new-version directory session stands on its own: it is served
    /// while the legacy relay context is signed out, and a 401 drops it.
    #[tokio::test]
    async fn directory_context_does_not_need_the_legacy_relay_context() {
        use openbitfun_services_integrations::remote_connect::directory_session::DirectoryLogin;
        struct Issued;
        #[async_trait]
        impl DirectoryLogin for Issued {
            async fn login(&self, _url: &str, device: &DeviceIdentity) -> Result<AccountSession> {
                Ok(AccountSession::new(
                    format!("directory-{}", device.device_id),
                    "42".into(),
                    [9; 32],
                ))
            }
            async fn revoke(&self, _url: &str, _session: &AccountSession) {}
            async fn ensure(&self, _url: &str) -> Result<()> {
                Ok(())
            }
        }
        let directory = Arc::new(DirectorySessions::new(
            "http://127.0.0.1:9/directory",
            Arc::new(Issued),
        ));
        let device = DeviceIdentity {
            device_id: "d".repeat(32),
            device_name: "Test".into(),
            mac_address: "00:00:00:00:00:02".into(),
        };
        directory.context(&device).await.unwrap();
        let runtime =
            AccountRuntime::new_with_directory(Arc::new(TestAccountRuntimeHost), directory);
        assert!(runtime.read_account_context().await.is_err());
        let (session, url) = runtime.read_directory_context().await.unwrap();
        assert_eq!(url, "http://127.0.0.1:9/directory");
        assert_eq!(runtime.directory_url(), url);
        assert_eq!(session.user_id, "42");
        runtime.invalidate_directory_session(&session.token).await;
        assert!(runtime.directory.cached().await.is_none());
    }

    #[tokio::test]
    async fn metadata_report_rejects_stale_or_missing_account_before_network() {
        let runtime = test_runtime();
        let generation = runtime.account_context_generation();
        assert_eq!(
            runtime
                .report_local_device_metadata(generation, "host")
                .await
                .unwrap_err()
                .to_string(),
            "not logged in"
        );
        assert_eq!(
            runtime
                .report_local_device_metadata(generation + 1, "host")
                .await
                .unwrap_err()
                .to_string(),
            "account context changed"
        );
    }

    #[tokio::test]
    async fn metadata_report_uses_host_account_and_negotiates_capability() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            for index in 0..2 {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut bytes = Vec::new();
                let header_end = loop {
                    let mut buffer = [0; 4096];
                    let count = stream.read(&mut buffer).await.unwrap();
                    assert!(count > 0);
                    bytes.extend_from_slice(&buffer[..count]);
                    if let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                        break end + 4;
                    }
                };
                let headers = String::from_utf8(bytes[..header_end].to_vec())
                    .unwrap()
                    .to_lowercase();
                let length = headers
                    .lines()
                    .find_map(|line| line.strip_prefix("content-length: "))
                    .map(|value| value.parse::<usize>().unwrap())
                    .unwrap_or(0);
                while bytes.len() < header_end + length {
                    let mut buffer = [0; 4096];
                    let count = stream.read(&mut buffer).await.unwrap();
                    assert!(count > 0);
                    bytes.extend_from_slice(&buffer[..count]);
                }
                let body = if index == 0 {
                    assert!(headers.starts_with("get /api/info "));
                    r#"{"capabilities":["device_metadata_v1"]}"#
                } else {
                    assert!(headers.starts_with("patch /api/devices/executing-host "));
                    assert!(headers.contains("authorization: bearer host-token\r\n"));
                    let payload: serde_json::Value =
                        serde_json::from_slice(&bytes[header_end..header_end + length]).unwrap();
                    assert!(payload["device_os"].is_string());
                    assert!(payload.get("device_alias").is_none());
                    "{}"
                };
                stream.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes()).await.unwrap();
            }
        });
        let runtime = test_runtime();
        *runtime.account_context.write().await = Some(AccountContextState {
            session: AccountSession::new("host-token".into(), "host-user".into(), [0; 32]),
            relay_url: url,
        });
        tokio::time::timeout(Duration::from_secs(20), async {
            runtime
                .report_local_device_metadata(
                    runtime.account_context_generation(),
                    "executing-host",
                )
                .await
                .unwrap();
            server.await.unwrap();
        })
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn rejected_account_transition_does_not_advance_the_generation() {
        let runtime = test_runtime();
        let generation = runtime.account_context_generation();

        assert!(runtime
            .begin_account_transition_if_current(generation + 1)
            .await
            .is_none());
        assert_eq!(runtime.account_context_generation(), generation);
    }
}

#[cfg(all(test, feature = "tools-pages"))]
#[path = "account_pages_tests.rs"]
mod account_pages_tests;

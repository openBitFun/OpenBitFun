//! Backend commands for the account (sign-in, device directory) and the IM
//! bots of Remote Connect.
//!
//! OpenBitFun 2.0: devices reach each other only over OBP on OpenBitFun Link
//! (`crate::mesh`, `crate::fleet`). The 1.x relay transport (device routing
//! socket, relay RPC, HostInvoke, pairing invitations, host streams) is not
//! part of 2.0; its commands are `retired(...)` registry rows.

use crate::host::HostHandle;
use openbitfun_core::agentic::tools::account_login_capability::set_account_login_available;
use openbitfun_core::agentic::tools::page_deploy_host::set_page_deploy_handler;
use openbitfun_core::agentic::tools::page_manage_host::set_page_manage_handler;
use openbitfun_core::agentic::tools::page_publish_host::set_page_publish_handler;
use openbitfun_core::service::remote_connect::routing_lease::{
    DeviceRoutingLease, DeviceRoutingPriority,
};
use openbitfun_core::service::remote_connect::session_store::{
    clear_credential_hint, load_credential_hint, save_credential_hint, AccountHint,
};
use openbitfun_core::service::remote_connect::{
    bot::{self, weixin, BotConfig},
    device, session_store, AccountClient, AccountSession, ConnectionMethod, ConnectionResult,
    DeviceIdentity, RemoteConnectConfig, RemoteConnectService, RELAY_METHOD_RETIRED,
};
use openbitfun_services_integrations::remote_connect::account::{
    error_indicates_expired_token, validate_relay_base_url, DEVICE_KIND_DESKTOP,
};
use openbitfun_services_integrations::remote_connect::{
    deploy_page_version_on_relay, join_relay_url, list_pages_from_relay,
    publish_page_content_on_relay,
};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, OnceLock};
use tokio::sync::RwLock;

#[cfg(test)]
mod page_tool_tests;

/// Session and relay URL must move together. Keeping them behind one lock
/// prevents a request from observing a token from one login and the URL from
/// another while an account transition is in progress.
#[derive(Clone)]
struct AccountContextState {
    session: AccountSession,
    relay_url: String,
}

static ACCOUNT_CONTEXT: OnceLock<Arc<RwLock<Option<AccountContextState>>>> = OnceLock::new();

/// Serializes credential-bearing operations against login/logout transitions.
static ACCOUNT_OPERATION_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
/// Serializes credential verification attempts without hiding or disconnecting
/// the currently active account. A successful candidate acquires the account
/// transition guard only after all login-time network requests complete.
static ACCOUNT_LOGIN_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static ACCOUNT_CONTEXT_TRANSITION_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
/// Serializes bot start and stop.
static START_STOP_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static ACCOUNT_TRANSITION_BOUNDARY_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static ACCOUNT_CONTEXT_GENERATION: AtomicU64 = AtomicU64::new(1);
static ACCOUNT_CONTEXT_TRANSITIONS: AtomicUsize = AtomicUsize::new(0);

pub(crate) fn account_context_generation() -> u64 {
    ACCOUNT_CONTEXT_GENERATION.load(Ordering::Acquire)
}

pub(crate) fn account_context_is_current(generation: u64) -> bool {
    ACCOUNT_CONTEXT_TRANSITIONS.load(Ordering::Acquire) == 0
        && account_context_generation() == generation
}

struct AccountContextTransitionPermit;

impl AccountContextTransitionPermit {
    fn begin() -> Self {
        ACCOUNT_CONTEXT_TRANSITIONS.fetch_add(1, Ordering::AcqRel);
        ACCOUNT_CONTEXT_GENERATION.fetch_add(1, Ordering::AcqRel);
        Self
    }
}

impl Drop for AccountContextTransitionPermit {
    fn drop(&mut self) {
        // Invalidate work queued during the transition before making the newly
        // installed (or cleared) account context discoverable.
        ACCOUNT_CONTEXT_GENERATION.fetch_add(1, Ordering::AcqRel);
        ACCOUNT_CONTEXT_TRANSITIONS.fetch_sub(1, Ordering::AcqRel);
    }
}

struct AccountContextTransitionGuard {
    operation_guard: Option<tokio::sync::MutexGuard<'static, ()>>,
    transition: Option<AccountContextTransitionPermit>,
    transition_guard: Option<tokio::sync::MutexGuard<'static, ()>>,
}

impl AccountContextTransitionGuard {
    /// Make the committed context observable while retaining the transition
    /// mutex. Login-state listeners can now probe `account_status`, while a
    /// competing logout or replacement remains blocked until publication ends.
    fn make_context_observable(&mut self) {
        drop(self.operation_guard.take());
        drop(self.transition.take());
    }
}

impl Drop for AccountContextTransitionGuard {
    fn drop(&mut self) {
        // Release the operation lock before reopening context discovery. A
        // queued operation that wins this handoff still fails on the gate.
        drop(self.operation_guard.take());
        drop(self.transition.take());
        drop(self.transition_guard.take());
    }
}

async fn lock_account_operation(
    generation: u64,
) -> Result<tokio::sync::MutexGuard<'static, ()>, String> {
    let guard = ACCOUNT_OPERATION_LOCK.lock().await;
    if !account_context_is_current(generation) {
        return Err("account context changed".to_string());
    }
    Ok(guard)
}

async fn begin_account_transition() -> AccountContextTransitionGuard {
    // Serialize transition creation so a stale invalidation can re-check its
    // generation before it makes the current account undiscoverable.
    let transition_guard = ACCOUNT_CONTEXT_TRANSITION_LOCK.lock().await;
    let transition = AccountContextTransitionPermit::begin();
    let operation_guard = ACCOUNT_OPERATION_LOCK.lock().await;
    AccountContextTransitionGuard {
        operation_guard: Some(operation_guard),
        transition: Some(transition),
        transition_guard: Some(transition_guard),
    }
}

async fn begin_account_transition_if_current(
    expected_generation: u64,
) -> Option<AccountContextTransitionGuard> {
    let transition_guard = ACCOUNT_CONTEXT_TRANSITION_LOCK.lock().await;
    if !account_context_is_current(expected_generation) {
        return None;
    }
    let transition = AccountContextTransitionPermit::begin();
    let operation_guard = ACCOUNT_OPERATION_LOCK.lock().await;
    Some(AccountContextTransitionGuard {
        operation_guard: Some(operation_guard),
        transition: Some(transition),
        transition_guard: Some(transition_guard),
    })
}

/// HostHandle used by background account tasks to emit UI events without a
/// command context.
static ACCOUNT_APP_HANDLE: OnceLock<HostHandle> = OnceLock::new();

/// Store the app handle for account events. Called once during setup.
pub fn set_account_app_handle(app: HostHandle) {
    let _ = ACCOUNT_APP_HANDLE.set(app);
}

/// Shared HostHandle for account / peer-host bridges.
pub fn account_app_handle() -> Option<&'static HostHandle> {
    ACCOUNT_APP_HANDLE.get()
}

/// Current device id for peer capability probes.
pub fn current_device_id_for_peer() -> Result<String, String> {
    Ok(current_device_identity()?.device_id)
}

fn emit_account_event(event: &str, payload: serde_json::Value) {
    if let Some(app) = ACCOUNT_APP_HANDLE.get() {
        if let Err(e) = app.emit(event, payload) {
            log::warn!("Failed to emit {event}: {e}");
        }
    }
}

static RENEWAL_WAKE: std::sync::LazyLock<Arc<tokio::sync::Notify>> =
    std::sync::LazyLock::new(|| Arc::new(tokio::sync::Notify::new()));

/// Global flag set when the account service returns HTTP 401 (token expired). The
/// frontend checks this via `account_token_expired` and prompts re-login.
static TOKEN_EXPIRED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Check if the account token has been marked expired.
// @backend-command
pub async fn account_token_expired() -> bool {
    TOKEN_EXPIRED.load(std::sync::atomic::Ordering::Relaxed)
}

/// Drop the local account session after the relay rejects the token, but only
/// if the response still belongs to the same account generation and token.
/// Keeps the username/relay hint so the login form can be prefilled.
async fn invalidate_local_account_session_if_current(
    expected_generation: u64,
    expected_token: &str,
    reason: &str,
) -> bool {
    if !account_context_matches(expected_generation, expected_token).await {
        log::info!("Ignored auth failure from a stale account generation");
        return false;
    }
    let _room_boundary_guard = ACCOUNT_TRANSITION_BOUNDARY_LOCK.lock().await;
    if !account_context_matches(expected_generation, expected_token).await {
        log::info!("Ignored auth failure from a stale account generation");
        return false;
    }
    if let Ok((session, relay)) = read_account_context_for_generation(expected_generation).await {
        if session_store::has_saved_replacement(&session, &relay) {
            RENEWAL_WAKE.notify_one();
            return false;
        }
    }
    let Some(_transition_guard) = begin_account_transition_if_current(expected_generation).await
    else {
        log::info!("Ignored auth failure from a stale account generation");
        return false;
    };
    let token_matches = get_account_context()
        .read()
        .await
        .as_ref()
        .is_some_and(|context| context.session.token == expected_token);
    if !token_matches {
        log::info!("Ignored auth failure from a replaced account token");
        return false;
    }
    sync_account_login_capability(false);
    TOKEN_EXPIRED.store(true, std::sync::atomic::Ordering::Relaxed);
    if let Some(service) = get_service_holder().read().await.as_ref() {
        service.clear_bot_delegated_identities().await;
    }
    *get_account_context().write().await = None;
    if let Err(error) = session_store::clear_rejected_session(expected_token) {
        log::warn!("Failed to clear rejected session: {error}");
    }
    emit_account_event(
        "account://login-state",
        serde_json::json!({ "logged_in": false, "reason": "session_expired" }),
    );
    sync_device_routing_claim().await;
    log::warn!("Invalidated local account session after auth failure: {reason}");
    true
}

fn sync_account_login_capability(logged_in: bool) {
    set_account_login_available(logged_in);
}

fn register_page_manage_host() {
    set_page_manage_handler(Arc::new(|request| {
        Box::pin(async move {
            if TOKEN_EXPIRED.load(Ordering::Relaxed) {
                return Err("Pages account session expired; sign in again".into());
            }
            let generation = account_context_generation();
            let (session, relay_url) = read_account_context_for_generation(generation).await?;
            openbitfun_core::product_runtime::account_pages::manage_with_account_context(
                &relay_url,
                &session.token,
                request,
                || account_context_is_current(generation),
            )
            .await
        })
    }));
}

fn register_page_deploy_host() {
    set_page_deploy_handler(Arc::new(|slug, version_id| {
        Box::pin(async move {
            let generation = account_context_generation();
            let (session, relay_url) = read_account_context_for_generation(generation).await?;
            let page = list_pages_from_relay(&relay_url, &session.token)
                .await
                .map_err(|e| e.to_string())?
                .into_iter()
                .find(|page| page.slug == slug)
                .ok_or_else(|| {
                    "Page not found; refresh the Page list before deploying".to_string()
                })?;
            let info = deploy_page_version_on_relay(
                &relay_url,
                &session.token,
                &slug,
                &version_id,
                &page.generation,
            )
            .await
            .map_err(|e| e.to_string())?;
            if !account_context_is_current(generation) {
                return Err("account context changed".to_string());
            }
            let mut value = serde_json::to_value(info).map_err(|e| e.to_string())?;
            if let Some(obj) = value.as_object_mut() {
                let path = obj
                    .get("url_path")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let preview_path = obj
                    .get("preview_url_path")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                obj.insert(
                    "url".into(),
                    serde_json::Value::String(join_relay_url(&relay_url, &path)),
                );
                if !preview_path.is_empty() {
                    obj.insert(
                        "preview_url".into(),
                        serde_json::Value::String(join_relay_url(&relay_url, &preview_path)),
                    );
                }
            }
            Ok(value)
        })
    }));
}

fn register_page_publish_host() {
    set_page_publish_handler(Arc::new(|request| {
        Box::pin(async move {
            let generation = account_context_generation();
            let (session, relay_url) = read_account_context_for_generation(generation).await?;
            let result = publish_page_content_on_relay(
                &relay_url,
                &session.token,
                &request.slug,
                &request.visibility,
                request.title.as_deref(),
                request.note.as_deref(),
                request.deploy,
                request.directory.as_deref(),
                request.files.as_ref(),
            )
            .await
            .map_err(|e| e.to_string())?;
            if !account_context_is_current(generation) {
                return Err("account context changed".to_string());
            }
            serde_json::to_value(result).map_err(|e| e.to_string())
        })
    }));
}

fn get_account_context() -> &'static Arc<RwLock<Option<AccountContextState>>> {
    ACCOUNT_CONTEXT.get_or_init(|| Arc::new(RwLock::new(None)))
}

/// Read both the session and relay URL, returning owned clones to avoid
/// holding locks across awaits.
pub(crate) async fn read_account_context() -> Result<(AccountSession, String), String> {
    let generation = account_context_generation();
    read_account_context_for_generation(generation).await
}

async fn read_account_context_raw() -> Result<(AccountSession, String), String> {
    get_account_context()
        .read()
        .await
        .clone()
        .map(|context| (context.session, context.relay_url))
        .ok_or_else(|| "not logged in".to_string())
}

pub(crate) async fn read_account_context_for_generation(
    generation: u64,
) -> Result<(AccountSession, String), String> {
    if !account_context_is_current(generation) {
        return Err("account context changed".to_string());
    }
    let context = read_account_context_raw().await?;
    if !account_context_is_current(generation) {
        return Err("account context changed".to_string());
    }
    Ok(context)
}

async fn account_context_matches(generation: u64, token: &str) -> bool {
    if !account_context_is_current(generation) {
        return false;
    }
    let token_matches = get_account_context()
        .read()
        .await
        .as_ref()
        .is_some_and(|context| context.session.token == token);
    token_matches && account_context_is_current(generation)
}

/// This desktop's claim on serving the machine's device identity on Link
/// (the primary tier; a CLI host on the same machine stands by while it is
/// held). Held while signed in with remote control allowed.
static DEVICE_ROUTING_CLAIM: std::sync::Mutex<Option<DeviceRoutingLease>> =
    std::sync::Mutex::new(None);

async fn sync_device_routing_claim() {
    let wanted =
        device::remote_control_allowed().unwrap_or(false) && read_account_context().await.is_ok();
    let mut claim = DEVICE_ROUTING_CLAIM
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if !wanted {
        if claim.take().is_some() {
            log::info!("Released the device routing claim");
        }
        return;
    }
    if claim.is_none() {
        match DeviceRoutingLease::for_device(DeviceRoutingPriority::Primary) {
            Ok(lease) => *claim = Some(lease),
            Err(error) => {
                log::warn!("Device routing claim unavailable: {error}");
                return;
            }
        }
    }
    if let Some(lease) = claim.as_mut() {
        match lease.may_serve() {
            Ok(true) => {}
            Ok(false) => log::info!("Another OpenBitFun desktop serves this device"),
            Err(error) => log::warn!("Device routing claim failed: {error}"),
        }
    }
}

fn normalize_relay_url(relay_url: &str) -> Result<String, String> {
    let parsed = validate_relay_base_url(relay_url.trim()).map_err(|error| error.to_string())?;
    Ok(parsed.as_str().trim_end_matches('/').to_string())
}

async fn revoke_login_candidate(
    client: &AccountClient,
    relay_url: &str,
    session: &AccountSession,
    reason: &str,
) {
    if let Err(error) = client.revoke_token(relay_url, session).await {
        log::warn!("Failed to revoke rejected login candidate after {reason}: {error}");
    }
}

fn select_replaced_account_for_revocation(
    previous: Option<AccountContextState>,
    replacement_relay_url: &str,
    replacement_token: &str,
) -> Option<AccountContextState> {
    previous.filter(|account| {
        account.relay_url != replacement_relay_url || account.session.token != replacement_token
    })
}

async fn revoke_replaced_account(client: &AccountClient, account: Option<AccountContextState>) {
    let Some(account) = account else {
        return;
    };
    if let Err(error) = client
        .revoke_token(&account.relay_url, &account.session)
        .await
    {
        // The replacement is already fully published. Revocation is
        // best-effort and must never roll the new account back.
        log::warn!("Failed to revoke replaced account token: {error}");
    }
}

// ── Credential persistence (non-secret: username + relay_url only) ──────
// Owned by shared `session_store` so Desktop and CLI use the same hint file.

/// Tauri command: get the persisted credential hint for pre-filling the login form.
// @backend-command
pub async fn account_get_credential_hint() -> Option<AccountHint> {
    load_credential_hint()
}

fn get_service_holder() -> &'static Arc<RwLock<Option<RemoteConnectService>>> {
    static SERVICE: OnceLock<Arc<RwLock<Option<RemoteConnectService>>>> = OnceLock::new();
    SERVICE.get_or_init(|| Arc::new(RwLock::new(None)))
}

fn bot_control() -> &'static openbitfun_core::service::remote_connect::control::RemoteBotControl {
    static CONTROL: OnceLock<openbitfun_core::service::remote_connect::control::RemoteBotControl> =
        OnceLock::new();
    CONTROL.get_or_init(|| {
        openbitfun_core::service::remote_connect::control::RemoteBotControl::new(
            get_service_holder().clone(),
        )
    })
}

/// ProductControl adapter: all mutations execute on this host without requiring
/// a visible window. Account login remains a separate user-owned flow.
pub(crate) async fn execute_remote_control(
    request: openbitfun_product_domains::remote_control::RemoteControlRequest,
) -> Result<serde_json::Value, String> {
    use openbitfun_product_domains::remote_control::{
        RemoteControlMethod as Method, RemoteControlRequest as Request,
    };
    use serde_json::json;
    ensure_service().await?;
    if matches!(request, Request::Status) {
        let mut status = bot_control()
            .status()
            .await
            .map_err(|error| error.to_string())?;
        status["host"] = json!({"kind":"desktop"});
        status["connections"] = serde_json::to_value(remote_connect_status().await?)
            .map_err(|error| error.to_string())?;
        return Ok(status);
    }
    // Do not open an unanswerable host-only login dialog from a remote Agent.
    read_account_context().await.map_err(|_| {
        "account_required: Sign in to OpenBitFun on the executing Desktop host first".to_string()
    })?;
    match request {
        // The 1.x relay methods (phone web pairing, LAN relay).
        Request::Start {
            method: Method::MobileWeb | Method::Lan,
            ..
        }
        | Request::Stop {
            method: Method::MobileWeb | Method::Lan,
        } => Err(RELAY_METHOD_RETIRED.to_string()),
        other => {
            let generation = account_context_generation();
            let _account_guard = lock_account_operation(generation).await?;
            let (session, _) = read_account_context_for_generation(generation).await?;
            if let Some(service) = get_service_holder().read().await.as_ref() {
                service.set_bot_account(Some(session.user_id)).await;
            }
            bot_control()
                .execute(other)
                .await
                .map_err(|error| error.to_string())
        }
    }
}

/// Register the delegated identity provider for IM bots. Called after the
/// session is restored (startup) or after a fresh login.
async fn register_delegated_identity_providers() {
    // Global provider for IM bots.
    let account_context = get_account_context().clone();
    openbitfun_core::service::remote_connect::bot::set_delegated_identity_provider(move || {
        let account_context = account_context.clone();
        Box::pin(async move {
            let generation = account_context_generation();
            if !account_context_is_current(generation) {
                return None;
            }
            let context = account_context.read().await.clone()?;
            if !account_context_is_current(generation) {
                return None;
            }
            match AccountClient::new()
                .delegate_token(&context.relay_url, &context.session)
                .await
            {
                Ok(delegated) if account_context_is_current(generation) => Some((
                    context.relay_url,
                    openbitfun_core::service::remote_connect::AccountSession::new(
                        delegated.token,
                        delegated.user_id,
                        delegated.device_secret,
                    ),
                )),
                Ok(_) => None,
                Err(e) => {
                    log::warn!("Bot delegate token failed: {e}");
                    None
                }
            }
        })
    });
}

fn register_page_tool_hosts() {
    register_page_manage_host();
    register_page_deploy_host();
    register_page_publish_host();
}

async fn maintain_device_session() -> anyhow::Result<bool> {
    let generation = account_context_generation();
    let Ok((old, relay_url)) = read_account_context_for_generation(generation).await else {
        return Ok(true);
    };
    let Some(saved) = session_store::renew_session_if_due(false).await? else {
        return Ok(true);
    };
    if saved.replaces(&old, &relay_url) {
        let Some(mut transition) = begin_account_transition_if_current(generation).await else {
            return Ok(true);
        };
        *get_account_context().write().await = Some(AccountContextState {
            session: AccountSession::new(saved.token, saved.user_id, saved.master_key),
            relay_url,
        });
        transition.make_context_observable();
    }
    Ok(true)
}

fn monitor_remote_control_permission() {
    let mut allowed = device::remote_control_allowed().unwrap_or(false);
    tokio::spawn(async move {
        loop {
            allowed = device::wait_for_remote_control_change(allowed).await;
            if allowed {
                restore_saved_bots().await;
            } else {
                bot_control().suspend().await;
            }
            sync_device_routing_claim().await;
        }
    });
}

pub fn init_on_startup() {
    register_page_tool_hosts();
    monitor_remote_control_permission();
    tokio::spawn(async {
        let startup_generation = account_context_generation();
        let error = session_store::renew_session_if_due(false).await.err();
        if let Some(error) = &error {
            log::warn!("Startup device credential maintenance failed: {error}");
        }
        session_store::schedule_renewal_checks(
            RENEWAL_WAKE.clone(),
            error.is_some(),
            maintain_device_session,
        );
        // Restore persisted account session (if any) before anything else
        // so that bot delegation works on restart.
        match session_store::load_session_detailed() {
            Ok(Some(loaded)) => {
                let user_id = loaded.user_id.clone();
                let relay_url = match normalize_relay_url(&loaded.relay_url) {
                    Ok(url) => url,
                    Err(error) => {
                        log::warn!("Ignoring invalid persisted relay URL: {error}");
                        // Keep the record intact. A newer build, repaired
                        // configuration, or explicit user action may recover
                        // it; startup validation must never become data loss.
                        sync_account_login_capability(false);
                        if let Err(error) = ensure_service().await {
                            log::warn!("Remote connect startup init failed: {error}");
                        }
                        return;
                    }
                };
                if openbitfun_services_integrations::remote_connect::account::persisted_relay_requires_migration(&relay_url) {
                    if let Some(device_id) = loaded.device_id.as_deref() {
                        if let Err(error) = DeviceIdentity::adopt_account_device_id(device_id) {
                            log::warn!("Failed to adopt migrating account device id: {error}");
                            return;
                        }
                    }
                    if let Err(error) = ensure_service().await {
                        log::warn!("Remote connect startup init failed: {error}");
                        return;
                    }
                    match login_account_on_relay_for_generation(openbitfun_product_domains::account::DEFAULT_RELAY_URL.to_string(), Some(startup_generation)).await {
                        Ok(_) => {
                            restore_saved_bots().await;
                        }
                        Err(error) => {
                            sync_account_login_capability(false);
                            log::warn!("Account sign-in required; previous credential retained: {error}");
                            if let Err(error) = ensure_service().await {
                                log::warn!("Remote connect startup init failed: {error}");
                            }
                        }
                    }
                    return;
                }
                let Some(restore_guard) =
                    begin_account_transition_if_current(startup_generation).await
                else {
                    log::info!(
                        "Skipped persisted session restore after a newer account transition"
                    );
                    if let Err(error) = ensure_service().await {
                        log::warn!("Remote connect startup init failed: {error}");
                    }
                    return;
                };
                if let Some(device_id) = loaded.device_id.as_deref() {
                    if let Err(e) = DeviceIdentity::adopt_account_device_id(device_id) {
                        log::warn!("Failed to adopt restored session device_id: {e}");
                    }
                }
                let session = AccountSession::new(loaded.token, user_id.clone(), loaded.master_key);
                *get_account_context().write().await = Some(AccountContextState {
                    session,
                    relay_url: relay_url.clone(),
                });
                sync_account_login_capability(true);
                log::info!("Restored account session for user {user_id}");
                drop(restore_guard);

                // Initialize the remote-connect service if not yet ready.
                if let Err(e) = ensure_service().await {
                    log::warn!("Remote connect startup init failed: {e}");
                }

                // Re-register the delegated identity provider for bots.
                register_delegated_identity_providers().await;

                // Best-effort: restore bot connections now that delegated
                // identity is available again.
                restore_saved_bots().await;
                sync_device_routing_claim().await;
            }
            Ok(None) => {
                sync_account_login_capability(false);
                // No persisted session — normal for first-time users.
                if let Err(e) = ensure_service().await {
                    log::warn!("Remote connect startup init failed: {e}");
                }
            }
            Err(e) => {
                sync_account_login_capability(false);
                log::warn!("Failed to load persisted session: {e}");
                if let Err(e) = ensure_service().await {
                    log::warn!("Remote connect startup init failed: {e}");
                }
            }
        }
    });
}

/// Synchronous cleanup called when the application exits.
pub fn cleanup_on_exit() {
    log::info!("Remote connect cleanup completed on exit");
}

async fn ensure_service() -> Result<(), String> {
    let holder = get_service_holder();
    if holder.read().await.is_some() {
        return Ok(());
    }
    let mut guard = holder.write().await;
    if guard.is_some() {
        return Ok(());
    }
    *guard = Some(
        new_remote_connect_service(RemoteConnectConfig::default())
            .map_err(|error| format!("init remote connect: {error}"))?,
    );
    drop(guard);
    restore_saved_bots().await;
    Ok(())
}

fn new_remote_connect_service(config: RemoteConnectConfig) -> anyhow::Result<RemoteConnectService> {
    RemoteConnectService::new(config)
}

/// Restore any bot connections that were previously saved to disk.
async fn restore_saved_bots() {
    let generation = account_context_generation();
    let Ok(_account_guard) = lock_account_operation(generation).await else {
        return;
    };
    let Ok((session, _)) = read_account_context_for_generation(generation).await else {
        return;
    };
    if let Err(error) = bot_control().restore(&session.user_id).await {
        log::warn!("Failed to restore saved bot state: {error}");
    }
}

// ── Request / Response DTOs ────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct StartRemoteConnectRequest {
    pub method: String,
    /// Sent by older UIs for the retired LAN mode; accepted and ignored.
    #[serde(default)]
    pub lan_ip: Option<String>,
}

/// Remote Connect status. The `relay_*`, `connections` and `clients` fields
/// belong to the retired 1.x relay: they stay in the shape (always empty or
/// false) so a client that reads them keeps parsing the answer.
#[derive(Debug, Serialize, Deserialize)]
pub struct RemoteConnectStatusResponse {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub connections: Vec<serde_json::Value>,
    pub relay_connected: bool,
    pub relay_url: Option<String>,
    pub active_method: Option<ConnectionMethod>,
    pub clients: Vec<serde_json::Value>,
    pub bot_connected: Option<String>,
    pub bot_verbose_mode: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remote_control_allowed: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct ConnectionMethodInfo {
    pub id: String,
    pub name: String,
    pub available: bool,
    pub description: String,
}

#[derive(Debug, Serialize)]
pub struct DeviceInfo {
    pub device_id: String,
    pub device_name: String,
    pub mac_address: String,
}

// @backend-command
pub async fn remote_connect_get_device_info() -> Result<DeviceInfo, String> {
    ensure_service().await?;
    // Always read the persisted/account-adopted identity — not a stale copy
    // captured when RemoteConnectService was first constructed.
    let id = DeviceIdentity::from_current_machine().map_err(|e| format!("detect device: {e}"))?;
    Ok(DeviceInfo {
        device_id: id.device_id,
        device_name: id.device_name,
        mac_address: id.mac_address,
    })
}

// @backend-command
pub async fn remote_connect_get_methods() -> Result<Vec<ConnectionMethodInfo>, String> {
    ensure_service().await?;
    let holder = get_service_holder();
    let guard = holder.read().await;
    let service = guard.as_ref().ok_or("service not initialized")?;
    Ok(connection_method_infos(service.available_methods().await))
}

/// The methods 2.0 offers (IM bots); the retired relay methods are never
/// listed.
fn connection_method_infos(methods: Vec<ConnectionMethod>) -> Vec<ConnectionMethodInfo> {
    methods
        .into_iter()
        .filter_map(|m| match m {
            ConnectionMethod::Lan { .. } | ConnectionMethod::OpenBitFunServer => None,
            ConnectionMethod::BotFeishu => Some(ConnectionMethodInfo {
                id: "bot_feishu".into(),
                name: "Feishu Bot".into(),
                available: true,
                description: "Via Feishu messenger".into(),
            }),
            ConnectionMethod::BotTelegram => Some(ConnectionMethodInfo {
                id: "bot_telegram".into(),
                name: "Telegram Bot".into(),
                available: true,
                description: "Via Telegram".into(),
            }),
            ConnectionMethod::BotWeixin => Some(ConnectionMethodInfo {
                id: "bot_weixin".into(),
                name: "WeChat (Weixin)".into(),
                available: true,
                description: "Via WeChat iLink bot".into(),
            }),
        })
        .collect()
}

fn parse_connection_method(method: &str) -> Result<ConnectionMethod, String> {
    match method {
        "lan" | "openbitfun_server" => Err(RELAY_METHOD_RETIRED.to_string()),
        "bot_feishu" => Ok(ConnectionMethod::BotFeishu),
        "bot_telegram" => Ok(ConnectionMethod::BotTelegram),
        "bot_weixin" => Ok(ConnectionMethod::BotWeixin),
        _ => Err(format!("unknown connection method: {method}")),
    }
}

/// Start an IM bot connection and return its pairing code. The retired relay
/// methods (`openbitfun_server`, `lan`) are refused before touching anything.
// @backend-command
pub async fn remote_connect_start(
    request: StartRemoteConnectRequest,
) -> Result<ConnectionResult, String> {
    let method = parse_connection_method(&request.method)?;
    ensure_service().await?;
    let _start_stop = START_STOP_LOCK.lock().await;
    device::require_remote_control().map_err(|e| e.to_string())?;
    // IM transports require the signed-in account before pairing.
    if read_account_context().await.is_err() {
        account_login(AccountAuthRequest {}).await?;
    }
    let generation = account_context_generation();
    let _account_guard = lock_account_operation(generation).await?;
    let (session, _) = read_account_context_for_generation(generation).await?;
    if let Some(service) = get_service_holder().read().await.as_ref() {
        service.set_bot_account(Some(session.user_id)).await;
    }
    let bot_type = match method {
        ConnectionMethod::BotFeishu => "feishu",
        ConnectionMethod::BotTelegram => "telegram",
        ConnectionMethod::BotWeixin => "weixin",
        ConnectionMethod::Lan { .. } | ConnectionMethod::OpenBitFunServer => {
            return Err(RELAY_METHOD_RETIRED.to_string())
        }
    };
    bot_control()
        .start_connection(bot_type)
        .await
        .map_err(|error| error.to_string())
}

#[derive(Debug, Deserialize)]
pub struct StopRemoteConnectRequest {
    pub method: String,
}

/// Stop a relay method. Nothing of the retired relay runs in 2.0: an omitted
/// method or `openbitfun_server` has nothing to stop; `lan` is refused like
/// before. Bots stop through `remote_connect_stop_bot`.
// @backend-command
pub async fn remote_connect_stop(request: Option<StopRemoteConnectRequest>) -> Result<(), String> {
    match request.as_ref().map(|request| request.method.as_str()) {
        None | Some("openbitfun_server") => Ok(()),
        Some("lan") => Err(RELAY_METHOD_RETIRED.to_string()),
        Some(_) => Err("unknown Relay connection method".to_string()),
    }
}

// @backend-command
pub async fn remote_connect_stop_bot() -> Result<(), String> {
    for method in ["weixin", "telegram", "feishu"] {
        bot_control()
            .stop(method)
            .await
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

// @backend-command
pub async fn remote_connect_status() -> Result<RemoteConnectStatusResponse, String> {
    ensure_service().await?;
    let holder = get_service_holder();
    let guard = holder.read().await;
    let service = guard.as_ref().ok_or("service not initialized")?;
    Ok(RemoteConnectStatusResponse {
        connections: Vec::new(),
        relay_connected: false,
        relay_url: None,
        active_method: None,
        clients: Vec::new(),
        bot_connected: service.bot_connected_info().await,
        bot_verbose_mode: bot::load_bot_persistence().verbose_mode,
        remote_control_allowed: Some(device::remote_control_allowed().map_err(|e| e.to_string())?),
    })
}

#[derive(Deserialize)]
pub struct SetRemoteControlRequest {
    allowed: bool,
}

// @backend-command
pub async fn remote_connect_set_allowed(request: SetRemoteControlRequest) -> Result<(), String> {
    device::set_remote_control_allowed(request.allowed).map_err(|e| e.to_string())
}

// @backend-command
pub async fn remote_connect_get_form_state() -> Result<bot::RemoteConnectFormState, String> {
    Ok(bot::load_bot_persistence().form_state)
}

// @backend-command
pub async fn remote_connect_set_form_state(
    request: bot::RemoteConnectFormState,
) -> Result<(), String> {
    bot::update_bot_persistence(|data| data.form_state = request);
    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct ConfigureBotRequest {
    pub bot_type: String,
    pub app_id: Option<String>,
    pub app_secret: Option<String>,
    pub bot_token: Option<String>,
    pub weixin_ilink_token: Option<String>,
    pub weixin_base_url: Option<String>,
    pub weixin_bot_account_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct WeixinQrStartRequest {
    pub base_url: Option<String>,
    pub existing_ilink_token: Option<String>,
    pub existing_bot_account_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct WeixinQrPollRequest {
    pub session_key: String,
    pub base_url: Option<String>,
    pub verify_code: Option<String>,
}

// @backend-command
pub async fn remote_connect_configure_bot(request: ConfigureBotRequest) -> Result<(), String> {
    ensure_service().await?;
    let bot_config = match request.bot_type.as_str() {
        "feishu" => BotConfig::Feishu {
            app_id: request.app_id.unwrap_or_default(),
            app_secret: request.app_secret.unwrap_or_default(),
        },
        "telegram" => BotConfig::Telegram {
            bot_token: request.bot_token.unwrap_or_default(),
        },
        "weixin" => BotConfig::Weixin {
            ilink_token: request.weixin_ilink_token.unwrap_or_default(),
            base_url: request.weixin_base_url.unwrap_or_default(),
            bot_account_id: request.weixin_bot_account_id.unwrap_or_default(),
        },
        _ => return Err(format!("unknown bot type: {}", request.bot_type)),
    };

    bot_control()
        .configure(bot_config)
        .await
        .map_err(|error| error.to_string())
}

// @backend-command
pub async fn remote_connect_weixin_qr_start(
    request: WeixinQrStartRequest,
) -> Result<weixin::WeixinQrStartResponse, String> {
    weixin::weixin_qr_start_with_existing(
        request.base_url,
        request.existing_ilink_token,
        request.existing_bot_account_id,
    )
    .await
    .map_err(|e| format!("weixin qr start: {e}"))
}

// @backend-command
pub async fn remote_connect_weixin_qr_poll(
    request: WeixinQrPollRequest,
) -> Result<weixin::WeixinQrPollResponse, String> {
    weixin::weixin_qr_poll(&request.session_key, request.base_url, request.verify_code)
        .await
        .map_err(|e| format!("weixin qr poll: {e}"))
}

// @backend-command
pub async fn remote_connect_get_bot_verbose_mode() -> Result<bool, String> {
    let data = bot::load_bot_persistence();
    Ok(data.verbose_mode)
}

// @backend-command
pub async fn remote_connect_set_bot_verbose_mode(verbose: bool) -> Result<(), String> {
    log::info!(
        "remote_connect_set_bot_verbose_mode called with verbose={}",
        verbose
    );
    bot::update_bot_persistence(|data| data.verbose_mode = verbose);
    log::info!("Saved bot verbose_mode={} to persistence", verbose);
    Ok(())
}

// ── Account commands ────────────────────────────────────────────────────

/// Result returned to the frontend after a successful register/login.
/// The master key is deliberately NOT included — it stays in Rust memory.
#[derive(Serialize, Deserialize, Clone)]
pub struct AccountLoginResult {
    pub user_id: String,
}

/// Current account login status (no secrets exposed).
#[derive(Serialize, Deserialize)]
pub struct AccountStatus {
    pub logged_in: bool,
    pub user_id: Option<String>,
}

/// Login uses the shared GitHub credential; no per-Relay credentials or URL.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AccountAuthRequest {}

fn current_device_identity() -> Result<DeviceIdentity, String> {
    DeviceIdentity::from_current_machine().map_err(|e| format!("detect device: {e}"))
}

/// Persist the in-memory account session so restart restores login.
async fn persist_account_session(
    device_id: Option<&str>,
    previous_host_token: Option<&str>,
) -> Result<(), String> {
    // Login installs the context while its transition permit is still held;
    // this internal persistence step intentionally reads that staged value.
    let (session, relay_url) = read_account_context_raw().await?;
    session_store::save_issued_session(&session, &relay_url, device_id, previous_host_token)
        .await
        .map_err(|e| format!("persist session: {e}"))
}

// @backend-command
pub async fn account_login(_request: AccountAuthRequest) -> Result<AccountLoginResult, String> {
    login_account_on_relay(openbitfun_product_domains::account::DEFAULT_RELAY_URL.to_string()).await
}

async fn login_account_on_relay(relay_url: String) -> Result<AccountLoginResult, String> {
    login_account_on_relay_for_generation(relay_url, None).await
}

async fn login_account_on_relay_for_generation(
    relay_url: String,
    required_generation: Option<u64>,
) -> Result<AccountLoginResult, String> {
    // Keep the old account fully usable while credentials are verified. Only a
    // successful candidate is allowed to begin the protected replacement
    // transition and retire the old account's runtime state.
    let _login_guard = ACCOUNT_LOGIN_LOCK.lock().await;
    let expected_generation = required_generation.unwrap_or_else(account_context_generation);
    if !account_context_is_current(expected_generation) {
        return Err("account context changed".to_string());
    }
    let device = current_device_identity()?;
    let client = AccountClient::new();
    let (session, profile) = client
        .login_with_identity(&relay_url, &device, DEVICE_KIND_DESKTOP)
        .await
        .map_err(|e| format!("{e}"))?;

    let _room_boundary_guard = ACCOUNT_TRANSITION_BOUNDARY_LOCK.lock().await;
    if !account_context_is_current(expected_generation) {
        revoke_login_candidate(&client, &relay_url, &session, "account replacement race").await;
        return Err("account context changed".to_string());
    }
    let Some(mut transition_guard) = begin_account_transition_if_current(expected_generation).await
    else {
        revoke_login_candidate(&client, &relay_url, &session, "account replacement race").await;
        return Err("account context changed".to_string());
    };
    // The old account is now hidden, so account-backed tools must be hidden as
    // well. A committed login re-enables them after publication.
    sync_account_login_capability(false);
    let replaced_account = select_replaced_account_for_revocation(
        get_account_context().read().await.clone(),
        &relay_url,
        &session.token,
    );

    // The candidate is authenticated and the old context is now hidden.
    // A directory session of another account is retired with it.
    super::account_directory::retire_other_account(&session.user_id).await;
    if let Ok((previous, _)) = read_account_context_raw().await {
        if previous.user_id != session.user_id {
            if let Err(error) =
                openbitfun_core::service::filesystem::upload::retire_account_uploads(
                    &previous.user_id,
                )
                .await
            {
                log::warn!("Failed to clean up retired account uploads: {error}");
            }
        }
    }
    if let Some(service) = get_service_holder().read().await.as_ref() {
        service.clear_bot_delegated_identities().await;
    }
    // The session writer atomically replaces the old credential. A failed
    // write must leave the previous encrypted record recoverable.

    let result = AccountLoginResult {
        user_id: session.user_id.clone(),
    };
    *get_account_context().write().await = Some(AccountContextState {
        session,
        relay_url: relay_url.clone(),
    });
    // Persist non-secret credentials for next startup pre-fill
    save_credential_hint(&profile.login, &relay_url);
    // Reset the token-expired flag on fresh login
    TOKEN_EXPIRED.store(false, std::sync::atomic::Ordering::Relaxed);

    if let Err(e) = persist_account_session(
        Some(device.device_id.as_str()),
        replaced_account
            .as_ref()
            .map(|context| context.session.token.as_str()),
    )
    .await
    {
        log::warn!("Failed to persist session: {e}");
    }
    register_delegated_identity_providers().await;

    // AccountClient revocation is transport-only and does not re-enter host
    // lifecycle locks. Keep the transition lease until it finishes so no
    // caller can replace B and then observe this command returning B's result.
    revoke_replaced_account(&client, replaced_account).await;
    // End context hiding before notifying listeners. Keep the transition mutex
    // until after the event so a listener's immediate account-status probe sees
    // this committed account instead of a transient logged-out state.
    transition_guard.make_context_observable();
    sync_account_login_capability(true);
    sync_device_routing_claim().await;
    emit_account_event(
        "account://login-state",
        serde_json::json!({ "logged_in": true, "relay_url": relay_url }),
    );
    log::info!("Account logged in: {}", result.user_id);
    Ok(result)
}

// @backend-command
pub async fn account_status() -> Result<AccountStatus, String> {
    let context = read_account_context().await.ok();
    let logged_in = context.is_some();
    Ok(AccountStatus {
        logged_in,
        user_id: if logged_in {
            context.map(|(session, _)| session.user_id)
        } else {
            None
        },
    })
}

/// Stop account-backed runtime services and clear all local login state.
///
/// `revoke_relay_token` is false after deleting this device because the relay
/// deletion already revoked the current token along with the device row.
async fn clear_account_login(revoke_relay_token: bool) {
    // Retire account-bound operations before clearing credentials.
    let _room_boundary_guard = ACCOUNT_TRANSITION_BOUNDARY_LOCK.lock().await;
    let _operation_guard = begin_account_transition().await;
    clear_account_login_state(revoke_relay_token).await;
}

async fn clear_account_login_if_current(
    expected_generation: u64,
    expected_token: &str,
    revoke_relay_token: bool,
) -> bool {
    if !account_context_matches(expected_generation, expected_token).await {
        return false;
    }
    let _room_boundary_guard = ACCOUNT_TRANSITION_BOUNDARY_LOCK.lock().await;
    if !account_context_matches(expected_generation, expected_token).await {
        return false;
    }
    let Some(_transition_guard) = begin_account_transition_if_current(expected_generation).await
    else {
        return false;
    };
    let token_matches = get_account_context()
        .read()
        .await
        .as_ref()
        .is_some_and(|context| context.session.token == expected_token);
    if !token_matches {
        return false;
    }
    clear_account_login_state(revoke_relay_token).await;
    true
}

async fn clear_account_login_state(revoke_relay_token: bool) {
    // Account transitions hide the context immediately; hide account-backed
    // tools at the same boundary rather than after network cleanup completes.
    sync_account_login_capability(false);
    if let Ok((previous, _)) = read_account_context_raw().await {
        if let Err(error) =
            openbitfun_core::service::filesystem::upload::retire_account_uploads(&previous.user_id)
                .await
        {
            log::warn!("Failed to clean up retired account uploads: {error}");
        }
    }
    if let Some(service) = get_service_holder().read().await.as_ref() {
        service.clear_bot_delegated_identities().await;
    }
    let active = read_account_context_raw().await.ok();
    *get_account_context().write().await = None;
    clear_credential_hint();
    session_store::logout_session(active, revoke_relay_token).await;
    TOKEN_EXPIRED.store(false, std::sync::atomic::Ordering::Relaxed);
    sync_device_routing_claim().await;
    emit_account_event(
        "account://login-state",
        serde_json::json!({ "logged_in": false }),
    );
}

// @backend-command
pub async fn account_logout(app: HostHandle) -> Result<(), String> {
    let mut identity = openbitfun_services_integrations::account_identity::AccountIdentityClient::from_environment()
        .await.map_err(|error| error.to_string())?;
    identity.logout().await.map_err(|error| error.to_string())?;
    // The new-version directory session goes with the identity.
    super::account_directory::sign_out().await;
    clear_account_login(true).await;
    super::account_identity_api::emit_identity_changed(&app, "signed-out");
    log::info!("Account logged out");
    Ok(())
}

// ── Account device directory ─────────────────────────────────────────

/// One device of the account, from the account directory.
#[derive(Serialize)]
pub struct AccountDeviceInfo {
    pub device_id: String,
    pub device_name: String,
    pub device_kind: Option<String>,
    pub device_alias: Option<String>,
    pub device_model: Option<String>,
    pub device_os: Option<String>,
    pub device_os_version: Option<String>,
    pub device_client_version: Option<String>,
    pub device_client_protocol: Option<u32>,
    pub compatible: Option<bool>,
    /// Directory presence.
    pub online: bool,
    pub last_seen_at: Option<i64>,
    /// `directory` (the account directory says online) or `offline`. (1.x
    /// hosts also sent `live` for their relay socket's presence.)
    pub presence: &'static str,
    /// The device this host runs on.
    pub is_local: bool,
}

// @backend-command
pub async fn account_list_devices() -> Result<Vec<AccountDeviceInfo>, String> {
    let generation = account_context_generation();
    let (session, relay_url) = read_account_context_for_generation(generation).await?;
    let client = AccountClient::new();
    let devices = match client.list_devices(&relay_url, &session).await {
        Ok(devices) => devices,
        Err(e) => {
            let msg = format!("{e}");
            if error_indicates_expired_token(&msg) {
                invalidate_local_account_session_if_current(generation, &session.token, &msg).await;
            }
            return Err(msg);
        }
    };
    if !account_context_is_current(generation) {
        return Err("account context changed".to_string());
    }
    let local_device_id = DeviceIdentity::from_current_machine()
        .ok()
        .map(|identity| identity.device_id);
    let devices: Vec<AccountDeviceInfo> = devices
        .into_iter()
        .map(|d| AccountDeviceInfo {
            is_local: local_device_id.as_deref() == Some(d.device_id.as_str()),
            presence: if d.online { "directory" } else { "offline" },
            device_id: d.device_id,
            device_name: d.device_name,
            device_kind: d.device_kind,
            device_alias: d.device_alias,
            device_model: d.device_model,
            device_os: d.device_os,
            device_os_version: d.device_os_version,
            device_client_version: d.device_client_version,
            device_client_protocol: d.device_client_protocol,
            compatible: d.compatible,
            online: d.online,
            last_seen_at: d.last_seen_at,
        })
        .collect();
    Ok(devices)
}

#[derive(Deserialize)]
pub struct AccountUpdateDeviceAliasRequest {
    pub device_id: String,
    pub device_alias: Option<String>,
}

// @backend-command
pub async fn account_update_device_alias(
    request: AccountUpdateDeviceAliasRequest,
) -> Result<(), String> {
    let generation = account_context_generation();
    let _operation = lock_account_operation(generation).await?;
    let (session, relay_url) = read_account_context_for_generation(generation).await?;
    AccountClient::new()
        .update_device_alias(
            &relay_url,
            &session,
            &request.device_id,
            request.device_alias.as_deref(),
        )
        .await
        .map_err(|error| error.to_string())
}

/// Remove a device from the account.
// @backend-command
pub async fn account_delete_device(targetDeviceId: String) -> Result<(), String> {
    let generation = account_context_generation();
    let (session, relay_url) = read_account_context_for_generation(generation).await?;
    let is_current_device = current_device_identity()?.device_id == targetDeviceId;
    if let Err(error) = AccountClient::new()
        .delete_device(&relay_url, &session, &targetDeviceId)
        .await
    {
        let message = error.to_string();
        if error_indicates_expired_token(&message) {
            invalidate_local_account_session_if_current(generation, &session.token, &message).await;
        }
        return Err(message);
    }
    if !account_context_is_current(generation) {
        return Err("account context changed".to_string());
    }
    log::info!("Device {targetDeviceId} removed from account");
    if is_current_device {
        if clear_account_login_if_current(generation, &session.token, false).await {
            log::info!("Current device removed; local account session cleared");
        } else {
            return Err("account context changed".to_string());
        }
    }
    Ok(())
}

#[cfg(test)]
mod account_context_tests {
    use super::*;

    /// Serializes these tests against the process-global account context.
    /// Async-aware so the guard may be held across each test's awaits; the
    /// plain `#[test]` cases take it with `blocking_lock`, which cannot stall
    /// because they run without an ambient runtime.
    pub(super) static ACCOUNT_CONTEXT_TEST_LOCK: tokio::sync::Mutex<()> =
        tokio::sync::Mutex::const_new(());

    #[test]
    fn relay_url_normalization_removes_all_trailing_slashes() {
        assert_eq!(
            normalize_relay_url("https://relay.example.com///").unwrap(),
            "https://relay.example.com"
        );
    }

    #[test]
    fn replaced_token_revocation_never_selects_the_published_credential() {
        let account = |token: &str, relay_url: &str| AccountContextState {
            session: AccountSession::new(token.to_string(), "user-a".to_string(), [7; 32]),
            relay_url: relay_url.to_string(),
        };

        assert!(select_replaced_account_for_revocation(
            Some(account("token-b", "https://relay.example.com")),
            "https://relay.example.com",
            "token-b",
        )
        .is_none());
        let same_account_old_token = select_replaced_account_for_revocation(
            Some(account("token-a", "https://relay.example.com")),
            "https://relay.example.com",
            "token-b",
        )
        .expect("same-account relogin must revoke the old token");
        assert_eq!(same_account_old_token.session.token, "token-a");
        let other_relay = select_replaced_account_for_revocation(
            Some(account("same-token", "https://relay-a.example.com")),
            "https://relay-b.example.com",
            "same-token",
        )
        .expect("the same token text on a different relay is a distinct credential");
        assert_eq!(other_relay.relay_url, "https://relay-a.example.com");
    }

    #[tokio::test(flavor = "current_thread")]
    async fn external_account_reads_are_hidden_during_transition() {
        let _test_guard = ACCOUNT_CONTEXT_TEST_LOCK.lock().await;
        *get_account_context().write().await = Some(AccountContextState {
            session: AccountSession::new("token-a".to_string(), "user-a".to_string(), [7; 32]),
            relay_url: "https://relay.example.com".to_string(),
        });
        assert!(read_account_context().await.is_ok());

        let permit = AccountContextTransitionPermit::begin();
        assert!(read_account_context().await.is_err());
        assert!(read_account_context_raw().await.is_ok());
        drop(permit);

        *get_account_context().write().await = None;
    }

    #[tokio::test(flavor = "current_thread")]
    async fn login_event_probe_sees_context_before_transition_mutex_is_released() {
        let _test_guard = ACCOUNT_CONTEXT_TEST_LOCK.lock().await;
        let transition_guard = ACCOUNT_CONTEXT_TRANSITION_LOCK.lock().await;
        let transition = AccountContextTransitionPermit::begin();
        let mut guard = AccountContextTransitionGuard {
            operation_guard: None,
            transition: Some(transition),
            transition_guard: Some(transition_guard),
        };

        assert!(!account_context_is_current(account_context_generation()));
        guard.make_context_observable();
        assert!(account_context_is_current(account_context_generation()));
        assert!(ACCOUNT_CONTEXT_TRANSITION_LOCK.try_lock().is_err());

        drop(guard);
        assert!(ACCOUNT_CONTEXT_TRANSITION_LOCK.try_lock().is_ok());
    }

    #[test]
    fn retired_relay_methods_are_refused_and_never_listed() {
        for method in ["openbitfun_server", "lan"] {
            assert_eq!(
                parse_connection_method(method).unwrap_err(),
                RELAY_METHOD_RETIRED
            );
        }
        let listed = connection_method_infos(vec![
            ConnectionMethod::Lan { ip: None },
            ConnectionMethod::OpenBitFunServer,
            ConnectionMethod::BotTelegram,
        ]);
        let ids: Vec<_> = listed.iter().map(|info| info.id.as_str()).collect();
        assert_eq!(ids, vec!["bot_telegram"]);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn stopping_the_retired_relay_has_nothing_to_stop() {
        assert!(remote_connect_stop(None).await.is_ok());
        assert!(remote_connect_stop(Some(StopRemoteConnectRequest {
            method: "openbitfun_server".into(),
        }))
        .await
        .is_ok());
        assert_eq!(
            remote_connect_stop(Some(StopRemoteConnectRequest {
                method: "lan".into(),
            }))
            .await
            .unwrap_err(),
            RELAY_METHOD_RETIRED
        );
    }
}

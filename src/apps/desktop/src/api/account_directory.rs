//! This desktop's session in the new-version account directory
//! (`openbitfun_services_integrations::remote_connect::directory_session`).
//!
//! The device network (pair keys, row kinds, device names), the fleet
//! directory and the cloud node read it; none of them reads the legacy relay
//! account context (`remote_connect_api::read_account_context`), which stays
//! for the legacy paths that serve older clients. The session comes from the
//! account identity alone, so it works while the legacy relay is unreachable.

use std::future::Future;
use std::sync::{Arc, OnceLock, RwLock};

use openbitfun_services_integrations::remote_connect::account::{
    error_indicates_expired_token, AccountSession,
};
use openbitfun_services_integrations::remote_connect::directory_session::DirectorySessions;
use openbitfun_services_integrations::remote_connect::DeviceIdentity;

static SESSIONS: OnceLock<RwLock<Arc<DirectorySessions>>> = OnceLock::new();

fn slot() -> &'static RwLock<Arc<DirectorySessions>> {
    SESSIONS.get_or_init(|| RwLock::new(Arc::new(DirectorySessions::from_environment(false))))
}

fn sessions() -> Arc<DirectorySessions> {
    Arc::clone(
        &slot()
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner()),
    )
}

/// The process's directory sessions now (account settings sync reads them on
/// every call, so a replacement is picked up).
pub(crate) fn current_sessions() -> Arc<DirectorySessions> {
    sessions()
}

/// Replaces the process's directory sessions (tests drive a local directory).
#[cfg(test)]
pub(crate) fn install_for_test(replacement: Arc<DirectorySessions>) {
    *slot()
        .write()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = replacement;
}

/// The directory base URL new-version paths join their API paths on.
pub(crate) fn directory_url() -> String {
    sessions().url().to_string()
}

fn device_identity() -> Result<DeviceIdentity, String> {
    DeviceIdentity::from_current_machine().map_err(|error| format!("detect device: {error}"))
}

/// The directory session and URL, signing in from the account identity when
/// there is none yet.
pub(crate) async fn read_directory_context() -> Result<(AccountSession, String), String> {
    let sessions = sessions();
    if let Some(context) = sessions.cached().await {
        return Ok(context);
    }
    let device = device_identity()?;
    sessions
        .context(&device)
        .await
        .map_err(|error| format!("account directory unavailable: {error}"))
}

/// Runs `call` with the directory session; a 401 signs in again once.
pub(crate) async fn with_directory_session<T, F, Fut>(call: F) -> Result<T, String>
where
    F: Fn(AccountSession, String) -> Fut,
    Fut: Future<Output = Result<T, String>>,
{
    let (session, url) = read_directory_context().await?;
    let token = session.token.clone();
    match call(session, url).await {
        Err(error) if error_indicates_expired_token(&error) => {
            sessions().invalidate(&token).await;
            let (session, url) = read_directory_context().await?;
            call(session, url).await
        }
        other => other,
    }
}

/// After the account identity signed in: retire any earlier session (it may
/// belong to another account), sign in to the directory and wake the device
/// network. Never blocks the caller.
pub(crate) fn signed_in() {
    let Ok(handle) = tokio::runtime::Handle::try_current() else {
        return;
    };
    handle.spawn(async {
        sessions().sign_out().await;
        match read_directory_context().await {
            Ok(_) => {
                if let Some(mesh) = crate::mesh::global() {
                    mesh.wake();
                }
            }
            Err(error) => log::warn!("Account directory sign-in failed: {error}"),
        }
        // Account settings sync follows the account's replica.
        crate::api::account_settings_sync_api::signed_in();
    });
}

/// The legacy account context moved to `account_id`: a directory session of
/// another account is revoked.
pub(crate) async fn retire_other_account(account_id: &str) {
    sessions().retire_other_account(account_id).await;
}

/// Sign-out: revoke and forget the directory session, then let the device
/// network notice.
pub(crate) async fn sign_out() {
    sessions().sign_out().await;
    crate::api::account_settings_sync_api::signed_out();
    if let Some(mesh) = crate::mesh::global() {
        mesh.wake();
    }
}

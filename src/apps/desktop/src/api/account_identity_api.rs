//! Controller-local adapter for the shared OpenBitFun account identity:
//! the in-app email sign-in (`account_email_*`), the GitHub browser sign-in
//! (`account_github_*`) and the one identity projection every surface shows
//! (`account_identity`).
use crate::host::HostHandle;
use openbitfun_product_domains::account::{
    AccountEmailChallenge, AccountEmailStartRequest, AccountEmailVerifyRequest,
    AccountEmailVerifyResponse, AccountIdentityView, GitHubAuthPollRequest, GitHubAuthPollResponse,
    GitHubAuthStart,
};
use openbitfun_services_integrations::account_identity;

/// Sends an email sign-in code. Errors answer `<code>: <sentence>`
/// (`invalid_email`, `rate_limited`, `unsupported`, `network`, `unavailable`).
// @backend-command
pub async fn account_email_start(
    request: AccountEmailStartRequest,
) -> Result<AccountEmailChallenge, String> {
    account_identity::start_email_sign_in(request)
        .await
        .map_err(|error| error.coded_message())
}

/// Completes the email sign-in with the code and the account session with it.
// @backend-command
pub async fn account_email_verify(
    app: HostHandle,
    request: AccountEmailVerifyRequest,
) -> Result<AccountEmailVerifyResponse, String> {
    account_identity::verify_email_sign_in(request)
        .await
        .map_err(|error| error.coded_message())?;
    complete_sign_in(&app).await;
    Ok(AccountEmailVerifyResponse {
        identity: current_identity().await,
    })
}

/// Who is signed in, as every surface shows it; `null` when signed out.
// @backend-command
pub async fn account_identity() -> Result<Option<AccountIdentityView>, String> {
    account_identity::current_identity()
        .await
        .map_err(|error| error.coded_message())
}

async fn current_identity() -> Option<AccountIdentityView> {
    account_identity::current_identity().await.ok().flatten()
}

/// Every sign-in (email or GitHub) completes the same account session.
/// Directory failure must not turn a valid identity into a failed sign-in;
/// the device panel can retry the connection later.
async fn complete_sign_in(app: &HostHandle) {
    // The account directory signs in from the identity and wakes the device
    // network.
    super::account_directory::signed_in();
    if let Err(error) =
        super::remote_connect_api::account_login(super::remote_connect_api::AccountAuthRequest {})
            .await
    {
        log::warn!("Sign-in completed but directory registration failed: {error}");
    }
    emit_identity_changed(app, "signed-in");
}

// @backend-command
pub async fn account_github_start() -> Result<GitHubAuthStart, String> {
    account_identity::start_auth_flow()
        .await
        .map_err(|error| error.to_string())
}

// @backend-command
pub async fn account_github_poll(
    app: HostHandle,
    request: GitHubAuthPollRequest,
) -> Result<GitHubAuthPollResponse, String> {
    let response = account_identity::poll_auth_flow(request)
        .await
        .map_err(|error| error.to_string())?;
    if response.status == "authorized" {
        complete_sign_in(&app).await;
    }
    Ok(response)
}

pub(crate) fn emit_identity_changed(app: &HostHandle, status: &'static str) {
    let _ = app.emit(
        "account-identity-changed",
        serde_json::json!({ "status": status }),
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn desktop_auth_views_never_serialize_oauth_secrets() {
        let started = serde_json::to_value(GitHubAuthStart {
            transaction_id: "transaction-1".to_string(),
            authorization_url: "https://github.com/login/oauth/authorize".to_string(),
            expires_at: 123,
            poll_interval_seconds: 3,
        })
        .unwrap();
        assert!(started.get("transactionSecret").is_none());

        let polled = serde_json::to_value(GitHubAuthPollResponse {
            status: "authorized".to_string(),
        })
        .unwrap();
        assert!(polled.get("tokens").is_none());
        assert!(polled.get("accessToken").is_none());
        assert!(polled.get("refreshToken").is_none());
    }
}

//! In-app email sign-in shared by every host that keeps an account sign-in
//! (desktop, CLI): the user types an email, gets the code, types the code.
//!
//! It is the identity service's device sign-in transaction
//! (`/auth/desktop/start?methods=all`) whose sign-in ticket takes the email
//! code (`/auth/email/send`, `/auth/email/verify`); `/auth/desktop/poll` then
//! hands this host its token pair. No browser is involved. The phone app runs
//! the same transaction in its own native module with the same contract
//! helpers (`openbitfun_product_domains::account`).
//!
//! The transaction secret and the ticket stay here; a surface only sees the
//! challenge id. Errors carry a stable code (`invalid_email`, `invalid_code`,
//! `rate_limited`, `unsupported`, `network`, `unavailable`) and the service's
//! sentence; [`MarketClientError::coded_message`] is the `<code>: <sentence>`
//! string host commands answer with.

use super::{local_error, AccountIdentityClient, DesktopAuthPollRequest, MarketClientError};
use openbitfun_product_domains::account::{
    email_sign_in_refusal_code, email_sign_in_ticket, AccountEmailChallenge,
    AccountEmailStartRequest, AccountEmailVerifyRequest, EMAIL_SIGN_IN_CODE_LENGTH,
};
use std::sync::OnceLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::Mutex;

/// A started transaction is reused for another code while at least this much
/// of it is left.
const REUSE_MARGIN_SECS: i64 = 60;
/// How often the authorized transaction is polled for its token pair.
const POLL_ATTEMPTS: u32 = 8;
/// The identity service's documented wait before another code.
const DEFAULT_RETRY_AFTER_SECS: u32 = 60;

struct PendingEmailSignIn {
    poll: DesktopAuthPollRequest,
    ticket: String,
    email: String,
    challenge_id: String,
    /// Seconds since the epoch.
    expires_at: i64,
}

/// The host's pending email sign-in: one at a time, as one person signs in.
#[derive(Default)]
pub(crate) struct EmailSignIns {
    pending: Mutex<Option<PendingEmailSignIn>>,
}

fn host_sign_ins() -> &'static EmailSignIns {
    static SIGN_INS: OnceLock<EmailSignIns> = OnceLock::new();
    SIGN_INS.get_or_init(EmailSignIns::default)
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

/// Sends a sign-in code to `request.email`.
pub async fn start_email_sign_in(
    request: AccountEmailStartRequest,
) -> Result<AccountEmailChallenge, MarketClientError> {
    let client = AccountIdentityClient::from_environment().await?;
    host_sign_ins().start(&client, request).await
}

/// Checks the code and keeps the account's token pair on this host. The
/// caller then completes the account session (directory, device network).
pub async fn verify_email_sign_in(
    request: AccountEmailVerifyRequest,
) -> Result<(), MarketClientError> {
    let mut client = AccountIdentityClient::from_environment().await?;
    host_sign_ins().verify(&mut client, request).await
}

/// Forgets a pending email sign-in (the user went back or closed the dialog).
pub async fn cancel_email_sign_in() {
    *host_sign_ins().pending.lock().await = None;
}

/// The stable code of a failed step (see the module comment).
fn refusal(error: MarketClientError) -> MarketClientError {
    let code = match error.code.as_str() {
        // Already one of ours (a local refusal).
        "invalid_email" | "invalid_code" | "rate_limited" | "unsupported" | "network" => {
            return error
        }
        // The request never reached the service.
        "account_unavailable" => "network",
        service => email_sign_in_refusal_code(0, service),
    };
    MarketClientError {
        code: code.to_string(),
        ..error
    }
}

fn valid_email(email: &str) -> Option<String> {
    let email = email.trim();
    let (local, domain) = email.split_once('@')?;
    (!local.is_empty()
        && !domain.is_empty()
        && email.len() <= 254
        && !email.chars().any(|c| c.is_whitespace() || c.is_control()))
    .then(|| email.to_string())
}

impl EmailSignIns {
    pub(crate) async fn start(
        &self,
        client: &AccountIdentityClient,
        request: AccountEmailStartRequest,
    ) -> Result<AccountEmailChallenge, MarketClientError> {
        let email = valid_email(&request.email)
            .ok_or_else(|| local_error("invalid_email", "Enter your email address."))?;
        let locale = request
            .locale
            .map(|locale| locale.trim().to_string())
            .filter(|locale| !locale.is_empty() && locale.len() <= 16)
            .unwrap_or_else(|| "en-US".to_string());
        let mut pending = self.pending.lock().await;
        let reusable = pending
            .as_ref()
            .filter(|sign_in| sign_in.expires_at > now() + REUSE_MARGIN_SECS)
            .map(|sign_in| {
                (
                    sign_in.poll.clone(),
                    sign_in.ticket.clone(),
                    sign_in.expires_at,
                )
            });
        let fresh = reusable.is_none();
        let (mut poll, mut ticket, mut expires_at) = match reusable {
            Some(found) => found,
            None => Self::begin(client).await?,
        };
        let sent = match client.send_email_code(&ticket, &email, &locale).await {
            Ok(sent) => sent,
            // The service forgot a reused transaction (expired, consumed):
            // start a new one once.
            Err(error) if !fresh && refusal(error.clone()).code == "invalid_code" => {
                (poll, ticket, expires_at) = Self::begin(client).await?;
                client
                    .send_email_code(&ticket, &email, &locale)
                    .await
                    .map_err(refusal)?
            }
            Err(error) => return Err(refusal(error)),
        };
        if sent.challenge_id.is_empty() {
            return Err(local_error(
                "unavailable",
                "The sign-in service answered unexpectedly.",
            ));
        }
        let retry_after_seconds = if sent.retry_after_seconds == 0 {
            DEFAULT_RETRY_AFTER_SECS
        } else {
            sent.retry_after_seconds
        };
        *pending = Some(PendingEmailSignIn {
            poll,
            ticket,
            email: email.to_ascii_lowercase(),
            challenge_id: sent.challenge_id.clone(),
            expires_at,
        });
        Ok(AccountEmailChallenge {
            challenge_id: sent.challenge_id,
            email: email.to_ascii_lowercase(),
            code_length: EMAIL_SIGN_IN_CODE_LENGTH,
            retry_after_seconds,
            expires_at: (expires_at > 0).then(|| expires_at.saturating_mul(1000)),
        })
    }

    async fn begin(
        client: &AccountIdentityClient,
    ) -> Result<(DesktopAuthPollRequest, String, i64), MarketClientError> {
        let started = client.start_desktop_auth().await.map_err(refusal)?;
        let ticket = email_sign_in_ticket(&started.authorization_url).ok_or_else(|| {
            local_error(
                "unsupported",
                "The sign-in service does not offer email sign-in to apps.",
            )
        })?;
        Ok((
            DesktopAuthPollRequest {
                transaction_id: started.transaction_id,
                transaction_secret: started.transaction_secret,
            },
            ticket,
            started.expires_at,
        ))
    }

    pub(crate) async fn verify(
        &self,
        client: &mut AccountIdentityClient,
        request: AccountEmailVerifyRequest,
    ) -> Result<(), MarketClientError> {
        let code: String = request
            .code
            .chars()
            .filter(|c| !c.is_whitespace())
            .collect();
        if code.is_empty() || code.len() > 32 || !code.chars().all(|c| c.is_ascii_alphanumeric()) {
            return Err(local_error(
                "invalid_code",
                "The verification code is incorrect.",
            ));
        }
        let mut pending = self.pending.lock().await;
        let Some(sign_in) = pending
            .as_ref()
            .filter(|sign_in| sign_in.challenge_id == request.challenge_id)
        else {
            return Err(local_error(
                "invalid_code",
                "This code request is no longer active; request a new code.",
            ));
        };
        if sign_in.expires_at > 0 && sign_in.expires_at <= now() {
            *pending = None;
            return Err(local_error(
                "invalid_code",
                "This code request expired; request a new code.",
            ));
        }
        if let Err(error) = client
            .verify_email_code(&sign_in.ticket, &sign_in.challenge_id, &code)
            .await
        {
            // A wrong code may be typed again; a spent or expired sign-in may not.
            if matches!(
                error.code.as_str(),
                "login_flow_expired" | "desktop_auth_expired"
            ) {
                *pending = None;
            }
            return Err(refusal(error));
        }
        let poll = sign_in.poll.clone();
        log::debug!("Email code accepted for {}", redacted(&sign_in.email));
        for attempt in 0..POLL_ATTEMPTS {
            let answer = client.poll_desktop_auth(&poll).await.map_err(refusal)?;
            match answer.status.as_str() {
                "authorized" if answer.tokens.is_some() => {
                    *pending = None;
                    return Ok(());
                }
                "pending" | "authorized" => {
                    tokio::time::sleep(Duration::from_millis(250 * u64::from(attempt.min(4) + 1)))
                        .await;
                }
                _ => {
                    *pending = None;
                    return Err(local_error(
                        "invalid_code",
                        "The sign-in request expired; request a new code.",
                    ));
                }
            }
        }
        Err(local_error(
            "unavailable",
            "The sign-in did not complete; try again.",
        ))
    }
}

/// An address for debug logs: its domain only.
fn redacted(email: &str) -> String {
    email
        .split_once('@')
        .map(|(_, domain)| format!("…@{domain}"))
        .unwrap_or_default()
}

#[cfg(test)]
#[path = "email_tests.rs"]
mod tests;

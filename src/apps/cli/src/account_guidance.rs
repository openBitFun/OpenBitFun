//! Actionable account-service failure guidance for the CLI surfaces.
//!
//! The CLI has no i18n, so its copy stays in English. The raw transport detail
//! is never rendered: it stays in `tracing::{warn,debug}`. This module turns
//! one sign-in or account-directory failure into a single user-facing
//! sentence plus an optional second line that is shown only when it adds
//! information.
//!
//! This must stay free of HTTP statuses and exception text: the user only ever
//! reads what they can act on (retry, check the network, or update OpenBitFun).
//! The classification is deliberately conservative: an unrecognized failure
//! stays retryable rather than blamed on the network or on this build.

/// No usable transport at all.
const NETWORK_SENTENCE: &str =
    "Cannot reach the OpenBitFun account service. Check the network connection and retry.";
/// Reachable but momentarily unable to serve.
const SERVICE_UNAVAILABLE_SENTENCE: &str =
    "The OpenBitFun account service is temporarily unavailable. Retry in a moment.";
/// This build is no longer served; only an update can help.
const UPDATE_SENTENCE: &str =
    "This OpenBitFun build is no longer supported by the account service. Update OpenBitFun, then sign in again.";
/// Second line for the update kinds; it restates the one concrete action.
const UPDATE_HINT: &str = "Update OpenBitFun on this device to continue.";
/// Keeps the existing sign-in wording and flow.
const AUTH_SENTENCE: &str = "Sign in to continue.";
/// Deliberately conservative: an unrecognized failure stays retryable.
const UNKNOWN_SENTENCE: &str =
    "The account service rejected the request. Check the network or update OpenBitFun, then retry.";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AccountFailureKind {
    /// No usable transport: offline, DNS, refused connection, TLS.
    Network,
    /// Reachable but temporarily unable to serve: 408/425/429/5xx.
    ServiceUnavailable,
    /// The service retired this build's interface (HTTP 410) or refused it.
    ClientOutdated,
    /// The account session must be established again.
    Auth,
    Unknown,
}

/// Substrings of refusals that mean "this build is too old to be served".
const OUTDATED_MARKERS: &[&str] = &[
    "relay_version_retired",
    "incompatible client build",
    "requires matching client versions",
    "update openbitfun on every device",
];

/// Substrings that mean the account session must be re-established.
const AUTH_MARKERS: &[&str] = &[
    "sign in",
    "unauthorized",
    "invalid or expired token",
    "expired token",
    "http 401",
    "http 403",
];

/// Transport failures with no HTTP status, as reqwest and the socket stacks
/// report them.
const NETWORK_MARKERS: &[&str] = &[
    "network error",
    "network unavailable",
    "connection refused",
    "connection closed",
    "connection reset",
    "connection failed",
    "error sending request",
    "dns",
    "timed out",
    "timeout",
    "certificate",
    "tls",
];

fn classify(message: &str) -> AccountFailureKind {
    let lower = message.to_ascii_lowercase();
    if OUTDATED_MARKERS.iter().any(|marker| lower.contains(marker)) {
        return AccountFailureKind::ClientOutdated;
    }
    let status = http_status(&lower);
    if matches!(status, Some(401 | 403)) || AUTH_MARKERS.iter().any(|m| lower.contains(m)) {
        return AccountFailureKind::Auth;
    }
    match status {
        Some(410) => return AccountFailureKind::ClientOutdated,
        Some(408 | 425 | 429 | 500..=599) => return AccountFailureKind::ServiceUnavailable,
        _ => {}
    }
    if NETWORK_MARKERS.iter().any(|marker| lower.contains(marker)) {
        return AccountFailureKind::Network;
    }
    AccountFailureKind::Unknown
}

/// HTTP status embedded in a message (`"(HTTP 502)"`, `"returned HTTP 502"`).
fn http_status(lower: &str) -> Option<u16> {
    let mut search = lower;
    while let Some(index) = search.find("http ") {
        let rest = &search[index + 5..];
        let digits: String = rest
            .chars()
            .take_while(char::is_ascii_digit)
            .take(3)
            .collect();
        if digits.len() == 3 {
            if let Ok(status) = digits.parse() {
                return Some(status);
            }
        }
        search = rest;
    }
    None
}

/// One user-facing sentence plus an optional hint line, classified from an
/// account failure message.
pub(crate) fn account_failure_guidance(message: &str) -> (&'static str, Option<&'static str>) {
    guidance_for(classify(message))
}

/// The sentence joined with its optional hint as a newline-separated message.
pub(crate) fn account_failure_line(message: &str) -> String {
    match account_failure_guidance(message) {
        (sentence, Some(hint)) => format!("{sentence}\n{hint}"),
        (sentence, None) => sentence.to_string(),
    }
}

fn guidance_for(kind: AccountFailureKind) -> (&'static str, Option<&'static str>) {
    match kind {
        AccountFailureKind::Network => (NETWORK_SENTENCE, None),
        AccountFailureKind::ServiceUnavailable => (SERVICE_UNAVAILABLE_SENTENCE, None),
        AccountFailureKind::ClientOutdated => (UPDATE_SENTENCE, Some(UPDATE_HINT)),
        AccountFailureKind::Auth => (AUTH_SENTENCE, None),
        AccountFailureKind::Unknown => (UNKNOWN_SENTENCE, None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_retired_version_points_at_an_update() {
        for message in [
            "List devices failed: HTTP 410",
            "relay_version_retired: This version has been retired.",
            "incompatible client build: remote control requires matching client versions",
        ] {
            assert_eq!(
                account_failure_guidance(message).0,
                UPDATE_SENTENCE,
                "{message}"
            );
        }
        assert_eq!(
            account_failure_guidance("List devices failed: HTTP 410").1,
            Some(UPDATE_HINT)
        );
    }

    #[test]
    fn a_temporary_service_fault_is_retryable() {
        for status in [429, 502, 503] {
            let message = format!("List devices failed: HTTP {status}");
            assert_eq!(
                account_failure_guidance(&message).0,
                SERVICE_UNAVAILABLE_SENTENCE,
                "{status}"
            );
            assert_eq!(account_failure_guidance(&message).1, None);
        }
    }

    #[test]
    fn transport_failures_are_network() {
        for message in [
            "error sending request: connection refused",
            "Account request timed out",
            "Account connection failed: tls handshake failed",
        ] {
            assert_eq!(
                account_failure_guidance(message).0,
                NETWORK_SENTENCE,
                "{message}"
            );
        }
    }

    #[test]
    fn auth_failures_keep_the_sign_in_sentence() {
        for message in ["Sign in to continue", "List devices failed: HTTP 401"] {
            let guidance = account_failure_guidance(message);
            assert_eq!(guidance.0, AUTH_SENTENCE, "{message}");
            assert_eq!(guidance.1, None, "{message}");
        }
    }

    #[test]
    fn an_unrecognized_failure_stays_retryable() {
        for message in ["List devices failed: HTTP 404", ""] {
            assert_eq!(
                account_failure_guidance(message).0,
                UNKNOWN_SENTENCE,
                "{message}"
            );
        }
    }

    #[test]
    fn the_joined_line_keeps_the_hint_on_its_own_line() {
        let line = account_failure_line("List devices failed: HTTP 410");
        assert_eq!(line, format!("{UPDATE_SENTENCE}\n{UPDATE_HINT}"));
        assert_eq!(
            account_failure_line("error sending request: connection refused"),
            NETWORK_SENTENCE
        );
    }

    #[test]
    fn no_sentence_leaks_a_status_or_exception_text() {
        let kinds = [
            AccountFailureKind::Network,
            AccountFailureKind::ServiceUnavailable,
            AccountFailureKind::ClientOutdated,
            AccountFailureKind::Auth,
            AccountFailureKind::Unknown,
        ];
        for kind in kinds {
            let (sentence, hint) = guidance_for(kind);
            for line in [Some(sentence), hint].into_iter().flatten() {
                assert!(!line.contains("HTTP "), "{line}");
                assert!(
                    !line.chars().any(|character| character.is_ascii_digit()),
                    "{line}"
                );
            }
        }
    }
}

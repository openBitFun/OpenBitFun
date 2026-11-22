//! Account identity projections shared by product surfaces.

use serde::{Deserialize, Serialize};

/// Hosted Relay service version announced by the official endpoint.
///
/// This is the *service* release the client targets, not the product build
/// version. Keep it in sync with `relay-service/Cargo.toml`.
pub const RELAY_SERVICE_VERSION: &str = "1.0.10";

/// Endpoint paths served by the same deployed Relay and the same account
/// database. `?v=` replaced the path segment as the client-facing version, but
/// `/v/1.0.2` must keep working for builds that predate the change: a token,
/// master key, or device registration from either path is interchangeable
/// because both reach one process and one SQLite file.
pub const LIVE_RELAY_ENDPOINT_PATHS: &[&str] = &["/relay", "/v/1.0.2"];

/// Hosted Relay deployment for the GitHub account/device-key protocol.
///
/// The version travels as a GET parameter so a release no longer needs a new
/// proxy location, while `remote.openbitfun.com` keeps one root page. Callers
/// must join API paths onto [`relay_endpoint_base`], never onto this string.
///
/// OpenBitFun 2.0 uses only its own service host: this is the same base as
/// [`DEFAULT_ACCOUNT_DIRECTORY_URL`] (and must stay byte-equal to it, so the
/// device key scoped by this URL is the key the directory session
/// registers). `remote.openbitfun.com` serves released 1.0 clients only.
pub const DEFAULT_RELAY_URL: &str = "https://super.openbitfun.com/directory";

/// The new version's account directory: device rows and X25519 keys of the
/// account's devices, the device network's pair keys, and the cloud node's
/// row. A relay-service instance of OpenBitFun 2.0 with its own database
/// (never the 1.0 relay on `remote.openbitfun.com`). Hosts resolve an override (`OPENBITFUN_ACCOUNT_DIRECTORY_URL`) at
/// the services layer and join API paths onto this base.
pub const DEFAULT_ACCOUNT_DIRECTORY_URL: &str = "https://super.openbitfun.com/directory";

/// The new version's service host: the mesh issuer (`/mesh/v1/*`), the
/// Link relay node (`/mesh/et/`), the browser gateway, the web UI and the
/// cloud node (`/agent/`).
pub const DEFAULT_SERVICE_ORIGIN: &str = "https://super.openbitfun.com";

/// Strip the version query and any fragment so the endpoint can be joined with
/// an API path. A trailing slash is removed so `{base}/api/...` stays correct.
pub fn relay_endpoint_base(endpoint: &str) -> &str {
    let endpoint = endpoint.trim();
    let end = endpoint.find(['?', '#']).unwrap_or(endpoint.len());
    endpoint[..end].trim_end_matches('/')
}

/// Service version announced by the endpoint's `?v=` parameter, if any.
///
/// Only the first `v` parameter of the query is considered. Callers still
/// validate the value; this helper only extracts it.
pub fn relay_endpoint_version(endpoint: &str) -> Option<&str> {
    let query = endpoint.split_once('?')?.1;
    let query = query.split('#').next().unwrap_or(query);
    query
        .split('&')
        .find_map(|pair| pair.strip_prefix("v="))
        .filter(|value| !value.is_empty())
}

fn endpoint_authority(endpoint: &str) -> Option<(&str, &str)> {
    let (scheme, rest) = endpoint.split_once("://")?;
    if !matches!(scheme, "http" | "https") {
        return None;
    }
    let authority_end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let authority = &rest[..authority_end];
    if authority.is_empty() || authority.contains('@') {
        return None;
    }
    Some((scheme, authority))
}

/// Path portion of an endpoint, without query, fragment, or trailing slash.
fn endpoint_path(endpoint: &str) -> &str {
    let Some((_, rest)) = endpoint.trim().split_once("://") else {
        return "";
    };
    let rest = match rest.find(['?', '#']) {
        Some(end) => &rest[..end],
        None => rest,
    };
    match rest.find('/') {
        Some(index) => rest[index..].trim_end_matches('/'),
        None => "",
    }
}

/// Whether two endpoints resolve to the same deployed Relay.
///
/// Both live aliases of the same host count as one deployment, so a build that
/// switches from `/v/1.0.2` to `/relay?v=` keeps its stored credential and
/// master key. A different host, or a different `/v/<version>` path, does not.
pub fn same_relay_deployment(left: &str, right: &str) -> bool {
    let (Some((left_scheme, left_authority)), Some((right_scheme, right_authority))) =
        (endpoint_authority(left), endpoint_authority(right))
    else {
        return false;
    };
    if left_scheme != right_scheme || !left_authority.eq_ignore_ascii_case(right_authority) {
        return false;
    }
    let (left_path, right_path) = (endpoint_path(left), endpoint_path(right));
    left_path == right_path
        || (LIVE_RELAY_ENDPOINT_PATHS.contains(&left_path)
            && LIVE_RELAY_ENDPOINT_PATHS.contains(&right_path))
}

/// User-facing page URL for an endpoint, keeping `?v=` before the fragment so
/// the version survives in the address bar and in shared links.
pub fn relay_page_url(endpoint: &str, fragment: &str) -> String {
    let base = relay_endpoint_base(endpoint);
    match relay_endpoint_version(endpoint) {
        Some(version) => format!("{base}/?v={version}{fragment}"),
        None => format!("{base}/{fragment}"),
    }
}

/// Control-contract protocol number reported to the Relay alongside the build
/// string when a device registers or opens its realtime connection.
///
/// Two devices are mutually controllable only when BOTH report a number AND the
/// numbers are equal: `(Some(a), Some(b)) && a == b`. A device that has never
/// reported a protocol number is therefore incompatible, never
/// "legacy-compatible", and so is any pair whose numbers differ.
///
/// Compatibility is decided solely by the Relay from the two stored numbers:
/// clients read the Relay-computed `compatible` flag on the device directory
/// instead of re-deriving this rule locally.
///
/// Semantics:
///
/// - unreported: a build that never sent a protocol number (incompatible);
/// - this build: `2`;
/// - increment only on a breaking change to the client control contract.
pub const CLIENT_PROTOCOL_VERSION: u32 = 2;

/// The product build string reported to the Relay for diagnostics next to
/// [`CLIENT_PROTOCOL_VERSION`].
///
/// Every workspace member inherits `version.workspace = true`, so this
/// compile-time value is the single product version actually shipped to users.
/// Keeping it beside the protocol number lets the shared account/relay owners
/// report it without threading a host parameter through every call site, and
/// without a lower crate importing an upper crate's version.
pub fn client_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountInfo {
    pub user_id: String,
    pub relay_url: String,
    pub device_id: String,
    pub device_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountDevice {
    pub device_id: String,
    pub device_name: String,
    /// Kind the device reported to the Relay (`desktop`, `cli`, `mobile`,
    /// `watch`). Absent for a device that never reported one and for Relays that
    /// predate the field: absent stays "unknown", which is not "not a host".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub device_kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub device_alias: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub device_model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub device_os: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub device_os_version: Option<String>,
    /// Build string the device last reported to the Relay. Absent for legacy
    /// devices and for Relays that predate the field.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub device_client_version: Option<String>,
    /// Control-contract protocol number the device last reported. Absent for
    /// legacy devices and for Relays that predate the field.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub device_client_protocol: Option<u32>,
    /// Relay-computed compatibility with this client's control contract.
    /// `None` means unknown (an older Relay without the field) and must be
    /// treated as compatible rather than incompatible.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub compatible: Option<bool>,
    pub online: bool,
}

impl AccountDevice {
    /// Whether the Relay considers this device compatible with our control
    /// contract.
    ///
    /// A `Some(false)` answer means the pair must not be remote-controlled:
    /// this is what the Relay computes for a device that never reported a
    /// [`CLIENT_PROTOCOL_VERSION`], or one whose number differs from ours. A
    /// missing flag (`None`) means an older Relay that predates the gating field
    /// and cannot judge at all, so it is unknown and treated as compatible.
    ///
    /// Keep these two cases distinct: "device lacks a version" is judged
    /// incompatible by the Relay (`Some(false)`); "old Relay cannot judge" is
    /// `None`. Do not widen the fallback to cover a device that simply has no
    /// version.
    pub fn is_compatible(&self) -> bool {
        self.compatible.unwrap_or(true)
    }

    pub fn display_name(&self) -> &str {
        self.device_alias.as_deref().unwrap_or_else(|| {
            if self.device_name.is_empty() {
                &self.device_id
            } else {
                &self.device_name
            }
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountSnapshotProjection {
    pub logged_in: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub info: Option<AccountInfo>,
    #[serde(default)]
    pub devices: Vec<AccountDevice>,
    /// Who is signed in, as every surface shows it. Absent in snapshots
    /// written before the field and when the identity service is unreachable.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub identity: Option<AccountIdentityView>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountLoginProjection {
    pub user_id: String,
    pub relay_url: String,
    pub status_message: String,
    /// [`AccountIdentityView::display_name`] of the account that signed in.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
}

/// How an account signs in to the identity service.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AccountProvider {
    /// A verified email address (the in-app email code).
    Email,
    /// A GitHub account (OAuth in the browser).
    Github,
}

/// The signed-in account as every surface shows it: the sidebar row and its
/// avatar, Settings › Account, the account dialog, the phone, the browser and
/// the CLI. The backend builds it from the identity service's profile; a
/// surface renders these fields and never looks at the provider's handles.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountIdentityView {
    pub provider: AccountProvider,
    /// The stable account id the device directory and the issuer key by
    /// ([`GitHubUser::identity_id`]). Never shown.
    pub account_id: String,
    /// The email for email accounts, the GitHub login for GitHub accounts.
    pub display_name: String,
    /// One uppercase character for the avatar.
    pub initial: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
}

/// Whether an account id names an email account (`email-<n>`), the one rule
/// [`GitHubUser::identity_id`] and [`AccountIdentityView`] share.
pub fn is_email_account_id(account_id: &str) -> bool {
    account_id.starts_with("email-")
        && account_id.len() <= 64
        && account_id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-')
}

impl AccountIdentityView {
    /// The projection of an account id and what the identity service said
    /// about it: an email account shows its verified email, a GitHub account
    /// its login. `None` when the name to show is missing (an email account
    /// whose address was not reported), so no internal handle is ever shown.
    pub fn from_parts(
        account_id: &str,
        email: Option<&str>,
        login: Option<&str>,
        avatar_url: Option<&str>,
    ) -> Option<Self> {
        let account_id = account_id.trim();
        if account_id.is_empty() {
            return None;
        }
        let clean = |value: Option<&str>| {
            value
                .map(str::trim)
                .filter(|value| !value.is_empty() && !value.chars().any(char::is_control))
                .map(str::to_string)
        };
        let (provider, display_name) = if is_email_account_id(account_id) {
            (AccountProvider::Email, clean(email)?)
        } else {
            (AccountProvider::Github, clean(login)?)
        };
        let initial = display_name
            .chars()
            .find(|c| c.is_alphanumeric())
            .or_else(|| display_name.chars().next())
            .map(|c| c.to_uppercase().collect::<String>())
            .unwrap_or_default();
        Some(Self {
            provider,
            account_id: account_id.to_string(),
            display_name,
            initial,
            avatar_url: clean(avatar_url).filter(|url| url.starts_with("https://")),
        })
    }

    /// The projection of the identity service's `/me` profile.
    pub fn from_profile(user: &GitHubUser, email: Option<&str>) -> Option<Self> {
        Self::from_parts(
            &user.identity_id()?,
            email,
            Some(&user.login),
            Some(&user.avatar_url),
        )
    }
}

/// How many digits the identity service's email code has.
pub const EMAIL_SIGN_IN_CODE_LENGTH: u32 = 8;

/// Sends a sign-in code to an email address (`account_email_start`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountEmailStartRequest {
    pub email: String,
    /// The email's language (`en-US`, `zh-CN`, ...); the service default when absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub locale: Option<String>,
}

/// A code the identity service sent. The sign-in transaction's secret and
/// ticket stay in the host; the surface hands `challenge_id` back unchanged.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountEmailChallenge {
    pub challenge_id: String,
    /// The address the code went to, as the service normalized it.
    pub email: String,
    pub code_length: u32,
    /// Seconds before another code may be requested.
    pub retry_after_seconds: u32,
    /// When the pending sign-in expires (epoch milliseconds), when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<i64>,
}

/// Completes an email sign-in with the code (`account_email_verify`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountEmailVerifyRequest {
    pub challenge_id: String,
    pub code: String,
}

/// The account an email sign-in completed.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountEmailVerifyResponse {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub identity: Option<AccountIdentityView>,
}

/// The sign-in ticket of a device sign-in's page address
/// (`…/sign-in#ticket=<ticket>`): what the email code endpoints take.
pub fn email_sign_in_ticket(authorization_url: &str) -> Option<String> {
    let fragment = authorization_url.split_once('#')?.1;
    fragment
        .split('&')
        .filter_map(|pair| pair.split_once('='))
        .find(|(name, _)| *name == "ticket")
        .map(|(_, value)| value.to_string())
        .filter(|ticket| {
            !ticket.is_empty()
                && ticket.len() <= 256
                && ticket
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
        })
}

/// The stable code of a refused email sign-in step, from the identity
/// service's error code and, when known, the HTTP status (`0`: unknown):
/// `invalid_email`, `invalid_code`, `rate_limited`, `signed_out`,
/// `unsupported` or `unavailable`. Every surface words these codes itself.
pub fn email_sign_in_refusal_code(status: u16, service_code: &str) -> &'static str {
    match service_code {
        "invalid_email" => return "invalid_email",
        "invalid_email_code" | "login_flow_expired" | "desktop_auth_expired" => {
            return "invalid_code"
        }
        "email_rate_limit" | "auth_capacity" => return "rate_limited",
        "email_not_configured" => return "unsupported",
        _ => {}
    }
    match status {
        401 | 403 => "signed_out",
        404 | 405 | 501 => "unsupported",
        429 => "rate_limited",
        _ => "unavailable",
    }
}

/// Verified GitHub profile for the global GitHub account.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubUser {
    /// Provider-independent identity; absent in legacy GitHub payloads.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account_id: Option<String>,
    pub github_id: i64,
    pub login: String,
    pub avatar_url: String,
}

/// Public authorization progress. The transaction secret stays in its host.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubAuthStart {
    pub transaction_id: String,
    pub authorization_url: String,
    pub expires_at: i64,
    pub poll_interval_seconds: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubAuthPollRequest {
    pub transaction_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubAuthPollResponse {
    pub status: String,
}

impl GitHubUser {
    pub fn identity_id(&self) -> Option<String> {
        if self.github_id > 0 {
            return Some(self.github_id.to_string());
        }
        self.account_id
            .as_ref()
            .filter(|id| is_email_account_id(id))
            .cloned()
    }
}

#[cfg(test)]
mod identity_tests {
    use super::*;
    #[test]
    fn device_directory_legacy_round_trip_preserves_technical_name() {
        let legacy = serde_json::json!({"deviceId":"id", "deviceName":"technical", "online":true});
        let mut device: AccountDevice = serde_json::from_value(legacy.clone()).unwrap();
        assert_eq!(serde_json::to_value(&device).unwrap(), legacy);
        device.device_alias = Some("My laptop".into());
        device.device_model = Some("Mac14,7".into());
        device.device_os = Some("macos".into());
        device.device_os_version = Some("15.0".into());
        let round_trip: AccountDevice =
            serde_json::from_value(serde_json::to_value(&device).unwrap()).unwrap();
        assert_eq!(device, round_trip);
        assert_eq!(round_trip.display_name(), "My laptop");
        assert_eq!(round_trip.device_name, "technical");
        device.device_alias = None;
        assert_eq!(device.display_name(), "technical");
        device.device_name.clear();
        assert_eq!(device.display_name(), "id");
    }

    #[test]
    fn device_directory_client_compatibility_preserves_legacy_shape() {
        // A legacy payload without the new fields round-trips unchanged and is
        // treated as compatible, so an older Relay is never misjudged.
        let legacy = serde_json::json!({"deviceId":"id", "deviceName":"technical", "online":true});
        let device: AccountDevice = serde_json::from_value(legacy.clone()).unwrap();
        assert!(device.compatible.is_none());
        assert!(device.is_compatible());
        assert!(device.device_client_version.is_none());
        assert!(device.device_client_protocol.is_none());
        assert_eq!(serde_json::to_value(&device).unwrap(), legacy);

        // A device that never reported a version is judged incompatible by the
        // Relay: `compatible` is present and false.
        let unversioned: AccountDevice = serde_json::from_value(serde_json::json!({
            "deviceId":"id", "deviceName":"technical", "online":true, "compatible":false
        }))
        .unwrap();
        assert!(unversioned.device_client_protocol.is_none());
        assert!(!unversioned.is_compatible());

        // A Relay that reports a mismatched build carries the values through.
        let reported: AccountDevice = serde_json::from_value(serde_json::json!({
            "deviceId":"id", "deviceName":"technical", "online":true,
            "deviceClientVersion":"0.9.0", "deviceClientProtocol":1, "compatible":false
        }))
        .unwrap();
        assert_eq!(reported.device_client_version.as_deref(), Some("0.9.0"));
        assert_eq!(reported.device_client_protocol, Some(1));
        assert!(!reported.is_compatible());
        let round_trip: AccountDevice =
            serde_json::from_value(serde_json::to_value(&reported).unwrap()).unwrap();
        assert_eq!(reported, round_trip);
    }

    #[test]
    fn legacy_profile_round_trip_and_independent_email_identity() {
        let legacy = r#"{"githubId":42,"login":"alice","avatarUrl":""}"#;
        let user: GitHubUser = serde_json::from_str(legacy).unwrap();
        assert_eq!(user.identity_id().as_deref(), Some("42"));
        assert_eq!(
            serde_json::to_value(&user).unwrap(),
            serde_json::from_str::<serde_json::Value>(legacy).unwrap()
        );
        let email: GitHubUser = serde_json::from_str(
            r#"{"accountId":"email-7","githubId":0,"login":"user-7","avatarUrl":""}"#,
        )
        .unwrap();
        assert_eq!(email.identity_id().as_deref(), Some("email-7"));
        let invalid: GitHubUser = serde_json::from_str(
            r#"{"accountId":"42","githubId":0,"login":"user","avatarUrl":""}"#,
        )
        .unwrap();
        assert!(invalid.identity_id().is_none());
    }
}

#[cfg(test)]
mod identity_view_tests {
    use super::*;

    #[test]
    fn email_accounts_show_their_email_and_never_the_internal_login() {
        let user: GitHubUser = serde_json::from_str(
            r#"{"accountId":"email-7","githubId":0,"login":"user-87b544d554494ceaa50e23d89550a954","avatarUrl":""}"#,
        )
        .unwrap();
        let view = AccountIdentityView::from_profile(&user, Some(" alice@example.com ")).unwrap();
        assert_eq!(view.provider, AccountProvider::Email);
        assert_eq!(view.account_id, "email-7");
        assert_eq!(view.display_name, "alice@example.com");
        assert_eq!(view.initial, "A");
        assert_eq!(view.avatar_url, None);
        // No address reported: nothing to show rather than the handle.
        assert!(AccountIdentityView::from_profile(&user, None).is_none());
        let wire = serde_json::to_value(&view).unwrap();
        assert_eq!(wire["provider"], "email");
        assert_eq!(wire["displayName"], "alice@example.com");
        assert!(!wire.to_string().contains("user-87b5"));
    }

    #[test]
    fn github_accounts_show_their_login_and_keep_the_numeric_id() {
        let user: GitHubUser = serde_json::from_str(
            r#"{"githubId":42,"login":"octocat","avatarUrl":"https://avatars.example/42"}"#,
        )
        .unwrap();
        let view = AccountIdentityView::from_profile(&user, Some("octo@example.com")).unwrap();
        assert_eq!(view.provider, AccountProvider::Github);
        assert_eq!(view.account_id, "42");
        assert_eq!(view.display_name, "octocat");
        assert_eq!(view.initial, "O");
        assert_eq!(
            view.avatar_url.as_deref(),
            Some("https://avatars.example/42")
        );
        let insecure = AccountIdentityView::from_parts("42", None, Some("x"), Some("http://a/b"));
        assert_eq!(insecure.unwrap().avatar_url, None);
    }

    #[test]
    fn the_projection_round_trips_and_snapshots_without_it_still_read() {
        let view =
            AccountIdentityView::from_parts("email-1", Some("b@example.com"), None, None).unwrap();
        let back: AccountIdentityView =
            serde_json::from_value(serde_json::to_value(&view).unwrap()).unwrap();
        assert_eq!(view, back);

        let legacy = serde_json::json!({
            "loggedIn": true,
            "info": {"userId":"email-1","relayUrl":"https://r","deviceId":"d","deviceName":"Mac"},
            "devices": []
        });
        let snapshot: AccountSnapshotProjection = serde_json::from_value(legacy.clone()).unwrap();
        assert!(snapshot.identity.is_none());
        assert_eq!(serde_json::to_value(&snapshot).unwrap(), legacy);
        let login_legacy =
            serde_json::json!({"userId":"42","relayUrl":"https://r","statusMessage":"ok"});
        let login: AccountLoginProjection = serde_json::from_value(login_legacy.clone()).unwrap();
        assert!(login.display_name.is_none());
        assert_eq!(serde_json::to_value(&login).unwrap(), login_legacy);
    }

    #[test]
    fn email_sign_in_helpers_read_the_ticket_and_word_refusals_by_code() {
        assert_eq!(
            email_sign_in_ticket("https://auth.example/sign-in#ticket=abc_DEF-1.2").as_deref(),
            Some("abc_DEF-1.2")
        );
        assert_eq!(
            email_sign_in_ticket("https://auth.example/sign-in#x=1&ticket=t2").as_deref(),
            Some("t2")
        );
        assert_eq!(
            email_sign_in_ticket("https://github.com/login/oauth/authorize?state=1"),
            None
        );
        assert_eq!(
            email_sign_in_ticket("https://auth.example/sign-in#ticket="),
            None
        );
        assert_eq!(
            email_sign_in_ticket("https://auth.example/sign-in#ticket=a b"),
            None
        );
        assert_eq!(
            email_sign_in_refusal_code(400, "invalid_email"),
            "invalid_email"
        );
        assert_eq!(
            email_sign_in_refusal_code(400, "invalid_email_code"),
            "invalid_code"
        );
        assert_eq!(
            email_sign_in_refusal_code(400, "login_flow_expired"),
            "invalid_code"
        );
        assert_eq!(
            email_sign_in_refusal_code(429, "email_rate_limit"),
            "rate_limited"
        );
        assert_eq!(
            email_sign_in_refusal_code(503, "email_not_configured"),
            "unsupported"
        );
        assert_eq!(email_sign_in_refusal_code(401, ""), "signed_out");
        assert_eq!(
            email_sign_in_refusal_code(0, "market_request_failed"),
            "unavailable"
        );
        let challenge: AccountEmailChallenge = serde_json::from_value(serde_json::json!({
            "challengeId":"c","email":"a@b.c","codeLength":8,"retryAfterSeconds":60
        }))
        .unwrap();
        assert_eq!(challenge.expires_at, None);
    }
}

#[cfg(test)]
mod relay_endpoint_tests {
    use super::*;

    #[test]
    fn the_2_0_relay_and_directory_bases_are_one_endpoint_on_the_new_host() {
        assert_eq!(DEFAULT_RELAY_URL, DEFAULT_ACCOUNT_DIRECTORY_URL);
        assert!(DEFAULT_ACCOUNT_DIRECTORY_URL.starts_with(DEFAULT_SERVICE_ORIGIN));
        assert!(!DEFAULT_RELAY_URL.contains("remote.openbitfun.com"));
    }

    #[test]
    fn base_strips_version_query_and_fragment() {
        assert_eq!(
            relay_endpoint_base("https://remote.openbitfun.com/relay?v=1.0.9"),
            "https://remote.openbitfun.com/relay"
        );
        assert_eq!(
            relay_endpoint_base("https://remote.openbitfun.com/relay/?v=1.0.9"),
            "https://remote.openbitfun.com/relay"
        );
        assert_eq!(
            relay_endpoint_base("https://remote.openbitfun.com/v/1.0.2/"),
            "https://remote.openbitfun.com/v/1.0.2"
        );
        assert_eq!(
            relay_endpoint_base("https://relay.example.com/prefix#/pair"),
            "https://relay.example.com/prefix"
        );
    }

    #[test]
    fn version_is_read_from_the_query_only() {
        assert_eq!(
            relay_endpoint_version("https://remote.openbitfun.com/relay?v=1.0.9"),
            Some("1.0.9")
        );
        assert_eq!(
            relay_endpoint_version("https://remote.openbitfun.com/relay?v=1.0.9#/pair?did=x"),
            Some("1.0.9")
        );
        assert_eq!(
            relay_endpoint_version("https://remote.openbitfun.com/v/1.0.2"),
            None
        );
    }

    #[test]
    fn live_aliases_share_one_deployment_but_other_releases_do_not() {
        assert!(same_relay_deployment(
            "https://remote.openbitfun.com/relay?v=1.0.9",
            "https://remote.openbitfun.com/v/1.0.2",
        ));
        assert!(same_relay_deployment(
            "https://remote.openbitfun.com/relay",
            "https://remote.openbitfun.com/relay/",
        ));
        assert!(!same_relay_deployment(
            "https://remote.openbitfun.com/v/1.0.1",
            "https://remote.openbitfun.com/relay",
        ));
        assert!(!same_relay_deployment(
            "https://other.example.com/relay",
            "https://remote.openbitfun.com/relay",
        ));
        assert!(!same_relay_deployment(
            "http://remote.openbitfun.com/relay",
            "https://remote.openbitfun.com/relay",
        ));
    }

    #[test]
    fn page_url_keeps_version_before_the_fragment() {
        assert_eq!(
            relay_page_url(
                "https://remote.openbitfun.com/relay?v=1.0.9",
                "#/pair?did=abc"
            ),
            "https://remote.openbitfun.com/relay/?v=1.0.9#/pair?did=abc"
        );
        assert_eq!(
            relay_page_url("https://remote.openbitfun.com/v/1.0.2", "#/pair?did=abc"),
            "https://remote.openbitfun.com/v/1.0.2/#/pair?did=abc"
        );
    }
}

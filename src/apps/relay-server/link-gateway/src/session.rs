//! The browser's gateway session: a sealed, HttpOnly cookie.
//!
//! The gateway keeps no session store. After a verified sign-in it seals the
//! account id, the browser's device id and the browser's device credential in
//! the directory (the relay token) with AES-256-GCM under a key derived from
//! the issuer key, so a gateway restart keeps everyone signed in and nobody
//! can forge or read a session. Every device list and every pipe re-checks
//! the relay token against the directory, so a sign-out (token revoked) or a
//! device removed from the account ends the session there.

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::Engine;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;

/// Cookie name (host-only, `Path=/obp`).
pub(crate) const COOKIE_NAME: &str = "obf_gw";
/// How long a session lasts without a new sign-in.
pub(crate) const SESSION_SECONDS: i64 = 30 * 24 * 60 * 60;

const KEY_DOMAIN: &[u8] = b"OpenBitFun OBP gateway session v1";
const VERSION: u8 = 1;

fn b64() -> base64::engine::GeneralPurpose {
    base64::engine::general_purpose::URL_SAFE_NO_PAD
}

/// What one signed-in browser holds.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct Session {
    /// Account id (the directory's `user_id`, the issuer's account).
    #[serde(rename = "a")]
    pub(crate) account_id: String,
    /// The browser's device id in the account directory.
    #[serde(rename = "d")]
    pub(crate) device_id: String,
    /// The browser's directory credential (device-scoped relay token).
    #[serde(rename = "t")]
    pub(crate) directory_token: String,
    #[serde(rename = "m", default, skip_serializing_if = "Option::is_none")]
    pub(crate) email: Option<String>,
    #[serde(rename = "i")]
    pub(crate) issued_at: i64,
    #[serde(rename = "x")]
    pub(crate) expires_at: i64,
}

/// Seals and opens sessions.
#[derive(Clone)]
pub(crate) struct SessionSealer {
    cipher: Aes256Gcm,
}

impl SessionSealer {
    /// The sealer of a gateway holding `issuer_key`.
    pub(crate) fn from_issuer_key(issuer_key: &[u8; 32]) -> Self {
        let mut mac =
            <Hmac<Sha256> as Mac>::new_from_slice(issuer_key).expect("HMAC accepts any key length");
        mac.update(KEY_DOMAIN);
        let key = mac.finalize().into_bytes();
        Self {
            cipher: Aes256Gcm::new_from_slice(&key).expect("32-byte key"),
        }
    }

    /// The cookie value for `session`.
    pub(crate) fn seal(&self, session: &Session) -> String {
        let plaintext = serde_json::to_vec(session).expect("session serializes");
        let mut nonce = [0u8; 12];
        rand::RngCore::fill_bytes(&mut rand::rngs::OsRng, &mut nonce);
        let sealed = self
            .cipher
            .encrypt(Nonce::from_slice(&nonce), plaintext.as_slice())
            .expect("AES-GCM encryption");
        let mut out = Vec::with_capacity(1 + nonce.len() + sealed.len());
        out.push(VERSION);
        out.extend_from_slice(&nonce);
        out.extend_from_slice(&sealed);
        b64().encode(out)
    }

    /// The session in `value`, if it is authentic and not expired at `now`.
    pub(crate) fn open(&self, value: &str, now: i64) -> Option<Session> {
        let bytes = b64().decode(value.trim()).ok()?;
        if bytes.len() < 1 + 12 + 16 || bytes[0] != VERSION {
            return None;
        }
        let plaintext = self
            .cipher
            .decrypt(Nonce::from_slice(&bytes[1..13]), &bytes[13..])
            .ok()?;
        let session: Session = serde_json::from_slice(&plaintext).ok()?;
        (session.expires_at > now).then_some(session)
    }
}

/// The value of the session cookie in a `Cookie` header.
pub(crate) fn cookie_value(header: &str) -> Option<&str> {
    header
        .split(';')
        .map(str::trim)
        .filter_map(|pair| pair.split_once('='))
        .find(|(name, _)| *name == COOKIE_NAME)
        .map(|(_, value)| value)
}

/// `Set-Cookie` for a new session.
pub(crate) fn set_cookie(value: &str, secure: bool) -> String {
    format!(
        "{COOKIE_NAME}={value}; Path=/obp; Max-Age={SESSION_SECONDS}; HttpOnly; SameSite=Strict{}",
        if secure { "; Secure" } else { "" }
    )
}

/// `Set-Cookie` that ends the session.
pub(crate) fn clear_cookie(secure: bool) -> String {
    format!(
        "{COOKIE_NAME}=; Path=/obp; Max-Age=0; HttpOnly; SameSite=Strict{}",
        if secure { "; Secure" } else { "" }
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session(expires_at: i64) -> Session {
        Session {
            account_id: "email-42".into(),
            device_id: "web-1".into(),
            directory_token: "relay-token".into(),
            email: Some("a@example.com".into()),
            issued_at: 1,
            expires_at,
        }
    }

    #[test]
    fn sessions_open_only_under_their_key_unchanged_and_unexpired() {
        let sealer = SessionSealer::from_issuer_key(&[7; 32]);
        let value = sealer.seal(&session(100));
        assert_eq!(sealer.open(&value, 50), Some(session(100)));
        // Expired.
        assert_eq!(sealer.open(&value, 100), None);
        // Another gateway key.
        assert_eq!(
            SessionSealer::from_issuer_key(&[8; 32]).open(&value, 50),
            None
        );
        // Any flipped byte.
        let mut bytes = b64().decode(&value).unwrap();
        let last = bytes.len() - 1;
        bytes[last] ^= 1;
        assert_eq!(sealer.open(&b64().encode(bytes), 50), None);
        // The token never appears in the cookie.
        assert!(!value.contains("relay-token"));
        assert_eq!(sealer.open("garbage", 50), None);
    }

    #[test]
    fn cookies_are_read_by_name_and_scoped() {
        assert_eq!(cookie_value("a=1; obf_gw=xyz; b=2"), Some("xyz"));
        assert_eq!(cookie_value("obf_gwx=1"), None);
        let set = set_cookie("v", true);
        assert!(set.contains("HttpOnly") && set.contains("Secure") && set.contains("Path=/obp"));
        assert!(set.contains("SameSite=Strict"));
        assert!(clear_cookie(false).contains("Max-Age=0"));
    }
}

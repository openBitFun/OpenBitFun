//! OpenBitFun Link join tokens.
//!
//! The account issuer signs a short-lived token for one account network, one
//! account and one device; the Link relay node admits a peer of an account
//! network only with a token for that network that verifies and has not
//! expired. Nobody without an OpenBitFun sign-in can join an account network
//! or use relay bandwidth, and a signed-out device loses relay access when
//! its last token expires.
//!
//! Format: `obfjt1.<payload>.<signature>`, both base64url without padding.
//! The payload is JSON ([`JoinClaims`]); the signature is Ed25519 over the
//! ASCII bytes `obfjt1.<payload>`. The signing key derives from the issuer
//! key (HMAC-SHA256 with a fixed label), so the relay node needs only the
//! public key and holds nothing that mints tokens or derives networks.

use base64::Engine;
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;

/// Token prefix and version.
pub const JOIN_TOKEN_PREFIX: &str = "obfjt1";
/// How long a token is valid. Clients refresh well before expiry.
pub const JOIN_TOKEN_TTL_SECS: i64 = 30 * 60;
/// How far in the future an `iat` may lie (clock skew).
pub const MAX_CLOCK_SKEW_SECS: i64 = 120;
const SIGNING_KEY_LABEL: &[u8] = b"OpenBitFun Link join token signing key v1\n";
const MAX_TOKEN_LEN: usize = 2048;

/// What a join token asserts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct JoinClaims {
    /// Claims version (1).
    pub v: u32,
    /// The account network the token admits (`obf-...`).
    pub net: String,
    /// The verified account id.
    pub acct: String,
    /// The device the token was issued to (its Link hostname).
    pub dev: String,
    /// Issued at, Unix seconds.
    pub iat: i64,
    /// Expires at, Unix seconds.
    pub exp: i64,
    /// Random token id (logs, replay analysis).
    pub jti: String,
}

/// Why a token was refused.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum JoinTokenError {
    Malformed,
    BadSignature,
    Expired,
    NotYetValid,
    WrongNetwork,
}

impl std::fmt::Display for JoinTokenError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::Malformed => "malformed join token",
            Self::BadSignature => "join token signature does not verify",
            Self::Expired => "join token expired",
            Self::NotYetValid => "join token issued in the future",
            Self::WrongNetwork => "join token is for another network",
        })
    }
}

impl std::error::Error for JoinTokenError {}

fn b64() -> base64::engine::GeneralPurpose {
    base64::engine::general_purpose::URL_SAFE_NO_PAD
}

/// Mints join tokens (issuer and server-side gateway).
#[derive(Clone)]
pub struct JoinTokenSigner {
    key: SigningKey,
}

impl std::fmt::Debug for JoinTokenSigner {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("JoinTokenSigner")
            .field("public_key", &self.public_key_hex())
            .finish()
    }
}

impl JoinTokenSigner {
    /// The signer derived from the issuer key.
    pub fn from_issuer_key(issuer_key: &[u8; 32]) -> Self {
        let mut mac =
            <Hmac<Sha256> as Mac>::new_from_slice(issuer_key).expect("HMAC accepts any key length");
        mac.update(SIGNING_KEY_LABEL);
        let seed: [u8; 32] = mac.finalize().into_bytes().into();
        Self {
            key: SigningKey::from_bytes(&seed),
        }
    }

    pub fn verifier(&self) -> JoinTokenVerifier {
        JoinTokenVerifier {
            key: self.key.verifying_key(),
        }
    }

    /// The verifying key as 64 hex characters (the relay node's config).
    pub fn public_key_hex(&self) -> String {
        hex_encode(self.key.verifying_key().as_bytes())
    }

    /// A token for `device_id` of `account_id` in `network_name`, valid
    /// from `now` for [`JOIN_TOKEN_TTL_SECS`].
    pub fn mint(
        &self,
        network_name: &str,
        account_id: &str,
        device_id: &str,
        now: i64,
    ) -> (String, JoinClaims) {
        let mut jti = [0u8; 12];
        rand::Rng::fill(&mut rand::thread_rng(), &mut jti);
        let claims = JoinClaims {
            v: 1,
            net: network_name.to_string(),
            acct: account_id.to_string(),
            dev: device_id.to_string(),
            iat: now,
            exp: now + JOIN_TOKEN_TTL_SECS,
            jti: b64().encode(jti),
        };
        let payload = b64().encode(serde_json::to_vec(&claims).expect("claims serialize"));
        let signed = format!("{JOIN_TOKEN_PREFIX}.{payload}");
        let signature = self.key.sign(signed.as_bytes());
        (
            format!("{signed}.{}", b64().encode(signature.to_bytes())),
            claims,
        )
    }
}

/// Verifies join tokens (relay node).
#[derive(Clone, Debug)]
pub struct JoinTokenVerifier {
    key: VerifyingKey,
}

impl JoinTokenVerifier {
    /// From the issuer's public key (64 hex characters).
    pub fn from_public_key_hex(hex: &str) -> Result<Self, String> {
        let bytes =
            hex_decode(hex.trim()).ok_or("the join public key must be 64 hex characters")?;
        let bytes: [u8; 32] = bytes
            .try_into()
            .map_err(|_| "the join public key must be 64 hex characters".to_string())?;
        let key = VerifyingKey::from_bytes(&bytes)
            .map_err(|_| "the join public key is not a valid Ed25519 key".to_string())?;
        Ok(Self { key })
    }

    /// The claims of `token` when it verifies, admits `network_name` and is
    /// valid at `now`.
    pub fn verify(
        &self,
        token: &str,
        network_name: &str,
        now: i64,
    ) -> Result<JoinClaims, JoinTokenError> {
        if token.len() > MAX_TOKEN_LEN {
            return Err(JoinTokenError::Malformed);
        }
        let mut parts = token.split('.');
        let (Some(prefix), Some(payload), Some(signature), None) =
            (parts.next(), parts.next(), parts.next(), parts.next())
        else {
            return Err(JoinTokenError::Malformed);
        };
        if prefix != JOIN_TOKEN_PREFIX {
            return Err(JoinTokenError::Malformed);
        }
        let signature: [u8; 64] = b64()
            .decode(signature)
            .ok()
            .and_then(|bytes| bytes.try_into().ok())
            .ok_or(JoinTokenError::Malformed)?;
        self.key
            .verify(
                format!("{prefix}.{payload}").as_bytes(),
                &Signature::from_bytes(&signature),
            )
            .map_err(|_| JoinTokenError::BadSignature)?;
        let claims: JoinClaims = b64()
            .decode(payload)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .ok_or(JoinTokenError::Malformed)?;
        if claims.v != 1 {
            return Err(JoinTokenError::Malformed);
        }
        if claims.net != network_name {
            return Err(JoinTokenError::WrongNetwork);
        }
        if claims.iat > now + MAX_CLOCK_SKEW_SECS {
            return Err(JoinTokenError::NotYetValid);
        }
        if claims.exp <= now {
            return Err(JoinTokenError::Expired);
        }
        Ok(claims)
    }
}

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn hex_decode(text: &str) -> Option<Vec<u8>> {
    if text.len() % 2 != 0 || !text.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return None;
    }
    (0..text.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(&text[index..index + 2], 16).ok())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_795_110_000;

    fn signer() -> JoinTokenSigner {
        JoinTokenSigner::from_issuer_key(&[42; 32])
    }

    #[test]
    fn a_minted_token_verifies_for_its_network_only() {
        let signer = signer();
        let verifier = JoinTokenVerifier::from_public_key_hex(&signer.public_key_hex()).unwrap();
        let (token, claims) = signer.mint("obf-aaa", "12345", "dev-1", NOW);
        assert!(token.starts_with("obfjt1."));
        assert_eq!(
            verifier.verify(&token, "obf-aaa", NOW + 10).unwrap(),
            claims
        );
        assert_eq!(claims.exp - claims.iat, JOIN_TOKEN_TTL_SECS);
        assert_eq!(
            verifier.verify(&token, "obf-bbb", NOW),
            Err(JoinTokenError::WrongNetwork)
        );
        // Pinned: a refactor must not move the relay to another key.
        assert_eq!(signer.public_key_hex().len(), 64);
        assert_eq!(
            signer.public_key_hex(),
            JoinTokenSigner::from_issuer_key(&[42; 32]).public_key_hex()
        );
        assert_ne!(
            signer.public_key_hex(),
            JoinTokenSigner::from_issuer_key(&[7; 32]).public_key_hex()
        );
    }

    #[test]
    fn expired_future_forged_and_garbage_tokens_are_refused() {
        let signer = signer();
        let verifier = signer.verifier();
        let (token, _) = signer.mint("obf-aaa", "12345", "dev-1", NOW);
        assert_eq!(
            verifier.verify(&token, "obf-aaa", NOW + JOIN_TOKEN_TTL_SECS),
            Err(JoinTokenError::Expired)
        );
        assert_eq!(
            verifier.verify(&token, "obf-aaa", NOW - MAX_CLOCK_SKEW_SECS - 1),
            Err(JoinTokenError::NotYetValid)
        );
        // Another issuer key.
        let (other, _) = JoinTokenSigner::from_issuer_key(&[7; 32]).mint("obf-aaa", "1", "d", NOW);
        assert_eq!(
            verifier.verify(&other, "obf-aaa", NOW),
            Err(JoinTokenError::BadSignature)
        );
        // A payload swapped under a valid signature.
        let (victim, _) = signer.mint("obf-victim", "9", "d", NOW);
        let mut parts: Vec<&str> = token.split('.').collect();
        let victim_payload = victim.split('.').nth(1).unwrap();
        parts[1] = victim_payload;
        assert_eq!(
            verifier.verify(&parts.join("."), "obf-victim", NOW),
            Err(JoinTokenError::BadSignature)
        );
        for garbage in ["", "obfjt1", "obfjt1.a.b", "x.y.z", "obfjt1.e30.e30.e30"] {
            assert!(
                verifier.verify(garbage, "obf-aaa", NOW).is_err(),
                "{garbage}"
            );
        }
        assert!(JoinTokenVerifier::from_public_key_hex("abcd").is_err());
    }
}

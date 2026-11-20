//! Account-device handshake for OBP over the mesh.
//!
//! Mesh membership only proves "some device of this account network". Each
//! OBP connection additionally proves both device identities with the pair
//! key both devices derive from their X25519 keys in the same-account
//! directory (`device_crypto::derive_message_key`), and binds the proof to
//! the TLS certificate the client saw, so neither the relay node, the issuer,
//! nor another mesh member can impersonate or intercept a device.
//!
//! One upgrade request carries the client's claims and proof; the server's
//! proof comes back in the `101` response, before the first OBP frame.

use base64::Engine;
use hmac::{Hmac, Mac};
use sha2::Sha256;

/// `Authorization: ObpMesh <client proof>`.
pub const AUTH_SCHEME: &str = "ObpMesh";
/// The claimed client device id.
pub const HEADER_DEVICE: &str = "x-obp-mesh-device";
/// The device the client means to reach.
pub const HEADER_TARGET: &str = "x-obp-mesh-target";
/// Client clock, Unix milliseconds.
pub const HEADER_TIME: &str = "x-obp-mesh-time";
/// Client nonce (base64url, 16 random bytes).
pub const HEADER_NONCE: &str = "x-obp-mesh-nonce";
/// Server proof in the `101 Switching Protocols` response.
pub const HEADER_SERVER_PROOF: &str = "x-obp-mesh-proof";
/// How far apart client and server clocks may be.
pub const MAX_CLOCK_SKEW_MS: u64 = 120_000;

const KEY_DOMAIN: &[u8] = b"OpenBitFun OBP mesh v1 handshake key";
const PROOF_DOMAIN: &str = "obp-mesh-v1";

/// Which side signs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    Client,
    Server,
}

impl Role {
    fn label(self) -> &'static str {
        match self {
            Self::Client => "client",
            Self::Server => "server",
        }
    }
}

/// What one handshake proves.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Claims {
    pub client_device_id: String,
    pub server_device_id: String,
    /// `sha256:<hex>` of the server's TLS certificate as the client saw it.
    pub cert_fingerprint: String,
    pub time_ms: u64,
    pub nonce: String,
}

impl Claims {
    fn message(&self, role: Role) -> String {
        format!(
            "{PROOF_DOMAIN}\n{}\n{}\n{}\n{}\n{}\n{}",
            role.label(),
            self.client_device_id,
            self.server_device_id,
            self.cert_fingerprint,
            self.time_ms,
            self.nonce
        )
    }
}

/// The handshake MAC key, separated from the message-encryption use of the
/// same device pair key.
pub fn handshake_key(pair_key: &[u8; 32]) -> [u8; 32] {
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(pair_key).expect("any key length");
    mac.update(KEY_DOMAIN);
    mac.finalize().into_bytes().into()
}

fn mac(key: &[u8; 32], role: Role, claims: &Claims) -> Hmac<Sha256> {
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(key).expect("any key length");
    mac.update(claims.message(role).as_bytes());
    mac
}

/// `role`'s proof over `claims` (base64url, no padding).
pub fn prove(key: &[u8; 32], role: Role, claims: &Claims) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD
        .encode(mac(key, role, claims).finalize().into_bytes())
}

/// Constant-time check of `role`'s proof.
pub fn verify(key: &[u8; 32], role: Role, claims: &Claims, proof: &str) -> bool {
    let Ok(bytes) = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(proof.trim()) else {
        return false;
    };
    mac(key, role, claims).verify_slice(&bytes).is_ok()
}

/// A fresh client nonce.
pub fn new_nonce() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 16];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

/// Device ids as the relay accepts them.
pub fn valid_device_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
}

/// Nonces as [`new_nonce`] makes them.
pub fn valid_nonce(value: &str) -> bool {
    (16..=64).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn claims() -> Claims {
        Claims {
            client_device_id: "client-1".into(),
            server_device_id: "server-2".into(),
            cert_fingerprint: "sha256:abcd".into(),
            time_ms: 1_795_110_000_000,
            nonce: new_nonce(),
        }
    }

    #[test]
    fn proofs_bind_role_identities_certificate_and_nonce() {
        let key = handshake_key(&[9; 32]);
        let claims = claims();
        let client = prove(&key, Role::Client, &claims);
        assert!(verify(&key, Role::Client, &claims, &client));
        // A client proof is not a server proof (no reflection).
        assert!(!verify(&key, Role::Server, &claims, &client));
        // Another device pair cannot produce it.
        assert!(!verify(
            &handshake_key(&[8; 32]),
            Role::Client,
            &claims,
            &client
        ));
        for mutate in [
            |c: &mut Claims| c.client_device_id = "client-x".into(),
            |c: &mut Claims| c.server_device_id = "server-x".into(),
            |c: &mut Claims| c.cert_fingerprint = "sha256:mitm".into(),
            |c: &mut Claims| c.time_ms += 1,
            |c: &mut Claims| c.nonce = "AAAAAAAAAAAAAAAAAAAAAA".into(),
        ] {
            let mut changed = claims.clone();
            mutate(&mut changed);
            assert!(!verify(&key, Role::Client, &changed, &client));
        }
        assert!(!verify(&key, Role::Client, &claims, "not base64!"));
        assert!(valid_nonce(&claims.nonce));
        assert!(!valid_nonce("short"));
        assert!(valid_device_id("ea4c87d093d8d571b48bba45cdf37f5f"));
        assert!(!valid_device_id("a/b"));
    }
}

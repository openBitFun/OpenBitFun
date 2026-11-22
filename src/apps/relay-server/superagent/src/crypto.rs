//! Keys and identifiers.
//!
//! - The device pair key: X25519 + HKDF-SHA256 over both public keys in a
//!   fixed order, the derivation every OpenBitFun device uses
//!   (`services-integrations` `remote_connect::device_crypto`), so a device
//!   verifies the agent's handshake with the key it derives from the agent's
//!   public key in the account directory.
//! - Server-side names: the account directory name and the cloud device id
//!   are HMACs of the account id under the server master key, so neither the
//!   file system nor the directory reveals account ids.

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use hkdf::Hkdf;
use hmac::{Hmac, Mac};
use rand::RngCore;
use sha2::Sha256;
use x25519_dalek::{PublicKey, StaticSecret};

/// HKDF salt of the device pair key (must match every other device).
const PAIR_KDF_SALT: &[u8] = b"OpenBitFun Relay v1.0.0 device key";

/// The prefix of every cloud agent device id.
pub const CLOUD_DEVICE_PREFIX: &str = "cloud-";

pub fn random_bytes<const N: usize>() -> [u8; N] {
    let mut bytes = [0u8; N];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    bytes
}

pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn hmac(key: &[u8; 32], domain: &str, value: &str) -> [u8; 32] {
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(key).expect("HMAC accepts any key size");
    mac.update(domain.as_bytes());
    mac.update(b"\n");
    mac.update(value.as_bytes());
    mac.finalize().into_bytes().into()
}

/// The directory name of an account's records (32 hex characters).
pub fn account_dir_name(master: &[u8; 32], account_id: &str) -> String {
    hex(&hmac(master, "openbitfun-superagent account dir v1", account_id)[..16])
}

/// The account's cloud agent device id: `cloud-` + 24 hex characters, a
/// valid Link hostname and directory device id.
pub fn cloud_device_id(master: &[u8; 32], account_id: &str) -> String {
    format!(
        "{CLOUD_DEVICE_PREFIX}{}",
        hex(&hmac(master, "openbitfun-superagent device id v1", account_id)[..12])
    )
}

/// HKDF-SHA256 of the master key for one purpose.
pub fn derive_key(master: &[u8; 32], info: &str) -> [u8; 32] {
    let mut out = [0u8; 32];
    Hkdf::<Sha256>::new(None, master)
        .expand(info.as_bytes(), &mut out)
        .expect("32 bytes is a valid HKDF-SHA256 length");
    out
}

pub fn public_key(secret: &[u8; 32]) -> [u8; 32] {
    PublicKey::from(&StaticSecret::from(*secret)).to_bytes()
}

pub fn public_key_base64(secret: &[u8; 32]) -> String {
    BASE64.encode(public_key(secret))
}

/// A public key as the account directory returns it (base64, 32 bytes).
pub fn parse_public_key(value: &str) -> Result<[u8; 32], String> {
    let bytes = BASE64
        .decode(value.trim())
        .map_err(|_| "the device directory returned an unreadable key".to_string())?;
    bytes
        .try_into()
        .map_err(|_| "the device directory returned a key of the wrong size".to_string())
}

/// The key both devices of a pair derive.
pub fn derive_pair_key(secret: &[u8; 32], peer_public: &[u8; 32]) -> Result<[u8; 32], String> {
    let local_public = public_key(secret);
    let shared = StaticSecret::from(*secret).diffie_hellman(&PublicKey::from(*peer_public));
    if !shared.was_contributory() {
        return Err("invalid peer public key".to_string());
    }
    let (first, second) = if local_public < *peer_public {
        (&local_public, peer_public)
    } else {
        (peer_public, &local_public)
    };
    let mut info = [0u8; 64];
    info[..32].copy_from_slice(first);
    info[32..].copy_from_slice(second);
    let mut key = [0u8; 32];
    Hkdf::<Sha256>::new(Some(PAIR_KDF_SALT), shared.as_bytes())
        .expand(&info, &mut key)
        .map_err(|_| "device pair key derivation failed".to_string())?;
    Ok(key)
}

/// Reads a 32-byte key stored as 64 hex characters in a file that only its
/// owner may read.
pub fn read_key_file(path: &std::path::Path) -> anyhow::Result<[u8; 32]> {
    openbitfun_link::gateway::read_hex_key_file(path).map_err(anyhow::Error::msg)
}

pub fn parse_hex_key(text: &str) -> anyhow::Result<[u8; 32]> {
    openbitfun_link::gateway::parse_hex_key(text).map_err(anyhow::Error::msg)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pair_key_matches_every_other_device() {
        // The vector pinned by `remote_connect::device_crypto` and the phone
        // app: a desktop derives the same key.
        let alice = [7; 32];
        let bob = [11; 32];
        let sending = derive_pair_key(&alice, &public_key(&bob)).unwrap();
        let receiving = derive_pair_key(&bob, &public_key(&alice)).unwrap();
        assert_eq!(sending, receiving);
        assert_eq!(
            hex(&sending),
            "6e8f5da837e91e9ddb09c5aa7dee229e731fc94499d29d10dcf5f1437193f56c"
        );
        assert!(derive_pair_key(&alice, &[0; 32]).is_err());
    }

    #[test]
    fn server_names_are_stable_valid_and_unrelated_to_the_account_id() {
        let master = [3u8; 32];
        let id = cloud_device_id(&master, "email-abc");
        assert_eq!(id, cloud_device_id(&master, "email-abc"));
        assert_ne!(id, cloud_device_id(&master, "email-abd"));
        assert_ne!(id, cloud_device_id(&[4u8; 32], "email-abc"));
        assert!(id.starts_with(CLOUD_DEVICE_PREFIX) && id.len() == 30);
        assert!(openbitfun_link::handshake::valid_device_id(&id), "{id}");
        let dir = account_dir_name(&master, "email-abc");
        assert_eq!(dir.len(), 32);
        assert!(!dir.contains("abc"));
        assert!(parse_hex_key(&"ab".repeat(32)).is_ok());
        assert!(parse_hex_key("abc").is_err());
    }
}

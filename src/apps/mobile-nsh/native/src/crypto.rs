//! The device key: X25519, the same derivation every OpenBitFun device uses
//! for its pair key with another device of the account
//! (`services-integrations` `remote_connect::device_crypto`), so a desktop
//! verifies this phone's OBP handshake with the key it derives from the
//! phone's public key in the account directory.

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use hkdf::Hkdf;
use rand::RngCore;
use sha2::{Digest, Sha256};
use x25519_dalek::{PublicKey, StaticSecret};

/// HKDF salt of the device pair key (must match every other device).
const KDF_SALT: &[u8] = b"OpenBitFun Relay v1.0.0 device key";

/// A fresh device secret.
pub(crate) fn generate_secret() -> [u8; 32] {
    StaticSecret::random_from_rng(rand::rngs::OsRng).to_bytes()
}

pub(crate) fn public_key(secret: &[u8; 32]) -> [u8; 32] {
    PublicKey::from(&StaticSecret::from(*secret)).to_bytes()
}

pub(crate) fn public_key_base64(secret: &[u8; 32]) -> String {
    BASE64.encode(public_key(secret))
}

/// A public key as the account directory returns it (base64, 32 bytes).
pub(crate) fn parse_public_key(value: &str) -> Result<[u8; 32], String> {
    let bytes = BASE64
        .decode(value.trim())
        .map_err(|_| "the device directory returned an unreadable key".to_string())?;
    bytes
        .try_into()
        .map_err(|_| "the device directory returned a key of the wrong size".to_string())
}

/// X25519 + HKDF-SHA256 over both public keys in a fixed order: the key
/// both devices of a pair derive.
pub(crate) fn derive_pair_key(
    secret: &[u8; 32],
    peer_public: &[u8; 32],
) -> Result<[u8; 32], String> {
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
    Hkdf::<Sha256>::new(Some(KDF_SALT), shared.as_bytes())
        .expand(&info, &mut key)
        .map_err(|_| "device pair key derivation failed".to_string())?;
    Ok(key)
}

/// A random account device id (32 lowercase hex characters, the shape
/// desktops use; a valid Link hostname).
pub(crate) fn new_device_id() -> String {
    let mut bytes = [0u8; 16];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    hex(&bytes)
}

pub(crate) fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// `sha256:<hex>` of a certificate, as the OBP mesh handshake binds it.
pub(crate) fn fingerprint(certificate: &[u8]) -> String {
    format!("sha256:{}", hex(&Sha256::digest(certificate)))
}

pub(crate) fn encode_secret(secret: &[u8; 32]) -> String {
    BASE64.encode(secret)
}

pub(crate) fn decode_secret(value: &str) -> Result<[u8; 32], String> {
    BASE64
        .decode(value)
        .ok()
        .and_then(|bytes| bytes.try_into().ok())
        .ok_or_else(|| "the stored device key is unreadable".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pair_key_matches_every_other_device() {
        // The vector pinned by `remote_connect::device_crypto` in
        // services-integrations: a desktop derives the same key.
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
    fn keys_and_ids_round_trip() {
        let secret = generate_secret();
        assert_eq!(decode_secret(&encode_secret(&secret)).unwrap(), secret);
        assert_eq!(
            parse_public_key(&public_key_base64(&secret)).unwrap(),
            public_key(&secret)
        );
        assert!(parse_public_key("AAAA").is_err());
        let id = new_device_id();
        assert_eq!(id.len(), 32);
        assert!(openbitfun_link::handshake::valid_device_id(&id));
        assert_ne!(id, new_device_id());
    }
}

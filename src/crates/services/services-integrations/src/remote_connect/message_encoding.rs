//! Codec for the plaintext of device-to-device Relay messages. The prefix is
//! authenticated by the existing AES-GCM envelope and cannot begin UTF-8 JSON.
use anyhow::{bail, ensure, Context, Result};
use std::borrow::Cow;

pub const ZSTD_ENCODING: &str = "zstd-1";
const PREFIX: &[u8; 4] = b"\xffOZ\x01";
const HEADER: usize = 8;
const THRESHOLD: usize = 256;
// Preserve the Relay's existing bulk-message ceiling after inflation.
const MAX_PLAIN_BYTES: usize = 64 * 1024 * 1024;

pub fn encode(plain: &[u8], accepted: bool) -> Result<Cow<'_, [u8]>> {
    if !accepted || plain.len() <= THRESHOLD || plain.len() > MAX_PLAIN_BYTES {
        return Ok(Cow::Borrowed(plain));
    }
    let compressed = zstd::bulk::compress(plain, 1)?;
    if HEADER + compressed.len() >= plain.len() {
        return Ok(Cow::Borrowed(plain));
    }
    let mut out = Vec::with_capacity(HEADER + compressed.len());
    out.extend_from_slice(PREFIX);
    out.extend_from_slice(&(plain.len() as u32).to_le_bytes());
    out.extend_from_slice(&compressed);
    Ok(Cow::Owned(out))
}

pub fn decode(bytes: Vec<u8>) -> Result<String> {
    if bytes.first() != Some(&0xff) {
        return Ok(String::from_utf8(bytes)?);
    }
    ensure!(bytes.starts_with(PREFIX), "Unknown Relay message encoding");
    let size = bytes
        .get(4..HEADER)
        .context("Incomplete Relay encoding header")?;
    let expected = u32::from_le_bytes(size.try_into()?) as usize;
    ensure!(
        (1..=MAX_PLAIN_BYTES).contains(&expected),
        "Invalid Relay decoded size"
    );
    let frame = &bytes[HEADER..];
    let frame_len = zstd::zstd_safe::find_frame_compressed_size(frame)
        .map_err(|_| anyhow::anyhow!("Invalid Relay Zstd frame"))?;
    ensure!(
        frame_len == frame.len(),
        "Trailing data in Relay Zstd message"
    );
    let mut codec = zstd::bulk::Decompressor::new()?;
    codec.window_log_max(26)?;
    let decoded = codec.decompress(frame, expected)?;
    if decoded.len() != expected {
        bail!("Relay decoded size mismatch");
    }
    Ok(String::from_utf8(decoded)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn mixed_messages_round_trip_without_changing_legacy_bytes() {
        let text = "雪".repeat(5000);
        assert_eq!(
            encode(text.as_bytes(), false).unwrap().as_ref(),
            text.as_bytes()
        );
        assert!(matches!(encode(&[0; 256], true).unwrap(), Cow::Borrowed(_)));
        let packet = encode(text.as_bytes(), true).unwrap().into_owned();
        assert!(packet.starts_with(PREFIX));
        assert_eq!(decode(packet).unwrap(), text);
        assert_eq!(decode(text.into_bytes()).unwrap(), "雪".repeat(5000));
    }
    #[test]
    fn malformed_frames_cannot_expand_past_the_declared_bound() {
        let mut frame = encode(&[b'a'; 300], true).unwrap().into_owned();
        frame[4..8].copy_from_slice(&42u32.to_le_bytes());
        assert!(decode(frame.clone()).is_err());
        frame[4..8].copy_from_slice(&u32::MAX.to_le_bytes());
        assert!(decode(frame).is_err());
        assert!(decode(PREFIX.to_vec()).is_err());
        assert!(decode(vec![0xff, 0, 0, 0]).is_err());
    }
    #[test]
    fn compression_is_inside_authenticated_encryption() {
        use super::super::encryption;
        use base64::{engine::general_purpose::STANDARD, Engine};

        let text = "x".repeat(300);
        let key = [42; 32];
        for accepted in [false, true] {
            let (data, nonce) = encryption::encrypt_relay_message(&key, &text, accepted).unwrap();
            let mut sealed = STANDARD.decode(&data).unwrap();
            let iv = STANDARD.decode(&nonce).unwrap().try_into().unwrap();
            let opened = encryption::decrypt(&key, &sealed, &iv).unwrap();
            if accepted {
                let fixture: serde_json::Value = serde_json::from_str(include_str!(
                    "../../../../../shared/relay-protocol-contract-fixtures/relay-message-encoding.json"
                )).unwrap();
                let reference =
                    hex::decode(fixture["cases"][0]["wire"]["hex"].as_str().unwrap()).unwrap();
                assert_eq!(decode(reference).unwrap(), text);
                assert!(opened.starts_with(PREFIX));
                assert!(sealed.len() < text.len());
            } else {
                assert_eq!(opened, text.as_bytes());
            }
            assert_eq!(
                encryption::decrypt_from_base64(&key, &data, &nonce).unwrap(),
                text
            );
            sealed[0] ^= 1;
            assert!(
                encryption::decrypt_from_base64(&key, &STANDARD.encode(sealed), &nonce).is_err()
            );
        }
    }
}

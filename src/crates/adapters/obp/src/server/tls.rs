//! TLS for the mesh listener: a self-signed certificate whose fingerprint the
//! pairing QR carries, so native clients pin it and browsers can verify it
//! against the one the desktop shows. The listener itself (TLS over Link's
//! inbound streams) is `mesh.rs`.

use std::sync::Arc;

use base64::Engine;

use super::store::{now_ms, sha256_hex, ListenerIdentity};

/// A new self-signed identity (P-256 ECDSA).
pub(crate) fn generate_identity() -> Result<ListenerIdentity, String> {
    let names = vec!["localhost".to_string(), "openbitfun.local".to_string()];
    let mut params = rcgen::CertificateParams::new(names)
        .map_err(|error| format!("invalid certificate names: {error}"))?;
    params
        .distinguished_name
        .push(rcgen::DnType::CommonName, "OpenBitFun backend");
    let key = rcgen::KeyPair::generate()
        .map_err(|error| format!("failed to generate the listener key: {error}"))?;
    let cert = params
        .self_signed(&key)
        .map_err(|error| format!("failed to sign the listener certificate: {error}"))?;
    let der = cert.der().to_vec();
    let engine = base64::engine::general_purpose::STANDARD;
    Ok(ListenerIdentity {
        fingerprint: format!("sha256:{}", sha256_hex(&der)),
        cert_der: engine.encode(&der),
        key_der: engine.encode(key.serialize_der()),
        created_at_ms: now_ms(),
    })
}

/// The rustls server configuration for `identity` (HTTP/1.1 only: the
/// WebSocket upgrade needs it).
pub(crate) fn server_config(
    identity: &ListenerIdentity,
) -> Result<Arc<rustls::ServerConfig>, String> {
    crate::ensure_tls_provider();
    let engine = base64::engine::general_purpose::STANDARD;
    let cert = engine
        .decode(&identity.cert_der)
        .map_err(|error| format!("unreadable listener certificate: {error}"))?;
    let key = engine
        .decode(&identity.key_der)
        .map_err(|error| format!("unreadable listener key: {error}"))?;
    let cert = rustls::pki_types::CertificateDer::from(cert);
    let key =
        rustls::pki_types::PrivateKeyDer::Pkcs8(rustls::pki_types::PrivatePkcs8KeyDer::from(key));
    let mut config = rustls::ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(vec![cert], key)
        .map_err(|error| format!("invalid listener TLS identity: {error}"))?;
    config.alpn_protocols = vec![b"http/1.1".to_vec()];
    Ok(Arc::new(config))
}

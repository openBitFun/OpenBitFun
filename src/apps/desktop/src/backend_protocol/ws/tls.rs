//! TLS for the LAN listener: a self-signed certificate whose fingerprint the
//! pairing QR carries, so native clients pin it and browsers can verify it
//! against the one the desktop shows.

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use base64::Engine;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
use tokio_rustls::server::TlsStream;
use tokio_rustls::TlsAcceptor;

use super::store::{now_ms, sha256_hex, LanIdentity};

/// How long a client may take to finish the TLS handshake.
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);
/// Handshaken connections waiting for the HTTP server to take them.
const ACCEPT_QUEUE: usize = 64;

/// A new self-signed identity (P-256 ECDSA).
pub(crate) fn generate_identity() -> Result<LanIdentity, String> {
    let names = vec!["localhost".to_string(), "openbitfun.local".to_string()];
    let mut params = rcgen::CertificateParams::new(names)
        .map_err(|error| format!("invalid certificate names: {error}"))?;
    params
        .distinguished_name
        .push(rcgen::DnType::CommonName, "OpenBitFun LAN backend");
    let key = rcgen::KeyPair::generate()
        .map_err(|error| format!("failed to generate the LAN key: {error}"))?;
    let cert = params
        .self_signed(&key)
        .map_err(|error| format!("failed to sign the LAN certificate: {error}"))?;
    let der = cert.der().to_vec();
    let engine = base64::engine::general_purpose::STANDARD;
    Ok(LanIdentity {
        fingerprint: format!("sha256:{}", sha256_hex(&der)),
        cert_der: engine.encode(&der),
        key_der: engine.encode(key.serialize_der()),
        created_at_ms: now_ms(),
    })
}

/// The rustls server configuration for `identity` (HTTP/1.1 only: the
/// WebSocket upgrade needs it).
pub(crate) fn server_config(identity: &LanIdentity) -> Result<Arc<rustls::ServerConfig>, String> {
    crate::ensure_rustls_crypto_provider();
    let engine = base64::engine::general_purpose::STANDARD;
    let cert = engine
        .decode(&identity.cert_der)
        .map_err(|error| format!("unreadable LAN certificate: {error}"))?;
    let key = engine
        .decode(&identity.key_der)
        .map_err(|error| format!("unreadable LAN key: {error}"))?;
    let cert = rustls::pki_types::CertificateDer::from(cert);
    let key =
        rustls::pki_types::PrivateKeyDer::Pkcs8(rustls::pki_types::PrivatePkcs8KeyDer::from(key));
    let mut config = rustls::ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(vec![cert], key)
        .map_err(|error| format!("invalid LAN TLS identity: {error}"))?;
    config.alpn_protocols = vec![b"http/1.1".to_vec()];
    Ok(Arc::new(config))
}

/// An axum listener that accepts TCP, finishes TLS handshakes concurrently
/// (a slow client never blocks others) and yields the TLS streams.
pub(crate) struct TlsListener {
    local: SocketAddr,
    ready: mpsc::Receiver<(TlsStream<TcpStream>, SocketAddr)>,
    accept_task: tokio::task::JoinHandle<()>,
}

impl TlsListener {
    pub(crate) fn new(
        listener: TcpListener,
        config: Arc<rustls::ServerConfig>,
    ) -> std::io::Result<Self> {
        let local = listener.local_addr()?;
        let acceptor = TlsAcceptor::from(config);
        let (sender, ready) = mpsc::channel(ACCEPT_QUEUE);
        let accept_task = tokio::spawn(async move {
            loop {
                let (stream, peer) = match listener.accept().await {
                    Ok(accepted) => accepted,
                    Err(error) => {
                        log::debug!("OBP LAN accept failed: {}", error);
                        tokio::time::sleep(Duration::from_millis(50)).await;
                        continue;
                    }
                };
                if sender.is_closed() {
                    return;
                }
                let acceptor = acceptor.clone();
                let sender = sender.clone();
                tokio::spawn(async move {
                    match tokio::time::timeout(HANDSHAKE_TIMEOUT, acceptor.accept(stream)).await {
                        Ok(Ok(tls)) => {
                            let _ = sender.send((tls, peer)).await;
                        }
                        Ok(Err(error)) => {
                            log::debug!(
                                "OBP LAN TLS handshake failed: peer={}, error={}",
                                peer,
                                error
                            )
                        }
                        Err(_) => log::debug!("OBP LAN TLS handshake timed out: peer={}", peer),
                    }
                });
            }
        });
        Ok(Self {
            local,
            ready,
            accept_task,
        })
    }
}

impl Drop for TlsListener {
    fn drop(&mut self) {
        self.accept_task.abort();
    }
}

impl axum::serve::Listener for TlsListener {
    type Io = TlsStream<TcpStream>;
    type Addr = SocketAddr;

    async fn accept(&mut self) -> (Self::Io, Self::Addr) {
        match self.ready.recv().await {
            Some(accepted) => accepted,
            // The accept task only ends with the listener; wait to be dropped.
            None => std::future::pending().await,
        }
    }

    fn local_addr(&self) -> std::io::Result<Self::Addr> {
        Ok(self.local)
    }
}

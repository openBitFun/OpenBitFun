//! The account issuer client: `POST <issuer>/mesh/v1/credentials` with the
//! OpenBitFun identity access token, naming this device so the response
//! carries a join token bound to it.

use std::time::Duration;

use crate::credentials::{MeshCredentials, MESH_CREDENTIALS_PATH};

/// Why credentials could not be fetched.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FetchError {
    /// Network or service trouble: a cached document may be used.
    Transient(String),
    /// The account may not have credentials now (sign in again).
    Refused(String),
    /// The server has no issuer (an older or foreign deployment).
    Unsupported(String),
}

impl std::fmt::Display for FetchError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Transient(message) | Self::Refused(message) | Self::Unsupported(message) => {
                f.write_str(message)
            }
        }
    }
}

/// Which roots verify the issuer's HTTPS certificate.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TlsRoots {
    /// The platform verifier (system trust store). The default except on
    /// Android, where it needs Java-side initialisation.
    Platform,
    /// The bundled Mozilla roots (`webpki-roots`); no platform setup.
    Bundled,
}

impl Default for TlsRoots {
    fn default() -> Self {
        if cfg!(target_os = "android") {
            Self::Bundled
        } else {
            Self::Platform
        }
    }
}

/// Fetches this device's credentials from the issuer at `base_url`
/// (default roots, see [`TlsRoots`]).
pub async fn fetch_credentials(
    base_url: &str,
    access_token: &str,
    device_id: &str,
    client_version: &str,
) -> Result<MeshCredentials, FetchError> {
    fetch_credentials_with(
        base_url,
        access_token,
        device_id,
        client_version,
        TlsRoots::default(),
    )
    .await
}

fn http_client(roots: TlsRoots) -> Result<reqwest::Client, String> {
    openbitfun_services_core::tls_provider::ensure_ring_crypto_provider();
    let builder = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none());
    let builder = match roots {
        TlsRoots::Platform => builder,
        TlsRoots::Bundled => {
            let roots =
                rustls::RootCertStore::from_iter(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
            let tls = rustls::ClientConfig::builder_with_provider(std::sync::Arc::new(
                rustls::crypto::ring::default_provider(),
            ))
            .with_safe_default_protocol_versions()
            .map_err(|error| error.to_string())?
            .with_root_certificates(roots)
            .with_no_client_auth();
            builder.tls_backend_preconfigured(tls)
        }
    };
    builder.build().map_err(|error| error.to_string())
}

/// [`fetch_credentials`] with the given HTTPS roots.
pub async fn fetch_credentials_with(
    base_url: &str,
    access_token: &str,
    device_id: &str,
    client_version: &str,
    roots: TlsRoots,
) -> Result<MeshCredentials, FetchError> {
    let client = http_client(roots).map_err(FetchError::Transient)?;
    let base = base_url.trim().trim_end_matches('/');
    let response = client
        .post(format!("{base}{MESH_CREDENTIALS_PATH}"))
        .bearer_auth(access_token)
        .json(&serde_json::json!({
            "deviceId": device_id,
            "clientVersion": client_version,
            "easytierVersion": crate::EASYTIER_VERSION,
        }))
        .send()
        .await
        .map_err(|error| {
            FetchError::Transient(format!("the mesh issuer is unreachable: {error}"))
        })?;
    let status = response.status();
    if matches!(status.as_u16(), 404 | 405 | 410) {
        return Err(FetchError::Unsupported(format!(
            "mesh_unsupported: the account server does not issue Link credentials (HTTP {status}); update the server"
        )));
    }
    if matches!(status.as_u16(), 401 | 403) {
        return Err(FetchError::Refused(format!(
            "the account server refused Link credentials (HTTP {status}); sign in again"
        )));
    }
    if !status.is_success() {
        return Err(FetchError::Transient(format!(
            "the mesh issuer answered HTTP {status}"
        )));
    }
    let credentials: MeshCredentials = response
        .json()
        .await
        .map_err(|error| FetchError::Transient(format!("unreadable Link credentials: {error}")))?;
    credentials.validate().map_err(FetchError::Refused)?;
    Ok(credentials)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn both_root_choices_build_a_client() {
        http_client(TlsRoots::Platform).unwrap();
        http_client(TlsRoots::Bundled).unwrap();
        assert_eq!(
            TlsRoots::default(),
            if cfg!(target_os = "android") {
                TlsRoots::Bundled
            } else {
                TlsRoots::Platform
            }
        );
    }
}

//! What both ends of an account-device connection need from their host: the
//! byte stream to a device and the same-account device directory.

use std::future::Future;
use std::pin::Pin;

use tokio::io::{AsyncRead, AsyncWrite};

/// A boxed future resolving a device pair key.
pub type PairKeyFuture<'a> = Pin<Box<dyn Future<Output = Result<[u8; 32], String>> + Send + 'a>>;

/// A byte stream on the device network (a Link virtual TCP stream; plain
/// TCP in tests).
pub trait MeshIo: AsyncRead + AsyncWrite + Unpin + Send + 'static {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send + 'static> MeshIo for T {}

/// The same-account device directory, as the account-device handshake needs
/// it.
pub trait MeshAuthority: Send + Sync + 'static {
    /// This device's account device id (`None` while signed out).
    fn local_device_id(&self) -> Option<String>;
    /// The X25519 pair key shared with `device_id`; an error when the device
    /// is not in this account's directory.
    fn pair_key<'a>(&'a self, device_id: &'a str) -> PairKeyFuture<'a>;
}

/// `/obp/mesh/info`: what a controller needs to pick a device's port and
/// protocol before it authenticates (no secrets).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MeshInfo {
    pub device_id: String,
    pub protocol: u32,
    #[serde(default)]
    pub capabilities: Vec<String>,
    #[serde(default)]
    pub backend_version: String,
    pub fingerprint: String,
}

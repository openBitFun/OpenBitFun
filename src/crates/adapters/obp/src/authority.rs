//! What both ends of an account-device connection need from their host: the
//! byte stream to a device and the same-account device directory.

use std::future::Future;
use std::pin::Pin;

use tokio::io::{AsyncRead, AsyncWrite};

/// A boxed future resolving a device pair key.
pub type PairKeyFuture<'a> = Pin<Box<dyn Future<Output = Result<[u8; 32], String>> + Send + 'a>>;
/// A boxed future resolving a device's directory row kind.
pub type DeviceKindFuture<'a> =
    Pin<Box<dyn Future<Output = Result<Option<String>, String>> + Send + 'a>>;

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
    /// The directory row kind of `device_id` (`desktop`, `cli`, `mobile`,
    /// `cloud_agent`, …), asked after its handshake proof verified. `None`:
    /// the directory predates the kind or the row has none; the device then
    /// gets the `account-device` scope. `cloud_agent` selects the narrower
    /// `cloud-agent` scope. An error refuses the handshake.
    fn device_kind<'a>(&'a self, _device_id: &'a str) -> DeviceKindFuture<'a> {
        Box::pin(async { Ok(None) })
    }
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
    /// Clients attached to this host as a fleet entry now (hellos that
    /// opened a fleet stream). Present only on a host that serves the fleet
    /// layer (it then lists `fleet_v1` in `capabilities` too); entry
    /// rankings prefer the less loaded host. Older hosts omit it and older
    /// readers ignore it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fleet_load: Option<u32>,
}

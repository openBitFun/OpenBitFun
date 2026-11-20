//! OpenBitFun Link: the device network every OpenBitFun end embeds.
//!
//! Every device of one account joins the same network (an EasyTier fork,
//! `third_party/easytier`, running in this process) after the user signs in:
//! the account issuer hands out the network and a short-lived join token
//! bound to the account and the device, and the shared relay node admits
//! only peers with a valid token. Devices connect directly when they can
//! (LAN, IPv4/IPv6 hole punching, relaying through another device) and
//! through the relay (the WebSocket relay path over HTTPS) otherwise.
//!
//! Hosts get tokio `AsyncRead + AsyncWrite` streams: they accept OBP
//! connections from other devices and open streams to them, with no proxy
//! port and no TUN device. OBP's account-device handshake stays the inner
//! authentication of every connection.

pub mod config;
pub mod credentials;
pub mod gateway;
pub mod handshake;
pub mod issuer;
pub mod node;
pub mod relay;
pub mod session;
pub mod status;
pub mod stream;

#[cfg(test)]
mod switch_tests;

pub use config::{DeviceNodeConfig, RelayNodeConfig};
pub use credentials::MeshCredentials;
pub use node::{LinkNode, NodeOptions, NodeProfile};
pub use session::{AccountIdentity, AccountSession, Link, LinkOptions};
pub use status::{MeshPath, MeshPeer, MeshRelayNode, MeshRoute, MeshState, MeshStatus, NodeRole};
pub use stream::{LinkListener, LinkStream};

/// The EasyTier release the fork is based on, as nodes report it.
pub const EASYTIER_VERSION: &str = easytier::VERSION;

/// Capability a backend advertises when it serves OBP over Link.
pub const MESH_CAPABILITY: &str = "mesh_v1";

/// The OBP listener's first port. A backend listens on the first free port
/// of `MESH_OBP_PORT_FIRST..=MESH_OBP_PORT_LAST` of its virtual address;
/// controllers probe the range.
pub const MESH_OBP_PORT_FIRST: u16 = 47612;
/// The OBP listener's last port (inclusive).
pub const MESH_OBP_PORT_LAST: u16 = 47619;

/// Milliseconds since the Unix epoch.
pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or_default()
}

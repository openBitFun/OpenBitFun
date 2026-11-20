//! OpenBitFun device mesh (EasyTier).
//!
//! Every device of one account joins the same EasyTier network (credentials
//! from the account mesh issuer) through the OpenBitFun relay/discovery node,
//! with automatic P2P hole punching and relay fallback. EasyTier runs as the
//! official `easytier-core` sidecar in no-TUN userspace mode: no root, no VPN
//! interface. Inbound mesh traffic for this device's virtual IP reaches
//! `127.0.0.1:<port>` only for the whitelisted OBP mesh ports; outbound
//! connections to another device go through the sidecar's loopback SOCKS5.

pub mod binary;
pub mod config;
pub mod credentials;
pub mod handshake;
pub mod sidecar;
pub mod status;

pub use binary::{EasyTierBinaries, EASYTIER_VERSION};
pub use config::MeshNodeConfig;
pub use credentials::MeshCredentials;
pub use sidecar::{MeshSidecar, SidecarOptions};
pub use status::{MeshPath, MeshPeer, MeshRelayNode, MeshState, MeshStatus};

/// Capability a backend advertises when it serves OBP over the mesh.
pub const MESH_CAPABILITY: &str = "mesh_v1";

/// The OBP mesh listener's first port. A backend binds the first free port of
/// `MESH_OBP_PORT_FIRST..=MESH_OBP_PORT_LAST` on loopback; the sidecar admits
/// inbound mesh TCP to exactly this range, and controllers probe it.
pub const MESH_OBP_PORT_FIRST: u16 = 47612;
/// The OBP mesh listener's last port (inclusive).
pub const MESH_OBP_PORT_LAST: u16 = 47619;

/// Milliseconds since the Unix epoch.
pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or_default()
}

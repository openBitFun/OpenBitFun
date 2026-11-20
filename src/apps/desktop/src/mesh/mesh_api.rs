//! Owner commands of the device mesh. Both are `ControllerLocal` in the
//! Product Operation Registry: they describe this backend's own mesh node.

use openbitfun_link::{MeshState, MeshStatus};

use super::{global, MeshDeviceEntry};

fn not_running() -> MeshStatus {
    MeshStatus::new(
        MeshState::Disabled,
        Some(
            "mesh_unavailable: this host does not run the device network (OPENBITFUN_MESH=off or no native desktop host)"
                .to_string(),
        ),
    )
}

/// This device's Link node: state, virtual IP, peers (direct over the LAN,
/// IPv4 or IPv6, or relayed through the server or another device; latency;
/// last seen), relay nodes, restarts. Never carries credentials.
// @backend-command
pub async fn mesh_status() -> Result<MeshStatus, String> {
    Ok(match global() {
        Some(runtime) => runtime.refresh().await,
        None => not_running(),
    })
}

/// Devices of the signed-in account in the mesh: device id, directory name,
/// virtual IP, whether its OBP mesh listener answers, p2p or relayed, and
/// its OBP protocol and capabilities.
// @backend-command
pub async fn mesh_list_devices() -> Result<Vec<MeshDeviceEntry>, String> {
    match global() {
        Some(runtime) => runtime.list_devices().await,
        None => Err(not_running().reason.unwrap_or_default()),
    }
}

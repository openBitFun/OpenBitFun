//! Owner commands of the device mesh. Both are `ControllerLocal` in the
//! Product Operation Registry: they describe this backend's own mesh node.

use openbitfun_mesh_service::{MeshState, MeshStatus};

use super::{global, MeshDeviceEntry, MeshPhoneJoinInfo};

fn not_running() -> MeshStatus {
    MeshStatus::new(
        MeshState::Disabled,
        Some(
            "mesh_unavailable: this desktop host does not run the device mesh; use the native desktop app"
                .to_string(),
        ),
    )
}

/// This device's mesh node: state, virtual IP, peers (p2p or relayed,
/// latency), relay nodes, sidecar restarts.
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

/// What a phone needs to join this account's device mesh with the EasyTier
/// app (network name, network secret, peer URLs) and to reach this device's
/// OBP listener there (virtual IP, port). Owner only: the network secret is a
/// credential; the UI hides it until the user reveals it.
// @backend-command
pub async fn mesh_phone_join_info() -> Result<MeshPhoneJoinInfo, String> {
    match global() {
        Some(runtime) => runtime.phone_join_info().await,
        None => Err(not_running().reason.unwrap_or_default()),
    }
}

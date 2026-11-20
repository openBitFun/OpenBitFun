//! Owner commands of the browser/phone listener (Devices scene). All are
//! `ControllerLocal` in the Product Operation Registry: a paired client can
//! never mint pairing codes, list or revoke other clients, or read the owner
//! link.

use serde::Deserialize;

use super::{global_server, unavailable_status, ObpStatus, PairingOffer};

fn unavailable() -> String {
    unavailable_status()
        .unavailable_reason
        .unwrap_or_else(|| "obp_unavailable".to_string())
}

/// The listeners, pairings and connections.
// @backend-command
pub async fn obp_get_status() -> Result<ObpStatus, String> {
    Ok(match global_server() {
        Some(server) => server.status(),
        None => unavailable_status(),
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObpSetLanEnabledRequest {
    pub enabled: bool,
}

/// Turns the LAN listener on or off (persisted).
// @backend-command
pub async fn obp_set_lan_enabled(request: ObpSetLanEnabledRequest) -> Result<ObpStatus, String> {
    let server = global_server().ok_or_else(unavailable)?;
    server.set_lan_enabled(request.enabled).await?;
    Ok(server.status())
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ObpCreatePairingRequest {
    /// What the desktop lists the new client as (default "Phone or browser").
    pub name: Option<String>,
    /// Where the phone reaches this device: `lan` (default; same network) or
    /// `mesh` (anywhere, after joining the account mesh with the EasyTier app).
    pub via: Option<String>,
}

/// A one-time pairing QR for the LAN listener, or for the device-mesh
/// listener with `via: "mesh"` (valid for five minutes).
// @backend-command
pub async fn obp_create_pairing(request: ObpCreatePairingRequest) -> Result<PairingOffer, String> {
    let server = global_server().ok_or_else(unavailable)?;
    match request.via.as_deref().map(str::trim).unwrap_or("lan") {
        "" | "lan" => server.create_pairing(request.name),
        "mesh" => {
            let status = crate::mesh::global()
                .map(|runtime| runtime.status())
                .ok_or_else(|| {
                    "mesh_unavailable: this host does not run the device mesh; use the native desktop app"
                        .to_string()
                })?;
            let virtual_ip = status.virtual_ip.ok_or_else(|| {
                format!(
                    "mesh_unavailable: the device mesh is not connected ({:?}){}",
                    status.state,
                    status
                        .reason
                        .map(|reason| format!("; {reason}"))
                        .unwrap_or_default()
                )
            })?;
            server.create_mesh_pairing(request.name, &virtual_ip)
        }
        other => Err(format!(
            "unsupported pairing route '{other}'; expected \"lan\" or \"mesh\""
        )),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObpRevokePairedClientRequest {
    pub client_id: String,
}

/// Revokes a paired client and closes its open connections.
// @backend-command
pub async fn obp_revoke_paired_client(
    request: ObpRevokePairedClientRequest,
) -> Result<ObpStatus, String> {
    let server = global_server().ok_or_else(unavailable)?;
    server.revoke(&request.client_id)?;
    Ok(server.status())
}

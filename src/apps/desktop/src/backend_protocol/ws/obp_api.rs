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
#[tauri::command]
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
#[tauri::command]
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
}

/// A one-time pairing QR for the LAN listener (valid for five minutes).
#[tauri::command]
pub async fn obp_create_pairing(request: ObpCreatePairingRequest) -> Result<PairingOffer, String> {
    let server = global_server().ok_or_else(unavailable)?;
    server.create_pairing(request.name)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObpRevokePairedClientRequest {
    pub client_id: String,
}

/// Revokes a paired client and closes its open connections.
#[tauri::command]
pub async fn obp_revoke_paired_client(
    request: ObpRevokePairedClientRequest,
) -> Result<ObpStatus, String> {
    let server = global_server().ok_or_else(unavailable)?;
    server.revoke(&request.client_id)?;
    Ok(server.status())
}

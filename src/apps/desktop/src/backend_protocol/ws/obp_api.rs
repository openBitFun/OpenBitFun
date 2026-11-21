//! Owner commands of the browser/phone listeners (Devices scene). All are
//! `ControllerLocal` in the Product Operation Registry: a paired client can
//! never mint pairing codes, list or revoke other clients, or read the owner
//! link. The LAN listener and its switch (`obp_set_lan_enabled`) were
//! retired: phones pair over the account device mesh.
//!
//! One command here is `Proxied` instead: `ui_bundle_manifest`, the web UI
//! bundle (`nsh-web`) a browser loads from this device. The browser calls it
//! over the end-to-end channel (`account-device` scope), so the device key
//! authenticates the manifest; the files then come by hash through the
//! server's pool, which pulls them from this device's mesh listener
//! (`GET /obp-ui/v1/<sha256>`, `openbitfun_obp::server`).

use std::sync::{Arc, OnceLock};

use serde::Deserialize;
use serde_json::Value;

use super::{
    default_web_root, global_server, unavailable_status, ObpStatus, PairingOffer, UiBundleSource,
};

/// The refusal for LAN pairing (older UIs still offer it).
pub(crate) const LAN_PAIRING_RETIRED: &str = "obp_lan_retired: pairing on the local network was retired; join the phone to the account device mesh and scan the mesh QR code in Devices (devices on the same network connect directly through the mesh)";

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

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ObpCreatePairingRequest {
    /// What the desktop lists the new client as (default "Phone or browser").
    pub name: Option<String>,
    /// Where the phone reaches this device: `mesh` (the default and the only
    /// route; the phone joined the account device mesh). `lan` was retired.
    pub via: Option<String>,
}

/// A one-time pairing QR for the device-mesh listener (valid for five
/// minutes). Older UIs that ask for `via: "lan"` get an explicit refusal.
// @backend-command
pub async fn obp_create_pairing(request: ObpCreatePairingRequest) -> Result<PairingOffer, String> {
    let via = request.via.as_deref().map(str::trim).unwrap_or("mesh");
    if via == "lan" {
        return Err(LAN_PAIRING_RETIRED.to_string());
    }
    let server = global_server().ok_or_else(unavailable)?;
    match via {
        "" | "mesh" => {
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
            "unsupported pairing route '{other}'; expected \"mesh\""
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

/// `ui_bundle_manifest` takes an empty request (`{ request: {} }`).
#[derive(Debug, Default, Deserialize)]
#[serde(default)]
pub struct UiBundleManifestRequest {}

/// The bundle when this process runs no OBP server (its listener is off):
/// the same web root the server would use.
fn standalone_source() -> Arc<UiBundleSource> {
    static SOURCE: OnceLock<Arc<UiBundleSource>> = OnceLock::new();
    Arc::clone(SOURCE.get_or_init(|| {
        Arc::new(match default_web_root() {
            Some(root) => UiBundleSource::directory(root),
            None => UiBundleSource::unavailable(
                "this desktop build ships no web UI bundle (nsh-web); update OpenBitFun on this device",
            ),
        })
    }))
}

/// The web UI manifest this device ships and its bundle id
/// (`{manifest, bundleId}`), or `ui_bundle_unavailable: <reason>`.
// @backend-command
pub async fn ui_bundle_manifest(request: UiBundleManifestRequest) -> Result<Value, String> {
    let UiBundleManifestRequest {} = request;
    match global_server() {
        Some(server) => server.ui_bundle_manifest().await,
        None => openbitfun_obp::server::ui_bundle_manifest(standalone_source()).await,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn lan_pairing_is_refused_as_retired() {
        let refused = obp_create_pairing(ObpCreatePairingRequest {
            name: None,
            via: Some("lan".to_string()),
        })
        .await
        .unwrap_err();
        assert!(refused.starts_with("obp_lan_retired:"), "{refused}");
    }

    /// Through the generated dispatcher, as a browser's call arrives: the
    /// manifest with its recomputed id, or the explicit unavailable state
    /// (this build's web root may have no bundle or no manifest).
    #[tokio::test]
    async fn the_web_ui_manifest_is_served_or_explicitly_unavailable() {
        match ui_bundle_manifest(UiBundleManifestRequest {}).await {
            Ok(answer) => assert_eq!(
                answer["bundleId"],
                openbitfun_obp::ui_bundle::bundle_id(&answer["manifest"]).unwrap()
            ),
            Err(reason) => assert!(reason.starts_with("ui_bundle_unavailable: "), "{reason}"),
        }
        let request: UiBundleManifestRequest =
            serde_json::from_value(serde_json::json!({})).unwrap();
        let UiBundleManifestRequest {} = request;
    }
}

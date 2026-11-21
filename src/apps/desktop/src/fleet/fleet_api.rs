//! The fleet backend commands of the desktop host.
//!
//! `fleet_call`, `fleet_navigator`, `fleet_prompts`, `fleet_attention`,
//! `fleet_recent_sessions`, `fleet_device_detail`, `fleet_models` and
//! `fleet_ui_bundle`
//! serve every client of this host (the native UI, and phones and browsers
//! over the mesh in the `account-device` scope). `fleet_subscribe` and
//! `fleet_events` serve the native UI in-process: OBP connections answer them
//! in the connection layer, so they never reach these handlers from a mesh
//! client. The owner verbs `fleet_digest` / `fleet_replay` are mesh host
//! verbs ([`owner_verb`], routed by `backend_protocol::ws::mesh_verbs`).

use openbitfun_obp::fleet::FleetCallError;
use openbitfun_product_domains::fleet::{
    FleetAttentionMarkReadRequest, FleetAttentionMarkReadResponse, FleetAttentionRequest,
    FleetAttentionView, FleetCallRequest, FleetDeviceDetail, FleetDeviceDetailRequest,
    FleetEventsRequest, FleetEventsResponse, FleetModels, FleetModelsRequest, FleetNavigator,
    FleetNavigatorRequest, FleetPromptsRequest, FleetPromptsResponse, FleetRecentSessions,
    FleetRecentSessionsRequest, FleetSubscribeRequest, FleetSubscribeResponse,
    FleetUiBundleRequest, FleetUiBundleResponse,
};
use serde_json::Value;

/// `fleet_call {target, command, args}`: runs here or on the owner device.
// @backend-command
pub async fn fleet_call(request: FleetCallRequest) -> Result<Value, String> {
    super::require("fleet_call")?
        .router()
        .fleet_call(request)
        .await
        .map_err(FleetCallError::into_message)
}

/// `fleet_navigator {sinceRevision?}`: every device, workspace and session.
// @backend-command
pub async fn fleet_navigator(request: FleetNavigatorRequest) -> Result<FleetNavigator, String> {
    Ok(super::require("fleet_navigator")?
        .router()
        .navigator(request))
}

/// `fleet_prompts`: the pending prompts of every device.
// @backend-command
pub async fn fleet_prompts(request: FleetPromptsRequest) -> Result<FleetPromptsResponse, String> {
    let _ = request;
    Ok(super::require("fleet_prompts")?.router().prompts())
}

/// `fleet_attention`: the Inbox of every device (prompts, the cloud
/// agent's jobs that need the user, unread Done and Failed items).
// @backend-command
pub async fn fleet_attention(request: FleetAttentionRequest) -> Result<FleetAttentionView, String> {
    let _ = request;
    Ok(super::require("fleet_attention")?.attention().view().await)
}

/// `fleet_attention_mark_read {revision}`: marks the Done and Failed items
/// of the view served at `revision` read (read state lives with this entry).
// @backend-command
pub async fn fleet_attention_mark_read(
    request: FleetAttentionMarkReadRequest,
) -> Result<FleetAttentionMarkReadResponse, String> {
    Ok(super::require("fleet_attention_mark_read")?
        .attention()
        .mark_read(request.revision))
}

/// `fleet_recent_sessions {limit?, cursor?}`: All sessions › Recent, every
/// device's sessions newest first with device and workspace labels.
// @backend-command
pub async fn fleet_recent_sessions(
    request: FleetRecentSessionsRequest,
) -> Result<FleetRecentSessions, String> {
    Ok(super::require("fleet_recent_sessions")?
        .views()
        .recent_sessions(&request))
}

/// `fleet_models {deviceId?}`: every device's models grouped by device,
/// the device that runs the session first, with each device's online state.
// @backend-command
pub async fn fleet_models(request: FleetModelsRequest) -> Result<FleetModels, String> {
    Ok(super::require("fleet_models")?.views().models(&request))
}

/// `fleet_device_detail {deviceId}`: the device page (facts, route,
/// workspaces, what runs there now and what waits to start).
// @backend-command
pub async fn fleet_device_detail(
    request: FleetDeviceDetailRequest,
) -> Result<FleetDeviceDetail, String> {
    super::require("fleet_device_detail")?
        .views()
        .device_detail(&request)
        .await
}

/// `fleet_subscribe {follow}` for the native UI.
// @backend-command
pub async fn fleet_subscribe(
    request: FleetSubscribeRequest,
) -> Result<FleetSubscribeResponse, String> {
    super::require("fleet_subscribe")?.subscribe(request).await
}

/// `fleet_events {cursor, waitMs}`: the native UI's long poll for the
/// events of other devices (its own stay in-process).
// @backend-command
pub async fn fleet_events(request: FleetEventsRequest) -> Result<FleetEventsResponse, String> {
    Ok(super::require("fleet_events")?.events(request).await)
}

/// `fleet_ui_bundle`: the web UI a browser loads through this entry.
// @backend-command
pub async fn fleet_ui_bundle(
    request: FleetUiBundleRequest,
) -> Result<FleetUiBundleResponse, String> {
    let _ = request;
    super::require("fleet_ui_bundle")?.ui_bundle().await
}

/// The owner verbs another runtime host calls on the mesh listener.
pub(crate) async fn owner_verb(command: String, args: Value) -> Result<Value, String> {
    let host = super::require(&command)?;
    host.dispatch(&command, args, &super::instance_id())
        .await
        .unwrap_or_else(|| Err(format!("unknown fleet owner verb {command}")))
}

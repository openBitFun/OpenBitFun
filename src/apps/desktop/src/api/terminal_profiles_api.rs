//! Saved terminal profiles, owned by the host config (logic batch 5).
//!
//! Each client used to keep its own list in local storage, so a profile saved
//! in one window never reached another client of the same backend (a browser,
//! a phone, a controlling desktop). The list now lives at `terminal.profiles`,
//! keyed by workspace id, and the shared rules in
//! `settings_mutations::terminal_profiles` decide names, ids and the cap.

use crate::api::app_state::AppState;
use crate::host::{HostHandle, State};
use crate::openbitfun_control_host::mutate_config_from_gui;
use openbitfun_core::service::config::settings_mutations::terminal_profiles::{
    self, TerminalProfileInput, TerminalProfileView, MAX_TERMINAL_PROFILES_PER_WORKSPACE,
    TERMINAL_PROFILES_PATH,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

fn mint_profile_id() -> String {
    let id = uuid::Uuid::new_v4().simple().to_string();
    format!("tp_{}", &id[..12])
}

async fn read_profiles(state: &AppState) -> Result<Value, String> {
    match state
        .config_service
        .get_config::<Value>(Some(TERMINAL_PROFILES_PATH))
        .await
    {
        Ok(value) => Ok(value),
        Err(openbitfun_core::util::errors::OpenBitFunError::NotFound(_)) => Ok(Value::Null),
        Err(error) => Err(error.to_string()),
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalProfilesResponse {
    pub workspace_id: String,
    pub profiles: Vec<TerminalProfileView>,
    pub max_profiles: usize,
    /// The profile the call wrote (upsert only).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    /// Import only: rows added and rows skipped (duplicate, nameless, past the cap).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub imported: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skipped: Option<usize>,
}

impl TerminalProfilesResponse {
    fn of(stored: &Value, workspace_id: &str) -> Self {
        Self {
            workspace_id: workspace_id.to_string(),
            profiles: terminal_profiles::terminal_profiles_for(stored, workspace_id),
            max_profiles: MAX_TERMINAL_PROFILES_PER_WORKSPACE,
            id: None,
            imported: None,
            skipped: None,
        }
    }
}

fn workspace_id_of(raw: &str) -> Result<String, String> {
    let id = raw.trim();
    if id.is_empty() {
        return Err("workspace_id is required".to_string());
    }
    Ok(id.to_string())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetTerminalProfilesRequest {
    pub workspace_id: String,
}

/// The profiles one workspace keeps.
// @backend-command
pub async fn get_terminal_profiles(
    state: State<'_, AppState>,
    request: GetTerminalProfilesRequest,
) -> Result<TerminalProfilesResponse, String> {
    let workspace_id = workspace_id_of(&request.workspace_id)?;
    let stored = read_profiles(&state).await?;
    Ok(TerminalProfilesResponse::of(&stored, &workspace_id))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertTerminalProfileRequest {
    pub workspace_id: String,
    pub profile: TerminalProfileInput,
}

/// Creates or edits one profile; the host mints ids and enforces the rules.
// @backend-command
pub async fn upsert_terminal_profile(
    app: HostHandle,
    request: UpsertTerminalProfileRequest,
) -> Result<TerminalProfilesResponse, String> {
    let workspace_id = workspace_id_of(&request.workspace_id)?;
    let mut written = None;
    let stored = mutate_config_from_gui(&app, TERMINAL_PROFILES_PATH, |current| {
        let outcome = terminal_profiles::upsert_terminal_profile(
            current,
            &workspace_id,
            &request.profile,
            &mut mint_profile_id,
        )?;
        written = Some(outcome.id);
        Ok(outcome.profiles)
    })
    .await?;
    let mut response = TerminalProfilesResponse::of(&stored, &workspace_id);
    response.id = written;
    Ok(response)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteTerminalProfileRequest {
    pub workspace_id: String,
    pub profile_id: String,
}

// @backend-command
pub async fn delete_terminal_profile(
    app: HostHandle,
    request: DeleteTerminalProfileRequest,
) -> Result<TerminalProfilesResponse, String> {
    let workspace_id = workspace_id_of(&request.workspace_id)?;
    let stored = mutate_config_from_gui(&app, TERMINAL_PROFILES_PATH, |current| {
        terminal_profiles::delete_terminal_profile(current, &workspace_id, &request.profile_id)
    })
    .await?;
    Ok(TerminalProfilesResponse::of(&stored, &workspace_id))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportTerminalProfilesRequest {
    pub workspace_id: String,
    #[serde(default)]
    pub profiles: Vec<TerminalProfileInput>,
}

/// One-time migration of a client's locally kept profiles into the host.
// @backend-command
pub async fn import_terminal_profiles(
    app: HostHandle,
    request: ImportTerminalProfilesRequest,
) -> Result<TerminalProfilesResponse, String> {
    let workspace_id = workspace_id_of(&request.workspace_id)?;
    let mut counts = (0, 0);
    let stored = mutate_config_from_gui(&app, TERMINAL_PROFILES_PATH, |current| {
        let outcome = terminal_profiles::import_terminal_profiles(
            current,
            &workspace_id,
            &request.profiles,
            &mut mint_profile_id,
        )?;
        counts = (outcome.imported, outcome.skipped);
        Ok(outcome.profiles)
    })
    .await?;
    let mut response = TerminalProfilesResponse::of(&stored, &workspace_id);
    response.imported = Some(counts.0);
    response.skipped = Some(counts.1);
    Ok(response)
}

//! Saved terminal profiles for the CLI Peer Host.
//!
//! The same commands the desktop serves (`terminal_profiles_api.rs`): the list
//! lives at `terminal.profiles` keyed by workspace id and the shared
//! `settings_mutations::terminal_profiles` rules decide names, ids and the cap.

use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::{json, Value};

use openbitfun_core::agentic::tools::openbitfun_control_config::global_shared_product_control_executor;
use openbitfun_core::service::config::settings_mutations::terminal_profiles::{
    self, TerminalProfileInput, MAX_TERMINAL_PROFILES_PER_WORKSPACE, TERMINAL_PROFILES_PATH,
};

use crate::peer_host::args::request_value;

fn parse<T: DeserializeOwned>(args: &Value) -> Result<T, String> {
    serde_json::from_value(request_value(args).clone())
        .map_err(|error| format!("Invalid request: {error}"))
}

fn mint_profile_id() -> String {
    let id = uuid::Uuid::new_v4().simple().to_string();
    format!("tp_{}", &id[..12])
}

fn workspace_id_of(raw: &str) -> Result<String, String> {
    let id = raw.trim();
    if id.is_empty() {
        return Err("workspace_id is required".to_string());
    }
    Ok(id.to_string())
}

fn response(stored: &Value, workspace_id: &str) -> Value {
    json!({
        "workspaceId": workspace_id,
        "profiles": terminal_profiles::terminal_profiles_for(stored, workspace_id),
        "maxProfiles": MAX_TERMINAL_PROFILES_PER_WORKSPACE,
    })
}

async fn mutate(apply: impl FnOnce(&Value) -> Result<Value, String>) -> Result<Value, String> {
    global_shared_product_control_executor()
        .await?
        .mutate_legacy_path(TERMINAL_PROFILES_PATH, apply)
        .await
}

pub(crate) async fn get(args: &Value) -> Result<Value, String> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Request {
        workspace_id: String,
    }
    let request: Request = parse(args)?;
    let workspace_id = workspace_id_of(&request.workspace_id)?;
    let stored = match openbitfun_core::service::config::get_global_config_service()
        .await
        .map_err(|error| error.to_string())?
        .get_config::<Value>(Some(TERMINAL_PROFILES_PATH))
        .await
    {
        Ok(value) => value,
        Err(openbitfun_core::util::errors::OpenBitFunError::NotFound(_)) => Value::Null,
        Err(error) => return Err(error.to_string()),
    };
    Ok(response(&stored, &workspace_id))
}

pub(crate) async fn upsert(args: &Value) -> Result<Value, String> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Request {
        workspace_id: String,
        profile: TerminalProfileInput,
    }
    let request: Request = parse(args)?;
    let workspace_id = workspace_id_of(&request.workspace_id)?;
    let mut written = None;
    let stored = mutate(|current| {
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
    let mut value = response(&stored, &workspace_id);
    value["id"] = json!(written);
    Ok(value)
}

pub(crate) async fn delete(args: &Value) -> Result<Value, String> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Request {
        workspace_id: String,
        profile_id: String,
    }
    let request: Request = parse(args)?;
    let workspace_id = workspace_id_of(&request.workspace_id)?;
    let stored = mutate(|current| {
        terminal_profiles::delete_terminal_profile(current, &workspace_id, &request.profile_id)
    })
    .await?;
    Ok(response(&stored, &workspace_id))
}

pub(crate) async fn import(args: &Value) -> Result<Value, String> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Request {
        workspace_id: String,
        #[serde(default)]
        profiles: Vec<TerminalProfileInput>,
    }
    let request: Request = parse(args)?;
    let workspace_id = workspace_id_of(&request.workspace_id)?;
    let mut counts = (0, 0);
    let stored = mutate(|current| {
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
    let mut value = response(&stored, &workspace_id);
    value["imported"] = json!(counts.0);
    value["skipped"] = json!(counts.1);
    Ok(value)
}

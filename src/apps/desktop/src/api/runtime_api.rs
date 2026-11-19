//! Runtime capability API

use crate::api::app_state::AppState;
use crate::host::State;
use openbitfun_core::service::runtime::{RuntimeCommandCapability, RuntimeManager};
#[tauri::command]
pub async fn get_runtime_capabilities(
    _state: State<'_, AppState>,
) -> Result<Vec<RuntimeCommandCapability>, String> {
    let manager = RuntimeManager::new().map_err(|e| e.to_string())?;
    Ok(manager.get_capabilities())
}

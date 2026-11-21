//! Typed settings mutations.
//!
//! Each command carries one user intent instead of a whole config document,
//! applies the shared rule from `settings_mutations` to the value stored right
//! now, commits through the GUI config transaction and returns the updated
//! view. Clients therefore never write a document they read at page load.

use crate::api::app_state::AppState;
use crate::host::{HostHandle, State};
use crate::openbitfun_control_host::mutate_config_from_gui;
use openbitfun_core::service::config::settings_mutations::{
    self, AiModelUpsertRequest, ApprovalSettingsRequest, PermissionRuleInput,
    PermissionRuleUpsertRequest, SuperagentSettingsRequest, WebSearchProviderRequest,
    SUPERAGENT_PATH,
};
use serde::Deserialize;
use serde_json::{json, Value};

const MODELS_PATH: &str = "ai.models";
const TASK_MODELS_PATH: &str = "ai.task_models";
const PERMISSIONS_PATH: &str = "tool_permissions";
const WEB_SEARCH_PATH: &str = "ai.web_search";

fn mint_model_id() -> String {
    let id = uuid::Uuid::new_v4().simple().to_string();
    format!("model_{}", &id[..12])
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiModelUpsertCommandRequest {
    pub models: Vec<AiModelUpsertRequest>,
}

/// Creates or edits models. The host mints ids, normalizes the request
/// format, clamps the output limit, derives the stored request URL and fills
/// capability defaults; the response is the stored list after the write.
// @backend-command
pub async fn ai_model_upsert(
    app: HostHandle,
    request: AiModelUpsertCommandRequest,
) -> Result<Value, String> {
    let mut written = None;
    let models = mutate_config_from_gui(&app, MODELS_PATH, |current| {
        let outcome =
            settings_mutations::upsert_ai_models(current, &request.models, &mut mint_model_id)?;
        written = Some((outcome.ids, outcome.clamped_ids));
        Ok(outcome.models)
    })
    .await?;
    let (ids, clamped_ids) = written.unwrap_or_default();
    Ok(json!({ "models": models, "ids": ids, "clampedIds": clamped_ids }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiModelDeleteRequest {
    pub id: String,
}

/// Removes one model. Default-model slots, task selections and agent defaults
/// that named it are repaired by the config owner's model reconciliation.
// @backend-command
pub async fn ai_model_delete(
    app: HostHandle,
    state: State<'_, AppState>,
    request: AiModelDeleteRequest,
) -> Result<Value, String> {
    let models = mutate_config_from_gui(&app, MODELS_PATH, |current| {
        settings_mutations::delete_ai_model(current, &request.id)
    })
    .await?;
    let default_models = state
        .config_service
        .get_config::<Value>(Some("ai.default_models"))
        .await
        .unwrap_or(Value::Null);
    Ok(json!({ "models": models, "defaultModels": default_models }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveAiModelRequestUrlRequest {
    #[serde(default)]
    pub base_url: String,
    #[serde(default)]
    pub provider: String,
    #[serde(default)]
    pub model_name: String,
}

/// The request URL a save would store and the URL the editor previews.
// @backend-command
pub async fn resolve_ai_model_request_url(
    request: ResolveAiModelRequestUrlRequest,
) -> Result<Value, String> {
    let provider = settings_mutations::normalize_model_provider(&request.provider);
    Ok(json!({
        "provider": provider,
        "requestUrl": settings_mutations::stored_request_url(&request.base_url, &provider),
        "previewUrl": settings_mutations::preview_request_url(
            &request.base_url,
            &provider,
            &request.model_name,
        ),
    }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetTaskModelRequest {
    pub task: String,
    /// `{"kind":"inherit"}` or `{"kind":"fixed","model_id":...}`; the legacy
    /// externally tagged shapes are accepted too.
    pub selection: Value,
}

// @backend-command
pub async fn set_task_model(
    app: HostHandle,
    request: SetTaskModelRequest,
) -> Result<Value, String> {
    let stored = mutate_config_from_gui(&app, TASK_MODELS_PATH, |current| {
        settings_mutations::set_task_model(current, &request.task, &request.selection)
    })
    .await?;
    Ok(json!({ "taskModels": settings_mutations::task_models_view(&stored) }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetPermissionModeRequest {
    pub mode: String,
}

fn permission_view(stored: Value) -> Result<Value, String> {
    settings_mutations::permission_settings_view(&stored)
}

/// Switches the user-level permission mode (`ask`, `auto`, `full_access`),
/// keeping the rule list and the approval tuning.
// @backend-command
pub async fn set_permission_mode(
    app: HostHandle,
    request: SetPermissionModeRequest,
) -> Result<Value, String> {
    let stored = mutate_config_from_gui(&app, PERMISSIONS_PATH, |current| {
        settings_mutations::set_permission_mode(current, &request.mode)
    })
    .await?;
    permission_view(stored)
}

// @backend-command
pub async fn upsert_permission_rule(
    app: HostHandle,
    request: PermissionRuleUpsertRequest,
) -> Result<Value, String> {
    let stored = mutate_config_from_gui(&app, PERMISSIONS_PATH, |current| {
        settings_mutations::upsert_permission_rule(current, request.clone())
    })
    .await?;
    permission_view(stored)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeletePermissionRuleRequest {
    pub index: usize,
    #[serde(default)]
    pub expected: Option<PermissionRuleInput>,
}

// @backend-command
pub async fn delete_permission_rule(
    app: HostHandle,
    request: DeletePermissionRuleRequest,
) -> Result<Value, String> {
    let stored = mutate_config_from_gui(&app, PERMISSIONS_PATH, |current| {
        settings_mutations::delete_permission_rule(
            current,
            request.index,
            request.expected.as_ref(),
        )
    })
    .await?;
    permission_view(stored)
}

// @backend-command
pub async fn set_approval_settings(
    app: HostHandle,
    request: ApprovalSettingsRequest,
) -> Result<Value, String> {
    let stored = mutate_config_from_gui(&app, PERMISSIONS_PATH, |current| {
        settings_mutations::set_approval_settings(current, request.clone())
    })
    .await?;
    permission_view(stored)
}

// @backend-command
pub async fn set_web_search_provider(
    app: HostHandle,
    request: WebSearchProviderRequest,
) -> Result<Value, String> {
    mutate_config_from_gui(&app, WEB_SEARCH_PATH, |current| {
        settings_mutations::set_web_search_provider(current, request.clone())
    })
    .await
}

/// This device's switches for the account's cloud agent
/// (`superagent.acceptDispatch`, `superagent.allowAutoApproval`); the
/// response is the stored section. The device enforces them on every
/// cloud-agent call.
// @backend-command
pub async fn set_superagent_settings(
    app: HostHandle,
    request: SuperagentSettingsRequest,
) -> Result<Value, String> {
    mutate_config_from_gui(&app, SUPERAGENT_PATH, |current| {
        settings_mutations::set_superagent_settings(current, &request)
    })
    .await
}

#[derive(Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct GetSettingsSchemaRequest {
    /// Paths to describe; empty describes every catalog-bound path.
    pub paths: Vec<String>,
}

/// Field bounds, enums and defaults the backend enforces, so a settings
/// surface draws them instead of keeping literal copies.
// @backend-command
pub async fn get_settings_schema(
    request: Option<GetSettingsSchemaRequest>,
) -> Result<Value, String> {
    settings_mutations::settings_descriptor(&request.unwrap_or_default().paths)
}

/// The permission settings page view (logic batch 4): mode, rules, approval
/// tuning, the approval model choices and whether the composer shows the mode
/// control, read and projected by the backend in one call.
// @backend-command
pub async fn get_permission_settings(state: State<'_, AppState>) -> Result<Value, String> {
    let config = &state.config_service;
    let read = |path: &'static str| async move {
        config
            .get_config::<Value>(Some(path))
            .await
            .unwrap_or(Value::Null)
    };
    let permissions = read(PERMISSIONS_PATH).await;
    let models = read(MODELS_PATH).await;
    let default_models = read("ai.default_models").await;
    let show_mode_control = read("app.flow_chat.show_permission_mode_control").await;
    settings_mutations::permission_page_view(
        &permissions,
        &models,
        &default_models,
        &show_mode_control,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn requests_read_the_wire_shapes_clients_send() {
        let upsert: AiModelUpsertCommandRequest = serde_json::from_value(json!({
            "models": [{"name": "A", "modelName": "a", "baseUrl": "https://x.test", "maxTokens": null}]
        }))
        .unwrap();
        assert_eq!(upsert.models.len(), 1);
        assert_eq!(upsert.models[0].max_tokens, Some(None));
        assert_eq!(upsert.models[0].context_window, None);

        let task: SetTaskModelRequest = serde_json::from_value(json!({
            "task": "git_commit", "selection": "Inherit"
        }))
        .unwrap();
        assert_eq!(task.selection, json!("Inherit"));

        let rule: PermissionRuleUpsertRequest = serde_json::from_value(json!({
            "index": 1, "rule": {"action": "bash", "resource": "*", "effect": "deny"}
        }))
        .unwrap();
        assert_eq!(rule.index, Some(1));

        let delete: DeletePermissionRuleRequest =
            serde_json::from_value(json!({"index": 0})).unwrap();
        assert!(delete.expected.is_none());

        let approval: ApprovalSettingsRequest =
            serde_json::from_value(json!({"timeoutSeconds": 30, "onError": "reject"})).unwrap();
        assert_eq!(approval.timeout_seconds, Some(30));

        let search: WebSearchProviderRequest =
            serde_json::from_value(json!({"provider": "tavily"})).unwrap();
        assert_eq!(search.provider.as_deref(), Some("tavily"));

        let superagent: SuperagentSettingsRequest =
            serde_json::from_value(json!({"allowAutoApproval": false})).unwrap();
        assert_eq!(superagent.allow_auto_approval, Some(false));

        let schema: GetSettingsSchemaRequest = serde_json::from_value(json!({})).unwrap();
        assert!(schema.paths.is_empty());
    }

    #[test]
    fn minted_model_ids_are_unique_and_prefixed() {
        let first = mint_model_id();
        let second = mint_model_id();
        assert!(first.starts_with("model_"));
        assert_ne!(first, second);
    }

    #[tokio::test]
    async fn request_url_resolution_is_the_stored_rule() {
        let resolved = resolve_ai_model_request_url(ResolveAiModelRequestUrlRequest {
            base_url: "https://api.test/v1".into(),
            provider: "Response".into(),
            model_name: String::new(),
        })
        .await
        .unwrap();
        assert_eq!(resolved["provider"], "responses");
        assert_eq!(resolved["requestUrl"], "https://api.test/v1/responses");
    }
}

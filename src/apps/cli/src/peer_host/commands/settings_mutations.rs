//! Typed settings mutations for the CLI Peer Host.
//!
//! The same intents the desktop serves (`settings_mutation_api.rs`), applied
//! with the shared `settings_mutations` rules under the shared product-control
//! executor, so a controller driving this CLI never writes whole documents.

use serde::de::DeserializeOwned;
use serde_json::{json, Value};

use openbitfun_core::agentic::tools::openbitfun_control_config::global_shared_product_control_executor;
use openbitfun_core::service::config::settings_mutations::{
    self, AiModelUpsertRequest, ApprovalSettingsRequest, PermissionRuleInput,
    PermissionRuleUpsertRequest, SuperagentSettingsRequest, WebSearchProviderRequest,
    SUPERAGENT_PATH,
};

use crate::peer_host::args::request_value;

fn parse<T: DeserializeOwned>(args: &Value) -> Result<T, String> {
    serde_json::from_value(request_value(args).clone())
        .map_err(|error| format!("Invalid request: {error}"))
}

async fn mutate(
    path: &str,
    apply: impl FnOnce(&Value) -> Result<Value, String>,
) -> Result<Value, String> {
    global_shared_product_control_executor()
        .await?
        .mutate_legacy_path(path, apply)
        .await
}

fn mint_model_id() -> String {
    let id = uuid::Uuid::new_v4().simple().to_string();
    format!("model_{}", &id[..12])
}

pub(crate) async fn ai_model_upsert(args: &Value) -> Result<Value, String> {
    #[derive(serde::Deserialize)]
    struct Request {
        models: Vec<AiModelUpsertRequest>,
    }
    let request: Request = parse(args)?;
    let mut written = None;
    let models = mutate("ai.models", |current| {
        let outcome =
            settings_mutations::upsert_ai_models(current, &request.models, &mut mint_model_id)?;
        written = Some((outcome.ids, outcome.clamped_ids));
        Ok(outcome.models)
    })
    .await?;
    let (ids, clamped_ids) = written.unwrap_or_default();
    Ok(json!({ "models": models, "ids": ids, "clampedIds": clamped_ids }))
}

pub(crate) async fn ai_model_delete(args: &Value) -> Result<Value, String> {
    #[derive(serde::Deserialize)]
    struct Request {
        id: String,
    }
    let request: Request = parse(args)?;
    let models = mutate("ai.models", |current| {
        settings_mutations::delete_ai_model(current, &request.id)
    })
    .await?;
    let default_models = openbitfun_core::service::config::get_global_config_service()
        .await
        .map_err(|error| error.to_string())?
        .get_config::<Value>(Some("ai.default_models"))
        .await
        .unwrap_or(Value::Null);
    Ok(json!({ "models": models, "defaultModels": default_models }))
}

pub(crate) async fn set_task_model(args: &Value) -> Result<Value, String> {
    #[derive(serde::Deserialize)]
    struct Request {
        task: String,
        selection: Value,
    }
    let request: Request = parse(args)?;
    let stored = mutate("ai.task_models", |current| {
        settings_mutations::set_task_model(current, &request.task, &request.selection)
    })
    .await?;
    Ok(json!({ "taskModels": settings_mutations::task_models_view(&stored) }))
}

pub(crate) async fn set_permission_mode(args: &Value) -> Result<Value, String> {
    #[derive(serde::Deserialize)]
    struct Request {
        mode: String,
    }
    let request: Request = parse(args)?;
    let stored = mutate("tool_permissions", |current| {
        settings_mutations::set_permission_mode(current, &request.mode)
    })
    .await?;
    settings_mutations::permission_settings_view(&stored)
}

pub(crate) async fn upsert_permission_rule(args: &Value) -> Result<Value, String> {
    let request: PermissionRuleUpsertRequest = parse(args)?;
    let stored = mutate("tool_permissions", |current| {
        settings_mutations::upsert_permission_rule(current, request)
    })
    .await?;
    settings_mutations::permission_settings_view(&stored)
}

pub(crate) async fn delete_permission_rule(args: &Value) -> Result<Value, String> {
    #[derive(serde::Deserialize)]
    struct Request {
        index: usize,
        #[serde(default)]
        expected: Option<PermissionRuleInput>,
    }
    let request: Request = parse(args)?;
    let stored = mutate("tool_permissions", |current| {
        settings_mutations::delete_permission_rule(
            current,
            request.index,
            request.expected.as_ref(),
        )
    })
    .await?;
    settings_mutations::permission_settings_view(&stored)
}

pub(crate) async fn set_approval_settings(args: &Value) -> Result<Value, String> {
    let request: ApprovalSettingsRequest = parse(args)?;
    let stored = mutate("tool_permissions", |current| {
        settings_mutations::set_approval_settings(current, request)
    })
    .await?;
    settings_mutations::permission_settings_view(&stored)
}

pub(crate) async fn set_web_search_provider(args: &Value) -> Result<Value, String> {
    let request: WebSearchProviderRequest = parse(args)?;
    mutate("ai.web_search", |current| {
        settings_mutations::set_web_search_provider(current, request)
    })
    .await
}

pub(crate) async fn set_superagent_settings(args: &Value) -> Result<Value, String> {
    let request: SuperagentSettingsRequest = parse(args)?;
    mutate(SUPERAGENT_PATH, |current| {
        settings_mutations::set_superagent_settings(current, &request)
    })
    .await
}

pub(crate) async fn get_settings_schema(args: &Value) -> Result<Value, String> {
    let paths: Vec<String> = request_value(args)
        .get("paths")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    settings_mutations::settings_descriptor(&paths)
}

/// The permission settings page view, as the desktop's `get_permission_settings`
/// answers it (logic batch 4).
pub(crate) async fn get_permission_settings() -> Result<Value, String> {
    let config = openbitfun_core::service::config::get_global_config_service()
        .await
        .map_err(|error| format!("Failed to get config service: {error}"))?;
    let read = |path: &'static str| {
        let config = config.clone();
        async move {
            config
                .get_config::<Value>(Some(path))
                .await
                .unwrap_or(Value::Null)
        }
    };
    settings_mutations::permission_page_view(
        &read("tool_permissions").await,
        &read("ai.models").await,
        &read("ai.default_models").await,
        &read("app.flow_chat.show_permission_mode_control").await,
    )
}

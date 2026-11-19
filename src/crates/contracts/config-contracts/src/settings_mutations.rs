//! Typed settings mutations.
//!
//! Each function takes the value a host currently stores at one config path
//! and one user intent, validates the intent, and returns the next value for
//! that path. Hosts read the current value, call one of these, and commit the
//! result through their own config-write transaction (with its schema checks,
//! runtime effects and model reconciliation). Clients therefore send intents
//! instead of whole documents read at page load, and the rules (id minting,
//! output-limit clamping, request-URL derivation, capability defaults,
//! permission-mode projection) live here once instead of in every client.
//!
//! Values are handled as JSON so fields this build does not know survive a
//! mutation written by an older or newer peer.

pub use crate::conversion::{preview_request_url, stored_request_url};
use crate::types::{
    AIModelConfig, ModelCapability, ModelCategory, TaskModelSelection, WebSearchConfig,
    DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS, MAX_CONFIGURED_OUTPUT_TOKENS_RATIO_PERCENT,
    MIN_MODEL_CONTEXT_WINDOW_TOKENS,
};
use openbitfun_product_domains::tool_permissions::{
    PermissionApprovalModelKind, PermissionApprovalOnAsk, PermissionApprovalOnError,
    PermissionEffect, PermissionMode, PermissionRule, ToolPermissionConfig,
};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{json, Map, Value};

/// Distinguishes an absent field (`None`, keep) from an explicit `null`
/// (`Some(None)`, clear).
fn double_option<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

// ---------------------------------------------------------------------------
// AI models (`ai.models`)
// ---------------------------------------------------------------------------

/// One model create-or-edit intent. Absent fields keep the stored value; an
/// explicit `null` clears an optional one. A request without `id` creates a
/// model whose id the host mints.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AiModelUpsertRequest {
    pub id: Option<String>,
    pub name: Option<String>,
    pub provider: Option<String>,
    pub model_name: Option<String>,
    pub base_url: Option<String>,
    pub api_key: Option<String>,
    #[serde(deserialize_with = "double_option")]
    pub context_window: Option<Option<u32>>,
    #[serde(deserialize_with = "double_option")]
    pub max_tokens: Option<Option<u32>>,
    pub category: Option<String>,
    pub capabilities: Option<Vec<String>>,
    pub enabled: Option<bool>,
    #[serde(deserialize_with = "double_option")]
    pub custom_headers: Option<Option<Map<String, Value>>>,
    #[serde(deserialize_with = "double_option")]
    pub custom_headers_mode: Option<Option<String>>,
    pub skip_ssl_verify: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AiModelUpsertOutcome {
    /// The next `ai.models` array.
    pub models: Value,
    /// The id of every model the batch wrote, in request order.
    pub ids: Vec<String>,
    /// Models whose output limit was lowered to the context-window ceiling.
    pub clamped_ids: Vec<String>,
}

/// `response` is the legacy spelling of the Responses request format.
pub fn normalize_model_provider(provider: &str) -> String {
    let value = provider.trim().to_ascii_lowercase();
    match value.as_str() {
        "" => "openai".to_string(),
        "response" => "responses".to_string(),
        _ => value,
    }
}

/// The largest output limit the runtime accepts for a context window.
pub fn max_output_tokens_ceiling(context_window: u32) -> u32 {
    (u64::from(context_window) * u64::from(MAX_CONFIGURED_OUTPUT_TOKENS_RATIO_PERCENT) / 100) as u32
}

/// The capabilities a category implies when a model stores none.
pub fn default_capabilities_for_category(category: &ModelCategory) -> Vec<ModelCapability> {
    let mut probe = AIModelConfig {
        category: category.clone(),
        capabilities: Vec::new(),
        ..AIModelConfig::default()
    };
    probe.ensure_category_and_capabilities();
    probe.capabilities
}

fn string_field(entry: &Map<String, Value>, key: &str) -> String {
    entry
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn models_array(current: &Value) -> Result<Vec<Value>, String> {
    match current {
        Value::Null => Ok(Vec::new()),
        Value::Array(items) => Ok(items.clone()),
        _ => Err("The stored model list is not an array; repair ai.models first".to_string()),
    }
}

fn valid_header_name(name: &str) -> bool {
    !name.is_empty()
        && name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"!#$%&'*+.^_`|~-".contains(&byte))
}

fn parse_category(value: &str) -> Result<ModelCategory, String> {
    serde_json::from_value(Value::String(value.trim().to_string()))
        .map_err(|_| format!("Unknown model category '{value}'"))
}

fn parse_capability(value: &str) -> Result<ModelCapability, String> {
    serde_json::from_value(Value::String(value.trim().to_string()))
        .map_err(|_| format!("Unknown model capability '{value}'"))
}

/// Applies a batch of model intents to the stored list. `mint_id` is asked for
/// a fresh id per created model; ids already in the list are skipped.
pub fn upsert_ai_models(
    current: &Value,
    requests: &[AiModelUpsertRequest],
    mint_id: &mut dyn FnMut() -> String,
) -> Result<AiModelUpsertOutcome, String> {
    if requests.is_empty() {
        return Err("No model to save".to_string());
    }
    let mut models = models_array(current)?;
    let mut ids = Vec::with_capacity(requests.len());
    let mut clamped_ids = Vec::new();
    for request in requests {
        let requested_id = request
            .id
            .as_deref()
            .map(str::trim)
            .filter(|id| !id.is_empty());
        let (index, created) = match requested_id {
            Some(id) => {
                let index = models
                    .iter()
                    .position(|entry| entry.get("id").and_then(Value::as_str) == Some(id))
                    .ok_or_else(|| {
                        format!("Model '{id}' was removed while it was being edited; reload")
                    })?;
                (index, false)
            }
            None => {
                let mut id = mint_id();
                while models
                    .iter()
                    .any(|entry| entry.get("id").and_then(Value::as_str) == Some(id.as_str()))
                {
                    id = mint_id();
                }
                let mut entry = serde_json::to_value(AIModelConfig {
                    id,
                    enabled: true,
                    ..AIModelConfig::default()
                })
                .map_err(|error| format!("Failed to build a model entry: {error}"))?;
                if let Some(object) = entry.as_object_mut() {
                    object.insert("capabilities".to_string(), Value::Array(Vec::new()));
                }
                models.push(entry);
                (models.len() - 1, true)
            }
        };
        let entry = models[index]
            .as_object_mut()
            .ok_or_else(|| "A stored model entry is not an object".to_string())?;
        let clamped = apply_model_request(entry, request, created)?;
        let id = string_field(entry, "id");
        if clamped {
            clamped_ids.push(id.clone());
        }
        ids.push(id);
    }
    Ok(AiModelUpsertOutcome {
        models: Value::Array(models),
        ids,
        clamped_ids,
    })
}

/// Returns whether the output limit was clamped.
fn apply_model_request(
    entry: &mut Map<String, Value>,
    request: &AiModelUpsertRequest,
    created: bool,
) -> Result<bool, String> {
    let before_routing = (
        string_field(entry, "base_url"),
        string_field(entry, "provider"),
        string_field(entry, "model_name"),
    );
    if let Some(name) = &request.name {
        entry.insert("name".into(), json!(name.trim()));
    }
    if let Some(provider) = &request.provider {
        entry.insert("provider".into(), json!(normalize_model_provider(provider)));
    } else if created {
        entry.insert("provider".into(), json!(normalize_model_provider("")));
    }
    if let Some(model_name) = &request.model_name {
        entry.insert("model_name".into(), json!(model_name.trim()));
    }
    if let Some(base_url) = &request.base_url {
        entry.insert("base_url".into(), json!(base_url.trim()));
    }
    if let Some(api_key) = &request.api_key {
        entry.insert("api_key".into(), json!(api_key.trim()));
    }
    if let Some(enabled) = request.enabled {
        entry.insert("enabled".into(), json!(enabled));
    }
    if let Some(skip) = request.skip_ssl_verify {
        entry.insert("skip_ssl_verify".into(), json!(skip));
    }

    for (field, label) in [
        ("name", "a name"),
        ("model_name", "a model name"),
        ("base_url", "a base URL"),
    ] {
        if string_field(entry, field).is_empty() {
            return Err(format!("A model needs {label}"));
        }
    }

    // Headers: names are HTTP tokens; the mode is `merge` or `replace`.
    if let Some(headers) = &request.custom_headers {
        match headers {
            Some(map) if !map.is_empty() => {
                let mut stored = Map::new();
                for (name, value) in map {
                    let name = name.trim();
                    if !valid_header_name(name) {
                        return Err(format!("'{name}' is not a valid HTTP header name"));
                    }
                    let value = match value {
                        Value::String(text) => text.clone(),
                        Value::Null => String::new(),
                        other => other.to_string(),
                    };
                    stored.insert(name.to_string(), Value::String(value));
                }
                entry.insert("custom_headers".into(), Value::Object(stored));
            }
            _ => {
                entry.insert("custom_headers".into(), Value::Null);
            }
        }
    }
    if let Some(mode) = &request.custom_headers_mode {
        match mode
            .as_deref()
            .map(str::trim)
            .filter(|mode| !mode.is_empty())
        {
            Some(mode @ ("merge" | "replace")) => {
                entry.insert("custom_headers_mode".into(), json!(mode));
            }
            Some(other) => {
                return Err(format!(
                    "Header mode '{other}' is not one of merge or replace"
                ))
            }
            None => {
                entry.insert("custom_headers_mode".into(), Value::Null);
            }
        }
    }
    let has_headers = entry
        .get("custom_headers")
        .and_then(Value::as_object)
        .is_some_and(|map| !map.is_empty());
    if !has_headers {
        entry.insert("custom_headers_mode".into(), Value::Null);
    }

    // Category and capabilities: a new model, or a category change, takes the
    // category's default capabilities unless the request lists its own.
    let stored_category = entry
        .get("category")
        .and_then(Value::as_str)
        .map(str::to_string);
    let mut category_changed = created;
    if let Some(category) = &request.category {
        let parsed = parse_category(category)?;
        let canonical = serde_json::to_value(&parsed)
            .map_err(|error| format!("Failed to store the model category: {error}"))?;
        category_changed |= stored_category.as_deref() != canonical.as_str();
        entry.insert("category".into(), canonical);
    }
    if let Some(capabilities) = &request.capabilities {
        let parsed = capabilities
            .iter()
            .map(|value| parse_capability(value))
            .collect::<Result<Vec<_>, _>>()?;
        entry.insert(
            "capabilities".into(),
            serde_json::to_value(parsed).map_err(|error| error.to_string())?,
        );
    } else if category_changed {
        entry.insert("capabilities".into(), Value::Array(Vec::new()));
    }
    let capabilities_empty = entry
        .get("capabilities")
        .and_then(Value::as_array)
        .is_none_or(Vec::is_empty);
    if capabilities_empty {
        let category = parse_category(
            entry
                .get("category")
                .and_then(Value::as_str)
                .unwrap_or("general_chat"),
        )?;
        entry.insert(
            "capabilities".into(),
            serde_json::to_value(default_capabilities_for_category(&category))
                .map_err(|error| error.to_string())?,
        );
    }

    // Token limits: the context window has a floor; the output limit is
    // clamped to the share of the window the runtime accepts.
    if let Some(context_window) = request.context_window {
        match context_window {
            Some(0) | None => {
                entry.insert("context_window".into(), Value::Null);
            }
            Some(value) if value < MIN_MODEL_CONTEXT_WINDOW_TOKENS => {
                return Err(format!(
                    "The context window must be at least {MIN_MODEL_CONTEXT_WINDOW_TOKENS} tokens"
                ));
            }
            Some(value) => {
                entry.insert("context_window".into(), json!(value));
            }
        }
    }
    if let Some(max_tokens) = request.max_tokens {
        match max_tokens {
            Some(0) | None => {
                entry.insert("max_tokens".into(), Value::Null);
            }
            Some(value) => {
                entry.insert("max_tokens".into(), json!(value));
            }
        }
    }
    let window = entry
        .get("context_window")
        .and_then(Value::as_u64)
        .map(|value| value as u32)
        .unwrap_or(DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS);
    let ceiling = max_output_tokens_ceiling(window);
    let mut clamped = false;
    if let Some(max_tokens) = entry.get("max_tokens").and_then(Value::as_u64) {
        if max_tokens > u64::from(ceiling) {
            entry.insert("max_tokens".into(), json!(ceiling));
            clamped = true;
        }
    }

    // Request URL: derived whenever the routing inputs change (or are new), so
    // a custom request URL another surface stored is kept until then.
    let after_routing = (
        string_field(entry, "base_url"),
        string_field(entry, "provider"),
        string_field(entry, "model_name"),
    );
    let current_request_url = string_field(entry, "request_url");
    if created || before_routing != after_routing || current_request_url.is_empty() {
        entry.insert(
            "request_url".into(),
            json!(stored_request_url(&after_routing.0, &after_routing.1)),
        );
    }

    // The entry must still read as the persisted model shape.
    serde_json::from_value::<AIModelConfig>(Value::Object(entry.clone()))
        .map_err(|error| format!("The model entry is invalid: {error}"))?;
    Ok(clamped)
}

/// Removes one model. Default-model slots and task selections that name it are
/// repaired by the host's model reconciliation after the write.
pub fn delete_ai_model(current: &Value, id: &str) -> Result<Value, String> {
    let id = id.trim();
    if id.is_empty() {
        return Err("A model id is required".to_string());
    }
    let mut models = models_array(current)?;
    let before = models.len();
    models.retain(|entry| entry.get("id").and_then(Value::as_str) != Some(id));
    if models.len() == before {
        return Err(format!("Model '{id}' is not stored; reload"));
    }
    Ok(Value::Array(models))
}

// ---------------------------------------------------------------------------
// Task models (`ai.task_models`)
// ---------------------------------------------------------------------------

/// The product tasks with a model selection, in settings order.
pub const TASK_MODEL_IDS: &[&str] = &["session_title", "git_commit"];

/// Reads a selection, including the externally tagged shapes an earlier
/// client wrote (`"Inherit"`, `{"Fixed":{"model_id":...}}`).
pub fn parse_task_model_selection(value: &Value) -> Result<TaskModelSelection, String> {
    if let Ok(selection) = serde_json::from_value::<TaskModelSelection>(value.clone()) {
        return Ok(selection);
    }
    match value {
        Value::String(text) if text.eq_ignore_ascii_case("inherit") => {
            Ok(TaskModelSelection::Inherit)
        }
        Value::Object(map) => {
            if let Some(kind) = map.get("kind").and_then(Value::as_str) {
                if kind.eq_ignore_ascii_case("inherit") {
                    return Ok(TaskModelSelection::Inherit);
                }
            }
            let fixed = map
                .get("Fixed")
                .or_else(|| map.get("fixed"))
                .and_then(|fixed| fixed.get("model_id"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|id| !id.is_empty());
            fixed
                .map(|model_id| TaskModelSelection::Fixed {
                    model_id: model_id.to_string(),
                })
                .ok_or_else(|| "Unknown task model selection".to_string())
        }
        _ => Err("Unknown task model selection".to_string()),
    }
}

fn task_selection_or_default(value: Option<&Value>) -> TaskModelSelection {
    value
        .and_then(|value| parse_task_model_selection(value).ok())
        .unwrap_or(TaskModelSelection::Fixed {
            model_id: "fast".to_string(),
        })
}

/// Sets one task's selection; other tasks (including ones this build does not
/// know) are kept.
pub fn set_task_model(current: &Value, task: &str, selection: &Value) -> Result<Value, String> {
    let task = task.trim();
    if !TASK_MODEL_IDS.contains(&task) {
        return Err(format!("Unknown task '{task}'"));
    }
    let selection = parse_task_model_selection(selection)?;
    if let TaskModelSelection::Fixed { model_id } = &selection {
        if model_id.trim().is_empty() {
            return Err("A fixed task model needs a model id".to_string());
        }
    }
    let mut document = match current {
        Value::Object(map) => map.clone(),
        _ => Map::new(),
    };
    for known in TASK_MODEL_IDS {
        if *known != task {
            let normalized = task_selection_or_default(document.get(*known));
            document.insert((*known).to_string(), task_model_value(&normalized));
        }
    }
    document.insert(task.to_string(), task_model_value(&selection));
    Ok(Value::Object(document))
}

fn task_model_value(selection: &TaskModelSelection) -> Value {
    serde_json::to_value(selection).unwrap_or_else(|_| json!({ "kind": "inherit" }))
}

/// Every known task with an explicit selection: an absent key is the host
/// default (`fixed: fast`), not inherit.
pub fn task_models_view(current: &Value) -> Value {
    let mut view = Map::new();
    for task in TASK_MODEL_IDS {
        let selection = task_selection_or_default(current.get(*task));
        view.insert((*task).to_string(), task_model_value(&selection));
    }
    Value::Object(view)
}

// ---------------------------------------------------------------------------
// Tool permissions (`tool_permissions`)
// ---------------------------------------------------------------------------

fn permission_config(current: &Value) -> Result<ToolPermissionConfig, String> {
    if current.is_null() {
        return Ok(ToolPermissionConfig::default());
    }
    serde_json::from_value(current.clone())
        .map_err(|error| format!("The stored permission settings are unreadable: {error}"))
}

fn permission_value(config: &ToolPermissionConfig) -> Result<Value, String> {
    config.approval.validate()?;
    serde_json::to_value(config).map_err(|error| error.to_string())
}

/// The settings view of `tool_permissions`: the mode a surface shows plus the
/// rules and approval tuning, with defaults filled in.
pub fn permission_settings_view(current: &Value) -> Result<Value, String> {
    let config = permission_config(current)?;
    Ok(json!({
        "mode": config.settings_mode().as_str(),
        "rules": config.policy.rules,
        "approval": config.approval,
    }))
}

pub fn set_permission_mode(current: &Value, mode: &str) -> Result<Value, String> {
    let mode =
        PermissionMode::parse(mode).ok_or_else(|| format!("Unknown permission mode '{mode}'"))?;
    let mut config = permission_config(current)?;
    config.apply_mode(mode);
    permission_value(&config)
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PermissionRuleInput {
    pub action: String,
    pub resource: String,
    pub effect: PermissionEffect,
}

impl PermissionRuleInput {
    fn into_rule(self) -> Result<PermissionRule, String> {
        let action = self.action.trim();
        let resource = self.resource.trim();
        if action.is_empty() {
            return Err("Every rule needs an action, or * for all of them".to_string());
        }
        if resource.is_empty() {
            return Err("Every rule needs a resource, for example workspace/*".to_string());
        }
        Ok(PermissionRule::new(action, resource, self.effect))
    }
}

/// Edits (`index` set) or appends one rule. `expected` is the rule the caller
/// saw at `index`; a mismatch means the list changed under the edit. `move_to`
/// moves the rule after the edit, since order decides which rule wins.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct PermissionRuleUpsertRequest {
    pub index: Option<usize>,
    pub expected: Option<PermissionRuleInput>,
    pub rule: Option<PermissionRuleInput>,
    pub move_to: Option<usize>,
}

fn check_expected_rule(
    rules: &[PermissionRule],
    index: usize,
    expected: Option<&PermissionRuleInput>,
) -> Result<(), String> {
    let stored = rules
        .get(index)
        .ok_or_else(|| "The rule list changed while it was being edited; reload".to_string())?;
    if let Some(expected) = expected {
        if stored.action != expected.action.trim()
            || stored.resource != expected.resource.trim()
            || stored.effect != expected.effect
        {
            return Err("The rule list changed while it was being edited; reload".to_string());
        }
    }
    Ok(())
}

pub fn upsert_permission_rule(
    current: &Value,
    request: PermissionRuleUpsertRequest,
) -> Result<Value, String> {
    let mut config = permission_config(current)?;
    let rules = &mut config.policy.rules;
    let index = match request.index {
        Some(index) => {
            check_expected_rule(rules, index, request.expected.as_ref())?;
            if let Some(rule) = request.rule {
                rules[index] = rule.into_rule()?;
            }
            index
        }
        None => {
            let rule = request.rule.ok_or_else(|| {
                "A new rule needs an action, a resource and an effect".to_string()
            })?;
            rules.push(rule.into_rule()?);
            rules.len() - 1
        }
    };
    if let Some(target) = request.move_to {
        if target >= rules.len() {
            return Err("A rule cannot move past the end of the list".to_string());
        }
        let rule = rules.remove(index);
        rules.insert(target, rule);
    }
    permission_value(&config)
}

pub fn delete_permission_rule(
    current: &Value,
    index: usize,
    expected: Option<&PermissionRuleInput>,
) -> Result<Value, String> {
    let mut config = permission_config(current)?;
    check_expected_rule(&config.policy.rules, index, expected)?;
    config.policy.rules.remove(index);
    permission_value(&config)
}

/// Automatic approval tuning. The mode owns `approval.strategy`, so these
/// fields never turn automatic approval on or off by themselves.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ApprovalSettingsRequest {
    pub model_kind: Option<PermissionApprovalModelKind>,
    pub chat_model_id: Option<String>,
    pub timeout_ms: Option<u64>,
    pub timeout_seconds: Option<u64>,
    pub on_ask: Option<PermissionApprovalOnAsk>,
    pub on_error: Option<PermissionApprovalOnError>,
}

/// The longest automatic-approval timeout the runtime accepts.
pub const MAX_APPROVAL_TIMEOUT_MS: u64 = 300_000;

pub fn set_approval_settings(
    current: &Value,
    request: ApprovalSettingsRequest,
) -> Result<Value, String> {
    let mut config = permission_config(current)?;
    let approval = &mut config.approval;
    if let Some(kind) = request.model_kind {
        approval.model_kind = kind;
    }
    if let Some(model_id) = request.chat_model_id {
        approval.chat_model_id = model_id.trim().to_string();
    }
    if let Some(timeout) = request.timeout_ms.or(request
        .timeout_seconds
        .map(|seconds| seconds.saturating_mul(1000)))
    {
        // The bound the runtime validates; an out-of-range entry is pulled into it.
        approval.timeout_ms = timeout.clamp(1, MAX_APPROVAL_TIMEOUT_MS);
    }
    if let Some(on_ask) = request.on_ask {
        approval.on_ask = on_ask;
    }
    if let Some(on_error) = request.on_error {
        approval.on_error = on_error;
    }
    permission_value(&config)
}

// ---------------------------------------------------------------------------
// Web search (`ai.web_search`)
// ---------------------------------------------------------------------------

/// The providers this build can run.
pub const WEB_SEARCH_PROVIDER_IDS: &[&str] = &[
    "exa_mcp_free",
    "exa_search_api",
    "tavily",
    "deepseek",
    "keenable",
    "openbitfun_search_http",
];

/// Providers whose secret lives under a `credentialId`.
const CREDENTIAL_PROVIDER_IDS: &[&str] = &["exa_search_api", "tavily", "deepseek", "keenable"];

/// One web-search settings intent. Every field is optional; `credentialId`
/// applies to `credentialProvider` (default: the selected provider).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct WebSearchProviderRequest {
    pub provider: Option<String>,
    pub credential_provider: Option<String>,
    pub credential_id: Option<String>,
    pub endpoint: Option<String>,
    pub auth_mode: Option<String>,
    pub auth_credential_id: Option<String>,
    pub auth_header_name: Option<String>,
}

pub fn set_web_search_provider(
    current: &Value,
    request: WebSearchProviderRequest,
) -> Result<Value, String> {
    let mut config: WebSearchConfig = if current.is_null() {
        WebSearchConfig::default()
    } else {
        serde_json::from_value(current.clone())
            .map_err(|error| format!("The stored web search settings are unreadable: {error}"))?
    };
    if let Some(provider) = &request.provider {
        let provider = provider.trim();
        if !WEB_SEARCH_PROVIDER_IDS.contains(&provider) {
            return Err(format!("Unknown web search provider '{provider}'"));
        }
        config.provider = provider.to_string();
    }
    if let Some(credential_id) = &request.credential_id {
        let target = request
            .credential_provider
            .as_deref()
            .map(str::trim)
            .unwrap_or(config.provider.as_str())
            .to_string();
        let credential_id = credential_id.trim().to_string();
        if credential_id.is_empty() {
            return Err("A credential id cannot be empty".to_string());
        }
        let providers = &mut config.providers;
        match target.as_str() {
            "exa_search_api" => providers.exa_search_api.credential_id = credential_id,
            "tavily" => providers.tavily.credential_id = credential_id,
            "deepseek" => providers.deepseek.credential_id = credential_id,
            "keenable" => providers.keenable.credential_id = credential_id,
            "openbitfun_search_http" => {
                providers.openbitfun_search_http.auth.credential_id = credential_id
            }
            other => {
                debug_assert!(!CREDENTIAL_PROVIDER_IDS.contains(&other));
                return Err(format!("Provider '{other}' has no credential id"));
            }
        }
    }
    let http = &mut config.providers.openbitfun_search_http;
    if let Some(endpoint) = &request.endpoint {
        let endpoint = endpoint.trim();
        if !endpoint.is_empty()
            && !endpoint.starts_with("http://")
            && !endpoint.starts_with("https://")
        {
            return Err("The search service endpoint must be an http(s) URL".to_string());
        }
        http.endpoint = endpoint.to_string();
    }
    if let Some(mode) = &request.auth_mode {
        let mode = mode.trim();
        if !matches!(mode, "none" | "bearer" | "header") {
            return Err(format!(
                "Auth mode '{mode}' is not one of none, bearer or header"
            ));
        }
        http.auth.mode = mode.to_string();
    }
    if let Some(credential_id) = &request.auth_credential_id {
        let credential_id = credential_id.trim();
        if credential_id.is_empty() {
            return Err("A credential id cannot be empty".to_string());
        }
        http.auth.credential_id = credential_id.to_string();
    }
    if let Some(header_name) = &request.auth_header_name {
        let header_name = header_name.trim();
        if !header_name.is_empty() && !valid_header_name(header_name) {
            return Err(format!("'{header_name}' is not a valid HTTP header name"));
        }
        http.auth.header_name = header_name.to_string();
    }
    serde_json::to_value(config).map_err(|error| error.to_string())
}

// ---------------------------------------------------------------------------
// Memory settings (`memories`)
// ---------------------------------------------------------------------------

/// The cross-field memory rule: a rollout window that reaches past the
/// retention it extracts into would produce memories deleted on arrival.
pub fn validate_memories_value(value: &Value) -> Result<(), String> {
    let memories: crate::types::MemoriesConfig = serde_json::from_value(value.clone())
        .map_err(|error| format!("Invalid memory settings: {error}"))?;
    if memories.max_rollout_age_days > memories.max_unused_days {
        return Err("Memory rollout age must not exceed unused-memory retention".to_string());
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Settings descriptor
// ---------------------------------------------------------------------------

fn read_path<'a>(root: &'a Value, path: &str) -> Option<&'a Value> {
    path.split('.')
        .filter(|segment| !segment.is_empty())
        .try_fold(root, |current, segment| current.get(segment))
}

/// What a settings surface needs to draw and pre-validate a field without
/// keeping its own copy of the rules: the value schema the product-control
/// catalog enforces on write (type, enum, bounds) and the default the config
/// applies when the path is absent. Labels and copy stay with each surface.
///
/// `paths` empty means every path the catalog binds to a config value.
/// A path the catalog does not constrain still reports its default.
pub fn settings_descriptor(paths: &[String]) -> Result<Value, String> {
    use openbitfun_product_domains::product_control::{catalog, ProductCapabilityOptionHandler};
    let catalog = catalog()?;
    let defaults = serde_json::to_value(crate::types::GlobalConfig::default())
        .map_err(|error| format!("Failed to describe settings defaults: {error}"))?;
    let mut schemas = std::collections::BTreeMap::new();
    for capability in &catalog.capabilities {
        for option in &capability.options {
            if let ProductCapabilityOptionHandler::Config { path } = &option.handler {
                schemas.entry(path.clone()).or_insert(&option.value_schema);
            }
        }
    }
    let wanted: Vec<String> = if paths.is_empty() {
        schemas.keys().cloned().collect()
    } else {
        paths.to_vec()
    };
    let mut fields = Map::new();
    for path in wanted {
        let mut field = match schemas.get(&path) {
            Some(schema) => match serde_json::to_value(schema) {
                Ok(Value::Object(map)) => map,
                _ => Map::new(),
            },
            None => Map::new(),
        };
        if let Some(default) = read_path(&defaults, &path) {
            field.insert("default".to_string(), default.clone());
        }
        field.insert(
            "constrained".to_string(),
            Value::Bool(schemas.contains_key(&path)),
        );
        fields.insert(path, Value::Object(field));
    }
    Ok(json!({
        "catalogDigest": catalog.digest,
        "fields": fields,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn minter() -> impl FnMut() -> String {
        let mut next = 0;
        move || {
            next += 1;
            format!("model_test_{next}")
        }
    }

    fn create(name: &str) -> AiModelUpsertRequest {
        AiModelUpsertRequest {
            name: Some(name.into()),
            provider: Some("openai".into()),
            model_name: Some(format!("{name}-model")),
            base_url: Some("https://api.example.test/v1/".into()),
            api_key: Some(" secret ".into()),
            ..Default::default()
        }
    }

    #[test]
    fn create_mints_an_id_and_derives_url_capabilities_and_defaults() {
        let mut mint = minter();
        let outcome = upsert_ai_models(&Value::Null, &[create("Alpha")], &mut mint).unwrap();
        let entry = &outcome.models[0];
        assert_eq!(outcome.ids, vec!["model_test_1"]);
        assert_eq!(entry["id"], "model_test_1");
        assert_eq!(entry["enabled"], true);
        assert_eq!(entry["api_key"], "secret");
        assert_eq!(
            entry["request_url"],
            "https://api.example.test/v1/chat/completions"
        );
        assert_eq!(entry["category"], "general_chat");
        assert_eq!(entry["capabilities"], json!(["text_chat"]));
        let parsed: AIModelConfig = serde_json::from_value(entry.clone()).unwrap();
        assert_eq!(parsed.model_name, "Alpha-model");
    }

    #[test]
    fn create_skips_an_id_that_already_exists() {
        let existing = json!([{ "id": "model_test_1", "name": "Old", "model_name": "m", "base_url": "https://x.test" }]);
        let mut mint = minter();
        let outcome = upsert_ai_models(&existing, &[create("New")], &mut mint).unwrap();
        assert_eq!(outcome.ids, vec!["model_test_2"]);
        assert_eq!(outcome.models.as_array().unwrap().len(), 2);
    }

    #[test]
    fn output_limit_is_clamped_to_forty_percent_of_the_window() {
        let mut request = create("Clamp");
        request.context_window = Some(Some(100_000));
        request.max_tokens = Some(Some(90_000));
        let outcome = upsert_ai_models(&Value::Null, &[request], &mut minter()).unwrap();
        assert_eq!(outcome.models[0]["max_tokens"], 40_000);
        assert_eq!(outcome.clamped_ids, vec!["model_test_1"]);

        // Without a window the runtime default window is the ceiling's base.
        let mut request = create("Default window");
        request.max_tokens = Some(Some(1_000_000));
        let outcome = upsert_ai_models(&Value::Null, &[request], &mut minter()).unwrap();
        assert_eq!(
            outcome.models[0]["max_tokens"],
            max_output_tokens_ceiling(DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS)
        );
    }

    #[test]
    fn a_context_window_below_the_floor_is_refused() {
        let mut request = create("Small");
        request.context_window = Some(Some(1_000));
        let error = upsert_ai_models(&Value::Null, &[request], &mut minter()).unwrap_err();
        assert!(error.contains("at least"));
    }

    #[test]
    fn edit_keeps_unknown_fields_and_a_custom_request_url() {
        let stored = json!([{
            "id": "keep",
            "name": "Keep",
            "provider": "anthropic",
            "model_name": "claude",
            "base_url": "https://gateway.test",
            "request_url": "https://gateway.test/custom",
            "api_key": "k",
            "enabled": true,
            "category": "general_chat",
            "capabilities": ["text_chat", "function_calling"],
            "future_field": {"nested": true}
        }]);
        let edit = AiModelUpsertRequest {
            id: Some("keep".into()),
            enabled: Some(false),
            ..Default::default()
        };
        let outcome = upsert_ai_models(&stored, &[edit], &mut minter()).unwrap();
        let entry = &outcome.models[0];
        assert_eq!(entry["enabled"], false);
        assert_eq!(entry["future_field"], json!({"nested": true}));
        assert_eq!(entry["request_url"], "https://gateway.test/custom");
        assert_eq!(
            entry["capabilities"],
            json!(["text_chat", "function_calling"])
        );

        // A routing change re-derives it.
        let edit = AiModelUpsertRequest {
            id: Some("keep".into()),
            base_url: Some("https://other.test/v1".into()),
            ..Default::default()
        };
        let outcome = upsert_ai_models(&stored, &[edit], &mut minter()).unwrap();
        assert_eq!(
            outcome.models[0]["request_url"],
            "https://other.test/v1/messages"
        );
    }

    #[test]
    fn legacy_response_provider_and_category_change_take_backend_defaults() {
        let stored = json!([{
            "id": "legacy",
            "name": "Legacy",
            "provider": "response",
            "model_name": "gpt",
            "base_url": "https://api.test/v1",
            "category": "general_chat",
            "capabilities": ["text_chat"]
        }]);
        let edit = AiModelUpsertRequest {
            id: Some("legacy".into()),
            provider: Some("response".into()),
            category: Some("multimodal".into()),
            ..Default::default()
        };
        let outcome = upsert_ai_models(&stored, &[edit], &mut minter()).unwrap();
        let entry = &outcome.models[0];
        assert_eq!(entry["provider"], "responses");
        assert_eq!(
            entry["capabilities"],
            serde_json::to_value(default_capabilities_for_category(
                &ModelCategory::Multimodal
            ))
            .unwrap()
        );
    }

    #[test]
    fn editing_a_removed_model_and_bad_headers_are_refused() {
        let edit = AiModelUpsertRequest {
            id: Some("gone".into()),
            ..Default::default()
        };
        assert!(upsert_ai_models(&json!([]), &[edit], &mut minter())
            .unwrap_err()
            .contains("removed"));
        let mut request = create("Headers");
        request.custom_headers = Some(Some(json!({"bad name": "x"}).as_object().unwrap().clone()));
        assert!(upsert_ai_models(&Value::Null, &[request], &mut minter())
            .unwrap_err()
            .contains("header"));
    }

    #[test]
    fn null_clears_optional_fields_and_absent_keeps_them() {
        let stored = json!([{
            "id": "m", "name": "M", "provider": "openai", "model_name": "m",
            "base_url": "https://x.test", "context_window": 200000, "max_tokens": 8000,
            "custom_headers": {"X-A": "1"}, "custom_headers_mode": "merge"
        }]);
        let request: AiModelUpsertRequest =
            serde_json::from_value(json!({"id": "m", "maxTokens": null, "customHeaders": null}))
                .unwrap();
        let outcome = upsert_ai_models(&stored, &[request], &mut minter()).unwrap();
        let entry = &outcome.models[0];
        assert_eq!(entry["context_window"], 200000);
        assert_eq!(entry["max_tokens"], Value::Null);
        assert_eq!(entry["custom_headers"], Value::Null);
        assert_eq!(entry["custom_headers_mode"], Value::Null);
    }

    #[test]
    fn delete_removes_and_refuses_unknown_ids() {
        let stored = json!([{ "id": "a" }, { "id": "b" }]);
        assert_eq!(
            delete_ai_model(&stored, "a").unwrap(),
            json!([{ "id": "b" }])
        );
        assert!(delete_ai_model(&stored, "c").is_err());
    }

    #[test]
    fn task_models_read_legacy_shapes_and_keep_unknown_tasks() {
        assert_eq!(
            parse_task_model_selection(&json!("Inherit")).unwrap(),
            TaskModelSelection::Inherit
        );
        assert_eq!(
            parse_task_model_selection(&json!({"Fixed": {"model_id": "m1"}})).unwrap(),
            TaskModelSelection::Fixed {
                model_id: "m1".into()
            }
        );
        let stored = json!({"session_title": "Inherit", "future_task": {"kind": "inherit"}});
        let next = set_task_model(
            &stored,
            "git_commit",
            &json!({"kind": "fixed", "model_id": "m2"}),
        )
        .unwrap();
        assert_eq!(next["session_title"], json!({"kind": "inherit"}));
        assert_eq!(
            next["git_commit"],
            json!({"kind": "fixed", "model_id": "m2"})
        );
        assert_eq!(next["future_task"], json!({"kind": "inherit"}));
        assert!(set_task_model(&stored, "unknown", &json!({"kind": "inherit"})).is_err());
        let view = task_models_view(&Value::Null);
        assert_eq!(
            view["git_commit"],
            json!({"kind": "fixed", "model_id": "fast"})
        );
    }

    #[test]
    fn permission_mode_projects_onto_the_stored_knobs() {
        let stored = json!({"policy": {"preset": "ask", "rules": [{"action": "bash", "resource": "*", "effect": "deny"}]}});
        let auto = set_permission_mode(&stored, "auto").unwrap();
        assert_eq!(auto["interaction"]["auto_approve_ask"], true);
        assert_eq!(auto["approval"]["strategy"], "model");
        assert_eq!(auto["approval"]["chat_model_id"], "fast");
        assert_eq!(auto["policy"]["rules"][0]["effect"], "deny");
        assert_eq!(
            permission_settings_view(&auto).unwrap()["mode"],
            "auto_approve"
        );
        let full = set_permission_mode(&auto, "full_access").unwrap();
        assert_eq!(full["policy"]["preset"], "full_access");
        assert_eq!(full["interaction"]["auto_approve_ask"], false);
        assert!(set_permission_mode(&stored, "sometimes").is_err());
        // Legacy record without the approval section reads with defaults.
        assert_eq!(
            permission_settings_view(&json!({})).unwrap()["mode"],
            "full_access"
        );
    }

    #[test]
    fn permission_rules_edit_move_and_detect_concurrent_changes() {
        let stored = json!({"policy": {"preset": "ask", "rules": [
            {"action": "bash", "resource": "*", "effect": "ask"},
            {"action": "read", "resource": "*", "effect": "allow"}
        ]}});
        let added = upsert_permission_rule(
            &stored,
            serde_json::from_value(json!({"rule": {"action": "git", "resource": "git push *", "effect": "deny"}, "moveTo": 0})).unwrap(),
        )
        .unwrap();
        assert_eq!(added["policy"]["rules"][0]["action"], "git");
        assert_eq!(added["policy"]["rules"].as_array().unwrap().len(), 3);
        let stale = upsert_permission_rule(
            &stored,
            serde_json::from_value(json!({"index": 0, "expected": {"action": "read", "resource": "*", "effect": "allow"}, "rule": {"action": "x", "resource": "*", "effect": "ask"}})).unwrap(),
        );
        assert!(stale.unwrap_err().contains("changed"));
        let deleted = delete_permission_rule(
            &stored,
            1,
            Some(&PermissionRuleInput {
                action: "read".into(),
                resource: "*".into(),
                effect: PermissionEffect::Allow,
            }),
        )
        .unwrap();
        assert_eq!(deleted["policy"]["rules"].as_array().unwrap().len(), 1);
        let empty = upsert_permission_rule(
            &stored,
            serde_json::from_value(
                json!({"rule": {"action": " ", "resource": "*", "effect": "ask"}}),
            )
            .unwrap(),
        );
        assert!(empty.is_err());
    }

    #[test]
    fn approval_settings_validate_server_side() {
        let next = set_approval_settings(
            &Value::Null,
            ApprovalSettingsRequest {
                timeout_seconds: Some(45),
                on_ask: Some(PermissionApprovalOnAsk::Reject),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(next["approval"]["timeout_ms"], 45_000);
        assert_eq!(next["approval"]["on_ask"], "reject");
        let too_long = set_approval_settings(
            &Value::Null,
            ApprovalSettingsRequest {
                timeout_seconds: Some(600),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(too_long["approval"]["timeout_ms"], MAX_APPROVAL_TIMEOUT_MS);
        let chat_without_model = set_approval_settings(
            &serde_json::to_value({
                let mut config = ToolPermissionConfig::default();
                config.apply_mode(PermissionMode::AutoApprove);
                config
            })
            .unwrap(),
            ApprovalSettingsRequest {
                chat_model_id: Some(" ".into()),
                ..Default::default()
            },
        );
        assert!(chat_without_model.is_err());
    }

    #[test]
    fn web_search_provider_changes_validate_and_keep_unknown_fields() {
        let stored = json!({"provider": "exa_mcp_free", "futureFlag": true, "providers": {"tavily": {"credentialId": "t"}}});
        let next = set_web_search_provider(
            &stored,
            WebSearchProviderRequest {
                provider: Some("tavily".into()),
                credential_id: Some("tavily-2".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(next["provider"], "tavily");
        assert_eq!(next["futureFlag"], true);
        assert_eq!(next["providers"]["tavily"]["credentialId"], "tavily-2");
        assert!(set_web_search_provider(
            &stored,
            WebSearchProviderRequest {
                provider: Some("nope".into()),
                ..Default::default()
            }
        )
        .is_err());
        assert!(set_web_search_provider(
            &stored,
            WebSearchProviderRequest {
                auth_mode: Some("cookie".into()),
                ..Default::default()
            }
        )
        .is_err());
        let http = set_web_search_provider(
            &Value::Null,
            WebSearchProviderRequest {
                endpoint: Some("https://search.test/q".into()),
                auth_mode: Some("bearer".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(
            http["providers"]["openbitfun_search_http"]["endpoint"],
            "https://search.test/q"
        );
    }

    #[test]
    fn settings_descriptor_reports_catalog_bounds_and_config_defaults() {
        let descriptor = settings_descriptor(&[
            "editor.font_size".to_string(),
            "memories.max_unused_days".to_string(),
            "not.a.path".to_string(),
        ])
        .unwrap();
        let fields = &descriptor["fields"];
        assert_eq!(fields["editor.font_size"]["type"], "integer");
        assert!(fields["editor.font_size"]["minimum"].is_number());
        assert!(fields["editor.font_size"]["default"].is_number());
        assert_eq!(fields["editor.font_size"]["constrained"], true);
        assert_eq!(fields["memories.max_unused_days"]["constrained"], false);
        assert!(fields["memories.max_unused_days"]["default"].is_number());
        assert!(fields["not.a.path"].get("default").is_none());
        let all = settings_descriptor(&[]).unwrap();
        assert!(all["fields"].as_object().unwrap().len() > 10);
    }

    #[test]
    fn memory_window_rule_rejects_a_window_past_retention() {
        let mut memories = serde_json::to_value(crate::types::MemoriesConfig::default()).unwrap();
        memories["max_unused_days"] = json!(5);
        memories["max_rollout_age_days"] = json!(10);
        assert!(validate_memories_value(&memories).is_err());
        memories["max_rollout_age_days"] = json!(5);
        assert!(validate_memories_value(&memories).is_ok());
    }
}

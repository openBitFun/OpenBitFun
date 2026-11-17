use super::*;

const DISABLED_MESSAGE: &str = "Subagent model overrides are disabled by the user. Remove model_id and retry to use the configured subagent model.";

/// Execution-host policy. Workspace and controller-provided context cannot override it.
#[derive(Clone, Copy)]
pub(super) struct ModelOverridePolicy {
    pub(super) allowed: bool,
}

impl ModelOverridePolicy {
    pub(super) async fn presentation() -> OpenBitFunResult<Self> {
        match MODEL_PRESENTATION_POLICY.try_with(|policy| *policy) {
            Ok(policy) => Ok(policy),
            Err(_) => Self::load().await,
        }
    }

    pub(super) async fn load() -> OpenBitFunResult<Self> {
        #[cfg(test)]
        {
            if let Ok(allowed) = TEST_MODEL_OVERRIDE.try_with(|allowed| *allowed) {
                return Ok(Self { allowed });
            }
            if !GlobalConfigManager::is_initialized() {
                return Ok(Self { allowed: true });
            }
        }
        let service = GlobalConfigManager::get_service().await?;
        let allowed = service
            .get_config(Some("ai.allow_subagent_model_override"))
            .await?;
        Ok(Self { allowed })
    }

    pub(super) fn schema(self, mut schema: Value) -> Value {
        if !self.allowed {
            if let Some(properties) = schema.get_mut("properties").and_then(Value::as_object_mut) {
                properties.remove("model_id");
            }
        }
        schema
    }

    pub(super) async fn model_schema(schema: Value) -> Value {
        let policy = Self::presentation().await.unwrap_or_else(|error| {
            warn!("Failed to read subagent model override policy: {}", error);
            Self { allowed: false }
        });
        policy.schema(schema)
    }

    pub(super) fn check(self, input: &Value) -> OpenBitFunResult<()> {
        if !self.allowed && input.get("model_id").is_some() {
            return Err(OpenBitFunError::validation(DISABLED_MESSAGE.to_string()));
        }
        Ok(())
    }

    /// Check original arguments before translation can drop null/empty fields.
    pub(super) async fn enforce(input: &Value) -> OpenBitFunResult<()> {
        if input.get("model_id").is_some() {
            Self::load().await?.check(input)?;
        }
        Ok(())
    }
}

tokio::task_local! {
    static MODEL_PRESENTATION_POLICY: ModelOverridePolicy;
}

/// Freeze only tool presentation during one catalog request. Execution always
/// re-reads the host policy so an already-issued tool call cannot bypass an opt-out.
pub(crate) async fn with_collaboration_model_policy<F: std::future::Future>(
    future: F,
) -> F::Output {
    if MODEL_PRESENTATION_POLICY.try_with(|_| ()).is_ok() {
        return future.await;
    }
    let policy = ModelOverridePolicy::load().await.unwrap_or_else(|error| {
        warn!(
            "Failed to read collaboration presentation policy: {}",
            error
        );
        ModelOverridePolicy { allowed: false }
    });
    crate::agentic::tools::registry::get_global_tool_registry()
        .write()
        .await
        .refresh_collaboration_model_policy(policy.allowed);
    MODEL_PRESENTATION_POLICY.scope(policy, future).await
}

pub(super) async fn model_override_validation(input: &Value) -> Option<ValidationResult> {
    ModelOverridePolicy::enforce(input)
        .await
        .err()
        .map(|error| AgentExecutionTool::invalid_input(error.to_string()))
}

#[cfg(test)]
tokio::task_local! {
    pub(super) static TEST_MODEL_OVERRIDE: bool;
}

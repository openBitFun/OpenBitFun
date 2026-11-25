//! Resolve product model configuration before admission to the turn engine.
use crate::service::config::types::automatic_max_output_tokens;
pub(super) use openbitfun_agent_runtime::turn_execution::context::CompressionTriggerBudget;
use openbitfun_core_types::model_pool::ModelPoolContextBudget;

pub(super) fn request_budget(
    model: &openbitfun_core_types::AIConfig,
    pool: Option<ModelPoolContextBudget>,
) -> CompressionTriggerBudget {
    match pool {
        Some(pool) => CompressionTriggerBudget::for_pool(pool),
        None => model_budget(model.context_window as usize, model.max_tokens),
    }
}

pub(super) fn model_budget(
    context_window: usize,
    configured_output: Option<u32>,
) -> CompressionTriggerBudget {
    let output =
        configured_output.unwrap_or_else(|| automatic_max_output_tokens(context_window as u32));
    CompressionTriggerBudget::for_model(context_window, output as usize)
}

#[cfg(test)]
mod tests {
    use crate::service::config::types::AIModelConfig;

    #[test]
    fn compression_budget_follows_each_selected_model() {
        for (window, max_output, input_limit) in
            [(1_048_576, 384_000, 654_576), (64_000, 16_000, 38_000)]
        {
            let model = openbitfun_core_types::AIConfig::try_from(AIModelConfig {
                context_window: Some(window),
                max_tokens: Some(max_output),
                ..Default::default()
            })
            .unwrap();
            let budget = super::request_budget(&model, None);
            assert_eq!(budget.context_window, window as usize);
            assert_eq!(budget.input_limit, input_limit);
            assert_eq!(47_544 >= budget.input_limit, window == 64_000);
        }
    }
}

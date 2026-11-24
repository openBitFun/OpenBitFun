//! Input budgets and emergency history trimming for model requests.
use openbitfun_core_types::model_pool::ModelPoolContextBudget;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CompressionTriggerBudget {
    pub context_window: usize,
    pub input_limit: usize,
    pub output_reserve_tokens: usize,
    pub safety_reserve_tokens: usize,
}

impl CompressionTriggerBudget {
    const SAFETY_RESERVE_TOKENS: usize = 10_000;

    pub fn for_model(context_window: usize, output_reserve_tokens: usize) -> Self {
        let safety_reserve_tokens = Self::SAFETY_RESERVE_TOKENS;
        Self {
            context_window,
            input_limit: context_window
                .saturating_sub(output_reserve_tokens + safety_reserve_tokens),
            output_reserve_tokens,
            safety_reserve_tokens,
        }
    }

    pub fn for_pool(budget: ModelPoolContextBudget) -> Self {
        let context_window = budget.context_window as usize;
        let input_limit = budget.input_limit as usize;
        let safety_reserve_tokens = Self::SAFETY_RESERVE_TOKENS.min(context_window);
        Self {
            context_window,
            input_limit,
            // This is an equivalent reserve for the common window, not a new
            // max_tokens setting for any member's provider request.
            output_reserve_tokens: context_window
                .saturating_sub(input_limit + safety_reserve_tokens),
            safety_reserve_tokens,
        }
    }
}

/// Preserve the complete head through the first user message. Drop the oldest
/// exchanges as units so a retained assistant call keeps its tool replies.
pub fn trim_history<M>(
    messages: Vec<M>,
    context_window: usize,
    is_user: impl Fn(&M) -> bool,
    is_tool: impl Fn(&M) -> bool,
    token_count: impl Fn(&M) -> usize,
    request_overhead: impl FnOnce() -> usize,
) -> Vec<M> {
    // Separate preserved head (system + first user) from droppable body.
    let mut preserved: Vec<M> = Vec::new();
    let mut droppable: Vec<M> = Vec::new();
    let mut seen_first_user = false;

    for msg in messages {
        if !seen_first_user {
            let is_user = is_user(&msg);
            preserved.push(msg);
            if is_user {
                seen_first_user = true;
            }
        } else {
            droppable.push(msg);
        }
    }

    if droppable.is_empty() {
        return preserved;
    }

    // Group droppable messages into API rounds.
    // An API round starts with an Assistant message and includes all
    // following Tool messages until the next Assistant or User message.
    let mut rounds: Vec<Vec<M>> = Vec::new();
    for msg in droppable {
        if is_tool(&msg) {
            if let Some(previous) = rounds.last_mut() {
                previous.push(msg);
                continue;
            }
        }
        rounds.push(vec![msg]);
    }

    // Drop rounds from the front until we fit.
    let preserved_tokens = preserved.iter().map(&token_count).sum::<usize>() + request_overhead();

    let mut kept_start = 0;
    let mut total_tokens = preserved_tokens
        + rounds
            .iter()
            .flat_map(|r| r.iter())
            .map(&token_count)
            .sum::<usize>();

    while total_tokens > context_window && kept_start < rounds.len() {
        let round_tokens: usize = rounds[kept_start].iter().map(&token_count).sum();
        total_tokens -= round_tokens;
        kept_start += 1;
    }

    if kept_start > 0 {
        log::warn!(
            "Emergency truncation dropped {} API round(s) from context head",
            kept_start
        );
    }

    let mut result = preserved;
    for round in rounds.into_iter().skip(kept_start) {
        result.extend(round);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::trim_history;

    #[test]
    fn truncation_keeps_the_first_user_message_and_never_orphans_a_tool_result() {
        let history = vec![
            "system",
            "user",
            "assistant A",
            "tool A",
            "tool B",
            "assistant B",
            "tool C",
        ];
        let retained = trim_history(
            history,
            5,
            |m| *m == "user",
            |m| m.starts_with("tool"),
            |_| 1,
            || 1,
        );
        assert_eq!(retained, ["system", "user", "assistant B", "tool C"]);
    }
}

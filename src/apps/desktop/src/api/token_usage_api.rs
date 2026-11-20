//! Token usage statistics API (settings "usage statistics" page) and the
//! day-keyed activity heatmap shared by Home and the Usage page.

use crate::api::app_state::AppState;
use crate::host::State;
use log::error;
use openbitfun_core::service::token_usage::{
    TokenUsageActivity, TokenUsageActivityRequest, TokenUsageStatisticsRequest, UsageStatistics,
};
// @backend-command
pub async fn get_token_usage_statistics(
    request: TokenUsageStatisticsRequest,
    state: State<'_, AppState>,
) -> Result<UsageStatistics, String> {
    state
        .token_usage_service
        .get_statistics_for_request(request)
        .await
        .map_err(|e| {
            error!("Failed to load token usage statistics: {}", e);
            format!("Failed to load token usage statistics: {}", e)
        })
}

/// The activity heatmap view model: one grid of calendar days keyed in the
/// request's IANA zone, with shades and streaks computed by the backend so every
/// client marks the same cells.
// @backend-command
pub async fn get_token_usage_activity(
    request: TokenUsageActivityRequest,
    state: State<'_, AppState>,
) -> Result<TokenUsageActivity, String> {
    state
        .token_usage_service
        .get_activity(request)
        .await
        .map_err(|e| {
            error!("Failed to load token usage activity: {}", e);
            format!("Failed to load token usage activity: {}", e)
        })
}

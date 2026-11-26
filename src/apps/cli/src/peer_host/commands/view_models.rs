//! Backend view models (logic batch 4) served by the CLI Peer host.
//!
//! The projections are the core's, so a CLI host answers the same navigator,
//! activity grid and overview as the desktop. Overview sections this host does
//! not own (routines, Spaces) answer `unsupported` instead of reading as zero.

use serde_json::Value;

use openbitfun_core::service::personal_overview::{
    summarize_skills, CountOverview, OverviewSection, PersonalOverview, PersonalOverviewRequest,
    RoutinesOverview, SpacesOverview, SshOverview, UsageOverview, USAGE_SUMMARY_DAYS,
};
use openbitfun_core::service::token_usage::{
    TokenUsageActivityRequest, TokenUsageStatisticsRequest, UsageStatisticsFilterKind,
};
use openbitfun_core::service::workspace::navigator::{
    order_workspaces_assistants_first, project_workspace_navigator,
};

use crate::peer_host::args::request_value;
use crate::peer_host::state::PeerHostState;
use crate::peer_host::workspace_dto::workspace_info_to_json;

fn parse_request<T: serde::de::DeserializeOwned + Default>(args: &Value) -> Result<T, String> {
    match args.get("request") {
        None | Some(Value::Null) => Ok(T::default()),
        Some(value) => serde_json::from_value(value.clone()).map_err(|error| error.to_string()),
    }
}

pub(crate) async fn get_token_usage_activity(
    state: &PeerHostState,
    args: &Value,
) -> Result<Value, String> {
    let request: TokenUsageActivityRequest = parse_request(args)?;
    let activity = state
        .token_usage_service
        .get_activity(request)
        .await
        .map_err(|error| error.to_string())?;
    serde_json::to_value(activity).map_err(|error| error.to_string())
}

pub(crate) async fn get_workspace_navigator(
    state: &PeerHostState,
    args: &Value,
) -> Result<Value, String> {
    let selected_id = request_value(args)
        .get("selectedId")
        .and_then(Value::as_str)
        .map(str::to_string);
    let service = &state.workspace_service;
    let primary_assistant_id = service
        .get_primary_assistant_workspace()
        .await
        .map(|info| info.id);
    let mut opened_infos = service.get_opened_workspaces().await;
    order_workspaces_assistants_first(&mut opened_infos, primary_assistant_id.as_deref());
    let opened: Vec<Value> = opened_infos.iter().map(workspace_info_to_json).collect();
    let recent: Vec<Value> = service
        .get_recent_workspaces()
        .await
        .iter()
        .map(workspace_info_to_json)
        .collect();
    let current_id = service.get_current_workspace().await.map(|info| info.id);
    let navigator = project_workspace_navigator(
        opened,
        recent,
        current_id.as_deref(),
        selected_id.as_deref(),
        |item: &Value| item.get("id").and_then(Value::as_str).unwrap_or_default(),
    );
    serde_json::to_value(navigator).map_err(|error| error.to_string())
}

pub(crate) async fn get_personal_overview(
    state: &PeerHostState,
    args: &Value,
) -> Result<Value, String> {
    let request: PersonalOverviewRequest = parse_request(args)?;
    let time_zone = request
        .time_zone
        .as_deref()
        .map(str::trim)
        .filter(|zone| !zone.is_empty())
        .map(str::to_string);
    let assistants = OverviewSection::Ready {
        value: CountOverview {
            count: state
                .workspace_service
                .get_assistant_workspaces()
                .await
                .len() as u32,
        },
    };
    let skills = OverviewSection::from_result(
        super::skills::get_skill_configs(&serde_json::json!({ "request": {} }))
            .await
            .map(|configs| summarize_skills(&configs)),
    );
    let ssh =
        OverviewSection::from_result(super::workspace::ssh_list_saved_connections().await.map(
            |connections| SshOverview {
                connections: connections.as_array().cloned().unwrap_or_default(),
            },
        ));
    let end = chrono::Utc::now();
    let usage = OverviewSection::from_result(
        state
            .token_usage_service
            .get_statistics_for_request(TokenUsageStatisticsRequest {
                time_range: "custom".to_string(),
                granularity: "day".to_string(),
                start: Some(end - chrono::Duration::days(USAGE_SUMMARY_DAYS)),
                end: Some(end),
                time_zone: time_zone.clone(),
                include_subagent: true,
                filter_kind: UsageStatisticsFilterKind::default(),
                filter_query: None,
            })
            .await
            .map(|statistics| {
                UsageOverview::from_statistics(&statistics, USAGE_SUMMARY_DAYS as u32)
            })
            .map_err(|error| error.to_string()),
    );
    let activity = OverviewSection::from_result(
        state
            .token_usage_service
            .get_activity(TokenUsageActivityRequest {
                time_zone,
                months: request.activity_months,
                include_subagent: true,
            })
            .await
            .map_err(|error| error.to_string()),
    );
    let overview = PersonalOverview {
        assistants,
        skills,
        routines: OverviewSection::<RoutinesOverview>::unsupported("Routines"),
        spaces: OverviewSection::<SpacesOverview>::unsupported("Spaces"),
        ssh,
        usage,
        activity,
    };
    serde_json::to_value(overview).map_err(|error| error.to_string())
}

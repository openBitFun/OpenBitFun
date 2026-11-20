//! Backend view models (logic batch 4).
//!
//! Screens that used to be assembled in each client from several reads are
//! answered here as one read, so every client shows the same navigator and the
//! same overview because none of them computed it.

use crate::api::app_state::AppState;
use crate::api::dto::WorkspaceInfoDto;
use crate::host::State;
use openbitfun_core::service::cron::{CronJob, CronSchedule};
use openbitfun_core::service::personal_overview::{
    summarize_routines, summarize_skills, summarize_spaces, CountOverview, OverviewSection,
    PersonalOverview, PersonalOverviewRequest, RoutineFacts, SshOverview, UsageOverview,
    USAGE_SUMMARY_DAYS,
};
use openbitfun_core::service::token_usage::{
    TokenUsageActivityRequest, TokenUsageStatisticsRequest, UsageStatisticsFilterKind,
};
use openbitfun_core::service::workspace::navigator::{
    project_workspace_navigator, WorkspaceNavigator,
};
use serde::Deserialize;

// ── get_workspace_navigator ─────────────────────────────────────────

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetWorkspaceNavigatorRequest {
    /// The caller's current selection; kept while it is still opened.
    #[serde(default)]
    pub selected_id: Option<String>,
}

/// Opened and recent workspaces, deduplicated (a recent row is never an opened
/// one), and the workspace a surface should show: its own selection while it is
/// still opened, else the host's current workspace, else the first opened one;
/// with nothing opened, the recent workspace to reopen.
// @backend-command
pub async fn get_workspace_navigator(
    state: State<'_, AppState>,
    request: GetWorkspaceNavigatorRequest,
) -> Result<WorkspaceNavigator<WorkspaceInfoDto>, String> {
    let service = &state.workspace_service;
    let opened = service
        .get_opened_workspaces()
        .await
        .iter()
        .map(WorkspaceInfoDto::from_workspace_info)
        .collect();
    let recent = service
        .get_recent_workspaces()
        .await
        .iter()
        .map(WorkspaceInfoDto::from_workspace_info)
        .collect();
    let current_id = service.get_current_workspace().await.map(|info| info.id);
    Ok(project_workspace_navigator(
        opened,
        recent,
        current_id.as_deref(),
        request.selected_id.as_deref(),
        |item: &WorkspaceInfoDto| item.id.as_str(),
    ))
}

// ── get_personal_overview ───────────────────────────────────────────

fn routine_facts(job: &CronJob) -> RoutineFacts {
    let next_run_at_ms = job.state.next_run_at_ms.or_else(|| match &job.schedule {
        CronSchedule::At { at } => chrono::DateTime::parse_from_rfc3339(at)
            .ok()
            .map(|at| at.timestamp_millis()),
        _ => None,
    });
    RoutineFacts {
        id: job.id.clone(),
        name: job.name.clone(),
        enabled: job.enabled,
        next_run_at_ms,
        last_run_status: job
            .state
            .last_run_status
            .as_ref()
            .and_then(|status| serde_json::to_value(status).ok())
            .and_then(|value| value.as_str().map(str::to_string)),
        schedule: serde_json::to_value(&job.schedule).unwrap_or_default(),
    }
}

/// Home's overview in one read: every section is computed by its owner here and
/// carries its own status, so a failing owner never blanks the others and no
/// client counts, filters or keys days on its own.
// @backend-command
pub async fn get_personal_overview(
    state: State<'_, AppState>,
    request: PersonalOverviewRequest,
) -> Result<PersonalOverview, String> {
    let app = state.inner();
    let time_zone = request
        .time_zone
        .as_deref()
        .map(str::trim)
        .filter(|zone| !zone.is_empty())
        .map(str::to_string);
    let assistants = async {
        let count = app.workspace_service.get_assistant_workspaces().await.len() as u32;
        OverviewSection::Ready {
            value: CountOverview { count },
        }
    };
    let skills = async {
        OverviewSection::from_result(
            crate::api::skill_api::get_skill_configs(state, Some(false), Some(false), None, None)
                .await
                .map(|configs| summarize_skills(&configs)),
        )
    };
    let routines = async {
        OverviewSection::from_result(
            crate::api::cron_api::list_cron_jobs(crate::api::cron_api::ListCronJobsRequest {
                workspace_path: None,
                workspace_id: None,
                remote_connection_id: None,
                session_id: None,
                target_kind: None,
            })
            .await
            .map(|jobs| {
                let facts: Vec<RoutineFacts> = jobs.iter().map(routine_facts).collect();
                summarize_routines(&facts, chrono::Utc::now().timestamp_millis())
            }),
        )
    };
    let spaces = async {
        let running = match app.js_worker_pool.as_ref() {
            Some(pool) => pool.list_running().await,
            None => Vec::new(),
        };
        OverviewSection::from_result(
            app.miniapp_manager
                .list()
                .await
                .map_err(|error| error.to_string())
                .map(|apps| {
                    summarize_spaces(
                        apps.into_iter()
                            .map(|meta| (meta.id, meta.name, meta.description, meta.icon)),
                        &running,
                    )
                }),
        )
    };
    let ssh = async {
        let manager = match app.get_ssh_manager_async().await {
            Ok(manager) => manager,
            Err(error) => {
                return OverviewSection::Failed {
                    error: error.to_string(),
                }
            }
        };
        let connections = manager
            .get_saved_connections()
            .await
            .iter()
            .filter_map(|connection| serde_json::to_value(connection).ok())
            .collect();
        OverviewSection::Ready {
            value: SshOverview { connections },
        }
    };
    let usage = async {
        let end = chrono::Utc::now();
        OverviewSection::from_result(
            app.token_usage_service
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
        )
    };
    let activity = async {
        OverviewSection::from_result(
            app.token_usage_service
                .get_activity(TokenUsageActivityRequest {
                    time_zone: time_zone.clone(),
                    months: request.activity_months,
                    include_subagent: true,
                })
                .await
                .map_err(|error| error.to_string()),
        )
    };
    let (assistants, skills, routines, spaces, ssh, usage, activity) =
        tokio::join!(assistants, skills, routines, spaces, ssh, usage, activity);
    Ok(PersonalOverview {
        assistants,
        skills,
        routines,
        spaces,
        ssh,
        usage,
        activity,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn navigator_request_tolerates_an_empty_or_legacy_body() {
        let request: GetWorkspaceNavigatorRequest =
            serde_json::from_value(serde_json::json!({})).unwrap();
        assert_eq!(request.selected_id, None);
        let request: GetWorkspaceNavigatorRequest =
            serde_json::from_value(serde_json::json!({ "selectedId": "ws-1", "extra": true }))
                .unwrap();
        assert_eq!(request.selected_id.as_deref(), Some("ws-1"));
    }

    #[test]
    fn overview_request_tolerates_an_empty_body() {
        let request: PersonalOverviewRequest =
            serde_json::from_value(serde_json::json!({})).unwrap();
        assert!(request.time_zone.is_none());
    }
}

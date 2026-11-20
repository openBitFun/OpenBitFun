//! Routine draft validation and run previews for the CLI Peer Host.
//!
//! The same scheduler functions the desktop serves (`cron_api.rs`), so a
//! controller previewing a routine against this host sees the runs this host's
//! scheduler would make.

use serde::de::DeserializeOwned;
use serde_json::Value;

use openbitfun_core::service::cron::{
    answer_preview_request, get_global_cron_service, validate_cron_job_draft, CronJobDraft,
    PreviewCronOccurrencesRequest,
};

use crate::peer_host::args::request_value;

fn parse<T: DeserializeOwned>(args: &Value) -> Result<T, String> {
    serde_json::from_value(request_value(args).clone())
        .map_err(|error| format!("Invalid request: {error}"))
}

pub(crate) async fn validate_draft(args: &Value) -> Result<Value, String> {
    let draft: CronJobDraft = parse(args)?;
    serde_json::to_value(validate_cron_job_draft(
        &draft,
        chrono::Utc::now().timestamp_millis(),
    ))
    .map_err(|error| error.to_string())
}

pub(crate) async fn preview_occurrences(args: &Value) -> Result<Value, String> {
    let request: PreviewCronOccurrencesRequest = parse(args)?;
    let wants_jobs = request.job_ids.is_some() || request.schedule.is_none();
    let jobs = match get_global_cron_service() {
        Some(service) if wants_jobs => service.list_jobs().await,
        _ => Vec::new(),
    };
    serde_json::to_value(answer_preview_request(
        &request,
        &jobs,
        chrono::Utc::now().timestamp_millis(),
    ))
    .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[tokio::test]
    async fn previews_a_draft_without_a_cron_host() {
        let value = preview_occurrences(&json!({
            "request": {
                "schedule": { "kind": "cron", "expr": "0 9 * * 1-5", "tz": "UTC" },
                "count": 3
            }
        }))
        .await
        .expect("preview");
        assert_eq!(value["schedule"]["valid"], true);
        assert_eq!(
            value["schedule"]["occurrences"].as_array().map(Vec::len),
            Some(3)
        );
        assert!(value["jobs"].as_array().is_some_and(Vec::is_empty));
    }

    #[tokio::test]
    async fn validates_a_draft() {
        let value = validate_draft(&json!({
            "request": { "name": "", "payload": { "text": "x" }, "schedule": { "kind": "every", "everyMs": 0 } }
        }))
        .await
        .expect("validate");
        assert_eq!(value["valid"], false);
        assert_eq!(value["issues"][0]["code"], "name_required");
        assert_eq!(value["issues"][1]["code"], "interval_positive");
    }
}

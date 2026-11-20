//! Draft validation and run previews for scheduled jobs.
//!
//! Every client used to parse cron expressions on its own to validate the
//! editor and to project the calendar, and those parsers disagreed with the
//! scheduler (aliases, day-of-week numbering, time zones). These functions
//! answer from the same schedule code the scheduler runs, so what a client
//! previews is what the host will run.

use super::schedule::{compute_next_run_after_ms, normalize_cron_expr, parse_timezone};
use super::types::{CronJob, CronJobPayload, CronSchedule};
use chrono::DateTime;
use cron::Schedule;
use serde::{Deserialize, Serialize};
use std::str::FromStr;

/// Default number of runs previewed for a draft schedule.
pub const DEFAULT_DRAFT_PREVIEW_COUNT: usize = 5;
/// Default number of runs previewed per saved job in a window.
pub const DEFAULT_JOB_PREVIEW_COUNT: usize = 96;
/// Upper bound on runs returned per schedule, whatever the caller asks for.
pub const MAX_PREVIEW_COUNT: usize = 1000;

/// One reason a draft cannot be saved. `code` is stable for clients to
/// localize; `message` is the backend's English explanation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CronDraftIssue {
    /// `name`, `payload` or `schedule`.
    pub field: String,
    /// `name_required`, `payload_required`, `interval_positive`,
    /// `invalid_cron`, `invalid_timezone`, `invalid_timestamp` or
    /// `no_future_run`.
    pub code: String,
    pub message: String,
}

impl CronDraftIssue {
    fn new(field: &str, code: &str, message: impl Into<String>) -> Self {
        Self {
            field: field.to_string(),
            code: code.to_string(),
            message: message.into(),
        }
    }
}

/// The parts of a job draft the scheduler validates. Fields are optional so a
/// partially filled editor can be checked as the user types.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CronJobDraft {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub payload: Option<CronJobPayload>,
    #[serde(default)]
    pub schedule: Option<CronSchedule>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CronDraftValidation {
    pub valid: bool,
    pub issues: Vec<CronDraftIssue>,
}

/// Checks a draft with the rules `create_job` / `update_job` apply.
pub fn validate_cron_job_draft(draft: &CronJobDraft, now_ms: i64) -> CronDraftValidation {
    let mut issues = Vec::new();
    if draft
        .name
        .as_deref()
        .map(str::trim)
        .unwrap_or_default()
        .is_empty()
    {
        issues.push(CronDraftIssue::new(
            "name",
            "name_required",
            "Scheduled job name must not be empty",
        ));
    }
    if draft
        .payload
        .as_ref()
        .map(|payload| payload.text.trim())
        .unwrap_or_default()
        .is_empty()
    {
        issues.push(CronDraftIssue::new(
            "payload",
            "payload_required",
            "Scheduled job payload.text must not be empty",
        ));
    }
    match &draft.schedule {
        Some(schedule) => {
            if let Some(issue) = schedule_issue(schedule, now_ms) {
                issues.push(issue);
            }
        }
        None => issues.push(CronDraftIssue::new(
            "schedule",
            "invalid_cron",
            "Scheduled job schedule is required",
        )),
    }
    CronDraftValidation {
        valid: issues.is_empty(),
        issues,
    }
}

/// Why `schedule` cannot be scheduled, classified for the editor.
pub fn schedule_issue(schedule: &CronSchedule, now_ms: i64) -> Option<CronDraftIssue> {
    match schedule {
        CronSchedule::Every { every_ms, .. } => (*every_ms == 0).then(|| {
            CronDraftIssue::new(
                "schedule",
                "interval_positive",
                "Recurring schedule everyMs must be greater than 0",
            )
        }),
        CronSchedule::At { at } => DateTime::parse_from_rfc3339(at.trim()).err().map(|error| {
            CronDraftIssue::new(
                "schedule",
                "invalid_timestamp",
                format!("Invalid ISO-8601 timestamp '{}': {}", at, error),
            )
        }),
        CronSchedule::Cron { expr, tz } => {
            if let Some(tz) = tz.as_deref().filter(|tz| !tz.trim().is_empty()) {
                if let Err(error) = parse_timezone(tz.trim()) {
                    return Some(CronDraftIssue::new(
                        "schedule",
                        "invalid_timezone",
                        error.to_string(),
                    ));
                }
            }
            let normalized = match normalize_cron_expr(expr) {
                Ok(normalized) => normalized,
                Err(error) => {
                    return Some(CronDraftIssue::new(
                        "schedule",
                        "invalid_cron",
                        error.to_string(),
                    ))
                }
            };
            if let Err(error) = Schedule::from_str(&normalized) {
                return Some(CronDraftIssue::new(
                    "schedule",
                    "invalid_cron",
                    format!("Invalid cron expression '{}': {}", expr, error),
                ));
            }
            match compute_next_run_after_ms(schedule, now_ms, now_ms) {
                Ok(Some(_)) => None,
                Ok(None) | Err(_) => Some(CronDraftIssue::new(
                    "schedule",
                    "no_future_run",
                    format!("Cron expression '{}' produced no future run time", expr),
                )),
            }
        }
    }
}

/// The scheduler's run times for one schedule within `[from_ms, to_ms]`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CronOccurrencePreview {
    pub valid: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub issue: Option<CronDraftIssue>,
    /// Run times in epoch milliseconds, ascending.
    pub occurrences: Vec<i64>,
    /// More runs fall in the window than `count` allowed.
    pub truncated: bool,
}

/// The preview of one saved job.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CronJobOccurrencePreview {
    pub job_id: String,
    #[serde(flatten)]
    pub preview: CronOccurrencePreview,
}

/// Runs of `schedule` from `from_ms` (inclusive) to `to_ms` (inclusive, no
/// bound when `None`), at most `count`. `anchor_ms` stands for the job's
/// creation time, which aligns interval schedules without an anchor.
/// `fallback_tz` applies to a cron schedule that names no zone of its own.
pub fn preview_schedule_occurrences(
    schedule: &CronSchedule,
    anchor_ms: i64,
    from_ms: i64,
    to_ms: Option<i64>,
    count: usize,
    fallback_tz: Option<&str>,
) -> CronOccurrencePreview {
    let schedule = with_fallback_tz(schedule, fallback_tz);
    if let Some(issue) = schedule_issue(&schedule, from_ms) {
        // An `at` time in the past is still a valid draft; only parse errors stop it.
        return CronOccurrencePreview {
            valid: false,
            issue: Some(issue),
            occurrences: Vec::new(),
            truncated: false,
        };
    }
    let count = count.clamp(1, MAX_PREVIEW_COUNT);
    let mut occurrences = Vec::new();
    let mut truncated = false;
    if let CronSchedule::At { .. } = schedule {
        if let Ok(Some(at)) = compute_next_run_after_ms(&schedule, anchor_ms, i64::MIN) {
            if at >= from_ms && to_ms.is_none_or(|to| at <= to) {
                occurrences.push(at);
            }
        }
    } else {
        let mut cursor = from_ms.saturating_sub(1);
        loop {
            let next = match compute_next_run_after_ms(&schedule, anchor_ms, cursor) {
                Ok(Some(next)) => next,
                _ => break,
            };
            if to_ms.is_some_and(|to| next > to) {
                break;
            }
            if occurrences.len() == count {
                truncated = true;
                break;
            }
            occurrences.push(next);
            if next <= cursor {
                break;
            }
            cursor = next;
        }
    }
    CronOccurrencePreview {
        valid: true,
        issue: None,
        occurrences,
        truncated,
    }
}

/// A saved job's runs in the window. The run the scheduler already holds
/// (`state.nextRunAtMs`, which may be a retry) is included when it falls in
/// the window, so the preview never hides a pending run.
pub fn preview_job_occurrences(
    job: &CronJob,
    from_ms: i64,
    to_ms: Option<i64>,
    count: usize,
) -> CronJobOccurrencePreview {
    let mut preview = preview_schedule_occurrences(
        &job.schedule,
        job.created_at_ms,
        from_ms,
        to_ms,
        count,
        None,
    );
    if let Some(next) = job.state.next_run_at_ms {
        if next >= from_ms
            && to_ms.is_none_or(|to| next <= to)
            && !preview.occurrences.contains(&next)
        {
            preview.occurrences.push(next);
            preview.occurrences.sort_unstable();
            if preview.occurrences.len() > count.clamp(1, MAX_PREVIEW_COUNT) {
                preview.occurrences.pop();
                preview.truncated = true;
            }
        }
    }
    CronJobOccurrencePreview {
        job_id: job.id.clone(),
        preview,
    }
}

/// `preview_cron_occurrences`: a draft schedule, saved jobs, or both.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewCronOccurrencesRequest {
    /// A draft schedule from an editor.
    #[serde(default)]
    pub schedule: Option<CronSchedule>,
    /// The zone a draft cron schedule without its own `tz` will be saved with.
    /// Omitted, the host's zone applies, which is where the job runs.
    #[serde(default)]
    pub time_zone: Option<String>,
    /// Saved jobs to preview. Omitted with no `schedule`: every enabled job.
    #[serde(default)]
    pub job_ids: Option<Vec<String>>,
    /// Window start in epoch ms; defaults to now.
    #[serde(default)]
    pub from_ms: Option<i64>,
    /// Window end in epoch ms; omitted, only `count` bounds the preview.
    #[serde(default)]
    pub to_ms: Option<i64>,
    /// Runs per schedule (default 5 for a draft, 96 per job; at most 1000).
    #[serde(default)]
    pub count: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewCronOccurrencesResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schedule: Option<CronOccurrencePreview>,
    pub jobs: Vec<CronJobOccurrencePreview>,
}

/// Answers `preview_cron_occurrences` from the given jobs (the host's cron
/// service list; empty on a host without one).
pub fn answer_preview_request(
    request: &PreviewCronOccurrencesRequest,
    jobs: &[CronJob],
    now_ms: i64,
) -> PreviewCronOccurrencesResponse {
    let from_ms = request.from_ms.unwrap_or(now_ms);
    let to_ms = request.to_ms.filter(|to| *to >= from_ms);
    let schedule = request.schedule.as_ref().map(|schedule| {
        preview_schedule_occurrences(
            schedule,
            now_ms,
            from_ms,
            to_ms,
            request.count.unwrap_or(DEFAULT_DRAFT_PREVIEW_COUNT),
            request.time_zone.as_deref(),
        )
    });
    let wants_jobs = request.job_ids.is_some() || request.schedule.is_none();
    let jobs = if wants_jobs {
        jobs.iter()
            .filter(|job| match &request.job_ids {
                Some(ids) => ids.iter().any(|id| id == &job.id),
                None => job.enabled,
            })
            .map(|job| {
                preview_job_occurrences(
                    job,
                    from_ms,
                    to_ms,
                    request.count.unwrap_or(DEFAULT_JOB_PREVIEW_COUNT),
                )
            })
            .collect()
    } else {
        Vec::new()
    };
    PreviewCronOccurrencesResponse { schedule, jobs }
}

fn with_fallback_tz(schedule: &CronSchedule, fallback_tz: Option<&str>) -> CronSchedule {
    match (
        schedule,
        fallback_tz.map(str::trim).filter(|tz| !tz.is_empty()),
    ) {
        (CronSchedule::Cron { expr, tz }, Some(fallback))
            if tz.as_deref().map(str::trim).unwrap_or_default().is_empty() =>
        {
            CronSchedule::Cron {
                expr: expr.clone(),
                tz: Some(fallback.to_string()),
            }
        }
        (CronSchedule::Cron { expr, tz }, _) => CronSchedule::Cron {
            expr: expr.trim().to_string(),
            tz: tz
                .as_deref()
                .map(str::trim)
                .filter(|tz| !tz.is_empty())
                .map(str::to_string),
        },
        (other, _) => other.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{Datelike, TimeZone, Timelike, Utc, Weekday};

    fn utc_ms(y: i32, m: u32, d: u32, h: u32, min: u32) -> i64 {
        Utc.with_ymd_and_hms(y, m, d, h, min, 0)
            .single()
            .expect("valid datetime")
            .timestamp_millis()
    }

    fn weekday(ms: i64) -> Weekday {
        Utc.timestamp_millis_opt(ms).single().expect("ms").weekday()
    }

    #[test]
    fn unix_weekday_range_runs_monday_to_friday() {
        // 2026-11-15 is a Sunday.
        let from = utc_ms(2026, 11, 15, 0, 0);
        let preview = preview_schedule_occurrences(
            &CronSchedule::Cron {
                expr: "0 9 * * 1-5".to_string(),
                tz: Some("UTC".to_string()),
            },
            from,
            from,
            None,
            5,
            None,
        );
        assert!(preview.valid);
        let days: Vec<Weekday> = preview.occurrences.iter().map(|ms| weekday(*ms)).collect();
        assert_eq!(
            days,
            vec![
                Weekday::Mon,
                Weekday::Tue,
                Weekday::Wed,
                Weekday::Thu,
                Weekday::Fri
            ]
        );
        assert!(preview.occurrences.iter().all(|ms| {
            let at = Utc.timestamp_millis_opt(*ms).single().expect("ms");
            at.hour() == 9 && at.minute() == 0
        }));
    }

    #[test]
    fn unix_sunday_is_zero_or_seven() {
        let from = utc_ms(2026, 11, 16, 0, 0);
        for expr in ["0 9 * * 0", "0 9 * * 7", "0 9 * * sun"] {
            let preview = preview_schedule_occurrences(
                &CronSchedule::Cron {
                    expr: expr.to_string(),
                    tz: Some("UTC".to_string()),
                },
                from,
                from,
                None,
                2,
                None,
            );
            assert!(preview.valid, "{expr}");
            assert!(
                preview
                    .occurrences
                    .iter()
                    .all(|ms| weekday(*ms) == Weekday::Sun),
                "{expr}"
            );
        }
        let preview = preview_schedule_occurrences(
            &CronSchedule::Cron {
                expr: "0 9 * * 5-7".to_string(),
                tz: Some("UTC".to_string()),
            },
            from,
            from,
            None,
            3,
            None,
        );
        let days: Vec<Weekday> = preview.occurrences.iter().map(|ms| weekday(*ms)).collect();
        assert_eq!(days, vec![Weekday::Fri, Weekday::Sat, Weekday::Sun]);
    }

    #[test]
    fn shorthand_aliases_are_accepted() {
        let from = utc_ms(2026, 11, 16, 10, 30);
        let preview = preview_schedule_occurrences(
            &CronSchedule::Cron {
                expr: "@daily".to_string(),
                tz: Some("UTC".to_string()),
            },
            from,
            from,
            None,
            2,
            None,
        );
        assert!(preview.valid);
        assert_eq!(
            preview.occurrences,
            vec![utc_ms(2026, 11, 17, 0, 0), utc_ms(2026, 11, 18, 0, 0)]
        );
    }

    #[test]
    fn window_bounds_and_truncation() {
        let from = utc_ms(2026, 11, 16, 0, 0);
        let to = utc_ms(2026, 11, 16, 23, 59);
        let schedule = CronSchedule::Cron {
            expr: "0 * * * *".to_string(),
            tz: Some("UTC".to_string()),
        };
        let all = preview_schedule_occurrences(&schedule, from, from, Some(to), 100, None);
        assert_eq!(all.occurrences.len(), 24);
        assert!(!all.truncated);
        assert_eq!(all.occurrences[0], from);
        let capped = preview_schedule_occurrences(&schedule, from, from, Some(to), 4, None);
        assert_eq!(capped.occurrences.len(), 4);
        assert!(capped.truncated);
    }

    #[test]
    fn fallback_zone_applies_only_without_own_zone() {
        let from = utc_ms(2026, 11, 16, 0, 0);
        let own = preview_schedule_occurrences(
            &CronSchedule::Cron {
                expr: "0 8 * * *".to_string(),
                tz: Some("UTC".to_string()),
            },
            from,
            from,
            None,
            1,
            Some("Asia/Shanghai"),
        );
        assert_eq!(own.occurrences, vec![utc_ms(2026, 11, 16, 8, 0)]);
        let fallback = preview_schedule_occurrences(
            &CronSchedule::Cron {
                expr: "0 8 * * *".to_string(),
                tz: None,
            },
            from,
            from,
            None,
            1,
            Some("Asia/Shanghai"),
        );
        // 08:00 in Shanghai is 00:00 UTC, the window start itself.
        assert_eq!(fallback.occurrences, vec![utc_ms(2026, 11, 16, 0, 0)]);
    }

    #[test]
    fn interval_and_one_shot_previews() {
        let anchor = utc_ms(2026, 11, 16, 0, 0);
        let every = preview_schedule_occurrences(
            &CronSchedule::Every {
                every_ms: 30 * 60_000,
                anchor_ms: Some(anchor),
            },
            anchor,
            anchor + 1,
            Some(anchor + 2 * 3_600_000),
            10,
            None,
        );
        assert_eq!(every.occurrences.len(), 4);
        assert_eq!(every.occurrences[0], anchor + 30 * 60_000);

        let at = CronSchedule::At {
            at: "2026-11-20T09:00:00Z".to_string(),
        };
        let inside = preview_schedule_occurrences(
            &at,
            anchor,
            anchor,
            Some(utc_ms(2026, 11, 30, 0, 0)),
            5,
            None,
        );
        assert_eq!(inside.occurrences, vec![utc_ms(2026, 11, 20, 9, 0)]);
        let outside =
            preview_schedule_occurrences(&at, anchor, utc_ms(2026, 11, 21, 0, 0), None, 5, None);
        assert!(outside.valid);
        assert!(outside.occurrences.is_empty());
    }

    #[test]
    fn draft_issues_are_classified() {
        let now = utc_ms(2026, 11, 16, 0, 0);
        let draft: CronJobDraft = serde_json::from_value(serde_json::json!({
            "name": "  ",
            "payload": { "text": "" },
            "schedule": { "kind": "cron", "expr": "61 * * * *" }
        }))
        .expect("draft");
        let result = validate_cron_job_draft(&draft, now);
        assert!(!result.valid);
        let codes: Vec<&str> = result.issues.iter().map(|i| i.code.as_str()).collect();
        assert_eq!(
            codes,
            vec!["name_required", "payload_required", "invalid_cron"]
        );

        let cases = [
            (
                serde_json::json!({ "kind": "every", "everyMs": 0 }),
                "interval_positive",
            ),
            (
                serde_json::json!({ "kind": "at", "at": "tomorrow" }),
                "invalid_timestamp",
            ),
            (
                serde_json::json!({ "kind": "cron", "expr": "0 9 * * *", "tz": "Mars/Base" }),
                "invalid_timezone",
            ),
            (
                serde_json::json!({ "kind": "cron", "expr": "0 9 * *" }),
                "invalid_cron",
            ),
            (
                serde_json::json!({ "kind": "cron", "expr": "0 9 * * 8" }),
                "invalid_cron",
            ),
        ];
        for (schedule, code) in cases {
            let schedule: CronSchedule = serde_json::from_value(schedule).expect("schedule");
            let issue = schedule_issue(&schedule, now).expect("issue");
            assert_eq!(issue.code, code);
        }

        let ok: CronJobDraft = serde_json::from_value(serde_json::json!({
            "name": "Digest",
            "payload": { "text": "Summarize" },
            "schedule": { "kind": "cron", "expr": "0 9 * * 1-5" }
        }))
        .expect("draft");
        assert!(validate_cron_job_draft(&ok, now).valid);
    }

    #[test]
    fn request_defaults_and_legacy_shapes() {
        // A bare `{}` (an older client) previews every enabled job from now.
        let request: PreviewCronOccurrencesRequest =
            serde_json::from_value(serde_json::json!({})).expect("empty request");
        assert!(request.schedule.is_none() && request.job_ids.is_none());
        let job: CronJob = serde_json::from_value(serde_json::json!({
            "id": "cron_1",
            "name": "Digest",
            "schedule": { "kind": "every", "everyMs": 3600000, "anchorMs": 0 },
            "payload": { "text": "hi" },
            "enabled": true,
            "target": {
                "kind": "session",
                "sessionId": "s1",
                "workspace": { "workspacePath": "/repo" }
            },
            "createdAtMs": 0,
            "configUpdatedAtMs": 0,
            "updatedAtMs": 0
        }))
        .expect("legacy job without state");
        let mut paused = job.clone();
        paused.id = "cron_2".to_string();
        paused.enabled = false;
        let now = 10 * 3_600_000 + 1;
        let response = answer_preview_request(&request, &[job.clone(), paused.clone()], now);
        assert!(response.schedule.is_none());
        assert_eq!(response.jobs.len(), 1);
        assert_eq!(response.jobs[0].job_id, "cron_1");
        assert_eq!(
            response.jobs[0].preview.occurrences.len(),
            DEFAULT_JOB_PREVIEW_COUNT
        );
        assert_eq!(response.jobs[0].preview.occurrences[0], 11 * 3_600_000);

        let request: PreviewCronOccurrencesRequest = serde_json::from_value(serde_json::json!({
            "schedule": { "kind": "cron", "expr": "nope" },
            "jobIds": ["cron_2"],
            "fromMs": now,
            "toMs": now + 3 * 3_600_000,
            "count": 2
        }))
        .expect("full request");
        let response = answer_preview_request(&request, &[job, paused], now);
        let draft = response.schedule.expect("draft preview");
        assert!(!draft.valid);
        assert_eq!(draft.issue.expect("issue").code, "invalid_cron");
        assert_eq!(response.jobs.len(), 1);
        assert_eq!(response.jobs[0].preview.occurrences.len(), 2);
        assert!(response.jobs[0].preview.truncated);
        let json = serde_json::to_value(&response.jobs[0]).expect("serialize");
        assert_eq!(json["jobId"], "cron_2");
        assert!(json["occurrences"].is_array());
    }

    #[test]
    fn legacy_six_field_expressions_keep_crate_numbering() {
        let from = utc_ms(2026, 11, 15, 0, 0);
        let preview = preview_schedule_occurrences(
            &CronSchedule::Cron {
                expr: "0 0 9 * * 2".to_string(),
                tz: Some("UTC".to_string()),
            },
            from,
            from,
            None,
            1,
            None,
        );
        assert_eq!(weekday(preview.occurrences[0]), Weekday::Mon);
    }
}

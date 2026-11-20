//! Schedule calculation helpers.

use super::types::{CronJob, CronSchedule};
use crate::util::errors::{OpenBitFunError, OpenBitFunResult};
use chrono::{DateTime, Local, TimeZone, Utc};
use chrono_tz::Tz;
use cron::Schedule;
use std::str::FromStr;

pub(super) fn validate_schedule(
    schedule: &CronSchedule,
    created_at_ms: i64,
) -> OpenBitFunResult<()> {
    let _ = compute_next_run_after_ms(schedule, created_at_ms, created_at_ms - 1)?;
    Ok(())
}

pub(super) fn compute_initial_next_run_at_ms(
    job: &CronJob,
    now_ms: i64,
) -> OpenBitFunResult<Option<i64>> {
    match &job.schedule {
        CronSchedule::At { .. } => {
            if job.state.last_enqueued_at_ms.is_some() || job.state.active_turn_id.is_some() {
                return Ok(None);
            }

            parse_at_timestamp_ms(&job.schedule).map(Some)
        }
        _ => compute_next_run_after_ms(&job.schedule, job.created_at_ms, now_ms),
    }
}

pub(super) fn compute_next_run_after_ms(
    schedule: &CronSchedule,
    created_at_ms: i64,
    after_ms: i64,
) -> OpenBitFunResult<Option<i64>> {
    match schedule {
        CronSchedule::At { .. } => {
            let at_ms = parse_at_timestamp_ms(schedule)?;
            if at_ms > after_ms {
                Ok(Some(at_ms))
            } else {
                Ok(None)
            }
        }
        CronSchedule::Every {
            every_ms,
            anchor_ms,
        } => compute_every_next_run_ms(*every_ms, anchor_ms.unwrap_or(created_at_ms), after_ms)
            .map(Some),
        CronSchedule::Cron { expr, tz } => {
            compute_cron_next_run_ms(expr, tz.as_deref(), after_ms).map(Some)
        }
    }
}

fn parse_at_timestamp_ms(schedule: &CronSchedule) -> OpenBitFunResult<i64> {
    let CronSchedule::At { at } = schedule else {
        return Err(OpenBitFunError::validation(
            "parse_at_timestamp_ms requires an 'at' schedule",
        ));
    };

    let parsed = DateTime::parse_from_rfc3339(at).map_err(|error| {
        OpenBitFunError::validation(format!("Invalid ISO-8601 timestamp '{}': {}", at, error))
    })?;
    Ok(parsed.timestamp_millis())
}

fn compute_every_next_run_ms(
    every_ms: u64,
    anchor_ms: i64,
    after_ms: i64,
) -> OpenBitFunResult<i64> {
    if every_ms == 0 {
        return Err(OpenBitFunError::validation(
            "Recurring schedule everyMs must be greater than 0",
        ));
    }

    if anchor_ms > after_ms {
        return Ok(anchor_ms);
    }

    let interval = i128::from(every_ms);
    let anchor = i128::from(anchor_ms);
    let after = i128::from(after_ms);
    let steps = ((after - anchor) / interval) + 1;
    let next = anchor + (steps * interval);

    i64::try_from(next).map_err(|_| {
        OpenBitFunError::service("Recurring schedule next run timestamp overflowed i64")
    })
}

fn compute_cron_next_run_ms(expr: &str, tz: Option<&str>, after_ms: i64) -> OpenBitFunResult<i64> {
    let normalized_expr = normalize_cron_expr(expr)?;
    let schedule = Schedule::from_str(&normalized_expr).map_err(|error| {
        OpenBitFunError::validation(format!("Invalid cron expression '{}': {}", expr, error))
    })?;

    match tz {
        Some(tz_name) => {
            let timezone = parse_timezone(tz_name)?;
            let after = timezone
                .timestamp_millis_opt(after_ms)
                .single()
                .ok_or_else(|| {
                    OpenBitFunError::validation(format!(
                        "Unable to interpret timestamp {} in timezone {}",
                        after_ms, tz_name
                    ))
                })?;

            schedule
                .after(&after)
                .next()
                .map(|next| next.with_timezone(&Utc).timestamp_millis())
                .ok_or_else(|| {
                    OpenBitFunError::validation(format!(
                        "Cron expression '{}' produced no future run time",
                        expr
                    ))
                })
        }
        None => {
            let after = Local
                .timestamp_millis_opt(after_ms)
                .single()
                .ok_or_else(|| {
                    OpenBitFunError::validation(format!(
                        "Unable to interpret local timestamp {}",
                        after_ms
                    ))
                })?;

            schedule
                .after(&after)
                .next()
                .map(|next| next.with_timezone(&Utc).timestamp_millis())
                .ok_or_else(|| {
                    OpenBitFunError::validation(format!(
                        "Cron expression '{}' produced no future run time",
                        expr
                    ))
                })
        }
    }
}

pub(super) fn parse_timezone(tz_name: &str) -> OpenBitFunResult<Tz> {
    Tz::from_str(tz_name).map_err(|error| {
        OpenBitFunError::validation(format!("Invalid timezone '{}': {}", tz_name, error))
    })
}

/// Turns the stored expression into the `cron` crate's 6/7-field form.
///
/// A 5-field expression is standard Unix cron (the form the editor presets, the
/// cron tool examples and users write): day-of-week `0`/`7` is Sunday and `1-5`
/// is Monday to Friday. The `cron` crate numbers days of the week `1`-`7` from
/// Sunday, so 5-field numeric days are translated; 6/7-field expressions keep the
/// crate's (Quartz) numbering. `@daily`-style shorthands pass through.
pub(super) fn normalize_cron_expr(expr: &str) -> OpenBitFunResult<String> {
    let trimmed = expr.trim();
    if trimmed.starts_with('@') {
        return Ok(trimmed.to_ascii_lowercase());
    }
    let fields = trimmed.split_whitespace().collect::<Vec<_>>();
    match fields.len() {
        5 => {
            let dow = translate_unix_day_of_week(fields[4]).ok_or_else(|| {
                OpenBitFunError::validation(format!(
                    "Invalid day-of-week field '{}' in cron expression '{}'",
                    fields[4], expr
                ))
            })?;
            Ok(format!(
                "0 {} {} {} {} {}",
                fields[0], fields[1], fields[2], fields[3], dow
            ))
        }
        6 | 7 => Ok(fields.join(" ")),
        other => Err(OpenBitFunError::validation(format!(
            "Cron expression '{}' must contain 5, 6, or 7 fields, found {}",
            expr, other
        ))),
    }
}

/// Unix day-of-week (0-7, Sunday = 0 or 7) to the `cron` crate's (1-7,
/// Sunday = 1). Names, `*` and `?` keep their meaning and pass through.
fn translate_unix_day_of_week(field: &str) -> Option<String> {
    fn unix_to_crate(token: &str) -> Option<Result<u32, ()>> {
        if token.chars().all(|c| c.is_ascii_digit()) && !token.is_empty() {
            let value: u32 = token.parse().ok()?;
            if value > 7 {
                return Some(Err(()));
            }
            return Some(Ok(value % 7 + 1));
        }
        None
    }
    let mut parts = Vec::new();
    for part in field.split(',') {
        let (range, step) = match part.split_once('/') {
            Some((range, step)) => (range, Some(step)),
            None => (part, None),
        };
        let suffix = step.map(|step| format!("/{step}")).unwrap_or_default();
        if let Some((start, end)) = range.split_once('-') {
            let start_value = match unix_to_crate(start) {
                Some(Ok(value)) => Some(value),
                Some(Err(())) => return None,
                None => None,
            };
            let end_is_sunday = end == "7";
            let end_value = match unix_to_crate(end) {
                Some(Ok(value)) => Some(value),
                Some(Err(())) => return None,
                None => None,
            };
            let start_text = start_value
                .map(|value| value.to_string())
                .unwrap_or_else(|| start.to_string());
            if end_is_sunday {
                // `a-7` ends on Sunday, which the crate numbers 1: keep the
                // weekday run to Saturday and add Sunday when the step lands on it.
                if start_value == Some(1) {
                    parts.push(format!("1-7{suffix}"));
                    continue;
                }
                parts.push(format!("{start_text}-7{suffix}"));
                let start_unix: u32 = start.parse().unwrap_or(0);
                let step_value: u32 = step.and_then(|step| step.parse().ok()).unwrap_or(1);
                if step_value > 0 && (7 - start_unix) % step_value == 0 {
                    parts.push("1".to_string());
                }
                continue;
            }
            let end_text = end_value
                .map(|value| value.to_string())
                .unwrap_or_else(|| end.to_string());
            parts.push(format!("{start_text}-{end_text}{suffix}"));
        } else {
            match unix_to_crate(range) {
                Some(Ok(value)) => parts.push(format!("{value}{suffix}")),
                Some(Err(())) => return None,
                None => parts.push(part.to_string()),
            }
        }
    }
    Some(parts.join(","))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::service::cron::{CronJobPayload, CronJobState, CronJobTarget, CronWorkspaceRef};

    fn sample_job(schedule: CronSchedule) -> CronJob {
        CronJob {
            id: "cron_test".to_string(),
            name: "test".to_string(),
            schedule,
            payload: CronJobPayload {
                text: "hello".to_string(),
            },
            enabled: true,
            target: CronJobTarget::Session {
                session_id: "session_1".to_string(),
                workspace: CronWorkspaceRef {
                    workspace_id: None,
                    workspace_path: "E:/workspace".to_string(),
                    project_workspace_path: None,
                    execution_target: None,
                    remote_connection_id: None,
                    remote_ssh_host: None,
                },
            },
            created_at_ms: 1_700_000_000_000,
            config_updated_at_ms: 1_700_000_000_000,
            updated_at_ms: 1_700_000_000_000,
            state: CronJobState::default(),
            report_policy: Default::default(),
        }
    }

    #[test]
    fn every_schedule_keeps_anchor_alignment() {
        let next = compute_next_run_after_ms(
            &CronSchedule::Every {
                every_ms: 60_000,
                anchor_ms: Some(1_000),
            },
            1_000,
            181_000,
        )
        .expect("next run");

        assert_eq!(next, Some(241_000));
    }

    #[test]
    fn initial_at_schedule_runs_even_if_time_has_passed() {
        let mut job = sample_job(CronSchedule::At {
            at: "2026-03-17T08:00:00+08:00".to_string(),
        });
        job.created_at_ms = 1_763_667_200_000;

        let next = compute_initial_next_run_at_ms(&job, 1_763_700_000_000).expect("initial next");
        assert_eq!(next, Some(1_773_705_600_000));
    }

    #[test]
    fn cron_schedule_respects_timezone() {
        let after_ms = Utc
            .with_ymd_and_hms(2026, 3, 17, 0, 30, 0)
            .single()
            .expect("valid datetime")
            .timestamp_millis();

        let next = compute_next_run_after_ms(
            &CronSchedule::Cron {
                expr: "0 8 * * *".to_string(),
                tz: Some("Asia/Shanghai".to_string()),
            },
            after_ms,
            after_ms,
        )
        .expect("cron next");

        let expected = Utc
            .with_ymd_and_hms(2026, 3, 18, 0, 0, 0)
            .single()
            .expect("valid datetime")
            .timestamp_millis();

        assert_eq!(next, Some(expected));
    }
}

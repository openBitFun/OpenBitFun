//! Day-keyed usage activity: the calendar heatmap behind the Home overview and
//! the Usage page.
//!
//! Clients used to re-key trend buckets into days on their own, Home in UTC and
//! the Usage page in the local zone, so the same day could land in different
//! cells. The backend now keys every record into a calendar day of one IANA zone,
//! lays the days on a Monday-first week grid, scales the five shades and counts
//! streaks. A client only draws the cells.

use super::time_zone::{local_date_start_utc, parse_time_zone};
use super::types::TokenUsageRecord;
use chrono::{DateTime, Datelike, Duration, Months, NaiveDate, Utc};
use chrono_tz::Tz;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Months the activity window covers when the request does not say.
pub const DEFAULT_ACTIVITY_MONTHS: u32 = 6;
/// Longest window a request may ask for.
pub const MAX_ACTIVITY_MONTHS: u32 = 12;
/// Busiest shade a cell can reach (the scale is 0..=4).
pub const ACTIVITY_LEVELS: u8 = 4;

fn default_include_subagent() -> bool {
    true
}

/// `get_token_usage_activity` request. Every field is optional so an older or
/// minimal client gets the six-month UTC window.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenUsageActivityRequest {
    /// IANA zone the calendar days are keyed in; missing means UTC.
    #[serde(default)]
    pub time_zone: Option<String>,
    /// Calendar months before today the window starts at (1..=12, default 6).
    #[serde(default)]
    pub months: Option<u32>,
    /// Subagent calls count toward the day, as on both previous readers.
    #[serde(default = "default_include_subagent")]
    pub include_subagent: bool,
}

impl Default for TokenUsageActivityRequest {
    fn default() -> Self {
        Self {
            time_zone: None,
            months: None,
            include_subagent: true,
        }
    }
}

/// One cell of the grid.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageActivityDay {
    /// `YYYY-MM-DD` in the request's zone.
    pub date: String,
    /// 1..=12.
    pub month: u32,
    pub day_of_month: u32,
    /// Input plus output tokens recorded that day (cache reads are part of input).
    pub tokens: u64,
    /// 0 for a quiet day, 4 for the busiest day in the window.
    pub level: u8,
    /// False for the leading and trailing padding cells of the grid.
    pub in_range: bool,
}

/// A month label above the grid's week column it starts in.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageActivityMonthHeader {
    pub week_index: u32,
    /// 1..=12; the client localizes the label.
    pub month: u32,
}

/// The whole activity view model.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenUsageActivity {
    /// The zone the days are keyed in (`UTC` when the request had none).
    pub time_zone: String,
    pub months: u32,
    /// First in-range day.
    pub start_date: String,
    /// Today in the zone; the last in-range day.
    pub end_date: String,
    /// Monday-first weeks; `days.len() == week_count * 7`.
    pub week_count: u32,
    pub days: Vec<UsageActivityDay>,
    pub month_headers: Vec<UsageActivityMonthHeader>,
    pub total_tokens: u64,
    pub peak_tokens: u64,
    pub active_days: u32,
    pub longest_streak: u32,
    /// Consecutive active days ending today, or yesterday while today is quiet.
    pub current_streak: u32,
}

/// The validated window of one request.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ActivityWindow {
    pub time_zone: Tz,
    pub months: u32,
    pub start: NaiveDate,
    pub end: NaiveDate,
}

impl ActivityWindow {
    /// The UTC instants bounding the window: local midnight of the first day up
    /// to local midnight after today.
    pub fn utc_bounds(&self) -> Result<(DateTime<Utc>, DateTime<Utc>), String> {
        let start = local_date_start_utc(self.start, self.time_zone)?;
        let end = local_date_start_utc(self.end + Duration::days(1), self.time_zone)?;
        Ok((start, end))
    }
}

impl TokenUsageActivityRequest {
    /// Resolves the zone and the calendar window ending today in that zone.
    pub fn window_at(&self, now: DateTime<Utc>) -> Result<ActivityWindow, String> {
        let time_zone = parse_time_zone(self.time_zone.as_deref())?;
        let months = self
            .months
            .unwrap_or(DEFAULT_ACTIVITY_MONTHS)
            .clamp(1, MAX_ACTIVITY_MONTHS);
        let end = now.with_timezone(&time_zone).date_naive();
        Ok(ActivityWindow {
            time_zone,
            months,
            start: window_start(end, months)?,
            end,
        })
    }
}

/// The day after the same day-of-month `months` calendar months before `end`
/// (clamped to that month's length), so the window holds exactly `months`
/// months of days.
fn window_start(end: NaiveDate, months: u32) -> Result<NaiveDate, String> {
    let first_of_end_month = end
        .with_day(1)
        .ok_or_else(|| format!("Invalid activity end date {end}"))?;
    let first_of_start_month = first_of_end_month
        .checked_sub_months(Months::new(months))
        .ok_or_else(|| format!("Activity window before {end} is out of range"))?;
    let month_length = (first_of_start_month
        .checked_add_months(Months::new(1))
        .ok_or_else(|| format!("Activity window before {end} is out of range"))?
        - first_of_start_month)
        .num_days();
    let day = i64::from(end.day()).min(month_length);
    // `first + day` is the clamped day plus one; it may roll into the next month.
    Ok(first_of_start_month + Duration::days(day))
}

fn date_key(date: NaiveDate) -> String {
    date.format("%Y-%m-%d").to_string()
}

/// Keys records into calendar days of the window's zone and builds the grid.
/// Records outside the window are ignored.
pub fn build_usage_activity(
    records: &[TokenUsageRecord],
    window: ActivityWindow,
) -> TokenUsageActivity {
    let mut daily = HashMap::<NaiveDate, u64>::new();
    for record in records {
        let day = record
            .timestamp
            .with_timezone(&window.time_zone)
            .date_naive();
        if day < window.start || day > window.end {
            continue;
        }
        *daily.entry(day).or_default() +=
            u64::from(record.input_tokens) + u64::from(record.output_tokens);
    }

    let offset = i64::from(window.start.weekday().num_days_from_monday());
    let grid_start = window.start - Duration::days(offset);
    let day_count = (window.end - window.start).num_days() + 1;
    let week_count = ((day_count + offset) as u32).div_ceil(7);

    let mut days: Vec<UsageActivityDay> = (0..i64::from(week_count) * 7)
        .map(|index| {
            let date = grid_start + Duration::days(index);
            let in_range = date >= window.start && date <= window.end;
            UsageActivityDay {
                date: date_key(date),
                month: date.month(),
                day_of_month: date.day(),
                tokens: if in_range {
                    daily.get(&date).copied().unwrap_or(0)
                } else {
                    0
                },
                level: 0,
                in_range,
            }
        })
        .collect();

    let peak_tokens = days.iter().map(|day| day.tokens).max().unwrap_or(0);
    for day in &mut days {
        day.level = level_for(day.tokens, peak_tokens);
    }

    let mut longest_streak = 0u32;
    let mut run = 0u32;
    let mut active_days = 0u32;
    for day in days.iter().filter(|day| day.in_range) {
        if day.tokens > 0 {
            run += 1;
            active_days += 1;
            longest_streak = longest_streak.max(run);
        } else {
            run = 0;
        }
    }

    let tokens_on = |date: NaiveDate| daily.get(&date).copied().unwrap_or(0);
    let mut cursor = window.end;
    if tokens_on(cursor) == 0 {
        cursor -= Duration::days(1);
    }
    let mut current_streak = 0u32;
    while cursor >= window.start && tokens_on(cursor) > 0 {
        current_streak += 1;
        cursor -= Duration::days(1);
    }

    let month_headers = month_headers(&days, week_count);
    let total_tokens = days.iter().map(|day| day.tokens).sum();

    TokenUsageActivity {
        time_zone: window.time_zone.name().to_string(),
        months: window.months,
        start_date: date_key(window.start),
        end_date: date_key(window.end),
        week_count,
        days,
        month_headers,
        total_tokens,
        peak_tokens,
        active_days,
        longest_streak,
        current_streak,
    }
}

fn level_for(tokens: u64, peak: u64) -> u8 {
    if tokens == 0 || peak == 0 {
        return 0;
    }
    let scaled = (tokens as f64 / peak as f64 * f64::from(ACTIVITY_LEVELS)).ceil() as u8;
    scaled.clamp(1, ACTIVITY_LEVELS)
}

/// A label sits over the week a month starts in. The first visible month is
/// labelled only when most of it is visible, and the last two columns stay
/// unlabelled so a label never runs off the grid.
fn month_headers(days: &[UsageActivityDay], week_count: u32) -> Vec<UsageActivityMonthHeader> {
    let first_visible = days.iter().position(|day| day.in_range);
    let mut headers = Vec::new();
    for (index, day) in days.iter().enumerate() {
        if !day.in_range {
            continue;
        }
        let is_first = Some(index) == first_visible;
        if day.day_of_month != 1 && !is_first {
            continue;
        }
        if is_first && day.day_of_month > 14 {
            continue;
        }
        let week_index = (index / 7) as u32;
        if week_index + 3 > week_count {
            continue;
        }
        headers.push(UsageActivityMonthHeader {
            week_index,
            month: day.month,
        });
    }
    headers
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn record(timestamp: &str, input: u32, output: u32) -> TokenUsageRecord {
        TokenUsageRecord {
            model_config_id: "model".into(),
            effective_model_name: "model".into(),
            session_id: "session".into(),
            turn_id: "turn".into(),
            timestamp: timestamp.parse().expect("timestamp"),
            input_tokens: input,
            output_tokens: output,
            cached_tokens: 0,
            cached_tokens_available: false,
            cache_write_tokens: 0,
            total_tokens: input + output,
            token_details: None,
            is_subagent: false,
        }
    }

    fn request(zone: Option<&str>, months: Option<u32>) -> TokenUsageActivityRequest {
        TokenUsageActivityRequest {
            time_zone: zone.map(str::to_string),
            months,
            include_subagent: true,
        }
    }

    fn day<'a>(activity: &'a TokenUsageActivity, date: &str) -> &'a UsageActivityDay {
        activity
            .days
            .iter()
            .find(|day| day.date == date)
            .expect("day in grid")
    }

    #[test]
    fn legacy_and_empty_requests_default_to_six_utc_months() {
        let request: TokenUsageActivityRequest =
            serde_json::from_value(serde_json::json!({})).expect("request");
        assert!(request.include_subagent);
        let window = request
            .window_at(Utc.with_ymd_and_hms(2026, 11, 20, 10, 0, 0).unwrap())
            .expect("window");
        assert_eq!(window.time_zone, chrono_tz::UTC);
        assert_eq!(window.months, 6);
        assert_eq!(date_key(window.start), "2026-05-21");
        assert_eq!(date_key(window.end), "2026-11-20");
    }

    #[test]
    fn months_are_clamped_and_unknown_zones_are_refused() {
        let now = Utc.with_ymd_and_hms(2026, 11, 20, 10, 0, 0).unwrap();
        assert_eq!(request(None, Some(0)).window_at(now).unwrap().months, 1);
        assert_eq!(request(None, Some(40)).window_at(now).unwrap().months, 12);
        assert!(request(Some("Mars/Base"), None).window_at(now).is_err());
    }

    #[test]
    fn window_start_clamps_short_months_and_rolls_over() {
        // Aug 31 minus six months is Feb (28 days): day 28 + 1 rolls into March.
        let start = window_start(NaiveDate::from_ymd_opt(2026, 8, 31).unwrap(), 6).unwrap();
        assert_eq!(date_key(start), "2026-03-01");
        let start = window_start(NaiveDate::from_ymd_opt(2026, 3, 15).unwrap(), 6).unwrap();
        assert_eq!(date_key(start), "2025-09-16");
    }

    #[test]
    fn days_are_keyed_in_the_requested_zone_not_utc() {
        // 2026-11-19T20:30Z is already the 20th in Shanghai (UTC+8).
        let now = Utc.with_ymd_and_hms(2026, 11, 20, 2, 0, 0).unwrap();
        let records = [record("2026-11-19T20:30:00Z", 100, 50)];

        let shanghai = build_usage_activity(
            &records,
            request(Some("Asia/Shanghai"), None).window_at(now).unwrap(),
        );
        assert_eq!(shanghai.end_date, "2026-11-20");
        assert_eq!(day(&shanghai, "2026-11-20").tokens, 150);
        assert_eq!(day(&shanghai, "2026-11-19").tokens, 0);

        let utc = build_usage_activity(&records, request(None, None).window_at(now).unwrap());
        assert_eq!(day(&utc, "2026-11-19").tokens, 150);
        assert_eq!(day(&utc, "2026-11-20").tokens, 0);
    }

    #[test]
    fn dst_transition_days_keep_their_own_records() {
        // New York leaves DST on 2026-11-01 (a 25-hour local day).
        let zone = Some("America/New_York");
        let now = Utc.with_ymd_and_hms(2026, 11, 3, 15, 0, 0).unwrap();
        let window = request(zone, Some(1)).window_at(now).unwrap();
        let (start, end) = window.utc_bounds().unwrap();
        assert_eq!(start, Utc.with_ymd_and_hms(2026, 10, 4, 4, 0, 0).unwrap());
        assert_eq!(end, Utc.with_ymd_and_hms(2026, 11, 4, 5, 0, 0).unwrap());

        let records = [
            // 00:30 EDT on Nov 1 and 23:30 EST on Nov 1: both the 1st locally.
            record("2026-11-01T04:30:00Z", 10, 0),
            record("2026-11-02T04:30:00Z", 20, 0),
            // 00:30 EST on Nov 2.
            record("2026-11-02T05:30:00Z", 5, 0),
        ];
        let activity = build_usage_activity(&records, window);
        assert_eq!(day(&activity, "2026-11-01").tokens, 30);
        assert_eq!(day(&activity, "2026-11-02").tokens, 5);
    }

    #[test]
    fn grid_is_monday_first_with_padding_and_levels_scale_to_the_peak() {
        let now = Utc.with_ymd_and_hms(2026, 11, 20, 12, 0, 0).unwrap();
        let window = request(None, None).window_at(now).unwrap();
        let records = [
            record("2026-11-20T01:00:00Z", 400, 0),
            record("2026-11-18T01:00:00Z", 100, 0),
            record("2026-11-17T01:00:00Z", 1, 0),
            // Outside the window: ignored.
            record("2026-01-01T01:00:00Z", 999_999, 0),
        ];
        let activity = build_usage_activity(&records, window);
        assert_eq!(activity.days.len() as u32, activity.week_count * 7);
        // 2026-05-21 is a Thursday: three Monday-first padding cells lead.
        assert_eq!(activity.days[0].date, "2026-05-18");
        assert!(!activity.days[0].in_range);
        assert!(activity.days[3].in_range);
        assert_eq!(activity.start_date, "2026-05-21");
        assert_eq!(day(&activity, "2026-11-20").level, 4);
        assert_eq!(day(&activity, "2026-11-18").level, 1);
        assert_eq!(day(&activity, "2026-11-17").level, 1);
        assert_eq!(day(&activity, "2026-11-19").level, 0);
        assert_eq!(activity.total_tokens, 501);
        assert_eq!(activity.peak_tokens, 400);
        assert_eq!(activity.active_days, 3);
        assert_eq!(activity.longest_streak, 2);
        assert_eq!(activity.current_streak, 1);
        assert_eq!(
            activity.month_headers.first(),
            Some(&UsageActivityMonthHeader {
                week_index: 2,
                month: 6
            })
        );
    }

    #[test]
    fn current_streak_counts_from_yesterday_while_today_is_quiet() {
        let now = Utc.with_ymd_and_hms(2026, 11, 20, 12, 0, 0).unwrap();
        let window = request(None, None).window_at(now).unwrap();
        let records = [
            record("2026-11-19T01:00:00Z", 1, 1),
            record("2026-11-18T01:00:00Z", 1, 1),
            record("2026-11-16T01:00:00Z", 1, 1),
        ];
        let activity = build_usage_activity(&records, window);
        assert_eq!(activity.current_streak, 2);
        assert_eq!(activity.longest_streak, 2);
    }

    #[test]
    fn serializes_camel_case() {
        let now = Utc.with_ymd_and_hms(2026, 11, 20, 12, 0, 0).unwrap();
        let activity = build_usage_activity(&[], request(None, Some(1)).window_at(now).unwrap());
        let value = serde_json::to_value(&activity).unwrap();
        assert!(value.get("weekCount").is_some());
        assert!(value.get("monthHeaders").is_some());
        assert!(value["days"][0].get("inRange").is_some());
        assert_eq!(value["timeZone"], "UTC");
    }
}

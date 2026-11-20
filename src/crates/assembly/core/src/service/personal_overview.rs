//! The personal overview (Home) view model.
//!
//! Home used to assemble its pulse from eight reads, each parsed and counted in
//! the client: assistants, skills (and which are enabled), routines (and which
//! run soon), Spaces (and which run), saved SSH hosts, a usage summary and the
//! activity grid. Hosts answer `get_personal_overview` with all of it, every
//! section carrying its own status so one failing owner never blanks the rest.
//! The desktop and the CLI Peer host fill the sections they own with these
//! helpers; a section a host cannot serve says so instead of reading as zero.

use crate::service::token_usage::{TokenUsageActivity, UsageStatistics};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// How far back a routine that should have run still counts as "due".
pub const DUE_SOON_LOOKBACK_MS: i64 = 60 * 60 * 1000;
/// How far ahead a routine counts as "due soon".
pub const DUE_SOON_LOOKAHEAD_MS: i64 = 24 * 60 * 60 * 1000;
/// Days the usage summary covers (a rolling window ending now).
pub const USAGE_SUMMARY_DAYS: i64 = 30;

/// One section of the overview: the owner's answer or why there is none.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "status")]
pub enum OverviewSection<T> {
    Ready {
        value: T,
    },
    /// The owner failed; `error` is its message.
    Failed {
        error: String,
    },
    /// This host does not offer the section (for example a CLI Peer host).
    Unsupported {
        error: String,
    },
}

impl<T> OverviewSection<T> {
    pub fn from_result(result: Result<T, String>) -> Self {
        match result {
            Ok(value) => Self::Ready { value },
            Err(error) => Self::Failed { error },
        }
    }

    pub fn unsupported(what: &str) -> Self {
        Self::Unsupported {
            error: format!("{what} is not available on this host"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CountOverview {
    pub count: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillsOverview {
    pub count: u32,
    pub enabled: u32,
}

/// The facts of one routine the overview needs; hosts map their job type into it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutineFacts {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub next_run_at_ms: Option<i64>,
    pub last_run_status: Option<String>,
    /// The job's schedule as the host serializes it; the client summarizes it.
    pub schedule: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DueRoutine {
    pub id: String,
    pub name: String,
    pub next_run_at_ms: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_run_status: Option<String>,
    pub schedule: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutinesOverview {
    pub count: u32,
    pub enabled: u32,
    /// Enabled routines whose next run is within the last hour or the next day,
    /// soonest first.
    pub due_soon: Vec<DueRoutine>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpaceOverviewItem {
    pub id: String,
    pub name: String,
    pub description: String,
    pub icon: String,
    pub running: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpacesOverview {
    pub count: u32,
    pub running: u32,
    pub items: Vec<SpaceOverviewItem>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshOverview {
    /// Saved connections as the SSH owner serializes them.
    pub connections: Vec<Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageOverview {
    /// Rolling window length the totals cover.
    pub days: u32,
    pub total_tokens: u64,
    pub total_requests: u32,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cached_tokens: u64,
    pub failed_requests: u32,
    /// The model with the most tokens in the window; empty when none.
    pub top_model_name: String,
}

impl UsageOverview {
    pub fn from_statistics(statistics: &UsageStatistics, days: u32) -> Self {
        let top_model_name = statistics
            .by_model
            .iter()
            .max_by_key(|entry| entry.tokens)
            .map(|entry| entry.name.clone())
            .unwrap_or_default();
        Self {
            days,
            total_tokens: statistics.total_tokens,
            total_requests: statistics.total_requests,
            input_tokens: statistics.total_input_tokens,
            output_tokens: statistics.total_output_tokens,
            cached_tokens: statistics.total_cached_tokens,
            failed_requests: statistics.failed_requests,
            top_model_name,
        }
    }
}

/// The whole Home overview.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonalOverview {
    pub assistants: OverviewSection<CountOverview>,
    pub skills: OverviewSection<SkillsOverview>,
    pub routines: OverviewSection<RoutinesOverview>,
    pub spaces: OverviewSection<SpacesOverview>,
    pub ssh: OverviewSection<SshOverview>,
    pub usage: OverviewSection<UsageOverview>,
    pub activity: OverviewSection<TokenUsageActivity>,
}

/// `get_personal_overview` request; every field optional.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonalOverviewRequest {
    /// IANA zone the activity grid keys its days in.
    #[serde(default)]
    pub time_zone: Option<String>,
    /// Months the activity grid covers (default 6).
    #[serde(default)]
    pub activity_months: Option<u32>,
}

/// Counts skills in a skill-config answer (a list, or `{skills: [...]}`); a
/// skill is enabled unless it says `enabled: false` or `disabled: true`.
pub fn summarize_skills(configs: &Value) -> SkillsOverview {
    let list = configs
        .as_array()
        .or_else(|| configs.get("skills").and_then(Value::as_array));
    let list = list.map(Vec::as_slice).unwrap_or_default();
    let enabled = list
        .iter()
        .filter(|skill| {
            skill.get("enabled").and_then(Value::as_bool) != Some(false)
                && skill.get("disabled").and_then(Value::as_bool) != Some(true)
        })
        .count();
    SkillsOverview {
        count: list.len() as u32,
        enabled: enabled as u32,
    }
}

/// Counts routines and picks the enabled ones due around `now_ms`.
pub fn summarize_routines(routines: &[RoutineFacts], now_ms: i64) -> RoutinesOverview {
    let mut due_soon: Vec<DueRoutine> = routines
        .iter()
        .filter(|routine| routine.enabled)
        .filter_map(|routine| {
            let next = routine.next_run_at_ms?;
            (next >= now_ms - DUE_SOON_LOOKBACK_MS && next <= now_ms + DUE_SOON_LOOKAHEAD_MS).then(
                || DueRoutine {
                    id: routine.id.clone(),
                    name: if routine.name.trim().is_empty() {
                        routine.id.clone()
                    } else {
                        routine.name.clone()
                    },
                    next_run_at_ms: next,
                    last_run_status: routine.last_run_status.clone(),
                    schedule: routine.schedule.clone(),
                },
            )
        })
        .collect();
    due_soon.sort_by_key(|routine| routine.next_run_at_ms);
    RoutinesOverview {
        count: routines.len() as u32,
        enabled: routines.iter().filter(|routine| routine.enabled).count() as u32,
        due_soon,
    }
}

/// Spaces with their running state; an empty icon becomes the default glyph.
pub fn summarize_spaces(
    spaces: impl IntoIterator<Item = (String, String, String, String)>,
    running_ids: &[String],
) -> SpacesOverview {
    let items: Vec<SpaceOverviewItem> = spaces
        .into_iter()
        .filter(|(id, ..)| !id.trim().is_empty())
        .map(|(id, name, description, icon)| SpaceOverviewItem {
            running: running_ids.iter().any(|running| running == &id),
            name: if name.trim().is_empty() {
                id.clone()
            } else {
                name
            },
            icon: if icon.trim().is_empty() {
                "shapes".to_string()
            } else {
                icon
            },
            id,
            description,
        })
        .collect();
    SpacesOverview {
        count: items.len() as u32,
        running: items.iter().filter(|item| item.running).count() as u32,
        items,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn routine(id: &str, enabled: bool, next: Option<i64>) -> RoutineFacts {
        RoutineFacts {
            id: id.into(),
            name: String::new(),
            enabled,
            next_run_at_ms: next,
            last_run_status: None,
            schedule: json!({ "kind": "every", "everyMs": 60000 }),
        }
    }

    #[test]
    fn routines_due_soon_are_enabled_in_window_and_sorted() {
        let now = 1_000_000_000_000;
        let routines = [
            routine("late", true, Some(now + DUE_SOON_LOOKAHEAD_MS + 1)),
            routine("b", true, Some(now + 10)),
            routine("a", true, Some(now - 10)),
            routine("off", false, Some(now + 5)),
            routine("never", true, None),
            routine("stale", true, Some(now - DUE_SOON_LOOKBACK_MS - 1)),
        ];
        let overview = summarize_routines(&routines, now);
        assert_eq!(overview.count, 6);
        assert_eq!(overview.enabled, 5);
        let ids: Vec<_> = overview
            .due_soon
            .iter()
            .map(|due| due.id.as_str())
            .collect();
        assert_eq!(ids, vec!["a", "b"]);
        assert_eq!(overview.due_soon[0].name, "a");
    }

    #[test]
    fn skills_count_both_answer_shapes() {
        let list =
            json!([{ "name": "a" }, { "name": "b", "enabled": false }, { "disabled": true }]);
        assert_eq!(
            summarize_skills(&list),
            SkillsOverview {
                count: 3,
                enabled: 1
            }
        );
        let wrapped = json!({ "skills": [{ "name": "a" }], "importOperationsVersion": 3 });
        assert_eq!(
            summarize_skills(&wrapped),
            SkillsOverview {
                count: 1,
                enabled: 1
            }
        );
        assert_eq!(
            summarize_skills(&json!(null)),
            SkillsOverview {
                count: 0,
                enabled: 0
            }
        );
    }

    #[test]
    fn spaces_mark_running_and_default_names() {
        let overview = summarize_spaces(
            [
                ("s1".into(), "".into(), "d".into(), "".into()),
                ("s2".into(), "Two".into(), "".into(), "box".into()),
                ("".into(), "ghost".into(), "".into(), "".into()),
            ],
            &["s2".to_string()],
        );
        assert_eq!(overview.count, 2);
        assert_eq!(overview.running, 1);
        assert_eq!(overview.items[0].name, "s1");
        assert_eq!(overview.items[0].icon, "shapes");
        assert!(overview.items[1].running);
    }

    #[test]
    fn sections_serialize_with_a_status_tag() {
        let ready: OverviewSection<CountOverview> = OverviewSection::Ready {
            value: CountOverview { count: 2 },
        };
        assert_eq!(
            serde_json::to_value(&ready).unwrap(),
            json!({ "status": "ready", "value": { "count": 2 } })
        );
        let unsupported: OverviewSection<CountOverview> = OverviewSection::unsupported("Routines");
        assert_eq!(
            serde_json::to_value(&unsupported).unwrap()["status"],
            "unsupported"
        );
    }

    #[test]
    fn request_tolerates_an_empty_body() {
        let request: PersonalOverviewRequest = serde_json::from_value(json!({})).unwrap();
        assert!(request.time_zone.is_none());
        assert!(request.activity_months.is_none());
    }
}

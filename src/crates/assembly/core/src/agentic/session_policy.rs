//! Turn and session policy shared by every client surface.
//!
//! These rules used to live in each client (the NSH composer, mobile web, the IM
//! bot router), so two clients looking at the same session could disagree. They
//! are pure decisions here; the owners that act on them are the dialog scheduler
//! (`submit_user_message`), the desktop session commands and the bot router.

use openbitfun_config_contracts::{ChatInputDefaultModeStrategy, ChatInputSendDuringTurn};
use openbitfun_core_types::agent_identity::HarnessId;
use serde::{Deserialize, Serialize};

// ── Mid-turn send ───────────────────────────────────────────────────

/// What a user message written while a turn runs does.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UserMessageRoute {
    /// Inject the message into the running turn at its next model round.
    Steer { turn_id: String },
    /// Submit as a new turn: it starts now when the session is idle, or waits
    /// in the host queue behind the running turn.
    Submit,
}

/// `app.flow_chat.send_during_turn` decides between steering and queueing; a
/// session without a running turn always gets a new turn.
pub fn resolve_user_message_route(
    policy: ChatInputSendDuringTurn,
    active_turn_id: Option<&str>,
) -> UserMessageRoute {
    match (
        policy,
        active_turn_id.map(str::trim).filter(|id| !id.is_empty()),
    ) {
        (ChatInputSendDuringTurn::Immediate, Some(turn_id)) => UserMessageRoute::Steer {
            turn_id: turn_id.to_string(),
        },
        _ => UserMessageRoute::Submit,
    }
}

// ── Mode catalog ────────────────────────────────────────────────────

/// Mode ids a session is never switched to from the composer: Claw belongs to
/// assistant workspaces, and `multitask` / `plan` are retired ids an older peer
/// may still advertise.
const INELIGIBLE_MODE_IDS: [&str; 3] = ["claw", "multitask", "plan"];

/// One mode the host's agent registry reported, before the catalog rules.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionModeSource {
    pub id: String,
    pub name: String,
    pub description: String,
}

/// The stored harness preference (`app.flow_chat`).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SessionModePreference {
    pub strategy: Option<ChatInputDefaultModeStrategy>,
    pub default_mode_id: Option<String>,
    pub last_mode_id: Option<String>,
}

/// What the catalog knows about the session it is drawn for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionModeFacts {
    pub mode_id: String,
    /// The session already ran a turn, so its agent binding is fixed.
    pub started: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionModeCatalogEntry {
    pub id: String,
    pub label: String,
    pub description: String,
    /// One of the four built-in execution profiles rather than a configured or
    /// external agent.
    pub profile: bool,
    /// Whether the session can be bound to this entry now. A started session
    /// only keeps its own mode; picking another one needs a new session.
    pub switchable: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionModeCatalog {
    pub entries: Vec<SessionModeCatalogEntry>,
    /// The mode a new session starts as, resolved from the stored preference.
    pub default_mode_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_mode_id: Option<String>,
    #[serde(default)]
    pub session_started: bool,
}

/// The built-in profile an id names, tolerating case and the retired names.
fn profile_of(id: &str) -> Option<HarnessId> {
    HarnessId::from_legacy_id(id)
}

fn is_ineligible(id: &str) -> bool {
    let key = id.trim().to_ascii_lowercase();
    INELIGIBLE_MODE_IDS.contains(&key.as_str())
}

/// Two mode ids name the same mode when they differ only by case, spacing or a
/// retired profile alias.
pub fn mode_ids_match(left: &str, right: &str) -> bool {
    canonical_mode_id(left).eq_ignore_ascii_case(&canonical_mode_id(right))
}

/// The id a mode is stored and compared under.
pub fn canonical_mode_id(id: &str) -> String {
    let trimmed = id.trim();
    profile_of(trimmed)
        .map(|profile| profile.as_str().to_string())
        .unwrap_or_else(|| trimmed.to_string())
}

/// A stored preference value the composer may start a session as, or `None`.
pub fn eligible_default_mode_id(value: Option<&str>) -> Option<String> {
    let id = value?.trim();
    if id.is_empty() || is_ineligible(id) {
        return None;
    }
    Some(canonical_mode_id(id))
}

/// Orders and filters the registry's modes the way every composer draws them:
/// the four profiles first in their own order, then the rest in host order. A
/// profile the host does not list stays out (an older host may not know it).
pub fn build_session_mode_catalog(
    rows: &[SessionModeSource],
    preference: &SessionModePreference,
    session: Option<&SessionModeFacts>,
) -> SessionModeCatalog {
    let mut seen = std::collections::HashSet::new();
    let mut profiles: Vec<(HarnessId, SessionModeCatalogEntry)> = Vec::new();
    let mut others = Vec::new();
    for row in rows {
        let raw = row.id.trim();
        if raw.is_empty() || is_ineligible(raw) {
            continue;
        }
        let profile = profile_of(raw);
        let id = profile
            .map(|profile| profile.as_str().to_string())
            .unwrap_or_else(|| raw.to_string());
        if !seen.insert(id.to_ascii_lowercase()) {
            continue;
        }
        let name = row.name.trim();
        let entry = SessionModeCatalogEntry {
            label: if name.is_empty() {
                id.clone()
            } else {
                name.to_string()
            },
            id,
            description: row.description.trim().to_string(),
            profile: profile.is_some(),
            switchable: true,
        };
        match profile {
            Some(profile) => profiles.push((profile, entry)),
            None => others.push(entry),
        }
    }
    let mut entries: Vec<SessionModeCatalogEntry> = HarnessId::ALL
        .iter()
        .filter_map(|wanted| {
            profiles
                .iter()
                .find(|(profile, _)| profile == wanted)
                .map(|(_, entry)| entry.clone())
        })
        .collect();
    entries.extend(others);

    if let Some(session) = session.filter(|session| session.started) {
        for entry in &mut entries {
            entry.switchable = mode_ids_match(&entry.id, &session.mode_id);
        }
    }

    SessionModeCatalog {
        default_mode_id: resolve_default_mode_id(&entries, preference),
        session_mode_id: session.map(|session| canonical_mode_id(&session.mode_id)),
        session_started: session.is_some_and(|session| session.started),
        entries,
    }
}

/// `fixed` reads the pinned mode, every other strategy follows the last one
/// used; a stored id the catalog no longer lists falls back to Standard.
fn resolve_default_mode_id(
    entries: &[SessionModeCatalogEntry],
    preference: &SessionModePreference,
) -> String {
    let fixed = eligible_default_mode_id(preference.default_mode_id.as_deref());
    let last = eligible_default_mode_id(preference.last_mode_id.as_deref());
    let chosen = match preference.strategy {
        Some(ChatInputDefaultModeStrategy::Fixed) => fixed.or(last),
        // A missing strategy with a stored fixed id is the legacy fixed shape.
        None if fixed.is_some() => fixed.or(last),
        _ => last.or(fixed),
    };
    let listed = |id: &str| entries.iter().any(|entry| mode_ids_match(&entry.id, id));
    match chosen {
        Some(id) if entries.is_empty() || listed(&id) => id,
        _ => HarnessId::Standard.as_str().to_string(),
    }
}

/// Why `update_session_mode` refused a rebind. The code is stable so every
/// client can recognize it without parsing prose.
pub const SESSION_MODE_LOCKED_CODE: &str = "session_mode_locked";

/// A session that already ran a turn keeps the mode its transcript was produced
/// under; only the same mode (any alias) is accepted.
pub fn check_session_mode_rebind(
    session: &SessionModeFacts,
    requested_mode_id: &str,
) -> Result<(), String> {
    if !session.started || mode_ids_match(&session.mode_id, requested_mode_id) {
        return Ok(());
    }
    Err(format!(
        "{SESSION_MODE_LOCKED_CODE}: this session already started as {}; start a new session to use {}",
        canonical_mode_id(&session.mode_id),
        canonical_mode_id(requested_mode_id)
    ))
}

// ── Session commands ────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionCommandId {
    Compact,
    Init,
    Reload,
}

impl SessionCommandId {
    pub const ALL: [Self; 3] = [Self::Compact, Self::Init, Self::Reload];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Compact => "compact",
            Self::Init => "init",
            Self::Reload => "reload",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        let key = value.trim().trim_start_matches('/').to_ascii_lowercase();
        Self::ALL.into_iter().find(|id| id.as_str() == key)
    }

    /// Commands that start or rewrite a turn wait until the running one ends.
    pub const fn idle_only(self) -> bool {
        matches!(self, Self::Compact | Self::Init)
    }

    const fn description(self) -> &'static str {
        match self {
            Self::Compact => "Summarize the conversation to free context",
            Self::Init => "Generate or update AGENTS.md for this workspace",
            Self::Reload => "Reload skills and project instructions",
        }
    }

    const fn args(self) -> &'static [&'static str] {
        match self {
            Self::Reload => &["skills", "instructions"],
            _ => &[],
        }
    }
}

/// One command as every surface offers it. `labelKey` is the client catalog key;
/// `description` is the English fallback for surfaces without that catalog.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionCommandDescriptor {
    pub id: SessionCommandId,
    pub command: String,
    pub label_key: String,
    pub description: String,
    pub idle_only: bool,
    /// Whether the command can run right now (idle-only commands wait for the
    /// running turn).
    pub available: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub args: Vec<String>,
}

/// The commands a session offers, in menu order.
pub fn session_commands(running: bool) -> Vec<SessionCommandDescriptor> {
    SessionCommandId::ALL
        .into_iter()
        .map(|id| SessionCommandDescriptor {
            id,
            command: format!("/{}", id.as_str()),
            label_key: format!("chat.slash.{}", id.as_str()),
            description: id.description().to_string(),
            idle_only: id.idle_only(),
            available: !(running && id.idle_only()),
            args: id.args().iter().map(|arg| (*arg).to_string()).collect(),
        })
        .collect()
}

/// The command a whole message names (`/reload skills` included), if any.
/// Anything else, including `/compact now please`, is an ordinary message.
pub fn parse_session_command(text: &str) -> Option<(SessionCommandId, Option<String>)> {
    let trimmed = text.trim();
    let rest = trimmed.strip_prefix('/')?;
    let mut parts = rest.split_whitespace();
    let id = SessionCommandId::parse(parts.next()?)?;
    let arg = parts.next().map(str::to_ascii_lowercase);
    if parts.next().is_some() {
        return None;
    }
    match (&arg, id.args()) {
        (None, _) => Some((id, None)),
        (Some(arg), allowed) if allowed.contains(&arg.as_str()) => Some((id, Some(arg.clone()))),
        _ => None,
    }
}

// ── Unread / failed ─────────────────────────────────────────────────

/// The read state a session row shows, derived from the host's unread receipt
/// (`unread_completion`: completed / error / interrupted).
pub fn session_attention(unread_completion: Option<&str>) -> (bool, bool) {
    match unread_completion
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some("error") => (true, true),
        Some(_) => (true, false),
        None => (false, false),
    }
}

/// Clears a session's unread receipt for the user who just looked at it.
///
/// `seen_through_ms` is the newest activity the reader saw; a result that
/// settled later stays unread. A read without it acknowledges the current
/// result. Returns whether anything changed.
pub fn acknowledge_session_unread(
    metadata: &mut openbitfun_services_core::session::SessionMetadata,
    seen_through_ms: Option<u64>,
) -> bool {
    if metadata.unread_completion.is_none() {
        return false;
    }
    let target = openbitfun_services_core::session::unread_completion_target(metadata);
    let settled_at = target
        .as_ref()
        .and_then(|turn| turn.end_time)
        .or(metadata.last_finished_at);
    let acknowledged = match (seen_through_ms, settled_at) {
        (None, _) => true,
        (Some(seen), Some(settled)) => seen >= settled,
        // Without a settle time the reader cannot prove it saw this result.
        (Some(_), None) => false,
    };
    if !acknowledged {
        return false;
    }
    metadata.unread_completion = None;
    if let Some(object) = metadata
        .custom_metadata
        .as_mut()
        .and_then(serde_json::Value::as_object_mut)
    {
        object.remove("unreadCompletionTarget");
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    fn source(id: &str, name: &str) -> SessionModeSource {
        SessionModeSource {
            id: id.into(),
            name: name.into(),
            description: String::new(),
        }
    }

    #[test]
    fn mid_turn_route_follows_the_stored_policy() {
        assert_eq!(
            resolve_user_message_route(ChatInputSendDuringTurn::Immediate, Some("turn-1")),
            UserMessageRoute::Steer {
                turn_id: "turn-1".into()
            }
        );
        assert_eq!(
            resolve_user_message_route(ChatInputSendDuringTurn::Queue, Some("turn-1")),
            UserMessageRoute::Submit
        );
        assert_eq!(
            resolve_user_message_route(ChatInputSendDuringTurn::Immediate, None),
            UserMessageRoute::Submit
        );
        assert_eq!(
            resolve_user_message_route(ChatInputSendDuringTurn::Immediate, Some("  ")),
            UserMessageRoute::Submit
        );
    }

    #[test]
    fn catalog_orders_profiles_first_and_drops_ineligible_and_duplicate_ids() {
        let rows = vec![
            source("my-agent", "Mine"),
            source("Ultra", "Ultimate"),
            source("claw", "Claw"),
            source("agentic", ""),
            source("Plan", "Plan"),
            source("minimal", "Minimal"),
            source("MY-AGENT", "Duplicate"),
            source("multitask", "Old"),
        ];
        let catalog = build_session_mode_catalog(&rows, &Default::default(), None);
        let ids: Vec<_> = catalog
            .entries
            .iter()
            .map(|entry| entry.id.as_str())
            .collect();
        assert_eq!(ids, ["Minimal", "Standard", "Ultimate", "my-agent"]);
        assert_eq!(catalog.entries[1].label, "Standard");
        assert!(catalog.entries[0].profile);
        assert!(!catalog.entries[3].profile);
        assert!(catalog.entries.iter().all(|entry| entry.switchable));
        assert_eq!(catalog.default_mode_id, "Standard");
        assert!(!catalog.session_started);
    }

    #[test]
    fn catalog_default_honours_strategy_aliases_and_membership() {
        let rows = vec![
            source("Standard", "Standard"),
            source("Ultimate", "Ultimate"),
            source("custom", "Custom"),
        ];
        let follow_last = SessionModePreference {
            strategy: Some(ChatInputDefaultModeStrategy::FollowLast),
            default_mode_id: Some("custom".into()),
            last_mode_id: Some("ultra".into()),
        };
        assert_eq!(
            build_session_mode_catalog(&rows, &follow_last, None).default_mode_id,
            "Ultimate"
        );
        let fixed = SessionModePreference {
            strategy: Some(ChatInputDefaultModeStrategy::Fixed),
            ..follow_last.clone()
        };
        assert_eq!(
            build_session_mode_catalog(&rows, &fixed, None).default_mode_id,
            "custom"
        );
        // Legacy shape: no strategy but a pinned id stays fixed.
        let legacy = SessionModePreference {
            strategy: None,
            ..follow_last.clone()
        };
        assert_eq!(
            build_session_mode_catalog(&rows, &legacy, None).default_mode_id,
            "custom"
        );
        // An ineligible or unlisted stored id falls back to Standard.
        let stale = SessionModePreference {
            strategy: None,
            default_mode_id: None,
            last_mode_id: Some("plan".into()),
        };
        assert_eq!(
            build_session_mode_catalog(&rows, &stale, None).default_mode_id,
            "Standard"
        );
        let gone = SessionModePreference {
            last_mode_id: Some("removed-agent".into()),
            ..stale
        };
        assert_eq!(
            build_session_mode_catalog(&rows, &gone, None).default_mode_id,
            "Standard"
        );
    }

    #[test]
    fn started_session_only_keeps_its_own_mode_switchable() {
        let rows = vec![
            source("Standard", ""),
            source("Ultimate", ""),
            source("custom", ""),
        ];
        let session = SessionModeFacts {
            mode_id: "agentic".into(),
            started: true,
        };
        let catalog = build_session_mode_catalog(&rows, &Default::default(), Some(&session));
        let switchable: Vec<_> = catalog
            .entries
            .iter()
            .map(|entry| (entry.id.as_str(), entry.switchable))
            .collect();
        assert_eq!(
            switchable,
            [("Standard", true), ("Ultimate", false), ("custom", false)]
        );
        assert_eq!(catalog.session_mode_id.as_deref(), Some("Standard"));
        assert!(catalog.session_started);

        let fresh = SessionModeFacts {
            mode_id: "Standard".into(),
            started: false,
        };
        let catalog = build_session_mode_catalog(&rows, &Default::default(), Some(&fresh));
        assert!(catalog.entries.iter().all(|entry| entry.switchable));
    }

    #[test]
    fn rebind_is_refused_with_a_stable_code_once_started() {
        let started = SessionModeFacts {
            mode_id: "Standard".into(),
            started: true,
        };
        assert!(check_session_mode_rebind(&started, "agentic").is_ok());
        let error = check_session_mode_rebind(&started, "Ultimate").unwrap_err();
        assert!(error.starts_with(SESSION_MODE_LOCKED_CODE), "{error}");
        let fresh = SessionModeFacts {
            mode_id: "Standard".into(),
            started: false,
        };
        assert!(check_session_mode_rebind(&fresh, "Ultimate").is_ok());
    }

    #[test]
    fn session_commands_parse_and_gate_on_running_turns() {
        assert_eq!(
            parse_session_command("/compact"),
            Some((SessionCommandId::Compact, None))
        );
        assert_eq!(
            parse_session_command(" /Reload Skills "),
            Some((SessionCommandId::Reload, Some("skills".into())))
        );
        assert_eq!(parse_session_command("/reload everything"), None);
        assert_eq!(parse_session_command("/compact now please"), None);
        assert_eq!(parse_session_command("compact"), None);
        assert_eq!(parse_session_command("/menu"), None);

        let idle: Vec<_> = session_commands(false)
            .into_iter()
            .map(|command| (command.command, command.available))
            .collect();
        assert_eq!(
            idle,
            [
                ("/compact".to_string(), true),
                ("/init".to_string(), true),
                ("/reload".to_string(), true)
            ]
        );
        let running: Vec<_> = session_commands(true)
            .into_iter()
            .map(|command| command.available)
            .collect();
        assert_eq!(running, [false, false, true]);
        let wire = serde_json::to_value(&session_commands(false)[2]).unwrap();
        assert_eq!(wire["id"], "reload");
        assert_eq!(wire["labelKey"], "chat.slash.reload");
        assert_eq!(wire["args"], serde_json::json!(["skills", "instructions"]));
    }

    #[test]
    fn attention_reads_the_host_unread_receipt() {
        assert_eq!(session_attention(None), (false, false));
        assert_eq!(session_attention(Some("completed")), (true, false));
        assert_eq!(session_attention(Some("interrupted")), (true, false));
        assert_eq!(session_attention(Some("error")), (true, true));
        assert_eq!(session_attention(Some("")), (false, false));
    }

    fn unread_metadata(
        end_time: Option<u64>,
    ) -> openbitfun_services_core::session::SessionMetadata {
        let mut metadata: openbitfun_services_core::session::SessionMetadata =
            serde_json::from_value(serde_json::json!({
                "sessionId": "s", "sessionName": "S", "agentType": "Standard",
                "modelName": "m", "createdAt": 1, "lastActiveAt": 2, "turnCount": 1,
                "messageCount": 2, "toolCallCount": 0, "status": "active",
                "unreadCompletion": "error",
                "customMetadata": {"unreadCompletionTarget": {
                    "turnId": "t1", "turnIndex": 0, "status": "error"
                }}
            }))
            .unwrap();
        if let Some(end) = end_time {
            metadata.custom_metadata.as_mut().unwrap()["unreadCompletionTarget"]["endTime"] =
                serde_json::json!(end);
        }
        metadata
    }

    #[test]
    fn seen_marks_acknowledge_only_results_the_reader_saw() {
        let mut metadata = unread_metadata(Some(1_000));
        assert!(!acknowledge_session_unread(&mut metadata, Some(999)));
        assert_eq!(metadata.unread_completion.as_deref(), Some("error"));
        assert!(acknowledge_session_unread(&mut metadata, Some(1_000)));
        assert_eq!(metadata.unread_completion, None);
        assert!(metadata.custom_metadata.as_ref().unwrap()["unreadCompletionTarget"].is_null());
        assert!(!acknowledge_session_unread(&mut metadata, None));

        // A live read acknowledges the current result; a migrated mark without
        // a settle time to compare with leaves it unread.
        let mut live = unread_metadata(None);
        assert!(!acknowledge_session_unread(&mut live, Some(u64::MAX)));
        assert!(acknowledge_session_unread(&mut live, None));
    }
}

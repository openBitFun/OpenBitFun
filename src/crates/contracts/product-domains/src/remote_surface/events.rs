//! Event stance of the Product Operation Registry.
//!
//! The backend protocol (OBP) streams the backend's events to every
//! connected client. Most events describe product state that any authorized
//! client may render (sessions, turns, tools, terminals, files). A few
//! describe the machine that owns the backend itself: the signed-in account,
//! its windows and tray, its updater, and the legacy peer-host bridge. Those
//! never leave the `owner` scope (the in-process UI or a loopback client
//! holding the per-launch token). See
//! `docs/architecture/unified-client-architecture.md` ("Scopes").
//!
//! The stance is decided by event-name prefix so a new event under an owner
//! namespace is protected without a table edit. It is not part of the
//! exported registry artifact (and therefore not of its digest): hosts read it
//! through [`event_stance`] directly.

use serde::Serialize;

/// Who may receive an event over a backend-protocol connection.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EventStance {
    /// Any authorized scope receives it.
    Proxied,
    /// Only the `owner` scope receives it.
    OwnerOnly,
}

/// Event-name prefixes (and exact names) that stay in the owner scope, with
/// the reason. Kept sorted; `event_prefixes_are_sorted` checks it.
pub const OWNER_ONLY_EVENT_PREFIXES: &[(&str, &str)] = &[
    (
        "account://",
        "account identity and device presence of the backend's own user",
    ),
    ("app-update", "the backend machine's updater"),
    (
        "desktop-card://",
        "desktop cards are windows of the backend machine",
    ),
    (
        "openbitfun://file-drop-preview",
        "native drag and drop on the backend machine's window",
    ),
    ("peer-host-invoke://", "the legacy peer-host webview bridge"),
    ("tray://", "the backend machine's tray"),
    ("update://", "the backend machine's updater"),
    ("updater://", "the backend machine's updater"),
    ("window://", "window chrome of the backend machine"),
];

/// The stance of one event name.
pub fn event_stance(event: &str) -> EventStance {
    if OWNER_ONLY_EVENT_PREFIXES
        .iter()
        .any(|(prefix, _)| event.starts_with(prefix))
    {
        EventStance::OwnerOnly
    } else {
        EventStance::Proxied
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn event_prefixes_are_sorted() {
        let ids: Vec<_> = OWNER_ONLY_EVENT_PREFIXES.iter().map(|(p, _)| *p).collect();
        let mut sorted = ids.clone();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(ids, sorted);
    }

    #[test]
    fn owner_namespaces_stay_with_the_owner() {
        for event in [
            "account://login-state",
            "account://device-presence",
            "window://fullscreen-chrome",
            "tray://mark-all-read",
            "updater://progress",
            "peer-host-invoke://request",
        ] {
            assert_eq!(event_stance(event), EventStance::OwnerOnly, "{event}");
        }
        for event in [
            "agentic://text-chunk",
            "terminal_event",
            "file-system-changed",
            "backend://events-dropped",
            "permission://event",
        ] {
            assert_eq!(event_stance(event), EventStance::Proxied, "{event}");
        }
    }
}

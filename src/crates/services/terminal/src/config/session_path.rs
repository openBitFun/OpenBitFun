//! Windows-only live PATH policy for newly created local terminal sessions.
//!
//! Explicit request PATH overrides explicit config PATH, both verbatim (even
//! empty/whitespace). Otherwise: managed prefix > inherited custom increment >
//! fresh OS baseline > platform suffix. Unix retains its original environment
//! overlay/inheritance semantics and never runs this normalization.
//!
//! The increment captures only parent-only directories at manager initialization.
//! A stale parent entry already deleted from the registry before initialization
//! is indistinguishable from custom input and remains until process restart.
//! Baseline additions, removals and ordering after initialization are live;
//! managed/platform directory sets are initialization snapshots, so installing
//! another managed runtime still requires restarting the host.

use std::collections::{HashMap, HashSet};
use std::ffi::{OsStr, OsString};

pub(crate) fn session_path_key() -> &'static str {
    "Path"
}

/// Reuse portable-pty's public Windows base environment (HKLM + HKCU,
/// including expansion and case-insensitive keys); do not duplicate its parser.
/// An explicitly empty value is a valid baseline. Missing PATH is reported, not
/// confused with empty; the builder falls back to parent inheritance on absence.
pub(crate) fn session_path_baseline() -> Option<OsString> {
    let builder = portable_pty::CommandBuilder::new("cmd.exe");
    let baseline = builder.get_env(session_path_key()).map(OsStr::to_os_string);
    if baseline.is_none() {
        log::warn!("Live terminal PATH baseline is unavailable; preserving parent environment");
    }
    baseline
}

/// Keep only the parent directories absent from the initialization baseline.
pub(crate) fn inherited_path_increment(
    parent: Option<&OsStr>,
    baseline: Option<&OsStr>,
) -> Vec<String> {
    // Without a baseline we cannot distinguish custom input from stale OS data.
    let Some(baseline) = baseline else {
        return Vec::new();
    };
    let mut os = PathAccumulator::default();
    os.push_paths(baseline);
    let mut custom = PathAccumulator::default();
    if let Some(parent) = parent {
        for path in std::env::split_paths(parent) {
            let raw = path.to_string_lossy();
            let entry = trimmed_entry(&raw);
            if !os.seen.contains(&identity_key(entry)) {
                custom.push(entry);
            }
        }
    }
    custom.entries
}

/// Compose only the implicit policy. Explicit config/request values never enter
/// this helper. `Some(empty)` must override stale parent PATH, while `None`
/// means the baseline is unavailable and leaves parent inheritance intact,
/// even when directory anchors exist (a partial overlay could hide OS tools).
pub(crate) fn compose_session_path(
    managed_prefix: &[String],
    inherited_entries: &[String],
    baseline: Option<&OsStr>,
    platform_suffix: &[String],
) -> Option<OsString> {
    // Without a baseline, a policy-only overlay would discard the parent's OS
    // directories. Degrade to native inheritance rather than a partial PATH.
    let baseline = baseline?;
    let mut composed = PathAccumulator::default();
    composed.push_entries(managed_prefix);
    composed.push_entries(inherited_entries);
    composed.push_paths(baseline);
    composed.push_entries(platform_suffix);
    let joinable: Vec<&OsStr> = composed.entries.iter().filter_map(|entry| {
        let entry = OsStr::new(entry);
        if std::env::join_paths(std::iter::once(entry)).is_ok() {
            Some(entry)
        } else {
            log::debug!("Dropping a session PATH entry that cannot be joined");
            None
        }
    }).collect();
    std::env::join_paths(joinable).ok()
}

/// Remove all Windows PATH variants deterministically, preserving the chosen
/// value verbatim. Canonical `Path` wins, otherwise the last sorted key wins.
pub(crate) fn take_session_path_entries(env: &mut HashMap<String, String>) -> Option<String> {
    let mut variants: Vec<String> = env.keys()
        .filter(|key| key.eq_ignore_ascii_case(session_path_key()))
        .cloned().collect();
    variants.sort();
    let mut canonical = None;
    let mut other = None;
    for key in variants {
        let value = env.remove(&key);
        if key == session_path_key() {
            canonical = value;
        } else {
            other = value;
        }
    }
    canonical.or(other)
}

#[derive(Default)]
struct PathAccumulator {
    entries: Vec<String>,
    seen: HashSet<String>,
}

impl PathAccumulator {
    fn push(&mut self, raw: &str) {
        let entry = trimmed_entry(raw);
        if !entry.is_empty() && self.seen.insert(identity_key(entry)) {
            self.entries.push(entry.to_string());
        }
    }

    fn push_paths(&mut self, value: &OsStr) {
        for path in std::env::split_paths(value) {
            self.push(&path.to_string_lossy());
        }
    }

    fn push_entries(&mut self, entries: &[String]) {
        for entry in entries {
            self.push(entry);
        }
    }
}

fn trimmed_entry(raw: &str) -> &str {
    let mut value = raw.trim();
    loop {
        let bytes = value.as_bytes();
        if bytes.len() < 2 {
            break;
        }
        let quoted = (bytes[0] == b'"' && bytes[bytes.len() - 1] == b'"')
            || (bytes[0] == b'\'' && bytes[bytes.len() - 1] == b'\'');
        if !quoted {
            break;
        }
        value = value[1..value.len() - 1].trim();
    }
    value
}

fn identity_key(entry: &str) -> String {
    let trimmed = entry.trim_end_matches(['\\', '/']);
    let bytes = trimmed.as_bytes();
    let drive_root = bytes.len() == 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':';
    if trimmed.is_empty() || drive_root {
        entry.to_lowercase()
    } else {
        trimmed.to_lowercase()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn portable_pty_baseline_contract_allows_empty_or_missing() {
        let builder = portable_pty::CommandBuilder::new("cmd.exe");
        assert_eq!(session_path_baseline(), builder.get_env("PATH").map(OsStr::to_os_string));
    }

    #[test]
    fn inherited_increment_excludes_initial_baseline_but_retains_parent_only_entries() {
        let baseline = OsStr::new("C:/os;C:/shared");
        let increment = inherited_path_increment(Some(OsStr::new("C:/custom;C:/OS;C:/shared")), Some(baseline));
        assert_eq!(increment, ["C:/custom"]);
        assert!(inherited_path_increment(Some(baseline), None).is_empty());
    }

    #[test]
    fn implicit_policy_normalizes_and_deduplicates_windows_entries() {
        let path = compose_session_path(
            &["  'C:/managed/'  ".into()],
            &["c:/MANAGED".into(), "C:/custom".into()],
            Some(OsStr::new("C:/custom;C:/os")),
            &["C:/gui".into()],
        ).unwrap();
        assert_eq!(path, OsString::from("C:/managed/;C:/custom;C:/os;C:/gui"));
    }

    #[test]
    fn explicit_values_preserve_blank_and_canonical_key_wins() {
        for value in ["", "  ", "  C:/explicit  "] {
            let mut env = HashMap::from([
                ("PATH".into(), "C:/other".into()),
                ("pAtH".into(), "C:/mixed".into()),
                ("Path".into(), value.into()),
            ]);
            assert_eq!(take_session_path_entries(&mut env).as_deref(), Some(value));
            assert!(env.is_empty());
        }
    }

    #[test]
    fn empty_baseline_is_distinct_from_unavailable() {
        assert_eq!(compose_session_path(&[], &[], Some(OsStr::new("")), &[]), Some(OsString::new()));
        assert_eq!(compose_session_path(&[], &[], None, &[]), None);
    }

    #[test]
    fn drive_roots_and_drive_relative_entries_are_distinct() {
        let value = compose_session_path(&[], &[], Some(OsStr::new("C:\\;\\;C:")), &[]).unwrap();
        assert_eq!(value, OsString::from("C:\\;\\;C:"));
    }

    #[test]
    fn invalid_implicit_entry_does_not_discard_the_baseline() {
        let value = compose_session_path(&["C:/bad\"quote".into()], &[], Some(OsStr::new("C:/os")), &[]).unwrap();
        assert_eq!(value, OsString::from("C:/os"));
    }
}

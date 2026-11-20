//! Saved terminal profiles (`terminal.profiles`), keyed by workspace id.
//!
//! Profiles used to live in each client's local storage, so a profile saved in
//! one window never reached another client of the same backend. The host now
//! owns the list and these rules (name required and unique per workspace, a
//! cap per workspace, host-minted ids); clients send one intent and render the
//! list they get back. The stored value is handled as JSON so fields this
//! build does not know survive an edit.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// Config path that holds the profiles map.
pub const TERMINAL_PROFILES_PATH: &str = "terminal.profiles";
/// Profiles one workspace may keep.
pub const MAX_TERMINAL_PROFILES_PER_WORKSPACE: usize = 20;

/// One profile as clients render it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalProfileView {
    pub id: String,
    pub name: String,
    pub shell_id: String,
    pub shell_type: String,
    pub startup_command: String,
}

/// A create-or-edit intent. Without `id` the host mints one.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct TerminalProfileInput {
    pub id: Option<String>,
    pub name: String,
    #[serde(alias = "shell_id")]
    pub shell_id: String,
    #[serde(alias = "shell_type")]
    pub shell_type: String,
    #[serde(alias = "startup_command")]
    pub startup_command: String,
}

/// The stored map after an upsert, and the id of the profile it wrote.
#[derive(Debug, Clone, PartialEq)]
pub struct TerminalProfileUpsert {
    pub profiles: Value,
    pub id: String,
}

/// The stored map after an import, and what the import did.
#[derive(Debug, Clone, PartialEq)]
pub struct TerminalProfileImport {
    pub profiles: Value,
    pub imported: usize,
    pub skipped: usize,
}

fn require_workspace(workspace_id: &str) -> Result<&str, String> {
    let workspace_id = workspace_id.trim();
    if workspace_id.is_empty() {
        return Err("workspace_id is required".to_string());
    }
    Ok(workspace_id)
}

fn profiles_map(current: &Value) -> Map<String, Value> {
    match current {
        Value::Object(map) => map.clone(),
        // Null (no profiles yet) and anything unreadable start empty; an
        // unreadable value is never written back over by a read.
        _ => Map::new(),
    }
}

fn rows_of(map: &Map<String, Value>, workspace_id: &str) -> Vec<Value> {
    map.get(workspace_id)
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

fn text(row: &Value, snake: &str, camel: &str) -> String {
    row.get(snake)
        .or_else(|| row.get(camel))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn view_of(row: &Value) -> Option<TerminalProfileView> {
    let id = text(row, "id", "id");
    let name = text(row, "name", "name");
    if id.trim().is_empty() || name.trim().is_empty() {
        return None;
    }
    Some(TerminalProfileView {
        id,
        name,
        shell_id: text(row, "shell_id", "shellId"),
        shell_type: text(row, "shell_type", "shellType"),
        startup_command: text(row, "startup_command", "startupCommand"),
    })
}

/// The profiles one workspace keeps, in saved order. Malformed rows are hidden,
/// not dropped.
pub fn terminal_profiles_for(current: &Value, workspace_id: &str) -> Vec<TerminalProfileView> {
    let map = profiles_map(current);
    rows_of(&map, workspace_id.trim())
        .iter()
        .filter_map(view_of)
        .collect()
}

fn write_rows(mut map: Map<String, Value>, workspace_id: &str, rows: Vec<Value>) -> Value {
    if rows.is_empty() {
        map.remove(workspace_id);
    } else {
        map.insert(workspace_id.to_string(), Value::Array(rows));
    }
    Value::Object(map)
}

fn set_fields(row: &mut Map<String, Value>, id: &str, input: &TerminalProfileInput, name: &str) {
    // Camel-case keys an earlier client may have written are replaced by the
    // config's own snake-case keys.
    for key in ["shellId", "shellType", "startupCommand"] {
        row.remove(key);
    }
    row.insert("id".into(), Value::String(id.to_string()));
    row.insert("name".into(), Value::String(name.to_string()));
    row.insert("shell_id".into(), Value::String(input.shell_id.clone()));
    row.insert("shell_type".into(), Value::String(input.shell_type.clone()));
    row.insert(
        "startup_command".into(),
        Value::String(input.startup_command.trim().to_string()),
    );
}

/// Creates or edits one profile of `workspace_id`.
///
/// Errors carry a stable code before the colon: `terminal_profile_name_required`,
/// `terminal_profile_name_taken`, `terminal_profile_limit`,
/// `terminal_profile_not_found`.
pub fn upsert_terminal_profile(
    current: &Value,
    workspace_id: &str,
    input: &TerminalProfileInput,
    mint_id: &mut dyn FnMut() -> String,
) -> Result<TerminalProfileUpsert, String> {
    let workspace_id = require_workspace(workspace_id)?;
    let name = input.name.trim();
    if name.is_empty() {
        return Err("terminal_profile_name_required: a profile needs a name".to_string());
    }
    let map = profiles_map(current);
    let mut rows = rows_of(&map, workspace_id);
    let editing = input
        .id
        .as_deref()
        .map(str::trim)
        .filter(|id| !id.is_empty());
    if rows
        .iter()
        .filter_map(view_of)
        .any(|profile| profile.name.trim() == name && Some(profile.id.as_str()) != editing)
    {
        return Err(format!(
            "terminal_profile_name_taken: a profile named {name} already exists"
        ));
    }
    let id = match editing {
        Some(id) => {
            let Some(row) = rows
                .iter_mut()
                .find(|row| text(row, "id", "id") == id)
                .and_then(Value::as_object_mut)
            else {
                return Err(format!(
                    "terminal_profile_not_found: no profile {id} in this workspace"
                ));
            };
            set_fields(row, id, input, name);
            id.to_string()
        }
        None => {
            if rows.iter().filter(|row| view_of(row).is_some()).count()
                >= MAX_TERMINAL_PROFILES_PER_WORKSPACE
            {
                return Err(format!(
                    "terminal_profile_limit: {MAX_TERMINAL_PROFILES_PER_WORKSPACE} profiles per workspace"
                ));
            }
            let id = mint_id();
            let mut row = Map::new();
            set_fields(&mut row, &id, input, name);
            rows.push(Value::Object(row));
            id
        }
    };
    Ok(TerminalProfileUpsert {
        profiles: write_rows(map, workspace_id, rows),
        id,
    })
}

/// Removes one profile; removing a profile that is not there changes nothing.
pub fn delete_terminal_profile(
    current: &Value,
    workspace_id: &str,
    profile_id: &str,
) -> Result<Value, String> {
    let workspace_id = require_workspace(workspace_id)?;
    let map = profiles_map(current);
    let rows: Vec<Value> = rows_of(&map, workspace_id)
        .into_iter()
        .filter(|row| text(row, "id", "id") != profile_id.trim())
        .collect();
    Ok(write_rows(map, workspace_id, rows))
}

/// Adds profiles a client kept locally (the one-time storage migration).
/// Rows without a name, rows whose name the workspace already has and rows
/// past the cap are skipped; ids that collide are re-minted.
pub fn import_terminal_profiles(
    current: &Value,
    workspace_id: &str,
    inputs: &[TerminalProfileInput],
    mint_id: &mut dyn FnMut() -> String,
) -> Result<TerminalProfileImport, String> {
    let workspace_id = require_workspace(workspace_id)?;
    let map = profiles_map(current);
    let mut rows = rows_of(&map, workspace_id);
    let mut imported = 0;
    let mut skipped = 0;
    for input in inputs {
        let name = input.name.trim();
        let existing: Vec<TerminalProfileView> = rows.iter().filter_map(view_of).collect();
        if name.is_empty()
            || existing.iter().any(|profile| profile.name.trim() == name)
            || existing.len() >= MAX_TERMINAL_PROFILES_PER_WORKSPACE
        {
            skipped += 1;
            continue;
        }
        let id = match input.id.as_deref().map(str::trim) {
            Some(id) if !id.is_empty() && !existing.iter().any(|profile| profile.id == id) => {
                id.to_string()
            }
            _ => mint_id(),
        };
        let mut row = Map::new();
        set_fields(&mut row, &id, input, name);
        rows.push(Value::Object(row));
        imported += 1;
    }
    Ok(TerminalProfileImport {
        profiles: write_rows(map, workspace_id, rows),
        imported,
        skipped,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::TerminalConfig;
    use serde_json::json;

    fn minter() -> impl FnMut() -> String {
        let mut next = 0;
        move || {
            next += 1;
            format!("tp-{next}")
        }
    }

    fn input(name: &str) -> TerminalProfileInput {
        TerminalProfileInput {
            id: None,
            name: name.to_string(),
            shell_id: "zsh".into(),
            shell_type: "Zsh".into(),
            startup_command: "  pnpm dev  ".into(),
        }
    }

    #[test]
    fn legacy_terminal_config_without_profiles_reads_and_round_trips() {
        let legacy = json!({ "default_shell": "", "font_size": 13 });
        let config: TerminalConfig = serde_json::from_value(legacy).unwrap();
        assert!(config.profiles.is_empty());
        let written = serde_json::to_value(&config).unwrap();
        assert!(
            written.get("profiles").is_none(),
            "an empty map is not written"
        );
        assert!(terminal_profiles_for(&Value::Null, "ws-1").is_empty());
    }

    #[test]
    fn stored_profiles_keep_unknown_fields_and_accept_camel_case() {
        let stored = json!({ "profiles": { "ws-1": [{
            "id": "p1", "name": "Dev", "shellId": "zsh", "shellType": "Zsh",
            "startupCommand": "make", "color": "teal"
        }]}});
        let config: TerminalConfig = serde_json::from_value(stored).unwrap();
        let profile = &config.profiles["ws-1"][0];
        assert_eq!(profile.shell_id, "zsh");
        assert_eq!(profile.startup_command, "make");
        assert_eq!(profile.extra["color"], "teal");
        let written = serde_json::to_value(&config).unwrap();
        assert_eq!(written["profiles"]["ws-1"][0]["color"], "teal");
        assert_eq!(written["profiles"]["ws-1"][0]["shell_id"], "zsh");
    }

    #[test]
    fn upsert_mints_ids_trims_and_enforces_name_rules() {
        let mut mint = minter();
        let first =
            upsert_terminal_profile(&Value::Null, "ws-1", &input(" Dev "), &mut mint).unwrap();
        assert_eq!(first.id, "tp-1");
        let views = terminal_profiles_for(&first.profiles, "ws-1");
        assert_eq!(views[0].name, "Dev");
        assert_eq!(views[0].startup_command, "pnpm dev");

        let taken =
            upsert_terminal_profile(&first.profiles, "ws-1", &input("Dev"), &mut mint).unwrap_err();
        assert!(taken.starts_with("terminal_profile_name_taken:"), "{taken}");
        // Same name in another workspace is fine.
        assert!(upsert_terminal_profile(&first.profiles, "ws-2", &input("Dev"), &mut mint).is_ok());

        let empty =
            upsert_terminal_profile(&first.profiles, "ws-1", &input("  "), &mut mint).unwrap_err();
        assert!(empty.starts_with("terminal_profile_name_required:"));
        assert!(upsert_terminal_profile(&first.profiles, " ", &input("x"), &mut mint).is_err());
    }

    #[test]
    fn edit_keeps_id_and_unknown_fields_and_missing_id_is_refused() {
        let current = json!({ "ws-1": [{ "id": "p1", "name": "Dev", "shell_id": "zsh",
            "shell_type": "Zsh", "startup_command": "", "color": "teal" }] });
        let mut mint = minter();
        let mut edit = input("Build");
        edit.id = Some("p1".into());
        let edited = upsert_terminal_profile(&current, "ws-1", &edit, &mut mint).unwrap();
        assert_eq!(edited.id, "p1");
        assert_eq!(edited.profiles["ws-1"][0]["color"], "teal");
        assert_eq!(edited.profiles["ws-1"][0]["name"], "Build");
        // Renaming to its own name is not a conflict.
        assert!(upsert_terminal_profile(&edited.profiles, "ws-1", &edit, &mut mint).is_ok());

        edit.id = Some("gone".into());
        let missing = upsert_terminal_profile(&current, "ws-1", &edit, &mut mint).unwrap_err();
        assert!(missing.starts_with("terminal_profile_not_found:"));
    }

    #[test]
    fn create_stops_at_the_cap_and_delete_drops_empty_workspaces() {
        let mut mint = minter();
        let mut current = Value::Null;
        for index in 0..MAX_TERMINAL_PROFILES_PER_WORKSPACE {
            current =
                upsert_terminal_profile(&current, "ws-1", &input(&format!("T{index}")), &mut mint)
                    .unwrap()
                    .profiles;
        }
        let over =
            upsert_terminal_profile(&current, "ws-1", &input("one more"), &mut mint).unwrap_err();
        assert!(over.starts_with("terminal_profile_limit:"));

        let single =
            upsert_terminal_profile(&Value::Null, "ws-2", &input("Dev"), &mut mint).unwrap();
        let after = delete_terminal_profile(&single.profiles, "ws-2", &single.id).unwrap();
        assert_eq!(after, json!({}));
        // Deleting what is not there changes nothing.
        assert_eq!(
            delete_terminal_profile(&current, "ws-1", "nope").unwrap(),
            current
        );
    }

    #[test]
    fn import_skips_duplicates_and_nameless_rows_and_reminted_colliding_ids() {
        let current = json!({ "ws-1": [{ "id": "p1", "name": "Dev", "shell_id": "zsh",
            "shell_type": "Zsh", "startup_command": "" }] });
        let mut mint = minter();
        let mut keep_id = input("Logs");
        keep_id.id = Some("local-7".into());
        let mut collide = input("Tests");
        collide.id = Some("p1".into());
        let outcome = import_terminal_profiles(
            &current,
            "ws-1",
            &[input("Dev"), input(""), keep_id, collide],
            &mut mint,
        )
        .unwrap();
        assert_eq!(outcome.imported, 2);
        assert_eq!(outcome.skipped, 2);
        let ids: Vec<String> = terminal_profiles_for(&outcome.profiles, "ws-1")
            .into_iter()
            .map(|profile| profile.id)
            .collect();
        assert_eq!(ids, vec!["p1", "local-7", "tp-1"]);
    }

    #[test]
    fn unreadable_stored_value_reads_as_empty() {
        assert!(terminal_profiles_for(&json!("garbage"), "ws-1").is_empty());
        assert!(terminal_profiles_for(&json!({ "ws-1": "garbage" }), "ws-1").is_empty());
        assert!(
            terminal_profiles_for(&json!({ "ws-1": [{ "name": "no id" }] }), "ws-1").is_empty()
        );
    }
}

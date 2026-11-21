use serde_json::json;

use super::*;

#[test]
fn every_collection_has_a_valid_unique_name_and_a_budget() {
    let mut names: Vec<_> = ACCOUNT_COLLECTIONS
        .iter()
        .map(|budget| budget.name)
        .collect();
    names.sort_unstable();
    names.dedup();
    assert_eq!(names.len(), ACCOUNT_COLLECTIONS.len());
    for budget in ACCOUNT_COLLECTIONS {
        assert!(valid_record_id(budget.name), "{}", budget.name);
        assert_ne!(budget.name, "settings", "settings has its own policy");
        assert!(budget.max_value_bytes <= budget.max_bytes);
        assert!(budget.max_records > 0);
        assert!(!budget.name.ends_with('.'));
    }
    assert_eq!(
        collection_budget(PETS_COLLECTION).map(|b| b.durable_holders),
        Some(2)
    );
}

#[test]
fn secret_named_fields_must_be_empty_or_placeholders() {
    for key in [
        "api_key",
        "apiKey",
        "api_token",
        "bot_token",
        "telegramBotToken",
        "app_secret",
        "password",
        "passphrase",
        "Authorization",
        "private_key",
        "ilink_token",
    ] {
        let value = json!({ "outer": { key: "hunter2" } });
        assert_eq!(find_secret(&value), Some(format!("/outer/{key}")), "{key}");
        assert_eq!(find_secret(&json!({ key: "" })), None, "{key}");
        assert_eq!(find_secret(&json!({ key: secret_ref("x") })), None, "{key}");
        assert_eq!(find_secret(&json!({ key: null })), None, "{key}");
        assert_eq!(find_secret(&json!({ key: true })), None, "{key}");
    }
    // Names that only look close stay allowed.
    assert_eq!(
        find_secret(&json!({ "max_tokens": 10, "tokens": "a b", "keyPath": "/k" })),
        None
    );
}

#[test]
fn env_and_header_maps_carry_only_placeholders() {
    assert_eq!(
        find_secret(&json!({ "env": { "GITHUB": "plain" } })),
        Some("/env/GITHUB".into())
    );
    assert_eq!(
        find_secret(&json!({ "headers": { "X-Custom": "v" } })),
        Some("/headers/X-Custom".into())
    );
    assert_eq!(
        find_secret(&json!({ "env": { "A": secret_ref("mcp:a"), "B": "" } })),
        None
    );
}

#[test]
fn credential_shaped_strings_are_refused_anywhere() {
    // Built at run time so the source carries no key marker.
    let private_key = format!(
        "-----BEGIN OPENSSH {0} KEY-----\nabc\n-----END OPENSSH {0} KEY-----",
        "PRIVATE"
    );
    for text in [
        "Bearer abcdefghijklmnopqrstuvwxyz0123",
        "sk-proj-abcdefghijklmnopqrstuvwxyz0123456789",
        "AKIAIOSFODNN7EXAMPLE",
        "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
        // Split so repository secret scanners do not flag the fixture.
        concat!("xo", "xb-1234567890-abcdefghijklmnop"),
        "123456789:AAHabcdefghijklmnopqrstuvwxyz01234",
        private_key.as_str(),
        "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N",
    ] {
        assert!(looks_like_secret(text), "{text}");
        assert_eq!(
            find_secret(&json!({ "args": ["--x", text] })),
            Some("/args/1".into()),
            "{text}"
        );
        assert!(
            text_contains_secret(&format!("token = \"{text}\"\n")),
            "{text}"
        );
    }
    for text in [
        "Commit the staged changes with a clear message",
        "Use a Bearer token from the vault",
        "sk-short",
        "sk-learning-assistant-skill-name",
        "asia-pacific-region-name-long",
        "/usr/local/bin/mcp-server",
        "https://example.com/mcp",
    ] {
        assert!(!looks_like_secret(text), "{text}");
        assert!(!text_contains_secret(text), "{text}");
    }
}

#[test]
fn placeholders_round_trip() {
    let placeholder = secret_ref("ssh:prod:password");
    assert_eq!(secret_ref_id(&placeholder), Some("ssh:prod:password"));
    assert!(!is_secret_ref(&json!({ "$secretRef": "a", "value": "b" })));
}

//! Field edits of an assistant's `IDENTITY.md` frontmatter.
//!
//! Clients used to rewrite the document themselves (read, patch one YAML line,
//! write), so two clients could disagree on quoting or clobber each other's
//! edits. The backend owns the rewrite: it keeps every other field (including
//! ones no client draws) and the body exactly as written, and serializes edits
//! per workspace.

use serde::{Deserialize, Serialize};

/// The frontmatter fields an assistant's identity editor may set.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum IdentityDocumentField {
    Name,
    Creature,
    Vibe,
    Avatar,
    Emoji,
}

impl IdentityDocumentField {
    pub const ALL: [Self; 5] = [
        Self::Name,
        Self::Creature,
        Self::Vibe,
        Self::Avatar,
        Self::Emoji,
    ];

    pub fn key(self) -> &'static str {
        match self {
            Self::Name => "name",
            Self::Creature => "creature",
            Self::Vibe => "vibe",
            Self::Avatar => "avatar",
            Self::Emoji => "emoji",
        }
    }
}

/// A partial identity edit: `None` leaves a field as written, `Some("")`
/// clears it (kept as `field:`, the way the desktop writes a cleared field).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentityFieldPatch {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub creature: Option<String>,
    #[serde(default)]
    pub vibe: Option<String>,
    #[serde(default)]
    pub avatar: Option<String>,
    #[serde(default)]
    pub emoji: Option<String>,
}

impl IdentityFieldPatch {
    pub fn get(&self, field: IdentityDocumentField) -> Option<&str> {
        match field {
            IdentityDocumentField::Name => self.name.as_deref(),
            IdentityDocumentField::Creature => self.creature.as_deref(),
            IdentityDocumentField::Vibe => self.vibe.as_deref(),
            IdentityDocumentField::Avatar => self.avatar.as_deref(),
            IdentityDocumentField::Emoji => self.emoji.as_deref(),
        }
    }

    pub fn is_empty(&self) -> bool {
        IdentityDocumentField::ALL
            .iter()
            .all(|field| self.get(*field).is_none())
    }
}

fn normalize_line_endings(content: &str) -> String {
    content.replace("\r\n", "\n").replace('\r', "\n")
}

fn is_yaml_keyword_or_number(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    if matches!(
        lower.as_str(),
        "true" | "false" | "yes" | "no" | "on" | "off" | "null" | "~"
    ) {
        return true;
    }
    let digits = lower.trim_start_matches(['+', '-']);
    let (mantissa, exponent) = match digits.split_once('e') {
        Some((mantissa, exponent)) => (mantissa, Some(exponent)),
        None => (digits, None),
    };
    let mantissa_ok =
        !mantissa.is_empty() && mantissa.chars().all(|c| c.is_ascii_digit() || c == '.');
    let exponent_ok = exponent.is_none_or(|exponent| {
        let exponent = exponent.trim_start_matches(['+', '-']);
        !exponent.is_empty() && exponent.chars().all(|c| c.is_ascii_digit())
    });
    mantissa_ok && exponent_ok
}

/// A short single-line string as a YAML scalar: plain when safe, otherwise a
/// double-quoted JSON string (valid YAML).
pub fn yaml_scalar(value: &str) -> String {
    let first_ok = value.chars().next().is_some_and(|first| {
        !first.is_whitespace()
            && !matches!(
                first,
                '-' | '?'
                    | ':'
                    | ','
                    | '['
                    | ']'
                    | '{'
                    | '}'
                    | '#'
                    | '&'
                    | '*'
                    | '!'
                    | '|'
                    | '>'
                    | '\''
                    | '"'
                    | '%'
                    | '@'
                    | '`'
            )
    });
    let plain_safe = first_ok
        && !value[value.chars().next().map_or(0, char::len_utf8)..].contains([':', '#'])
        && !value.ends_with(char::is_whitespace)
        && !is_yaml_keyword_or_number(value);
    if plain_safe {
        value.to_string()
    } else {
        serde_json::to_string(value).unwrap_or_else(|_| format!("\"{value}\""))
    }
}

/// Rewrites one frontmatter field, keeping every other field and the body. A
/// field that is not there yet is added (`name` first, others last); a document
/// without frontmatter gains one carrying just that field.
pub fn set_identity_field(content: &str, field: IdentityDocumentField, value: &str) -> String {
    let normalized = normalize_line_endings(content);
    let clean = value.split_whitespace().collect::<Vec<_>>().join(" ");
    let key = field.key();
    let line = if clean.is_empty() {
        format!("{key}:")
    } else {
        format!("{key}: {}", yaml_scalar(&clean))
    };

    let Some((frontmatter, body)) = split_frontmatter(&normalized) else {
        let body = normalized.trim_start_matches('\n').trim_end();
        return if body.is_empty() {
            format!("---\n{line}\n---\n")
        } else {
            format!("---\n{line}\n---\n\n{body}\n")
        };
    };

    let mut lines: Vec<String> = frontmatter.split('\n').map(str::to_string).collect();
    let is_field_line = |item: &str| {
        item.strip_prefix(key)
            .is_some_and(|rest| rest.trim_start().starts_with(':'))
    };
    if let Some(index) = lines.iter().position(|item| is_field_line(item)) {
        // Drop continuation lines of a multi-line value that belonged to the field.
        let mut end = index + 1;
        while end < lines.len() && {
            let next = &lines[end];
            next.starts_with(char::is_whitespace) && !next.trim().is_empty()
        } {
            end += 1;
        }
        lines.splice(index..end, [line]);
    } else if field == IdentityDocumentField::Name {
        lines.insert(0, line);
    } else {
        lines.push(line);
    }
    format!("---\n{}\n---\n{}", lines.join("\n"), body)
}

/// Applies every field of `patch` in a stable order.
pub fn apply_identity_patch(content: &str, patch: &IdentityFieldPatch) -> String {
    let mut next = content.to_string();
    for field in IdentityDocumentField::ALL {
        if let Some(value) = patch.get(field) {
            next = set_identity_field(&next, field, value);
        }
    }
    next
}

/// `(frontmatter, body)` for a document that opens with `---\n…\n---`.
fn split_frontmatter(normalized: &str) -> Option<(&str, &str)> {
    let rest = normalized.strip_prefix("---\n")?;
    let mut offset = 0;
    for line in rest.split_inclusive('\n') {
        let trimmed = line.strip_suffix('\n').unwrap_or(line);
        if trimmed == "---" {
            let frontmatter = rest[..offset].strip_suffix('\n').unwrap_or(&rest[..offset]);
            let body = &rest[offset + line.len()..];
            return Some((frontmatter, body));
        }
        offset += line.len();
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rewrites_only_the_named_field() {
        let seeded = "---\nname: Assistant 2\ncreature: owl\nvibe: calm\navatar:\nemoji: 🦉\ncustom: kept\n---\n\n# Who I am\nBody text.\n";
        let next = set_identity_field(seeded, IdentityDocumentField::Name, "  Ada   Lovelace ");
        assert_eq!(
            next,
            "---\nname: Ada Lovelace\ncreature: owl\nvibe: calm\navatar:\nemoji: 🦉\ncustom: kept\n---\n\n# Who I am\nBody text.\n"
        );
        let cleared = set_identity_field(&next, IdentityDocumentField::Emoji, "");
        assert!(cleared.contains("\nemoji:\n"));
        assert!(cleared.ends_with("# Who I am\nBody text.\n"));
    }

    #[test]
    fn quotes_values_yaml_would_misread() {
        assert_eq!(yaml_scalar("Ada"), "Ada");
        assert_eq!(yaml_scalar("yes"), "\"yes\"");
        assert_eq!(yaml_scalar("42"), "\"42\"");
        assert_eq!(yaml_scalar("1e5"), "\"1e5\"");
        assert_eq!(yaml_scalar("a: b"), "\"a: b\"");
        assert_eq!(yaml_scalar("#tag"), "\"#tag\"");
        assert_eq!(yaml_scalar("- item"), "\"- item\"");
        assert_eq!(yaml_scalar("🦊"), "🦊");
        let parsed: serde_yaml::Value =
            serde_yaml::from_str(&format!("name: {}", yaml_scalar("a: \"b\""))).expect("yaml");
        assert_eq!(parsed["name"].as_str(), Some("a: \"b\""));
    }

    #[test]
    fn adds_missing_fields_and_frontmatter() {
        assert_eq!(
            set_identity_field("", IdentityDocumentField::Name, "Nova"),
            "---\nname: Nova\n---\n"
        );
        assert_eq!(
            set_identity_field(
                "\r\n\r\nJust a body\r\n",
                IdentityDocumentField::Emoji,
                "✨"
            ),
            "---\nemoji: ✨\n---\n\nJust a body\n"
        );
        let doc = "---\nvibe: calm\n---\nBody\n";
        assert_eq!(
            set_identity_field(doc, IdentityDocumentField::Name, "Nova"),
            "---\nname: Nova\nvibe: calm\n---\nBody\n"
        );
        assert_eq!(
            set_identity_field(doc, IdentityDocumentField::Avatar, "https://x/y.png"),
            "---\nvibe: calm\navatar: \"https://x/y.png\"\n---\nBody\n"
        );
    }

    #[test]
    fn replaces_multi_line_values() {
        let doc = "---\nname: >\n  Folded\n  name\nvibe: calm\n---\n";
        assert_eq!(
            set_identity_field(doc, IdentityDocumentField::Name, "Flat"),
            "---\nname: Flat\nvibe: calm\n---\n"
        );
    }

    #[test]
    fn patch_applies_in_order_and_tolerates_partial_requests() {
        let patch: IdentityFieldPatch =
            serde_json::from_value(serde_json::json!({ "emoji": "🚀", "name": "Pilot" }))
                .expect("patch");
        assert!(!patch.is_empty());
        let next = apply_identity_patch("---\ncreature: fox\n---\n", &patch);
        assert_eq!(next, "---\nname: Pilot\ncreature: fox\nemoji: 🚀\n---\n");
        let empty: IdentityFieldPatch =
            serde_json::from_value(serde_json::json!({})).expect("empty patch");
        assert!(empty.is_empty());
    }
}

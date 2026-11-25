//! Account records: the account-level data (beyond settings) that every
//! runtime device keeps in its copy of the account replica (obp
//! `fleet::replica`) and exchanges with the account's other devices. No
//! server stores any of it.
//!
//! This module owns the stable facts every host applies the same way:
//!
//! - **Collections and budgets** ([`ACCOUNT_COLLECTIONS`]): one replica
//!   collection per kind of account data, each with its own record, byte
//!   and value budget and, for collections whose records name content blobs,
//!   how many devices pin each blob. Every runtime device declares all of
//!   them (also the ones it does not apply locally), so every device holds
//!   and relays every record within the same budget.
//! - **The secret guard** ([`find_secret`]): account records never carry a
//!   secret. A field whose name says it holds one (`apiKey`, `token`,
//!   `password`, `secret`, ...) and every value of an `env` or `headers` map
//!   must be empty or a per-device placeholder ([`secret_ref`]); a string
//!   shaped like a credential (a bearer value, a private key block, a known
//!   token prefix) is refused anywhere. The replica refuses such a write and
//!   such a merged record; bindings replace secrets with placeholders before
//!   they write, and the device that needs the secret asks for it locally.
//! - **The port** ([`AccountRecordPort`]): what a binding needs from the
//!   replica of the signed-in account. The fleet layer implements it.
//!
//! It performs no IO.

use std::future::Future;
use std::pin::Pin;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

// ── Collections ──────────────────────────────────────────────────────────

/// Quick actions (prompt templates), a record per action id.
pub const QUICK_ACTIONS_COLLECTION: &str = "quick_actions";
/// User custom agents and modes (`agent:<id>`) and agent profiles
/// (`profile:<mode id>`).
pub const AGENTS_COLLECTION: &str = "agents";
/// User-authored skills (`skill:<dir>`, files as blobs) and skill settings
/// (`settings:*`).
pub const SKILLS_COLLECTION: &str = "skills";
/// Routine definitions; each names the one device that runs it.
pub const ROUTINES_COLLECTION: &str = "routines";
/// MCP server shapes (secrets as per-device placeholders).
pub const MCP_SERVERS_COLLECTION: &str = "mcp.servers";
/// SSH connection profiles (without key paths or passwords).
pub const SSH_PROFILES_COLLECTION: &str = "ssh.profiles";
/// The consolidated memory document (files as blobs).
pub const MEMORY_COLLECTION: &str = "memory";
/// Assistant persona documents (files as blobs), a record per assistant
/// folder. Retired: assistants stay on their device, so no host binds it;
/// kept so records older builds publish stay within the replica's budgets.
pub const PERSONAS_COLLECTION: &str = "assistants.personas";
/// Desktop card definitions (geometry and fetched data stay on the device).
pub const DESKTOP_CARDS_COLLECTION: &str = "desktop.cards";
/// Imported pet sprite sets (`pkg:<dir>`, files as blobs) and the pet choice
/// (`selection`).
pub const PETS_COLLECTION: &str = "pets";
/// IM bot binding metadata (tokens and chat state stay on the owner device).
pub const BOTS_COLLECTION: &str = "bots";

/// A collection's budget (the replica's `CollectionPolicy`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AccountCollectionBudget {
    pub name: &'static str,
    pub max_records: usize,
    /// Bytes of the collection's records (JSON).
    pub max_bytes: usize,
    pub max_value_bytes: usize,
    /// Devices that pin every blob the collection's records name.
    pub durable_holders: usize,
}

const KIB: usize = 1024;
const MIB: usize = 1024 * 1024;

const fn budget(
    name: &'static str,
    max_records: usize,
    max_bytes: usize,
    max_value_bytes: usize,
    durable_holders: usize,
) -> AccountCollectionBudget {
    AccountCollectionBudget {
        name,
        max_records,
        max_bytes,
        max_value_bytes,
        durable_holders,
    }
}

/// Every account-record collection and its budget.
pub const ACCOUNT_COLLECTIONS: &[AccountCollectionBudget] = &[
    budget(QUICK_ACTIONS_COLLECTION, 256, 256 * KIB, 16 * KIB, 0),
    budget(AGENTS_COLLECTION, 512, 4 * MIB, 64 * KIB, 0),
    budget(SKILLS_COLLECTION, 512, 2 * MIB, 64 * KIB, 2),
    budget(ROUTINES_COLLECTION, 512, MIB, 16 * KIB, 0),
    budget(MCP_SERVERS_COLLECTION, 256, 512 * KIB, 16 * KIB, 0),
    budget(SSH_PROFILES_COLLECTION, 256, 512 * KIB, 8 * KIB, 0),
    budget(MEMORY_COLLECTION, 8, 64 * KIB, 8 * KIB, 2),
    budget(PERSONAS_COLLECTION, 256, 512 * KIB, 8 * KIB, 2),
    budget(DESKTOP_CARDS_COLLECTION, 64, MIB, 64 * KIB, 0),
    budget(PETS_COLLECTION, 256, 512 * KIB, 8 * KIB, 2),
    budget(BOTS_COLLECTION, 16, 32 * KIB, 4 * KIB, 0),
];

/// The budget of an account-record collection.
pub fn collection_budget(name: &str) -> Option<AccountCollectionBudget> {
    ACCOUNT_COLLECTIONS
        .iter()
        .find(|budget| budget.name == name)
        .copied()
}

/// Largest content blob (the replica's limit); larger files are chunked.
pub const MAX_CHUNK_BYTES: usize = 4 * MIB;

/// Whether `value` is a valid record id (the replica's key rule).
pub fn valid_record_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 256
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._:/@-".contains(&byte))
}

// ── Secret placeholders ──────────────────────────────────────────────────

/// The key of a per-device secret placeholder: `{"$secretRef": "<id>"}`.
pub const SECRET_REF_KEY: &str = "$secretRef";

/// A per-device placeholder for a secret (the device that needs the value
/// asks for it locally; the value never enters the replica).
pub fn secret_ref(id: impl Into<String>) -> Value {
    let mut fields = Map::new();
    fields.insert(SECRET_REF_KEY.to_string(), Value::String(id.into()));
    Value::Object(fields)
}

/// The placeholder id when `value` is a placeholder.
pub fn secret_ref_id(value: &Value) -> Option<&str> {
    let fields = value.as_object()?;
    if fields.len() != 1 {
        return None;
    }
    fields.get(SECRET_REF_KEY)?.as_str()
}

pub fn is_secret_ref(value: &Value) -> bool {
    secret_ref_id(value).is_some()
}

// ── The secret guard ─────────────────────────────────────────────────────

fn normalized(key: &str) -> String {
    key.chars()
        .filter(char::is_ascii_alphanumeric)
        .map(|c| c.to_ascii_lowercase())
        .collect()
}

const SECRET_NAMES: &[&str] = &[
    "apikey",
    "token",
    "password",
    "passwd",
    "passphrase",
    "secret",
    "privatekey",
    "authorization",
    "cookie",
    "credential",
    "credentials",
    "bearer",
];

const SECRET_SUFFIXES: &[&str] = &[
    "token",
    "secret",
    "password",
    "passphrase",
    "apikey",
    "privatekey",
];

/// Whether a field name says it holds a secret (`api_key`, `botToken`,
/// `app_secret`, `Authorization`, ...).
pub fn is_secret_field_name(key: &str) -> bool {
    let key = normalized(key);
    SECRET_NAMES.contains(&key.as_str()) || SECRET_SUFFIXES.iter().any(|end| key.ends_with(end))
}

/// Whether a field holds a map of secret values (`env`, `headers`).
pub fn is_secret_map_name(key: &str) -> bool {
    matches!(
        normalized(key).as_str(),
        "env" | "environment" | "envvars" | "headers" | "httpheaders"
    )
}

const TOKEN_PREFIXES: &[&str] = &[
    "sk-",
    "sk_live_",
    "sk_test_",
    "rk_live_",
    "ghp_",
    "gho_",
    "ghu_",
    "ghs_",
    "ghr_",
    "github_pat_",
    "glpat-",
    "xoxb-",
    "xoxp-",
    "xoxa-",
    "xapp-",
    "ya29.",
    "hf_",
    "npm_",
    "pypi-",
];

fn is_token_word(word: &str) -> bool {
    word.len() >= 16
        && word
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_.=+/:~".contains(&byte))
}

fn looks_like_jwt(word: &str) -> bool {
    word.len() >= 40
        && word.starts_with("eyJ")
        && word.split('.').count() == 3
        && word
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_.".contains(&byte))
}

fn looks_like_telegram_token(word: &str) -> bool {
    let Some((id, rest)) = word.split_once(':') else {
        return false;
    };
    (8..=12).contains(&id.len())
        && id.bytes().all(|byte| byte.is_ascii_digit())
        && rest.len() >= 30
        && rest
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_".contains(&byte))
}

fn looks_like_aws_key(word: &str) -> bool {
    (word.starts_with("AKIA") || word.starts_with("ASIA"))
        && word.len() == 20
        && word
            .bytes()
            .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit())
}

fn looks_like_token(word: &str) -> bool {
    if word.chars().any(char::is_whitespace) {
        return false;
    }
    let lower = word.to_ascii_lowercase();
    let prefixed = word.len() >= 32
        && word.bytes().any(|byte| byte.is_ascii_digit())
        && TOKEN_PREFIXES
            .iter()
            .any(|prefix| lower.starts_with(prefix))
        && is_token_word(word);
    prefixed
        || looks_like_aws_key(word)
        || (word.starts_with("AIza") && word.len() >= 35 && is_token_word(word))
        || looks_like_jwt(word)
        || looks_like_telegram_token(word)
}

/// Whether a string value is shaped like a credential: a private key block,
/// an `Authorization` value (`Bearer <token>`), a well-known token prefix, a
/// JWT or a bot token.
pub fn looks_like_secret(value: &str) -> bool {
    let trimmed = value.trim();
    if trimmed.contains("-----BEGIN") && trimmed.contains("PRIVATE KEY") {
        return true;
    }
    let lower = trimmed.to_ascii_lowercase();
    for scheme in ["bearer ", "basic ", "token "] {
        if let Some(rest) = lower.strip_prefix(scheme) {
            let rest = &trimmed[trimmed.len() - rest.len()..];
            if is_token_word(rest.trim()) {
                return true;
            }
        }
    }
    looks_like_token(trimmed)
}

/// Whether text (a file the record names as a blob) carries a credential:
/// a private key block, or any word shaped like a token.
pub fn text_contains_secret(text: &str) -> bool {
    if text.contains("-----BEGIN") && text.contains("PRIVATE KEY") {
        return true;
    }
    let mut previous = "";
    for word in text.split(|c: char| c.is_whitespace() || "\"'`=,;()[]{}<>".contains(c)) {
        if word.is_empty() {
            continue;
        }
        if looks_like_token(word)
            || (matches!(previous.to_ascii_lowercase().as_str(), "bearer" | "basic")
                && is_token_word(word)
                && word.len() >= 20)
        {
            return true;
        }
        previous = word;
    }
    false
}

fn secret_free(value: &Value) -> bool {
    match value {
        Value::Null | Value::Bool(_) | Value::Number(_) => true,
        Value::String(text) => text.is_empty(),
        Value::Object(_) => is_secret_ref(value),
        Value::Array(items) => items.iter().all(secret_free),
    }
}

fn walk(value: &Value, path: &mut String) -> Option<String> {
    match value {
        Value::Object(fields) => {
            if is_secret_ref(value) {
                return None;
            }
            for (key, child) in fields {
                let length = path.len();
                path.push('/');
                path.push_str(key);
                let found = if is_secret_field_name(key) {
                    (!secret_free(child)).then(|| path.clone())
                } else if is_secret_map_name(key) {
                    match child {
                        Value::Object(entries) => entries
                            .iter()
                            .find(|(_, entry)| !secret_free(entry))
                            .map(|(name, _)| format!("{path}/{name}")),
                        other => (!secret_free(other)).then(|| path.clone()),
                    }
                } else {
                    walk(child, path)
                };
                path.truncate(length);
                if found.is_some() {
                    return found;
                }
            }
            None
        }
        Value::Array(items) => {
            for (index, item) in items.iter().enumerate() {
                let length = path.len();
                path.push('/');
                path.push_str(&index.to_string());
                let found = walk(item, path);
                path.truncate(length);
                if found.is_some() {
                    return found;
                }
            }
            None
        }
        Value::String(text) => {
            (looks_like_secret(text) || text_contains_secret(text)).then(|| path.clone())
        }
        _ => None,
    }
}

/// Where `value` carries a secret (a JSON pointer, `""` for the value
/// itself), or `None` when it is secret-free.
pub fn find_secret(value: &Value) -> Option<String> {
    let mut path = String::new();
    walk(value, &mut path)
}

// ── The port ─────────────────────────────────────────────────────────────

/// One record of a collection.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountRecord {
    pub id: String,
    /// `None`: a tombstone.
    #[serde(default)]
    pub value: Option<Value>,
    /// Orders like the record's clock; equal stamps are the same write.
    pub stamp: String,
    /// The content blobs the record names (`sha256`).
    #[serde(default)]
    pub blobs: Vec<String>,
}

/// A blob a record names.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AccountBlobRef {
    pub hash: String,
    pub bytes: u64,
}

/// The replica's exchange state.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountReplicaState {
    pub peers: usize,
    pub peers_online: usize,
    pub undelivered: usize,
    pub exchanging: bool,
    pub last_exchange_ms: Option<u64>,
}

/// Why a write was refused.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AccountRecordError {
    /// The value carries a secret at this path.
    Secret(String),
    /// The collection's budget is used up, or a value is over its limit.
    Budget(String),
    Other(String),
}

impl std::fmt::Display for AccountRecordError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Secret(path) => write!(f, "account record carries a secret at {path:?}"),
            Self::Budget(detail) => write!(f, "account record over budget: {detail}"),
            Self::Other(detail) => write!(f, "account record not written: {detail}"),
        }
    }
}

impl std::error::Error for AccountRecordError {}

pub type BlobFuture<'a> = Pin<Box<dyn Future<Output = Option<Vec<u8>>> + Send + 'a>>;

/// The replica of the signed-in account on this device, as account-record
/// bindings use it.
pub trait AccountRecordPort: Send + Sync {
    fn account_id(&self) -> String;
    /// This device's id (the writer id in the clocks it writes).
    fn device_id(&self) -> String;
    /// Every record of a collection, tombstones included.
    fn records(&self, collection: &str) -> Vec<AccountRecord>;
    /// A write (`seed`: an offer with the lowest clock, stored only where
    /// the record is absent); returns the record's stamp (`None`: already
    /// stored, or an offer that lost).
    fn put(
        &self,
        collection: &str,
        id: &str,
        value: Value,
        blobs: &[AccountBlobRef],
        seed: bool,
    ) -> Result<Option<String>, AccountRecordError>;
    /// A deletion (a tombstone).
    fn delete(&self, collection: &str, id: &str) -> Result<Option<String>, AccountRecordError>;
    /// Keeps content here (`pin`: as a durable holder); returns its hash.
    fn put_blob(&self, bytes: &[u8], pin: bool) -> Result<String, AccountRecordError>;
    /// Content from this device or an online device that has it.
    fn fetch_blob<'a>(&'a self, hash: &'a str, pin: bool) -> BlobFuture<'a>;
    /// Whether this device holds the content now.
    fn has_blob(&self, _hash: &str) -> bool {
        true
    }
    fn state(&self) -> AccountReplicaState;
}

#[cfg(test)]
#[path = "account_records_tests.rs"]
mod tests;

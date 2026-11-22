//! The cloud node's commands for frontends (`superagent_*`), and account
//! provisioning.
//!
//! On by default: the first sign-in (or first use) of an account creates its
//! cloud node key and registers the node's directory row
//! ([`Service::ensure`]). `superagent_disable` turns it off and
//! `superagent_delete_data` deletes everything in one step.

use std::sync::Arc;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use openbitfun_product_domains::superagent::{
    CLOUD_DEVICE_DISPLAY_NAME, SUPERAGENT_CARD_CHANGED_EVENT,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::conversation::{ConversationSummary, Message, Role};
use crate::crypto;
use crate::device::DeviceSnapshot;
use crate::directory::{Directory, DirectoryError};
use crate::engine::Engine;
use crate::slots::{AccountMeta, Slot, SlotError};
use openbitfun_product_domains::superagent::SuperagentJobState;

/// The commands this node serves.
pub const COMMANDS: &[&str] = &[
    "superagent_status",
    "superagent_enable",
    "superagent_disable",
    "superagent_list_conversations",
    "superagent_get_conversation",
    "superagent_send",
    "superagent_set_model",
    "superagent_cancel_turn",
    "superagent_job_action",
    "superagent_rename_conversation",
    "superagent_delete_conversation",
    "superagent_delete_data",
    // Fleet owner verbs: the cloud node's index partition.
    "fleet_digest",
    "fleet_replay",
];

/// The cloud node's one virtual workspace (its sessions are conversations).
pub const CLOUD_WORKSPACE_ID: &str = "cloud-conversations";

/// The surface's message catalogs (`locales/<locale>.json`, registered as
/// the `superagent` surface in `src/shared/i18n/contract/locales.json`).
const CATALOGS: [(&str, &str); 3] = [
    ("en-US", include_str!("../locales/en-US.json")),
    ("zh-CN", include_str!("../locales/zh-CN.json")),
    ("zh-TW", include_str!("../locales/zh-TW.json")),
];
/// The contract's aliases for these locales (input boundary only).
const LOCALE_ALIASES: [(&str, &[&str]); 3] = [
    ("en-US", &["en", "en-us"]),
    ("zh-CN", &["zh", "zh-hans", "zh-cn", "zh-sg"]),
    ("zh-TW", &["zh-tw", "zh-hant", "zh-hk", "zh-mo"]),
];
const FALLBACK_LOCALE: &str = "en-US";

/// A canonical locale id for an input (aliases, `_` separators, any case);
/// unknown ids fall back to `en-US`.
pub fn resolve_locale(locale: Option<&str>) -> &'static str {
    let normalized = locale
        .unwrap_or(FALLBACK_LOCALE)
        .trim()
        .replace('_', "-")
        .to_ascii_lowercase();
    LOCALE_ALIASES
        .iter()
        .find(|(_, aliases)| aliases.contains(&normalized.as_str()))
        .map(|(id, _)| *id)
        .unwrap_or(FALLBACK_LOCALE)
}

fn catalog(locale: &str) -> std::collections::BTreeMap<String, String> {
    let text = CATALOGS
        .iter()
        .find(|(id, _)| *id == locale)
        .or_else(|| CATALOGS.iter().find(|(id, _)| *id == FALLBACK_LOCALE))
        .map(|(_, text)| *text)
        .unwrap_or("{}");
    serde_json::from_str(text).unwrap_or_default()
}

/// The composer's starter prompts (three) and placeholder for a locale.
pub fn composer_copy(locale: Option<&str>) -> (&'static str, Vec<String>, String) {
    let id = resolve_locale(locale);
    let messages = catalog(id);
    let fallback = catalog(FALLBACK_LOCALE);
    let get = |key: &str| {
        messages
            .get(key)
            .or_else(|| fallback.get(key))
            .cloned()
            .unwrap_or_default()
    };
    let suggestions = (1..=3)
        .map(|n| get(&format!("composer.suggestion.{n}")))
        .collect();
    (id, suggestions, get("composer.placeholder"))
}

/// Local midnights (Unix ms) of today, yesterday and six days before today
/// in `time_zone` (IANA); UTC when absent or unknown. Returns the zone used.
pub fn day_bounds(now_ms: u64, time_zone: Option<&str>) -> (String, [u64; 3]) {
    use chrono::{Duration, TimeZone};
    let zone: chrono_tz::Tz = time_zone
        .and_then(|name| name.trim().parse().ok())
        .unwrap_or(chrono_tz::UTC);
    let now = zone
        .timestamp_millis_opt(now_ms as i64)
        .single()
        .unwrap_or_else(|| zone.timestamp_millis_opt(0).unwrap());
    let today = now.date_naive();
    let midnight = |days_back: i64| -> u64 {
        let date = today - Duration::days(days_back);
        let start = date
            .and_hms_opt(0, 0, 0)
            .expect("midnight exists as a naive time");
        // A zone that skips midnight (DST): take the earliest valid instant.
        let local = zone.from_local_datetime(&start).earliest().or_else(|| {
            zone.from_local_datetime(&(start + Duration::hours(1)))
                .earliest()
        });
        local
            .map(|t| t.timestamp_millis().max(0) as u64)
            .unwrap_or(0)
    };
    (
        zone.name().to_string(),
        [midnight(0), midnight(1), midnight(6)],
    )
}

/// Cards per list in `workingNow`.
const WORKING_NOW_MAX: usize = 3;
/// Conversation list page size.
const LIST_PAGE: usize = 50;

/// Host capabilities the node advertises on its OBP hello.
pub const HOST_CAPABILITIES: &[&str] = &[
    "superagent_v1",
    openbitfun_product_domains::fleet::FLEET_V1_CAPABILITY,
];

const PAGE: usize = 100;
/// An account's node unused this long with no live work is shredded (key,
/// metadata and every record; `ensure` creates a new one on next use).
pub const ACCOUNT_TTL_MS: u64 = 180 * 24 * 3600 * 1000;
/// How often a frontend's use is written to the account's metadata.
const LAST_USED_WRITE_MS: u64 = 24 * 3600 * 1000;

pub struct Service {
    pub engine: Arc<Engine>,
    pub directory: Arc<dyn Directory>,
}

fn args_of<T: for<'de> Deserialize<'de>>(args: &Value) -> Result<T, String> {
    // Commands take one structured `request`; a bare object is accepted too.
    let request = args.get("request").cloned().unwrap_or_else(|| args.clone());
    let request = if request.is_null() {
        json!({})
    } else {
        request
    };
    serde_json::from_value(request).map_err(|error| format!("invalid_request: {error}"))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SendRequest {
    #[serde(default)]
    conversation_id: Option<String>,
    message: String,
    client_message_id: String,
    /// The picker's choice: absent keeps the conversation's, `null` is Auto,
    /// `{deviceId, modelId}` that device and model.
    #[serde(default, deserialize_with = "present")]
    model: Option<Value>,
}

/// `superagent_set_model {conversationId, deviceId?, modelId?}`: both set
/// pins that device and model, both absent (or `null`) is Auto.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetModelRequest {
    #[serde(alias = "id")]
    conversation_id: String,
    #[serde(default)]
    device_id: Option<String>,
    #[serde(default)]
    model_id: Option<String>,
}

/// Keeps an explicit `null` apart from an absent field.
fn present<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<Option<Value>, D::Error> {
    Ok(Some(Value::deserialize(deserializer)?))
}

/// A pick from the wire: `null` (or both ids empty) is Auto.
fn model_pick_of(
    device_id: Option<&str>,
    model_id: Option<&str>,
) -> Result<Option<openbitfun_product_domains::superagent::SuperagentModelPick>, String> {
    let device_id = device_id.map(str::trim).filter(|id| !id.is_empty());
    let model_id = model_id.map(str::trim).filter(|id| !id.is_empty());
    match (device_id, model_id) {
        (None, None) => Ok(None),
        (Some(device_id), Some(model_id)) if device_id.len() <= 128 && model_id.len() <= 256 => {
            Ok(Some(
                openbitfun_product_domains::superagent::SuperagentModelPick {
                    device_id: device_id.to_string(),
                    model_id: model_id.to_string(),
                },
            ))
        }
        _ => Err("invalid_request: pick a device and a model, or Auto".into()),
    }
}

fn model_pick_of_value(
    value: &Value,
) -> Result<Option<openbitfun_product_domains::superagent::SuperagentModelPick>, String> {
    if value.is_null() {
        return Ok(None);
    }
    let text = |key: &str| value.get(key).and_then(Value::as_str);
    model_pick_of(text("deviceId"), text("modelId"))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConversationRequest {
    #[serde(alias = "id")]
    conversation_id: String,
    #[serde(default)]
    cursor: Option<u64>,
    /// The page of an archived conversation the frontend's entry read from
    /// its replica (`fleet::superagent_archive`); used, never stored.
    #[serde(default)]
    archive: Option<openbitfun_product_domains::superagent::archive::ArchivedPage>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JobActionRequest {
    job_id: String,
    action: String,
    #[serde(default)]
    text: Option<String>,
    /// Idempotency key of a `message` action (a retry sends once).
    #[serde(default)]
    client_message_id: Option<String>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct ListRequest {
    cursor: Option<u64>,
    limit: Option<usize>,
    /// Accepted for symmetry with status (rows carry no copy today).
    #[allow(dead_code)]
    locale: Option<String>,
    /// IANA zone the date groups use (UTC when absent or unknown).
    time_zone: Option<String>,
    /// The archived conversations the frontend's entry holds in its replica
    /// (`fleet::superagent_archive`), listed with the working set; used,
    /// never stored.
    archived: Vec<openbitfun_product_domains::superagent::archive::ArchivedSummary>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct StatusRequest {
    locale: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenameRequest {
    conversation_id: String,
    title: String,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct DeleteRequest {
    /// The frontend asked the user; `true` cancels live jobs on their
    /// devices first, `false` leaves them running there.
    cancel_jobs: bool,
}

impl Service {
    pub fn new(engine: Arc<Engine>, directory: Arc<dyn Directory>) -> Arc<Self> {
        Arc::new(Self { engine, directory })
    }

    /// Creates the account's cloud node on first use (key, directory row,
    /// encrypted store) and returns its slot. Idempotent.
    pub async fn ensure(&self, account_id: &str) -> Result<Arc<Slot>, String> {
        let now = self.engine.now();
        let master = *self.engine.slots.store().master();
        let device_id = crypto::cloud_device_id(&master, account_id);
        let created = AccountMeta {
            version: 1,
            account_id: account_id.to_string(),
            device_id: device_id.clone(),
            device_secret: BASE64.encode(crypto::random_bytes::<32>()),
            directory_token: None,
            enabled: true,
            created_ms: now,
            updated_ms: now,
            last_used_ms: now,
        };
        let slot = self
            .engine
            .slots
            .load(account_id, now, Some(created))
            .await
            .map_err(|e| e.to_string())?;
        let mut state = slot.state.lock().await;
        if state.meta.directory_token.is_none() {
            let secret = decode_secret(&state.meta.device_secret)?;
            let token = self
                .directory
                .register(
                    account_id,
                    &device_id,
                    CLOUD_DEVICE_DISPLAY_NAME,
                    &crypto::public_key_base64(&secret),
                )
                .await
                .map_err(|error| error.to_string())?;
            state.meta.directory_token = Some(token);
            state.meta.updated_ms = now;
            slot.save_meta(&state).map_err(|e| e.to_string())?;
            log::info!("Superagent node registered: device={}", device_id);
        }
        drop(state);
        Ok(slot)
    }

    /// Runs one command for a frontend of `account_id`.
    pub async fn dispatch(
        &self,
        account_id: &str,
        command: &str,
        args: Value,
    ) -> Result<Value, String> {
        let now = self.engine.now();
        let slot = match self.engine.slots.load(account_id, now, None).await {
            Ok(slot) => slot,
            Err(SlotError::NotProvisioned) => {
                return Err(
                    "superagent_not_provisioned: sign in again to set up Super Agent".into(),
                )
            }
            Err(error) => return Err(error.to_string()),
        };
        slot.touch(now);
        {
            let mut state = slot.state.lock().await;
            if now.saturating_sub(state.meta.last_used_ms) >= LAST_USED_WRITE_MS {
                state.meta.last_used_ms = now;
                let _ = slot.save_meta(&state);
            }
        }
        match command {
            "superagent_status" => {
                let request: StatusRequest = args_of(&args)?;
                self.status(&slot, request.locale.as_deref()).await
            }
            "superagent_enable" | "superagent_disable" => {
                let enabled = command == "superagent_enable";
                let mut state = slot.state.lock().await;
                state.meta.enabled = enabled;
                state.meta.updated_ms = now;
                slot.save_meta(&state).map_err(|e| e.to_string())?;
                Ok(json!({ "enabled": enabled }))
            }
            "superagent_list_conversations" => {
                let request: ListRequest = args_of(&args)?;
                self.list_conversations(&slot, request).await
            }
            "fleet_digest" => {
                let request: openbitfun_product_domains::fleet::FleetDigestRequest =
                    args_of(&args)?;
                let _ = request;
                self.digest(&slot).await
            }
            "fleet_replay" => {
                let request: openbitfun_product_domains::fleet::FleetReplayRequest =
                    args_of(&args)?;
                Ok(replay(&slot, &request))
            }
            "superagent_rename_conversation" => {
                let request: RenameRequest = args_of(&args)?;
                let title = request.title.trim();
                if title.is_empty() || title.chars().count() > 120 {
                    return Err("invalid_request: the title must be 1-120 characters".into());
                }
                self.engine
                    .ensure_conversation(&slot, &request.conversation_id)
                    .await?;
                let mut state = slot.state.lock().await;
                if !slot
                    .rename_conversation(&mut state, &request.conversation_id, title)
                    .map_err(|e| e.to_string())?
                {
                    return Err("not_found: no such conversation".into());
                }
                drop(state);
                self.engine.digest_changed(&slot);
                Ok(json!({ "conversationId": request.conversation_id, "title": title }))
            }
            "superagent_delete_conversation" => {
                let request: ConversationRequest = args_of(&args)?;
                // The turn ends; its jobs keep running on their devices.
                let _ = self
                    .engine
                    .cancel_turn(&slot, &request.conversation_id)
                    .await;
                let mut state = slot.state.lock().await;
                let deleted = slot
                    .delete_conversation(&mut state, &request.conversation_id)
                    .map_err(|e| e.to_string())?;
                let jobs_kept = state
                    .ledger
                    .live_jobs()
                    .filter(|job| job.conversation_id == request.conversation_id)
                    .count();
                drop(state);
                self.engine.digest_changed(&slot);
                // An archived conversation is deleted on the devices (its
                // tombstone is queued even when this node did not hold it).
                let _ = deleted;
                Ok(json!({ "deleted": true, "jobsLeftRunning": jobs_kept }))
            }
            "superagent_get_conversation" => {
                let request: ConversationRequest = args_of(&args)?;
                self.conversation_view(&slot, request).await
            }
            "superagent_send" => {
                let request: SendRequest = args_of(&args)?;
                let pick = request
                    .model
                    .as_ref()
                    .map(model_pick_of_value)
                    .transpose()?;
                self.engine
                    .send_with_model(
                        &slot,
                        request.conversation_id.as_deref(),
                        &request.message,
                        &request.client_message_id,
                        pick,
                    )
                    .await
            }
            "superagent_set_model" => {
                let request: SetModelRequest = args_of(&args)?;
                let pick =
                    model_pick_of(request.device_id.as_deref(), request.model_id.as_deref())?;
                self.engine
                    .set_model(&slot, &request.conversation_id, pick)
                    .await?;
                let candidates = self.engine.holder_candidates(account_id).await;
                let state = slot.state.lock().await;
                let selected = state
                    .conversations
                    .get(&request.conversation_id)
                    .and_then(|conversation| conversation.model_pick());
                Ok(json!({
                    "conversationId": request.conversation_id,
                    "model": openbitfun_product_domains::superagent::project_model_selection(
                        selected.as_ref(),
                        &candidates,
                    ),
                }))
            }
            "superagent_cancel_turn" => {
                let request: ConversationRequest = args_of(&args)?;
                self.engine
                    .cancel_turn(&slot, &request.conversation_id)
                    .await
            }
            "superagent_job_action" => {
                let request: JobActionRequest = args_of(&args)?;
                match request.action.as_str() {
                    "cancel" => Ok(self.engine.job_cancel(&slot, &request.job_id).await),
                    "refresh" => {
                        self.engine
                            .refresh_jobs(&slot, &[request.job_id.clone()])
                            .await;
                        let state = slot.state.lock().await;
                        let job = state
                            .ledger
                            .jobs
                            .get(&request.job_id)
                            .cloned()
                            .ok_or("not_found: no such job")?;
                        drop(state);
                        let devices = self.engine.devices(account_id).await;
                        Ok(json!({ "card": self.engine.job_card(&job, Some(&devices)) }))
                    }
                    "message" => {
                        let text = request.text.unwrap_or_default();
                        let op_id = crate::engine::derived_job_id(
                            "frontend",
                            request
                                .client_message_id
                                .as_deref()
                                .unwrap_or(&uuid::Uuid::new_v4().to_string()),
                            &request.job_id,
                        );
                        match self
                            .engine
                            .message_job(
                                &slot,
                                &request.job_id,
                                &text,
                                openbitfun_product_domains::superagent::JobMessageMode::Auto,
                                &op_id,
                            )
                            .await
                        {
                            Ok((outcome, _)) => {
                                Ok(json!({ "jobId": request.job_id, "outcome": outcome }))
                            }
                            Err(error) => Err(format!(
                                "{}: {}",
                                error["error"]["code"].as_str().unwrap_or("device_error"),
                                error["error"]["message"]
                                    .as_str()
                                    .unwrap_or("the message was not delivered")
                            )),
                        }
                    }
                    other => Err(format!("invalid_request: unknown job action '{other}'")),
                }
            }
            "superagent_delete_data" => {
                let request: DeleteRequest = args_of(&args)?;
                self.delete_data(slot, request.cancel_jobs).await
            }
            other => Err(format!(
                "{}: command '{other}' is not served by Super Agent",
                openbitfun_obp::UNSUPPORTED_IN_NATIVE_HOST
            )),
        }
    }

    /// The time-to-live sweep over resident and stored accounts (on a timer
    /// and at load): an account unused for [`ACCOUNT_TTL_MS`] with no live
    /// job, running turn or pending history is shredded (its directory row is
    /// removed first; `ensure` recreates both on next use); resident accounts
    /// under TTL get their time-to-live pass, while idle non-resident accounts
    /// whose on-disk record mtimes are within [`ACCOUNT_TTL_MS`] are skipped
    /// without decrypting or loading them into the slot cache. Returns the
    /// shredded accounts.
    pub async fn sweep_accounts(&self) -> Vec<String> {
        let now = self.engine.now();
        let store = Arc::clone(self.engine.slots.store());
        let mut shredded = Vec::new();
        let resident_accounts = self.engine.slots.resident_accounts();
        let mut resident_dirs = std::collections::HashSet::with_capacity(resident_accounts.len());
        for account_id in resident_accounts {
            resident_dirs.insert(store.dir_name(&account_id));
            let Some(slot) = self.engine.slots.resident(&account_id) else {
                continue;
            };
            let (meta, busy) = {
                let state = slot.state.lock().await;
                let busy = state.ledger.has_live_jobs()
                    || !state.outbox.chunks.is_empty()
                    || state
                        .conversations
                        .values()
                        .any(|conversation| conversation.active_turn().is_some())
                    || slot.attached() > 0;
                (state.meta.clone(), busy)
            };
            if meta.account_id.is_empty() {
                continue;
            }
            let last_used = account_last_used_ms(&meta);
            if now.saturating_sub(last_used) < ACCOUNT_TTL_MS {
                crate::archive::pump(&self.engine, &slot, true).await;
                self.engine.sweep_slot(&slot, true).await;
                continue;
            }
            if busy {
                continue;
            }
            drop(slot);
            if self.shred_expired_account(&store, &meta).await {
                shredded.push(meta.account_id);
            }
        }

        // Non-resident directories on disk: check on-disk record mtimes before
        // opening/decrypting anything so hourly sweeps never thrash the
        // resident slot cache or decrypt active/recent idle accounts.
        let store_scan = Arc::clone(&store);
        let expired_candidates: Vec<AccountMeta> = tokio::task::spawn_blocking(move || {
            let mut candidates = Vec::new();
            for dir in store_scan.account_dirs() {
                if resident_dirs.contains(&dir) {
                    continue;
                }
                let dir_path = store_scan.root().join("accounts").join(&dir);
                let meta_path = dir_path.join(format!("{}.rec", crate::slots::META_RECORD));
                if !meta_path.is_file() {
                    continue;
                }
                if let Some(meta_mtime) = file_mtime_ms(&meta_path) {
                    if now.saturating_sub(meta_mtime) < ACCOUNT_TTL_MS {
                        continue;
                    }
                }
                if let Some(latest_mtime) = dir_latest_rec_mtime_ms(&dir_path) {
                    if now.saturating_sub(latest_mtime) < ACCOUNT_TTL_MS {
                        continue;
                    }
                }
                let Ok(account) = store_scan.account_by_dir(&dir) else {
                    continue;
                };
                // Internal records (the watch list, the target index) have no
                // metadata.
                let Ok(Some(meta)) = account.read_json::<AccountMeta>(crate::slots::META_RECORD)
                else {
                    continue;
                };
                if meta.account_id.is_empty() {
                    continue;
                }
                let last_used = account_last_used_ms(&meta);
                if now.saturating_sub(last_used) < ACCOUNT_TTL_MS {
                    continue;
                }
                if stored_account_is_busy(&account) {
                    continue;
                }
                candidates.push(meta);
            }
            candidates
        })
        .await
        .unwrap_or_default();

        for meta in expired_candidates {
            // Skip if a frontend loaded this account while we scanned disk.
            if self.engine.slots.resident(&meta.account_id).is_some() {
                continue;
            }
            if self.shred_expired_account(&store, &meta).await {
                shredded.push(meta.account_id);
            }
        }
        shredded
    }

    async fn shred_expired_account(&self, store: &crate::store::Store, meta: &AccountMeta) -> bool {
        match self
            .directory
            .unregister(
                &meta.account_id,
                &meta.device_id,
                meta.directory_token.as_deref(),
            )
            .await
        {
            Ok(()) | Err(DirectoryError::NotFound) => {}
            Err(error) => {
                log::info!(
                    "Superagent sweep kept an account: directory unavailable ({})",
                    error
                );
                return false;
            }
        }
        self.engine.slots.forget(&meta.account_id);
        self.engine.forget_account(&meta.account_id);
        match store.shred(&meta.account_id) {
            Ok(_) => {
                log::info!("Superagent account unused for 180 days shredded");
                true
            }
            Err(error) => {
                log::warn!("Superagent account not shredded: {}", error);
                false
            }
        }
    }

    async fn status(&self, slot: &Arc<Slot>, locale: Option<&str>) -> Result<Value, String> {
        let (locale, suggestions, placeholder) = composer_copy(locale);
        let devices = self.engine.devices(&slot.account_id).await;
        let state = slot.state.lock().await;
        let holder =
            devices.iter().any(|device| {
                device.facts.online
                    && device.facts.model_configured
                    && device.facts.host_capabilities.iter().any(|c| {
                        c == openbitfun_product_domains::superagent::FLEET_MODEL_CAPABILITY
                    })
            });
        let cards = |wanted: &dyn Fn(SuperagentJobState) -> bool| -> Vec<Value> {
            let mut jobs: Vec<&crate::ledger::JobRecord> = state
                .ledger
                .live_jobs()
                .filter(|job| wanted(job.state))
                .collect();
            jobs.sort_by(|a, b| b.updated_ms.cmp(&a.updated_ms));
            jobs.into_iter()
                .take(WORKING_NOW_MAX)
                .map(|job| self.engine.job_card(job, Some(&devices)))
                .collect()
        };
        let needs_you = cards(&|state| state == SuperagentJobState::Blocked);
        let working = cards(&|state| {
            matches!(
                state,
                SuperagentJobState::Working | SuperagentJobState::Queued
            )
        });
        Ok(json!({
            "locale": locale,
            "suggestions": suggestions,
            "placeholder": placeholder,
            // A frontend reaches this node only through a signed-in account.
            "signedIn": true,
            "workingNow": { "needsYou": needs_you, "working": working },
            "enabled": state.meta.enabled,
            "deviceId": state.meta.device_id,
            "name": CLOUD_DEVICE_DISPLAY_NAME,
            "hostKind": "cloud",
            "conversations": state.summaries.len(),
            "liveJobs": state.ledger.live_jobs().count(),
            "holderAvailable": holder,
            "devicesOnline": devices.iter().filter(|d| d.facts.online).count(),
            // The model picker: Auto, or a device and one of its models.
            "models": openbitfun_product_domains::superagent::project_model_devices(
                &devices.iter().map(DeviceSnapshot::holder_candidate).collect::<Vec<_>>(),
            ),
        }))
    }

    /// `superagent_get_conversation`: the working set's conversation (its
    /// older pages from the outbox, a legacy record or the page the entry
    /// passed along), else the entry's archived page, else the conversation
    /// resumed from the devices.
    async fn conversation_view(
        &self,
        slot: &Arc<Slot>,
        request: ConversationRequest,
    ) -> Result<Value, String> {
        let id = request.conversation_id.as_str();
        let held = {
            let mut state = slot.state.lock().await;
            slot.conversation(&mut state, id)
                .map_err(|e| e.to_string())?
                .is_some()
        };
        if held {
            return self
                .conversation(slot, id, request.cursor, request.archive.as_ref())
                .await;
        }
        if let Some(page) = request.archive {
            if page.summary.id == id {
                return self.archived_view(slot, page).await;
            }
        }
        if self.engine.ensure_conversation(slot, id).await? {
            return self.conversation(slot, id, request.cursor, None).await;
        }
        Err("not_found: no such conversation".into())
    }

    /// An archived conversation, read only, from the page its entry passed.
    async fn archived_view(
        &self,
        slot: &Arc<Slot>,
        page: openbitfun_product_domains::superagent::archive::ArchivedPage,
    ) -> Result<Value, String> {
        let id = page.summary.id.clone();
        let devices = self.engine.devices(&slot.account_id).await;
        let state = slot.state.lock().await;
        let cards: Vec<Value> = state
            .ledger
            .jobs
            .values()
            .filter(|job| job.conversation_id == id)
            .map(|job| self.engine.job_card_seen(job, Some(&devices), None))
            .collect();
        let job_labels: Vec<(String, String)> = state
            .ledger
            .jobs
            .values()
            .filter(|job| job.conversation_id == id)
            .map(|job| {
                (
                    job.job_id.clone(),
                    job.label.clone().unwrap_or_else(|| job.title.clone()),
                )
            })
            .collect();
        drop(state);
        let messages: Vec<Message> = page
            .messages
            .iter()
            .map(|value| serde_json::from_value(value.clone()).unwrap_or_default())
            .collect();
        let mut projected = crate::archive::history_notices(page.summary.unsaved, None, 0);
        projected.extend(project_messages(messages, &job_labels));
        let candidates: Vec<_> = devices
            .iter()
            .map(DeviceSnapshot::holder_candidate)
            .collect();
        let model =
            openbitfun_product_domains::superagent::project_model_selection(None, &candidates);
        Ok(json!({
            "conversation": {
                "id": id,
                "title": page.summary.title,
                "updatedMs": page.summary.updated_ms,
                "turn": Value::Null,
                "model": model,
                "archived": true,
            },
            "messages": projected,
            "cursor": page.from_seq,
            "hasMore": page.from_seq > page.dropped && !page.messages.is_empty(),
            "cards": cards,
            "history": {
                "state": crate::archive::history_state(page.summary.unsaved, false),
                "unsaved": page.summary.unsaved,
                "missingChunks": page.missing_chunks,
            },
        }))
    }

    async fn conversation(
        &self,
        slot: &Arc<Slot>,
        id: &str,
        cursor: Option<u64>,
        archive: Option<&openbitfun_product_domains::superagent::archive::ArchivedPage>,
    ) -> Result<Value, String> {
        let (conversation, history, outbox_page, pending_since) = {
            let mut state = slot.state.lock().await;
            let conversation = slot
                .conversation(&mut state, id)
                .map_err(|e| e.to_string())?
                .cloned()
                .ok_or_else(|| "not_found: no such conversation".to_string())?;
            let older_wanted = cursor.is_some_and(|c| {
                c < conversation.history_count + conversation.messages.len() as u64
            }) || conversation.history_count > 0;
            let history = if older_wanted
                && slot
                    .store
                    .names()
                    .contains(&crate::slots::history_record(id))
            {
                Some(slot.history(id).map_err(|e| e.to_string())?)
            } else {
                None
            };
            let total = conversation.history_count + conversation.messages.len() as u64;
            let end = cursor.unwrap_or(total).min(total);
            let start = end.saturating_sub(PAGE as u64);
            // What this node still holds of the older part (the outbox).
            let outbox_page: Vec<(u64, Message)> = (start..end.min(conversation.history_count))
                .filter_map(|seq| {
                    crate::archive::held_message(&state.outbox, id, None, seq)
                        .map(|message| (seq, message))
                })
                .collect();
            let pending_since = state.outbox.oldest_pending_ms(id);
            (conversation, history, outbox_page, pending_since)
        };
        let total = conversation.history_count + conversation.messages.len() as u64;
        let end = cursor.unwrap_or(total).min(total);
        let start = end.saturating_sub(PAGE as u64);
        let mut messages: Vec<Message> = Vec::new();
        // The oldest message any build still has.
        let floor = conversation
            .archive
            .dropped
            .max(history.as_ref().map(|h| h.dropped).unwrap_or(0));
        let mut first_kept = end;
        for index in (start.max(floor)..end).rev() {
            let message = if index >= conversation.history_count {
                conversation
                    .messages
                    .get((index - conversation.history_count) as usize)
                    .cloned()
            } else {
                history
                    .as_ref()
                    .and_then(|h| {
                        index
                            .checked_sub(h.dropped)
                            .and_then(|i| h.messages.get(i as usize))
                    })
                    .cloned()
                    .or_else(|| {
                        outbox_page
                            .iter()
                            .find(|(seq, _)| *seq == index)
                            .map(|(_, message)| message.clone())
                    })
                    .or_else(|| crate::archive::page_message(archive, index))
            };
            // The page stays contiguous: it ends at the first gap.
            let Some(message) = message else {
                break;
            };
            messages.push(message);
            first_kept = index;
        }
        messages.reverse();
        let found_any = !messages.is_empty();
        let devices = self.engine.devices(&slot.account_id).await;
        let now = self.engine.now();
        let mut state = slot.state.lock().await;
        let seen_before = state
            .summaries
            .iter()
            .find(|entry| entry.id == id)
            .map(|entry| entry.seen_ms);
        let cards: Vec<Value> = state
            .ledger
            .jobs
            .values()
            .filter(|job| job.conversation_id == id)
            .map(|job| self.engine.job_card_seen(job, Some(&devices), seen_before))
            .collect();
        let job_labels: Vec<(String, String)> = state
            .ledger
            .jobs
            .values()
            .filter(|job| job.conversation_id == id)
            .map(|job| {
                (
                    job.job_id.clone(),
                    job.label.clone().unwrap_or_else(|| job.title.clone()),
                )
            })
            .collect();
        let _ = slot.mark_seen(&mut state, id, now);
        drop(state);
        let mut projected = crate::archive::history_notices(
            conversation.archive.unsaved,
            pending_since,
            self.engine.now(),
        );
        projected.extend(project_messages(messages, &job_labels));
        let messages = projected;
        let candidates: Vec<_> = devices
            .iter()
            .map(DeviceSnapshot::holder_candidate)
            .collect();
        let model = openbitfun_product_domains::superagent::project_model_selection(
            conversation.model_pick().as_ref(),
            &candidates,
        );
        Ok(json!({
            "conversation": {
                "id": conversation.id,
                "title": conversation.title,
                "updatedMs": conversation.updated_ms,
                "turn": conversation.turn.as_ref().map(|turn| json!({ "id": turn.id, "step": turn.step.name(), "rounds": turn.rounds })),
                "model": model,
            },
            "messages": messages,
            "cursor": first_kept,
            // Older messages live on the devices: the entry passes the next
            // page along (`fleet::superagent_archive`).
            "hasMore": found_any && first_kept > floor,
            "cards": cards,
            "history": {
                "state": crate::archive::history_state(conversation.archive.unsaved, pending_since.is_some()),
                "unsaved": conversation.archive.unsaved,
            },
        }))
    }

    /// The conversation list, newest first, paged, with each row's rollup
    /// and the date groups (today, yesterday, the six days before, older) in
    /// the client's IANA `timeZone`, or UTC days without one.
    async fn list_conversations(
        &self,
        slot: &Arc<Slot>,
        request: ListRequest,
    ) -> Result<Value, String> {
        let now = self.engine.now();
        let state = slot.state.lock().await;
        let offset = request.cursor.unwrap_or(0) as usize;
        let limit = request.limit.unwrap_or(LIST_PAGE).clamp(1, 200);
        // The working set with the archived conversations the entry's
        // replica holds (and those whose history still waits here).
        let merged =
            crate::archive::merged_summaries(&state.summaries, &request.archived, &state.outbox);
        let page: Vec<&ConversationSummary> = merged.iter().skip(offset).take(limit).collect();
        let rows: Vec<Value> = page
            .iter()
            .map(|summary| {
                let jobs: Vec<&crate::ledger::JobRecord> = state
                    .ledger
                    .jobs
                    .values()
                    .filter(|job| job.conversation_id == summary.id)
                    .collect();
                let unread = summary.updated_ms > summary.seen_ms
                    || jobs.iter().any(|job| job.updated_ms > summary.seen_ms);
                let rollup = if jobs
                    .iter()
                    .any(|job| job.state == SuperagentJobState::Blocked)
                {
                    "needs_you"
                } else if summary.status == "running"
                    || summary.status == "parked"
                    || jobs.iter().any(|job| job.is_live())
                {
                    "working"
                } else if unread {
                    "unread"
                } else {
                    "none"
                };
                let mut row = serde_json::to_value(summary).unwrap_or(Value::Null);
                row["rollup"] = Value::String(rollup.into());
                row["unread"] = Value::Bool(unread);
                row
            })
            .collect();
        let (zone, [today_start, yesterday_start, week_start]) =
            day_bounds(now, request.time_zone.as_deref());
        let mut groups: Vec<(&str, Vec<Value>)> = Vec::new();
        for (row, summary) in rows.iter().zip(page.iter()) {
            let at = summary.updated_ms;
            let group = if at >= today_start {
                "today"
            } else if at >= yesterday_start {
                "yesterday"
            } else if at >= week_start {
                "week"
            } else {
                "older"
            };
            match groups.last_mut() {
                Some((id, rows)) if *id == group => rows.push(row.clone()),
                _ => groups.push((group, vec![row.clone()])),
            }
        }
        let next = offset + page.len();
        Ok(json!({
            "conversations": rows,
            "groups": groups.into_iter().map(|(id, rows)| json!({ "id": id, "rows": rows })).collect::<Vec<_>>(),
            "nextCursor": (next < merged.len()).then_some(next as u64),
            "timeZone": zone,
        }))
    }

    /// `fleet_digest`: the cloud node's index partition, always a full
    /// snapshot (it is small and bounded): one assistant workspace whose
    /// sessions are the conversations. Prompts stay in their job devices'
    /// partitions.
    async fn digest(&self, slot: &Arc<Slot>) -> Result<Value, String> {
        use openbitfun_product_domains::fleet::{
            FleetDigest, FleetSession, FleetSessionStatus, FleetWorkspace, FleetWorkspaceKind,
            MAX_SESSIONS_PER_DEVICE,
        };
        let state = slot.state.lock().await;
        let device_id = state.meta.device_id.clone();
        let revision = slot
            .digest_revision
            .load(std::sync::atomic::Ordering::Acquire);
        let sessions: Vec<FleetSession> = state
            .summaries
            .iter()
            .take(MAX_SESSIONS_PER_DEVICE)
            .map(|summary| {
                let jobs: Vec<&crate::ledger::JobRecord> = state
                    .ledger
                    .jobs
                    .values()
                    .filter(|job| job.conversation_id == summary.id)
                    .collect();
                let blocked = jobs
                    .iter()
                    .any(|job| job.state == SuperagentJobState::Blocked);
                let unread = summary.updated_ms > summary.seen_ms
                    || jobs.iter().any(|job| job.updated_ms > summary.seen_ms);
                FleetSession {
                    device_id: device_id.clone(),
                    workspace_id: CLOUD_WORKSPACE_ID.into(),
                    session_id: summary.id.clone(),
                    parent_session_id: None,
                    title: summary.title.clone(),
                    agent_type: "superagent".into(),
                    status: if blocked {
                        FleetSessionStatus::Waiting
                    } else {
                        match summary.status.as_str() {
                            "running" | "parked" => FleetSessionStatus::Running,
                            "failed" => FleetSessionStatus::Error,
                            _ => FleetSessionStatus::Idle,
                        }
                    },
                    unread,
                    needs_attention: blocked,
                    last_activity_ms: summary.updated_ms,
                    origin: None,
                }
            })
            .collect();
        // No prompts here: the job's own device publishes each dispatch
        // prompt (`answerRoute: dispatch`, `jobId`) in its partition, and the
        // index pins a partition's prompts to its owner, so a copy here would
        // show twice and route answers to this node. Cards carry
        // `pendingPrompt` for jobs whose device is not indexed yet.
        let prompts: Vec<openbitfun_product_domains::fleet::FleetPrompt> = Vec::new();
        let digest = FleetDigest {
            device_id: device_id.clone(),
            instance_id: slot.instance_id.clone(),
            revision,
            full: true,
            workspaces: vec![FleetWorkspace {
                device_id,
                workspace_id: CLOUD_WORKSPACE_ID.into(),
                name: CLOUD_DEVICE_DISPLAY_NAME.into(),
                root_path: String::new(),
                kind: FleetWorkspaceKind::Assistant,
                ssh_host: None,
                link_state: None,
                is_host_current: true,
                sessions: Vec::new(),
                session_total: state.summaries.len() as u32,
                has_more: state.summaries.len() > MAX_SESSIONS_PER_DEVICE,
            }],
            sessions_truncated: state.summaries.len() > MAX_SESSIONS_PER_DEVICE,
            sessions,
            prompts,
            // The cloud node holds no models of its own.
            models: None,
            removed: Default::default(),
        };
        serde_json::to_value(digest).map_err(|e| e.to_string())
    }

    async fn delete_data(&self, slot: Arc<Slot>, cancel_jobs: bool) -> Result<Value, String> {
        let account_id = slot.account_id.clone();
        let (live, meta) = {
            let state = slot.state.lock().await;
            let live: Vec<String> = state
                .ledger
                .live_jobs()
                .map(|job| job.job_id.clone())
                .collect();
            (live, state.meta.clone())
        };
        let mut cancelled = 0usize;
        if cancel_jobs {
            for job_id in &live {
                let result = self.engine.job_cancel(&slot, job_id).await;
                if result.get("cancelled").and_then(Value::as_bool) == Some(true) {
                    cancelled += 1;
                }
            }
        }
        match self.directory.unregister(&account_id, &meta.device_id, meta.directory_token.as_deref()).await {
            Ok(()) | Err(DirectoryError::NotFound) => {}
            Err(error) => return Err(format!("directory_unavailable: the agent's device row could not be removed ({error}); nothing was deleted")),
        }
        slot.events
            .publish(SUPERAGENT_CARD_CHANGED_EVENT, json!({ "deleted": true }));
        drop(slot);
        self.engine.slots.forget(&account_id);
        self.engine.forget_account(&account_id);
        let shredded = self
            .engine
            .slots
            .store()
            .shred(&account_id)
            .map_err(|e| e.to_string())?;
        log::info!(
            "Superagent data deleted: jobs_cancelled={}, live_jobs={}",
            cancelled,
            live.len()
        );
        Ok(
            json!({ "deleted": shredded, "jobsCancelled": cancelled, "jobsLeftRunning": live.len() - cancelled }),
        )
    }
}

fn account_last_used_ms(meta: &AccountMeta) -> u64 {
    if meta.last_used_ms > 0 {
        meta.last_used_ms
    } else {
        meta.updated_ms.max(meta.created_ms)
    }
}

fn file_mtime_ms(path: &std::path::Path) -> Option<u64> {
    let modified = std::fs::metadata(path).ok()?.modified().ok()?;
    let elapsed = modified.duration_since(std::time::UNIX_EPOCH).ok()?;
    Some(elapsed.as_millis().min(u128::from(u64::MAX)) as u64)
}

fn dir_latest_rec_mtime_ms(dir_path: &std::path::Path) -> Option<u64> {
    let mut latest: Option<u64> = None;
    for entry in std::fs::read_dir(dir_path).ok()?.flatten() {
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("rec") {
            continue;
        }
        if let Some(ms) = file_mtime_ms(&path) {
            latest = Some(latest.map_or(ms, |cur| cur.max(ms)));
        }
    }
    latest
}

/// Checks whether a non-resident stored account has live jobs, pending archive
/// chunks, or an unfinished turn without inserting it into the slot cache.
fn stored_account_is_busy(account: &crate::store::AccountStore) -> bool {
    let ledger_busy = match account.read_json::<crate::ledger::Ledger>(crate::slots::LEDGER_RECORD)
    {
        Ok(Some(ledger)) => ledger.has_live_jobs(),
        Ok(None) => false,
        // Unreadable record: keep the account rather than shredding blindly.
        Err(_) => return true,
    };
    if ledger_busy {
        return true;
    }
    let outbox_busy =
        match account.read_json::<crate::archive::Outbox>(crate::archive::OUTBOX_RECORD) {
            Ok(Some(outbox)) => !outbox.chunks.is_empty(),
            Ok(None) => false,
            Err(_) => return true,
        };
    if outbox_busy {
        return true;
    }
    match account.read_json::<Vec<ConversationSummary>>(crate::slots::CONVERSATIONS_RECORD) {
        Ok(Some(summaries)) => summaries
            .iter()
            .any(|summary| summary.status == "running" || summary.status == "parked"),
        Ok(None) => false,
        Err(_) => true,
    }
}

/// `fleet_replay`: events of this slot load after `afterSeq`. Another
/// instance (the slot reloaded) or a cursor older than the ring answers
/// `historyGone`.
fn replay(slot: &Slot, request: &openbitfun_product_domains::fleet::FleetReplayRequest) -> Value {
    use openbitfun_product_domains::fleet::{FleetReplayEvent, FleetReplayResponse};
    let gone = |instance: &str| FleetReplayResponse {
        instance_id: instance.to_string(),
        events: Vec::new(),
        history_gone: true,
    };
    if request.instance_id != slot.instance_id {
        return serde_json::to_value(gone(&slot.instance_id)).unwrap_or(Value::Null);
    }
    let max = (request.max.max(1) as usize).min(4096);
    let batch = slot.events.events_after(request.after_seq, max);
    let gap = batch.events.first().is_some_and(|first| {
        first.event == openbitfun_obp::EVENTS_DROPPED_EVENT || first.seq > request.after_seq + 1
    }) || batch.last_seq < request.after_seq;
    if gap {
        return serde_json::to_value(gone(&slot.instance_id)).unwrap_or(Value::Null);
    }
    serde_json::to_value(FleetReplayResponse {
        instance_id: slot.instance_id.clone(),
        events: batch
            .events
            .iter()
            .map(|event| FleetReplayEvent {
                seq: event.seq,
                event: event.event.clone(),
                payload: event.payload.clone(),
            })
            .collect(),
        history_gone: false,
    })
    .unwrap_or(Value::Null)
}

/// What a frontend draws: user, assistant and card messages; a dispatch
/// becomes a `jobs` message with its job ids (where the cards render); other
/// tool messages are not drawn. Assistant messages cite the jobs they name.
fn project_messages(messages: Vec<Message>, jobs: &[(String, String)]) -> Vec<Value> {
    messages
        .into_iter()
        .filter_map(|message| match message.role {
            Role::Tool => {
                let result: Value = serde_json::from_str(&message.text).unwrap_or(Value::Null);
                let job_ids: Vec<String> = result
                    .get("jobId")
                    .and_then(Value::as_str)
                    .filter(|_| message.tool_name.as_deref() == Some("fleet_dispatch"))
                    .map(|id| vec![id.to_string()])
                    .unwrap_or_default();
                (!job_ids.is_empty()).then(|| {
                    json!({
                        "id": message.id,
                        "role": "jobs",
                        "jobIds": job_ids,
                        "turnId": message.turn_id,
                        "atMs": message.at_ms,
                    })
                })
            }
            Role::Assistant => {
                let mut value = serde_json::to_value(&message).unwrap_or(Value::Null);
                if let Some(object) = value.as_object_mut() {
                    object.remove("toolCalls");
                }
                if message.text.trim().is_empty() {
                    return None;
                }
                let citations: Vec<Value> = jobs
                    .iter()
                    .filter(|(job_id, _)| message.text.contains(job_id.as_str()))
                    .map(|(job_id, label)| json!({ "jobId": job_id, "label": label }))
                    .collect();
                if !citations.is_empty() {
                    value["citations"] = Value::Array(citations);
                }
                Some(value)
            }
            Role::Unknown => None,
            _ => serde_json::to_value(&message).ok(),
        })
        .collect()
}

fn decode_secret(value: &str) -> Result<[u8; 32], String> {
    BASE64
        .decode(value)
        .ok()
        .and_then(|bytes| bytes.try_into().ok())
        .ok_or_else(|| "the stored node key is unreadable".to_string())
}

pub fn node_secret(meta: &AccountMeta) -> Result<[u8; 32], String> {
    decode_secret(&meta.device_secret)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn day_bounds_follow_the_client_zone() {
        // 2026-11-21 01:00 in Shanghai is 2026-11-20 17:00 UTC.
        let now = 1_795_194_000_000u64; // 2026-11-20T17:00:00Z
        let (zone, [today, yesterday, week]) = day_bounds(now, Some("Asia/Shanghai"));
        assert_eq!(zone, "Asia/Shanghai");
        assert_eq!(today, 1_795_190_400_000); // 2026-11-21T00:00+08:00
        assert_eq!(today - yesterday, 24 * 3600 * 1000);
        assert_eq!(today - week, 6 * 24 * 3600 * 1000);
        let (zone, [utc_today, ..]) = day_bounds(now, None);
        assert_eq!(zone, "UTC");
        assert_eq!(utc_today, 1_795_132_800_000); // 2026-11-20T00:00Z
        assert_eq!(day_bounds(now, Some("Not/AZone")).0, "UTC");
        assert_eq!(composer_copy(Some("zh_CN")).0, "zh-CN");
        assert_eq!(composer_copy(Some("zh-Hant")).0, "zh-TW");
        assert_eq!(composer_copy(None).0, "en-US");
        assert_eq!(composer_copy(Some("fr-FR")).0, "en-US");
        assert_eq!(composer_copy(Some("zh-CN")).1.len(), 3);
    }

    #[test]
    fn every_catalog_has_the_same_keys_and_no_empty_values() {
        let keys = |text: &str| {
            let map: std::collections::BTreeMap<String, String> =
                serde_json::from_str(text).unwrap();
            assert!(map.values().all(|v| !v.trim().is_empty()));
            map.into_keys().collect::<Vec<_>>()
        };
        let reference = keys(CATALOGS[0].1);
        for (id, text) in CATALOGS {
            assert_eq!(keys(text), reference, "{id}");
        }
        // The contract lists this surface with these locales.
        let contract: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../shared/i18n/contract/locales.json"
        ))
        .unwrap();
        let order: Vec<&str> = contract["surfaceOrders"]["superagent"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|v| v.as_str())
            .collect();
        assert_eq!(order, CATALOGS.map(|(id, _)| id).to_vec());
        for locale in contract["locales"].as_array().unwrap() {
            let id = locale["id"].as_str().unwrap();
            for alias in locale["aliases"].as_array().unwrap() {
                assert_eq!(resolve_locale(alias.as_str()), id, "{alias}");
            }
        }
    }

    struct TestClock(std::sync::atomic::AtomicU64);

    impl crate::engine::Clock for TestClock {
        fn now_ms(&self) -> u64 {
            self.0.load(std::sync::atomic::Ordering::SeqCst)
        }
    }

    struct EmptyRpc;

    impl crate::device::DeviceRpc for EmptyRpc {
        fn devices<'a>(
            &'a self,
            _account_id: &'a str,
        ) -> crate::device::BoxFuture<'a, Result<Vec<DeviceSnapshot>, crate::device::RpcError>>
        {
            Box::pin(async { Ok(Vec::new()) })
        }

        fn call<'a>(
            &'a self,
            _account_id: &'a str,
            _device_id: &'a str,
            _command: &'a str,
            _args: Value,
        ) -> crate::device::BoxFuture<'a, Result<Value, crate::device::RpcError>> {
            Box::pin(async { Ok(Value::Null) })
        }
    }

    struct EmptyDirectory;

    impl Directory for EmptyDirectory {
        fn register<'a>(
            &'a self,
            _account_id: &'a str,
            device_id: &'a str,
            _name: &'a str,
            _public_key: &'a str,
        ) -> crate::device::BoxFuture<'a, Result<String, DirectoryError>> {
            let token = format!("tok-{device_id}");
            Box::pin(async move { Ok(token) })
        }

        fn unregister<'a>(
            &'a self,
            _account_id: &'a str,
            _device_id: &'a str,
            _token: Option<&'a str>,
        ) -> crate::device::BoxFuture<'a, Result<(), DirectoryError>> {
            Box::pin(async { Ok(()) })
        }

        fn devices<'a>(
            &'a self,
            _token: &'a str,
        ) -> crate::device::BoxFuture<
            'a,
            Result<Vec<crate::directory::DirectoryDevice>, DirectoryError>,
        > {
            Box::pin(async { Ok(Vec::new()) })
        }

        fn device_key<'a>(
            &'a self,
            _token: &'a str,
            _device_id: &'a str,
        ) -> crate::device::BoxFuture<'a, Result<(String, Option<String>), DirectoryError>>
        {
            Box::pin(async { Err(DirectoryError::NotFound) })
        }
    }

    #[tokio::test]
    async fn sweep_accounts_skips_recent_non_resident_and_shreds_expired_without_loading() {
        let dir = tempfile::tempdir().unwrap();
        let store = Arc::new(crate::store::Store::open(dir.path(), [17u8; 32]).unwrap());
        let slots = Arc::new(crate::slots::Slots::new(
            store,
            crate::slots::SlotLimits {
                idle_unload_ms: 1000,
                ..crate::slots::SlotLimits::default()
            },
        ));
        let start = openbitfun_obp::now_ms();
        let clock = Arc::new(TestClock(std::sync::atomic::AtomicU64::new(start)));
        let rpc: Arc<dyn crate::device::DeviceRpc> = Arc::new(EmptyRpc);
        let engine = Engine::new(
            Arc::clone(&slots),
            Arc::clone(&rpc),
            Arc::new(crate::model::RelayModel::new(rpc)),
            Arc::clone(&clock) as Arc<dyn crate::engine::Clock>,
            crate::engine::EngineConfig::default(),
        );
        let service = Service::new(engine, Arc::new(EmptyDirectory));
        let slot = service.ensure("acct-idle").await.unwrap();
        drop(slot);
        // Unload so the account is on disk only (not resident).
        clock
            .0
            .fetch_add(60 * 60 * 1000, std::sync::atomic::Ordering::SeqCst);
        assert_eq!(
            slots.unload_idle(clock.0.load(std::sync::atomic::Ordering::SeqCst)),
            1
        );
        assert_eq!(slots.resident_count(), 0);
        // Hourly sweep while within 180d TTL must NOT load the non-resident account.
        assert!(service.sweep_accounts().await.is_empty());
        assert_eq!(
            slots.resident_count(),
            0,
            "sweep_accounts must not load non-resident idle accounts"
        );
        // Advance past 180d TTL: non-resident idle account is shredded without loading into cache.
        clock
            .0
            .fetch_add(ACCOUNT_TTL_MS, std::sync::atomic::Ordering::SeqCst);
        let shredded = service.sweep_accounts().await;
        assert_eq!(shredded, vec!["acct-idle".to_string()]);
        assert_eq!(slots.resident_count(), 0);
        assert!(!slots.store().exists("acct-idle"));
    }

    #[tokio::test]
    async fn replay_marks_history_gone_on_exact_drop_boundary_and_future_cursor() {
        let dir = tempfile::tempdir().unwrap();
        let store = Arc::new(crate::store::Store::open(dir.path(), [19u8; 32]).unwrap());
        let slots = crate::slots::Slots::new(
            store,
            crate::slots::SlotLimits {
                event_ring: 4,
                ..crate::slots::SlotLimits::default()
            },
        );
        let slot = slots
            .load(
                "acct-replay",
                1000,
                Some(AccountMeta {
                    version: 1,
                    account_id: "acct-replay".into(),
                    device_id: "cloud-r".into(),
                    enabled: true,
                    ..AccountMeta::default()
                }),
            )
            .await
            .unwrap();
        // Publish 10 events into a ring of size 4 -> ring holds seqs 7, 8, 9, 10 (oldest = 7).
        for n in 1..=10 {
            slot.events.publish("test://evt", json!({ "n": n }));
        }
        // after_seq = oldest - 2 (= 5): synthetic EVENTS_DROPPED_EVENT has seq 6 == after_seq + 1.
        let at_boundary = replay(
            &slot,
            &openbitfun_product_domains::fleet::FleetReplayRequest {
                instance_id: slot.instance_id.clone(),
                after_seq: 5,
                max: 100,
            },
        );
        assert_eq!(at_boundary["historyGone"], true, "{at_boundary}");
        assert!(at_boundary["events"].as_array().unwrap().is_empty());

        // after_seq > last_seq (= 99): cursor is from the future/invalid -> historyGone.
        let future = replay(
            &slot,
            &openbitfun_product_domains::fleet::FleetReplayRequest {
                instance_id: slot.instance_id.clone(),
                after_seq: 99,
                max: 100,
            },
        );
        assert_eq!(future["historyGone"], true, "{future}");

        // after_seq = oldest - 1 (= 6): contiguous -> returns 7..=10.
        let contiguous = replay(
            &slot,
            &openbitfun_product_domains::fleet::FleetReplayRequest {
                instance_id: slot.instance_id.clone(),
                after_seq: 6,
                max: 100,
            },
        );
        assert_eq!(contiguous["historyGone"], false, "{contiguous}");
        assert_eq!(contiguous["events"].as_array().unwrap().len(), 4);
    }
}

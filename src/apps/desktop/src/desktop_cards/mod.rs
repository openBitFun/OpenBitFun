//! Desktop cards: small live cards an agent leaves on a device.
//!
//! Core owns the DesktopCard tool contract. This host owns the card store
//! (definitions behind `store::CardDefinitionStore`, local display state
//! apart), data-source refresh, countdown notifications, and the
//! `app.ai_experience.enable_desktop_cards` gate.
//!
//! The host draws no window. A card is a fact of the device that created it:
//! every client lists it (`desktop_card_list`) and follows
//! `desktop-card://changed`; the native NSH desktop shell of this device opens
//! one floating window per visible card and reports its geometry back with
//! `desktop_card_set_bounds`. Phones, browsers and other desktops render the
//! same card inline and act on it through the same commands, proxied here.

pub mod desktop_card_api;
mod fetch_gate;
mod refresh;
// wave24-replica: card definitions on the account replica.
pub(crate) mod replica;
mod store;

use std::collections::HashMap;
use std::future::Future;
use std::path::Path;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, Weak};
use std::time::Duration;

use openbitfun_core::agentic::tools::desktop_card_host::{
    clamp_size, set_desktop_card_handler, DesktopCardDataSnapshot, DesktopCardDataSource,
    DesktopCardDataSourceKind, DesktopCardDraft, DesktopCardHostRequest, DesktopCardOrigin,
    DesktopCardPatch, DesktopCardPosition, DesktopCardRecord, DesktopCardSize, DesktopCardTemplate,
    DesktopCardTemplateKind, DESKTOP_CARD_MAX_CARDS,
};
use openbitfun_core::infrastructure::try_get_path_manager_arc;
use openbitfun_core::service::config::{subscribe_config_updates, ConfigUpdateEvent};
use serde::Serialize;
use serde_json::{json, Map, Value};
use tokio::task::JoinHandle;

use crate::host::HostHandle;
use fetch_gate::FetchGate;
use store::CardStore;

pub const DESKTOP_CARD_CHANGED_EVENT: &str = "desktop-card://changed";
pub const DESKTOP_CARD_STATE_EVENT: &str = "desktop-card://state";
const DESKTOP_CARDS_CONFIG_PATH: &str = "app.ai_experience.enable_desktop_cards";
const GEOMETRY_SAVE_DELAY: Duration = Duration::from_millis(600);
/// How long create/update wait for the first fetch so the tool result can
/// report real data; slower sources keep loading in the background.
const FIRST_FETCH_WAIT: Duration = Duration::from_secs(30);
/// Extension-map keys owned by this host (additive; older hosts keep them).
/// They are device-local display state (`store::LOCAL_EXTRA_KEYS`).
pub(crate) const DESKTOP_PINNED_KEY: &str = "desktopPinned";
/// Always-on-top mode in effect before pinning, restored on unpin.
pub(crate) const PIN_RESTORE_ON_TOP_KEY: &str = "desktopPinRestoreAlwaysOnTop";
/// Set when the shell could not keep a card on the desktop layer; cleared by
/// the next explicit stacking change.
pub(crate) const PIN_FAILURE_KEY: &str = "desktopPinFailure";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopCardChangedPayload {
    card_id: String,
    card: Option<DesktopCardRecord>,
    deleted: bool,
    /// The card asks to come to the front (a countdown finished). Additive.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    attention: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopCardStatePayload {
    enabled: bool,
}

/// Where the service sends its events and notifications: the running host,
/// or nothing (tests, and a backend started without a host).
trait CardSink: Send + Sync {
    fn emit(&self, event: &str, payload: Value);
    fn notify(&self, title: String, body: String);
}

struct HostSink(HostHandle);

impl CardSink for HostSink {
    fn emit(&self, event: &str, payload: Value) {
        if let Err(error) = self.0.emit(event, payload) {
            log::warn!(
                "Failed to emit desktop card event: event={}, error={}",
                event,
                error
            );
        }
    }

    fn notify(&self, title: String, body: String) {
        let host = Arc::clone(self.0.native());
        tokio::spawn(async move {
            if let Err(error) = host
                .shell_request(
                    "notification.show",
                    json!({ "title": title, "body": body }),
                    crate::host::shell::SHELL_REQUEST_TIMEOUT,
                )
                .await
            {
                log::warn!("Failed to send desktop card notification: error={}", error);
            }
        });
    }
}

#[derive(Default)]
struct CardTimers {
    refresh: Option<(String, JoinHandle<()>)>,
    countdown: Option<(i64, JoinHandle<()>)>,
}

impl CardTimers {
    fn abort_all(&mut self) {
        if let Some((_, handle)) = self.refresh.take() {
            handle.abort();
        }
        if let Some((_, handle)) = self.countdown.take() {
            handle.abort();
        }
    }
}

pub struct DesktopCards {
    sink: Box<dyn CardSink>,
    store: tokio::sync::Mutex<CardStore>,
    enabled: AtomicBool,
    timers: Mutex<HashMap<String, CardTimers>>,
    fetch_gate: FetchGate,
    geometry_save_pending: AtomicBool,
    self_ref: Weak<DesktopCards>,
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn not_found(card_id: &str) -> String {
    format!("Desktop card not found: {card_id}")
}

fn new_card_id() -> String {
    let id = uuid::Uuid::new_v4().simple().to_string();
    format!("card-{}", &id[..12])
}

fn source_fingerprint(source: &DesktopCardDataSourceKind) -> String {
    serde_json::to_string(source).unwrap_or_default()
}

fn pending_countdown(card: &DesktopCardRecord) -> Option<i64> {
    match card.template.known()? {
        DesktopCardTemplateKind::Countdown {
            target_at_ms,
            notify: true,
            notified_at_ms: None,
            ..
        } => Some(*target_at_ms),
        _ => None,
    }
}

/// The card's window size: its own, else its template's default.
pub(crate) fn card_size(card: &DesktopCardRecord) -> DesktopCardSize {
    let size = card.size.unwrap_or_else(|| {
        card.template
            .known()
            .map(|template| template.default_size())
            .unwrap_or(DesktopCardSize {
                width: 280.0,
                height: 180.0,
            })
    });
    clamp_size(size)
}

/// Desktop-only presentation metadata lives in the record's forward-compatible
/// extension map, not in the portable Agent tool's configuration contract.
pub(crate) fn desktop_pinned(card: &DesktopCardRecord) -> bool {
    !card.always_on_top
        && card
            .extra
            .get(DESKTOP_PINNED_KEY)
            .and_then(Value::as_bool)
            .unwrap_or(false)
}

async fn due_notification_body(message: Option<&str>) -> String {
    if let Some(message) = message.filter(|message| !message.trim().is_empty()) {
        return message.to_string();
    }
    let language =
        match openbitfun_core::service::config::global::GlobalConfigManager::get_service().await {
            Ok(service) => service
                .get_config::<String>(Some("app.language"))
                .await
                .unwrap_or_default(),
            Err(_) => String::new(),
        };
    match language.as_str() {
        "zh-CN" => "倒计时结束".to_string(),
        "zh-TW" => "倒數計時結束".to_string(),
        _ => "Time's up".to_string(),
    }
}

impl DesktopCards {
    fn new(sink: Box<dyn CardSink>, store: CardStore) -> Arc<Self> {
        Arc::new_cyclic(|self_ref| Self {
            sink,
            store: tokio::sync::Mutex::new(store),
            enabled: AtomicBool::new(false),
            timers: Mutex::new(HashMap::new()),
            fetch_gate: FetchGate::default(),
            geometry_save_pending: AtomicBool::new(false),
            self_ref: self_ref.clone(),
        })
    }

    fn arc(&self) -> Option<Arc<Self>> {
        self.self_ref.upgrade()
    }

    pub fn is_enabled(&self) -> bool {
        self.enabled.load(Ordering::SeqCst)
    }

    fn emit_changed(
        &self,
        card_id: &str,
        card: Option<&DesktopCardRecord>,
        deleted: bool,
        attention: bool,
    ) {
        let payload = DesktopCardChangedPayload {
            card_id: card_id.to_string(),
            card: card.cloned(),
            deleted,
            attention,
        };
        match serde_json::to_value(payload) {
            Ok(payload) => self.sink.emit(DESKTOP_CARD_CHANGED_EVENT, payload),
            Err(error) => log::warn!(
                "Failed to serialize desktop card change: card_id={}, error={}",
                card_id,
                error
            ),
        }
    }

    fn save_locked(store: &mut CardStore) -> Result<(), String> {
        store.save().map_err(|error| {
            log::warn!("Failed to save desktop cards: error={}", error);
            error
        })
    }

    pub async fn list(&self) -> Value {
        let store = self.store.lock().await;
        json!({
            "enabled": self.is_enabled(),
            "cards": store.snapshot(),
        })
    }

    pub async fn get(&self, card_id: &str) -> Result<DesktopCardRecord, String> {
        self.store
            .lock()
            .await
            .get(card_id)
            .ok_or_else(|| not_found(card_id))
    }

    fn require_enabled(&self) -> Result<(), String> {
        if self.is_enabled() {
            Ok(())
        } else {
            Err("Desktop cards are turned off in OpenBitFun settings.".to_string())
        }
    }

    /// Reads, changes and stores one card under the store lock.
    async fn modify<R>(
        &self,
        card_id: &str,
        change: impl FnOnce(&mut DesktopCardRecord) -> Result<R, String>,
    ) -> Result<(DesktopCardRecord, R), String> {
        let mut store = self.store.lock().await;
        let mut card = store.get(card_id).ok_or_else(|| not_found(card_id))?;
        let result = change(&mut card)?;
        store.put(card.clone());
        Self::save_locked(&mut store)?;
        Ok((card, result))
    }

    pub async fn create(
        &self,
        draft: DesktopCardDraft,
        origin: DesktopCardOrigin,
    ) -> Result<DesktopCardRecord, String> {
        self.require_enabled()?;
        let card = {
            let mut store = self.store.lock().await;
            if store.card_count() >= DESKTOP_CARD_MAX_CARDS {
                return Err(format!(
                    "There are already {DESKTOP_CARD_MAX_CARDS} desktop cards. Delete cards that are no longer useful before creating more."
                ));
            }
            let now = now_ms();
            let card = DesktopCardRecord {
                id: new_card_id(),
                title: draft.title,
                subtitle: draft.subtitle,
                icon: draft.icon,
                accent: draft.accent,
                template: DesktopCardTemplate::Known(draft.template),
                data: draft.data,
                data_source: draft.data_source.map(DesktopCardDataSource::Known),
                link: draft.link,
                size: draft.size,
                position: None,
                visible: true,
                always_on_top: draft.always_on_top,
                origin,
                created_at_ms: now,
                updated_at_ms: now,
                last_data: None,
                extra: Map::new(),
            };
            store.put(card.clone());
            Self::save_locked(&mut store)?;
            card
        };
        log::info!(
            "Desktop card created: card_id={}, template={}",
            card.id,
            card.template.kind()
        );
        self.sync_card_runtime(&card);
        self.emit_changed(&card.id, Some(&card), false, false);
        Ok(self.await_first_fetch(card).await)
    }

    /// Waits (bounded) for the first fetch of a shown card whose source has no
    /// data yet. The refresh loop usually runs it; the fetch gate makes this
    /// reuse that result instead of starting a second command.
    async fn await_first_fetch(&self, card: DesktopCardRecord) -> DesktopCardRecord {
        if card.last_data.is_some() || !card.visible || !self.is_enabled() {
            return card;
        }
        let Some(source) = card
            .data_source
            .as_ref()
            .and_then(DesktopCardDataSource::known)
            .cloned()
        else {
            return card;
        };
        let Some(service) = self.arc() else {
            return card;
        };
        let card_id = card.id.clone();
        // Spawned so that giving up on the wait never kills the approved
        // command. Any stored data for the current source is a valid first
        // result, because changing the source clears the snapshot.
        let fetch =
            tokio::spawn(async move { service.run_fetch(&card_id, &source, Some(i64::MIN)).await });
        match tokio::time::timeout(FIRST_FETCH_WAIT, fetch).await {
            Ok(Ok(Some(fetched))) => fetched,
            Ok(_) => self.get(&card.id).await.unwrap_or(card),
            Err(_) => {
                log::debug!(
                    "Desktop card first fetch still running after wait: card_id={}",
                    card.id
                );
                self.get(&card.id).await.unwrap_or(card)
            }
        }
    }

    pub async fn update(
        &self,
        card_id: &str,
        patch: DesktopCardPatch,
    ) -> Result<DesktopCardRecord, String> {
        if let Some(always_on_top) = patch.always_on_top {
            self.set_stacking(card_id, always_on_top, None).await?;
        }
        let (card, ()) = self
            .modify(card_id, |card| {
                patch.apply_to(card);
                if let Some(size) = card.size {
                    card.size = Some(clamp_size(size));
                }
                card.updated_at_ms = now_ms();
                Ok(())
            })
            .await?;
        self.sync_card_runtime(&card);
        self.emit_changed(card_id, Some(&card), false, false);
        Ok(self.await_first_fetch(card).await)
    }

    pub async fn set_visible(
        &self,
        card_id: &str,
        visible: bool,
    ) -> Result<DesktopCardRecord, String> {
        let (card, ()) = self
            .modify(card_id, |card| {
                card.visible = visible;
                Ok(())
            })
            .await?;
        self.sync_card_runtime(&card);
        self.emit_changed(card_id, Some(&card), false, false);
        Ok(card)
    }

    pub async fn delete(&self, card_id: &str) -> Result<(), String> {
        {
            let mut store = self.store.lock().await;
            store.remove(card_id).ok_or_else(|| not_found(card_id))?;
            Self::save_locked(&mut store)?;
        }
        self.stop_card_runtime(card_id);
        log::info!("Desktop card deleted: card_id={}", card_id);
        self.emit_changed(card_id, None, true, false);
        Ok(())
    }

    pub async fn refresh_now(&self, card_id: &str) -> Result<DesktopCardRecord, String> {
        let source = {
            let store = self.store.lock().await;
            let card = store.get(card_id).ok_or_else(|| not_found(card_id))?;
            card.data_source
                .as_ref()
                .and_then(DesktopCardDataSource::known)
                .cloned()
        };
        match source {
            Some(source) => self
                .run_fetch(card_id, &source, Some(now_ms()))
                .await
                .ok_or_else(|| not_found(card_id)),
            None => self.get(card_id).await,
        }
    }

    pub async fn set_checklist_item(
        &self,
        card_id: &str,
        item_id: &str,
        done: bool,
    ) -> Result<DesktopCardRecord, String> {
        let (card, ()) = self
            .modify(card_id, |card| {
                let DesktopCardTemplate::Known(DesktopCardTemplateKind::Checklist { items }) =
                    &mut card.template
                else {
                    return Err(format!("Desktop card {card_id} is not a checklist"));
                };
                let item = items
                    .iter_mut()
                    .find(|item| item.id == item_id)
                    .ok_or_else(|| format!("Checklist item not found: {item_id}"))?;
                item.done = done;
                card.updated_at_ms = now_ms();
                Ok(())
            })
            .await?;
        self.emit_changed(card_id, Some(&card), false, false);
        Ok(card)
    }

    pub async fn set_stacking(
        &self,
        card_id: &str,
        always_on_top: bool,
        desktop_pinned: Option<bool>,
    ) -> Result<DesktopCardRecord, String> {
        if desktop_pinned == Some(true) && !desktop_card_api::desktop_pinning_supported() {
            return Err(
                "Pinning cards to the desktop is not supported on this device.".to_string(),
            );
        }
        if desktop_pinned == Some(true) && always_on_top {
            return Err(
                "Desktop pinning and global always-on-top are mutually exclusive.".to_string(),
            );
        }
        let (card, ()) = self
            .modify(card_id, |card| {
                apply_stacking_record(card, always_on_top, desktop_pinned);
                Ok(())
            })
            .await?;
        self.emit_changed(card_id, Some(&card), false, false);
        Ok(card)
    }

    /// Stores the geometry the shell's card window settled at. Saved after a
    /// short delay so a drag does not rewrite the file on every step; no event
    /// is sent, since the window that moved is the source.
    pub async fn set_bounds(
        &self,
        card_id: &str,
        position: Option<DesktopCardPosition>,
        size: Option<DesktopCardSize>,
    ) -> Result<(), String> {
        let changed = {
            let mut store = self.store.lock().await;
            let mut card = store.get(card_id).ok_or_else(|| not_found(card_id))?;
            if !apply_geometry(&mut card, position, size) {
                return Ok(());
            }
            store.put(card);
            true
        };
        if changed {
            self.schedule_geometry_save();
        }
        Ok(())
    }

    fn schedule_geometry_save(&self) {
        let Some(service) = self.arc() else {
            return;
        };
        if service.geometry_save_pending.swap(true, Ordering::SeqCst) {
            return;
        }
        tokio::spawn(async move {
            tokio::time::sleep(GEOMETRY_SAVE_DELAY).await;
            service.geometry_save_pending.store(false, Ordering::SeqCst);
            let mut store = service.store.lock().await;
            let _ = Self::save_locked(&mut store);
        });
    }

    pub async fn set_enabled(&self, enabled: bool) {
        let previous = self.enabled.swap(enabled, Ordering::SeqCst);
        if previous == enabled && enabled {
            return;
        }
        log::info!("Desktop cards availability applied: enabled={}", enabled);
        let cards = self.store.lock().await.snapshot();
        for card in &cards {
            self.sync_card_runtime(card);
        }
        match serde_json::to_value(DesktopCardStatePayload { enabled }) {
            Ok(payload) => self.sink.emit(DESKTOP_CARD_STATE_EVENT, payload),
            Err(error) => log::warn!("Failed to serialize desktop card state: error={}", error),
        }
    }

    /// Reconciles the timers of one card with the enable gate and its
    /// visibility. Windows are the shell's: it follows the change events.
    fn sync_card_runtime(&self, card: &DesktopCardRecord) {
        let enabled = self.is_enabled();
        let active = enabled && card.visible;
        let source = card
            .data_source
            .as_ref()
            .and_then(DesktopCardDataSource::known)
            .filter(|_| active)
            .cloned();
        let countdown = pending_countdown(card).filter(|_| enabled);
        let Some(service) = self.arc() else {
            return;
        };
        let mut timers = match self.timers.lock() {
            Ok(timers) => timers,
            Err(poisoned) => poisoned.into_inner(),
        };
        let entry = timers.entry(card.id.clone()).or_default();

        match source {
            Some(source) => {
                let fingerprint = source_fingerprint(&source);
                let current = entry.refresh.as_ref().is_some_and(|(existing, handle)| {
                    *existing == fingerprint && !handle.is_finished()
                });
                if !current {
                    if let Some((_, handle)) = entry.refresh.take() {
                        handle.abort();
                    }
                    let initial_delay = initial_refresh_delay(card, &source);
                    let handle = tokio::spawn(refresh_loop(
                        Arc::downgrade(&service),
                        card.id.clone(),
                        source,
                        initial_delay,
                        now_ms(),
                    ));
                    entry.refresh = Some((fingerprint, handle));
                }
            }
            None => {
                if let Some((_, handle)) = entry.refresh.take() {
                    handle.abort();
                }
            }
        }

        match countdown {
            Some(target_at_ms) => {
                let current = entry.countdown.as_ref().is_some_and(|(existing, handle)| {
                    *existing == target_at_ms && !handle.is_finished()
                });
                if !current {
                    if let Some((_, handle)) = entry.countdown.take() {
                        handle.abort();
                    }
                    let handle = tokio::spawn(countdown_task(
                        Arc::downgrade(&service),
                        card.id.clone(),
                        target_at_ms,
                    ));
                    entry.countdown = Some((target_at_ms, handle));
                }
            }
            None => {
                if let Some((_, handle)) = entry.countdown.take() {
                    handle.abort();
                }
            }
        }
    }

    fn stop_card_runtime(&self, card_id: &str) {
        let mut timers = match self.timers.lock() {
            Ok(timers) => timers,
            Err(poisoned) => poisoned.into_inner(),
        };
        if let Some(mut entry) = timers.remove(card_id) {
            entry.abort_all();
        }
        drop(timers);
        self.fetch_gate.forget(card_id);
    }

    /// Fetches the source and stores the snapshot. A stored fetch of the same
    /// source that started at or after `not_before_ms` (typically one that ran
    /// while this call waited for its turn) is reused instead of repeated.
    async fn run_fetch(
        &self,
        card_id: &str,
        source: &DesktopCardDataSourceKind,
        not_before_ms: Option<i64>,
    ) -> Option<DesktopCardRecord> {
        let mut turn = self.fetch_gate.turn(card_id).await;
        {
            let store = self.store.lock().await;
            let Some(card) = store.get(card_id) else {
                drop(store);
                self.fetch_gate.forget(card_id);
                return None;
            };
            let started_since_request =
                not_before_ms.is_some_and(|not_before| turn.started_since(not_before));
            if can_reuse_fetch(&card, source, started_since_request) {
                return Some(card);
            }
        }
        let started_at_ms = now_ms();
        let result = refresh::fetch(source).await;
        let card = {
            let mut store = self.store.lock().await;
            let Some(mut card) = store.get(card_id) else {
                drop(store);
                self.fetch_gate.forget(card_id);
                return None;
            };
            if !fetches_source(&card, source) {
                return Some(card);
            }
            let previous = card
                .last_data
                .as_ref()
                .map(|snapshot| snapshot.value.clone())
                .unwrap_or(Value::Null);
            card.last_data = Some(match result {
                Ok(output) => DesktopCardDataSnapshot {
                    fetched_at_ms: now_ms(),
                    value: output.value,
                    error: None,
                    warning: output.warning,
                },
                Err(error) => {
                    log::debug!(
                        "Desktop card data refresh failed: card_id={}, error={}",
                        card_id,
                        error
                    );
                    DesktopCardDataSnapshot {
                        fetched_at_ms: now_ms(),
                        value: previous,
                        error: Some(error),
                        warning: None,
                    }
                }
            });
            store.put(card.clone());
            let _ = Self::save_locked(&mut store);
            card
        };
        turn.record_stored_fetch(started_at_ms);
        drop(turn);
        self.emit_changed(card_id, Some(&card), false, false);
        Some(card)
    }

    async fn fire_countdown(&self, card_id: &str, target_at_ms: i64) {
        let fired = self
            .modify(card_id, |card| {
                let DesktopCardTemplate::Known(DesktopCardTemplateKind::Countdown {
                    target_at_ms: current_target,
                    notified_at_ms,
                    notify: true,
                    ..
                }) = &mut card.template
                else {
                    return Ok(false);
                };
                if *current_target != target_at_ms || notified_at_ms.is_some() {
                    return Ok(false);
                }
                *notified_at_ms = Some(now_ms());
                card.visible = true;
                Ok(true)
            })
            .await;
        let card = match fired {
            Ok((card, true)) => card,
            _ => return,
        };
        log::info!("Desktop card countdown finished: card_id={}", card_id);
        let message = match card.template.known() {
            Some(DesktopCardTemplateKind::Countdown { message, .. }) => message.clone(),
            _ => None,
        };
        let body = due_notification_body(message.as_deref()).await;
        self.sink.notify(card.title.clone(), body);
        self.sync_card_runtime(&card);
        self.emit_changed(card_id, Some(&card), false, true);
    }

    async fn handle_tool_request(&self, request: DesktopCardHostRequest) -> Result<Value, String> {
        // DesktopCardTool checks the submitting turn's control surface before
        // invoking this host. Attached peers are event subscribers, not proof
        // that this particular request came from a remote user.
        let action = request.action();
        let result = match request {
            DesktopCardHostRequest::Create { draft, origin } => {
                json!({ "card": self.create(draft, origin).await? })
            }
            DesktopCardHostRequest::Update { card_id, patch } => {
                json!({ "card": self.update(&card_id, patch).await? })
            }
            DesktopCardHostRequest::List => self.list().await,
            DesktopCardHostRequest::Get { card_id } => {
                json!({ "card": self.get(&card_id).await?, "enabled": self.is_enabled() })
            }
            DesktopCardHostRequest::Show { card_id } => {
                self.require_enabled()?;
                json!({ "card": self.set_visible(&card_id, true).await? })
            }
            DesktopCardHostRequest::Hide { card_id } => {
                json!({ "card": self.set_visible(&card_id, false).await? })
            }
            DesktopCardHostRequest::Delete { card_id } => {
                self.delete(&card_id).await?;
                json!({ "card": { "id": card_id }, "deleted": true })
            }
            DesktopCardHostRequest::Refresh { card_id } => {
                json!({ "card": self.refresh_now(&card_id).await? })
            }
        };
        log::debug!("Desktop card tool request handled: action={}", action);
        Ok(result)
    }
}

/// Applies settled window geometry; returns whether anything changed.
fn apply_geometry(
    card: &mut DesktopCardRecord,
    position: Option<DesktopCardPosition>,
    size: Option<DesktopCardSize>,
) -> bool {
    let mut changed = false;
    if let Some(position) = position.filter(|point| point.x.is_finite() && point.y.is_finite()) {
        let differs = card.position.is_none_or(|current| {
            (current.x - position.x).abs() >= 0.5 || (current.y - position.y).abs() >= 0.5
        });
        if differs {
            card.position = Some(position);
            changed = true;
        }
    }
    if let Some(size) = size.filter(|size| size.width > 0.0 && size.height > 0.0) {
        let size = clamp_size(size);
        let current = card_size(card);
        if (current.width - size.width).abs() >= 0.5 || (current.height - size.height).abs() >= 0.5
        {
            card.size = Some(size);
            changed = true;
        }
    }
    changed
}

/// Applies a stacking request to the record. Pinning remembers the card's
/// always-on-top mode, and an explicit unpin (`desktop_pinned == Some(false)`,
/// which clients send with `always_on_top: false`) restores it. Any explicit
/// change clears a previous pin-failure notice.
fn apply_stacking_record(
    card: &mut DesktopCardRecord,
    always_on_top: bool,
    desktop_pinned: Option<bool>,
) {
    let was_pinned = self::desktop_pinned(card);
    let previous_on_top = card.always_on_top;
    let pinned = desktop_pinned.unwrap_or(false);
    let restore_on_top = card
        .extra
        .get(PIN_RESTORE_ON_TOP_KEY)
        .and_then(Value::as_bool);
    card.always_on_top = if was_pinned && desktop_pinned == Some(false) && !always_on_top {
        restore_on_top.unwrap_or(false)
    } else {
        always_on_top
    };
    if pinned {
        if !was_pinned {
            card.extra
                .insert(PIN_RESTORE_ON_TOP_KEY.to_string(), json!(previous_on_top));
        }
    } else {
        card.extra.remove(PIN_RESTORE_ON_TOP_KEY);
    }
    card.extra.remove(PIN_FAILURE_KEY);
    card.extra
        .insert(DESKTOP_PINNED_KEY.to_string(), json!(pinned));
}

fn fetches_source(card: &DesktopCardRecord, source: &DesktopCardDataSourceKind) -> bool {
    card.data_source
        .as_ref()
        .and_then(DesktopCardDataSource::known)
        == Some(source)
}

/// Whether a fetch that started at or after the caller's request can be
/// reused: it must have been stored for the card's current source.
fn can_reuse_fetch(
    card: &DesktopCardRecord,
    source: &DesktopCardDataSourceKind,
    fetch_started_since_request: bool,
) -> bool {
    fetch_started_since_request && fetches_source(card, source) && card.last_data.is_some()
}

fn initial_refresh_delay(card: &DesktopCardRecord, source: &DesktopCardDataSourceKind) -> Duration {
    let interval_ms = (source.interval_seconds() as i64).saturating_mul(1000);
    match &card.last_data {
        Some(snapshot) if snapshot.error.is_none() => {
            let elapsed = now_ms().saturating_sub(snapshot.fetched_at_ms).max(0);
            Duration::from_millis(interval_ms.saturating_sub(elapsed).max(0) as u64)
        }
        _ => Duration::ZERO,
    }
}

async fn refresh_loop(
    service: Weak<DesktopCards>,
    card_id: String,
    source: DesktopCardDataSourceKind,
    initial_delay: Duration,
    spawned_at_ms: i64,
) {
    tokio::time::sleep(initial_delay).await;
    let interval = Duration::from_secs(source.interval_seconds());
    let mut not_before_ms = spawned_at_ms;
    loop {
        let Some(service) = service.upgrade() else {
            return;
        };
        if service
            .run_fetch(&card_id, &source, Some(not_before_ms))
            .await
            .is_none()
        {
            return;
        }
        drop(service);
        tokio::time::sleep(interval).await;
        not_before_ms = now_ms();
    }
}

/// Boxed with an explicit `Send` bound because firing a countdown re-syncs the
/// card, which may schedule this task again; the recursive opaque future would
/// otherwise not be provably `Send`.
fn countdown_task(
    service: Weak<DesktopCards>,
    card_id: String,
    target_at_ms: i64,
) -> Pin<Box<dyn Future<Output = ()> + Send>> {
    Box::pin(async move {
        let delay = target_at_ms.saturating_sub(now_ms()).max(0) as u64;
        tokio::time::sleep(Duration::from_millis(delay)).await;
        if let Some(service) = service.upgrade() {
            service.fire_countdown(&card_id, target_at_ms).await;
        }
    })
}

async fn configured_enabled() -> bool {
    match openbitfun_core::service::config::global::GlobalConfigManager::get_service().await {
        Ok(service) => service
            .get_config::<bool>(Some(DESKTOP_CARDS_CONFIG_PATH))
            .await
            .unwrap_or(true),
        Err(error) => {
            log::warn!(
                "Config service unavailable for desktop cards, keeping defaults: error={}",
                error
            );
            true
        }
    }
}

fn spawn_config_listener(service: Arc<DesktopCards>) {
    tokio::spawn(async move {
        let receiver = subscribe_config_updates();
        service.set_enabled(configured_enabled().await).await;
        let Some(mut receiver) = receiver else {
            log::warn!("Config update subscription unavailable for desktop cards");
            return;
        };
        loop {
            match receiver.recv().await {
                Ok(ConfigUpdateEvent::AppUpdated | ConfigUpdateEvent::ConfigReloaded) => {
                    let enabled = configured_enabled().await;
                    if enabled != service.is_enabled() {
                        service.set_enabled(enabled).await;
                    }
                }
                Ok(_) => {}
                Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                    log::warn!("Desktop card config listener channel closed");
                    break;
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(count)) => {
                    log::warn!("Desktop card config listener lagged by {} messages", count);
                    let enabled = configured_enabled().await;
                    if enabled != service.is_enabled() {
                        service.set_enabled(enabled).await;
                    }
                }
            }
        }
    });
}

/// Registers `service` as the DesktopCard tool's host, which makes the tool
/// visible to agents (it hides itself while no host is registered).
fn register_tool_host(service: &Arc<DesktopCards>) {
    let handler_service = Arc::clone(service);
    set_desktop_card_handler(Arc::new(move |request| {
        let service = Arc::clone(&handler_service);
        Box::pin(async move { service.handle_tool_request(request).await })
    }));
}

fn open_service(sink: Box<dyn CardSink>, dir: &Path) -> Arc<DesktopCards> {
    DesktopCards::new(sink, CardStore::load_dir(dir))
}

/// Loads the card store, registers the DesktopCard tool host, and starts the
/// timers of visible cards once the enable gate has been read.
pub fn install(handle: &HostHandle) -> Result<(), String> {
    let dir = try_get_path_manager_arc()
        .map_err(|error| format!("Path manager unavailable for desktop cards: {error}"))?
        .user_data_dir()
        .join("desktop-cards");
    let service = open_service(Box::new(HostSink(handle.clone())), &dir);
    handle.native().manage(Arc::clone(&service));
    register_tool_host(&service);
    spawn_config_listener(service);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use openbitfun_core::agentic::tools::desktop_card_host::{
        desktop_card_host_available, invoke_desktop_card_host,
    };

    #[derive(Default)]
    struct RecordingSink {
        events: Mutex<Vec<(String, Value)>>,
    }

    impl CardSink for Arc<RecordingSink> {
        fn emit(&self, event: &str, payload: Value) {
            self.events
                .lock()
                .unwrap()
                .push((event.to_string(), payload));
        }

        fn notify(&self, _title: String, _body: String) {}
    }

    fn temp_dir(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "openbitfun-desktop-cards-svc-{}-{}",
            name,
            uuid::Uuid::new_v4().simple()
        ))
    }

    fn command_card(command: &str, last_data: Value) -> DesktopCardRecord {
        serde_json::from_value(json!({
            "id": "card-1",
            "title": "Repo",
            "template": {"kind": "note", "text": "x"},
            "dataSource": {"kind": "command", "command": command, "intervalSeconds": 300},
            "lastData": last_data
        }))
        .unwrap()
    }

    fn source(command: &str) -> DesktopCardDataSourceKind {
        serde_json::from_value(
            json!({"kind": "command", "command": command, "intervalSeconds": 300}),
        )
        .unwrap()
    }

    fn stacking_card(always_on_top: bool) -> DesktopCardRecord {
        serde_json::from_value(json!({
            "id": "a", "title": "Note", "template": { "kind": "note", "text": "x" },
            "alwaysOnTop": always_on_top
        }))
        .unwrap()
    }

    fn checklist_store(dir: &Path) {
        std::fs::create_dir_all(dir).unwrap();
        std::fs::write(
            dir.join("cards.json"),
            serde_json::to_vec(&json!({
                "version": 1,
                "cards": [{
                    "id": "card-list", "title": "Release",
                    "template": { "kind": "checklist", "items": [
                        { "id": "i1", "text": "Tag" }, { "id": "i2", "text": "Notes" }
                    ]}
                }]
            }))
            .unwrap(),
        )
        .unwrap();
    }

    #[test]
    fn unpinning_restores_the_always_on_top_mode_from_before_pinning() {
        for before in [true, false] {
            let mut card = stacking_card(before);
            apply_stacking_record(&mut card, false, Some(true));
            assert!(desktop_pinned(&card));
            assert_eq!(card.extra[PIN_RESTORE_ON_TOP_KEY], json!(before));
            apply_stacking_record(&mut card, false, Some(true));
            assert_eq!(card.extra[PIN_RESTORE_ON_TOP_KEY], json!(before));
            apply_stacking_record(&mut card, false, Some(false));
            assert!(!desktop_pinned(&card));
            assert_eq!(card.always_on_top, before);
            assert!(!card.extra.contains_key(PIN_RESTORE_ON_TOP_KEY));
        }
    }

    #[test]
    fn legacy_stacking_requests_and_old_pinned_records_stay_compatible() {
        let mut card = stacking_card(false);
        card.extra
            .insert(DESKTOP_PINNED_KEY.to_string(), json!(true));
        apply_stacking_record(&mut card, false, Some(false));
        assert!(!card.always_on_top);
        let mut card = stacking_card(false);
        apply_stacking_record(&mut card, false, Some(true));
        apply_stacking_record(&mut card, true, None);
        assert!(card.always_on_top);
        assert!(!desktop_pinned(&card));
        assert!(!card.extra.contains_key(PIN_RESTORE_ON_TOP_KEY));
    }

    #[test]
    fn explicit_stacking_changes_clear_a_pin_failure_notice() {
        let mut card = stacking_card(false);
        card.extra.insert(
            PIN_FAILURE_KEY.to_string(),
            json!("The desktop layer is unavailable."),
        );
        apply_stacking_record(&mut card, false, Some(true));
        assert!(!card.extra.contains_key(PIN_FAILURE_KEY));
    }

    #[test]
    fn fetches_are_reused_only_when_started_since_the_request_for_the_same_source() {
        let card = command_card("gh api", json!({"fetchedAtMs": 1_000, "value": {"n": 1}}));
        assert!(can_reuse_fetch(&card, &source("gh api"), true));
        assert!(!can_reuse_fetch(&card, &source("gh api"), false));
        assert!(!can_reuse_fetch(&card, &source("gh api --paginate"), true));

        let pending = command_card("gh api", Value::Null);
        assert!(!can_reuse_fetch(&pending, &source("gh api"), true));
    }

    #[test]
    fn failed_or_missing_snapshots_refresh_immediately() {
        let source = source("gh api");
        let pending = command_card("gh api", Value::Null);
        assert_eq!(initial_refresh_delay(&pending, &source), Duration::ZERO);
        let failed = command_card(
            "gh api",
            json!({"fetchedAtMs": now_ms(), "error": "Command exited with 1: boom"}),
        );
        assert_eq!(initial_refresh_delay(&failed, &source), Duration::ZERO);
        let fresh = command_card("gh api", json!({"fetchedAtMs": now_ms(), "value": 1}));
        assert!(initial_refresh_delay(&fresh, &source) > Duration::from_secs(290));
    }

    #[test]
    fn geometry_ignores_jitter_and_clamps_sizes() {
        let mut card = stacking_card(true);
        assert!(apply_geometry(
            &mut card,
            Some(DesktopCardPosition { x: 10.0, y: 20.0 }),
            None
        ));
        assert!(!apply_geometry(
            &mut card,
            Some(DesktopCardPosition { x: 10.2, y: 20.3 }),
            None
        ));
        assert!(apply_geometry(
            &mut card,
            None,
            Some(DesktopCardSize {
                width: 5_000.0,
                height: 10.0
            })
        ));
        assert_eq!(card.size, Some(clamp_size(card.size.unwrap())));
        assert!(!apply_geometry(
            &mut card,
            Some(DesktopCardPosition {
                x: f64::NAN,
                y: 0.0
            }),
            None
        ));
    }

    #[tokio::test]
    async fn checklist_toggles_persist_and_announce_the_card() {
        let dir = temp_dir("checklist");
        checklist_store(&dir);
        let sink = Arc::new(RecordingSink::default());
        let service = open_service(Box::new(Arc::clone(&sink)), &dir);
        let card = service
            .set_checklist_item("card-list", "i2", true)
            .await
            .unwrap();
        let DesktopCardTemplate::Known(DesktopCardTemplateKind::Checklist { items }) =
            &card.template
        else {
            panic!("checklist expected");
        };
        assert!(items[1].done && !items[0].done);
        assert!(service
            .set_checklist_item("card-list", "missing", true)
            .await
            .unwrap_err()
            .contains("not found"));
        let events = sink.events.lock().unwrap().clone();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].0, DESKTOP_CARD_CHANGED_EVENT);
        assert_eq!(events[0].1["cardId"], json!("card-list"));
        // The definition (shared) holds the tick; reloading keeps it.
        let reloaded = open_service(Box::new(Arc::new(RecordingSink::default())), &dir);
        let card = reloaded.get("card-list").await.unwrap();
        assert!(matches!(
            card.template.known(),
            Some(DesktopCardTemplateKind::Checklist { items }) if items[1].done
        ));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn bounds_are_local_state_and_saved_without_an_event() {
        let dir = temp_dir("bounds");
        checklist_store(&dir);
        let sink = Arc::new(RecordingSink::default());
        let service = open_service(Box::new(Arc::clone(&sink)), &dir);
        service
            .set_bounds(
                "card-list",
                Some(DesktopCardPosition { x: 900.0, y: 40.0 }),
                Some(DesktopCardSize {
                    width: 300.0,
                    height: 260.0,
                }),
            )
            .await
            .unwrap();
        tokio::time::sleep(GEOMETRY_SAVE_DELAY + Duration::from_millis(200)).await;
        assert!(sink.events.lock().unwrap().is_empty());
        let local: Value =
            serde_json::from_slice(&std::fs::read(dir.join("local-state.json")).unwrap()).unwrap();
        assert_eq!(
            local["cards"]["card-list"]["position"],
            json!({ "x": 900.0, "y": 40.0 })
        );
        let definitions: Value =
            serde_json::from_slice(&std::fs::read(dir.join("cards.json")).unwrap()).unwrap();
        assert!(definitions["cards"][0].get("position").is_none());
        assert!(service
            .set_bounds("nope", None, None)
            .await
            .unwrap_err()
            .contains("not found"));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn the_tool_becomes_available_once_the_host_is_registered() {
        let dir = temp_dir("tool");
        checklist_store(&dir);
        let service = open_service(Box::new(Arc::new(RecordingSink::default())), &dir);
        service.set_enabled(true).await;
        register_tool_host(&service);
        assert!(desktop_card_host_available());
        let listed = invoke_desktop_card_host(DesktopCardHostRequest::List)
            .await
            .unwrap();
        assert_eq!(listed["enabled"], json!(true));
        assert!(listed["cards"]
            .as_array()
            .unwrap()
            .iter()
            .any(|card| card["id"] == json!("card-list")));
        let _ = std::fs::remove_dir_all(dir);
    }
}

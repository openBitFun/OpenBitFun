//! Desktop card definitions on the account replica (`desktop.cards`).
//!
//! A record per card id carries its definition: title, template, data,
//! link, origin and data source, never its window geometry, visibility on
//! this screen, pinning or fetched data (those stay in `local-state.json`).
//! HTTP source headers are per-device placeholders (each device keeps its own
//! values; a device without them fetches without until the user enters
//! them). A command source runs a shell command in a directory of the device
//! that defined it, so such a card is device-bound: the record names that
//! device and only that device materializes it. The device's 1.x
//! `cards.json` is read in place.

use std::sync::Arc;

use anyhow::{anyhow, Result};
use async_trait::async_trait;
use openbitfun_core::agentic::tools::desktop_card_host::DesktopCardRecord;
use openbitfun_core::service::remote_connect::account_records::{
    secret_ref, valid_record_id, ApplyContext, DeviceContext, LocalCollection, LocalItem,
    RemoteItem, DESKTOP_CARDS_COLLECTION,
};
use serde_json::{json, Map, Value};

use super::store::LOCAL_EXTRA_KEYS;
use super::DesktopCards;

/// Fields of a stored definition that are this device's display state.
const DEVICE_FIELDS: &[&str] = &["lastData", "position"];

/// The record of a card definition.
pub(crate) fn projection(card: &DesktopCardRecord, device: &DeviceContext) -> Result<Value> {
    let mut value = serde_json::to_value(card)?;
    let fields = value
        .as_object_mut()
        .ok_or_else(|| anyhow!("card is not an object"))?;
    for field in DEVICE_FIELDS.iter().chain(LOCAL_EXTRA_KEYS.iter()) {
        fields.remove(*field);
    }
    if let Some(source) = fields.get_mut("dataSource").and_then(Value::as_object_mut) {
        if let Some(headers) = source.get_mut("headers").and_then(Value::as_object_mut) {
            let names: Vec<String> = headers.keys().cloned().collect();
            for name in names {
                headers.insert(
                    name.clone(),
                    secret_ref(format!("card:{}:header:{name}", card.id)),
                );
            }
        }
        if source.get("kind").and_then(Value::as_str) == Some("command") {
            fields.insert(
                "deviceBound".into(),
                json!({ "deviceId": device.device_id, "deviceName": device.device_name }),
            );
        }
    }
    Ok(value)
}

/// The definition for this device: the account's with this device's own
/// header values.
fn local_definition(
    value: &Value,
    existing: Option<&DesktopCardRecord>,
) -> Result<DesktopCardRecord> {
    let mut value = value.clone();
    let fields = value
        .as_object_mut()
        .ok_or_else(|| anyhow!("card record is not an object"))?;
    fields.remove("deviceBound");
    let own_headers: Map<String, Value> = existing
        .and_then(|card| serde_json::to_value(card).ok())
        .and_then(|card| card.pointer("/dataSource/headers").cloned())
        .and_then(|headers| headers.as_object().cloned())
        .unwrap_or_default();
    if let Some(headers) = fields
        .get_mut("dataSource")
        .and_then(|source| source.get_mut("headers"))
        .and_then(Value::as_object_mut)
    {
        for (name, entry) in headers.iter_mut() {
            *entry = own_headers.get(name).cloned().unwrap_or(json!(""));
        }
    }
    Ok(serde_json::from_value(value)?)
}

impl DesktopCards {
    /// Stores an account definition: a new card shows at its default place,
    /// an existing one keeps this device's geometry, stacking, pinning and
    /// fetched data.
    pub(crate) async fn apply_account_definition(
        &self,
        mut card: DesktopCardRecord,
    ) -> Result<DesktopCardRecord, String> {
        let card = {
            let mut store = self.store.lock().await;
            if let Some(existing) = store.get(&card.id) {
                card.position = existing.position;
                card.size = existing.size.or(card.size);
                card.visible = existing.visible;
                card.always_on_top = existing.always_on_top;
                card.last_data = existing.last_data.clone();
                for key in LOCAL_EXTRA_KEYS {
                    match existing.extra.get(key) {
                        Some(value) => {
                            card.extra.insert(key.to_string(), value.clone());
                        }
                        None => {
                            card.extra.remove(key);
                        }
                    }
                }
            }
            store.put(card.clone());
            Self::save_locked(&mut store)?;
            store.get(&card.id).unwrap_or(card)
        };
        self.sync_card_runtime(&card);
        self.emit_changed(&card.id, Some(&card), false, false);
        Ok(card)
    }

    pub(crate) async fn account_definitions(&self) -> Vec<DesktopCardRecord> {
        self.store.lock().await.definitions()
    }
}

/// The `desktop.cards` binding over the desktop card service.
pub(crate) struct CardRecords {
    cards: Arc<DesktopCards>,
}

impl CardRecords {
    pub(crate) fn new(cards: Arc<DesktopCards>) -> Self {
        Self { cards }
    }
}

#[async_trait]
impl LocalCollection for CardRecords {
    fn collection(&self) -> &'static str {
        DESKTOP_CARDS_COLLECTION
    }

    async fn list(&self, device: &DeviceContext) -> Result<Vec<LocalItem>> {
        let mut items = Vec::new();
        for card in self.cards.account_definitions().await {
            if valid_record_id(&card.id) {
                items.push(LocalItem::new(card.id.clone(), projection(&card, device)?));
            }
        }
        Ok(items)
    }

    async fn apply(&self, item: &RemoteItem, context: &ApplyContext) -> Result<()> {
        if let Some(owner) = item
            .value
            .pointer("/deviceBound/deviceId")
            .and_then(Value::as_str)
        {
            if owner != context.device.device_id {
                // Another device's command card: it runs only there.
                return Ok(());
            }
        }
        let existing = self.cards.get(&item.id).await.ok();
        let card = local_definition(&item.value, existing.as_ref())?;
        if card.id != item.id {
            return Err(anyhow!("card record names another id"));
        }
        self.cards
            .apply_account_definition(card)
            .await
            .map(|_| ())
            .map_err(|error| anyhow!(error))
    }

    async fn remove(&self, id: &str) -> Result<()> {
        if self.cards.get(id).await.is_ok() {
            self.cards
                .delete(id)
                .await
                .map_err(|error| anyhow!(error))?;
        }
        Ok(())
    }
}

#[cfg(test)]
#[path = "replica_tests.rs"]
mod tests;

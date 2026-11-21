//! IM bot binding metadata (`bots` collection): which bot channels the
//! account has and which device runs each one, so every device can show
//! "runs on <device>". Tokens, app secrets, form drafts and chat state stay
//! on the owner device (`remote_connect_persistence.json`); a record per bot
//! type is written by the device that owns the binding, and applying one on
//! another device stores nothing there.

use anyhow::Result;
use async_trait::async_trait;
use serde_json::json;

use super::{ApplyContext, DeviceContext, LocalCollection, LocalItem, RemoteItem, BOTS_COLLECTION};
use crate::remote_connect::bot::{load_bot_persistence, BotPersistenceData};

/// The bot channels a device owns, as account records.
pub fn bot_items(data: &BotPersistenceData, device: &DeviceContext) -> Vec<LocalItem> {
    data.connections
        .iter()
        .filter(|connection| !connection.bot_type.is_empty())
        .map(|connection| {
            let enabled = !data
                .disabled_bots
                .iter()
                .any(|bot| bot.eq_ignore_ascii_case(&connection.bot_type));
            LocalItem::new(
                connection.bot_type.to_ascii_lowercase(),
                json!({
                    "botType": connection.bot_type,
                    "ownerDeviceId": device.device_id,
                    "ownerDeviceName": device.device_name,
                    "enabled": enabled,
                    "paired": connection.chat_state.paired,
                    "connectedAt": connection.connected_at,
                }),
            )
        })
        .collect()
}

/// The `bots` binding over the host's bot persistence.
pub struct BotBindingRecords;

#[async_trait]
impl LocalCollection for BotBindingRecords {
    fn collection(&self) -> &'static str {
        BOTS_COLLECTION
    }

    async fn list(&self, device: &DeviceContext) -> Result<Vec<LocalItem>> {
        let data = tokio::task::spawn_blocking(load_bot_persistence).await?;
        Ok(bot_items(&data, device))
    }

    /// Another device's binding: shown from the record, nothing stored here
    /// (its token never leaves that device).
    async fn apply(&self, _item: &RemoteItem, _context: &ApplyContext) -> Result<()> {
        Ok(())
    }

    async fn remove(&self, _id: &str) -> Result<()> {
        Ok(())
    }
}

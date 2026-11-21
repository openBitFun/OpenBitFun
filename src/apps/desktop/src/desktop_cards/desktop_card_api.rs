//! Backend commands for desktop cards: the card windows of the native shell,
//! the inline cards of every client (Library, OpenBitFun), and Settings.

use std::sync::Arc;

use super::DesktopCards;
use crate::host::State;
use openbitfun_core::agentic::tools::desktop_card_host::{
    DesktopCardPosition, DesktopCardRecord, DesktopCardSize,
};
use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DesktopCardListRequest {}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopCardIdRequest {
    pub card_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopCardSetVisibleRequest {
    pub card_id: String,
    pub visible: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopCardChecklistItemRequest {
    pub card_id: String,
    pub item_id: String,
    pub done: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopCardAlwaysOnTopRequest {
    pub card_id: String,
    pub always_on_top: bool,
    /// Omitted by older clients: retain the original always-on-top operation.
    #[serde(default)]
    pub desktop_pinned: Option<bool>,
}

/// Settled geometry of a card window, in points, screen coordinates.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopCardSetBoundsRequest {
    pub card_id: String,
    #[serde(default)]
    pub x: Option<f64>,
    #[serde(default)]
    pub y: Option<f64>,
    #[serde(default)]
    pub width: Option<f64>,
    #[serde(default)]
    pub height: Option<f64>,
}

impl DesktopCardSetBoundsRequest {
    fn position(&self) -> Option<DesktopCardPosition> {
        Some(DesktopCardPosition {
            x: self.x?,
            y: self.y?,
        })
    }

    fn size(&self) -> Option<DesktopCardSize> {
        Some(DesktopCardSize {
            width: self.width?,
            height: self.height?,
        })
    }
}

/// Runtime capability of this host, never a persisted card field. The native
/// shell keeps a pinned card on the desktop layer (`level: "desktopIcon"`),
/// which the NSH desktops offer on macOS and Windows.
pub(crate) fn desktop_pinning_supported() -> bool {
    cfg!(any(windows, target_os = "macos"))
}

/// Host capabilities live beside the card list so management surfaces can
/// offer desktop pinning for hidden cards without loading every card.
fn with_host_capabilities(mut payload: Value) -> Value {
    if let Some(object) = payload.as_object_mut() {
        object.insert(
            "desktopPinningSupported".to_string(),
            serde_json::json!(desktop_pinning_supported()),
        );
    }
    payload
}

// @backend-command
pub async fn desktop_card_list(
    cards: State<'_, Arc<DesktopCards>>,
    request: DesktopCardListRequest,
) -> Result<Value, String> {
    let DesktopCardListRequest {} = request;
    Ok(with_host_capabilities(cards.list().await))
}

// @backend-command
pub async fn desktop_card_get(
    cards: State<'_, Arc<DesktopCards>>,
    request: DesktopCardIdRequest,
) -> Result<DesktopCardRecord, String> {
    let mut card = cards.get(&request.card_id).await?;
    // Runtime capability only, never persisted.
    card.extra.insert(
        "desktopPinningSupported".to_string(),
        serde_json::json!(desktop_pinning_supported()),
    );
    Ok(card)
}

// @backend-command
pub async fn desktop_card_set_visible(
    cards: State<'_, Arc<DesktopCards>>,
    request: DesktopCardSetVisibleRequest,
) -> Result<DesktopCardRecord, String> {
    if request.visible && !cards.is_enabled() {
        return Err("Desktop cards are turned off in OpenBitFun settings.".to_string());
    }
    cards.set_visible(&request.card_id, request.visible).await
}

// @backend-command
pub async fn desktop_card_delete(
    cards: State<'_, Arc<DesktopCards>>,
    request: DesktopCardIdRequest,
) -> Result<(), String> {
    cards.delete(&request.card_id).await
}

// @backend-command
pub async fn desktop_card_refresh(
    cards: State<'_, Arc<DesktopCards>>,
    request: DesktopCardIdRequest,
) -> Result<DesktopCardRecord, String> {
    cards.refresh_now(&request.card_id).await
}

// @backend-command
pub async fn desktop_card_set_checklist_item(
    cards: State<'_, Arc<DesktopCards>>,
    request: DesktopCardChecklistItemRequest,
) -> Result<DesktopCardRecord, String> {
    cards
        .set_checklist_item(&request.card_id, &request.item_id, request.done)
        .await
}

// @backend-command
pub async fn desktop_card_set_always_on_top(
    cards: State<'_, Arc<DesktopCards>>,
    request: DesktopCardAlwaysOnTopRequest,
) -> Result<DesktopCardRecord, String> {
    cards
        .set_stacking(
            &request.card_id,
            request.always_on_top,
            request.desktop_pinned,
        )
        .await
}

// @backend-command
pub async fn desktop_card_set_bounds(
    cards: State<'_, Arc<DesktopCards>>,
    request: DesktopCardSetBoundsRequest,
) -> Result<(), String> {
    cards
        .set_bounds(&request.card_id, request.position(), request.size())
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn legacy_stacking_requests_do_not_require_desktop_pinning() {
        let request: DesktopCardAlwaysOnTopRequest = serde_json::from_value(json!({
            "cardId": "card-1", "alwaysOnTop": true
        }))
        .unwrap();
        assert!(request.always_on_top);
        assert_eq!(request.desktop_pinned, None);
        let request: DesktopCardAlwaysOnTopRequest = serde_json::from_value(json!({
            "cardId": "card-1", "alwaysOnTop": false, "desktopPinned": true
        }))
        .unwrap();
        assert!(!request.always_on_top);
        assert_eq!(request.desktop_pinned, Some(true));
    }

    #[test]
    fn bounds_requests_take_a_move_a_resize_or_both() {
        let moved: DesktopCardSetBoundsRequest =
            serde_json::from_value(json!({ "cardId": "c", "x": 1.0, "y": 2.0 })).unwrap();
        assert_eq!(
            moved.position(),
            Some(DesktopCardPosition { x: 1.0, y: 2.0 })
        );
        assert_eq!(moved.size(), None);
        let resized: DesktopCardSetBoundsRequest =
            serde_json::from_value(json!({ "cardId": "c", "width": 300.0, "height": 200.0 }))
                .unwrap();
        assert_eq!(resized.position(), None);
        assert!(resized.size().is_some());
    }

    #[test]
    fn list_advertises_pinning_as_an_additive_capability() {
        let payload = with_host_capabilities(json!({
            "enabled": true,
            "cards": [{ "id": "card-1", "desktopPinned": true }]
        }));
        assert_eq!(
            payload["desktopPinningSupported"],
            json!(desktop_pinning_supported())
        );
        assert_eq!(payload["enabled"], json!(true));
        assert_eq!(
            payload["cards"],
            json!([{ "id": "card-1", "desktopPinned": true }])
        );
        assert_eq!(with_host_capabilities(json!(null)), json!(null));
    }
}

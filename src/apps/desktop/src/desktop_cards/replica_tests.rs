use std::sync::{Arc, Mutex};

use openbitfun_core::service::remote_connect::account_records::collection_budget;
use serde_json::json;

use super::super::{open_service, CardSink, DesktopCards};
use super::*;
use crate::api::account_records_api::test_harness::*;

#[derive(Default)]
struct Events(Mutex<Vec<String>>);

impl CardSink for Arc<Events> {
    fn emit(&self, event: &str, _payload: Value) {
        self.0.lock().unwrap().push(event.to_string());
    }

    fn notify(&self, _title: String, _body: String) {}
}

struct Side {
    dir: tempfile::TempDir,
    cards: Arc<DesktopCards>,
    device: Device,
}

fn side(id: &str, legacy: Option<Value>) -> Side {
    let dir = tempfile::tempdir().unwrap();
    let store = dir.path().join("desktop-cards");
    if let Some(legacy) = legacy {
        std::fs::create_dir_all(&store).unwrap();
        std::fs::write(
            store.join("cards.json"),
            serde_json::to_vec(&legacy).unwrap(),
        )
        .unwrap();
    }
    let cards = open_service(Box::new(Arc::new(Events::default())), &store);
    let device = device(id, Arc::new(CardRecords::new(Arc::clone(&cards))));
    Side { dir, cards, device }
}

/// A 1.x `cards.json`: an HTTP card with a bearer header, a command card and
/// a note, with one device's geometry and fetched data.
fn legacy_store() -> Value {
    json!({
        "version": 1,
        "cards": [
            {
                "id": "card-http", "title": "Build", "template": { "kind": "note", "text": "x" },
                "dataSource": { "kind": "http", "url": "https://ci.example.com/status",
                    "headers": { "Authorization": "Bearer ci-token-abcdefghijklmnop0123" }, "intervalSeconds": 300 },
                "position": { "x": 1800.0, "y": 40.0 }, "lastData": { "fetchedAtMs": 5, "value": "green" }
            },
            {
                "id": "card-cmd", "title": "Repo", "template": { "kind": "note", "text": "x" },
                "dataSource": { "kind": "command", "command": "git -C ~/src status --short", "intervalSeconds": 300 }
            },
            { "id": "card-note", "title": "Todo", "template": { "kind": "note", "text": "ship it" } }
        ]
    })
}

#[tokio::test]
async fn legacy_card_definitions_reach_another_device_without_secrets_or_geometry() {
    let a = side("a", Some(legacy_store()));
    let b = side("b", None);
    settle(&[&a.device, &b.device]).await;
    let text = replica_text(&a.device);
    for leaked in ["ci-token", "\"x\":1800", "green"] {
        assert!(!text.contains(leaked), "{leaked} leaked");
    }
    // The HTTP card lands with an empty header for this device to fill.
    let http = b.cards.get("card-http").await.unwrap();
    let source = serde_json::to_value(&http.data_source).unwrap();
    assert_eq!(source["headers"]["Authorization"], "");
    assert_eq!(source["url"], "https://ci.example.com/status");
    assert!(http.position.is_none() && http.last_data.is_none());
    // The command card runs only where it was defined.
    assert!(b.cards.get("card-cmd").await.is_err());
    let cmd = live(&b.device, DESKTOP_CARDS_COLLECTION)
        .into_iter()
        .find(|record| record.id == "card-cmd")
        .unwrap();
    assert_eq!(cmd.value.unwrap()["v"]["deviceBound"]["deviceId"], "a");
    assert_eq!(b.cards.get("card-note").await.unwrap().title, "Todo");
    // a keeps its own header, geometry and data; the old file still reads.
    let on_a = a.cards.get("card-http").await.unwrap();
    let source = serde_json::to_value(&on_a.data_source).unwrap();
    assert!(source["headers"]["Authorization"]
        .as_str()
        .unwrap()
        .starts_with("Bearer ci-token"));
    assert!(on_a.position.is_some());
    let reread: Value = serde_json::from_slice(
        &std::fs::read(a.dir.path().join("desktop-cards/cards.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(reread["cards"].as_array().unwrap().len(), 3);
}

#[tokio::test]
async fn concurrent_card_edits_converge_and_keep_local_geometry() {
    let a = side("a", Some(legacy_store()));
    let b = side("b", None);
    settle(&[&a.device, &b.device]).await;
    b.cards
        .set_bounds(
            "card-note",
            Some(
                openbitfun_core::agentic::tools::desktop_card_host::DesktopCardPosition {
                    x: 10.0,
                    y: 20.0,
                },
            ),
            None,
        )
        .await
        .unwrap();
    let mut on_a = a.cards.get("card-note").await.unwrap();
    on_a.title = "Todo (a)".into();
    a.cards.apply_account_definition(on_a).await.unwrap();
    a.device.sync.round().await;
    std::thread::sleep(std::time::Duration::from_millis(3));
    let mut on_b = b.cards.get("card-note").await.unwrap();
    on_b.title = "Todo (b)".into();
    b.cards.apply_account_definition(on_b).await.unwrap();
    b.device.sync.round().await;
    settle(&[&a.device, &b.device]).await;
    assert_eq!(a.cards.get("card-note").await.unwrap().title, "Todo (b)");
    let on_b = b.cards.get("card-note").await.unwrap();
    assert_eq!(on_b.title, "Todo (b)");
    assert_eq!(on_b.position.map(|p| (p.x, p.y)), Some((10.0, 20.0)));
    // A deletion travels.
    b.cards.delete("card-note").await.unwrap();
    settle(&[&a.device, &b.device]).await;
    assert!(a.cards.get("card-note").await.is_err());
}

#[tokio::test]
async fn card_secrets_stay_local_and_the_budget_holds() {
    let budget = collection_budget(DESKTOP_CARDS_COLLECTION).unwrap();
    let mut cards: Vec<Value> = (0..=budget.max_records)
        .map(|index| json!({ "id": format!("card-{index:03}"), "title": "t", "template": { "kind": "note", "text": "x" } }))
        .collect();
    cards.push(json!({
        "id": "card-zleak", "title": "Leak", "template": { "kind": "note", "text": concat!("token xo", "xb-1234567890-abcdefghijklmnopq") }
    }));
    let a = side("a", Some(json!({ "version": 1, "cards": cards })));
    settle(&[&a.device]).await;
    assert!(!replica_text(&a.device).contains("xoxb-"));
    let refused = a.device.sync.status().refused;
    assert!(
        refused
            .iter()
            .any(|r| r.id == "card-zleak" && r.reason == "secret"),
        "{refused:?}"
    );
    assert_eq!(
        live(&a.device, DESKTOP_CARDS_COLLECTION).len(),
        budget.max_records
    );
    assert!(refused.iter().any(|r| r.reason == "budget"));
    assert!(a.cards.get("card-zleak").await.is_ok());
}

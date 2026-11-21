//! The entry's Inbox over a real index and a fake cloud node: projection,
//! revisions and change events, the cloud read, and read state.

use std::sync::{Arc, Mutex};

use serde_json::{json, Value};

use super::*;
use crate::fleet::sync::{FleetPeerPresence, FleetPeerSubscription};
use crate::fleet::{FleetCallError, FleetFuture};

const CLOUD: &str = "cloud-3f2a9c";

#[derive(Default)]
struct Events(Mutex<Vec<(String, Value)>>);

impl FleetEventSink for Events {
    fn emit(&self, event: &str, payload: Value) {
        self.0.lock().unwrap().push((event.to_string(), payload));
    }
}

impl Events {
    fn attention(&self) -> Vec<u64> {
        self.0
            .lock()
            .unwrap()
            .iter()
            .filter(|(event, _)| event == FLEET_ATTENTION_CHANGED_EVENT)
            .filter_map(|(_, payload)| payload["revision"].as_u64())
            .collect()
    }
}

/// The cloud node's `superagent_status`, or a failure.
struct CloudStatus {
    status: Mutex<Result<Value, String>>,
    calls: Mutex<Vec<String>>,
}

impl FleetPeerTransport for CloudStatus {
    fn presence(&self) -> FleetFuture<'_, Vec<FleetPeerPresence>> {
        Box::pin(async { Vec::new() })
    }

    fn subscribe_index(
        &self,
        _device_id: &str,
    ) -> FleetFuture<'_, Result<FleetPeerSubscription, String>> {
        Box::pin(async { Err("not used".to_string()) })
    }

    fn call(
        &self,
        device_id: &str,
        command: &str,
        _args: Value,
    ) -> FleetFuture<'_, Result<Value, FleetCallError>> {
        self.calls
            .lock()
            .unwrap()
            .push(format!("{device_id}:{command}"));
        let answer = self.status.lock().unwrap().clone();
        Box::pin(async move { answer.map_err(FleetCallError::transport) })
    }
}

fn card(id: &str, state: &str, updated: u64) -> Value {
    json!({"jobId": id, "deviceId": "linux", "deviceName": "linux-box", "hostKind": "cli",
           "title": format!("Job {id}"), "state": state, "updatedMs": updated})
}

fn presence(id: &str, kind: FleetHostKind) -> FleetPeerPresence {
    FleetPeerPresence {
        device_id: id.into(),
        name: id.into(),
        host_kind: kind,
        online: true,
        mesh: true,
        as_of_ms: 1,
        ..FleetPeerPresence::default()
    }
}

fn mac_digest(failed_at: u64, prompts: usize) -> FleetDigest {
    FleetDigest {
        device_id: "mac".into(),
        instance_id: "mac-1".into(),
        revision: failed_at,
        full: true,
        workspaces: vec![FleetWorkspace {
            workspace_id: "w1".into(),
            name: "repo".into(),
            ..FleetWorkspace::default()
        }],
        sessions: vec![
            FleetSession {
                workspace_id: "w1".into(),
                session_id: "s1".into(),
                title: "Release".into(),
                status: FleetSessionStatus::Waiting,
                last_activity_ms: 5,
                ..FleetSession::default()
            },
            FleetSession {
                workspace_id: "w1".into(),
                session_id: "s2".into(),
                title: "Fix lexer".into(),
                status: FleetSessionStatus::Error,
                last_activity_ms: failed_at,
                ..FleetSession::default()
            },
        ],
        prompts: (0..prompts)
            .map(|n| FleetPrompt {
                workspace_id: "w1".into(),
                session_id: "s1".into(),
                kind: FleetPromptKind::Permission,
                prompt_id: format!("p{n}"),
                title: "Run tests?".into(),
                answerable: true,
                ..FleetPrompt::default()
            })
            .collect(),
        ..FleetDigest::default()
    }
}

fn setup(
    status: Result<Value, String>,
) -> (
    Arc<FleetIndex>,
    Arc<CloudStatus>,
    Arc<Events>,
    Arc<FleetAttention>,
) {
    let events = Arc::new(Events::default());
    let index = FleetIndex::new("entry".into(), None, None);
    index.set_presence(&[
        presence("mac", FleetHostKind::Desktop),
        presence(CLOUD, FleetHostKind::Cloud),
    ]);
    index.apply_digest("mac", None, mac_digest(10, 1));
    let cloud = Arc::new(CloudStatus {
        status: Mutex::new(status),
        calls: Mutex::default(),
    });
    let attention = FleetAttention::new(
        Arc::clone(&index),
        Arc::clone(&cloud) as Arc<dyn FleetPeerTransport>,
        Some(Arc::clone(&events) as Arc<dyn FleetEventSink>),
    );
    (index, cloud, events, attention)
}

fn group_ids(view: &FleetAttentionView) -> Vec<(&str, Vec<&str>)> {
    view.groups
        .iter()
        .map(|group| {
            (
                group.id.as_str(),
                group
                    .items
                    .iter()
                    .map(|item| item.item_id.as_str())
                    .collect(),
            )
        })
        .collect()
}

#[tokio::test]
async fn the_inbox_merges_prompts_cloud_jobs_and_failed_sessions() {
    let status = json!({"workingNow": {
        "needsYou": [card("j-blocked", "blocked", 30)],
        "working": [card("j-working", "working", 40)],
        "done": [card("j-done", "done", 20)]
    }});
    let (_, cloud, events, attention) = setup(Ok(status));
    let view = attention.view().await;
    assert_eq!(
        group_ids(&view),
        [
            ("needs_you", vec!["mac/p0", "job:j-blocked"]),
            ("done", vec!["job:j-done"]),
            ("failed", vec!["session:mac/s2"]),
        ]
    );
    assert_eq!(view.badge, 2);
    assert_eq!(events.attention(), [view.revision]);
    assert_eq!(
        *cloud.calls.lock().unwrap(),
        [format!("{CLOUD}:superagent_status")]
    );

    // Nothing changed: the same revision, no event, the cloud read reused.
    let again = attention.view().await;
    assert_eq!(again.revision, view.revision);
    assert_eq!(events.attention().len(), 1);
    assert_eq!(cloud.calls.lock().unwrap().len(), 1);

    // The wire shape through the verb.
    let wire = attention
        .handle("fleet_attention", &json!({"request": {}}))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(wire["badge"], 2);
    assert_eq!(wire["groups"][0]["items"][0]["source"]["deviceId"], "mac");
    assert!(attention.handle("fleet_call", &json!({})).await.is_none());
}

#[tokio::test]
async fn marking_read_clears_what_the_client_saw_and_nothing_newer() {
    let status = json!({"workingNow": {"needsYou": [], "done": [card("j-done", "done", 20)]}});
    let (index, _, events, attention) = setup(Ok(status));
    let seen = attention.view().await;
    // A new failure arrives after the client looked.
    index.apply_digest("mac", None, mac_digest(50, 1));
    attention.local_changed();
    let newer = events.attention();
    assert_eq!(newer.len(), 2, "the index change moved the view");

    let marked = attention
        .handle(
            "fleet_attention_mark_read",
            &json!({"request": {"revision": seen.revision}}),
        )
        .await
        .unwrap()
        .unwrap();
    // The done job and the failure the client saw (at 10); the failure at
    // 50 came later and stays unread.
    assert_eq!(marked["marked"], 2);
    let view = attention.view().await;
    assert_eq!(
        group_ids(&view),
        [
            ("needs_you", vec!["mac/p0"]),
            ("failed", vec!["session:mac/s2"]),
        ]
    );
    assert_eq!(marked["revision"], view.revision);
    let latest = attention.mark_read(view.revision);
    assert_eq!(latest.marked, 1);
    let view = attention.view().await;
    assert_eq!(group_ids(&view), [("needs_you", vec!["mac/p0"])]);
    // Prompts are never read; they leave when answered.
    index.apply_digest("mac", None, mac_digest(50, 0));
    attention.local_changed();
    let view = attention.view().await;
    assert!(view.groups.is_empty());
    assert_eq!(view.badge, 0);
    // An unknown revision marks nothing.
    assert_eq!(attention.mark_read(0).marked, 0);
}

#[tokio::test]
async fn an_unreachable_cloud_node_keeps_its_last_jobs_and_a_missing_one_has_none() {
    let status = json!({"workingNow": {"needsYou": [card("j-blocked", "blocked", 30)]}});
    let (index, cloud, _, attention) = setup(Ok(status));
    assert_eq!(attention.view().await.badge, 2);
    *cloud.status.lock().unwrap() = Err("cloud_unreachable: gone".into());
    attention.lock().jobs_at = None;
    assert_eq!(
        attention.view().await.badge,
        2,
        "the last good read is kept"
    );
    // The node is no longer indexed: its jobs leave.
    index.set_presence(&[presence("mac", FleetHostKind::Desktop)]);
    index.remove_device(CLOUD);
    let view = attention.view().await;
    assert_eq!(view.badge, 1);
    assert!(attention_jobs_of_status(&json!("garbage")).is_empty());
}

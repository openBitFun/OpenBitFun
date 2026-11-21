//! The Inbox projection: groups, order, badge, dedup and read state.

use serde_json::json;

use super::*;
use crate::fleet::{FleetDeviceState, FleetSession, FleetWorkspace};

fn device(id: &str, name: &str, sessions: Vec<FleetSession>) -> FleetDevice {
    FleetDevice {
        device_id: id.into(),
        name: name.into(),
        host_kind: FleetHostKind::Desktop,
        state: FleetDeviceState::Online,
        workspaces: vec![FleetWorkspace {
            device_id: id.into(),
            workspace_id: "w1".into(),
            name: "repo".into(),
            sessions,
            ..FleetWorkspace::default()
        }],
        ..FleetDevice::default()
    }
}

fn session(id: &str, title: &str, status: FleetSessionStatus, at: u64) -> FleetSession {
    FleetSession {
        session_id: id.into(),
        workspace_id: "w1".into(),
        title: title.into(),
        status,
        last_activity_ms: at,
        ..FleetSession::default()
    }
}

fn prompt(device: &str, session: &str, id: &str, job: Option<&str>) -> FleetPrompt {
    FleetPrompt {
        device_id: device.into(),
        workspace_id: "w1".into(),
        session_id: session.into(),
        kind: if id.starts_with('q') {
            FleetPromptKind::Question
        } else {
            FleetPromptKind::Permission
        },
        prompt_id: id.into(),
        title: format!("Run {id}?"),
        answerable: true,
        job_id: job.map(str::to_string),
        ..FleetPrompt::default()
    }
}

fn job(id: &str, state: &str, updated: u64) -> AttentionJob {
    AttentionJob::from_value(&json!({
        "jobId": id, "deviceId": "linux", "deviceName": "linux-box", "hostKind": "cli",
        "title": format!("Job {id}"), "state": state, "stateReason": "3 tests failed",
        "conversationId": "c1", "updatedMs": updated,
        "actions": {"openTranscript": {"allowed": true}}
    }))
    .unwrap()
}

fn ids(group: &AttentionGroup) -> Vec<&str> {
    group
        .items
        .iter()
        .map(|item| item.item_id.as_str())
        .collect()
}

#[test]
fn prompts_jobs_and_failed_sessions_land_in_their_groups() {
    let devices = vec![
        device(
            "mac",
            "mac-mini",
            vec![
                session("s1", "Test release 1.2", FleetSessionStatus::Waiting, 900),
                session("s2", "Fix lexer", FleetSessionStatus::Error, 800),
            ],
        ),
        device(
            "win",
            "win-pc",
            vec![session("s3", "", FleetSessionStatus::Error, 950)],
        ),
    ];
    let prompts = vec![
        prompt("mac", "s1", "p1", None),
        prompt("mac", "s1", "q1", Some("j-blocked-covered")),
    ];
    let jobs = vec![
        job("j-done", "done", 700),
        job("j-failed", "failed", 990),
        job("j-blocked", "blocked", 600),
        job("j-blocked-covered", "blocked", 650),
        job("j-working", "working", 999),
    ];
    let inputs = AttentionInputs {
        devices: &devices,
        prompts: &prompts,
        jobs: &jobs,
        now_ms: 1_000,
    };
    let view = project_attention(&inputs, &|_, _| false);
    let groups: Vec<&str> = view.groups.iter().map(|group| group.id.as_str()).collect();
    assert_eq!(groups, ["needs_you", "done", "failed"]);
    // Prompts in tray order, then the blocked job the tray does not hold;
    // the blocked job whose prompt is in the tray is not listed twice.
    assert_eq!(ids(&view.groups[0]), ["mac/p1", "mac/q1", "job:j-blocked"]);
    assert_eq!(view.badge, 3);
    let first = &view.groups[0].items[0];
    assert_eq!(first.kind, AttentionKind::Permission);
    assert_eq!(first.title, "Test release 1.2", "the session title leads");
    assert_eq!(first.detail.as_deref(), Some("Run p1?"));
    assert_eq!(first.device_name.as_deref(), Some("mac-mini"));
    assert_eq!(first.age_ms, Some(100));
    assert_eq!(first.answerable, Some(true));
    assert!(first.prompt.is_some());
    assert_eq!(view.groups[0].items[1].kind, AttentionKind::Question);
    assert_eq!(
        view.groups[0].items[1].source.job_id.as_deref(),
        Some("j-blocked-covered")
    );
    let blocked = &view.groups[0].items[2];
    assert_eq!(blocked.answerable, Some(false));
    assert_eq!(blocked.reason.as_deref(), Some("prompt_not_indexed"));
    assert_eq!(blocked.source.conversation_id.as_deref(), Some("c1"));
    assert_eq!(blocked.source.device_id, "linux");

    assert_eq!(ids(&view.groups[1]), ["job:j-done"]);
    assert_eq!(view.groups[1].items[0].unread, Some(true));
    // Newest failure first, jobs and sessions together.
    assert_eq!(
        ids(&view.groups[2]),
        ["job:j-failed", "session:win/s3", "session:mac/s2"]
    );
    let untitled = &view.groups[2].items[1];
    assert_eq!(
        untitled.title, "repo",
        "an untitled session shows its workspace"
    );
    assert_eq!(untitled.kind, AttentionKind::Failure);
    assert_eq!(view.readable.len(), 4);
}

#[test]
fn read_items_leave_until_they_change_and_prompts_are_never_read() {
    let devices = vec![device(
        "mac",
        "mac-mini",
        vec![session("s2", "Fix lexer", FleetSessionStatus::Error, 800)],
    )];
    let prompts = vec![prompt("mac", "s2", "p1", None)];
    let jobs = vec![job("j-done", "done", 700)];
    let inputs = AttentionInputs {
        devices: &devices,
        prompts: &prompts,
        jobs: &jobs,
        now_ms: 1_000,
    };
    let read = |id: &str, stamp: u64| {
        (id == "session:mac/s2" && stamp <= 800) || (id == "job:j-done" && stamp <= 700)
    };
    let view = project_attention(&inputs, &read);
    let groups: Vec<&str> = view.groups.iter().map(|group| group.id.as_str()).collect();
    assert_eq!(groups, ["needs_you"], "empty groups are left out");
    assert!(view.readable.is_empty());
    assert_eq!(view.badge, 1);

    // The same session fails again later: it is unread again.
    let devices = vec![device(
        "mac",
        "mac-mini",
        vec![session("s2", "Fix lexer", FleetSessionStatus::Error, 850)],
    )];
    let inputs = AttentionInputs {
        devices: &devices,
        prompts: &[],
        jobs: &jobs,
        now_ms: 1_000,
    };
    let view = project_attention(&inputs, &read);
    assert_eq!(view.groups.len(), 1);
    assert_eq!(ids(&view.groups[0]), ["session:mac/s2"]);
    assert_eq!(view.badge, 0);
}

#[test]
fn wire_shapes_match_the_inbox_and_read_tolerantly() {
    let view = FleetAttentionView {
        revision: 7,
        groups: vec![AttentionGroup {
            id: ATTENTION_GROUP_FAILED.into(),
            items: vec![AttentionItem {
                item_id: "session:mac/s2".into(),
                kind: AttentionKind::Failure,
                source: AttentionSource {
                    device_id: "mac".into(),
                    session_id: Some("s2".into()),
                    ..AttentionSource::default()
                },
                title: "Fix lexer".into(),
                unread: Some(true),
                ..AttentionItem::default()
            }],
        }],
        badge: 0,
    };
    let wire = serde_json::to_value(&view).unwrap();
    assert_eq!(
        wire,
        json!({"revision": 7, "badge": 0, "groups": [{"id": "failed", "items": [{
            "itemId": "session:mac/s2", "kind": "failure",
            "source": {"deviceId": "mac", "sessionId": "s2"},
            "title": "Fix lexer", "unread": true
        }]}]})
    );
    let back: FleetAttentionView = serde_json::from_value(wire).unwrap();
    assert_eq!(back, view);
    let newer: AttentionItem =
        serde_json::from_value(json!({"itemId": "x", "kind": "reminder", "future": 1})).unwrap();
    assert_eq!(newer.kind, AttentionKind::Unknown);
    let request: FleetAttentionMarkReadRequest =
        serde_json::from_value(json!({"revision": null})).unwrap();
    assert_eq!(request.revision, 0);
    assert!(AttentionJob::from_value(&json!({"title": "no id"})).is_none());
    assert!(AttentionJob::from_value(&json!("garbage")).is_none());
}

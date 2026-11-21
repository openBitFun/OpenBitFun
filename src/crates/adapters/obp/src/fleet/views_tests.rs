//! The entry's view verbs over a real index and a fake cloud node: the
//! Recent list, the device page with jobs from the index and the cloud
//! ledger, the wire shapes, and the refusal for an unknown device.

use std::sync::{Arc, Mutex};

use serde_json::{json, Value};

use super::*;
use crate::fleet::sync::{FleetPeerPresence, FleetPeerSubscription, FleetPeerTransport};
use crate::fleet::{FleetCallError, FleetFuture};

const CLOUD: &str = "cloud-3f2a9c";

/// The cloud node's `superagent_status`.
struct CloudStatus {
    status: Value,
    calls: Mutex<u32>,
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
        _device_id: &str,
        _command: &str,
        _args: Value,
    ) -> FleetFuture<'_, Result<Value, FleetCallError>> {
        *self.calls.lock().unwrap() += 1;
        let answer = self.status.clone();
        Box::pin(async move { Ok(answer) })
    }
}

fn presence(id: &str, kind: FleetHostKind, online: bool) -> FleetPeerPresence {
    FleetPeerPresence {
        device_id: id.into(),
        name: format!("{id}-box"),
        host_kind: kind,
        online,
        mesh: true,
        as_of_ms: 1,
        ..FleetPeerPresence::default()
    }
}

fn session(id: &str, status: FleetSessionStatus, at: u64, dispatch: bool) -> FleetSession {
    FleetSession {
        workspace_id: "w1".into(),
        session_id: id.into(),
        title: format!("Session {id}"),
        status,
        last_activity_ms: at,
        origin: dispatch.then_some(FleetSessionOrigin::Dispatch),
        ..FleetSession::default()
    }
}

fn digest(device: &str, sessions: Vec<FleetSession>, prompts: Vec<FleetPrompt>) -> FleetDigest {
    FleetDigest {
        device_id: device.into(),
        instance_id: format!("{device}-1"),
        revision: 1,
        full: true,
        workspaces: vec![FleetWorkspace {
            workspace_id: "w1".into(),
            name: "openbitfun".into(),
            root_path: "/src/openbitfun".into(),
            ..FleetWorkspace::default()
        }],
        sessions,
        prompts,
        ..FleetDigest::default()
    }
}

fn setup() -> (Arc<CloudStatus>, Arc<FleetViews>) {
    let index = FleetIndex::new("entry".into(), None, None);
    index.set_presence(&[
        presence("mac", FleetHostKind::Desktop, true),
        presence("linux", FleetHostKind::Cli, true),
        presence(CLOUD, FleetHostKind::Cloud, true),
    ]);
    index.apply_digest(
        "mac",
        None,
        digest(
            "mac",
            vec![
                session("s-run", FleetSessionStatus::Running, 50, false),
                session("s-old", FleetSessionStatus::Idle, 5, false),
                session("j-run", FleetSessionStatus::Running, 40, true),
                session("j-wait", FleetSessionStatus::Waiting, 30, true),
            ],
            vec![FleetPrompt {
                workspace_id: "w1".into(),
                session_id: "j-wait".into(),
                kind: FleetPromptKind::Permission,
                prompt_id: "p1".into(),
                title: "Run tests?".into(),
                answerable: true,
                answer_route: FleetAnswerRoute::Dispatch,
                job_id: Some("J1".into()),
                ..FleetPrompt::default()
            }],
        ),
    );
    index.apply_digest(
        "linux",
        None,
        digest(
            "linux",
            vec![session("l1", FleetSessionStatus::Idle, 45, false)],
            Vec::new(),
        ),
    );
    // linux goes offline: its partition stays, its jobs wait in the ledger.
    index.set_presence(&[
        presence("mac", FleetHostKind::Desktop, true),
        presence("linux", FleetHostKind::Cli, false),
        presence(CLOUD, FleetHostKind::Cloud, true),
    ]);
    let card = |id: &str, device: &str, state: &str| {
        json!({"jobId": id, "deviceId": device, "title": format!("Job {id}"), "state": state,
               "stateReason": "waiting_for_device", "updatedMs": 10})
    };
    let cloud = Arc::new(CloudStatus {
        status: json!({"workingNow": {
            "needsYou": [card("J1", "mac", "blocked")],
            "working": [card("J9", "linux", "queued"), card("J8", "mac", "working")],
        }}),
        calls: Mutex::new(0),
    });
    let attention = FleetAttention::new(
        Arc::clone(&index),
        Arc::clone(&cloud) as Arc<dyn FleetPeerTransport>,
        None,
    );
    (cloud, FleetViews::new(index, attention))
}

#[tokio::test]
async fn recent_sessions_list_every_device_newest_first() {
    let (cloud, views) = setup();
    let wire = views
        .handle("fleet_recent_sessions", &json!({"request": {"limit": 3}}))
        .await
        .unwrap()
        .unwrap();
    let rows: Vec<(&str, &str)> = wire["sessions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|row| {
            (
                row["deviceId"].as_str().unwrap(),
                row["sessionId"].as_str().unwrap(),
            )
        })
        .collect();
    assert_eq!(rows, [("mac", "s-run"), ("linux", "l1"), ("mac", "j-run")]);
    assert_eq!(wire["sessions"][1]["deviceName"], "linux-box");
    assert_eq!(wire["sessions"][1]["deviceState"], "offline");
    assert_eq!(wire["sessions"][1]["workspaceName"], "openbitfun");
    let next = wire["nextCursor"].as_str().unwrap().to_string();

    let rest = views
        .handle(
            "fleet_recent_sessions",
            &json!({"request": {"limit": 3, "cursor": next}}),
        )
        .await
        .unwrap()
        .unwrap();
    let ids: Vec<&str> = rest["sessions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|row| row["sessionId"].as_str().unwrap())
        .collect();
    assert_eq!(ids, ["j-wait", "s-old"]);
    assert!(rest.get("nextCursor").is_none());
    // The Recent list never calls a device.
    assert_eq!(*cloud.calls.lock().unwrap(), 0);
    assert!(views.handle("fleet_navigator", &json!({})).await.is_none());
}

#[tokio::test]
async fn device_detail_shows_running_and_waiting_work() {
    let (cloud, views) = setup();
    let wire = views
        .handle(
            "fleet_device_detail",
            &json!({"request": {"deviceId": "mac"}}),
        )
        .await
        .unwrap()
        .unwrap();
    assert_eq!(wire["device"]["deviceId"], "mac");
    assert_eq!(wire["device"]["workspaces"][0]["name"], "openbitfun");
    assert_eq!(wire["runningSessions"], 1);
    assert_eq!(wire["running"]["sessions"][0]["sessionId"], "s-run");
    assert_eq!(wire["runningJobs"], 1);
    assert_eq!(wire["running"]["jobs"][0]["sessionId"], "j-run");
    // The blocked dispatch job once (the index and the ledger agree on J1).
    assert_eq!(wire["waitingJobs"], 1);
    assert_eq!(wire["waiting"]["jobs"][0]["jobId"], "J1");
    assert_eq!(wire["waiting"]["jobs"][0]["promptId"], "p1");
    assert_eq!(wire["waiting"]["jobs"][0]["source"], "device");
    assert_eq!(*cloud.calls.lock().unwrap(), 1);

    // The offline device: the ledger's queued job waits for it.
    let linux = views
        .device_detail(&FleetDeviceDetailRequest {
            device_id: "linux".into(),
        })
        .await
        .unwrap();
    assert_eq!(linux.device.state, FleetDeviceState::Offline);
    assert_eq!(linux.running_sessions, 0);
    assert_eq!(linux.waiting_jobs, 1);
    let queued = &linux.waiting.jobs[0];
    assert_eq!(queued.job_id.as_deref(), Some("J9"));
    assert_eq!(queued.state, FleetDeviceJobState::Queued);
    assert_eq!(queued.source, FleetDeviceJobSource::Cloud);
    assert_eq!(queued.state_reason.as_deref(), Some("waiting_for_device"));
    assert_eq!(linux.capabilities, ["terminal", "git"]);
    // The cloud read is shared and reused.
    assert_eq!(*cloud.calls.lock().unwrap(), 1);
}

#[tokio::test]
async fn device_detail_of_this_host_and_of_an_unknown_device() {
    let (_, views) = setup();
    let own = views
        .handle("fleet_device_detail", &json!({"request": {}}))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(own["device"]["deviceId"], "entry");
    let unknown = views
        .handle(
            "fleet_device_detail",
            &json!({"request": {"deviceId": "ghost"}}),
        )
        .await
        .unwrap()
        .unwrap_err();
    assert_eq!(
        unknown, "fleet_device_offline: ghost (device_unknown)",
        "the answer fleet_call gives for the same device"
    );
    let invalid = views
        .handle("fleet_device_detail", &json!({"request": {"deviceId": 7}}))
        .await
        .unwrap()
        .unwrap_err();
    assert!(invalid.starts_with("invalid fleet request"), "{invalid}");
}

fn catalog(ids: &[&str]) -> Vec<FleetModel> {
    ids.iter()
        .map(|id| FleetModel {
            model_id: id.to_string(),
            display_name: id.to_uppercase(),
            provider: "openai".into(),
            primary: ids.first() == Some(id),
            ..FleetModel::default()
        })
        .collect()
}

#[tokio::test]
async fn the_model_catalog_groups_every_device_and_follows_deltas() {
    let index = FleetIndex::new("entry".into(), None, None);
    index.set_self_facts(FleetDeviceFacts {
        device_id: "entry".into(),
        name: "Studio".into(),
        host_kind: FleetHostKind::Desktop,
        is_client_device: true,
        state: FleetDeviceState::Online,
        ..FleetDeviceFacts::default()
    });
    index.set_presence(&[
        presence("mac", FleetHostKind::Desktop, true),
        presence("linux", FleetHostKind::Cli, true),
        presence("old", FleetHostKind::Desktop, true),
        presence(CLOUD, FleetHostKind::Cloud, true),
    ]);
    let mut entry = digest("entry", Vec::new(), Vec::new());
    entry.models = Some(catalog(&["local"]));
    index.apply_digest("entry", None, entry);
    let mut mac = digest("mac", Vec::new(), Vec::new());
    mac.models = Some(catalog(&["big", "fast"]));
    index.apply_digest("mac", None, mac);
    index.apply_digest("old", None, digest("old", Vec::new(), Vec::new()));
    let mut linux = digest("linux", Vec::new(), Vec::new());
    linux.models = Some(catalog(&["srv"]));
    index.apply_digest("linux", None, linux);
    let before = index.revision();
    // A delta that changes only the catalog moves the index.
    let delta = FleetDigest {
        device_id: "mac".into(),
        instance_id: "mac-1".into(),
        revision: 2,
        full: false,
        models: Some(catalog(&["fast"])),
        ..FleetDigest::default()
    };
    index.apply_digest("mac", Some(1), delta);
    assert!(index.revision() > before);
    // A delta without a catalog keeps the held one.
    let delta = FleetDigest {
        device_id: "mac".into(),
        instance_id: "mac-1".into(),
        revision: 3,
        full: false,
        ..FleetDigest::default()
    };
    index.apply_digest("mac", Some(2), delta);
    // linux goes offline: its models stay listed but cannot be picked.
    index.set_presence(&[
        presence("mac", FleetHostKind::Desktop, true),
        presence("linux", FleetHostKind::Cli, false),
        presence("old", FleetHostKind::Desktop, true),
        presence(CLOUD, FleetHostKind::Cloud, true),
    ]);
    let attention = FleetAttention::new(
        Arc::clone(&index),
        Arc::new(CloudStatus {
            status: json!({}),
            calls: Mutex::new(0),
        }) as Arc<dyn FleetPeerTransport>,
        None,
    );
    let views = FleetViews::new(Arc::clone(&index), attention);
    let wire = views
        .handle("fleet_models", &json!({"request": {}}))
        .await
        .unwrap()
        .unwrap();
    let devices = wire["devices"].as_array().unwrap();
    let ids: Vec<&str> = devices
        .iter()
        .map(|d| d["deviceId"].as_str().unwrap())
        .collect();
    assert_eq!(ids, ["entry", "mac", "old", "linux"]);
    assert_eq!(devices[0]["isThisDevice"], true);
    assert_eq!(devices[0]["models"][0]["modelRef"], "local");
    assert_eq!(devices[1]["models"].as_array().unwrap().len(), 1);
    assert_eq!(devices[1]["models"][0]["modelRef"], "fleet:mac/fast");
    assert_eq!(devices[1]["models"][0]["selectable"], true);
    assert_eq!(devices[2]["unavailableReason"], "device_requires_update");
    assert_eq!(devices[3]["unavailableReason"], "device_offline");
    assert_eq!(devices[3]["online"], false);
    assert_eq!(devices[3]["models"][0]["selectable"], false);

    // Relative to the device that runs the session.
    let wire = views
        .handle("fleet_models", &json!({"request": {"deviceId": "mac"}}))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(wire["devices"][0]["deviceId"], "mac");
    assert_eq!(wire["devices"][0]["models"][0]["modelRef"], "fast");
    let ids: Vec<&str> = wire["devices"]
        .as_array()
        .unwrap()
        .iter()
        .map(|d| d["deviceId"].as_str().unwrap())
        .collect();
    assert_eq!(ids, ["mac", "old", "entry", "linux"]);
    assert_eq!(
        wire["devices"][2]["models"][0]["modelRef"],
        "fleet:entry/local"
    );
    let (_, models) = index.device_models("mac").unwrap();
    assert_eq!(models.unwrap()[0].model_id, "fast");
}

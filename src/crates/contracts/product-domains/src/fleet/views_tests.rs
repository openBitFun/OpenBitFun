//! The Recent list and the device page: order, paging, labels, job sources,
//! dedup, capabilities, update lines, and tolerant wire shapes.

use serde_json::json;

use super::*;
use crate::fleet::{FleetDeviceActions, FleetWorkspace};

fn session(id: &str, workspace: &str, status: FleetSessionStatus, at: u64) -> FleetSession {
    FleetSession {
        session_id: id.into(),
        workspace_id: workspace.into(),
        title: format!("title {id}"),
        status,
        last_activity_ms: at,
        ..FleetSession::default()
    }
}

fn dispatch(id: &str, status: FleetSessionStatus, at: u64) -> FleetSession {
    FleetSession {
        origin: Some(FleetSessionOrigin::Dispatch),
        ..session(id, "w1", status, at)
    }
}

fn workspace(id: &str, name: &str, sessions: Vec<FleetSession>) -> FleetWorkspace {
    FleetWorkspace {
        workspace_id: id.into(),
        name: name.into(),
        sessions,
        ..FleetWorkspace::default()
    }
}

fn device(id: &str, kind: FleetHostKind, workspaces: Vec<FleetWorkspace>) -> FleetDevice {
    FleetDevice {
        device_id: id.into(),
        name: format!("{id}-name"),
        host_kind: kind,
        state: FleetDeviceState::Online,
        fleet_protocol: Some(1),
        actions: FleetDeviceActions::default(),
        workspaces,
        ..FleetDevice::default()
    }
}

fn ids(page: &FleetRecentSessions) -> Vec<String> {
    page.sessions
        .iter()
        .map(|row| format!("{}/{}", row.session.device_id, row.session.session_id))
        .collect()
}

#[test]
fn recent_lists_every_runtime_device_newest_first_with_labels() {
    let devices = [
        device(
            "cloud-1",
            FleetHostKind::Cloud,
            vec![workspace(
                "cloud-conversations",
                "",
                vec![session(
                    "c1",
                    "cloud-conversations",
                    FleetSessionStatus::Idle,
                    999,
                )],
            )],
        ),
        device(
            "mac",
            FleetHostKind::Desktop,
            vec![
                workspace(
                    "w1",
                    "openbitfun",
                    vec![session("s1", "w1", FleetSessionStatus::Idle, 10)],
                ),
                workspace(
                    "w2",
                    "parser",
                    vec![
                        session("s2", "w2", FleetSessionStatus::Running, 30),
                        FleetSession {
                            parent_session_id: Some("s2".into()),
                            ..session("s2-child", "w2", FleetSessionStatus::Running, 40)
                        },
                    ],
                ),
            ],
        ),
        device(
            "linux",
            FleetHostKind::Cli,
            vec![workspace(
                "w1",
                "infra",
                vec![session("s3", "w1", FleetSessionStatus::Waiting, 20)],
            )],
        ),
    ];
    let page = project_recent_sessions(7, &devices, &FleetRecentSessionsRequest::default());
    // The cloud node's conversations and child sessions are not listed.
    assert_eq!(ids(&page), ["mac/s2", "linux/s3", "mac/s1"]);
    assert_eq!(page.revision, 7);
    assert_eq!(page.next_cursor, None);
    assert!(!page.truncated);
    let first = &page.sessions[0];
    assert_eq!(first.device_name, "mac-name");
    assert_eq!(first.host_kind, FleetHostKind::Desktop);
    assert_eq!(first.device_state, FleetDeviceState::Online);
    assert_eq!(first.workspace_name, "parser");
    assert_eq!(page.sessions[1].workspace_name, "infra");

    // The wire shape: the session fields flat, with the labels beside them.
    let wire = serde_json::to_value(&page).unwrap();
    assert_eq!(wire["sessions"][0]["sessionId"], "s2");
    assert_eq!(wire["sessions"][0]["deviceId"], "mac");
    assert_eq!(wire["sessions"][0]["status"], "running");
    assert_eq!(wire["sessions"][0]["deviceName"], "mac-name");
    assert_eq!(wire["sessions"][0]["hostKind"], "desktop");
    assert!(wire.get("nextCursor").is_none());
}

#[test]
fn recent_pages_follow_the_cursor_without_repeating_or_skipping() {
    // Equal activity on two devices: the order is still total.
    let sessions: Vec<FleetSession> = (0..7)
        .map(|n| {
            session(
                &format!("s{n}"),
                "w1",
                FleetSessionStatus::Idle,
                100 - (n / 2) as u64,
            )
        })
        .collect();
    let devices = [
        device(
            "a.b",
            FleetHostKind::Desktop,
            vec![workspace("w1", "x", sessions.clone())],
        ),
        device(
            "c",
            FleetHostKind::Cli,
            vec![workspace("w1", "y", sessions)],
        ),
    ];
    let mut seen = Vec::new();
    let mut cursor = None;
    let mut pages = 0;
    loop {
        let page = project_recent_sessions(
            1,
            &devices,
            &FleetRecentSessionsRequest {
                limit: Some(4),
                cursor: cursor.clone(),
            },
        );
        pages += 1;
        assert!(page.sessions.len() <= 4);
        seen.extend(ids(&page));
        match page.next_cursor {
            Some(next) => cursor = Some(next),
            None => break,
        }
    }
    assert_eq!(pages, 4);
    assert_eq!(seen.len(), 14);
    let unique: std::collections::BTreeSet<_> = seen.iter().collect();
    assert_eq!(unique.len(), 14);
    // Newest first across devices; device id breaks a tie.
    assert_eq!(&seen[..4], ["a.b/s0", "a.b/s1", "c/s0", "c/s1"]);

    // An unreadable cursor starts over; limits are clamped.
    let restart = project_recent_sessions(
        1,
        &devices,
        &FleetRecentSessionsRequest {
            limit: Some(0),
            cursor: Some("garbage".into()),
        },
    );
    assert_eq!(ids(&restart), ["a.b/s0"]);
    assert!(restart.next_cursor.is_some());
}

#[test]
fn recent_reports_a_window_the_index_cut() {
    let mut cut = workspace(
        "w1",
        "x",
        vec![session("s1", "w1", FleetSessionStatus::Idle, 1)],
    );
    cut.has_more = true;
    let page = project_recent_sessions(
        1,
        &[device("mac", FleetHostKind::Desktop, vec![cut])],
        &FleetRecentSessionsRequest::default(),
    );
    assert!(page.truncated);
}

#[test]
fn device_detail_splits_sessions_running_jobs_and_waiting_jobs() {
    let mac = device(
        "mac",
        FleetHostKind::Desktop,
        vec![workspace(
            "w1",
            "openbitfun",
            vec![
                session("user-run", "w1", FleetSessionStatus::Running, 50),
                session("user-wait", "w1", FleetSessionStatus::Waiting, 40),
                session("idle", "w1", FleetSessionStatus::Idle, 60),
                dispatch("job-run", FleetSessionStatus::Running, 30),
                dispatch("job-wait", FleetSessionStatus::Waiting, 20),
                dispatch("job-done", FleetSessionStatus::Idle, 10),
            ],
        )],
    );
    let prompts = [
        // The blocked dispatch session's prompt (same session, its job id).
        FleetPrompt {
            device_id: "mac".into(),
            workspace_id: "w1".into(),
            session_id: "job-wait".into(),
            prompt_id: "p1".into(),
            title: "Run tests".into(),
            answer_route: FleetAnswerRoute::Dispatch,
            job_id: Some("J1".into()),
            ..FleetPrompt::default()
        },
        // A dispatch prompt whose session the window does not list.
        FleetPrompt {
            device_id: "mac".into(),
            session_id: "unlisted".into(),
            prompt_id: "p2".into(),
            title: "Push branch".into(),
            answer_route: FleetAnswerRoute::Dispatch,
            job_id: Some("J2".into()),
            ..FleetPrompt::default()
        },
        // Another device's prompt.
        FleetPrompt {
            device_id: "linux".into(),
            session_id: "x".into(),
            prompt_id: "p3".into(),
            answer_route: FleetAnswerRoute::Dispatch,
            job_id: Some("J3".into()),
            ..FleetPrompt::default()
        },
    ];
    let cards = [
        // Queued for this device in the cloud ledger.
        JobCard {
            job_id: "J4".into(),
            device_id: "mac".into(),
            title: "Build".into(),
            state: SuperagentJobState::Queued,
            ..JobCard::default()
        },
        // Already covered by the index (its prompt is held).
        JobCard {
            job_id: "J2".into(),
            device_id: "mac".into(),
            state: SuperagentJobState::Blocked,
            ..JobCard::default()
        },
        // Blocked, prompt not indexed yet.
        JobCard {
            job_id: "J5".into(),
            device_id: "mac".into(),
            state: SuperagentJobState::Blocked,
            ..JobCard::default()
        },
        // Working jobs come from the device itself, not the ledger.
        JobCard {
            job_id: "J6".into(),
            device_id: "mac".into(),
            state: SuperagentJobState::Working,
            ..JobCard::default()
        },
        // Another device.
        JobCard {
            job_id: "J7".into(),
            device_id: "linux".into(),
            state: SuperagentJobState::Queued,
            ..JobCard::default()
        },
    ];
    let detail = project_device_detail(9, &mac, &prompts, &cards);
    assert_eq!(detail.revision, 9);
    assert_eq!(detail.device.device_id, "mac");
    let session_ids: Vec<&str> = detail
        .running
        .sessions
        .iter()
        .map(|s| s.session_id.as_str())
        .collect();
    assert_eq!(session_ids, ["user-run", "user-wait"]);
    assert_eq!(detail.running_sessions, 2);
    assert_eq!(detail.running_jobs, 1);
    let running = &detail.running.jobs[0];
    assert_eq!(running.session_id.as_deref(), Some("job-run"));
    assert_eq!(running.state, FleetDeviceJobState::Running);
    assert!(running.open.allowed);

    let waiting: Vec<(
        Option<&str>,
        Option<&str>,
        FleetDeviceJobState,
        FleetDeviceJobSource,
    )> = detail
        .waiting
        .jobs
        .iter()
        .map(|job| {
            (
                job.job_id.as_deref(),
                job.session_id.as_deref(),
                job.state,
                job.source,
            )
        })
        .collect();
    assert_eq!(
        waiting,
        [
            (
                Some("J4"),
                None,
                FleetDeviceJobState::Queued,
                FleetDeviceJobSource::Cloud
            ),
            (
                Some("J1"),
                Some("job-wait"),
                FleetDeviceJobState::Blocked,
                FleetDeviceJobSource::Device
            ),
            (
                Some("J2"),
                Some("unlisted"),
                FleetDeviceJobState::Blocked,
                FleetDeviceJobSource::Device
            ),
            (
                Some("J5"),
                None,
                FleetDeviceJobState::Blocked,
                FleetDeviceJobSource::Cloud
            ),
        ]
    );
    assert_eq!(detail.waiting_jobs, 4);
    assert_eq!(
        detail.waiting.jobs[0].state_reason.as_deref(),
        Some(REASON_WAITING_FOR_DEVICE)
    );
    assert_eq!(detail.waiting.jobs[1].prompt_id.as_deref(), Some("p1"));
    assert_eq!(
        detail.waiting.jobs[3].state_reason.as_deref(),
        Some(REASON_PROMPT_NOT_INDEXED)
    );
    assert_eq!(detail.capabilities, ["terminal", "git", "browser", "jobs"]);
    assert_eq!(detail.update, None);

    let wire = serde_json::to_value(&detail).unwrap();
    assert_eq!(wire["runningSessions"], 2);
    assert_eq!(wire["runningJobs"], 1);
    assert_eq!(wire["waitingJobs"], 4);
    assert_eq!(wire["waiting"]["jobs"][0]["state"], "queued");
    assert_eq!(wire["waiting"]["jobs"][0]["source"], "cloud");
    assert_eq!(wire["device"]["name"], "mac-name");
    assert!(wire.get("update").is_none());
}

#[test]
fn offline_device_keeps_its_jobs_but_cannot_open_them() {
    let mut mac = device(
        "mac",
        FleetHostKind::Desktop,
        vec![workspace(
            "w1",
            "x",
            vec![dispatch("job-run", FleetSessionStatus::Running, 1)],
        )],
    );
    mac.state = FleetDeviceState::Offline;
    let detail = project_device_detail(1, &mac, &[], &[]);
    let gate = &detail.running.jobs[0].open;
    assert!(!gate.allowed);
    assert_eq!(gate.reason.as_deref(), Some("device_offline"));
}

#[test]
fn capabilities_and_update_lines_follow_the_device_kind() {
    let mut desktop = device("mac", FleetHostKind::Desktop, Vec::new());
    desktop.host_capabilities = vec!["computer_use_sharing_v1".into()];
    assert_eq!(
        device_capabilities(&desktop),
        ["terminal", "git", "browser", "desktop", "jobs"]
    );
    let mut cli = device("linux", FleetHostKind::Cli, Vec::new());
    cli.fleet_protocol = None;
    assert_eq!(device_capabilities(&cli), ["terminal", "git"]);
    assert!(device_capabilities(&device("cloud-1", FleetHostKind::Cloud, Vec::new())).is_empty());

    cli.state = FleetDeviceState::UpdateRequired;
    cli.state_reason = Some("relay_only_host".into());
    let update = device_update(&cli).unwrap();
    assert!(update.available);
    assert!(!update.can_update_remotely);
    assert_eq!(update.command.as_deref(), Some(CLI_UPDATE_COMMAND));
    assert_eq!(update.reason.as_deref(), Some("relay_only_host"));
    desktop.state = FleetDeviceState::UpdateRequired;
    assert_eq!(device_update(&desktop).unwrap().command, None);
}

#[test]
fn view_shapes_read_tolerantly() {
    // Nulls, missing and unknown fields, and values from a newer build.
    let request: FleetRecentSessionsRequest =
        serde_json::from_value(json!({"limit": null, "extra": 1})).unwrap();
    assert_eq!(request, FleetRecentSessionsRequest::default());
    let request: FleetDeviceDetailRequest =
        serde_json::from_value(json!({"deviceId": null})).unwrap();
    assert_eq!(request.device_id, "");

    let page: FleetRecentSessions = serde_json::from_value(json!({
        "revision": null,
        "sessions": [{"sessionId": "s1", "deviceId": "mac", "status": "paused_by_newer",
                      "deviceName": null, "hostKind": "toaster", "newField": true}],
    }))
    .unwrap();
    assert_eq!(page.sessions[0].session.session_id, "s1");
    assert_eq!(page.sessions[0].session.status, FleetSessionStatus::Unknown);
    assert_eq!(page.sessions[0].host_kind, FleetHostKind::Unknown);

    let detail: FleetDeviceDetail = serde_json::from_value(json!({
        "device": {"deviceId": "mac", "fleetProtocol": null},
        "waiting": {"jobs": [{"state": "paused", "source": "elsewhere", "open": null}]},
        "update": null,
    }))
    .unwrap();
    assert_eq!(detail.device.device_id, "mac");
    assert_eq!(detail.waiting.jobs[0].state, FleetDeviceJobState::Unknown);
    assert_eq!(detail.waiting.jobs[0].source, FleetDeviceJobSource::Unknown);
    assert_eq!(detail.update, None);
}

use super::*;

use std::sync::atomic::AtomicUsize;

fn workspace(id: &str) -> FleetWorkspace {
    FleetWorkspace {
        workspace_id: id.to_string(),
        name: id.to_string(),
        root_path: format!("/w/{id}"),
        ..Default::default()
    }
}

fn session(workspace_id: &str, id: &str, at: u64) -> FleetSession {
    FleetSession {
        workspace_id: workspace_id.to_string(),
        session_id: id.to_string(),
        last_activity_ms: at,
        ..Default::default()
    }
}

fn prompt(id: &str) -> FleetPrompt {
    FleetPrompt {
        session_id: "s1".into(),
        kind: FleetPromptKind::Permission,
        prompt_id: id.to_string(),
        answerable: true,
        ..Default::default()
    }
}

fn since(revision: u64) -> FleetDigestRequest {
    FleetDigestRequest {
        since_revision: Some(revision),
        instance_id: Some("inst-1".to_string()),
    }
}

#[test]
fn journal_answers_deltas_tombstones_and_full_snapshots() {
    let mut journal = FleetDigestJournal::new("dev-a".into(), "inst-1".into());
    let first = FleetDigestSnapshot {
        workspaces: vec![workspace("w1")],
        sessions: vec![session("w1", "s1", 10), session("w1", "s2", 20)],
        prompts: vec![prompt("p1")],
        sessions_truncated: false,
        models: None,
    };
    assert!(journal.absorb(first.clone()));
    let r1 = journal.revision();
    assert!(
        !journal.absorb(first),
        "an unchanged snapshot keeps the revision"
    );
    assert_eq!(journal.revision(), r1);

    let full = journal.digest(&FleetDigestRequest::default());
    assert!(full.full);
    assert_eq!(full.device_id, "dev-a");
    assert_eq!(full.sessions.len(), 2);
    assert!(full.sessions.iter().all(|s| s.device_id == "dev-a"));
    let p1_revision = full.prompts[0].revision;
    assert!(
        p1_revision > 0,
        "a prompt gets the revision it was first seen at"
    );

    // s1 changes, s2 goes, p1 stays, p2 arrives.
    let mut s1 = session("w1", "s1", 30);
    s1.status = FleetSessionStatus::Running;
    assert!(journal.absorb(FleetDigestSnapshot {
        workspaces: vec![workspace("w1")],
        sessions: vec![s1],
        prompts: vec![prompt("p1"), prompt("p2")],
        sessions_truncated: false,
        models: None,
    }));
    let delta = journal.digest(&since(r1));
    assert!(!delta.full);
    assert_eq!(delta.revision, journal.revision());
    assert!(
        delta.workspaces.is_empty(),
        "unchanged workspace not resent"
    );
    assert_eq!(delta.sessions.len(), 1);
    assert_eq!(delta.sessions[0].status, FleetSessionStatus::Running);
    assert_eq!(delta.removed.session_ids, vec!["s2".to_string()]);
    assert_eq!(delta.prompts.len(), 1);
    assert_eq!(delta.prompts[0].prompt_id, "p2");
    let held = journal.digest(&FleetDigestRequest::default());
    let p1 = held.prompts.iter().find(|p| p.prompt_id == "p1").unwrap();
    assert_eq!(
        p1.revision, p1_revision,
        "a held prompt keeps its first-seen revision"
    );

    // Another instance, an unknown or a future revision: full.
    let other = FleetDigestRequest {
        since_revision: Some(r1),
        instance_id: Some("inst-0".into()),
    };
    assert!(journal.digest(&other).full);
    assert!(journal.digest(&since(journal.revision() + 10)).full);
    assert!(
        journal
            .digest(&FleetDigestRequest {
                since_revision: Some(r1),
                instance_id: None,
            })
            .full
    );

    // A prompt answered is removed by id.
    assert!(journal.absorb(FleetDigestSnapshot {
        workspaces: vec![workspace("w1")],
        sessions: vec![],
        prompts: vec![prompt("p2")],
        sessions_truncated: true,
        models: None,
    }));
    let r3 = journal.revision();
    let delta = journal.digest(&since(r3 - 1));
    assert_eq!(delta.removed.prompt_ids, vec!["p1".to_string()]);
    assert!(delta.sessions_truncated);
    // A delta from the current revision is empty.
    let empty = journal.digest(&since(r3));
    assert!(!empty.full && empty.sessions.is_empty() && empty.removed.is_empty());
}

#[test]
fn journal_floor_moves_when_tombstones_are_trimmed() {
    let mut journal = FleetDigestJournal::new("dev-a".into(), "inst-1".into());
    let start = journal.revision();
    for round in 0..(MAX_TOMBSTONES + 10) {
        journal.absorb(FleetDigestSnapshot {
            sessions: vec![session("w", &format!("s{round}"), round as u64)],
            ..Default::default()
        });
    }
    assert!(journal.digest(&since(start)).full, "older than the window");
    let recent = journal.revision() - 1;
    assert!(!journal.digest(&since(recent)).full);
}

struct ScriptedSource {
    reads: AtomicUsize,
    snapshot: Mutex<FleetDigestSnapshot>,
}

impl FleetDigestSource for ScriptedSource {
    fn snapshot(&self) -> FleetDigestFuture<'_, Result<FleetDigestSnapshot, String>> {
        self.reads.fetch_add(1, Ordering::SeqCst);
        let snapshot = self.snapshot.lock().unwrap().clone();
        Box::pin(async move { Ok(snapshot) })
    }
}

#[derive(Default)]
struct RecordingEmitter {
    events: Mutex<Vec<(String, Value)>>,
}

#[async_trait::async_trait]
impl EventEmitter for RecordingEmitter {
    async fn emit(&self, event_name: &str, payload: Value) -> anyhow::Result<()> {
        self.events
            .lock()
            .unwrap()
            .push((event_name.to_string(), payload));
        Ok(())
    }
}

#[tokio::test]
async fn producer_coalesces_changes_into_one_hint() {
    let source = Arc::new(ScriptedSource {
        reads: AtomicUsize::new(0),
        snapshot: Mutex::new(FleetDigestSnapshot {
            workspaces: vec![workspace("w1")],
            ..Default::default()
        }),
    });
    let emitter = Arc::new(RecordingEmitter::default());
    let producer = FleetDigestProducer::with_coalesce(
        "dev-a".into(),
        "inst-1".into(),
        source.clone(),
        Some(emitter.clone()),
        Duration::from_millis(50),
    );
    let first = producer
        .digest(FleetDigestRequest::default())
        .await
        .unwrap();
    assert!(first.full);
    assert_eq!(first.instance_id, "inst-1");

    source
        .snapshot
        .lock()
        .unwrap()
        .sessions
        .push(session("w1", "s1", 5));
    let reads_before = source.reads.load(Ordering::SeqCst);
    for _ in 0..5 {
        producer.notify_changed();
    }
    tokio::time::sleep(Duration::from_millis(300)).await;
    let events = emitter.events.lock().unwrap().clone();
    assert_eq!(events.len(), 1, "{events:?}");
    assert_eq!(events[0].0, FLEET_DIGEST_CHANGED_EVENT);
    assert_eq!(events[0].1["revision"], producer.revision().await);
    assert_eq!(source.reads.load(Ordering::SeqCst), reads_before + 1);

    let delta = producer.digest(since(first.revision)).await.unwrap();
    assert!(!delta.full);
    assert_eq!(delta.sessions.len(), 1);

    // No change, no hint.
    producer.notify_changed();
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(emitter.events.lock().unwrap().len(), 1);
}

#[test]
fn dispatch_prompts_route_to_the_job_mailbox() {
    let request: PermissionRequest = serde_json::from_value(json!({
        "requestId": "perm-9", "roundId": "r", "order": 0, "projectId": "p",
        "sessionId": "job-session", "agentId": "a", "action": "bash",
        "resources": ["cargo test"], "source": {"kind": "tool_call", "identity": "Bash"}
    }))
    .expect("a permission request");
    let prompt = dispatch_prompt(
        "ws-1".into(),
        &FleetDispatchPrompt {
            job_id: "job-1".into(),
            session_id: "job-session".into(),
            workspace_path: "/w/ws-1".into(),
            title: "Fix CI".into(),
            request,
        },
    );
    assert_eq!(prompt.answer_route, FleetAnswerRoute::Dispatch);
    assert_eq!(prompt.job_id.as_deref(), Some("job-1"));
    assert_eq!(prompt.prompt_id, "perm-9");
    assert_eq!(prompt.kind, FleetPromptKind::Permission);
    assert!(prompt.answerable);
    assert_eq!(prompt.tool_name.as_deref(), Some("Bash"));
    let wire = serde_json::to_value(&prompt).unwrap();
    assert_eq!(wire["answerRoute"], "dispatch");
    assert_eq!(wire["jobId"], "job-1");
}

#[test]
fn dispatch_questions_route_to_the_job_question_mailbox() {
    let prompt = dispatch_question_prompt(
        "ws-1".into(),
        &FleetDispatchQuestion {
            job_id: "job-2".into(),
            session_id: "job-session".into(),
            workspace_path: "/w/ws-1".into(),
            title: "fallback".into(),
            request_id: "tool-7".into(),
            questions: json!({"questions": [{"question": "Which db?", "header": "DB",
                "options": [{"label": "sqlite", "description": ""}]}]}),
            registered_at_ms: 42,
        },
    );
    assert_eq!(prompt.kind, FleetPromptKind::Question);
    assert_eq!(prompt.answer_route, FleetAnswerRoute::Dispatch);
    assert_eq!(prompt.job_id.as_deref(), Some("job-2"));
    assert_eq!(prompt.prompt_id, "tool-7");
    assert_eq!(prompt.title, "Which db?");
    assert_eq!(prompt.revision, 42);
    assert_eq!(prompt.tool_name.as_deref(), Some("AskUserQuestion"));
    assert_eq!(
        prompt.payload.as_ref().unwrap()["questions"][0]["header"],
        "DB"
    );
    // A source without a question mailbox has no questions.
    struct PermissionsOnly;
    impl FleetDispatchPromptSource for PermissionsOnly {
        fn pending_dispatch_prompts(&self) -> Result<Vec<FleetDispatchPrompt>, String> {
            Ok(Vec::new())
        }
    }
    assert!(PermissionsOnly
        .pending_dispatch_questions()
        .unwrap()
        .is_empty());
}

#[test]
fn session_status_prefers_waiting_then_running() {
    let activity = |execution: &str, approvals: usize| SessionActivitySummary {
        session_id: "s".into(),
        execution: execution.into(),
        active_turn_id: None,
        pending_approvals: approvals,
        pending_questions: 0,
        last_turn: None,
        unread_completion: None,
        unread_turn: None,
        unread: None,
        failed: None,
    };
    assert_eq!(session_status(None), FleetSessionStatus::Idle);
    assert_eq!(
        session_status(Some(&activity("running", 1))),
        FleetSessionStatus::Waiting
    );
    assert_eq!(
        session_status(Some(&activity("queued", 0))),
        FleetSessionStatus::Running
    );
    assert_eq!(
        session_status(Some(&activity("error", 0))),
        FleetSessionStatus::Error
    );
    assert_eq!(
        session_status(Some(&activity("external", 0))),
        FleetSessionStatus::Idle
    );
    assert!(is_digest_relevant_event("agentic://dialog-turn-started"));
    assert!(is_digest_relevant_event("agentic://dialog-turn-completed"));
    assert!(is_digest_relevant_event("agentic://dialog-turn-failed"));
    assert!(is_digest_relevant_event("agentic://dialog-turn-cancelled"));
    assert!(is_digest_relevant_event("agentic://session-created"));
    assert!(is_digest_relevant_event("agentic://session-deleted"));
    assert!(is_digest_relevant_event("agentic://session-state-changed"));
    assert!(is_digest_relevant_event(
        "agentic://session-title-generated"
    ));
    assert!(is_digest_relevant_event("workspace-opened"));
    assert!(is_digest_relevant_event("permission-requested"));
    assert!(is_digest_relevant_event("dispatch-job-updated"));
    assert!(!is_digest_relevant_event("agentic://text-chunk"));
    assert!(!is_digest_relevant_event("agentic://thinking-chunk"));
    assert!(!is_digest_relevant_event("agentic://tool-event"));
    assert!(!is_digest_relevant_event("agentic://token-usage-updated"));
    assert!(!is_digest_relevant_event("agentic://model-round-started"));
    assert!(!is_digest_relevant_event("agentic://model-round-completed"));
    assert!(!is_digest_relevant_event("agentic://prompt-suggestion"));
    assert!(!is_digest_relevant_event("fleet://digest-changed"));
    assert!(!is_digest_relevant_event("terminal-output"));
}

#[test]
fn the_model_catalog_rides_every_answer_and_a_change_moves_the_revision() {
    use openbitfun_product_domains::fleet::FleetModel;
    let model = |id: &str, primary: bool| FleetModel {
        model_id: id.to_string(),
        display_name: id.to_uppercase(),
        primary,
        ..FleetModel::default()
    };
    let mut journal = FleetDigestJournal::new("dev-a".into(), "inst-1".into());
    let snapshot = |models: Vec<FleetModel>| FleetDigestSnapshot {
        workspaces: vec![workspace("w1")],
        models: Some(models),
        ..FleetDigestSnapshot::default()
    };
    assert!(journal.absorb(snapshot(vec![model("a", true)])));
    let r1 = journal.revision();
    assert!(!journal.absorb(snapshot(vec![model("a", true)])));
    let full = journal.digest(&FleetDigestRequest::default());
    assert_eq!(full.models.as_ref().unwrap()[0].model_id, "a");
    // Only the catalog changed: a new revision, and the delta carries it.
    assert!(journal.absorb(snapshot(vec![model("a", false), model("b", true)])));
    let delta = journal.digest(&since(r1));
    assert!(!delta.full && delta.workspaces.is_empty());
    let ids: Vec<String> = delta
        .models
        .unwrap()
        .into_iter()
        .map(|m| m.model_id)
        .collect();
    assert_eq!(ids, ["a", "b"]);
    // An empty delta still carries the catalog whole.
    let empty = journal.digest(&since(journal.revision()));
    assert_eq!(empty.models.map(|m| m.len()), Some(2));
}

#[test]
fn workspace_summary_preserves_remote_connection_metadata() {
    use openbitfun_services_core::workspace_records::{
        WorkspaceInfo, WorkspaceKind, WorkspaceStatus, WorkspaceType,
    };
    use std::collections::HashMap;
    use std::path::PathBuf;

    let make = |id: &str,
                path: &str,
                kind: WorkspaceKind,
                metadata: HashMap<String, serde_json::Value>| {
        WorkspaceInfo {
            id: id.to_string(),
            name: id.to_string(),
            root_path: PathBuf::from(path),
            workspace_type: WorkspaceType::Other,
            workspace_kind: kind,
            assistant_id: None,
            status: WorkspaceStatus::Active,
            languages: Vec::new(),
            opened_at: chrono::Utc::now(),
            last_accessed: chrono::Utc::now(),
            description: None,
            tags: Vec::new(),
            statistics: None,
            identity: None,
            worktree: None,
            related_paths: Vec::new(),
            metadata,
        }
    };

    let mut remote_meta = HashMap::new();
    remote_meta.insert(
        "sshHost".to_string(),
        serde_json::Value::String("190.92.203.184".to_string()),
    );
    remote_meta.insert(
        "connectionId".to_string(),
        serde_json::Value::String("ssh-root@190.92.203.184".to_string()),
    );
    remote_meta.insert(
        "connectionName".to_string(),
        serde_json::Value::String("Prod SSH".to_string()),
    );
    let remote = make(
        "remote_1",
        "/root/repos",
        WorkspaceKind::Remote,
        remote_meta,
    );

    let projected = workspace_summary(&remote, Some(&remote.id));
    assert_eq!(projected.kind, FleetWorkspaceKind::RemoteSsh);
    assert_eq!(projected.ssh_host.as_deref(), Some("190.92.203.184"));
    assert_eq!(
        projected.connection_id.as_deref(),
        Some("ssh-root@190.92.203.184")
    );
    assert_eq!(projected.connection_name.as_deref(), Some("Prod SSH"));
    assert!(projected.is_host_current);

    let local = make(
        "local_1",
        "/Users/dev/OpenBitFun",
        WorkspaceKind::Normal,
        HashMap::new(),
    );
    let projected_local = workspace_summary(&local, None);
    assert_eq!(projected_local.kind, FleetWorkspaceKind::Local);
    assert_eq!(projected_local.connection_id, None);
    assert_eq!(projected_local.connection_name, None);

    // Closed workspaces in `recent_workspaces` (without `dispatchTracked`) must
    // not reappear in the fleet digest, while Detached Dispatch worktrees do.
    let closed_recent = make(
        "closed_1",
        "/Users/dev/Closed",
        WorkspaceKind::Normal,
        HashMap::new(),
    );
    let mut dispatch_meta = HashMap::new();
    dispatch_meta.insert("dispatchTracked".to_string(), serde_json::Value::Bool(true));
    let dispatch_recent = make(
        "dispatch_1",
        "/Users/dev/Worktree",
        WorkspaceKind::Normal,
        dispatch_meta,
    );
    let selected = collect_fleet_digest_workspaces(
        vec![local.clone(), remote.clone()],
        vec![local, closed_recent, dispatch_recent],
    );
    let ids: Vec<&str> = selected.iter().map(|ws| ws.id.as_str()).collect();
    assert_eq!(ids, vec!["local_1", "remote_1", "dispatch_1"]);
}

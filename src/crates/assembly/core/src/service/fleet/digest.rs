//! The fleet digest of this runtime host (`fleet_digest`).
//!
//! [`FleetDigestProducer`] turns snapshots of the existing owners into one
//! owner partition with revisions: every change of a workspace, session or
//! prompt summary gets the next revision, removals are remembered as
//! tombstones, and a request `{sinceRevision, instanceId}` inside that window
//! is answered with a delta (`full: false`, `removed`), anything else with a
//! full snapshot. Changes are coalesced (300 ms) into one
//! `fleet://digest-changed {revision}` event, which is the hint every other
//! host pulls on.
//!
//! [`CoreFleetDigestSource`] reads the owners: the workspace catalog (opened
//! and recent), the first sessions page of each workspace with its Runtime
//! activity, the Runtime permission and user-question mailboxes, and the
//! Detached Dispatch permission mailbox through [`FleetDispatchPromptSource`]
//! (the dispatch store is owned by the CLI host). Only summaries leave the
//! host: never transcripts, turns, files, config or credentials. The digest
//! also carries this device's model catalog (ids, names, providers,
//! capabilities, the primary; never endpoints or keys).

use std::collections::{BTreeMap, HashMap};
use std::future::Future;
use std::path::Path;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use openbitfun_events::EventEmitter;
use openbitfun_product_domains::fleet::*;
use openbitfun_product_domains::tool_permissions::PermissionRequest;
use serde_json::{json, Value};
use tokio::sync::Notify;

/// Changes within this window become one digest revision and one hint.
pub const FLEET_DIGEST_COALESCE: Duration = Duration::from_millis(300);
/// Removals remembered for deltas; older `sinceRevision`s get a full answer.
const MAX_TOMBSTONES: usize = 4096;

/// A boxed future borrowing its receiver.
pub type FleetDigestFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// One reading of the owners, already projected to fleet summaries.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct FleetDigestSnapshot {
    pub workspaces: Vec<FleetWorkspace>,
    pub sessions: Vec<FleetSession>,
    pub prompts: Vec<FleetPrompt>,
    pub sessions_truncated: bool,
    /// This device's configured models (`models::catalog_of`); every
    /// answer carries them (`None` publishes no catalog, like an older
    /// build).
    pub models: Option<Vec<FleetModel>>,
}

/// Where the producer reads its snapshots.
pub trait FleetDigestSource: Send + Sync + 'static {
    fn snapshot(&self) -> FleetDigestFuture<'_, Result<FleetDigestSnapshot, String>>;
}

/// One pending permission request of a Detached Dispatch job on this host.
#[derive(Debug, Clone)]
pub struct FleetDispatchPrompt {
    pub job_id: String,
    pub session_id: String,
    /// The job's workspace path (its worktree), POSIX or native.
    pub workspace_path: String,
    pub title: String,
    pub request: PermissionRequest,
}

/// One waiting `AskUserQuestion` of a Detached Dispatch job on this host
/// (`user_question_mailbox_v1`).
#[derive(Debug, Clone)]
pub struct FleetDispatchQuestion {
    pub job_id: String,
    pub session_id: String,
    pub workspace_path: String,
    pub title: String,
    /// The tool call id (the job mailbox's request id).
    pub request_id: String,
    /// The AskUserQuestion payload (`{questions: [...]}`).
    pub questions: Value,
    pub registered_at_ms: u64,
}

/// The dispatch store's pending permission mailbox (read-only).
pub trait FleetDispatchPromptSource: Send + Sync + 'static {
    fn pending_dispatch_prompts(&self) -> Result<Vec<FleetDispatchPrompt>, String>;
    /// The question mailbox; a store without one has none.
    fn pending_dispatch_questions(&self) -> Result<Vec<FleetDispatchQuestion>, String> {
        Ok(Vec::new())
    }
}

// ---------------------------------------------------------------------------
// Revisions and deltas
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Kind {
    Workspace,
    Session,
    Prompt,
}

/// The owner partition with per-item revisions.
#[derive(Debug, Default)]
pub struct FleetDigestJournal {
    device_id: String,
    instance_id: String,
    revision: u64,
    floor: u64,
    workspaces: BTreeMap<String, (FleetWorkspace, u64)>,
    sessions: BTreeMap<String, (FleetSession, u64)>,
    prompts: BTreeMap<String, (FleetPrompt, u64)>,
    tombstones: Vec<(Kind, String, u64)>,
    sessions_truncated: bool,
    models: Option<Vec<FleetModel>>,
    absorbed: bool,
}

fn prompt_key(prompt: &FleetPrompt) -> String {
    let kind = match prompt.kind {
        FleetPromptKind::Permission => "permission",
        FleetPromptKind::Question => "question",
        FleetPromptKind::Unknown => "unknown",
    };
    format!("{kind}:{}", prompt.prompt_id)
}

impl FleetDigestJournal {
    pub fn new(device_id: String, instance_id: String) -> Self {
        Self {
            device_id,
            instance_id,
            revision: 1,
            floor: 1,
            ..Default::default()
        }
    }

    pub fn revision(&self) -> u64 {
        self.revision
    }

    pub fn instance_id(&self) -> &str {
        &self.instance_id
    }

    /// Take a snapshot in; returns whether anything changed (and so the
    /// revision moved).
    pub fn absorb(&mut self, snapshot: FleetDigestSnapshot) -> bool {
        let next = self.revision + 1;
        let mut changed = false;
        let device_id = self.device_id.clone();

        let mut workspaces = BTreeMap::new();
        for mut workspace in snapshot.workspaces {
            if workspace.workspace_id.is_empty() {
                continue;
            }
            workspace.device_id = device_id.clone();
            workspace.sessions.clear();
            workspaces.insert(workspace.workspace_id.clone(), workspace);
        }
        changed |= absorb_map(
            &mut self.workspaces,
            workspaces,
            next,
            Kind::Workspace,
            &mut self.tombstones,
        );

        let mut sessions = BTreeMap::new();
        for mut session in snapshot.sessions {
            if session.session_id.is_empty() {
                continue;
            }
            session.device_id = device_id.clone();
            sessions.insert(session.session_id.clone(), session);
        }
        changed |= absorb_map(
            &mut self.sessions,
            sessions,
            next,
            Kind::Session,
            &mut self.tombstones,
        );

        let mut prompts = BTreeMap::new();
        for mut prompt in snapshot.prompts {
            if prompt.prompt_id.is_empty() {
                continue;
            }
            prompt.device_id = device_id.clone();
            let key = prompt_key(&prompt);
            // A prompt keeps the revision it was first seen at: the tray
            // orders by it (oldest first).
            if prompt.revision == 0 {
                prompt.revision = self
                    .prompts
                    .get(&key)
                    .map_or(next, |(held, _)| held.revision);
            }
            prompts.insert(key, prompt);
        }
        changed |= absorb_map(
            &mut self.prompts,
            prompts,
            next,
            Kind::Prompt,
            &mut self.tombstones,
        );

        if snapshot.sessions_truncated != self.sessions_truncated {
            self.sessions_truncated = snapshot.sessions_truncated;
            changed = true;
        }
        let mut models = snapshot.models;
        if let Some(models) = models.as_mut() {
            bound_catalog(models);
        }
        if models != self.models {
            self.models = models;
            changed = true;
        }
        if changed {
            self.revision = next;
        }
        if self.tombstones.len() > MAX_TOMBSTONES {
            let drop = self.tombstones.len() - MAX_TOMBSTONES;
            self.floor = self.floor.max(self.tombstones[drop - 1].2);
            self.tombstones.drain(..drop);
        }
        self.absorbed = true;
        changed
    }

    /// Answer `fleet_digest`.
    pub fn digest(&self, request: &FleetDigestRequest) -> FleetDigest {
        let delta_from = request.since_revision.filter(|since| {
            request.instance_id.as_deref() == Some(self.instance_id.as_str())
                && *since >= self.floor
                && *since <= self.revision
        });
        let after = delta_from.unwrap_or(0);
        let pick = |at: u64| at > after;
        let mut removed = FleetDigestRemovals::default();
        if delta_from.is_some() {
            for (kind, id, at) in &self.tombstones {
                if !pick(*at) {
                    continue;
                }
                match kind {
                    Kind::Workspace => removed.workspace_ids.push(id.clone()),
                    Kind::Session => removed.session_ids.push(id.clone()),
                    Kind::Prompt => removed.prompt_ids.push(
                        id.split_once(':')
                            .map_or(id.clone(), |(_, id)| id.to_string()),
                    ),
                }
            }
        }
        FleetDigest {
            device_id: self.device_id.clone(),
            instance_id: self.instance_id.clone(),
            revision: self.revision,
            full: delta_from.is_none(),
            workspaces: self
                .workspaces
                .values()
                .filter(|(_, at)| pick(*at))
                .map(|(item, _)| item.clone())
                .collect(),
            sessions: self
                .sessions
                .values()
                .filter(|(_, at)| pick(*at))
                .map(|(item, _)| item.clone())
                .collect(),
            prompts: self
                .prompts
                .values()
                .filter(|(_, at)| pick(*at))
                .map(|(item, _)| item.clone())
                .collect(),
            removed,
            sessions_truncated: self.sessions_truncated,
            // The catalog is small: every answer carries it whole.
            models: self.models.clone(),
        }
    }
}

fn absorb_map<T: PartialEq>(
    held: &mut BTreeMap<String, (T, u64)>,
    next: BTreeMap<String, T>,
    revision: u64,
    kind: Kind,
    tombstones: &mut Vec<(Kind, String, u64)>,
) -> bool {
    let mut changed = false;
    let gone: Vec<String> = held
        .keys()
        .filter(|key| !next.contains_key(*key))
        .cloned()
        .collect();
    for key in gone {
        held.remove(&key);
        tombstones.push((kind, key, revision));
        changed = true;
    }
    for (key, item) in next {
        match held.get_mut(&key) {
            Some((current, _)) if *current == item => {}
            Some(entry) => {
                *entry = (item, revision);
                changed = true;
            }
            None => {
                tombstones.retain(|(k, id, _)| !(*k == kind && *id == key));
                held.insert(key, (item, revision));
                changed = true;
            }
        }
    }
    changed
}

// ---------------------------------------------------------------------------
// The producer
// ---------------------------------------------------------------------------

/// This host's digest: snapshots in, revisions and deltas out, one coalesced
/// `fleet://digest-changed` hint per burst of changes.
pub struct FleetDigestProducer {
    source: Arc<dyn FleetDigestSource>,
    emitter: Option<Arc<dyn EventEmitter>>,
    journal: tokio::sync::Mutex<FleetDigestJournal>,
    dirty: AtomicBool,
    wake: Arc<Notify>,
    worker: Mutex<Option<tokio::task::JoinHandle<()>>>,
    coalesce: Duration,
}

impl FleetDigestProducer {
    /// `instance_id` is the host's OBP backend instance, so the digest and
    /// the event cursors share one owner key.
    pub fn new(
        device_id: String,
        instance_id: String,
        source: Arc<dyn FleetDigestSource>,
        emitter: Option<Arc<dyn EventEmitter>>,
    ) -> Arc<Self> {
        Self::with_coalesce(
            device_id,
            instance_id,
            source,
            emitter,
            FLEET_DIGEST_COALESCE,
        )
    }

    pub fn with_coalesce(
        device_id: String,
        instance_id: String,
        source: Arc<dyn FleetDigestSource>,
        emitter: Option<Arc<dyn EventEmitter>>,
        coalesce: Duration,
    ) -> Arc<Self> {
        Arc::new(Self {
            source,
            emitter,
            journal: tokio::sync::Mutex::new(FleetDigestJournal::new(device_id, instance_id)),
            dirty: AtomicBool::new(true),
            wake: Arc::new(Notify::new()),
            worker: Mutex::new(None),
            coalesce,
        })
    }

    /// The current digest revision.
    pub async fn revision(&self) -> u64 {
        self.journal.lock().await.revision()
    }

    /// Answer `fleet_digest`. Reads the owners first when a change is
    /// pending, nothing was read yet, or a full snapshot is asked for
    /// (anti-entropy repairs a missed change notification too).
    pub async fn digest(&self, request: FleetDigestRequest) -> Result<FleetDigest, String> {
        let mut journal = self.journal.lock().await;
        let pending = self.dirty.swap(false, Ordering::SeqCst);
        if pending || !journal.absorbed || request.since_revision.is_none() {
            match self.source.snapshot().await {
                Ok(snapshot) => {
                    journal.absorb(snapshot);
                }
                Err(error) => {
                    if pending {
                        self.dirty.store(true, Ordering::SeqCst);
                    }
                    if !journal.absorbed {
                        return Err(error);
                    }
                    log::warn!("Fleet digest snapshot failed, answering the held one: {error}");
                }
            }
        }
        Ok(journal.digest(&request))
    }

    /// Re-read the owners now; returns the revision when it moved.
    pub async fn refresh(&self) -> Result<Option<u64>, String> {
        self.dirty.store(false, Ordering::SeqCst);
        let snapshot = self.source.snapshot().await.inspect_err(|_| {
            self.dirty.store(true, Ordering::SeqCst);
        })?;
        let mut journal = self.journal.lock().await;
        Ok(journal.absorb(snapshot).then(|| journal.revision()))
    }

    /// Re-read the owners now and immediately announce `fleet://digest-changed`
    /// when the revision moved (used after explicit local mutations such as
    /// closing or renaming a workspace).
    pub async fn refresh_and_announce(&self) -> Result<Option<u64>, String> {
        let moved = self.refresh().await?;
        if let Some(revision) = moved {
            self.announce(revision).await;
        }
        Ok(moved)
    }

    /// An owner changed (a workspace, session, turn state or prompt). The
    /// change is read after the coalescing window and announced once.
    pub fn notify_changed(self: &Arc<Self>) {
        self.dirty.store(true, Ordering::SeqCst);
        self.ensure_worker();
        self.wake.notify_one();
    }

    fn ensure_worker(self: &Arc<Self>) {
        let mut worker = self.worker.lock().unwrap_or_else(|p| p.into_inner());
        if worker.as_ref().is_some_and(|handle| !handle.is_finished()) {
            return;
        }
        let Ok(runtime) = tokio::runtime::Handle::try_current() else {
            return;
        };
        let weak = Arc::downgrade(self);
        let wake = Arc::clone(&self.wake);
        *worker = Some(runtime.spawn(async move {
            loop {
                wake.notified().await;
                let Some(producer) = weak.upgrade() else {
                    return;
                };
                tokio::time::sleep(producer.coalesce).await;
                match producer.refresh().await {
                    Ok(Some(revision)) => producer.announce(revision).await,
                    Ok(None) => {}
                    Err(error) => log::warn!("Fleet digest refresh failed: {error}"),
                }
            }
        }));
    }

    async fn announce(&self, revision: u64) {
        let Some(emitter) = self.emitter.as_ref() else {
            return;
        };
        let payload = json!(FleetDigestChanged { revision });
        if let Err(error) = emitter.emit(FLEET_DIGEST_CHANGED_EVENT, payload).await {
            log::warn!("Fleet digest hint not delivered: {error}");
        }
    }
}

impl Drop for FleetDigestProducer {
    fn drop(&mut self) {
        if let Some(worker) = self.worker.lock().unwrap_or_else(|p| p.into_inner()).take() {
            worker.abort();
        }
    }
}

/// Whether a host event may change the digest (hosts call
/// [`FleetDigestProducer::notify_changed`] for these).
///
/// Only lifecycle and state-changing `agentic://` events match; high-frequency
/// streaming deltas (`agentic://text-chunk`, `agentic://thinking-chunk`,
/// `agentic://tool-event`, `agentic://token-usage-updated`, model round ticks)
/// are excluded so streaming never triggers repeated workspace disk scans.
pub fn is_digest_relevant_event(event: &str) -> bool {
    const AGENTIC_LIFECYCLE_EVENTS: &[&str] = &[
        "agentic://session-created",
        "agentic://session-deleted",
        "agentic://session-state-changed",
        "agentic://session-history-changed",
        "agentic://session-title-generated",
        "agentic://dialog-turn-started",
        "agentic://dialog-turn-completed",
        "agentic://dialog-turn-failed",
        "agentic://dialog-turn-cancelled",
        "agentic://dialog-turn-interrupted",
        "agentic://dialog-turn-recovered",
        "agentic://subagent-session-linked",
        "agentic://thread-goal-updated",
    ];
    const PREFIXES: &[&str] = &[
        "session",
        "workspace",
        "permission",
        "user-question",
        "user_question",
        "dispatch",
    ];
    if event.starts_with(FLEET_EVENT_PREFIX) {
        return false;
    }
    if event.starts_with("agentic://") {
        return AGENTIC_LIFECYCLE_EVENTS.contains(&event);
    }
    PREFIXES.iter().any(|prefix| event.starts_with(prefix))
}

// ---------------------------------------------------------------------------
// Projections of the owners' types
// ---------------------------------------------------------------------------

use openbitfun_services_core::session::page::SessionActivitySummary;
use openbitfun_services_core::session::types::SessionMetadata;
use openbitfun_services_core::workspace_records::{WorkspaceInfo, WorkspaceKind};

/// A path as the fleet carries it: POSIX separators on every client OS.
fn posix(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

/// Selects workspaces published in this host's fleet digest: all opened
/// workspaces plus any non-opened recent workspaces explicitly tracked for
/// Detached Dispatch jobs (`dispatchTracked == true`). User-closed workspaces
/// stay in `recent_workspaces` for quick reopen and are excluded here.
pub(crate) fn collect_fleet_digest_workspaces(
    mut opened: Vec<WorkspaceInfo>,
    recent: Vec<WorkspaceInfo>,
) -> Vec<WorkspaceInfo> {
    opened.extend(recent.into_iter().filter(|info| {
        info.metadata
            .get("dispatchTracked")
            .and_then(Value::as_bool)
            .unwrap_or(false)
    }));
    let mut seen = std::collections::HashSet::new();
    opened.retain(|info| !info.id.trim().is_empty() && seen.insert(info.id.clone()));
    opened
}

/// A workspace record as a fleet workspace summary.
pub fn workspace_summary(info: &WorkspaceInfo, current_id: Option<&str>) -> FleetWorkspace {
    let meta_str = |key: &str| {
        info.metadata
            .get(key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    };
    let (kind, ssh_host, connection_id, connection_name) = match info.workspace_kind {
        WorkspaceKind::Assistant => (FleetWorkspaceKind::Assistant, None, None, None),
        WorkspaceKind::Remote => (
            FleetWorkspaceKind::RemoteSsh,
            meta_str("sshHost"),
            meta_str("connectionId"),
            meta_str("connectionName"),
        ),
        _ => (FleetWorkspaceKind::Local, None, None, None),
    };
    FleetWorkspace {
        device_id: String::new(),
        workspace_id: info.id.clone(),
        name: info.name.clone(),
        root_path: posix(&info.root_path),
        kind,
        ssh_host,
        connection_id,
        connection_name,
        link_state: None,
        is_host_current: current_id == Some(info.id.as_str()),
        sessions: Vec::new(),
        session_total: 0,
        has_more: false,
    }
}

/// The session status of a Runtime activity: waiting on a prompt first,
/// then running (or queued), then error, else idle.
pub fn session_status(activity: Option<&SessionActivitySummary>) -> FleetSessionStatus {
    let Some(activity) = activity else {
        return FleetSessionStatus::Idle;
    };
    if activity.pending_approvals > 0 || activity.pending_questions > 0 {
        return FleetSessionStatus::Waiting;
    }
    match activity.execution.as_str() {
        "running" | "queued" => FleetSessionStatus::Running,
        "error" => FleetSessionStatus::Error,
        _ => FleetSessionStatus::Idle,
    }
}

/// `dispatch` / `bot` origin from a session's custom metadata.
fn session_origin(metadata: &SessionMetadata) -> Option<FleetSessionOrigin> {
    let custom = metadata.custom_metadata.as_ref()?;
    let text = |key: &str| {
        custom
            .get(key)
            .and_then(Value::as_str)
            .filter(|v| !v.is_empty())
    };
    if text("dispatchJobId")
        .or_else(|| text("dispatch_job_id"))
        .is_some()
    {
        return Some(FleetSessionOrigin::Dispatch);
    }
    match text("origin").or_else(|| text("source")) {
        Some("dispatch") => Some(FleetSessionOrigin::Dispatch),
        Some("bot" | "im_bot") => Some(FleetSessionOrigin::Bot),
        _ => None,
    }
}

/// A session record (with its activity) as a fleet session summary.
pub fn session_summary(
    workspace_id: &str,
    metadata: &SessionMetadata,
    activity: Option<&SessionActivitySummary>,
) -> FleetSession {
    let status = session_status(activity);
    let failed = activity.and_then(|a| a.failed).unwrap_or(false);
    let unread = activity
        .and_then(|a| a.unread.or(Some(a.unread_completion.is_some())))
        .unwrap_or(false);
    FleetSession {
        device_id: String::new(),
        workspace_id: workspace_id.to_string(),
        session_id: metadata.session_id.clone(),
        parent_session_id: metadata
            .relationship
            .as_ref()
            .and_then(|relationship| relationship.parent_session_id.clone()),
        title: metadata.session_name.clone(),
        agent_type: metadata.agent_type.clone(),
        status,
        unread,
        needs_attention: status == FleetSessionStatus::Waiting || failed,
        last_activity_ms: metadata.last_active_at,
        origin: session_origin(metadata),
    }
}

/// A Runtime permission request as a prompt.
pub fn permission_prompt(workspace_id: String, request: &PermissionRequest) -> FleetPrompt {
    let payload = serde_json::to_value(request).ok();
    let title = request
        .display_metadata
        .get("title")
        .or_else(|| request.display_metadata.get("summary"))
        .and_then(Value::as_str)
        .unwrap_or(&request.action)
        .to_string();
    // The tool of a tool-call request is the source identity.
    let tool_name = (request.source.kind
        == openbitfun_product_domains::tool_permissions::PermissionRequestSourceKind::ToolCall)
        .then(|| request.source.identity.clone())
        .filter(|identity| !identity.is_empty());
    FleetPrompt {
        device_id: String::new(),
        workspace_id,
        session_id: request.session_id.clone(),
        kind: FleetPromptKind::Permission,
        prompt_id: request.request_id.clone(),
        revision: 0,
        title,
        tool_name,
        payload,
        payload_truncated: false,
        answerable: true,
        unanswerable_reason: None,
        answer_route: FleetAnswerRoute::Runtime,
        job_id: None,
    }
}

/// A pending user question as a prompt.
pub fn question_prompt(
    workspace_id: String,
    question: &openbitfun_agent_runtime::user_questions::PendingUserQuestion,
) -> FleetPrompt {
    let title = question
        .questions
        .get("questions")
        .and_then(Value::as_array)
        .and_then(|list| list.first())
        .and_then(|first| first.get("question").or_else(|| first.get("header")))
        .or_else(|| question.questions.get("question"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    FleetPrompt {
        device_id: String::new(),
        workspace_id,
        session_id: question.session_id.clone(),
        kind: FleetPromptKind::Question,
        prompt_id: question.tool_id.clone(),
        revision: question.registered_at_ms,
        title,
        tool_name: Some("AskUserQuestion".to_string()),
        payload: Some(question.questions.clone()),
        payload_truncated: false,
        answerable: true,
        unanswerable_reason: None,
        answer_route: FleetAnswerRoute::Runtime,
        job_id: None,
    }
}

/// A dispatch job's pending permission as a prompt, answered through the
/// job's permission mailbox (`dispatch_target_answer` on this host).
pub fn dispatch_prompt(workspace_id: String, prompt: &FleetDispatchPrompt) -> FleetPrompt {
    let mut out = permission_prompt(workspace_id, &prompt.request);
    if !prompt.session_id.is_empty() {
        out.session_id = prompt.session_id.clone();
    }
    if out.title.is_empty() {
        out.title = prompt.title.clone();
    }
    out.answer_route = FleetAnswerRoute::Dispatch;
    out.job_id = Some(prompt.job_id.clone());
    out
}

/// A dispatch job's waiting question as a prompt, answered through the job's
/// question mailbox (`dispatch_target_answer {answers}` on this host).
pub fn dispatch_question_prompt(
    workspace_id: String,
    question: &FleetDispatchQuestion,
) -> FleetPrompt {
    let title = question
        .questions
        .get("questions")
        .and_then(Value::as_array)
        .and_then(|list| list.first())
        .and_then(|first| first.get("question").or_else(|| first.get("header")))
        .and_then(Value::as_str)
        .map(str::to_string)
        .filter(|title| !title.is_empty())
        .unwrap_or_else(|| question.title.clone());
    FleetPrompt {
        device_id: String::new(),
        workspace_id,
        session_id: question.session_id.clone(),
        kind: FleetPromptKind::Question,
        prompt_id: question.request_id.clone(),
        revision: question.registered_at_ms,
        title,
        tool_name: Some("AskUserQuestion".to_string()),
        payload: Some(question.questions.clone()),
        payload_truncated: false,
        answerable: true,
        unanswerable_reason: None,
        answer_route: FleetAnswerRoute::Dispatch,
        job_id: Some(question.job_id.clone()),
    }
}

// ---------------------------------------------------------------------------
// The core owners
// ---------------------------------------------------------------------------

/// Reads the core owners of a desktop or CLI host.
pub struct CoreFleetDigestSource {
    workspace_service: Arc<crate::service::workspace::WorkspaceService>,
    compatibility: crate::product_runtime::CoreAgentRuntimeCompatibility,
    agent_runtime: openbitfun_agent_runtime::sdk::AgentRuntime,
    dispatch: Option<Arc<dyn FleetDispatchPromptSource>>,
}

impl CoreFleetDigestSource {
    pub fn new(
        workspace_service: Arc<crate::service::workspace::WorkspaceService>,
        compatibility: crate::product_runtime::CoreAgentRuntimeCompatibility,
        agent_runtime: openbitfun_agent_runtime::sdk::AgentRuntime,
    ) -> Self {
        Self {
            workspace_service,
            compatibility,
            agent_runtime,
            dispatch: None,
        }
    }

    /// Include the Detached Dispatch store's pending permissions.
    pub fn with_dispatch_prompts(mut self, dispatch: Arc<dyn FleetDispatchPromptSource>) -> Self {
        self.dispatch = Some(dispatch);
        self
    }

    async fn read(&self) -> Result<FleetDigestSnapshot, String> {
        use openbitfun_runtime_ports::SessionStorePort;

        let service = &self.workspace_service;
        let current = service.get_current_workspace().await.map(|info| info.id);
        let mut records = collect_fleet_digest_workspaces(
            service.get_opened_workspaces().await,
            service.get_recent_workspaces().await,
        );
        let mut snapshot = FleetDigestSnapshot {
            models: Some(super::models::local_catalog().await),
            ..FleetDigestSnapshot::default()
        };
        if records.len() > MAX_WORKSPACES_PER_DEVICE {
            records.truncate(MAX_WORKSPACES_PER_DEVICE);
            snapshot.sessions_truncated = true;
        }
        let store = crate::agentic::session::CoreSessionStorePort::default();
        for info in &records {
            let mut workspace = workspace_summary(info, current.as_deref());
            let page = match store.resolve_workspace_storage(&info.id).await {
                Ok(resolution) => self
                    .compatibility
                    .list_persisted_sessions_page_with_activity(
                        &self.agent_runtime,
                        &resolution.effective_storage_path,
                        None,
                        MAX_TOP_LEVEL_SESSIONS_PER_WORKSPACE,
                        None,
                    )
                    .await
                    .map_err(|error| error.to_string()),
                Err(error) => Err(error.to_string()),
            };
            match page {
                Ok(page) => {
                    let activities: HashMap<&str, &SessionActivitySummary> = page
                        .activities
                        .iter()
                        .flatten()
                        .map(|activity| (activity.session_id.as_str(), activity))
                        .collect();
                    workspace.session_total =
                        page.total_top_level_count.min(u32::MAX as usize) as u32;
                    workspace.has_more = page.has_more;
                    for metadata in &page.sessions {
                        snapshot.sessions.push(session_summary(
                            &info.id,
                            metadata,
                            activities.get(metadata.session_id.as_str()).copied(),
                        ));
                    }
                }
                Err(error) => {
                    // An unreadable workspace stays listed; its sessions are
                    // fetched from the owner on demand.
                    log::debug!(
                        "Fleet digest skipped a workspace's sessions: workspace_id={}, error={}",
                        info.id,
                        error
                    );
                    workspace.has_more = true;
                }
            }
            snapshot.workspaces.push(workspace);
        }

        let workspace_of: HashMap<String, String> = snapshot
            .sessions
            .iter()
            .map(|session| (session.session_id.clone(), session.workspace_id.clone()))
            .collect();
        let resolve = |session_id: &str, parent: Option<&str>| {
            workspace_of
                .get(session_id)
                .or_else(|| parent.and_then(|parent| workspace_of.get(parent)))
                .cloned()
                .unwrap_or_default()
        };
        match self.agent_runtime.pending_permission_requests() {
            Ok(requests) => {
                for request in &requests {
                    let parent = request
                        .delegation
                        .as_ref()
                        .map(|delegation| delegation.parent_session_id.as_str());
                    snapshot.prompts.push(permission_prompt(
                        resolve(&request.session_id, parent),
                        request,
                    ));
                }
            }
            Err(error) => log::debug!("Fleet digest without permissions: {}", error.into_message()),
        }
        let questions = openbitfun_agent_runtime::user_questions::get_user_input_manager();
        for session_id in questions.pending_question_counts().into_keys() {
            for question in questions.pending_question_snapshot(&session_id).questions {
                if question.session_id != session_id {
                    continue;
                }
                snapshot.prompts.push(question_prompt(
                    resolve(&question.session_id, None),
                    &question,
                ));
            }
        }
        if let Some(dispatch) = self.dispatch.as_ref() {
            match dispatch.pending_dispatch_prompts() {
                Ok(prompts) => {
                    for prompt in &prompts {
                        let path = prompt.workspace_path.replace('\\', "/");
                        let workspace_id = snapshot
                            .workspaces
                            .iter()
                            .find(|workspace| workspace.root_path == path)
                            .map(|workspace| workspace.workspace_id.clone())
                            .unwrap_or_else(|| resolve(&prompt.session_id, None));
                        snapshot.prompts.push(dispatch_prompt(workspace_id, prompt));
                    }
                }
                Err(error) => log::debug!("Fleet digest without dispatch prompts: {error}"),
            }
            match dispatch.pending_dispatch_questions() {
                Ok(questions) => {
                    for question in &questions {
                        let path = question.workspace_path.replace('\\', "/");
                        let workspace_id = snapshot
                            .workspaces
                            .iter()
                            .find(|workspace| workspace.root_path == path)
                            .map(|workspace| workspace.workspace_id.clone())
                            .unwrap_or_else(|| resolve(&question.session_id, None));
                        snapshot
                            .prompts
                            .push(dispatch_question_prompt(workspace_id, question));
                    }
                }
                Err(error) => log::debug!("Fleet digest without dispatch questions: {error}"),
            }
        }
        Ok(snapshot)
    }
}

impl FleetDigestSource for CoreFleetDigestSource {
    fn snapshot(&self) -> FleetDigestFuture<'_, Result<FleetDigestSnapshot, String>> {
        Box::pin(self.read())
    }
}

#[cfg(test)]
#[path = "digest_tests.rs"]
mod tests;

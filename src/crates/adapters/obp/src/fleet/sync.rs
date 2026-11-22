//! Fleet replication: keeping every peer's partition current.
//!
//! For each other device of the account that is online and reachable over
//! OBP on the device network, the host keeps one index-only link:
//!
//! - a peer with `fleet_v1` is pulled with `fleet_digest {sinceRevision,
//!   instanceId}` on connect, on every `fleet://digest-changed` hint, and on
//!   [`FleetSync::hint`]; a full snapshot is pulled on an instance change, on
//!   a gap, and every [`FleetSyncConfig::anti_entropy`] (anti-entropy);
//! - a mesh peer without `fleet_v1` (a leaf owner) is indexed by polling its
//!   navigator, the first sessions page of each workspace and its pending
//!   permissions, on events (coalesced) and every
//!   [`FleetSyncConfig::legacy_poll`];
//! - a relay-only host (no OBP on the device network) is never dialed; the
//!   index shows it `update_required`.
//!
//! The host's own partition comes from [`FleetBackend::local_digest`] on
//! [`FleetSync::local_changed`]. Losing a link keeps the partition (shown
//! stale) and reconnects with backoff.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};
use tokio::sync::{mpsc, watch, Notify};
use tokio::task::JoinHandle;

use openbitfun_product_domains::fleet::*;

use super::index::{FleetApply, FleetIndex};
use super::router::FleetBackend;
use super::{FleetCallError, FleetFuture};

// ---------------------------------------------------------------------------
// The transport the host provides
// ---------------------------------------------------------------------------

/// One other device of the account, as the host's mesh sees it.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct FleetPeerPresence {
    pub device_id: String,
    pub name: String,
    pub host_kind: FleetHostKind,
    pub online: bool,
    /// The device serves OBP on the device network. `false`: a relay-only
    /// host (Tauri desktop, CLI before wave 9), shown `update_required`.
    pub mesh: bool,
    pub route: Option<FleetDeviceRoute>,
    pub version: Option<String>,
    pub as_of_ms: u64,
    /// This host cannot open a link to the device at all (a cloud node on a
    /// host without a cloud dialer): it is listed `unknown` with this reason
    /// code and never dialed.
    pub unsupported: Option<String>,
}

/// What a peer's `hello` said about it.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct FleetPeerLinkInfo {
    /// The peer backend's process instance (the owner partition key).
    pub instance_id: Option<String>,
    /// Mesh capabilities (`fleet_v1`, `dispatch_target_v1`, ...).
    pub capabilities: Vec<String>,
    /// The registry's peer-host capabilities of that host.
    pub host_capabilities: Vec<String>,
    pub version: Option<String>,
}

impl FleetPeerLinkInfo {
    /// The peer serves the owner verbs `fleet_digest` / `fleet_replay`.
    pub fn serves_fleet(&self) -> bool {
        self.capabilities
            .iter()
            .any(|capability| capability == FLEET_V1_CAPABILITY)
    }
}

/// What arrives on an index link.
#[derive(Debug, Clone, PartialEq)]
pub enum FleetPeerSignal {
    Event { event: String, payload: Value },
    Closed { reason: String },
}

/// An open index link: the peer's hello and its event signals. Dropping the
/// receiver releases the link.
pub struct FleetPeerSubscription {
    pub link: FleetPeerLinkInfo,
    pub signals: mpsc::UnboundedReceiver<FleetPeerSignal>,
}

/// Links to the other devices of the account (the host wraps its
/// `PeerLinks` and Link runtime).
pub trait FleetPeerTransport: Send + Sync + 'static {
    /// The other devices of the account with their presence (never this
    /// host itself).
    fn presence(&self) -> FleetFuture<'_, Vec<FleetPeerPresence>>;
    /// Open (or reuse) the index-only link to a device: for a peer with
    /// `fleet_v1` its hello asks for `events: {prefixes: ["fleet://"]}`.
    fn subscribe_index(
        &self,
        device_id: &str,
    ) -> FleetFuture<'_, Result<FleetPeerSubscription, String>>;
    /// A plain `call` on the link to a device (its own allowlist applies).
    fn call(
        &self,
        device_id: &str,
        command: &str,
        args: Value,
    ) -> FleetFuture<'_, Result<Value, FleetCallError>>;
}

/// Timers of the replication.
#[derive(Debug, Clone)]
pub struct FleetSyncConfig {
    /// Full snapshot pull from every `fleet_v1` peer.
    pub anti_entropy: Duration,
    /// Poll of a mesh peer without `fleet_v1`.
    pub legacy_poll: Duration,
    /// Events of a legacy peer are coalesced into one poll per this window.
    pub legacy_hint_window: Duration,
    /// Presence re-read without a presence hint.
    pub presence_poll: Duration,
    /// Local digests are coalesced into one pull per this window.
    pub local_coalesce: Duration,
    /// Reconnect backoff.
    pub retry_min: Duration,
    pub retry_max: Duration,
    /// Workspaces of a legacy peer read concurrently.
    pub legacy_concurrency: usize,
}

impl Default for FleetSyncConfig {
    fn default() -> Self {
        Self {
            anti_entropy: Duration::from_secs(5 * 60),
            legacy_poll: Duration::from_secs(60),
            legacy_hint_window: Duration::from_secs(2),
            presence_poll: Duration::from_secs(30),
            local_coalesce: Duration::from_millis(300),
            retry_min: Duration::from_secs(1),
            retry_max: Duration::from_secs(60),
            legacy_concurrency: 4,
        }
    }
}

// ---------------------------------------------------------------------------
// The replication driver
// ---------------------------------------------------------------------------

struct PeerTask {
    hint: Arc<Notify>,
    handle: JoinHandle<()>,
}

/// Keeps the index current. One per host.
pub struct FleetSync {
    index: Arc<FleetIndex>,
    backend: Arc<dyn FleetBackend>,
    peers: Arc<dyn FleetPeerTransport>,
    config: FleetSyncConfig,
    tasks: Mutex<HashMap<String, PeerTask>>,
    presence_hint: Notify,
    local_hint: Notify,
    stop: watch::Sender<bool>,
    drivers: Mutex<Vec<JoinHandle<()>>>,
}

impl FleetSync {
    pub fn new(
        index: Arc<FleetIndex>,
        backend: Arc<dyn FleetBackend>,
        peers: Arc<dyn FleetPeerTransport>,
        config: FleetSyncConfig,
    ) -> Arc<Self> {
        let (stop, _) = watch::channel(false);
        Arc::new(Self {
            index,
            backend,
            peers,
            config,
            tasks: Mutex::new(HashMap::new()),
            presence_hint: Notify::new(),
            local_hint: Notify::new(),
            stop,
            drivers: Mutex::new(Vec::new()),
        })
    }

    /// The index this driver keeps.
    pub fn index(&self) -> &Arc<FleetIndex> {
        &self.index
    }

    /// Start the presence and local drivers (needs a Tokio runtime).
    pub fn start(self: &Arc<Self>) {
        let presence = tokio::spawn(Arc::clone(self).presence_loop());
        let local = tokio::spawn(Arc::clone(self).local_loop());
        let mut drivers = self.drivers.lock().unwrap_or_else(|p| p.into_inner());
        drivers.push(presence);
        drivers.push(local);
    }

    /// The mesh presence changed (a device came online, left, or moved).
    pub fn presence_changed(&self) {
        self.presence_hint.notify_one();
    }

    /// This host's own digest changed (`fleet://digest-changed` on its hub).
    pub fn local_changed(&self) {
        self.local_hint.notify_one();
    }

    /// Pull a device now (a hint from elsewhere, a failed forward).
    pub fn hint(&self, device_id: &str) {
        if device_id == self.index.self_device_id() {
            self.local_changed();
            return;
        }
        let tasks = self.tasks.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(task) = tasks.get(device_id) {
            task.hint.notify_one();
        }
    }

    /// Stop every driver and release every index link.
    pub fn shutdown(&self) {
        let _ = self.stop.send(true);
        for (_, task) in self.tasks.lock().unwrap_or_else(|p| p.into_inner()).drain() {
            task.handle.abort();
        }
        for driver in self
            .drivers
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .drain(..)
        {
            driver.abort();
        }
        if let Err(error) = self.index.flush() {
            log::warn!("Fleet index cache not written at shutdown: {error}");
        }
    }

    /// Pull this host's own digest into the index.
    pub async fn refresh_local(&self) -> Result<(), String> {
        self.index.set_self_facts(self.backend.local_facts());
        let self_id = self.index.self_device_id().to_string();
        let cursor = self.index.partition_cursor(&self_id);
        let request = FleetDigestRequest {
            since_revision: cursor.as_ref().map(|(_, revision)| *revision),
            instance_id: cursor.map(|(instance, _)| instance),
        };
        let since = request.since_revision;
        let digest = self.backend.local_digest(request).await?;
        if let FleetApply::NeedFull { .. } = self.index.apply_digest(&self_id, since, digest) {
            let digest = self
                .backend
                .local_digest(FleetDigestRequest::default())
                .await?;
            self.index.apply_digest(&self_id, None, digest);
        }
        Ok(())
    }

    /// Re-read presence and start or stop the per-device links.
    pub async fn refresh_presence(self: &Arc<Self>) {
        let presence = self.peers.presence().await;
        let self_id = self.index.self_device_id().to_string();
        let presence: Vec<FleetPeerPresence> = presence
            .into_iter()
            .filter(|peer| peer.device_id != self_id && !peer.device_id.is_empty())
            .collect();
        self.index.set_presence(&presence);
        let wanted: HashMap<String, ()> = presence
            .iter()
            .filter(|peer| peer.online && peer.mesh && peer.unsupported.is_none())
            .map(|peer| (peer.device_id.clone(), ()))
            .collect();
        let mut tasks = self.tasks.lock().unwrap_or_else(|p| p.into_inner());
        tasks.retain(|device_id, task| {
            let keep = wanted.contains_key(device_id) && !task.handle.is_finished();
            if !keep {
                task.handle.abort();
            }
            keep
        });
        for device_id in wanted.keys() {
            if tasks.contains_key(device_id) {
                continue;
            }
            let hint = Arc::new(Notify::new());
            let handle =
                tokio::spawn(Arc::clone(self).peer_loop(device_id.clone(), Arc::clone(&hint)));
            tasks.insert(device_id.clone(), PeerTask { hint, handle });
        }
        drop(tasks);
        if let Err(error) = self.index.flush() {
            log::warn!("Fleet index cache not written: {error}");
        }
    }

    async fn presence_loop(self: Arc<Self>) {
        let mut stop = self.stop.subscribe();
        loop {
            self.refresh_presence().await;
            tokio::select! {
                _ = self.presence_hint.notified() => {}
                _ = tokio::time::sleep(self.config.presence_poll) => {}
                _ = stop.changed() => return,
            }
        }
    }

    async fn local_loop(self: Arc<Self>) {
        let mut stop = self.stop.subscribe();
        loop {
            if let Err(error) = self.refresh_local().await {
                log::warn!("Fleet local digest unavailable: {error}");
            }
            tokio::select! {
                _ = self.local_hint.notified() => {}
                _ = tokio::time::sleep(self.config.anti_entropy) => {}
                _ = stop.changed() => return,
            }
            // Coalesce a burst of local changes into one pull.
            tokio::time::sleep(self.config.local_coalesce).await;
        }
    }

    async fn peer_loop(self: Arc<Self>, device_id: String, hint: Arc<Notify>) {
        let mut stop = self.stop.subscribe();
        let mut backoff = self.config.retry_min;
        loop {
            match self.peers.subscribe_index(&device_id).await {
                Err(error) => {
                    log::debug!("Fleet index link failed: device_id={device_id}, error={error}");
                    self.index.mark_link_failed(&device_id, &error);
                }
                Ok(subscription) => {
                    backoff = self.config.retry_min;
                    let reason = self
                        .follow(&device_id, subscription, &hint, &mut stop)
                        .await;
                    match reason {
                        None => return,
                        Some(reason) => self.index.mark_link_failed(&device_id, &reason),
                    }
                }
            }
            let _ = self.index.flush();
            tokio::select! {
                _ = tokio::time::sleep(backoff) => {}
                _ = hint.notified() => {}
                _ = stop.changed() => return,
            }
            backoff = (backoff * 2).min(self.config.retry_max);
        }
    }

    /// Follow one index link until it closes (`Some(reason)`) or the driver
    /// stops (`None`).
    async fn follow(
        &self,
        device_id: &str,
        mut subscription: FleetPeerSubscription,
        hint: &Notify,
        stop: &mut watch::Receiver<bool>,
    ) -> Option<String> {
        let link = subscription.link.clone();
        let fleet = link.serves_fleet();
        // The account's cloud node has no workspaces to poll (it serves its
        // own `superagent_*` commands): the link only carries its presence
        // and, while a client follows it, its events.
        let presence_only = !fleet
            && self
                .index
                .device_facts(device_id)
                .is_some_and(|facts| facts.host_kind == FleetHostKind::Cloud);
        self.index.set_link(device_id, link.clone());
        let period = if fleet {
            self.config.anti_entropy
        } else {
            self.config.legacy_poll
        };
        let mut force_full = false;
        loop {
            let outcome = if fleet {
                // A reconnect to the same instance resumes with a delta.
                self.pull_digest(device_id, &link, force_full).await
            } else if presence_only {
                Ok(FleetApply::Applied { changed: false })
            } else {
                self.poll_legacy(device_id, &link).await
            };
            force_full = false;
            if let Err(error) = outcome {
                if error.is_transport() {
                    return Some(error.message);
                }
                log::warn!("Fleet sync of a device failed: device_id={device_id}, error={error}");
            }
            let _ = self.index.flush();
            let deadline = tokio::time::sleep(period);
            tokio::pin!(deadline);
            loop {
                tokio::select! {
                    signal = subscription.signals.recv() => match signal {
                        Some(FleetPeerSignal::Event { event, .. }) => {
                            if fleet {
                                if event == FLEET_DIGEST_CHANGED_EVENT {
                                    break;
                                }
                            } else if presence_only {
                                // Nothing to re-index.
                            } else {
                                // A leaf owner has no digest: any event may
                                // change its summaries. Coalesce without
                                // swallowing a link-closed signal.
                                tokio::time::sleep(self.config.legacy_hint_window).await;
                                while let Ok(queued) = subscription.signals.try_recv() {
                                    if let FleetPeerSignal::Closed { reason } = queued {
                                        return Some(reason);
                                    }
                                }
                                break;
                            }
                        }
                        Some(FleetPeerSignal::Closed { reason }) => return Some(reason),
                        None => return Some("link_closed".to_string()),
                    },
                    _ = hint.notified() => break,
                    _ = &mut deadline => {
                        force_full = true;
                        break;
                    }
                    _ = stop.changed() => return None,
                }
            }
        }
    }

    /// Pull a `fleet_v1` peer's digest (a delta from the held position, or
    /// a full snapshot when asked, after an instance change, or on a gap).
    pub async fn pull_digest(
        &self,
        device_id: &str,
        link: &FleetPeerLinkInfo,
        force_full: bool,
    ) -> Result<FleetApply, FleetCallError> {
        let held = self.index.partition_cursor(device_id);
        let same_instance = matches!((&held, &link.instance_id),
            (Some((held, _)), Some(live)) if held == live);
        let request = match held {
            Some((instance, revision)) if !force_full && same_instance => FleetDigestRequest {
                since_revision: Some(revision),
                instance_id: Some(instance),
            },
            _ => FleetDigestRequest::default(),
        };
        let since = request.since_revision;
        let applied = self.fetch_and_apply(device_id, since, request).await?;
        if let FleetApply::NeedFull { reason } = applied {
            log::debug!("Fleet full resync: device_id={device_id}, reason={reason}");
            return self
                .fetch_and_apply(device_id, None, FleetDigestRequest::default())
                .await;
        }
        Ok(applied)
    }

    async fn fetch_and_apply(
        &self,
        device_id: &str,
        since: Option<u64>,
        request: FleetDigestRequest,
    ) -> Result<FleetApply, FleetCallError> {
        let value = self
            .peers
            .call(device_id, "fleet_digest", json!({ "request": request }))
            .await?;
        let digest: FleetDigest = serde_json::from_value(value).map_err(|error| {
            FleetCallError::command(format!("unreadable fleet digest: {error}"))
        })?;
        Ok(self.index.apply_digest(device_id, since, digest))
    }

    /// Index a mesh peer without `fleet_v1` by polling its view models.
    pub async fn poll_legacy(
        &self,
        device_id: &str,
        link: &FleetPeerLinkInfo,
    ) -> Result<FleetApply, FleetCallError> {
        use futures::stream::{self, StreamExt};

        let navigator = self
            .peers
            .call(
                device_id,
                "get_workspace_navigator",
                json!({ "request": {} }),
            )
            .await?;
        let workspaces = legacy::workspaces(device_id, &navigator);
        let requests: Vec<(String, Value)> = workspaces
            .iter()
            .map(|workspace| {
                (
                    workspace.workspace_id.clone(),
                    legacy::sessions_page_args(workspace),
                )
            })
            .collect();
        let pages: Vec<(String, Result<Value, FleetCallError>)> = stream::iter(requests)
            .map(|(workspace_id, args)| {
                let peers = Arc::clone(&self.peers);
                let device_id = device_id.to_string();
                async move {
                    let page = peers
                        .call(&device_id, "list_persisted_sessions_page", args)
                        .await;
                    (workspace_id, page)
                }
            })
            .buffered(self.config.legacy_concurrency.max(1))
            .collect()
            .await;
        let mut sessions = Vec::new();
        let mut workspaces = workspaces;
        for (workspace_id, page) in pages {
            match page {
                Ok(page) => {
                    let (listed, total, has_more) =
                        legacy::sessions(device_id, &workspace_id, &page);
                    if let Some(workspace) = workspaces
                        .iter_mut()
                        .find(|workspace| workspace.workspace_id == workspace_id)
                    {
                        workspace.session_total = total;
                        workspace.has_more = has_more;
                    }
                    sessions.extend(listed);
                }
                // A transport failure ends this poll; a command failure (an
                // unreadable workspace on that host) only skips the workspace.
                Err(error) if error.is_transport() => return Err(error),
                Err(error) => {
                    log::debug!(
                        "Fleet legacy session page failed: device_id={device_id}, workspace_id={workspace_id}, error={error}"
                    );
                    if let Some(workspace) = workspaces
                        .iter_mut()
                        .find(|workspace| workspace.workspace_id == workspace_id)
                    {
                        workspace.has_more = true;
                    }
                }
            }
        }
        let prompts = match self
            .peers
            .call(device_id, "list_pending_permission_requests", json!({}))
            .await
        {
            Ok(value) => legacy::permission_prompts(device_id, &value, &sessions),
            Err(error) if error.is_transport() => return Err(error),
            Err(_) => Vec::new(),
        };
        let revision = self
            .index
            .partition_cursor(device_id)
            .map_or(1, |(_, revision)| revision + 1);
        let digest = FleetDigest {
            device_id: device_id.to_string(),
            instance_id: link
                .instance_id
                .clone()
                .unwrap_or_else(|| "legacy".to_string()),
            revision,
            full: true,
            workspaces,
            sessions,
            prompts,
            removed: FleetDigestRemovals::default(),
            sessions_truncated: false,
            // A leaf owner publishes no model catalog.
            models: None,
        };
        Ok(self.index.apply_digest(device_id, None, digest))
    }
}

impl Drop for FleetSync {
    fn drop(&mut self) {
        let _ = self.stop.send(true);
    }
}

// ---------------------------------------------------------------------------
// Legacy view models -> fleet summaries
// ---------------------------------------------------------------------------

/// Projection of the view models every mesh host already serves
/// (`get_workspace_navigator`, `list_persisted_sessions_page`,
/// `list_pending_permission_requests`) into fleet summaries. Read
/// tolerantly: both the camelCase wire and snake_case aliases.
pub mod legacy {
    use super::*;

    /// The local host name a CLI host puts in `sshHost` of a local
    /// workspace.
    const LOCAL_SSH_HOSTS: &[&str] = &["localhost", "local"];

    fn text<'a>(value: &'a Value, keys: &[&str]) -> Option<&'a str> {
        keys.iter()
            .find_map(|key| value.get(*key).and_then(Value::as_str))
            .filter(|text| !text.is_empty())
    }

    fn number(value: &Value, keys: &[&str]) -> Option<u64> {
        keys.iter()
            .find_map(|key| value.get(*key).and_then(Value::as_u64))
    }

    /// The workspace kind of a navigator item.
    pub fn workspace_kind(item: &Value) -> FleetWorkspaceKind {
        match text(item, &["workspaceKind", "workspace_kind"]) {
            Some("assistant") => FleetWorkspaceKind::Assistant,
            Some("remote") => FleetWorkspaceKind::RemoteSsh,
            Some("normal") | None => FleetWorkspaceKind::Local,
            Some(_) => FleetWorkspaceKind::Unknown,
        }
    }

    /// Opened then recent workspaces of a navigator answer.
    pub fn workspaces(device_id: &str, navigator: &Value) -> Vec<FleetWorkspace> {
        let current = (navigator.get("selection").and_then(Value::as_str) == Some("host_current"))
            .then(|| text(navigator, &["selectedId", "selected_id"]))
            .flatten();
        let mut out: Vec<FleetWorkspace> = Vec::new();
        for list in ["opened", "recent"] {
            let Some(items) = navigator.get(list).and_then(Value::as_array) else {
                continue;
            };
            for item in items {
                let Some(id) = text(item, &["id", "workspaceId"]) else {
                    continue;
                };
                if out.iter().any(|w| w.workspace_id == id) {
                    continue;
                }
                let kind = workspace_kind(item);
                let ssh_host = (kind == FleetWorkspaceKind::RemoteSsh)
                    .then(|| text(item, &["sshHost", "ssh_host"]))
                    .flatten()
                    .filter(|host| !LOCAL_SSH_HOSTS.contains(host))
                    .map(str::to_string);
                out.push(FleetWorkspace {
                    device_id: device_id.to_string(),
                    workspace_id: id.to_string(),
                    name: text(item, &["name"]).unwrap_or(id).to_string(),
                    root_path: text(item, &["rootPath", "root_path"])
                        .unwrap_or_default()
                        .replace('\\', "/"),
                    kind,
                    ssh_host,
                    link_state: None,
                    is_host_current: Some(id) == current,
                    sessions: Vec::new(),
                    session_total: 0,
                    has_more: false,
                });
                if out.len() >= MAX_WORKSPACES_PER_DEVICE {
                    return out;
                }
            }
        }
        out
    }

    /// The `list_persisted_sessions_page` arguments for a workspace: its id
    /// and the legacy path scope, the first page only.
    pub fn sessions_page_args(workspace: &FleetWorkspace) -> Value {
        let mut request = json!({
            "workspaceId": workspace.workspace_id,
            "workspacePath": workspace.root_path,
            "limit": MAX_TOP_LEVEL_SESSIONS_PER_WORKSPACE,
        });
        if let Some(host) = &workspace.ssh_host {
            request["remoteSshHost"] = json!(host);
        }
        json!({ "request": request })
    }

    /// Session status from a page activity.
    pub fn session_status(activity: Option<&Value>) -> FleetSessionStatus {
        let Some(activity) = activity else {
            return FleetSessionStatus::Idle;
        };
        let waiting = number(activity, &["pendingApprovals", "pending_approvals"]).unwrap_or(0) > 0
            || number(activity, &["pendingQuestions", "pending_questions"]).unwrap_or(0) > 0;
        if waiting {
            return FleetSessionStatus::Waiting;
        }
        match text(activity, &["execution"]) {
            Some("running" | "queued") => FleetSessionStatus::Running,
            Some("error") => FleetSessionStatus::Error,
            _ => FleetSessionStatus::Idle,
        }
    }

    /// The sessions of one page, its top-level total and whether more exist.
    pub fn sessions(
        device_id: &str,
        workspace_id: &str,
        page: &Value,
    ) -> (Vec<FleetSession>, u32, bool) {
        let activities: HashMap<&str, &Value> = page
            .get("activities")
            .and_then(Value::as_array)
            .map(|list| {
                list.iter()
                    .filter_map(|activity| {
                        Some((text(activity, &["sessionId", "session_id"])?, activity))
                    })
                    .collect()
            })
            .unwrap_or_default();
        let mut sessions = Vec::new();
        for item in page
            .get("sessions")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let Some(id) = text(item, &["sessionId", "session_id"]) else {
                continue;
            };
            let activity = activities.get(id).copied();
            let status = session_status(activity);
            let failed = activity
                .and_then(|a| a.get("failed"))
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let unread = activity
                .and_then(|a| a.get("unread"))
                .and_then(Value::as_bool)
                .unwrap_or_else(|| {
                    activity
                        .and_then(|a| text(a, &["unreadCompletion", "unread_completion"]))
                        .is_some()
                });
            let parent = item
                .get("relationship")
                .and_then(|relationship| {
                    text(relationship, &["parentSessionId", "parent_session_id"])
                })
                .map(str::to_string);
            sessions.push(FleetSession {
                device_id: device_id.to_string(),
                workspace_id: workspace_id.to_string(),
                session_id: id.to_string(),
                parent_session_id: parent,
                title: text(item, &["sessionName", "session_name", "title"])
                    .unwrap_or_default()
                    .to_string(),
                agent_type: text(item, &["agentType", "agent_type"])
                    .unwrap_or_default()
                    .to_string(),
                status,
                unread,
                needs_attention: status == FleetSessionStatus::Waiting || failed,
                last_activity_ms: number(item, &["lastActiveAt", "last_active_at"]).unwrap_or(0),
                origin: session_origin(item),
            });
        }
        let total = number(page, &["totalTopLevelCount", "total_top_level_count"])
            .unwrap_or(sessions.len() as u64)
            .min(u32::MAX as u64) as u32;
        let has_more = page
            .get("hasMore")
            .or_else(|| page.get("has_more"))
            .and_then(Value::as_bool)
            .unwrap_or(false);
        (sessions, total, has_more)
    }

    /// `dispatch` for a session a Detached Dispatch job runs, `bot` for one
    /// an IM bot drives (from its custom metadata), else none.
    pub fn session_origin(item: &Value) -> Option<FleetSessionOrigin> {
        let custom = item
            .get("customMetadata")
            .or_else(|| item.get("custom_metadata"))?;
        if text(custom, &["dispatchJobId", "dispatch_job_id"]).is_some() {
            return Some(FleetSessionOrigin::Dispatch);
        }
        match text(custom, &["origin", "source"]) {
            Some("dispatch") => Some(FleetSessionOrigin::Dispatch),
            Some("bot" | "im_bot") => Some(FleetSessionOrigin::Bot),
            _ => None,
        }
    }

    /// Pending permission requests as prompts; the workspace is the one of
    /// the session (or its delegating parent) in the polled sessions.
    pub fn permission_prompts(
        device_id: &str,
        requests: &Value,
        sessions: &[FleetSession],
    ) -> Vec<FleetPrompt> {
        let workspace_of = |session_id: &str| {
            sessions
                .iter()
                .find(|session| session.session_id == session_id)
                .map(|session| session.workspace_id.clone())
        };
        let mut prompts = Vec::new();
        for (order, request) in requests.as_array().into_iter().flatten().enumerate() {
            let Some(prompt_id) = text(request, &["requestId", "request_id"]) else {
                continue;
            };
            let session_id = text(request, &["sessionId", "session_id"])
                .unwrap_or_default()
                .to_string();
            let parent = request
                .get("delegation")
                .and_then(|delegation| text(delegation, &["parentSessionId", "parent_session_id"]));
            let workspace_id = workspace_of(&session_id)
                .or_else(|| parent.and_then(workspace_of))
                .unwrap_or_default();
            prompts.push(permission_prompt(
                device_id,
                workspace_id,
                session_id,
                prompt_id,
                order as u64 + 1,
                request,
            ));
        }
        prompts
    }

    /// One permission request as a prompt (the core producer uses the same
    /// shape for its own requests).
    pub fn permission_prompt(
        device_id: &str,
        workspace_id: String,
        session_id: String,
        prompt_id: &str,
        revision: u64,
        request: &Value,
    ) -> FleetPrompt {
        let action = text(request, &["action"]).unwrap_or_default();
        let title = request
            .get("displayMetadata")
            .and_then(|meta| text(meta, &["title", "summary"]))
            .unwrap_or(action)
            .to_string();
        // The tool of a tool-call request is the source identity.
        let tool_name = request
            .get("source")
            .and_then(|source| {
                (text(source, &["kind"]) == Some("tool_call"))
                    .then(|| text(source, &["identity"]))
                    .flatten()
                    .or_else(|| text(source, &["toolName", "tool_name"]))
            })
            .map(str::to_string);
        FleetPrompt {
            device_id: device_id.to_string(),
            workspace_id,
            session_id,
            kind: FleetPromptKind::Permission,
            prompt_id: prompt_id.to_string(),
            revision,
            title,
            tool_name,
            payload: Some(request.clone()),
            payload_truncated: false,
            answerable: true,
            unanswerable_reason: None,
            answer_route: FleetAnswerRoute::Runtime,
            job_id: None,
        }
    }
}

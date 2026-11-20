//! Remote workspace link supervision: liveness, reconnect and backoff.
//!
//! Every client used to run its own copy of this policy (probe the transport
//! when a remote workspace is activated, reconnect from the saved profile for a
//! bounded budget, then heartbeat it every 30 s). Two windows on one backend
//! therefore raced each other's reconnects, and a phone or browser driving the
//! backend had no heartbeat at all. The backend now owns it: clients call
//! `ensure` and render the [`RemoteLinkState`] they receive on
//! [`REMOTE_LINK_STATE_EVENT`].
//!
//! The supervisor never opens an interactive prompt. A link that needs
//! credentials the vault does not hold ends in `failed { reason: auth_required }`
//! so whichever client drives the session can ask the user, then reconnect
//! through the ordinary connect command.

use async_trait::async_trait;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, Weak};
use std::time::Duration;
use tokio::task::JoinHandle;
use tokio::time::Instant;

/// Event carrying one connection's [`RemoteLinkState`].
pub const REMOTE_LINK_STATE_EVENT: &str = "remote://link-state";

/// Where a link stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RemoteLinkPhase {
    /// The transport is being probed.
    Checking,
    Connected,
    /// The transport dropped and the backend is restoring it.
    Reconnecting,
    /// The backend stopped trying; `reason` says why.
    Failed,
    /// The user (or a client) closed the connection.
    Disconnected,
}

/// Why a link is `failed`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RemoteLinkFailure {
    /// The saved profile needs credentials the vault does not hold (or the
    /// server refused the stored ones); a client must ask the user.
    AuthRequired,
    /// No saved connection exists for this id on this backend.
    ProfileMissing,
    /// The reconnect budget ran out.
    Unreachable,
    /// The transport is up but the workspace could not be activated on it.
    WorkspaceUnavailable,
}

/// One connection's link state, as sent on [`REMOTE_LINK_STATE_EVENT`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteLinkState {
    pub connection_id: String,
    pub state: RemoteLinkPhase,
    /// Reconnect attempt number (1-based) while `reconnecting`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attempt: Option<u32>,
    /// Delay before the next attempt, when the backend is waiting between attempts.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_retry_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<RemoteLinkFailure>,
    /// The host's own error text for the last failure.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    /// Strictly increasing across all links of this backend process, so a
    /// client can drop a state older than one it already rendered.
    pub revision: u64,
}

impl RemoteLinkState {
    fn new(connection_id: &str, state: RemoteLinkPhase) -> Self {
        Self {
            connection_id: connection_id.to_string(),
            state,
            attempt: None,
            next_retry_ms: None,
            reason: None,
            detail: None,
            revision: 0,
        }
    }

    fn failed(connection_id: &str, reason: RemoteLinkFailure, detail: Option<String>) -> Self {
        Self {
            reason: Some(reason),
            detail,
            ..Self::new(connection_id, RemoteLinkPhase::Failed)
        }
    }
}

/// Timing of the supervision policy.
#[derive(Debug, Clone, Copy)]
pub struct RemoteLinkPolicy {
    /// Probe cadence for a connected link.
    pub heartbeat: Duration,
    /// How long a dropped link is retried before it is reported `unreachable`.
    pub reconnect_budget: Duration,
    /// Wait between reconnect attempts.
    pub retry_wait: Duration,
    /// Bound on one reconnect attempt.
    pub attempt_timeout: Duration,
}

impl Default for RemoteLinkPolicy {
    fn default() -> Self {
        Self {
            heartbeat: Duration::from_secs(30),
            reconnect_budget: Duration::from_secs(180),
            retry_wait: Duration::from_secs(10),
            attempt_timeout: Duration::from_secs(30),
        }
    }
}

/// Whether a dropped link can be restored without asking the user.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReconnectReadiness {
    Ready,
    AuthRequired,
    ProfileMissing,
}

/// A failed reconnect attempt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReconnectError {
    pub message: String,
    /// The server refused the credentials; retrying cannot help.
    pub needs_credentials: bool,
}

/// The transport the supervisor watches.
#[async_trait]
pub trait RemoteLinkTransport: Send + Sync + 'static {
    /// Whether the connection is up. `Err` means the backend cannot answer
    /// (its SSH service is not running).
    async fn probe(&self, connection_id: &str) -> Result<bool, String>;
    async fn readiness(&self, connection_id: &str) -> ReconnectReadiness;
    /// Restores the connection from its saved profile.
    async fn reconnect(&self, connection_id: &str) -> Result<(), ReconnectError>;
}

/// Receives every published state (the host turns it into an event).
pub type RemoteLinkSink = Arc<dyn Fn(&RemoteLinkState) + Send + Sync>;

#[derive(Default)]
struct LinkEntry {
    state: Option<RemoteLinkState>,
    lock: Arc<tokio::sync::Mutex<()>>,
    /// Bumped by `forget`; a run that started under an older generation stops
    /// publishing.
    generation: u64,
    heartbeat: Option<JoinHandle<()>>,
}

struct Inner {
    transport: Arc<dyn RemoteLinkTransport>,
    sink: RemoteLinkSink,
    policy: RemoteLinkPolicy,
    links: Mutex<HashMap<String, LinkEntry>>,
    revision: AtomicU64,
}

/// Supervises the links of one backend process.
#[derive(Clone)]
pub struct RemoteLinkSupervisor {
    inner: Arc<Inner>,
}

impl RemoteLinkSupervisor {
    pub fn new(
        transport: Arc<dyn RemoteLinkTransport>,
        sink: RemoteLinkSink,
        policy: RemoteLinkPolicy,
    ) -> Self {
        Self {
            inner: Arc::new(Inner {
                transport,
                sink,
                policy,
                links: Mutex::new(HashMap::new()),
                revision: AtomicU64::new(0),
            }),
        }
    }

    /// The last published state of every link this backend has seen.
    pub fn states(&self) -> Vec<RemoteLinkState> {
        let links = self.inner.links.lock().unwrap_or_else(|e| e.into_inner());
        let mut states: Vec<_> = links
            .values()
            .filter_map(|entry| entry.state.clone())
            .collect();
        states.sort_by(|a, b| a.connection_id.cmp(&b.connection_id));
        states
    }

    pub fn state_of(&self, connection_id: &str) -> Option<RemoteLinkState> {
        let links = self.inner.links.lock().unwrap_or_else(|e| e.into_inner());
        links
            .get(connection_id)
            .and_then(|entry| entry.state.clone())
    }

    /// Makes sure the link is up: probes it, reconnects from the saved profile
    /// within the budget when it dropped, and keeps a heartbeat on it while it
    /// is up. Concurrent calls for one connection run one after the other, so
    /// a second caller sees the first one's result instead of reconnecting
    /// again.
    pub async fn ensure(&self, connection_id: &str) -> RemoteLinkState {
        Inner::ensure(&self.inner, connection_id).await
    }

    /// Records a connection a client just opened (for example after asking the
    /// user for credentials) and starts its heartbeat.
    pub fn mark_connected(&self, connection_id: &str) {
        let generation = self.inner.generation_of(connection_id);
        self.inner.publish(
            connection_id,
            generation,
            RemoteLinkState::new(connection_id, RemoteLinkPhase::Connected),
        );
        Inner::start_heartbeat(&self.inner, connection_id);
    }

    /// Records a failure found by the host outside the transport probe (the
    /// workspace path is gone, for example).
    pub fn mark_failed(
        &self,
        connection_id: &str,
        reason: RemoteLinkFailure,
        detail: Option<String>,
    ) -> RemoteLinkState {
        let generation = self.inner.generation_of(connection_id);
        self.inner.publish(
            connection_id,
            generation,
            RemoteLinkState::failed(connection_id, reason, detail),
        )
    }

    /// Stops supervising a connection the user closed: any running reconnect
    /// stops publishing and the heartbeat ends.
    pub fn forget(&self, connection_id: &str) {
        let generation = {
            let mut links = self.inner.links.lock().unwrap_or_else(|e| e.into_inner());
            let entry = links.entry(connection_id.to_string()).or_default();
            entry.generation += 1;
            if let Some(task) = entry.heartbeat.take() {
                task.abort();
            }
            entry.generation
        };
        self.inner.publish(
            connection_id,
            generation,
            RemoteLinkState::new(connection_id, RemoteLinkPhase::Disconnected),
        );
    }

    /// `forget` for every supervised connection.
    pub fn forget_all(&self) {
        let ids: Vec<String> = {
            let links = self.inner.links.lock().unwrap_or_else(|e| e.into_inner());
            links.keys().cloned().collect()
        };
        for id in ids {
            self.forget(&id);
        }
    }
}

impl Inner {
    fn generation_of(&self, connection_id: &str) -> u64 {
        let mut links = self.links.lock().unwrap_or_else(|e| e.into_inner());
        links
            .entry(connection_id.to_string())
            .or_default()
            .generation
    }

    fn lock_of(&self, connection_id: &str) -> Arc<tokio::sync::Mutex<()>> {
        let mut links = self.links.lock().unwrap_or_else(|e| e.into_inner());
        links
            .entry(connection_id.to_string())
            .or_default()
            .lock
            .clone()
    }

    fn current(&self, connection_id: &str) -> Option<RemoteLinkState> {
        let links = self.links.lock().unwrap_or_else(|e| e.into_inner());
        links
            .get(connection_id)
            .and_then(|entry| entry.state.clone())
    }

    /// Stores and emits `state` unless the connection was forgotten since
    /// `generation`; returns what the link now reads.
    fn publish(
        &self,
        connection_id: &str,
        generation: u64,
        mut state: RemoteLinkState,
    ) -> RemoteLinkState {
        {
            let mut links = self.links.lock().unwrap_or_else(|e| e.into_inner());
            let entry = links.entry(connection_id.to_string()).or_default();
            if entry.generation != generation {
                return entry.state.clone().unwrap_or(state);
            }
            state.revision = self.revision.fetch_add(1, Ordering::AcqRel) + 1;
            entry.state = Some(state.clone());
        }
        log::debug!(
            "Remote link state: connection_id={}, state={:?}, attempt={:?}, reason={:?}",
            connection_id,
            state.state,
            state.attempt,
            state.reason
        );
        (self.sink)(&state);
        state
    }

    fn stop_heartbeat(&self, connection_id: &str) {
        let mut links = self.links.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(task) = links
            .get_mut(connection_id)
            .and_then(|entry| entry.heartbeat.take())
        {
            task.abort();
        }
    }

    fn start_heartbeat(this: &Arc<Self>, connection_id: &str) {
        let mut links = this.links.lock().unwrap_or_else(|e| e.into_inner());
        let entry = links.entry(connection_id.to_string()).or_default();
        if entry
            .heartbeat
            .as_ref()
            .is_some_and(|task| !task.is_finished())
        {
            return;
        }
        let weak: Weak<Self> = Arc::downgrade(this);
        let id = connection_id.to_string();
        let generation = entry.generation;
        let period = this.policy.heartbeat;
        entry.heartbeat = Some(tokio::spawn(async move {
            loop {
                tokio::time::sleep(period).await;
                let Some(inner) = weak.upgrade() else { return };
                if inner.generation_of(&id) != generation {
                    return;
                }
                // A reconnect or an explicit ensure is already looking at it.
                let lock = inner.lock_of(&id);
                let Ok(guard) = lock.try_lock() else { continue };
                let alive = inner.transport.probe(&id).await;
                drop(guard);
                if matches!(alive, Ok(false)) {
                    log::warn!("Remote link heartbeat lost the connection: connection_id={id}");
                    // Restore it from a task of its own: `ensure` stops this
                    // heartbeat, which must not cancel the restore.
                    let restore = inner.clone();
                    let restore_id = id.clone();
                    tokio::spawn(async move {
                        Inner::ensure(&restore, &restore_id).await;
                    });
                    return;
                }
            }
        }));
    }

    async fn ensure(this: &Arc<Self>, connection_id: &str) -> RemoteLinkState {
        let lock = this.lock_of(connection_id);
        let _guard = lock.lock().await;
        let generation = this.generation_of(connection_id);
        let id = connection_id;

        if this
            .current(id)
            .is_none_or(|state| state.state != RemoteLinkPhase::Connected)
        {
            this.publish(
                id,
                generation,
                RemoteLinkState::new(id, RemoteLinkPhase::Checking),
            );
        }
        match this.transport.probe(id).await {
            Ok(true) => {
                let state = this.publish(
                    id,
                    generation,
                    RemoteLinkState::new(id, RemoteLinkPhase::Connected),
                );
                if state.state == RemoteLinkPhase::Connected {
                    Self::start_heartbeat(this, id);
                }
                return state;
            }
            Ok(false) => {}
            Err(error) => {
                return this.publish(
                    id,
                    generation,
                    RemoteLinkState::failed(id, RemoteLinkFailure::Unreachable, Some(error)),
                );
            }
        }

        // The transport dropped: restore it from the saved profile.
        this.stop_heartbeat(id);
        match this.transport.readiness(id).await {
            ReconnectReadiness::Ready => {}
            ReconnectReadiness::AuthRequired => {
                return this.publish(
                    id,
                    generation,
                    RemoteLinkState::failed(id, RemoteLinkFailure::AuthRequired, None),
                );
            }
            ReconnectReadiness::ProfileMissing => {
                return this.publish(
                    id,
                    generation,
                    RemoteLinkState::failed(
                        id,
                        RemoteLinkFailure::ProfileMissing,
                        Some(
                            "The saved connection for this workspace is missing on this host."
                                .to_string(),
                        ),
                    ),
                );
            }
        }

        let policy = this.policy;
        let deadline = Instant::now() + policy.reconnect_budget;
        let mut attempt: u32 = 0;
        let mut last_error: Option<String>;
        loop {
            if this.generation_of(id) != generation {
                return this
                    .current(id)
                    .unwrap_or_else(|| RemoteLinkState::new(id, RemoteLinkPhase::Disconnected));
            }
            attempt += 1;
            this.publish(
                id,
                generation,
                RemoteLinkState {
                    attempt: Some(attempt),
                    ..RemoteLinkState::new(id, RemoteLinkPhase::Reconnecting)
                },
            );
            match tokio::time::timeout(policy.attempt_timeout, this.transport.reconnect(id)).await {
                Ok(Ok(())) => {
                    log::info!(
                        "Remote link restored: connection_id={}, attempt={}",
                        id,
                        attempt
                    );
                    let state = this.publish(
                        id,
                        generation,
                        RemoteLinkState::new(id, RemoteLinkPhase::Connected),
                    );
                    if state.state == RemoteLinkPhase::Connected {
                        Self::start_heartbeat(this, id);
                    }
                    return state;
                }
                Ok(Err(error)) if error.needs_credentials => {
                    return this.publish(
                        id,
                        generation,
                        RemoteLinkState::failed(
                            id,
                            RemoteLinkFailure::AuthRequired,
                            Some(error.message),
                        ),
                    );
                }
                Ok(Err(error)) => last_error = Some(error.message),
                Err(_) => last_error = Some("Connection timeout".to_string()),
            }
            let now = Instant::now();
            if now >= deadline {
                break;
            }
            let wait = policy.retry_wait.min(deadline - now);
            this.publish(
                id,
                generation,
                RemoteLinkState {
                    attempt: Some(attempt),
                    next_retry_ms: Some(wait.as_millis() as u64),
                    detail: last_error.clone(),
                    ..RemoteLinkState::new(id, RemoteLinkPhase::Reconnecting)
                },
            );
            tokio::time::sleep(wait).await;
        }
        log::warn!(
            "Remote link reconnect budget exhausted: connection_id={}, attempts={}",
            id,
            attempt
        );
        this.publish(
            id,
            generation,
            RemoteLinkState::failed(id, RemoteLinkFailure::Unreachable, last_error),
        )
    }
}

/// Whether an SSH error text says the server refused (or lacks) credentials.
pub fn is_ssh_credential_error(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    [
        "credentials required",
        "authenticat",
        "password",
        "passphrase",
        "private key",
        "publickey",
        "keyboard-interactive",
        "keyboard interactive",
        "challenge response",
        "ssh agent",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

#[cfg(feature = "remote-ssh-concrete")]
mod ssh {
    use super::*;
    use crate::remote_ssh::types::{SavedAuthType, SavedConnection};
    use crate::remote_ssh::SSHConnectionManager;

    fn uses_local_process(saved: &SavedConnection) -> bool {
        saved.wsl.is_some()
            || saved
                .container
                .as_ref()
                .is_some_and(|container| container.local)
    }

    async fn saved_profile(
        manager: &SSHConnectionManager,
        connection_id: &str,
    ) -> Option<SavedConnection> {
        manager
            .get_saved_connections()
            .await
            .into_iter()
            .find(|saved| saved.id == connection_id)
    }

    #[async_trait]
    impl RemoteLinkTransport for SSHConnectionManager {
        async fn probe(&self, connection_id: &str) -> Result<bool, String> {
            Ok(self.is_connected(connection_id).await)
        }

        async fn readiness(&self, connection_id: &str) -> ReconnectReadiness {
            let Some(saved) = saved_profile(self, connection_id).await else {
                return ReconnectReadiness::ProfileMissing;
            };
            match saved.auth_type {
                SavedAuthType::KeyboardInteractive => ReconnectReadiness::AuthRequired,
                SavedAuthType::Password
                    if !uses_local_process(&saved)
                        && !self.has_stored_password(connection_id).await =>
                {
                    ReconnectReadiness::AuthRequired
                }
                _ => ReconnectReadiness::Ready,
            }
        }

        async fn reconnect(&self, connection_id: &str) -> Result<(), ReconnectError> {
            match self.ensure_connected(connection_id).await {
                Ok(()) => Ok(()),
                Err(error) => {
                    let message = error.to_string();
                    let saved = saved_profile(self, connection_id).await;
                    let needs_credentials = saved.as_ref().is_some_and(|saved| {
                        !matches!(saved.auth_type, SavedAuthType::None)
                            && !uses_local_process(saved)
                    }) && is_ssh_credential_error(&message);
                    Err(ReconnectError {
                        message,
                        needs_credentials,
                    })
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicBool;

    #[derive(Default)]
    struct FakeTransport {
        alive: AtomicBool,
        readiness: Mutex<Option<ReconnectReadiness>>,
        /// Results of the next reconnect attempts, in order; empty means success.
        outcomes: Mutex<Vec<Result<(), ReconnectError>>>,
        attempts: AtomicU64,
        probes: AtomicU64,
    }

    #[async_trait]
    impl RemoteLinkTransport for FakeTransport {
        async fn probe(&self, _: &str) -> Result<bool, String> {
            self.probes.fetch_add(1, Ordering::SeqCst);
            Ok(self.alive.load(Ordering::SeqCst))
        }
        async fn readiness(&self, _: &str) -> ReconnectReadiness {
            self.readiness
                .lock()
                .unwrap()
                .unwrap_or(ReconnectReadiness::Ready)
        }
        async fn reconnect(&self, _: &str) -> Result<(), ReconnectError> {
            self.attempts.fetch_add(1, Ordering::SeqCst);
            let next = {
                let mut outcomes = self.outcomes.lock().unwrap();
                if outcomes.is_empty() {
                    Ok(())
                } else {
                    outcomes.remove(0)
                }
            };
            if next.is_ok() {
                self.alive.store(true, Ordering::SeqCst);
            }
            next
        }
    }

    fn unreachable(message: &str) -> Result<(), ReconnectError> {
        Err(ReconnectError {
            message: message.to_string(),
            needs_credentials: false,
        })
    }

    fn policy() -> RemoteLinkPolicy {
        RemoteLinkPolicy {
            heartbeat: Duration::from_secs(30),
            reconnect_budget: Duration::from_secs(180),
            retry_wait: Duration::from_secs(10),
            attempt_timeout: Duration::from_secs(30),
        }
    }

    fn supervisor(
        transport: Arc<FakeTransport>,
    ) -> (RemoteLinkSupervisor, Arc<Mutex<Vec<RemoteLinkState>>>) {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let sink_seen = seen.clone();
        let sink: RemoteLinkSink = Arc::new(move |state: &RemoteLinkState| {
            sink_seen.lock().unwrap().push(state.clone());
        });
        (RemoteLinkSupervisor::new(transport, sink, policy()), seen)
    }

    fn phases(seen: &Mutex<Vec<RemoteLinkState>>) -> Vec<RemoteLinkPhase> {
        seen.lock()
            .unwrap()
            .iter()
            .map(|state| state.state)
            .collect()
    }

    #[tokio::test(start_paused = true)]
    async fn a_live_link_is_connected_and_heartbeats() {
        let transport = Arc::new(FakeTransport::default());
        transport.alive.store(true, Ordering::SeqCst);
        let (supervisor, seen) = supervisor(transport.clone());
        let state = supervisor.ensure("c1").await;
        assert_eq!(state.state, RemoteLinkPhase::Connected);
        assert_eq!(
            phases(&seen),
            vec![RemoteLinkPhase::Checking, RemoteLinkPhase::Connected]
        );
        let probes = transport.probes.load(Ordering::SeqCst);
        tokio::time::sleep(Duration::from_secs(61)).await;
        assert_eq!(transport.probes.load(Ordering::SeqCst), probes + 2);
        // A second ensure of a connected link does not flash `checking`.
        supervisor.ensure("c1").await;
        assert_eq!(phases(&seen).len(), 3);
    }

    #[tokio::test(start_paused = true)]
    async fn a_dropped_link_reconnects_with_backoff_then_reports_unreachable() {
        let transport = Arc::new(FakeTransport::default());
        *transport.outcomes.lock().unwrap() = (0..100).map(|_| unreachable("refused")).collect();
        let (supervisor, seen) = supervisor(transport.clone());
        let state = supervisor.ensure("c1").await;
        assert_eq!(state.state, RemoteLinkPhase::Failed);
        assert_eq!(state.reason, Some(RemoteLinkFailure::Unreachable));
        assert_eq!(state.detail.as_deref(), Some("refused"));
        // 180 s budget with a 10 s wait: attempts at t = 0, 10, ..., 180.
        assert_eq!(transport.attempts.load(Ordering::SeqCst), 19);
        let waits: Vec<_> = seen
            .lock()
            .unwrap()
            .iter()
            .filter_map(|state| state.next_retry_ms)
            .collect();
        assert!(waits.iter().all(|wait| *wait <= 10_000));
        let revisions: Vec<_> = seen.lock().unwrap().iter().map(|s| s.revision).collect();
        assert!(revisions.windows(2).all(|pair| pair[0] < pair[1]));
    }

    #[tokio::test(start_paused = true)]
    async fn a_dropped_link_restores_and_heartbeat_detects_the_next_drop() {
        let transport = Arc::new(FakeTransport::default());
        *transport.outcomes.lock().unwrap() = vec![unreachable("timeout")];
        let (supervisor, seen) = supervisor(transport.clone());
        let state = supervisor.ensure("c1").await;
        assert_eq!(state.state, RemoteLinkPhase::Connected);
        assert_eq!(transport.attempts.load(Ordering::SeqCst), 2);
        let reconnecting: Vec<_> = seen
            .lock()
            .unwrap()
            .iter()
            .filter(|state| state.state == RemoteLinkPhase::Reconnecting)
            .map(|state| (state.attempt, state.next_retry_ms))
            .collect();
        assert_eq!(
            reconnecting,
            vec![(Some(1), None), (Some(1), Some(10_000)), (Some(2), None)]
        );

        // The heartbeat notices the next drop and restores the link by itself.
        transport.alive.store(false, Ordering::SeqCst);
        tokio::time::sleep(Duration::from_secs(31)).await;
        tokio::task::yield_now().await;
        for _ in 0..10 {
            tokio::task::yield_now().await;
        }
        assert_eq!(transport.attempts.load(Ordering::SeqCst), 3);
        assert_eq!(
            supervisor.state_of("c1").map(|s| s.state),
            Some(RemoteLinkPhase::Connected)
        );
    }

    #[tokio::test(start_paused = true)]
    async fn missing_profile_and_missing_credentials_fail_without_attempts() {
        let transport = Arc::new(FakeTransport::default());
        *transport.readiness.lock().unwrap() = Some(ReconnectReadiness::ProfileMissing);
        let (supervisor, _) = supervisor(transport.clone());
        let state = supervisor.ensure("gone").await;
        assert_eq!(state.reason, Some(RemoteLinkFailure::ProfileMissing));

        *transport.readiness.lock().unwrap() = Some(ReconnectReadiness::AuthRequired);
        let state = supervisor.ensure("kbd").await;
        assert_eq!(state.reason, Some(RemoteLinkFailure::AuthRequired));
        assert_eq!(transport.attempts.load(Ordering::SeqCst), 0);
    }

    #[tokio::test(start_paused = true)]
    async fn a_refused_credential_stops_retrying() {
        let transport = Arc::new(FakeTransport::default());
        *transport.outcomes.lock().unwrap() = vec![Err(ReconnectError {
            message: "Authentication failed".into(),
            needs_credentials: true,
        })];
        let (supervisor, _) = supervisor(transport.clone());
        let state = supervisor.ensure("c1").await;
        assert_eq!(state.reason, Some(RemoteLinkFailure::AuthRequired));
        assert_eq!(transport.attempts.load(Ordering::SeqCst), 1);
    }

    #[tokio::test(start_paused = true)]
    async fn forget_stops_a_running_reconnect_and_reports_disconnected() {
        let transport = Arc::new(FakeTransport::default());
        *transport.outcomes.lock().unwrap() = (0..100).map(|_| unreachable("refused")).collect();
        let (supervisor, _) = supervisor(transport.clone());
        let running = {
            let supervisor = supervisor.clone();
            tokio::spawn(async move { supervisor.ensure("c1").await })
        };
        tokio::time::sleep(Duration::from_secs(15)).await;
        supervisor.forget("c1");
        let state = running.await.unwrap();
        assert_eq!(state.state, RemoteLinkPhase::Disconnected);
        assert!(transport.attempts.load(Ordering::SeqCst) <= 3);
        assert_eq!(
            supervisor.states().first().map(|s| s.state),
            Some(RemoteLinkPhase::Disconnected)
        );
    }

    #[test]
    fn credential_errors_are_told_apart_from_network_errors() {
        assert!(is_ssh_credential_error("Authentication failed (publickey)"));
        assert!(is_ssh_credential_error(
            "SSH session x is dead and no stored password is available for reconnect"
        ));
        assert!(!is_ssh_credential_error("Connection refused (os error 61)"));
        assert!(!is_ssh_credential_error("Connection timeout"));
    }

    #[test]
    fn link_state_wire_shape_is_camel_case_and_sparse() {
        let state = RemoteLinkState {
            attempt: Some(2),
            next_retry_ms: Some(10_000),
            revision: 7,
            ..RemoteLinkState::new("c1", RemoteLinkPhase::Reconnecting)
        };
        assert_eq!(
            serde_json::to_value(&state).unwrap(),
            serde_json::json!({
                "connectionId": "c1", "state": "reconnecting", "attempt": 2,
                "nextRetryMs": 10000, "revision": 7
            })
        );
        let failed = RemoteLinkState::failed("c1", RemoteLinkFailure::AuthRequired, None);
        assert_eq!(
            serde_json::to_value(&failed).unwrap()["reason"],
            "auth_required"
        );
    }
}

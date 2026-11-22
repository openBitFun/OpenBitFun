//! The real [`DeviceRpc`]: the account's devices over its Link network.
//!
//! The node joins an account network as its own member (`agent-<site>`,
//! membership minted from the issuer key) through `LinkGateway`, which
//! leaves a network idle for ten minutes; the watcher only polls accounts
//! with live jobs or unfinished turns, so membership is held only while
//! something needs it. Cached OBP connections have a shorter idle TTL and
//! a global cap, and are released when an account's slot unloads or is
//! shredded, so idle accounts return their `GatewayStream` permits and
//! leave `LinkGateway`.
//!
//! Each device is dialed with the account-device handshake over the pair key
//! of the node's directory key and the device's public key; devices that see
//! the `cloud_agent` row kind grant the cloud-agent scope (the account-device
//! allowlist plus the model relay). A device whose mesh info lacks
//! `cloud_agent_scope_v1` is never dialed for a command
//! (`superagent_requires_update`).

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use openbitfun_link::gateway::{GatewayError, LinkGateway};
use openbitfun_obp::client::{self, Dial, MeshConnectOptions, MeshObpConnection};
use openbitfun_product_domains::fleet::FleetHostKind;
use openbitfun_product_domains::superagent::{reason, RuntimeFacts, CLOUD_AGENT_SCOPE_CAPABILITY};
use serde_json::{json, Value};

use crate::api::node_secret;
use crate::crypto;
use crate::device::{BoxFuture, DeviceRpc, DeviceSnapshot, RpcError};
use crate::directory::Directory;
use crate::slots::Slots;

const FACTS_TTL: Duration = Duration::from_secs(30);
const CALL_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_WORKSPACES: usize = 64;

/// Bounds and TTLs for `LinkRpc`'s in-memory caches and pooled OBP streams.
#[derive(Debug, Clone)]
pub struct LinkRpcLimits {
    /// Idle OBP connections are closed after this long so their underlying
    /// `GatewayStream` is dropped and `LinkGateway` can leave the account.
    pub connection_idle_ttl: Duration,
    /// Interval of the background idle sweep.
    pub sweep_interval: Duration,
    /// Maximum live cached device OBP connections across all accounts.
    pub max_connections: usize,
    /// Idle TTL for cached device snapshots and restored-account markers.
    pub facts_cache_ttl: Duration,
    /// Maximum cached `(account_id, device_id)` device snapshots in RAM.
    pub max_facts: usize,
    /// Maximum restored-account markers in RAM.
    pub max_restored: usize,
}

impl Default for LinkRpcLimits {
    fn default() -> Self {
        Self {
            connection_idle_ttl: Duration::from_secs(3 * 60),
            sweep_interval: Duration::from_secs(60),
            max_connections: 512,
            facts_cache_ttl: Duration::from_secs(30 * 60),
            max_facts: 8_192,
            max_restored: 2_048,
        }
    }
}

struct Cached {
    at: Instant,
    last_used: Instant,
    snapshot: DeviceSnapshot,
}

struct CachedConnection {
    connection: Arc<MeshObpConnection>,
    last_used: Instant,
}

pub struct LinkRpc {
    gateway: Arc<LinkGateway>,
    directory: Arc<dyn Directory>,
    slots: Arc<Slots>,
    limits: LinkRpcLimits,
    client_name: String,
    connections: Mutex<HashMap<(String, String), CachedConnection>>,
    facts: Mutex<HashMap<(String, String), Cached>>,
    /// Accounts whose persisted device facts were read into `facts`.
    restored: Mutex<HashMap<String, Instant>>,
}

fn gateway_error(error: GatewayError) -> RpcError {
    match error {
        GatewayError::Unreachable(message) => RpcError::Offline(message),
        GatewayError::Busy(message) | GatewayError::Unavailable(message) => {
            RpcError::Transport(message)
        }
    }
}

fn host_kind(kind: Option<&str>) -> FleetHostKind {
    match kind {
        Some("cli") => FleetHostKind::Cli,
        None | Some("desktop") => FleetHostKind::Desktop,
        _ => FleetHostKind::Unknown,
    }
}

impl LinkRpc {
    pub fn new(
        gateway: Arc<LinkGateway>,
        directory: Arc<dyn Directory>,
        slots: Arc<Slots>,
    ) -> Arc<Self> {
        Self::new_with_limits(gateway, directory, slots, LinkRpcLimits::default())
    }

    pub fn new_with_limits(
        gateway: Arc<LinkGateway>,
        directory: Arc<dyn Directory>,
        slots: Arc<Slots>,
        limits: LinkRpcLimits,
    ) -> Arc<Self> {
        let sweep_interval = limits.sweep_interval;
        let rpc = Arc::new(Self {
            gateway,
            directory,
            slots: Arc::clone(&slots),
            limits,
            client_name: format!("openbitfun-superagent/{}", env!("CARGO_PKG_VERSION")),
            connections: Mutex::new(HashMap::new()),
            facts: Mutex::new(HashMap::new()),
            restored: Mutex::new(HashMap::new()),
        });
        let weak_unload = Arc::downgrade(&rpc);
        slots.set_on_unload(Arc::new(move |account_id: &str| {
            if let Some(rpc) = weak_unload.upgrade() {
                rpc.evict_account_sync(account_id);
            }
        }));
        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            let weak_sweep = Arc::downgrade(&rpc);
            handle.spawn(async move {
                let every = sweep_interval.max(Duration::from_millis(50));
                loop {
                    tokio::time::sleep(every).await;
                    let Some(rpc) = weak_sweep.upgrade() else {
                        return;
                    };
                    let evicted = rpc.evict_idle();
                    if evicted > 0 {
                        log::debug!(
                            "Superagent idle device connections evicted: count={}",
                            evicted
                        );
                    }
                }
            });
        }
        rpc
    }

    /// Releases all pooled OBP connections (and their `GatewayStream` permits),
    /// cached device facts, and restored markers for `account_id`.
    pub fn evict_account_sync(&self, account_id: &str) {
        let closed: Vec<Arc<MeshObpConnection>> = {
            let mut connections = self
                .connections
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let keys: Vec<(String, String)> = connections
                .keys()
                .filter(|(account, _)| account == account_id)
                .cloned()
                .collect();
            keys.into_iter()
                .filter_map(|key| connections.remove(&key).map(|entry| entry.connection))
                .collect()
        };
        for conn in closed {
            conn.request_close();
        }
        self.facts
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .retain(|(account, _), _| account != account_id);
        self.restored
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(account_id);
    }

    /// Async wrapper around [`Self::evict_account_sync`].
    pub async fn evict_account(&self, account_id: &str) {
        self.evict_account_sync(account_id);
    }

    /// Sweeps closed and idle connections plus expired cached facts/restored
    /// markers. Returns how many connections were closed/removed.
    pub fn evict_idle(&self) -> usize {
        self.evict_idle_at(Instant::now())
    }

    fn evict_idle_at(&self, now: Instant) -> usize {
        let evicted_conns: Vec<Arc<MeshObpConnection>> = {
            let mut connections = self
                .connections
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let stale: Vec<(String, String)> = connections
                .iter()
                .filter(|(_, entry)| {
                    entry.connection.closed().is_some()
                        || now.saturating_duration_since(entry.last_used)
                            >= self.limits.connection_idle_ttl
                })
                .map(|(key, _)| key.clone())
                .collect();
            stale
                .into_iter()
                .filter_map(|key| connections.remove(&key).map(|entry| entry.connection))
                .collect()
        };
        let count = evicted_conns.len();
        for conn in evicted_conns {
            conn.request_close();
        }

        let mut unrestore_accounts: Vec<String> = Vec::new();
        {
            let mut facts = self
                .facts
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            facts.retain(|(account, _), cached| {
                let keep =
                    now.saturating_duration_since(cached.last_used) < self.limits.facts_cache_ttl;
                if !keep {
                    unrestore_accounts.push(account.clone());
                }
                keep
            });
        }
        {
            let mut restored = self
                .restored
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            for account in &unrestore_accounts {
                restored.remove(account);
            }
            let expired_restored: Vec<String> = restored
                .iter()
                .filter(|(_, at)| {
                    now.saturating_duration_since(**at) >= self.limits.facts_cache_ttl
                })
                .map(|(account, _)| account.clone())
                .collect();
            for account in &expired_restored {
                restored.remove(account);
            }
            if !expired_restored.is_empty() {
                drop(restored);
                let mut facts = self
                    .facts
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                facts.retain(|(account, _), _| !expired_restored.contains(account));
            }
        }
        count
    }

    fn insert_connection(&self, key: (String, String), connection: Arc<MeshObpConnection>) {
        let now = Instant::now();
        let mut to_close: Vec<Arc<MeshObpConnection>> = Vec::new();
        {
            let mut connections = self
                .connections
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if let Some(previous) = connections.remove(&key) {
                to_close.push(previous.connection);
            }
            let max_conns = self.limits.max_connections.max(1);
            if connections.len() >= max_conns {
                let expired: Vec<(String, String)> = connections
                    .iter()
                    .filter(|(_, entry)| {
                        entry.connection.closed().is_some()
                            || now.saturating_duration_since(entry.last_used)
                                >= self.limits.connection_idle_ttl
                    })
                    .map(|(k, _)| k.clone())
                    .collect();
                for k in expired {
                    if let Some(entry) = connections.remove(&k) {
                        to_close.push(entry.connection);
                    }
                }
            }
            while connections.len() >= max_conns {
                let oldest = connections
                    .iter()
                    .min_by_key(|(_, entry)| entry.last_used)
                    .map(|(k, _)| k.clone());
                let Some(oldest) = oldest else { break };
                if let Some(entry) = connections.remove(&oldest) {
                    to_close.push(entry.connection);
                }
            }
            connections.insert(
                key,
                CachedConnection {
                    connection,
                    last_used: now,
                },
            );
        }
        for conn in to_close {
            conn.request_close();
        }
    }

    fn insert_fact(&self, key: (String, String), snapshot: DeviceSnapshot) {
        let now = Instant::now();
        let mut evicted_accounts: Vec<String> = Vec::new();
        {
            let mut facts = self
                .facts
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let max_facts = self.limits.max_facts.max(1);
            if !facts.contains_key(&key) && facts.len() >= max_facts {
                let expired: Vec<(String, String)> = facts
                    .iter()
                    .filter(|(_, entry)| {
                        now.saturating_duration_since(entry.last_used)
                            >= self.limits.facts_cache_ttl
                    })
                    .map(|(k, _)| k.clone())
                    .collect();
                for k in expired {
                    facts.remove(&k);
                    evicted_accounts.push(k.0);
                }
            }
            while !facts.contains_key(&key) && facts.len() >= max_facts {
                let oldest = facts
                    .iter()
                    .min_by_key(|(_, entry)| entry.last_used)
                    .map(|(k, _)| k.clone());
                let Some(oldest) = oldest else { break };
                facts.remove(&oldest);
                evicted_accounts.push(oldest.0);
            }
            facts.insert(
                key,
                Cached {
                    at: now,
                    last_used: now,
                    snapshot,
                },
            );
        }
        if !evicted_accounts.is_empty() {
            let mut restored = self
                .restored
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            for account in evicted_accounts {
                restored.remove(&account);
            }
        }
    }

    async fn credentials(&self, account_id: &str) -> Result<(String, [u8; 32], String), RpcError> {
        let slot = self
            .slots
            .load(account_id, openbitfun_obp::now_ms(), None)
            .await
            .map_err(|e| RpcError::Transport(e.to_string()))?;
        let state = slot.state.lock().await;
        let token = state.meta.directory_token.clone().ok_or_else(|| {
            RpcError::Transport("the node has no directory credential yet".into())
        })?;
        let secret = node_secret(&state.meta).map_err(RpcError::Transport)?;
        Ok((state.meta.device_id.clone(), secret, token))
    }

    async fn mesh_info(
        &self,
        account_id: &str,
        device_id: &str,
    ) -> Result<openbitfun_obp::MeshInfo, RpcError> {
        let stream = self
            .gateway
            .open(account_id, device_id, None)
            .await
            .map_err(gateway_error)?;
        tokio::time::timeout(
            Duration::from_secs(15),
            client::probe_info(Box::new(stream), device_id),
        )
        .await
        .map_err(|_| RpcError::Transport("mesh info timed out".into()))?
        .map_err(RpcError::Transport)
    }

    async fn connection(
        &self,
        account_id: &str,
        device_id: &str,
    ) -> Result<Arc<MeshObpConnection>, RpcError> {
        let key = (account_id.to_string(), device_id.to_string());
        let cached = {
            let mut connections = self
                .connections
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let now = Instant::now();
            if let Some(entry) = connections.get_mut(&key) {
                if entry.connection.closed().is_none()
                    && now.saturating_duration_since(entry.last_used)
                        < self.limits.connection_idle_ttl
                {
                    entry.last_used = now;
                    Some(Ok(Arc::clone(&entry.connection)))
                } else {
                    connections.remove(&key).map(|stale| Err(stale.connection))
                }
            } else {
                None
            }
        };
        match cached {
            Some(Ok(connection)) => return Ok(connection),
            Some(Err(stale)) => stale.request_close(),
            None => {}
        }

        let info = self.mesh_info(account_id, device_id).await?;
        if !info
            .capabilities
            .iter()
            .any(|c| c == CLOUD_AGENT_SCOPE_CAPABILITY)
        {
            return Err(RpcError::UpdateRequired(format!(
                "{}: device {device_id} does not admit the cloud agent yet",
                reason::SUPERAGENT_REQUIRES_UPDATE
            )));
        }
        let (local, secret, token) = self.credentials(account_id).await?;
        let (public, _kind) = self
            .directory
            .device_key(&token, device_id)
            .await
            .map_err(|e| RpcError::Transport(e.to_string()))?;
        let public = crypto::parse_public_key(&public).map_err(RpcError::Transport)?;
        let pair_key = crypto::derive_pair_key(&secret, &public).map_err(RpcError::Transport)?;
        let stream = self
            .gateway
            .open(account_id, device_id, None)
            .await
            .map_err(gateway_error)?;
        let connection = tokio::time::timeout(
            Duration::from_secs(20),
            client::connect(
                Box::new(stream),
                Dial {
                    local_device_id: &local,
                    target_device_id: device_id,
                    pair_key,
                    authority: format!("{device_id}:{}", openbitfun_link::MESH_OBP_PORT_FIRST),
                    client: self.client_name.clone(),
                },
                MeshConnectOptions::default(),
            ),
        )
        .await
        .map_err(|_| RpcError::Transport("the device connection timed out".into()))?
        .map_err(|error| {
            if error.starts_with("mesh_refused") {
                RpcError::Refused(error)
            } else {
                RpcError::Transport(error)
            }
        })?;
        let connection = Arc::new(connection);
        self.insert_connection(key, Arc::clone(&connection));
        Ok(connection)
    }

    /// Reads the account's persisted device facts once per resident window, so
    /// a device that is offline after a restart keeps what it last reported.
    async fn restore_facts(&self, account_id: &str) {
        let now = Instant::now();
        let evicted_account = {
            let mut restored = self
                .restored
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if let Some(at) = restored.get_mut(account_id) {
                *at = now;
                return;
            }
            let max_restored = self.limits.max_restored.max(1);
            let mut evicted = None;
            if restored.len() >= max_restored {
                if let Some(oldest) = restored
                    .iter()
                    .min_by_key(|(_, at)| **at)
                    .map(|(account, _)| account.clone())
                {
                    restored.remove(&oldest);
                    evicted = Some(oldest);
                }
            }
            restored.insert(account_id.to_string(), now);
            evicted
        };
        if let Some(evicted) = evicted_account {
            self.facts
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .retain(|(account, _), _| account != &evicted);
        }
        let slot = match self
            .slots
            .load(account_id, openbitfun_obp::now_ms(), None)
            .await
        {
            Ok(slot) => slot,
            Err(error) => {
                self.restored
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .remove(account_id);
                log::debug!("Superagent device facts not restored: {}", error);
                return;
            }
        };
        let held = slot.device_facts();
        for (device_id, snapshot) in held {
            let key = (account_id.to_string(), device_id);
            let exists = self
                .facts
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .contains_key(&key);
            if !exists {
                self.insert_fact(key, snapshot);
            }
        }
    }

    /// Persists a device's facts when they changed since it was last seen.
    async fn persist_facts(
        &self,
        account_id: &str,
        previous: Option<&DeviceSnapshot>,
        snapshot: &DeviceSnapshot,
    ) {
        let held = |snapshot: &DeviceSnapshot| {
            let mut held = snapshot.clone();
            held.facts.online = false;
            held.facts.latency_ms = None;
            held
        };
        if previous.map(held) == Some(held(snapshot)) {
            return;
        }
        match self
            .slots
            .load(account_id, openbitfun_obp::now_ms(), None)
            .await
        {
            Ok(slot) => {
                if let Err(error) = slot.save_device_facts(snapshot).await {
                    log::warn!("Superagent device facts not saved: {}", error);
                }
            }
            Err(error) => log::debug!("Superagent device facts not saved: {}", error),
        }
    }

    async fn snapshot(
        &self,
        account_id: &str,
        row: &crate::directory::DirectoryDevice,
        online: bool,
        latency: Option<u32>,
    ) -> DeviceSnapshot {
        let key = (account_id.to_string(), row.device_id.clone());
        let cached = {
            let mut facts = self
                .facts
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            facts.get_mut(&key).map(|cached| {
                cached.last_used = Instant::now();
                (cached.at, cached.snapshot.clone())
            })
        };
        if let Some((at, cached)) = &cached {
            // An offline device keeps its last known facts (capabilities,
            // workspaces; persisted, so they survive a restart), so the
            // dispatch gate can answer `device_offline` (queueable) instead
            // of `superagent_requires_update`.
            if !online {
                let mut last = cached.clone();
                last.facts.online = false;
                last.facts.latency_ms = None;
                return last;
            }
            if at.elapsed() < FACTS_TTL && cached.facts.online == online {
                return cached.clone();
            }
        }
        let previous = cached.map(|(_, snapshot)| snapshot);
        let mut snapshot = DeviceSnapshot {
            facts: RuntimeFacts {
                device_id: row.device_id.clone(),
                name: row
                    .device_alias
                    .clone()
                    .unwrap_or_else(|| row.device_name.clone()),
                host_kind: host_kind(row.device_kind.as_deref()),
                os: row.device_os.clone().unwrap_or_default(),
                online,
                accept_dispatch: true,
                allow_auto_approval: true,
                latency_ms: latency,
                ..RuntimeFacts::default()
            },
            version: row.client_version.clone(),
            ..DeviceSnapshot::default()
        };
        if online {
            if let Ok(info) = self.mesh_info(account_id, &row.device_id).await {
                snapshot.facts.host_capabilities = info.capabilities.clone();
                if !info.backend_version.is_empty() {
                    snapshot.version = Some(info.backend_version);
                }
            }
            if snapshot
                .facts
                .host_capabilities
                .iter()
                .any(|c| c == CLOUD_AGENT_SCOPE_CAPABILITY)
            {
                if let Ok(probe) = self
                    .call_inner(
                        account_id,
                        &row.device_id,
                        "dispatch_target_probe",
                        json!({}),
                    )
                    .await
                {
                    apply_probe(&mut snapshot, &probe);
                }
                if let Ok(digest) = self
                    .call_inner(
                        account_id,
                        &row.device_id,
                        "fleet_digest",
                        json!({ "request": {} }),
                    )
                    .await
                {
                    snapshot.workspaces = digest
                        .get("workspaces")
                        .and_then(Value::as_array)
                        .map(|items| items.iter().take(MAX_WORKSPACES).cloned().collect())
                        .unwrap_or_default();
                    // The account-wide model catalog (absent on older builds).
                    snapshot.model_catalog = digest
                        .get("models")
                        .cloned()
                        .and_then(|models| serde_json::from_value(models).ok())
                        .map(|mut models| {
                            openbitfun_product_domains::fleet::bound_catalog(&mut models);
                            models
                        })
                        .unwrap_or_default();
                }
            }
        }
        // Only facts the device itself reported are worth keeping.
        if online && !snapshot.facts.host_capabilities.is_empty() {
            self.persist_facts(account_id, previous.as_ref(), &snapshot)
                .await;
        }
        self.insert_fact(key, snapshot.clone());
        snapshot
    }

    async fn call_inner(
        &self,
        account_id: &str,
        device_id: &str,
        command: &str,
        args: Value,
    ) -> Result<Value, RpcError> {
        let connection = self.connection(account_id, device_id).await?;
        let dispatch = command.starts_with("dispatch_target_");
        let args = if dispatch {
            openbitfun_core_types::agent_identity_wire::translate_agent_identity_command(
                command,
                args,
                openbitfun_core_types::agent_identity_wire::AgentIdentityDialect::Legacy,
            )
            .map_err(RpcError::Refused)?
        } else {
            args
        };
        let answer = tokio::time::timeout(CALL_TIMEOUT, connection.call(command, args)).await;
        let answer = match answer {
            Ok(answer) => answer,
            Err(_) => {
                self.drop_connection(account_id, device_id, &connection);
                return Err(RpcError::Transport(format!("{command} timed out")));
            }
        };
        match answer {
            Ok(value) if dispatch => {
                openbitfun_core_types::agent_identity_wire::translate_agent_identity_response(
                    command,
                    value,
                    &Value::Null,
                    openbitfun_core_types::agent_identity_wire::AgentIdentityDialect::Canonical,
                )
                .map_err(RpcError::Refused)
            }
            Ok(value) => Ok(value),
            Err(error) if error.is_transport() => {
                self.drop_connection(account_id, device_id, &connection);
                Err(RpcError::Transport(error.message))
            }
            Err(error) => Err(RpcError::Refused(error.message)),
        }
    }

    fn drop_connection(
        &self,
        account_id: &str,
        device_id: &str,
        connection: &Arc<MeshObpConnection>,
    ) {
        let key = (account_id.to_string(), device_id.to_string());
        let removed = {
            let mut connections = self
                .connections
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if connections
                .get(&key)
                .is_some_and(|entry| Arc::ptr_eq(&entry.connection, connection))
            {
                connections.remove(&key).map(|entry| entry.connection)
            } else {
                None
            }
        };
        if let Some(conn) = removed {
            conn.request_close();
        }
    }
}

fn apply_probe(snapshot: &mut DeviceSnapshot, probe: &Value) {
    let strings = |value: Option<&Value>| -> Vec<String> {
        value
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default()
    };
    snapshot.facts.dispatch_capabilities = strings(probe.get("capabilities"));
    if let Some(os) = probe.get("os").and_then(Value::as_str) {
        snapshot.facts.os = os.to_string();
    }
    if let Some(arch) = probe.get("arch").and_then(Value::as_str) {
        snapshot.facts.arch = arch.to_string();
    }
    snapshot.facts.model_configured = probe
        .get("modelConfigured")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    snapshot.models = strings(probe.get("availableModels"));
    if let Some(accept) = probe.get("acceptDispatch").and_then(Value::as_bool) {
        snapshot.facts.accept_dispatch = accept;
    }
    if let Some(auto) = probe.get("allowAutoApproval").and_then(Value::as_bool) {
        snapshot.facts.allow_auto_approval = auto;
    }
}

impl DeviceRpc for LinkRpc {
    fn devices<'a>(
        &'a self,
        account_id: &'a str,
    ) -> BoxFuture<'a, Result<Vec<DeviceSnapshot>, RpcError>> {
        Box::pin(async move {
            let (_, _, token) = self.credentials(account_id).await?;
            self.restore_facts(account_id).await;
            let rows = self
                .directory
                .devices(&token)
                .await
                .map_err(|e| RpcError::Transport(e.to_string()))?;
            let peers = self.gateway.peers(account_id).await.unwrap_or_default();
            // Devices that left the account lose their kept facts.
            let known: Vec<String> = rows
                .iter()
                .filter(|row| {
                    matches!(
                        row.device_kind.as_deref(),
                        None | Some("desktop") | Some("cli")
                    )
                })
                .map(|row| row.device_id.clone())
                .collect();
            self.facts
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .retain(|(account, device), _| account != account_id || known.contains(device));
            if let Ok(slot) = self
                .slots
                .load(account_id, openbitfun_obp::now_ms(), None)
                .await
            {
                slot.prune_device_facts(Some(&known)).await;
            }
            let mut out = Vec::new();
            for row in rows.iter().filter(|row| {
                matches!(
                    row.device_kind.as_deref(),
                    None | Some("desktop") | Some("cli")
                )
            }) {
                let peer = peers.iter().find(|peer| peer.hostname == row.device_id);
                let latency = peer
                    .and_then(|peer| peer.latency_ms)
                    .map(|ms| ms.round().clamp(0.0, u32::MAX as f64) as u32);
                out.push(
                    self.snapshot(account_id, row, peer.is_some(), latency)
                        .await,
                );
            }
            Ok(out)
        })
    }

    fn call<'a>(
        &'a self,
        account_id: &'a str,
        device_id: &'a str,
        command: &'a str,
        args: Value,
    ) -> BoxFuture<'a, Result<Value, RpcError>> {
        Box::pin(self.call_inner(account_id, device_id, command, args))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::directory::{DirectoryDevice, DirectoryError};
    use crate::slots::{AccountMeta, SlotLimits};
    use crate::store::Store;
    use base64::Engine as _;
    use openbitfun_link::gateway::{GatewayLimits, GatewayNetworks};
    use openbitfun_link::handshake::{self, Claims, Role};
    use openbitfun_link::MeshCredentials;
    use openbitfun_obp::client::cloud::{CloudNodeConnector, CloudStreamOpener};
    use openbitfun_obp::client::{MeshAuthority, MeshIo, MeshOpenFuture};
    use openbitfun_obp::server::e2e::{
        client_fingerprint, decode_message, derive_keys, encode_message, read_record,
        server_fingerprint, write_record, ClientHello, RecordCipher, ServerHello, MAGIC,
        RECORD_MAX, VERSION,
    };
    use tokio::io::AsyncReadExt;
    use x25519_dalek::{PublicKey, StaticSecret};

    struct DummyNetworks;
    impl GatewayNetworks for DummyNetworks {
        fn member(&self, account_id: &str, _member_id: &str) -> Result<MeshCredentials, String> {
            Ok(MeshCredentials {
                version: 1,
                network_name: format!("obf-{account_id}"),
                network_secret: "secret".into(),
                peers: vec!["ws://127.0.0.1:11011/".into()],
                easytier_version: None,
                issued_at: None,
                join_token: None,
                join_token_expires_at: None,
            })
        }
    }

    struct DummyDirectory;
    impl Directory for DummyDirectory {
        fn register<'a>(
            &'a self,
            _a: &'a str,
            _d: &'a str,
            _n: &'a str,
            _k: &'a str,
        ) -> BoxFuture<'a, Result<String, DirectoryError>> {
            Box::pin(async { Ok("tok".into()) })
        }
        fn unregister<'a>(
            &'a self,
            _a: &'a str,
            _d: &'a str,
            _t: Option<&'a str>,
        ) -> BoxFuture<'a, Result<(), DirectoryError>> {
            Box::pin(async { Ok(()) })
        }
        fn devices<'a>(
            &'a self,
            _t: &'a str,
        ) -> BoxFuture<'a, Result<Vec<DirectoryDevice>, DirectoryError>> {
            Box::pin(async { Ok(Vec::new()) })
        }
        fn device_key<'a>(
            &'a self,
            _t: &'a str,
            _d: &'a str,
        ) -> BoxFuture<'a, Result<(String, Option<String>), DirectoryError>> {
            Box::pin(async { Err(DirectoryError::NotFound) })
        }
    }

    struct PairAuthority {
        pair_key: [u8; 32],
    }

    impl MeshAuthority for PairAuthority {
        fn local_device_id(&self) -> Option<String> {
            Some("laptop-test".to_string())
        }

        fn pair_key<'a>(
            &'a self,
            _device_id: &'a str,
        ) -> std::pin::Pin<
            Box<dyn std::future::Future<Output = Result<[u8; 32], String>> + Send + 'a>,
        > {
            let key = self.pair_key;
            Box::pin(async move { Ok(key) })
        }
    }

    struct DuplexOpener {
        pair_key: [u8; 32],
    }

    impl CloudStreamOpener for DuplexOpener {
        fn open(&self) -> MeshOpenFuture<'_> {
            let pair_key = self.pair_key;
            Box::pin(async move {
                let (client_io, mut server_io) = tokio::io::duplex(64 * 1024);
                tokio::spawn(async move {
                    let b64 = base64::engine::general_purpose::URL_SAFE_NO_PAD;
                    let mut magic = [0u8; 8];
                    if server_io.read_exact(&mut magic).await.is_err() || &magic != MAGIC {
                        return;
                    }
                    let Ok(raw) = read_record(&mut server_io, 4096).await else {
                        return;
                    };
                    let Ok(hello) = serde_json::from_slice::<ClientHello>(&raw) else {
                        return;
                    };
                    let client_eph: [u8; 32] = b64.decode(&hello.eph).unwrap().try_into().unwrap();
                    let secret = StaticSecret::random_from_rng(rand::rngs::OsRng);
                    let server_eph = b64.encode(PublicKey::from(&secret).as_bytes());
                    let shared = secret.diffie_hellman(&PublicKey::from(client_eph));
                    let key = handshake::handshake_key(&pair_key);
                    let claims = Claims {
                        client_device_id: hello.device,
                        server_device_id: hello.target,
                        cert_fingerprint: server_fingerprint(&hello.eph, &server_eph),
                        time_ms: hello.time,
                        nonce: hello.nonce,
                    };
                    let proof = handshake::prove(&key, Role::Server, &claims);
                    let answer = ServerHello {
                        v: VERSION,
                        eph: server_eph,
                        proof: proof.clone(),
                        protocol: openbitfun_obp::OBP_PROTOCOL_VERSION,
                        capabilities: vec!["obp_v1".into()],
                    };
                    let _ =
                        write_record(&mut server_io, &serde_json::to_vec(&answer).unwrap()).await;
                    let (c2s, s2c) = derive_keys(&key, shared.as_bytes(), &hello.proof, &proof);
                    let mut inbound = RecordCipher::new(&c2s);
                    let mut outbound = RecordCipher::new(&s2c);
                    let _ = client_fingerprint;
                    while let Ok(rec) = read_record(&mut server_io, RECORD_MAX).await {
                        let Ok(msg) = inbound.open(&rec).and_then(decode_message) else {
                            break;
                        };
                        match msg {
                            axum::extract::ws::Message::Text(text) => {
                                let req: Value = serde_json::from_str(&text).unwrap();
                                if req["method"] == "hello" {
                                    let resp = json!({
                                        "jsonrpc": "2.0",
                                        "id": req["id"],
                                        "result": {
                                            "protocol": 1,
                                            "scope": "cloud-agent",
                                            "capabilities": ["obp_v1"],
                                            "backend": { "version": "2.0.0", "platform": "test", "instanceId": "i1" },
                                            "lastSeq": 0,
                                            "creditBytes": null
                                        }
                                    });
                                    let sealed = outbound
                                        .seal(&encode_message(&axum::extract::ws::Message::Text(
                                            resp.to_string().into(),
                                        )))
                                        .unwrap();
                                    let _ = write_record(&mut server_io, &sealed).await;
                                }
                            }
                            axum::extract::ws::Message::Close(_) => break,
                            _ => {}
                        }
                    }
                });
                Ok(Box::new(client_io) as Box<dyn MeshIo>)
            })
        }
    }

    /// Creates a real in-memory `MeshObpConnection` backed by an E2E duplex
    /// pair so tests can observe `closed()` when `LinkRpc` evicts and closes it.
    async fn fake_mesh_connection(device_id: &str) -> Arc<MeshObpConnection> {
        let pair_key = [42u8; 32];
        let connector = CloudNodeConnector::new(
            Arc::new(DuplexOpener { pair_key }),
            Arc::new(PairAuthority { pair_key }),
            "test".to_string(),
        );
        let cloud_id = format!("cloud-{device_id}");
        Arc::new(
            connector
                .connect(&cloud_id, MeshConnectOptions::default())
                .await
                .unwrap(),
        )
    }

    #[tokio::test]
    async fn idle_eviction_and_slot_unload_close_connections_and_bound_caches() {
        let dir = tempfile::tempdir().unwrap();
        let store = Arc::new(Store::open(dir.path(), [3u8; 32]).unwrap());
        let slots = Arc::new(Slots::new(
            store,
            SlotLimits {
                max_resident: 4,
                idle_unload_ms: 50,
                ..SlotLimits::default()
            },
        ));
        let gateway = LinkGateway::new(
            Arc::new(DummyNetworks),
            "agent-test",
            GatewayLimits::default(),
        )
        .unwrap();
        let rpc = LinkRpc::new_with_limits(
            Arc::clone(&gateway),
            Arc::new(DummyDirectory),
            Arc::clone(&slots),
            LinkRpcLimits {
                connection_idle_ttl: Duration::from_millis(60),
                sweep_interval: Duration::from_secs(3600),
                max_connections: 2,
                facts_cache_ttl: Duration::from_millis(60),
                max_facts: 2,
                max_restored: 2,
            },
        );

        // 1. Cap eviction on connections (max_connections = 2): inserting 3rd closes oldest.
        let c1 = fake_mesh_connection("d1").await;
        let c2 = fake_mesh_connection("d2").await;
        let c3 = fake_mesh_connection("d3").await;
        rpc.insert_connection(("acc-1".into(), "d1".into()), Arc::clone(&c1));
        tokio::time::sleep(Duration::from_millis(5)).await;
        rpc.insert_connection(("acc-2".into(), "d2".into()), Arc::clone(&c2));
        tokio::time::sleep(Duration::from_millis(5)).await;
        rpc.insert_connection(("acc-3".into(), "d3".into()), Arc::clone(&c3));
        assert_eq!(rpc.connections.lock().unwrap().len(), 2);
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert!(
            c1.closed().is_some(),
            "LRU evicted connection must be closed"
        );
        assert!(c2.closed().is_none());
        assert!(c3.closed().is_none());

        // 2. Slot unload automatically evicts account's connections, facts, and restored.
        let slot2 = slots
            .load(
                "acc-2",
                100,
                Some(AccountMeta {
                    version: 1,
                    account_id: "acc-2".into(),
                    device_id: "cloud-2".into(),
                    enabled: true,
                    ..AccountMeta::default()
                }),
            )
            .await
            .unwrap();
        drop(slot2);
        rpc.insert_fact(("acc-2".into(), "d2".into()), DeviceSnapshot::default());
        rpc.restored
            .lock()
            .unwrap()
            .insert("acc-2".into(), Instant::now());
        assert_eq!(slots.unload_idle(200), 1);
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert!(
            c2.closed().is_some(),
            "slot unload must close the account's pooled connection"
        );
        assert!(!rpc
            .facts
            .lock()
            .unwrap()
            .contains_key(&("acc-2".into(), "d2".into())));
        assert!(!rpc.restored.lock().unwrap().contains_key("acc-2"));

        // 3. Idle TTL eviction closes remaining connection and prunes facts/restored.
        rpc.insert_fact(("acc-3".into(), "d3".into()), DeviceSnapshot::default());
        rpc.restored
            .lock()
            .unwrap()
            .insert("acc-3".into(), Instant::now());
        tokio::time::sleep(Duration::from_millis(80)).await;
        let evicted = rpc.evict_idle();
        assert_eq!(evicted, 1);
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert!(
            c3.closed().is_some(),
            "idle sweep must close expired connection"
        );
        assert!(rpc.facts.lock().unwrap().is_empty());
        assert!(rpc.restored.lock().unwrap().is_empty());

        // 4. Facts cap stays bounded at max_facts = 2.
        rpc.insert_fact(("a".into(), "1".into()), DeviceSnapshot::default());
        rpc.insert_fact(("b".into(), "1".into()), DeviceSnapshot::default());
        rpc.insert_fact(("c".into(), "1".into()), DeviceSnapshot::default());
        assert_eq!(rpc.facts.lock().unwrap().len(), 2);

        gateway.shutdown().await;
    }
}

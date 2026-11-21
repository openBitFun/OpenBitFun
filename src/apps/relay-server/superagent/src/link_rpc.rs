//! The real [`DeviceRpc`]: the account's devices over its Link network.
//!
//! The node joins an account network as its own member (`agent-<site>`,
//! membership minted from the issuer key) through `LinkGateway`, which
//! leaves a network idle for ten minutes; the watcher only polls accounts
//! with live jobs or unfinished turns, so membership is held only while
//! something needs it. Each device is dialed with the account-device
//! handshake over the pair key of the node's directory key and the device's
//! public key; devices that see the `cloud_agent` row kind grant the
//! cloud-agent scope (the account-device allowlist plus the model relay). A device whose mesh info lacks `cloud_agent_scope_v1`
//! is never dialed for a command (`superagent_requires_update`).

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::{Duration, Instant};

use openbitfun_link::gateway::{GatewayError, LinkGateway};
use openbitfun_obp::client::{self, Dial, MeshConnectOptions, MeshObpConnection};
use openbitfun_product_domains::fleet::FleetHostKind;
use openbitfun_product_domains::superagent::{reason, RuntimeFacts, CLOUD_AGENT_SCOPE_CAPABILITY};
use serde_json::{json, Value};
use tokio::sync::Mutex;

use crate::api::node_secret;
use crate::crypto;
use crate::device::{BoxFuture, DeviceRpc, DeviceSnapshot, RpcError};
use crate::directory::Directory;
use crate::slots::Slots;

const FACTS_TTL: Duration = Duration::from_secs(30);
const CALL_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_WORKSPACES: usize = 64;

struct Cached {
    at: Instant,
    snapshot: DeviceSnapshot,
}

pub struct LinkRpc {
    gateway: Arc<LinkGateway>,
    directory: Arc<dyn Directory>,
    slots: Arc<Slots>,
    client_name: String,
    connections: Mutex<HashMap<(String, String), Arc<MeshObpConnection>>>,
    facts: Mutex<HashMap<(String, String), Cached>>,
    /// Accounts whose persisted device facts were read into `facts`.
    restored: Mutex<HashSet<String>>,
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
        Arc::new(Self {
            gateway,
            directory,
            slots,
            client_name: format!("openbitfun-superagent/{}", env!("CARGO_PKG_VERSION")),
            connections: Mutex::new(HashMap::new()),
            facts: Mutex::new(HashMap::new()),
            restored: Mutex::new(HashSet::new()),
        })
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
        if let Some(connection) = self.connections.lock().await.get(&key) {
            if connection.closed().is_none() {
                return Ok(Arc::clone(connection));
            }
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
        self.connections
            .lock()
            .await
            .insert(key, Arc::clone(&connection));
        Ok(connection)
    }

    /// Reads the account's persisted device facts once per process, so a
    /// device that is offline after a restart keeps what it last reported.
    async fn restore_facts(&self, account_id: &str) {
        if !self.restored.lock().await.insert(account_id.to_string()) {
            return;
        }
        let slot = match self
            .slots
            .load(account_id, openbitfun_obp::now_ms(), None)
            .await
        {
            Ok(slot) => slot,
            Err(error) => {
                self.restored.lock().await.remove(account_id);
                log::debug!("Superagent device facts not restored: {}", error);
                return;
            }
        };
        let held = slot.device_facts();
        let mut facts = self.facts.lock().await;
        for (device_id, snapshot) in held {
            facts
                .entry((account_id.to_string(), device_id))
                .or_insert(Cached {
                    at: Instant::now(),
                    snapshot,
                });
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
        let cached = self
            .facts
            .lock()
            .await
            .get(&key)
            .map(|cached| (cached.at, cached.snapshot.clone()));
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
        self.facts.lock().await.insert(
            key,
            Cached {
                at: Instant::now(),
                snapshot: snapshot.clone(),
            },
        );
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
        let answer = tokio::time::timeout(CALL_TIMEOUT, connection.call(command, args))
            .await
            .map_err(|_| RpcError::Transport(format!("{command} timed out")))?;
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
                self.connections
                    .lock()
                    .await
                    .remove(&(account_id.to_string(), device_id.to_string()));
                Err(RpcError::Transport(error.message))
            }
            Err(error) => Err(RpcError::Refused(error.message)),
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
                .await
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

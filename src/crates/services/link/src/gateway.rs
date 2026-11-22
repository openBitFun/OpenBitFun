//! Server-side gateway into account networks (for browsers).
//!
//! Browsers do not run Link. A server process that can mint its own join
//! credentials (it holds the issuer key) joins an account's network on
//! behalf of an authenticated browser session and opens virtual TCP streams
//! to that account's devices, piping bytes only: OBP's own handshake between
//! the browser's registered device key and the device keeps the content
//! end-to-end, so the gateway can neither read nor forge it.
//!
//! Isolation and limits: one node per account network (streams of one
//! account never touch another's network), a cap on accounts and on open
//! streams per account, and idle networks are left after a timeout.
//!
//! The browser-facing route (`wss://<domain>/obp/<deviceId>`) and the browser
//! handshake are the host's; this module only resolves `(account, device)`
//! to a stream.

use std::collections::HashMap;
use std::future::Future;
use std::net::Ipv4Addr;
use std::path::Path;
use std::pin::Pin;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll};
use std::time::{Duration, Instant};

use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::sync::{watch, OwnedSemaphorePermit, Semaphore};

use crate::config::DeviceNodeConfig;
use crate::credentials::MeshCredentials;
use crate::node::{LinkNode, NodeOptions};
use crate::status::{MeshPeer, MeshStatus, NodeRole};
use crate::stream::LinkStream;
use crate::{MESH_OBP_PORT_FIRST, MESH_OBP_PORT_LAST};

/// Refresh the gateway member's join token when less than this remains.
const TOKEN_REFRESH_MARGIN_SECS: i64 = 10 * 60;
/// [`LinkGateway::peers`] rebuilds the status at most this often.
const PEERS_MAX_AGE_MS: u64 = 1_000;
/// How long [`LinkGateway::peers`] waits for routes after joining a network.
const PEERS_SETTLE: Duration = Duration::from_secs(3);

/// Parses a 32-byte key encoded as 64 ASCII hex characters.
pub fn parse_hex_key(text: &str) -> Result<[u8; 32], String> {
    let trimmed = text.trim();
    if trimmed.len() != 64 || !trimmed.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("the key file must hold exactly 64 hex characters".to_string());
    }
    let mut key = [0u8; 32];
    for (index, chunk) in trimmed.as_bytes().chunks(2).enumerate() {
        let hex = std::str::from_utf8(chunk)
            .map_err(|_| "the key file must hold valid ASCII hex".to_string())?;
        key[index] = u8::from_str_radix(hex, 16)
            .map_err(|_| "the key file must hold valid ASCII hex".to_string())?;
    }
    Ok(key)
}

/// Reads a 32-byte hex key file, refusing group/world-accessible permissions
/// on Unix (`chmod 600` required).
pub fn read_hex_key_file(path: &Path) -> Result<[u8; 32], String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(path)
            .map_err(|error| format!("cannot read the key file {}: {error}", path.display()))?
            .permissions()
            .mode();
        if mode & 0o077 != 0 {
            return Err(format!(
                "the key file {} must not be readable by group or others (chmod 600)",
                path.display()
            ));
        }
    }
    let text = std::fs::read_to_string(path)
        .map_err(|error| format!("cannot read the key file {}: {error}", path.display()))?;
    parse_hex_key(&text)
}

/// Mints the gateway's own membership of an account network.
pub trait GatewayNetworks: Send + Sync + 'static {
    /// Credentials of the account's network for the gateway member named
    /// `member_id` (network, secret, relay URLs and a join token). The relay
    /// URL is normally the relay node on this host's loopback.
    fn member(&self, account_id: &str, member_id: &str) -> Result<MeshCredentials, String>;
}

/// Gateway limits.
#[derive(Debug, Clone)]
pub struct GatewayLimits {
    /// Account networks joined at the same time.
    pub max_accounts: usize,
    /// Open streams per account.
    pub max_streams_per_account: usize,
    /// An account network without streams for this long is left.
    pub idle_timeout: Duration,
    /// How long `open` waits for the device to appear and the stream to open.
    pub open_timeout: Duration,
}

impl Default for GatewayLimits {
    fn default() -> Self {
        Self {
            max_accounts: 256,
            max_streams_per_account: 16,
            idle_timeout: Duration::from_secs(10 * 60),
            open_timeout: Duration::from_secs(20),
        }
    }
}

/// Why a stream could not be opened.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GatewayError {
    /// Too many accounts or streams; retry later.
    Busy(String),
    /// The account network could not be joined.
    Unavailable(String),
    /// The device is not in the account network or did not answer.
    Unreachable(String),
}

impl std::fmt::Display for GatewayError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Busy(message) | Self::Unavailable(message) | Self::Unreachable(message) => {
                f.write_str(message)
            }
        }
    }
}

enum StreamInner {
    Link(LinkStream),
    #[cfg(test)]
    Duplex {
        io: tokio::io::DuplexStream,
        peer_device: Option<String>,
    },
}

type BoxFut<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

trait GatewayNode: Send + Sync + 'static {
    fn has_stopped(&self) -> bool;
    fn set_join_token(&self, token: Option<&str>);
    fn status(&self) -> MeshStatus;
    fn refresh_status(&self) -> BoxFut<'_, MeshStatus>;
    fn resolve<'a>(&'a self, device_id: &'a str) -> BoxFut<'a, Option<Ipv4Addr>>;
    fn connect<'a>(
        &'a self,
        device_id: &'a str,
        port: u16,
        timeout: Duration,
    ) -> BoxFut<'a, Result<StreamInner, String>>;
    fn stop(&self) -> BoxFut<'_, ()>;
}

trait NodeStarter: Send + Sync + 'static {
    fn start(
        &self,
        member_id: String,
        credentials: MeshCredentials,
    ) -> BoxFut<'_, Result<Arc<dyn GatewayNode>, String>>;
}

impl GatewayNode for LinkNode {
    fn has_stopped(&self) -> bool {
        LinkNode::has_stopped(self)
    }

    fn set_join_token(&self, token: Option<&str>) {
        LinkNode::set_join_token(self, token);
    }

    fn status(&self) -> MeshStatus {
        LinkNode::status(self)
    }

    fn refresh_status(&self) -> BoxFut<'_, MeshStatus> {
        Box::pin(LinkNode::refresh_status(self))
    }

    fn resolve<'a>(&'a self, device_id: &'a str) -> BoxFut<'a, Option<Ipv4Addr>> {
        Box::pin(LinkNode::resolve(self, device_id))
    }

    fn connect<'a>(
        &'a self,
        device_id: &'a str,
        port: u16,
        timeout: Duration,
    ) -> BoxFut<'a, Result<StreamInner, String>> {
        Box::pin(async move {
            LinkNode::connect(self, device_id, port, timeout)
                .await
                .map(StreamInner::Link)
        })
    }

    fn stop(&self) -> BoxFut<'_, ()> {
        Box::pin(LinkNode::stop(self))
    }
}

struct RealNodeStarter;

impl NodeStarter for RealNodeStarter {
    fn start(
        &self,
        member_id: String,
        credentials: MeshCredentials,
    ) -> BoxFut<'_, Result<Arc<dyn GatewayNode>, String>> {
        Box::pin(async move {
            let config = DeviceNodeConfig {
                instance_name: format!("gateway-{}", &credentials.network_name),
                hostname: member_id.clone(),
                credentials: credentials.clone(),
                listener_port: None,
                inbound_tcp_ports: (MESH_OBP_PORT_FIRST, MESH_OBP_PORT_LAST),
                // The gateway reaches devices through the relay on this host.
                disable_p2p: true,
            };
            // A browser session is a controller: devices list the gateway
            // member as one and never probe it.
            let node = LinkNode::start_as(
                NodeOptions {
                    config_toml: config.render_as(NodeRole::Controller)?,
                    network_name: credentials.network_name,
                    hostname: member_id,
                    join_token: credentials.join_token,
                    status_interval: Duration::from_secs(10),
                },
                NodeRole::Controller,
            )
            .await?;
            Ok(node as Arc<dyn GatewayNode>)
        })
    }
}

struct ReadyAccount {
    node: Arc<dyn GatewayNode>,
    permits: Arc<Semaphore>,
    /// Counts non-stream operations (such as `peers()`) actively using this node.
    active_ops: Arc<AtomicUsize>,
    /// Monotonic milliseconds since `LinkGateway::epoch`.
    last_used_ms: Arc<AtomicU64>,
    token_expires_at: Option<i64>,
}

impl ReadyAccount {
    fn is_idle(&self, max_streams: usize) -> bool {
        self.permits.available_permits() == max_streams
            && self.active_ops.load(Ordering::Acquire) == 0
    }
}

enum SlotEntry {
    Joining {
        id: u64,
        done: watch::Receiver<bool>,
    },
    Ready(ReadyAccount),
}

struct AccountsState {
    map: HashMap<String, SlotEntry>,
    next_join_id: u64,
    shutting_down: bool,
}

impl AccountsState {
    fn new() -> Self {
        Self {
            map: HashMap::new(),
            next_join_id: 1,
            shutting_down: false,
        }
    }
}

/// Cleans up a `SlotEntry::Joining` placeholder if the joining task fails or
/// is cancelled before installing a `Ready` account.
struct JoinGuard {
    accounts: Arc<Mutex<AccountsState>>,
    account_id: String,
    join_id: u64,
    done_tx: Option<watch::Sender<bool>>,
    armed: bool,
}

impl JoinGuard {
    fn disarm(&mut self) {
        self.armed = false;
        if let Some(tx) = self.done_tx.take() {
            let _ = tx.send(true);
        }
    }
}

impl Drop for JoinGuard {
    fn drop(&mut self) {
        if self.armed {
            let mut state = self
                .accounts
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if matches!(
                state.map.get(&self.account_id),
                Some(SlotEntry::Joining { id, .. }) if *id == self.join_id
            ) {
                state.map.remove(&self.account_id);
            }
        }
        if let Some(tx) = self.done_tx.take() {
            let _ = tx.send(true);
        }
    }
}

/// Holds a reserved per-account stream permit from before `resolve`/`connect`
/// until either converted into a [`GatewayStream`] or dropped on error/cancel.
struct StreamReservation {
    permit: Option<OwnedSemaphorePermit>,
    last_used_ms: Arc<AtomicU64>,
    epoch: Instant,
}

impl StreamReservation {
    fn into_stream(mut self, inner: StreamInner) -> GatewayStream {
        let permit = self.permit.take().expect("reservation holds permit");
        let last_used_ms = Arc::clone(&self.last_used_ms);
        let epoch = self.epoch;
        last_used_ms.store(epoch.elapsed().as_millis() as u64, Ordering::Release);
        GatewayStream {
            inner,
            _permit: permit,
            last_used_ms,
            epoch,
        }
    }
}

impl Drop for StreamReservation {
    fn drop(&mut self) {
        self.last_used_ms
            .store(self.epoch.elapsed().as_millis() as u64, Ordering::Release);
        // `self.permit` drops after this method, so `last_used_ms` is updated
        // before the permit becomes visible to `maintain()`.
    }
}

/// Holds an active non-stream operation count (e.g. `peers()`) so `maintain()`
/// and capacity eviction never stop a node while a call is using it.
struct OpGuard {
    active_ops: Arc<AtomicUsize>,
    last_used_ms: Arc<AtomicU64>,
    epoch: Instant,
}

impl Drop for OpGuard {
    fn drop(&mut self) {
        self.last_used_ms
            .store(self.epoch.elapsed().as_millis() as u64, Ordering::Release);
        self.active_ops.fetch_sub(1, Ordering::AcqRel);
    }
}

enum AcquireMode {
    Stream,
    Op,
}

enum Acquired {
    Stream(Arc<dyn GatewayNode>, StreamReservation),
    Op(Arc<dyn GatewayNode>, OpGuard, bool),
}

/// The gateway of one server process.
pub struct LinkGateway {
    networks: Arc<dyn GatewayNetworks>,
    starter: Arc<dyn NodeStarter>,
    limits: GatewayLimits,
    member_id: String,
    epoch: Instant,
    /// Short non-async lock: never held across `.await`.
    accounts: Arc<Mutex<AccountsState>>,
    reaper: Mutex<Option<tokio::task::JoinHandle<()>>>,
}

fn now_secs() -> i64 {
    (crate::now_ms() / 1000) as i64
}

impl LinkGateway {
    /// A gateway whose members are named `member_id` in every account
    /// network (a Link hostname, e.g. `gateway-<site>`).
    pub fn new(
        networks: Arc<dyn GatewayNetworks>,
        member_id: &str,
        limits: GatewayLimits,
    ) -> Result<Arc<Self>, String> {
        Self::new_with_starter(networks, Arc::new(RealNodeStarter), member_id, limits, true)
    }

    fn new_with_starter(
        networks: Arc<dyn GatewayNetworks>,
        starter: Arc<dyn NodeStarter>,
        member_id: &str,
        limits: GatewayLimits,
        spawn_reaper: bool,
    ) -> Result<Arc<Self>, String> {
        if !crate::config::valid_hostname(member_id) {
            return Err(format!("invalid gateway member id: {member_id}"));
        }
        let gateway = Arc::new(Self {
            networks,
            starter,
            limits,
            member_id: member_id.to_string(),
            epoch: Instant::now(),
            accounts: Arc::new(Mutex::new(AccountsState::new())),
            reaper: Mutex::new(None),
        });
        if spawn_reaper {
            let weak = Arc::downgrade(&gateway);
            let reaper = tokio::spawn(async move {
                loop {
                    tokio::time::sleep(Duration::from_secs(30)).await;
                    let Some(gateway) = weak.upgrade() else {
                        return;
                    };
                    gateway.maintain().await;
                }
            });
            *gateway
                .reaper
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(reaper);
        }
        Ok(gateway)
    }

    fn elapsed_ms(&self) -> u64 {
        self.epoch.elapsed().as_millis() as u64
    }

    fn lock_accounts(&self) -> std::sync::MutexGuard<'_, AccountsState> {
        self.accounts
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Account networks joined now.
    pub async fn joined_accounts(&self) -> usize {
        self.lock_accounts()
            .map
            .values()
            .filter(|entry| matches!(entry, SlotEntry::Ready(_)))
            .count()
    }

    /// Leaves idle networks and refreshes join tokens.
    async fn maintain(&self) {
        let now_ms = self.elapsed_ms();
        let idle_ms = self.limits.idle_timeout.as_millis() as u64;
        let max_streams = self.limits.max_streams_per_account;
        let now_sec = now_secs();

        let mut to_stop: Vec<Arc<dyn GatewayNode>> = Vec::new();
        let mut to_refresh: Vec<(String, Arc<dyn GatewayNode>)> = Vec::new();
        {
            let mut state = self.lock_accounts();
            let mut remove_keys: Vec<String> = Vec::new();
            for (account, entry) in state.map.iter() {
                let SlotEntry::Ready(ready) = entry else {
                    continue;
                };
                if ready.node.has_stopped() {
                    remove_keys.push(account.clone());
                    continue;
                }
                if ready.is_idle(max_streams)
                    && now_ms.saturating_sub(ready.last_used_ms.load(Ordering::Acquire)) > idle_ms
                {
                    remove_keys.push(account.clone());
                    to_stop.push(Arc::clone(&ready.node));
                    continue;
                }
                let refresh = ready
                    .token_expires_at
                    .is_some_and(|expires| expires - TOKEN_REFRESH_MARGIN_SECS <= now_sec);
                if refresh {
                    to_refresh.push((account.clone(), Arc::clone(&ready.node)));
                }
            }
            for account in remove_keys {
                state.map.remove(&account);
            }
        }

        for node in to_stop {
            node.stop().await;
            log::info!("Gateway left an idle account network");
        }

        for (account, node) in to_refresh {
            match self.networks.member(&account, &self.member_id) {
                Ok(credentials) => {
                    node.set_join_token(credentials.join_token.as_deref());
                    let mut state = self.lock_accounts();
                    if let Some(SlotEntry::Ready(ready)) = state.map.get_mut(&account) {
                        if Arc::ptr_eq(&ready.node, &node) {
                            ready.token_expires_at = credentials.join_token_expires_at;
                        }
                    }
                }
                Err(error) => log::warn!("Gateway token refresh failed: {}", error),
            }
        }
    }

    async fn acquire(&self, account_id: &str, mode: AcquireMode) -> Result<Acquired, GatewayError> {
        let max_streams = self.limits.max_streams_per_account;
        if matches!(mode, AcquireMode::Stream) && max_streams == 0 {
            return Err(GatewayError::Busy(
                "gateway_busy: too many open streams for this account".into(),
            ));
        }
        loop {
            let (waiter, join_ctx) = {
                let mut state = self.lock_accounts();
                if state.shutting_down {
                    return Err(GatewayError::Unavailable(
                        "gateway is shutting down".to_string(),
                    ));
                }
                enum Lookup {
                    Found(Result<Acquired, GatewayError>),
                    Wait(watch::Receiver<bool>),
                    Join,
                }
                let lookup = match state.map.get(account_id) {
                    Some(SlotEntry::Ready(ready)) if !ready.node.has_stopped() => {
                        ready
                            .last_used_ms
                            .store(self.elapsed_ms(), Ordering::Release);
                        match mode {
                            AcquireMode::Stream => {
                                match ready.permits.clone().try_acquire_owned() {
                                    Ok(permit) => Lookup::Found(Ok(Acquired::Stream(
                                        Arc::clone(&ready.node),
                                        StreamReservation {
                                            permit: Some(permit),
                                            last_used_ms: Arc::clone(&ready.last_used_ms),
                                            epoch: self.epoch,
                                        },
                                    ))),
                                    Err(_) => Lookup::Found(Err(GatewayError::Busy(
                                        "gateway_busy: too many open streams for this account"
                                            .into(),
                                    ))),
                                }
                            }
                            AcquireMode::Op => {
                                ready.active_ops.fetch_add(1, Ordering::AcqRel);
                                Lookup::Found(Ok(Acquired::Op(
                                    Arc::clone(&ready.node),
                                    OpGuard {
                                        active_ops: Arc::clone(&ready.active_ops),
                                        last_used_ms: Arc::clone(&ready.last_used_ms),
                                        epoch: self.epoch,
                                    },
                                    false,
                                )))
                            }
                        }
                    }
                    Some(SlotEntry::Ready(_)) => {
                        state.map.remove(account_id);
                        Lookup::Join
                    }
                    Some(SlotEntry::Joining { done, .. }) => Lookup::Wait(done.clone()),
                    None => Lookup::Join,
                };

                match lookup {
                    Lookup::Found(result) => return result,
                    Lookup::Wait(rx) => (Some(rx), None),
                    Lookup::Join => {
                        let mut evicted: Option<Arc<dyn GatewayNode>> = None;
                        if state.map.len() >= self.limits.max_accounts {
                            let victim = state
                                .map
                                .iter()
                                .filter_map(|(id, entry)| match entry {
                                    SlotEntry::Ready(ready) if ready.is_idle(max_streams) => Some(
                                        (ready.last_used_ms.load(Ordering::Acquire), id.clone()),
                                    ),
                                    _ => None,
                                })
                                .min_by_key(|(last_used, _)| *last_used)
                                .map(|(_, id)| id);
                            if let Some(victim_id) = victim {
                                if let Some(SlotEntry::Ready(ready)) = state.map.remove(&victim_id)
                                {
                                    evicted = Some(ready.node);
                                }
                            } else {
                                return Err(GatewayError::Busy(
                                    "gateway_busy: too many account networks are open; retry later"
                                        .into(),
                                ));
                            }
                        }
                        let join_id = state.next_join_id;
                        state.next_join_id = state.next_join_id.wrapping_add(1);
                        let (done_tx, done_rx) = watch::channel(false);
                        state.map.insert(
                            account_id.to_string(),
                            SlotEntry::Joining {
                                id: join_id,
                                done: done_rx,
                            },
                        );
                        (None, Some((join_id, done_tx, evicted)))
                    }
                }
            };

            if let Some(mut rx) = waiter {
                while !*rx.borrow_and_update() {
                    if rx.changed().await.is_err() {
                        break;
                    }
                }
                continue;
            }

            let (join_id, done_tx, evicted) = join_ctx.expect("join context");
            let mut guard = JoinGuard {
                accounts: Arc::clone(&self.accounts),
                account_id: account_id.to_string(),
                join_id,
                done_tx: Some(done_tx),
                armed: true,
            };

            if let Some(old_node) = evicted {
                old_node.stop().await;
                log::info!("Gateway evicted an idle account network for capacity");
            }

            let credentials = self
                .networks
                .member(account_id, &self.member_id)
                .map_err(GatewayError::Unavailable)?;
            let expires_at = credentials.join_token_expires_at;
            let node = self
                .starter
                .start(self.member_id.clone(), credentials)
                .await
                .map_err(GatewayError::Unavailable)?;

            let permits = Arc::new(Semaphore::new(max_streams));
            let active_ops = Arc::new(AtomicUsize::new(0));
            let last_used_ms = Arc::new(AtomicU64::new(self.elapsed_ms()));

            let acquired = match mode {
                AcquireMode::Stream => {
                    let permit = permits.clone().try_acquire_owned().map_err(|_| {
                        GatewayError::Busy(
                            "gateway_busy: too many open streams for this account".into(),
                        )
                    })?;
                    Acquired::Stream(
                        Arc::clone(&node),
                        StreamReservation {
                            permit: Some(permit),
                            last_used_ms: Arc::clone(&last_used_ms),
                            epoch: self.epoch,
                        },
                    )
                }
                AcquireMode::Op => {
                    active_ops.fetch_add(1, Ordering::AcqRel);
                    Acquired::Op(
                        Arc::clone(&node),
                        OpGuard {
                            active_ops: Arc::clone(&active_ops),
                            last_used_ms: Arc::clone(&last_used_ms),
                            epoch: self.epoch,
                        },
                        true,
                    )
                }
            };

            let shutdown_stop = {
                let mut state = self.lock_accounts();
                if state.shutting_down {
                    if matches!(
                        state.map.get(account_id),
                        Some(SlotEntry::Joining { id, .. }) if *id == join_id
                    ) {
                        state.map.remove(account_id);
                    }
                    true
                } else {
                    state.map.insert(
                        account_id.to_string(),
                        SlotEntry::Ready(ReadyAccount {
                            node: Arc::clone(&node),
                            permits,
                            active_ops,
                            last_used_ms,
                            token_expires_at: expires_at,
                        }),
                    );
                    false
                }
            };

            guard.disarm();
            if shutdown_stop {
                node.stop().await;
                return Err(GatewayError::Unavailable(
                    "gateway is shutting down".to_string(),
                ));
            }
            return Ok(acquired);
        }
    }

    /// The members of `account_id`'s network that are online now, as the
    /// gateway sees them: per device id (`hostname`), the route (direct or
    /// relayed), latency, role (`controller` for phones and browsers) and
    /// advertised name. A device that is not listed is not on the device
    /// network. Cheap enough to poll: an already joined network answers from
    /// a status at most a second old (rebuilt in-process, no network round
    /// trip); a network joined by this call waits up to three seconds for
    /// its routes. Polling keeps the network joined, like a stream does.
    pub async fn peers(&self, account_id: &str) -> Result<Vec<MeshPeer>, GatewayError> {
        let Acquired::Op(node, _guard, fresh) = self.acquire(account_id, AcquireMode::Op).await?
        else {
            unreachable!();
        };
        if fresh {
            let deadline = Instant::now() + PEERS_SETTLE;
            loop {
                let status = node.refresh_status().await;
                if !status.peers.is_empty() || Instant::now() >= deadline {
                    return Ok(status.peers);
                }
                tokio::time::sleep(Duration::from_millis(200)).await;
            }
        }
        let status = node.status();
        if crate::now_ms().saturating_sub(status.updated_at_ms) <= PEERS_MAX_AGE_MS {
            return Ok(status.peers);
        }
        Ok(node.refresh_status().await.peers)
    }

    /// Opens a stream to `port` (the device's OBP port; `None`: the first)
    /// on `device_id` of `account_id`'s network. The caller authenticated
    /// the session for that account.
    pub async fn open(
        &self,
        account_id: &str,
        device_id: &str,
        port: Option<u16>,
    ) -> Result<GatewayStream, GatewayError> {
        let Acquired::Stream(node, reservation) =
            self.acquire(account_id, AcquireMode::Stream).await?
        else {
            unreachable!();
        };
        let deadline = Instant::now() + self.limits.open_timeout;
        // A network joined just now learns its routes within seconds.
        while node.resolve(device_id).await.is_none() {
            if node.has_stopped() {
                return Err(GatewayError::Unreachable(format!(
                    "mesh_unreachable: gateway node for device {device_id} stopped"
                )));
            }
            if Instant::now() >= deadline {
                return Err(GatewayError::Unreachable(format!(
                    "mesh_unreachable: device {device_id} is not in the account network"
                )));
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        let stream = node
            .connect(
                device_id,
                port.unwrap_or(MESH_OBP_PORT_FIRST),
                remaining.max(Duration::from_secs(1)),
            )
            .await
            .map_err(GatewayError::Unreachable)?;
        Ok(reservation.into_stream(stream))
    }

    /// Leaves every account network.
    pub async fn shutdown(&self) {
        if let Some(reaper) = self
            .reaper
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take()
        {
            reaper.abort();
        }
        let nodes: Vec<Arc<dyn GatewayNode>> = {
            let mut state = self.lock_accounts();
            state.shutting_down = true;
            state
                .map
                .drain()
                .filter_map(|(_, entry)| match entry {
                    SlotEntry::Ready(ready) => Some(ready.node),
                    SlotEntry::Joining { .. } => None,
                })
                .collect()
        };
        for node in nodes {
            node.stop().await;
        }
    }
}

/// A stream the gateway opened; releases its per-account slot on drop.
pub struct GatewayStream {
    inner: StreamInner,
    _permit: OwnedSemaphorePermit,
    last_used_ms: Arc<AtomicU64>,
    epoch: Instant,
}

impl GatewayStream {
    pub fn peer_device(&self) -> Option<&str> {
        match &self.inner {
            StreamInner::Link(stream) => stream.peer_device(),
            #[cfg(test)]
            StreamInner::Duplex { peer_device, .. } => peer_device.as_deref(),
        }
    }
}

impl Drop for GatewayStream {
    fn drop(&mut self) {
        self.last_used_ms
            .store(self.epoch.elapsed().as_millis() as u64, Ordering::Release);
    }
}

impl AsyncRead for GatewayStream {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        match &mut self.get_mut().inner {
            StreamInner::Link(stream) => Pin::new(stream).poll_read(cx, buf),
            #[cfg(test)]
            StreamInner::Duplex { io, .. } => Pin::new(io).poll_read(cx, buf),
        }
    }
}

impl AsyncWrite for GatewayStream {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<std::io::Result<usize>> {
        match &mut self.get_mut().inner {
            StreamInner::Link(stream) => Pin::new(stream).poll_write(cx, buf),
            #[cfg(test)]
            StreamInner::Duplex { io, .. } => Pin::new(io).poll_write(cx, buf),
        }
    }

    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        match &mut self.get_mut().inner {
            StreamInner::Link(stream) => Pin::new(stream).poll_flush(cx),
            #[cfg(test)]
            StreamInner::Duplex { io, .. } => Pin::new(io).poll_flush(cx),
        }
    }

    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        match &mut self.get_mut().inner {
            StreamInner::Link(stream) => Pin::new(stream).poll_shutdown(cx),
            #[cfg(test)]
            StreamInner::Duplex { io, .. } => Pin::new(io).poll_shutdown(cx),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicBool;
    use tokio::sync::Notify;

    struct FakeNetworks;

    impl GatewayNetworks for FakeNetworks {
        fn member(&self, account_id: &str, _member_id: &str) -> Result<MeshCredentials, String> {
            Ok(MeshCredentials {
                version: 1,
                network_name: format!("obf-{account_id}"),
                network_secret: "secret".to_string(),
                peers: vec!["ws://127.0.0.1:11011/".to_string()],
                easytier_version: None,
                issued_at: Some(now_secs()),
                join_token: Some("tok".to_string()),
                join_token_expires_at: Some(now_secs() + 3600),
            })
        }
    }

    struct FakeNode {
        stopped: AtomicBool,
        stop_count: AtomicUsize,
        connect_gate: Option<Arc<Notify>>,
        connect_entered: Option<Arc<AtomicUsize>>,
        connect_entered_notify: Option<Arc<Notify>>,
    }

    impl FakeNode {
        fn new() -> Arc<Self> {
            Arc::new(Self {
                stopped: AtomicBool::new(false),
                stop_count: AtomicUsize::new(0),
                connect_gate: None,
                connect_entered: None,
                connect_entered_notify: None,
            })
        }

        fn gated(
            gate: Arc<Notify>,
            entered: Arc<AtomicUsize>,
            entered_notify: Arc<Notify>,
        ) -> Arc<Self> {
            Arc::new(Self {
                stopped: AtomicBool::new(false),
                stop_count: AtomicUsize::new(0),
                connect_gate: Some(gate),
                connect_entered: Some(entered),
                connect_entered_notify: Some(entered_notify),
            })
        }
    }

    impl GatewayNode for FakeNode {
        fn has_stopped(&self) -> bool {
            self.stopped.load(Ordering::Acquire)
        }

        fn set_join_token(&self, _token: Option<&str>) {}

        fn status(&self) -> MeshStatus {
            let mut status = MeshStatus::new(crate::status::MeshState::Running, None);
            status.updated_at_ms = crate::now_ms();
            status
        }

        fn refresh_status(&self) -> BoxFut<'_, MeshStatus> {
            Box::pin(async { self.status() })
        }

        fn resolve<'a>(&'a self, _device_id: &'a str) -> BoxFut<'a, Option<Ipv4Addr>> {
            Box::pin(async { Some(Ipv4Addr::new(10, 144, 0, 2)) })
        }

        fn connect<'a>(
            &'a self,
            device_id: &'a str,
            _port: u16,
            _timeout: Duration,
        ) -> BoxFut<'a, Result<StreamInner, String>> {
            let device = device_id.to_string();
            Box::pin(async move {
                if let Some(entered) = &self.connect_entered {
                    entered.fetch_add(1, Ordering::AcqRel);
                }
                if let Some(notify) = &self.connect_entered_notify {
                    notify.notify_waiters();
                }
                if let Some(gate) = &self.connect_gate {
                    gate.notified().await;
                }
                if self.stopped.load(Ordering::Acquire) {
                    return Err("node was stopped during connect".to_string());
                }
                let (io, _peer) = tokio::io::duplex(64);
                Ok(StreamInner::Duplex {
                    io,
                    peer_device: Some(device),
                })
            })
        }

        fn stop(&self) -> BoxFut<'_, ()> {
            Box::pin(async {
                self.stopped.store(true, Ordering::Release);
                self.stop_count.fetch_add(1, Ordering::AcqRel);
            })
        }
    }

    struct ScriptedStarter {
        /// Optional gate per network_name (e.g. "obf-acc-a").
        start_gates: Mutex<HashMap<String, (Arc<Notify>, Arc<Notify>)>>,
        nodes: Mutex<HashMap<String, Arc<FakeNode>>>,
        start_calls: AtomicUsize,
        connect_gate: Option<(Arc<Notify>, Arc<AtomicUsize>, Arc<Notify>)>,
    }

    impl ScriptedStarter {
        fn new() -> Arc<Self> {
            Arc::new(Self {
                start_gates: Mutex::new(HashMap::new()),
                nodes: Mutex::new(HashMap::new()),
                start_calls: AtomicUsize::new(0),
                connect_gate: None,
            })
        }

        fn with_connect_gate(
            gate: Arc<Notify>,
            entered: Arc<AtomicUsize>,
            entered_notify: Arc<Notify>,
        ) -> Arc<Self> {
            Arc::new(Self {
                start_gates: Mutex::new(HashMap::new()),
                nodes: Mutex::new(HashMap::new()),
                start_calls: AtomicUsize::new(0),
                connect_gate: Some((gate, entered, entered_notify)),
            })
        }

        fn block_network(&self, network: &str) -> (Arc<Notify>, Arc<Notify>) {
            let entered = Arc::new(Notify::new());
            let release = Arc::new(Notify::new());
            self.start_gates.lock().unwrap().insert(
                network.to_string(),
                (Arc::clone(&entered), Arc::clone(&release)),
            );
            (entered, release)
        }

        fn node_of(&self, network: &str) -> Option<Arc<FakeNode>> {
            self.nodes.lock().unwrap().get(network).cloned()
        }
    }

    impl NodeStarter for ScriptedStarter {
        fn start(
            &self,
            _member_id: String,
            credentials: MeshCredentials,
        ) -> BoxFut<'_, Result<Arc<dyn GatewayNode>, String>> {
            Box::pin(async move {
                self.start_calls.fetch_add(1, Ordering::AcqRel);
                let gate = self
                    .start_gates
                    .lock()
                    .unwrap()
                    .get(&credentials.network_name)
                    .cloned();
                if let Some((entered, release)) = gate {
                    entered.notify_waiters();
                    release.notified().await;
                }
                let node = match &self.connect_gate {
                    Some((gate, entered, notify)) => {
                        FakeNode::gated(Arc::clone(gate), Arc::clone(entered), Arc::clone(notify))
                    }
                    None => FakeNode::new(),
                };
                self.nodes
                    .lock()
                    .unwrap()
                    .insert(credentials.network_name, Arc::clone(&node));
                Ok(node as Arc<dyn GatewayNode>)
            })
        }
    }

    #[tokio::test]
    async fn slow_account_join_does_not_block_other_accounts_and_dedupes_same_account() {
        let starter = ScriptedStarter::new();
        let (acc_a_entered, acc_a_release) = starter.block_network("obf-acc-a");
        let gateway = LinkGateway::new_with_starter(
            Arc::new(FakeNetworks),
            Arc::clone(&starter) as Arc<dyn NodeStarter>,
            "gw-test",
            GatewayLimits::default(),
            false,
        )
        .unwrap();

        let gw_a1 = Arc::clone(&gateway);
        let task_a1 = tokio::spawn(async move { gw_a1.open("acc-a", "dev-1", None).await });
        acc_a_entered.notified().await;

        // A second concurrent open for acc-a waits on the single-flight join.
        let gw_a2 = Arc::clone(&gateway);
        let task_a2 = tokio::spawn(async move { gw_a2.open("acc-a", "dev-2", None).await });
        tokio::task::yield_now().await;

        // Meanwhile acc-b must join and open immediately without blocking on acc-a!
        let stream_b =
            tokio::time::timeout(Duration::from_secs(1), gateway.open("acc-b", "dev-b", None))
                .await
                .expect("acc-b must not block on acc-a join")
                .expect("acc-b open");
        assert_eq!(stream_b.peer_device(), Some("dev-b"));

        // Release acc-a; both acc-a callers succeed with only 1 join for acc-a (+ 1 for acc-b = 2).
        acc_a_release.notify_waiters();
        let s1 = task_a1.await.unwrap().expect("acc-a stream 1");
        let s2 = task_a2.await.unwrap().expect("acc-a stream 2");
        assert_eq!(s1.peer_device(), Some("dev-1"));
        assert_eq!(s2.peer_device(), Some("dev-2"));
        assert_eq!(starter.start_calls.load(Ordering::Acquire), 2);
    }

    #[tokio::test]
    async fn open_reserves_stream_slot_before_connect_preventing_toctou_bypass() {
        let connect_gate = Arc::new(Notify::new());
        let entered = Arc::new(AtomicUsize::new(0));
        let entered_notify = Arc::new(Notify::new());
        let starter = ScriptedStarter::with_connect_gate(
            Arc::clone(&connect_gate),
            Arc::clone(&entered),
            Arc::clone(&entered_notify),
        );
        let gateway = LinkGateway::new_with_starter(
            Arc::new(FakeNetworks),
            Arc::clone(&starter) as Arc<dyn NodeStarter>,
            "gw-test",
            GatewayLimits {
                max_accounts: 8,
                max_streams_per_account: 2,
                idle_timeout: Duration::from_secs(60),
                open_timeout: Duration::from_secs(5),
            },
            false,
        )
        .unwrap();

        // Spawn 5 concurrent open() calls while connect() is parked.
        let mut tasks = Vec::new();
        for index in 0..5 {
            let gw = Arc::clone(&gateway);
            tasks.push(tokio::spawn(async move {
                gw.open("acc-1", &format!("dev-{index}"), None).await
            }));
        }

        // Wait until the 2 admitted opens enter connect().
        tokio::time::timeout(Duration::from_secs(2), async {
            while entered.load(Ordering::Acquire) < 2 {
                entered_notify.notified().await;
            }
        })
        .await
        .expect("2 opens enter connect");

        // Give any others a moment; strictly 2 must have entered connect().
        tokio::time::sleep(Duration::from_millis(30)).await;
        assert_eq!(entered.load(Ordering::Acquire), 2);

        // Release connect(); 2 succeed and 3 fail with Busy.
        connect_gate.notify_waiters();
        let mut ok_streams = Vec::new();
        let mut busy = 0;
        for task in tasks {
            match task.await.unwrap() {
                Ok(stream) => ok_streams.push(stream),
                Err(GatewayError::Busy(_)) => busy += 1,
                Err(other) => panic!("unexpected error: {other}"),
            }
        }
        assert_eq!(ok_streams.len(), 2);
        assert_eq!(busy, 3);

        // Dropping one stream frees a slot immediately.
        ok_streams.pop();
        let gw = Arc::clone(&gateway);
        let next = tokio::spawn(async move { gw.open("acc-1", "dev-next", None).await });
        tokio::time::timeout(Duration::from_secs(1), async {
            while entered.load(Ordering::Acquire) < 3 {
                entered_notify.notified().await;
            }
        })
        .await
        .expect("3rd open enters connect");
        connect_gate.notify_waiters();
        assert!(next.await.unwrap().is_ok());
    }

    #[tokio::test]
    async fn maintain_never_evicts_account_with_inflight_connect_or_active_stream() {
        let connect_gate = Arc::new(Notify::new());
        let entered = Arc::new(AtomicUsize::new(0));
        let entered_notify = Arc::new(Notify::new());
        let starter = ScriptedStarter::with_connect_gate(
            Arc::clone(&connect_gate),
            Arc::clone(&entered),
            Arc::clone(&entered_notify),
        );
        let gateway = LinkGateway::new_with_starter(
            Arc::new(FakeNetworks),
            Arc::clone(&starter) as Arc<dyn NodeStarter>,
            "gw-test",
            GatewayLimits {
                max_accounts: 8,
                max_streams_per_account: 2,
                idle_timeout: Duration::from_millis(20),
                open_timeout: Duration::from_secs(5),
            },
            false,
        )
        .unwrap();

        // Start an open() and park inside connect() past idle_timeout.
        let gw = Arc::clone(&gateway);
        let pending = tokio::spawn(async move { gw.open("acc-1", "dev-1", None).await });
        tokio::time::timeout(Duration::from_secs(1), async {
            while entered.load(Ordering::Acquire) < 1 {
                entered_notify.notified().await;
            }
        })
        .await
        .expect("entered connect");

        tokio::time::sleep(Duration::from_millis(50)).await;
        gateway.maintain().await;

        let node = starter.node_of("obf-acc-1").expect("node created");
        assert!(
            !node.has_stopped(),
            "maintain() must not stop an account with an in-flight connect()"
        );
        assert_eq!(gateway.joined_accounts().await, 1);

        // Complete connect(); node stays alive while stream is open.
        connect_gate.notify_waiters();
        let stream = pending.await.unwrap().expect("connect succeeded");
        tokio::time::sleep(Duration::from_millis(50)).await;
        gateway.maintain().await;
        assert!(
            !node.has_stopped(),
            "maintain() must not stop an account with an open stream"
        );

        // Drop the stream; right after drop, last_used was refreshed so it isn't
        // evicted immediately, then after idle_timeout it IS evicted cleanly.
        drop(stream);
        tokio::time::sleep(Duration::from_millis(50)).await;
        gateway.maintain().await;
        assert!(node.has_stopped());
        assert_eq!(gateway.joined_accounts().await, 0);
    }

    #[tokio::test]
    async fn capacity_evicts_idle_zero_stream_account_before_returning_busy() {
        let starter = ScriptedStarter::new();
        let gateway = LinkGateway::new_with_starter(
            Arc::new(FakeNetworks),
            Arc::clone(&starter) as Arc<dyn NodeStarter>,
            "gw-test",
            GatewayLimits {
                max_accounts: 1,
                max_streams_per_account: 4,
                idle_timeout: Duration::from_secs(600),
                open_timeout: Duration::from_secs(5),
            },
            false,
        )
        .unwrap();

        // acc-1 opens and holds a stream -> acc-2 must get Busy.
        let stream1 = gateway.open("acc-1", "dev-1", None).await.unwrap();
        assert!(matches!(
            gateway.open("acc-2", "dev-2", None).await,
            Err(GatewayError::Busy(_))
        ));

        // Once acc-1's stream drops, acc-1 has 0 streams -> acc-2 evicts acc-1 and succeeds.
        drop(stream1);
        let node1 = starter.node_of("obf-acc-1").unwrap();
        let _stream2 = gateway
            .open("acc-2", "dev-2", None)
            .await
            .expect("acc-2 evicts idle acc-1");
        assert!(node1.has_stopped());
        assert_eq!(gateway.joined_accounts().await, 1);
    }

    #[cfg(unix)]
    #[test]
    fn read_hex_key_file_enforces_owner_only_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let key_path = dir.path().join("issuer.key");
        std::fs::write(&key_path, "ab".repeat(32)).unwrap();

        std::fs::set_permissions(&key_path, std::fs::Permissions::from_mode(0o644)).unwrap();
        let err = read_hex_key_file(&key_path).unwrap_err();
        assert!(err.contains("chmod 600"), "{err}");

        std::fs::set_permissions(&key_path, std::fs::Permissions::from_mode(0o600)).unwrap();
        let key = read_hex_key_file(&key_path).unwrap();
        assert_eq!(key, [0xab; 32]);
    }
}

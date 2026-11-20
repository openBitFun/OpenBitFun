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
use std::pin::Pin;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll};
use std::time::{Duration, Instant};

use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};

use crate::config::DeviceNodeConfig;
use crate::credentials::MeshCredentials;
use crate::node::{LinkNode, NodeOptions};
use crate::status::{MeshPeer, NodeRole};
use crate::stream::LinkStream;
use crate::{MESH_OBP_PORT_FIRST, MESH_OBP_PORT_LAST};

/// Refresh the gateway member's join token when less than this remains.
const TOKEN_REFRESH_MARGIN_SECS: i64 = 10 * 60;
/// [`LinkGateway::peers`] rebuilds the status at most this often.
const PEERS_MAX_AGE_MS: u64 = 1_000;
/// How long [`LinkGateway::peers`] waits for routes after joining a network.
const PEERS_SETTLE: Duration = Duration::from_secs(3);

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

struct AccountNode {
    node: Arc<LinkNode>,
    streams: Arc<AtomicUsize>,
    last_used: Instant,
    token_expires_at: Option<i64>,
}

/// The gateway of one server process.
pub struct LinkGateway {
    networks: Arc<dyn GatewayNetworks>,
    limits: GatewayLimits,
    member_id: String,
    accounts: tokio::sync::Mutex<HashMap<String, AccountNode>>,
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
        if !crate::config::valid_hostname(member_id) {
            return Err(format!("invalid gateway member id: {member_id}"));
        }
        let gateway = Arc::new(Self {
            networks,
            limits,
            member_id: member_id.to_string(),
            accounts: tokio::sync::Mutex::new(HashMap::new()),
            reaper: Mutex::new(None),
        });
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
        Ok(gateway)
    }

    /// Account networks joined now.
    pub async fn joined_accounts(&self) -> usize {
        self.accounts.lock().await.len()
    }

    /// Leaves idle networks and refreshes join tokens.
    async fn maintain(&self) {
        let mut idle = Vec::new();
        {
            let mut accounts = self.accounts.lock().await;
            let now = Instant::now();
            for (account, entry) in accounts.iter_mut() {
                if entry.streams.load(Ordering::Acquire) == 0
                    && now.duration_since(entry.last_used) > self.limits.idle_timeout
                {
                    idle.push(account.clone());
                    continue;
                }
                let refresh = entry
                    .token_expires_at
                    .is_some_and(|expires| expires - TOKEN_REFRESH_MARGIN_SECS <= now_secs());
                if refresh {
                    match self.networks.member(account, &self.member_id) {
                        Ok(credentials) => {
                            entry.node.set_join_token(credentials.join_token.as_deref());
                            entry.token_expires_at = credentials.join_token_expires_at;
                        }
                        Err(error) => log::warn!("Gateway token refresh failed: {}", error),
                    }
                }
            }
        }
        for account in idle {
            let entry = self.accounts.lock().await.remove(&account);
            if let Some(entry) = entry {
                entry.node.stop().await;
                log::info!("Gateway left an idle account network");
            }
        }
    }

    async fn node_for(
        &self,
        account_id: &str,
    ) -> Result<(Arc<LinkNode>, Arc<AtomicUsize>), GatewayError> {
        self.joined_node(account_id)
            .await
            .map(|(node, streams, _)| (node, streams))
    }

    /// The account network's node (joined now when needed; the flag says
    /// so).
    async fn joined_node(
        &self,
        account_id: &str,
    ) -> Result<(Arc<LinkNode>, Arc<AtomicUsize>, bool), GatewayError> {
        let mut accounts = self.accounts.lock().await;
        if let Some(entry) = accounts.get_mut(account_id) {
            if !entry.node.has_stopped() {
                entry.last_used = Instant::now();
                return Ok((Arc::clone(&entry.node), Arc::clone(&entry.streams), false));
            }
            accounts.remove(account_id);
        }
        if accounts.len() >= self.limits.max_accounts {
            return Err(GatewayError::Busy(
                "gateway_busy: too many account networks are open; retry later".into(),
            ));
        }
        let credentials = self
            .networks
            .member(account_id, &self.member_id)
            .map_err(GatewayError::Unavailable)?;
        let config = DeviceNodeConfig {
            instance_name: format!("gateway-{}", &credentials.network_name),
            hostname: self.member_id.clone(),
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
                config_toml: config
                    .render_as(NodeRole::Controller)
                    .map_err(GatewayError::Unavailable)?,
                network_name: credentials.network_name.clone(),
                hostname: self.member_id.clone(),
                join_token: credentials.join_token.clone(),
                status_interval: Duration::from_secs(10),
            },
            NodeRole::Controller,
        )
        .await
        .map_err(GatewayError::Unavailable)?;
        let streams = Arc::new(AtomicUsize::new(0));
        accounts.insert(
            account_id.to_string(),
            AccountNode {
                node: Arc::clone(&node),
                streams: Arc::clone(&streams),
                last_used: Instant::now(),
                token_expires_at: credentials.join_token_expires_at,
            },
        );
        Ok((node, streams, true))
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
        let (node, _, fresh) = self.joined_node(account_id).await?;
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
        let (node, streams) = self.node_for(account_id).await?;
        if streams.load(Ordering::Acquire) >= self.limits.max_streams_per_account {
            return Err(GatewayError::Busy(
                "gateway_busy: too many open streams for this account".into(),
            ));
        }
        let deadline = Instant::now() + self.limits.open_timeout;
        // A network joined just now learns its routes within seconds.
        while node.resolve(device_id).await.is_none() {
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
        streams.fetch_add(1, Ordering::AcqRel);
        Ok(GatewayStream {
            inner: stream,
            streams,
        })
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
        let entries: Vec<AccountNode> =
            self.accounts.lock().await.drain().map(|(_, e)| e).collect();
        for entry in entries {
            entry.node.stop().await;
        }
    }
}

/// A stream the gateway opened; releases its per-account slot on drop.
pub struct GatewayStream {
    inner: LinkStream,
    streams: Arc<AtomicUsize>,
}

impl GatewayStream {
    pub fn peer_device(&self) -> Option<&str> {
        self.inner.peer_device()
    }
}

impl Drop for GatewayStream {
    fn drop(&mut self) {
        self.streams.fetch_sub(1, Ordering::AcqRel);
    }
}

impl AsyncRead for GatewayStream {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.get_mut().inner).poll_read(cx, buf)
    }
}

impl AsyncWrite for GatewayStream {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<std::io::Result<usize>> {
        Pin::new(&mut self.get_mut().inner).poll_write(cx, buf)
    }

    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.get_mut().inner).poll_flush(cx)
    }

    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.get_mut().inner).poll_shutdown(cx)
    }
}

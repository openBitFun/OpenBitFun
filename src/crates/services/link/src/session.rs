//! The account-driven Link lifecycle every host embeds (desktop backend,
//! CLI host): join the account's network after sign-in, keep the join token
//! fresh, restart a node that stopped, leave on sign-out or shutdown, and
//! hand the host inbound OBP streams and outbound streams to devices.
//!
//! Credentials are cached per account (0600) so a restart works while the
//! issuer is unreachable; they are never logged or shown.

use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::sync::{mpsc, watch, Notify};

use crate::config::DeviceNodeConfig;
use crate::credentials::{MeshCredentials, DEFAULT_MESH_API_URL};
use crate::issuer::{fetch_credentials_with, FetchError};
use crate::node::{LinkNode, NodeOptions};
use crate::status::{MeshState, MeshStatus, NodeRole};
use crate::stream::LinkStream;
use crate::{MESH_OBP_PORT_FIRST, MESH_OBP_PORT_LAST};

const CREDENTIALS_FILE: &str = "credentials.json";
/// Refresh the join token when less than this much validity remains.
const TOKEN_REFRESH_MARGIN_SECS: i64 = 10 * 60;
/// Inbound OBP streams waiting for the host.
const ACCEPT_QUEUE: usize = 64;
const MIN_BACKOFF: Duration = Duration::from_secs(1);
const MAX_BACKOFF: Duration = Duration::from_secs(60);

/// A boxed future (object-safe session callbacks).
pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// The signed-in account, as Link needs it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AccountIdentity {
    /// The verified account id (the relay `user_id`).
    pub user_id: String,
    /// This device's account device id (its Link hostname).
    pub device_id: String,
}

/// The host's account session.
pub trait AccountSession: Send + Sync + 'static {
    /// The signed-in account; `None` while signed out.
    fn identity(&self) -> BoxFuture<'_, Option<AccountIdentity>>;
    /// A current OpenBitFun identity access token (`None`: signed out).
    fn access_token(&self) -> BoxFuture<'_, Result<Option<String>, String>>;
}

/// How a host runs Link.
#[derive(Debug, Clone)]
pub struct LinkOptions {
    /// Private directory for the credential cache (`<data>/mesh`).
    pub data_dir: PathBuf,
    /// The issuer base URL (`OPENBITFUN_MESH_API_URL`, default production).
    pub issuer_url: String,
    pub client_version: String,
    /// Preferred direct-connection port (TCP+UDP, IPv4 and IPv6); `None`
    /// runs without listeners.
    pub preferred_listener_port: Option<u16>,
    /// Relay only (`OPENBITFUN_MESH_DISABLE_P2P=1`); diagnostics.
    pub disable_p2p: bool,
    /// `Device` for hosts that serve OBP (desktop backend, CLI host);
    /// `Controller` for ends that only open streams to devices (the phone
    /// app). A controller runs no OBP listener, admits no inbound streams,
    /// forwards no other device's data, and is listed by devices as a
    /// controller.
    pub role: NodeRole,
    /// The name advertised to the account's other members (the phone app's
    /// device name); desktops prefer the account directory's name.
    pub display_name: Option<String>,
    /// HTTPS roots for the account issuer: the platform verifier, or the
    /// bundled Mozilla roots where the platform verifier needs setup this
    /// host does not do (Android without its Java-side initialisation).
    pub tls_roots: crate::issuer::TlsRoots,
    /// How often the account is re-checked without a wake.
    pub account_poll: Duration,
    /// How often node status is rebuilt.
    pub status_interval: Duration,
}

impl LinkOptions {
    /// Defaults plus the environment knobs every host honours.
    pub fn from_environment(data_dir: PathBuf, client_version: &str) -> Self {
        Self {
            data_dir,
            issuer_url: std::env::var("OPENBITFUN_MESH_API_URL")
                .ok()
                .map(|value| value.trim().trim_end_matches('/').to_string())
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| DEFAULT_MESH_API_URL.to_string()),
            client_version: client_version.to_string(),
            preferred_listener_port: Some(11010),
            disable_p2p: std::env::var("OPENBITFUN_MESH_DISABLE_P2P")
                .is_ok_and(|value| value == "1"),
            role: NodeRole::Device,
            display_name: None,
            tls_roots: crate::issuer::TlsRoots::default(),
            account_poll: Duration::from_secs(15),
            status_interval: Duration::from_secs(10),
        }
    }
}

/// Whether `OPENBITFUN_MESH=off|0` turned Link off for this process.
pub fn disabled_by_environment() -> bool {
    std::env::var("OPENBITFUN_MESH")
        .map(|value| value.eq_ignore_ascii_case("off") || value == "0")
        .unwrap_or(false)
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CachedCredentials {
    user_id: String,
    credentials: MeshCredentials,
}

struct Running {
    account: AccountIdentity,
    node: Arc<LinkNode>,
    credentials: MeshCredentials,
    tasks: Vec<tokio::task::JoinHandle<()>>,
}

/// Link in this process.
pub struct Link {
    options: LinkOptions,
    session: Arc<dyn AccountSession>,
    status: watch::Sender<MeshStatus>,
    running: tokio::sync::Mutex<Option<Running>>,
    node: Mutex<Option<Arc<LinkNode>>>,
    wake: Notify,
    stopping: watch::Sender<bool>,
    restarts: Mutex<u32>,
    inbound_sender: mpsc::Sender<LinkStream>,
    inbound: tokio::sync::Mutex<mpsc::Receiver<LinkStream>>,
    supervisor: Mutex<Option<tokio::task::JoinHandle<()>>>,
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn now_secs() -> i64 {
    (crate::now_ms() / 1000) as i64
}

fn write_private(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700));
        }
    }
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    use std::io::Write;
    let mut file = options.open(path)?;
    file.write_all(bytes)
}

/// `preferred` when both its TCP and UDP sockets are free on all IPv4
/// interfaces, otherwise an ephemeral port free for both.
pub fn free_listener_port(preferred: u16) -> std::io::Result<u16> {
    let free = |port: u16| {
        let tcp = std::net::TcpListener::bind((std::net::Ipv4Addr::UNSPECIFIED, port)).ok()?;
        let port = tcp.local_addr().ok()?.port();
        std::net::UdpSocket::bind((std::net::Ipv4Addr::UNSPECIFIED, port)).ok()?;
        Some(port)
    };
    if let Some(port) = free(preferred) {
        return Ok(port);
    }
    for _ in 0..16 {
        if let Some(port) = free(0) {
            return Ok(port);
        }
    }
    Err(std::io::Error::other("no free Link listener port"))
}

impl Link {
    /// Starts supervising Link for the host's account session.
    pub fn start(options: LinkOptions, session: Arc<dyn AccountSession>) -> Arc<Self> {
        let (inbound_sender, inbound) = mpsc::channel(ACCEPT_QUEUE);
        let mut initial = MeshStatus::new(MeshState::SignedOut, None);
        initial.role = options.role;
        let link = Arc::new(Self {
            options,
            session,
            status: watch::channel(initial).0,
            running: tokio::sync::Mutex::new(None),
            node: Mutex::new(None),
            wake: Notify::new(),
            stopping: watch::channel(false).0,
            restarts: Mutex::new(0),
            inbound_sender,
            inbound: tokio::sync::Mutex::new(inbound),
            supervisor: Mutex::new(None),
        });
        let supervisor = tokio::spawn(Arc::clone(&link).run());
        *lock(&link.supervisor) = Some(supervisor);
        link
    }

    /// The current status.
    pub fn status(&self) -> MeshStatus {
        self.status.borrow().clone()
    }

    /// Notified whenever the status changes (including latency updates).
    pub fn subscribe(&self) -> watch::Receiver<MeshStatus> {
        self.status.subscribe()
    }

    /// Re-checks the account now (sign-in or sign-out just happened).
    pub fn wake(&self) {
        self.wake.notify_one();
    }

    /// The running node, while signed in.
    pub fn node(&self) -> Option<Arc<LinkNode>> {
        lock(&self.node).clone()
    }

    /// The account the running node belongs to.
    pub async fn account(&self) -> Option<AccountIdentity> {
        self.running
            .lock()
            .await
            .as_ref()
            .map(|running| running.account.clone())
    }

    /// Rebuilds the status now.
    pub async fn refresh(&self) -> MeshStatus {
        if let Some(node) = self.node() {
            let status = node.refresh_status().await;
            self.publish_node_status(status);
        }
        self.status()
    }

    fn publish_node_status(&self, mut status: MeshStatus) {
        status.restarts = *lock(&self.restarts);
        self.status.send_replace(status);
    }

    fn set_state(&self, state: MeshState, reason: Option<String>) {
        let device_id = self.status.borrow().device_id.clone();
        let mut status = MeshStatus::new(state, reason);
        status.device_id = device_id;
        status.role = self.options.role;
        status.restarts = *lock(&self.restarts);
        self.status.send_replace(status);
    }

    /// Why no stream can be opened now.
    fn unavailable(&self) -> String {
        let status = self.status();
        match status.state {
            MeshState::SignedOut => {
                "mesh_signed_out: sign in to reach your other devices".to_string()
            }
            state => format!(
                "mesh_unavailable: the device network is not running ({state:?}){}",
                status
                    .reason
                    .map(|reason| format!("; {reason}"))
                    .unwrap_or_default()
            ),
        }
    }

    /// Opens a virtual TCP stream to `port` on the account device
    /// `device_id`.
    pub async fn connect(
        &self,
        device_id: &str,
        port: u16,
        timeout: Duration,
    ) -> Result<LinkStream, String> {
        let node = self.node().ok_or_else(|| self.unavailable())?;
        node.connect(device_id, port, timeout).await
    }

    /// The next inbound stream on this device's OBP listener (labelled with
    /// the peer device when the route table names it). `None` after
    /// [`Link::shutdown`]. A controller has no listener: this only returns
    /// `None` at shutdown.
    pub async fn accept(&self) -> Option<LinkStream> {
        let mut inbound = self.inbound.lock().await;
        tokio::select! {
            stream = inbound.recv() => stream,
            _ = async {
                let mut stopping = self.stopping.subscribe();
                while !*stopping.borrow_and_update() {
                    if stopping.changed().await.is_err() {
                        break;
                    }
                }
            } => None,
        }
    }

    /// Leaves the network and stops supervising (host shutdown).
    pub async fn shutdown(&self) {
        self.stopping.send_replace(true);
        self.wake.notify_one();
        let supervisor = lock(&self.supervisor).take();
        if let Some(supervisor) = supervisor {
            let _ = tokio::time::timeout(Duration::from_secs(8), supervisor).await;
        }
        self.stop_running(MeshState::Stopped).await;
    }

    async fn run(self: Arc<Self>) {
        let mut stopping = self.stopping.subscribe();
        loop {
            if *stopping.borrow() {
                break;
            }
            self.reconcile().await;
            tokio::select! {
                _ = tokio::time::sleep(self.options.account_poll) => {}
                _ = self.wake.notified() => {}
                _ = stopping.changed() => {}
            }
        }
        self.stop_running(MeshState::Stopped).await;
    }

    async fn reconcile(self: &Arc<Self>) {
        let account = self.session.identity().await;
        let current = self
            .running
            .lock()
            .await
            .as_ref()
            .map(|running| running.account.clone());
        match (account, current) {
            (None, None) => self.set_state(MeshState::SignedOut, None),
            (None, Some(_)) => self.stop_running(MeshState::SignedOut).await,
            (Some(account), Some(current)) if account == current => {
                self.maintain().await;
            }
            (Some(account), current) => {
                if current.is_some() {
                    self.stop_running(MeshState::Starting).await;
                }
                self.set_state(MeshState::Starting, None);
                match self.start_account(account).await {
                    Ok(running) => {
                        log::info!("Link started for the signed-in account");
                        *lock(&self.node) = Some(Arc::clone(&running.node));
                        *self.running.lock().await = Some(running);
                        self.refresh().await;
                    }
                    Err((state, reason)) => {
                        log::warn!("Link not started: {}", reason);
                        self.set_state(state, Some(reason));
                    }
                }
            }
        }
    }

    /// Keeps a running node's token fresh and replaces a node that stopped.
    async fn maintain(self: &Arc<Self>) {
        let (account, node, credentials) = {
            let running = self.running.lock().await;
            let Some(running) = running.as_ref() else {
                return;
            };
            (
                running.account.clone(),
                Arc::clone(&running.node),
                running.credentials.clone(),
            )
        };
        if node.has_stopped() {
            log::warn!("Link node stopped unexpectedly; restarting");
            *lock(&self.restarts) += 1;
            self.stop_running(MeshState::Restarting).await;
            let backoff = MIN_BACKOFF
                .saturating_mul(1 << (*lock(&self.restarts)).min(6))
                .min(MAX_BACKOFF);
            tokio::time::sleep(backoff).await;
            return;
        }
        let needs_token = credentials
            .usable_join_token(now_secs(), TOKEN_REFRESH_MARGIN_SECS)
            .is_none();
        if !needs_token {
            return;
        }
        match self.fetch(&account).await {
            Ok(fresh) if fresh.network_name == credentials.network_name => {
                node.set_join_token(fresh.join_token.as_deref());
                if let Some(running) = self.running.lock().await.as_mut() {
                    running.credentials = fresh;
                }
                log::debug!("Link join token refreshed");
            }
            Ok(_) => {
                log::warn!("The account network changed; rejoining");
                self.stop_running(MeshState::Starting).await;
                self.wake.notify_one();
            }
            Err(error) => log::warn!("Link join token refresh failed: {}", error),
        }
    }

    async fn fetch(&self, account: &AccountIdentity) -> Result<MeshCredentials, FetchError> {
        let token = self
            .session
            .access_token()
            .await
            .map_err(FetchError::Transient)?
            .ok_or_else(|| {
                FetchError::Refused("sign in to OpenBitFun to join your devices".into())
            })?;
        let credentials = fetch_credentials_with(
            &self.options.issuer_url,
            &token,
            &account.device_id,
            &self.options.client_version,
            self.options.tls_roots,
        )
        .await?;
        let cached = CachedCredentials {
            user_id: account.user_id.clone(),
            credentials: credentials.clone(),
        };
        if let Ok(json) = serde_json::to_vec(&cached) {
            if let Err(error) = write_private(&self.options.data_dir.join(CREDENTIALS_FILE), &json)
            {
                log::warn!("Failed to cache Link credentials: {}", error);
            }
        }
        Ok(credentials)
    }

    async fn credentials(
        &self,
        account: &AccountIdentity,
    ) -> Result<MeshCredentials, (MeshState, String)> {
        match self.fetch(account).await {
            Ok(credentials) => Ok(credentials),
            Err(FetchError::Transient(error)) => {
                let cached = std::fs::read(self.options.data_dir.join(CREDENTIALS_FILE))
                    .ok()
                    .and_then(|bytes| serde_json::from_slice::<CachedCredentials>(&bytes).ok())
                    .filter(|cached| cached.user_id == account.user_id)
                    .filter(|cached| cached.credentials.validate().is_ok());
                match cached {
                    Some(cached) => {
                        log::warn!(
                            "Link issuer unavailable; using cached credentials: {}",
                            error
                        );
                        Ok(cached.credentials)
                    }
                    None => Err((MeshState::Failed, error)),
                }
            }
            Err(FetchError::Refused(error)) => Err((MeshState::Failed, error)),
            Err(FetchError::Unsupported(error)) => Err((MeshState::Unsupported, error)),
        }
    }

    async fn start_account(
        self: &Arc<Self>,
        account: AccountIdentity,
    ) -> Result<Running, (MeshState, String)> {
        let credentials = self.credentials(&account).await?;
        let listener_port = match self.options.preferred_listener_port {
            Some(port) => Some(free_listener_port(port).map_err(|error| {
                (
                    MeshState::Failed,
                    format!("no free Link listener port: {error}"),
                )
            })?),
            None => None,
        };
        let config = DeviceNodeConfig {
            instance_name: format!(
                "openbitfun-{}",
                &account.device_id[..account.device_id.len().min(12)]
            ),
            hostname: account.device_id.clone(),
            credentials: credentials.clone(),
            listener_port,
            inbound_tcp_ports: (MESH_OBP_PORT_FIRST, MESH_OBP_PORT_LAST),
            disable_p2p: self.options.disable_p2p,
        };
        let role = self.options.role;
        let node = LinkNode::start_with(
            NodeOptions {
                config_toml: config
                    .render_as(role)
                    .map_err(|error| (MeshState::Failed, error))?,
                network_name: credentials.network_name.clone(),
                hostname: account.device_id.clone(),
                join_token: credentials
                    .usable_join_token(now_secs(), 0)
                    .map(str::to_string),
                status_interval: self.options.status_interval,
            },
            crate::node::NodeProfile {
                role,
                display_name: self.options.display_name.clone(),
            },
        )
        .await
        .map_err(|error| (MeshState::Failed, error))?;

        let mut tasks = Vec::new();
        // Status forwarding.
        let mut updates = node.subscribe();
        let link = Arc::clone(self);
        tasks.push(tokio::spawn(async move {
            loop {
                let status = updates.borrow_and_update().clone();
                if status.state == MeshState::Running {
                    link.publish_node_status(status);
                }
                if updates.changed().await.is_err() {
                    break;
                }
            }
        }));
        // The OBP listener: bound once the node has an address, re-bound
        // when the address changes. Controllers serve nothing.
        if !role.is_controller() {
            let accept_node = Arc::clone(&node);
            let sender = self.inbound_sender.clone();
            tasks.push(tokio::spawn(async move {
                accept_loop(accept_node, sender).await;
            }));
        }
        Ok(Running {
            account,
            node,
            credentials,
            tasks,
        })
    }

    async fn stop_running(&self, reason: MeshState) {
        let running = self.running.lock().await.take();
        *lock(&self.node) = None;
        if let Some(running) = running {
            for task in running.tasks {
                task.abort();
            }
            running.node.stop().await;
            log::info!("Link stopped: reason={:?}", reason);
        }
        self.set_state(reason, None);
    }
}

/// Binds the OBP port range on the node's address and forwards accepted
/// streams; re-binds after the listener fails (address change).
async fn accept_loop(node: Arc<LinkNode>, sender: mpsc::Sender<LinkStream>) {
    let mut delay = Duration::from_millis(250);
    loop {
        let mut bound = None;
        for port in MESH_OBP_PORT_FIRST..=MESH_OBP_PORT_LAST {
            match node.bind(port, Duration::from_secs(30)).await {
                Ok(listener) => {
                    bound = Some((port, listener));
                    break;
                }
                Err(error) => log::debug!("Link OBP bind failed: port={}, error={}", port, error),
            }
        }
        let Some((port, mut listener)) = bound else {
            tokio::time::sleep(delay).await;
            delay = (delay * 2).min(Duration::from_secs(10));
            continue;
        };
        delay = Duration::from_millis(250);
        node.set_obp_port(Some(port));
        log::info!("Link OBP listener bound: port={}", port);
        loop {
            match listener.accept().await {
                Ok(mut stream) => {
                    if let std::net::IpAddr::V4(ip) = stream.peer_addr().ip() {
                        stream.set_peer_device(node.device_for_ip(ip).await);
                    }
                    if sender.send(stream).await.is_err() {
                        return;
                    }
                }
                Err(error) => {
                    log::info!("Link OBP listener closed: {}", error);
                    node.set_obp_port(None);
                    break;
                }
            }
        }
        if node.has_stopped() {
            return;
        }
        tokio::time::sleep(delay).await;
    }
}

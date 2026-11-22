//! The phone's controller: its identity (device id and key, account tokens
//! in the platform keystore), the email-code sign-in, the account's Link
//! network joined as a controller node, the device list with route status,
//! and OBP connections to devices that resume after a drop.
//!
//! Everything product-related happens on the devices' own backends; this is
//! the transport and identity adapter a phone needs because it has no
//! backend of its own.

use std::collections::HashMap;
use std::net::{Ipv4Addr, SocketAddr};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex, Weak};
use std::time::Duration;

use openbitfun_link::session::{AccountIdentity, AccountSession, BoxFuture, Link, LinkOptions};
use openbitfun_link::{
    LinkNode, MeshState, MeshStatus, NodeRole, MESH_OBP_PORT_FIRST, MESH_OBP_PORT_LAST,
};
use openbitfun_product_domains::fleet::{
    rank_entry_candidates, FleetCursor, FleetEntryCandidate, FleetHello, FLEET_V1_CAPABILITY,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::account::{self, AuthApi, Directory, LoginStart, TokenPair};
use crate::crypto;
use crate::keystore::SecretStore;
use crate::obp;

const RECORD_VERSION: u32 = 1;
/// Digits of the identity service's email codes.
const EMAIL_CODE_LENGTH: u32 = 8;
/// How long a verified sign-in may take to hand over its tokens.
const POLL_ATTEMPTS: u32 = 20;

/// The keystore record.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Record {
    #[serde(default = "record_version")]
    pub(crate) version: u32,
    /// This phone's account device id (its Link hostname).
    pub(crate) device_id: String,
    #[serde(default)]
    pub(crate) account: Option<AccountRecord>,
}

fn record_version() -> u32 {
    RECORD_VERSION
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AccountRecord {
    /// The verified account id (the directory's `user_id`).
    pub(crate) user_id: String,
    #[serde(default)]
    pub(crate) email: Option<String>,
    #[serde(default)]
    pub(crate) login: Option<String>,
    /// This phone's X25519 secret for this account (base64).
    pub(crate) device_secret: String,
    pub(crate) tokens: TokenPair,
    /// The directory's token for this device.
    pub(crate) directory_token: String,
}

/// Where the controller talks to.
#[derive(Debug, Clone)]
pub(crate) struct Config {
    pub(crate) data_dir: PathBuf,
    pub(crate) auth_url: String,
    pub(crate) directory_url: String,
}

fn env_url(name: &str, default: &str) -> String {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().trim_end_matches('/').to_string())
        .filter(|value| value.starts_with("https://") || value.starts_with("http://127.0.0.1"))
        .unwrap_or_else(|| default.to_string())
}

impl Config {
    /// Production endpoints; `OPENBITFUN_ACCOUNT_API_URL` and
    /// `OPENBITFUN_DIRECTORY_URL` (development hosts) point elsewhere, and
    /// Link reads `OPENBITFUN_MESH_API_URL` itself.
    pub(crate) fn from_environment(data_dir: PathBuf) -> Self {
        Self {
            data_dir,
            auth_url: env_url("OPENBITFUN_ACCOUNT_API_URL", account::DEFAULT_AUTH_API_URL),
            directory_url: env_url("OPENBITFUN_DIRECTORY_URL", account::DEFAULT_DIRECTORY_URL),
        }
    }
}

struct PendingSignIn {
    start: LoginStart,
    ticket: String,
    email: String,
    challenge_id: String,
}

/// The controller of this app process.
pub(crate) struct Controller {
    config: Config,
    store: Box<dyn SecretStore>,
    auth: AuthApi,
    directory: Directory,
    record: tokio::sync::Mutex<Record>,
    /// The stored record could not be read: kept untouched until the user
    /// signs in again (which replaces it).
    unreadable: Mutex<Option<String>>,
    pending: tokio::sync::Mutex<Option<PendingSignIn>>,
    link: Mutex<Option<Arc<Link>>>,
    connections: Mutex<HashMap<u32, Arc<DeviceLink>>>,
    next_connection: AtomicU32,
    /// Known OBP ports per device (`(virtual ip, port)`).
    ports: Mutex<HashMap<String, (Ipv4Addr, u16)>>,
    /// What each device's `/obp/mesh/info` said lately (entry ranking).
    infos: Mutex<HashMap<String, InfoFacts>>,
    /// This phone's name in the account's device lists (directory and Link).
    device_name: String,
    /// When Link last reached `Running` (its first route sync follows).
    joined_at: Arc<Mutex<Option<std::time::Instant>>>,
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Link's view of the signed-in account.
struct LinkSession(Weak<Controller>);

impl AccountSession for LinkSession {
    fn identity(&self) -> BoxFuture<'_, Option<AccountIdentity>> {
        Box::pin(async move {
            let controller = self.0.upgrade()?;
            let record = controller.record.lock().await;
            let account = record.account.as_ref()?;
            Some(AccountIdentity {
                user_id: account.user_id.clone(),
                device_id: record.device_id.clone(),
            })
        })
    }

    fn access_token(&self) -> BoxFuture<'_, Result<Option<String>, String>> {
        Box::pin(async move {
            match self.0.upgrade() {
                Some(controller) => controller.access_token().await,
                None => Ok(None),
            }
        })
    }
}

impl Controller {
    /// Loads the record and starts Link (call inside the controller runtime).
    pub(crate) fn start(config: Config, store: Box<dyn SecretStore>) -> Result<Arc<Self>, String> {
        let http = account::http_client()?;
        let (record, unreadable) = match store.load() {
            Ok(Some(bytes)) => match serde_json::from_slice::<Record>(&bytes) {
                Ok(record) if openbitfun_link::handshake::valid_device_id(&record.device_id) => {
                    (record, None)
                }
                Ok(_) | Err(_) => {
                    log::warn!("The stored controller identity is unreadable; it is kept until the next sign-in");
                    (
                        Record {
                            version: RECORD_VERSION,
                            device_id: crypto::new_device_id(),
                            account: None,
                        },
                        Some("the stored sign-in is unreadable; sign in again".to_string()),
                    )
                }
            },
            Ok(None) => {
                let record = Record {
                    version: RECORD_VERSION,
                    device_id: crypto::new_device_id(),
                    account: None,
                };
                if let Ok(bytes) = serde_json::to_vec(&record) {
                    if let Err(error) = store.save(&bytes) {
                        log::warn!("The device identity could not be kept: {}", error);
                    }
                }
                (record, None)
            }
            Err(error) => {
                log::warn!("The keystore could not be read: {}", error);
                (
                    Record {
                        version: RECORD_VERSION,
                        device_id: crypto::new_device_id(),
                        account: None,
                    },
                    Some(error),
                )
            }
        };
        let controller = Arc::new(Self {
            auth: AuthApi::new(&config.auth_url, http.clone()),
            directory: Directory::new(&config.directory_url, http),
            config,
            store,
            record: tokio::sync::Mutex::new(record),
            unreadable: Mutex::new(unreadable),
            pending: tokio::sync::Mutex::new(None),
            link: Mutex::new(None),
            connections: Mutex::new(HashMap::new()),
            next_connection: AtomicU32::new(1),
            ports: Mutex::new(HashMap::new()),
            infos: Mutex::new(HashMap::new()),
            device_name: crate::device::display_name(),
            joined_at: Arc::new(Mutex::new(None)),
        });
        if openbitfun_link::session::disabled_by_environment() {
            log::info!("Link is turned off for this process (OPENBITFUN_MESH=off)");
        } else {
            let mut options = LinkOptions::from_environment(
                controller.config.data_dir.join("mesh"),
                env!("CARGO_PKG_VERSION"),
            );
            options.role = NodeRole::Controller;
            options.display_name = Some(controller.device_name.clone());
            // Diagnostics on Android, where an app gets no environment:
            // `adb shell setprop debug.openbitfun.mesh_disable_p2p 1` is
            // `OPENBITFUN_MESH_DISABLE_P2P=1` (relay only).
            #[cfg(target_os = "android")]
            if crate::device::android_property("debug.openbitfun.mesh_disable_p2p").as_deref()
                == Some("1")
            {
                options.disable_p2p = true;
            }
            log::info!(
                "Starting Link as a controller node: name={}, tls_roots={:?}, p2p={}",
                controller.device_name,
                options.tls_roots,
                if options.disable_p2p { "off" } else { "on" }
            );
            let link = Link::start(options, Arc::new(LinkSession(Arc::downgrade(&controller))));
            track_joins(&link, Arc::clone(&controller.joined_at));
            *lock(&controller.link) = Some(link);
        }
        Ok(controller)
    }

    fn link(&self) -> Option<Arc<Link>> {
        lock(&self.link).clone()
    }

    async fn save(&self, record: &Record) -> Result<(), String> {
        let bytes = serde_json::to_vec(record).map_err(|error| error.to_string())?;
        self.store.save(&bytes)
    }

    /// The signed-in account (`ControllerAccount` of the UI's controller
    /// port), or `null`.
    pub(crate) async fn restore(&self) -> Value {
        let record = self.record.lock().await;
        match record.account.as_ref() {
            Some(account) => json!({
                "accountId": account.user_id,
                "email": account.email,
                "login": account.login,
                "deviceId": record.device_id,
            }),
            None => {
                if let Some(problem) = lock(&self.unreadable).as_deref() {
                    log::warn!("Signed out: {}", problem);
                }
                Value::Null
            }
        }
    }

    /// Where the device key is kept (diagnostics).
    pub(crate) fn key_store(&self) -> &'static str {
        self.store.kind()
    }

    /// Sends a sign-in code to `email`; resolves with the challenge
    /// (`ControllerCodeChallenge`).
    pub(crate) async fn request_code(
        &self,
        email: String,
        locale: String,
    ) -> Result<Value, String> {
        let email = email.trim().to_string();
        if email.is_empty() || !email.contains('@') {
            return Err("invalid_email: enter your email address".to_string());
        }
        let locale = if locale.trim().is_empty() {
            "en-US".to_string()
        } else {
            locale
        };
        let mut pending = self.pending.lock().await;
        let reusable = pending
            .as_ref()
            .filter(|sign_in| sign_in.start.expires_at > account::now_secs() + 60)
            .map(|sign_in| (sign_in.start.clone(), sign_in.ticket.clone()));
        let fresh_start = reusable.is_none();
        let (mut start, mut ticket) = match reusable {
            Some(found) => found,
            None => self.start_sign_in().await?,
        };
        let sent = match self.auth.send_code(&ticket, &email, &locale).await {
            Ok(sent) => sent,
            // The service forgot a reused sign-in (expired, consumed): start
            // a new one once.
            Err(error) if !fresh_start && error.starts_with("invalid_code:") => {
                (start, ticket) = self.start_sign_in().await?;
                self.auth.send_code(&ticket, &email, &locale).await?
            }
            Err(error) => return Err(error),
        };
        let challenge = json!({
            "challengeId": sent.challenge_id,
            "email": email,
            "codeLength": EMAIL_CODE_LENGTH,
            "retryAfterSeconds": sent.retry_after_seconds,
            "expiresAt": (start.expires_at > 0).then_some(start.expires_at.saturating_mul(1000)),
        });
        *pending = Some(PendingSignIn {
            start,
            ticket,
            email,
            challenge_id: sent.challenge_id,
        });
        Ok(challenge)
    }

    async fn start_sign_in(&self) -> Result<(LoginStart, String), String> {
        let start = self.auth.start().await?;
        let ticket = account::ticket_of(&start.authorization_url).ok_or_else(|| {
            "unsupported: the sign-in service does not offer email sign-in to apps yet".to_string()
        })?;
        Ok((start, ticket))
    }

    /// Checks the code, registers this phone with the account and joins
    /// the account's network.
    pub(crate) async fn verify_code(
        &self,
        challenge_id: String,
        code: String,
    ) -> Result<Value, String> {
        let code: String = code.chars().filter(|c| !c.is_whitespace()).collect();
        let mut pending_guard = self.pending.lock().await;
        let pending = pending_guard
            .as_ref()
            .filter(|pending| pending.challenge_id == challenge_id)
            .ok_or_else(|| {
                "invalid_code: this code request is no longer active; request a new code"
                    .to_string()
            })?;
        // The keystore must take the account before the code is spent.
        {
            let record = self.record.lock().await;
            self.save(&record).await?;
        }
        self.auth
            .verify_code(&pending.ticket, &pending.challenge_id, &code)
            .await?;
        let mut tokens = None;
        for attempt in 0..POLL_ATTEMPTS {
            if let Some(pair) = self.auth.poll(&pending.start).await? {
                tokens = Some(pair);
                break;
            }
            tokio::time::sleep(Duration::from_millis(250 * u64::from(attempt.min(4) + 1))).await;
        }
        let tokens = tokens
            .ok_or_else(|| "unavailable: the sign-in did not complete; try again".to_string())?;
        let email = pending.email.clone();
        *pending_guard = None;
        drop(pending_guard);

        let me = match self.auth.me(&tokens.access_token).await {
            Ok(me) => me,
            Err(error) => {
                log::warn!("The account profile could not be read: {}", error);
                account::Me::default()
            }
        };
        let secret = crypto::generate_secret();
        let device_id = self.record.lock().await.device_id.clone();
        let login = self
            .directory
            .login(
                &tokens.access_token,
                &device_id,
                &self.device_name,
                &crypto::public_key_base64(&secret),
            )
            .await?;
        let mut record = self.record.lock().await;
        let previous = record.account.take();
        record.account = Some(AccountRecord {
            user_id: login.user_id,
            email: me.email.or(Some(email)),
            login: Some(me.user.login).filter(|login| !login.is_empty()),
            device_secret: crypto::encode_secret(&secret),
            tokens,
            directory_token: login.token,
        });
        if let Err(error) = self.save(&record).await {
            record.account = previous;
            return Err(error);
        }
        *lock(&self.unreadable) = None;
        drop(record);
        self.close_all();
        lock(&self.ports).clear();
        if let Some(link) = self.link() {
            link.wake();
        }
        log::info!("Controller signed in");
        Ok(self.restore().await)
    }

    /// Signs out: leaves the network, closes every device connection and
    /// forgets the account (the device id stays).
    pub(crate) async fn sign_out(&self) -> Result<(), String> {
        self.close_all();
        *self.pending.lock().await = None;
        let mut record = self.record.lock().await;
        let Some(account) = record.account.take() else {
            return Ok(());
        };
        self.save(&record).await?;
        drop(record);
        lock(&self.ports).clear();
        if let Some(link) = self.link() {
            link.wake();
        }
        self.directory.logout(&account.directory_token).await;
        self.auth.logout(&account.tokens.access_token).await;
        log::info!("Controller signed out");
        Ok(())
    }

    /// A current identity access token (refreshed when close to expiry).
    pub(crate) async fn access_token(&self) -> Result<Option<String>, String> {
        let mut record = self.record.lock().await;
        let Some(account) = record.account.as_ref() else {
            return Ok(None);
        };
        let now = account::now_secs();
        if !account.tokens.needs_refresh(now) {
            return Ok(Some(account.tokens.access_token.clone()));
        }
        if account.tokens.refresh_expired(now) {
            return Err("signed_out: the sign-in expired; sign in again".to_string());
        }
        let fresh = self.auth.refresh(&account.tokens.refresh_token).await?;
        let token = fresh.access_token.clone();
        if let Some(account) = record.account.as_mut() {
            account.tokens = fresh;
        }
        if let Err(error) = self.save(&record).await {
            log::warn!("Refreshed tokens could not be kept: {}", error);
        }
        Ok(Some(token))
    }

    /// The signed-in account (device id, secret, directory token).
    async fn signed_in(&self) -> Result<(String, AccountRecord), String> {
        let record = self.record.lock().await;
        match record.account.as_ref() {
            Some(account) => Ok((record.device_id.clone(), account.clone())),
            None => Err("signed_out: sign in to reach your devices".to_string()),
        }
    }

    /// Runs a directory request, signing this phone in to the directory
    /// again when its token was refused.
    async fn with_directory<T, F, Fut>(&self, request: F) -> Result<T, String>
    where
        F: Fn(Directory, String) -> Fut,
        Fut: std::future::Future<Output = Result<T, String>>,
    {
        let (device_id, account) = self.signed_in().await?;
        match request(self.directory.clone(), account.directory_token.clone()).await {
            Err(error) if error.contains("HTTP 401") => {
                let access = self
                    .access_token()
                    .await?
                    .ok_or_else(|| "signed_out: sign in to reach your devices".to_string())?;
                let secret = crypto::decode_secret(&account.device_secret)?;
                let login = self
                    .directory
                    .login(
                        &access,
                        &device_id,
                        &self.device_name,
                        &crypto::public_key_base64(&secret),
                    )
                    .await?;
                if login.user_id != account.user_id {
                    return Err(
                        "signed_out: the device directory answered for another account".to_string(),
                    );
                }
                {
                    let mut record = self.record.lock().await;
                    if let Some(stored) = record.account.as_mut() {
                        stored.directory_token = login.token.clone();
                    }
                    if let Err(error) = self.save(&record).await {
                        log::warn!("The directory token could not be kept: {}", error);
                    }
                }
                request(self.directory.clone(), login.token).await
            }
            other => other,
        }
    }

    /// The network as the UI shows it (state, why not running, this phone's
    /// route to the relay).
    pub(crate) fn network(&self) -> Value {
        match self.link() {
            None => json!({"state": "disabled"}),
            Some(link) => {
                let status = link.status();
                json!({
                    "state": status.state,
                    "reason": status.reason,
                    "role": status.role,
                    "virtualIp": status.virtual_ip,
                    "natType": status.nat_type,
                    "relayNodes": status.relay_nodes,
                    "updatedAtMs": status.updated_at_ms,
                })
            }
        }
    }

    /// The account's devices from the directory, with their Link route.
    pub(crate) async fn list_devices(&self) -> Result<Value, String> {
        let (device_id, _) = self.signed_in().await?;
        let devices = self
            .with_directory(|directory, token| async move { directory.devices(&token).await })
            .await?;
        let status = match self.link() {
            Some(link) => {
                let observed = wait_until_joined(&link).await;
                let expected = expected_route_devices(&device_id, &devices);
                // The join this call waited for, else the tracked one (the
                // tracker may not have seen a join that just happened).
                let joined_at = observed.or(*lock(&self.joined_at));
                wait_for_first_routes(&link, &expected, joined_at).await
            }
            None => MeshStatus::new(MeshState::Disabled, None),
        };
        Ok(Value::Array(device_rows(&device_id, &devices, &status)))
    }

    fn close_all(&self) {
        let connections: Vec<Arc<DeviceLink>> = lock(&self.connections)
            .drain()
            .map(|(_, link)| link)
            .collect();
        for connection in connections {
            connection.close();
        }
    }

    /// Opens an OBP connection to `device_id`; returns its handle. With
    /// `options.fleet` the hello carries the fleet member (`{protocol,
    /// cursor}`), so a fleet entry resumes every origin from the cursor.
    pub(crate) async fn connect(
        self: &Arc<Self>,
        device_id: String,
        options: ConnectOptions,
    ) -> Result<u32, String> {
        if !openbitfun_link::handshake::valid_device_id(&device_id) {
            return Err("invalid device id".to_string());
        }
        let link = Arc::new(DeviceLink::new(
            device_id,
            LinkDialer::Controller(Arc::downgrade(self)),
            options.fleet,
        ));
        let started = std::time::Instant::now();
        let connection = link.current().await?;
        drop(connection);
        let route = self
            .link()
            .map(|mesh| mesh.status())
            .and_then(|status| {
                status.peer(&link.device_id).map(|peer| {
                    format!(
                        "route={:?}, tunnel={}, latency_ms={}",
                        peer.route,
                        peer.tunnel.as_deref().unwrap_or("unknown"),
                        peer.latency_ms
                            .map(|latency| format!("{latency:.0}"))
                            .unwrap_or_else(|| "unknown".to_string())
                    )
                })
            })
            .unwrap_or_else(|| "route=unknown".to_string());
        log::info!(
            "Connected to device {} in {} ms: {}",
            link.device_id,
            started.elapsed().as_millis(),
            route
        );
        let handle = self.next_connection.fetch_add(1, Ordering::Relaxed);
        lock(&self.connections).insert(handle, link);
        Ok(handle)
    }

    pub(crate) fn device_link(&self, handle: u32) -> Result<Arc<DeviceLink>, String> {
        lock(&self.connections)
            .get(&handle)
            .cloned()
            .ok_or_else(|| "the device connection was closed".to_string())
    }

    pub(crate) fn disconnect(&self, handle: u32) {
        if let Some(link) = lock(&self.connections).remove(&handle) {
            link.close();
        }
    }

    /// Dials `device_id` once: resolve its virtual address, find its OBP
    /// port, derive the pair key, handshake.
    async fn dial(&self, device_id: &str, resume: obp::Resume) -> Result<obp::Connection, String> {
        let (local_device_id, account) = self.signed_in().await?;
        let link = self
            .link()
            .ok_or_else(|| "mesh_unavailable: the device network is turned off".to_string())?;
        let node = link.node().ok_or_else(|| {
            let status = link.status();
            format!(
                "mesh_unavailable: the device network is not running ({:?}){}",
                status.state,
                status
                    .reason
                    .map(|reason| format!("; {reason}"))
                    .unwrap_or_default()
            )
        })?;
        let (ip, role) = node.resolve_member(device_id).await.ok_or_else(|| {
            format!("mesh_unreachable: device {device_id} is not on the device network now")
        })?;
        if role.is_controller() {
            return Err(format!(
                "mesh_controller: {device_id} is a phone or browser and serves no backend"
            ));
        }
        let port = self.locate(&node, ip, device_id).await?;
        let public = self
            .with_directory(|directory, token| {
                let device_id = device_id.to_string();
                async move { directory.device_key(&token, &device_id).await }
            })
            .await
            .map_err(|error| format!("the device's key could not be read: {error}"))?;
        let secret = crypto::decode_secret(&account.device_secret)?;
        let pair_key = crypto::derive_pair_key(&secret, &crypto::parse_public_key(&public)?)?;
        let stream = match open_stream(&node, ip, port).await {
            Ok(stream) => stream,
            Err(error) => {
                lock(&self.ports).remove(device_id);
                return Err(error);
            }
        };
        let dial = obp::Dial {
            local_device_id: &local_device_id,
            target_device_id: device_id,
            pair_key,
            authority: format!("{ip}:{port}"),
        };
        match tokio::time::timeout(obp::CONNECT_TIMEOUT, obp::connect(stream, dial, resume)).await {
            Ok(Ok(connection)) => Ok(connection),
            Ok(Err(error)) => {
                lock(&self.ports).remove(device_id);
                Err(error)
            }
            Err(_) => Err(format!(
                "mesh_unreachable: connecting to device {device_id} timed out"
            )),
        }
    }
}

impl Controller {
    /// The OBP port of `device_id` at `ip`: the one it answered on before,
    /// else the first port of the range whose `/obp/mesh/info` names it
    /// (its facts are kept for the entry ranking).
    async fn locate(
        &self,
        node: &Arc<LinkNode>,
        ip: Ipv4Addr,
        device_id: &str,
    ) -> Result<u16, String> {
        let known = lock(&self.ports)
            .get(device_id)
            .filter(|(known_ip, _)| *known_ip == ip)
            .map(|(_, port)| *port);
        if let Some(port) = known {
            return Ok(port);
        }
        let mut last_error = format!("mesh_unreachable: device {device_id} has no OBP listener");
        for port in MESH_OBP_PORT_FIRST..=MESH_OBP_PORT_LAST {
            match probe_port(node, ip, port).await {
                Ok(info) if info.device_id == device_id => {
                    lock(&self.ports).insert(device_id.to_string(), (ip, port));
                    lock(&self.infos).insert(device_id.to_string(), InfoFacts::of(&info));
                    return Ok(port);
                }
                Ok(info) => {
                    last_error = format!("port {port} at {ip} belongs to device {}", info.device_id)
                }
                Err(error) => last_error = error,
            }
        }
        Err(last_error)
    }

    /// `device_id`'s `/obp/mesh/info` facts, reused for [`INFO_TTL`];
    /// `None` when it cannot be probed now (it is then ranked without them).
    async fn info_facts(&self, node: &Arc<LinkNode>, device_id: &str) -> Option<InfoFacts> {
        if let Some(facts) = lock(&self.infos)
            .get(device_id)
            .filter(|facts| facts.at.elapsed() < INFO_TTL)
        {
            return Some(facts.clone());
        }
        let (ip, role) = node.resolve_member(device_id).await?;
        if role.is_controller() {
            return None;
        }
        let known = lock(&self.ports)
            .get(device_id)
            .filter(|(known_ip, _)| *known_ip == ip)
            .map(|(_, port)| *port);
        match known {
            Some(port) => match probe_port(node, ip, port).await {
                Ok(info) if info.device_id == device_id => {
                    lock(&self.infos).insert(device_id.to_string(), InfoFacts::of(&info));
                }
                _ => {
                    lock(&self.ports).remove(device_id);
                    self.locate(node, ip, device_id).await.ok()?;
                }
            },
            None => {
                self.locate(node, ip, device_id).await.ok()?;
            }
        }
        lock(&self.infos).get(device_id).cloned()
    }

    /// The account's runtime hosts this phone may enter the fleet through,
    /// best first (`rank_entry_candidates`, the ranking the gateway applies
    /// for browsers): `{ entryCandidates: [deviceId], candidates: [...] }`.
    /// Only devices on the device network are listed; `fleet_v1`,
    /// `fleetLoad` and the backend version come from each device's
    /// `/obp/mesh/info` (probed at most every 30 s).
    pub(crate) async fn entry_candidates(&self) -> Result<Value, String> {
        let (own_device_id, _) = self.signed_in().await?;
        let devices = self
            .with_directory(|directory, token| async move { directory.devices(&token).await })
            .await?;
        let Some(link) = self.link() else {
            return Ok(entry_answer(Vec::new()));
        };
        let status = link.refresh().await;
        let routed = entry_rows(&own_device_id, &devices, &status);
        let facts: Vec<Option<InfoFacts>> = match link.node() {
            Some(node) => {
                futures::future::join_all(
                    routed
                        .iter()
                        .map(|candidate| self.info_facts(&node, &candidate.device_id)),
                )
                .await
            }
            None => vec![None; routed.len()],
        };
        let candidates = routed
            .into_iter()
            .zip(facts)
            .map(|(candidate, facts)| match facts {
                Some(facts) => facts.apply(candidate),
                None => candidate,
            })
            .collect::<Vec<_>>();
        Ok(entry_answer(rank_entry_candidates(&candidates)))
    }
}

/// How long a device's `/obp/mesh/info` facts are reused for the ranking.
const INFO_TTL: Duration = Duration::from_secs(30);

/// What a device's `/obp/mesh/info` says about it as a fleet entry.
#[derive(Debug, Clone)]
struct InfoFacts {
    at: std::time::Instant,
    fleet_protocol: Option<u32>,
    fleet_load: Option<u32>,
    version: Option<String>,
}

impl InfoFacts {
    fn of(info: &obp::MeshInfo) -> Self {
        // `fleetLoad` (attached fleet clients) is read from the wire shape so
        // a device info without it (older hosts) stays unknown.
        let fleet_load = serde_json::to_value(info)
            .ok()
            .and_then(|value| value.get("fleetLoad").and_then(Value::as_u64))
            .map(|load| load.min(u64::from(u32::MAX)) as u32);
        Self {
            at: std::time::Instant::now(),
            fleet_protocol: info
                .capabilities
                .iter()
                .any(|capability| capability == FLEET_V1_CAPABILITY)
                .then_some(1),
            fleet_load,
            version: Some(info.backend_version.trim().to_string())
                .filter(|version| !version.is_empty()),
        }
    }

    fn apply(&self, candidate: FleetEntryCandidate) -> FleetEntryCandidate {
        FleetEntryCandidate {
            fleet_protocol: self.fleet_protocol,
            fleet_load: self.fleet_load,
            version: self.version.clone().or(candidate.version.clone()),
            ..candidate
        }
    }
}

fn entry_answer(ranked: Vec<FleetEntryCandidate>) -> Value {
    json!({
        "entryCandidates": ranked.iter().map(|candidate| candidate.device_id.as_str()).collect::<Vec<_>>(),
        "candidates": ranked,
    })
}

/// The directory's runtime hosts that are on the device network now, as
/// entry candidates before their `/obp/mesh/info` facts: online, a full
/// host (a desktop; a row without a kind predates kinds and is one), the
/// Link latency and the directory's version. This phone, controllers
/// (phones, browser sessions) and the cloud agent (not a Link member) are
/// left out.
fn entry_rows(
    own_device_id: &str,
    devices: &[account::DirectoryDevice],
    status: &MeshStatus,
) -> Vec<FleetEntryCandidate> {
    devices
        .iter()
        .filter(|device| is_link_runtime_device(own_device_id, device))
        .filter_map(|device| {
            let peer = status.peer(&device.device_id)?;
            if peer.role.is_controller() {
                return None;
            }
            Some(FleetEntryCandidate {
                device_id: device.device_id.clone(),
                online: true,
                fleet_protocol: None,
                full_host: matches!(device.device_kind.as_deref(), None | Some("desktop")),
                latency_ms: peer
                    .latency_ms
                    .filter(|latency| latency.is_finite() && *latency >= 0.0)
                    .map(|latency| latency.round().min(f64::from(u32::MAX)) as u32),
                fleet_load: None,
                version: device.client_version.clone(),
            })
        })
        .collect()
}

/// The directory kind of the account's cloud agent node: reached through
/// the server, never over the device network.
const CLOUD_AGENT_KIND: &str = "cloud_agent";

/// A stream to `ip:port` over the device network.
async fn open_stream(
    node: &Arc<LinkNode>,
    ip: Ipv4Addr,
    port: u16,
) -> Result<Box<dyn obp::Io>, String> {
    node.connect_addr(SocketAddr::from((ip, port)), obp::CONNECT_TIMEOUT)
        .await
        .map(|stream| Box::new(stream) as Box<dyn obp::Io>)
}

/// `/obp/mesh/info` of `ip:port`, bounded by the probe timeout.
async fn probe_port(
    node: &Arc<LinkNode>,
    ip: Ipv4Addr,
    port: u16,
) -> Result<obp::MeshInfo, String> {
    let probe = async {
        let stream = open_stream(node, ip, port).await?;
        obp::probe_info(stream, &format!("{ip}:{port}")).await
    };
    tokio::time::timeout(obp::PROBE_TIMEOUT, probe)
        .await
        .map_err(|_| format!("mesh_unreachable: {ip}:{port} did not answer"))?
}

/// How `connect` opens a device connection (`optionsJson` of the module's
/// `connect`): `{ fleet: { protocol, cursor } }`. Read tolerantly: an
/// unreadable or absent `fleet` connects plainly.
#[derive(Debug, Clone, Default)]
pub(crate) struct ConnectOptions {
    pub(crate) fleet: Option<FleetHello>,
}

impl ConnectOptions {
    pub(crate) fn from_json(text: Option<&str>) -> Self {
        let Some(text) = text.map(str::trim).filter(|text| !text.is_empty()) else {
            return Self::default();
        };
        let Ok(value) = serde_json::from_str::<Value>(text) else {
            log::warn!("Unreadable connect options; connecting without the fleet hello");
            return Self::default();
        };
        let fleet = value
            .get("fleet")
            .filter(|fleet| fleet.is_object())
            .and_then(|fleet| serde_json::from_value::<FleetHello>(fleet.clone()).ok())
            .filter(|fleet| fleet.protocol >= 1);
        Self { fleet }
    }
}

/// How long a device list waits for Link that is still joining (right after
/// sign-in or a restart) before it answers with the network's state.
const JOIN_WAIT: Duration = Duration::from_secs(10);

/// Waits up to [`JOIN_WAIT`] while Link is joining, so the first list after
/// sign-in shows routes instead of "not on the device network yet". Returns
/// when Link joined if this call saw it happen.
async fn wait_until_joined(link: &Link) -> Option<std::time::Instant> {
    let joining = |state: MeshState| {
        matches!(
            state,
            MeshState::SignedOut | MeshState::Starting | MeshState::Restarting
        )
    };
    if !joining(link.status().state) {
        return None;
    }
    let started = std::time::Instant::now();
    let mut status = link.subscribe();
    let joined =
        tokio::time::timeout(JOIN_WAIT, status.wait_for(|status| !joining(status.state))).await;
    let state = link.status().state;
    log::info!(
        "Device list waited {} ms for Link to join: state={:?}{}",
        started.elapsed().as_millis(),
        state,
        if joined.is_err() {
            " (still joining)"
        } else {
            ""
        }
    );
    (state == MeshState::Running).then(std::time::Instant::now)
}

/// How long after joining Link a device list waits for the first route sync
/// to name the account's devices.
const ROUTE_SYNC_WINDOW: Duration = Duration::from_secs(8);

/// Keeps `joined_at` at the moment Link last reached `Running`.
fn track_joins(link: &Arc<Link>, joined_at: Arc<Mutex<Option<std::time::Instant>>>) {
    let mut status = link.subscribe();
    tokio::spawn(async move {
        let mut running = false;
        loop {
            let now_running = status.borrow_and_update().state == MeshState::Running;
            if now_running && !running {
                *lock(&joined_at) = Some(std::time::Instant::now());
            } else if !now_running {
                *lock(&joined_at) = None;
            }
            running = now_running;
            if status.changed().await.is_err() {
                return;
            }
        }
    });
}

/// The Link status for a device list. Right after joining, the route table
/// fills in over the first sync: while none of the account's devices is in
/// it yet and Link joined less than [`ROUTE_SYNC_WINDOW`] ago, look again.
async fn wait_for_first_routes(
    link: &Link,
    expected: &[&str],
    joined_at: Option<std::time::Instant>,
) -> MeshStatus {
    let mut status = link.refresh().await;
    let Some(joined_at) = joined_at else {
        return status;
    };
    let started = std::time::Instant::now();
    while status.state == MeshState::Running
        && !expected.is_empty()
        && !expected
            .iter()
            .any(|device_id| status.peer(device_id).is_some())
        && joined_at.elapsed() < ROUTE_SYNC_WINDOW
    {
        tokio::time::sleep(Duration::from_millis(300)).await;
        status = link.refresh().await;
    }
    if started.elapsed() >= Duration::from_millis(300) {
        log::info!(
            "Device list waited {} ms for Link's first route sync: {} of {} devices routed",
            started.elapsed().as_millis(),
            expected
                .iter()
                .filter(|device_id| status.peer(device_id).is_some())
                .count(),
            expected.len()
        );
    }
    status
}

/// Directory kinds that serve no backend (they are controllers).
const CONTROLLER_KINDS: [&str; 2] = ["mobile", "watch"];

fn is_controller_kind(device: &account::DirectoryDevice) -> bool {
    device
        .device_kind
        .as_deref()
        .is_some_and(|kind| CONTROLLER_KINDS.contains(&kind))
}

fn is_cloud_agent_kind(device: &account::DirectoryDevice) -> bool {
    device.device_kind.as_deref() == Some(CLOUD_AGENT_KIND)
}

/// Whether `device` is another account device that joins the Link network as a
/// runtime host (excludes this phone, controllers, and the cloud agent).
fn is_link_runtime_device(own_device_id: &str, device: &account::DirectoryDevice) -> bool {
    device.device_id != own_device_id && !is_controller_kind(device) && !is_cloud_agent_kind(device)
}

/// Directory devices that may appear in Link's route table.
fn expected_route_devices<'a>(
    own_device_id: &str,
    devices: &'a [account::DirectoryDevice],
) -> Vec<&'a str> {
    devices
        .iter()
        .filter(|device| is_link_runtime_device(own_device_id, device))
        .map(|device| device.device_id.as_str())
        .collect()
}

/// The account's devices a controller may drive (`ControllerDevice` of the
/// UI's controller port): directory rows joined with their Link route. This
/// phone, other controllers (phones, browser sessions), and the cloud agent
/// (not a Link member) are left out.
fn device_rows(
    own_device_id: &str,
    devices: &[account::DirectoryDevice],
    status: &MeshStatus,
) -> Vec<Value> {
    let names: HashMap<&str, String> = devices
        .iter()
        .map(|device| (device.device_id.as_str(), device.display_name()))
        .collect();
    devices
        .iter()
        .filter(|device| is_link_runtime_device(own_device_id, device))
        .filter_map(|device| {
            let peer = status.peer(&device.device_id);
            if peer.is_some_and(|peer| peer.role.is_controller()) {
                return None;
            }
            // Legacy directories list online devices only.
            let online = device.online.unwrap_or(true);
            let unavailable = match (peer, online, status.state) {
                (Some(_), _, _) => None,
                (None, _, state) if state != MeshState::Running => Some(json!({
                    "code": "network_down",
                    "message": match status.reason.as_deref() {
                        Some(reason) if state == MeshState::Failed || state == MeshState::Unsupported => {
                            format!("This phone could not join the device network: {reason}")
                        }
                        _ => "This phone is not on the device network yet.".to_string(),
                    },
                })),
                (None, true, _) => Some(json!({
                    "code": "update_required",
                    "message": "This device is online but not on the device network; update OpenBitFun on it.",
                })),
                (None, false, _) => Some(json!({
                    "code": "offline",
                    "message": "This device is offline.",
                })),
            };
            Some(json!({
                "deviceId": device.device_id,
                "name": device.display_name(),
                "kind": device.device_kind,
                "os": device.device_os,
                "model": device.device_model,
                "clientVersion": device.client_version,
                "online": online || peer.is_some(),
                "lastSeenAt": peer
                    .and_then(|peer| peer.last_seen_ms)
                    .or_else(|| device.last_seen_at.map(|secs| (secs.max(0) as u64).saturating_mul(1000))),
                "connectable": unavailable.is_none(),
                "unavailable": unavailable,
                "route": peer.and_then(|peer| peer.route),
                "relayVia": peer.and_then(|peer| peer.relay_via.as_deref()),
                "relayViaName": peer
                    .and_then(|peer| peer.relay_via.as_deref())
                    .and_then(|id| names.get(id)),
                "latencyMs": peer.and_then(|peer| peer.latency_ms),
            }))
        })
        .collect()
}

const EVENTS_DROPPED_EVENT: &str = "backend://events-dropped";

enum LinkDialer {
    Controller(Weak<Controller>),
    #[cfg(test)]
    Custom(
        Arc<
            dyn Fn(obp::Resume) -> BoxFuture<'static, Result<obp::Connection, String>>
                + Send
                + Sync,
        >,
    ),
}

/// One device connection: dials on demand and resumes the event stream
/// after a drop (same backend: from the last event the UI took; a restarted
/// backend sends `backend://events-dropped` and the UI re-reads).
pub(crate) struct DeviceLink {
    device_id: String,
    dialer: LinkDialer,
    /// Serializes concurrent dials so `close()` and `current` swaps never block on a dial.
    dial_lock: tokio::sync::Mutex<()>,
    /// The active OBP connection; never locked across `.await`.
    current: Mutex<Option<Arc<obp::Connection>>>,
    resume: Mutex<obp::Resume>,
    /// Set when a plain stream switches to a new backend `instance_id` so the
    /// next `next_events(after)` ignores the stale `after` from the previous
    /// instance.
    plain_instance_reset: std::sync::atomic::AtomicBool,
    /// The fleet hello and the vector cursor it resumes from, advanced as
    /// origin-tagged events are delivered; `None` for a plain connection.
    fleet: Mutex<Option<FleetHello>>,
    closed: std::sync::atomic::AtomicBool,
    close_notify: tokio::sync::Notify,
}

impl DeviceLink {
    fn new(device_id: String, dialer: LinkDialer, fleet: Option<FleetHello>) -> Self {
        Self {
            device_id,
            dialer,
            dial_lock: tokio::sync::Mutex::new(()),
            current: Mutex::new(None),
            resume: Mutex::new(obp::Resume::default()),
            plain_instance_reset: std::sync::atomic::AtomicBool::new(false),
            fleet: Mutex::new(fleet),
            closed: std::sync::atomic::AtomicBool::new(false),
            close_notify: tokio::sync::Notify::new(),
        }
    }

    async fn dial(&self, resume: obp::Resume) -> Result<obp::Connection, String> {
        match &self.dialer {
            LinkDialer::Controller(controller) => {
                let controller = controller
                    .upgrade()
                    .ok_or_else(|| "the controller stopped".to_string())?;
                controller.dial(&self.device_id, resume).await
            }
            #[cfg(test)]
            LinkDialer::Custom(dial) => dial(resume).await,
        }
    }

    /// The live connection, dialing (with resume) when there is none.
    async fn current(&self) -> Result<Arc<obp::Connection>, String> {
        if self.closed.load(Ordering::Acquire) {
            return Err("the device connection was closed".to_string());
        }
        if let Some(connection) = lock(&self.current)
            .as_ref()
            .filter(|connection| connection.closed().is_none())
            .cloned()
        {
            return Ok(connection);
        }
        let closed_signal = self.close_notify.notified();
        tokio::pin!(closed_signal);
        closed_signal.as_mut().enable();
        if self.closed.load(Ordering::Acquire) {
            return Err("the device connection was closed".to_string());
        }
        let _dialing = tokio::select! {
            biased;
            _ = &mut closed_signal => {
                return Err("the device connection was closed".to_string());
            }
            guard = self.dial_lock.lock() => guard,
        };
        if self.closed.load(Ordering::Acquire) {
            return Err("the device connection was closed".to_string());
        }
        if let Some(connection) = lock(&self.current)
            .as_ref()
            .filter(|connection| connection.closed().is_none())
            .cloned()
        {
            return Ok(connection);
        }
        let mut resume = lock(&self.resume).clone();
        resume.fleet = lock(&self.fleet)
            .as_ref()
            .and_then(|fleet| serde_json::to_value(fleet).ok());
        let dialed = tokio::select! {
            biased;
            _ = &mut closed_signal => {
                return Err("the device connection was closed".to_string());
            }
            result = self.dial(resume) => result?,
        };
        let connection = Arc::new(dialed);
        {
            let mut current = lock(&self.current);
            if self.closed.load(Ordering::Acquire) {
                drop(current);
                connection.close();
                return Err("the device connection was closed".to_string());
            }
            {
                let mut resume = lock(&self.resume);
                let new_instance = connection.instance_id();
                let instance_changed =
                    resume.instance_id.is_some() && resume.instance_id != new_instance;
                resume.instance_id = new_instance;
                if instance_changed {
                    resume.last_seq = None;
                    self.plain_instance_reset.store(true, Ordering::Release);
                } else if resume.last_seq.is_none() {
                    resume.last_seq = connection.hello()["lastSeq"].as_u64();
                }
            }
            *current = Some(Arc::clone(&connection));
        }
        Ok(connection)
    }

    /// `{version, platform, dataDir}` of the device backend (the UI's
    /// `ready()`); the hello also carries scope and capabilities, and a
    /// fleet entry's `fleet` answer (`{protocol, cursorState, deviceId}`).
    pub(crate) async fn hello(&self) -> Result<Value, String> {
        let connection = self.current().await?;
        Ok(ready_info(&self.device_id, connection.hello()))
    }

    /// Runs one command on the device backend.
    pub(crate) async fn invoke(
        &self,
        command: String,
        args_json: String,
    ) -> Result<String, String> {
        let args: Value = if args_json.trim().is_empty() {
            json!({})
        } else {
            serde_json::from_str(&args_json)
                .map_err(|error| format!("invalid command arguments: {error}"))?
        };
        let connection = self.current().await?;
        match connection.call(&command, args).await {
            Ok(value) => Ok(value.to_string()),
            Err(error) => Err(error.message),
        }
    }

    /// The next events after `after` (or after the last batch), as the
    /// JSON array the UI's wire reads; `Err` when the connection dropped
    /// (the UI calls again, which redials and resumes).
    pub(crate) async fn next_events(&self, after: Option<u64>) -> Result<String, String> {
        let mut after = after;
        if self.plain_instance_reset.swap(false, Ordering::AcqRel) {
            // A prior dial (e.g. from `invoke`) already switched to a new
            // backend instance; the caller's `after` belongs to the old one.
            after = None;
        } else if let Some(seq) = after {
            let mut resume = lock(&self.resume);
            if resume.last_seq.is_none_or(|last| seq > last) {
                resume.last_seq = Some(seq);
            }
        }
        loop {
            let connection = self.current().await?;
            if self.plain_instance_reset.swap(false, Ordering::AcqRel) {
                after = None;
            }
            let batch = match connection.next_events().await {
                Ok(batch) => batch,
                Err(reason) => {
                    let mut current = lock(&self.current);
                    if current
                        .as_ref()
                        .is_some_and(|live| Arc::ptr_eq(live, &connection))
                    {
                        *current = None;
                    }
                    return Err(format!("mesh_reconnecting: {reason}"));
                }
            };
            let mut plain_floor = after.or_else(|| lock(&self.resume).last_seq);
            let (fresh, plain_reset) = {
                let mut fleet = lock(&self.fleet);
                let cursor = fleet.as_mut().map(|fleet| &mut fleet.cursor);
                fresh_events(&batch, &mut plain_floor, cursor)
            };
            if batch.iter().any(|event| origin_of(&event.json).is_none()) {
                let mut resume = lock(&self.resume);
                if plain_reset {
                    resume.last_seq = plain_floor;
                    after = plain_floor;
                } else if let Some(seq) = plain_floor {
                    if resume.last_seq.is_none_or(|last| seq > last) {
                        resume.last_seq = Some(seq);
                    }
                }
            }
            if !fresh.is_empty() {
                return Ok(Value::Array(fresh).to_string());
            }
        }
    }

    fn close(&self) {
        self.closed.store(true, Ordering::Release);
        let existing = lock(&self.current).take();
        self.close_notify.notify_waiters();
        if let Some(connection) = existing {
            connection.close();
        }
    }
}

/// The UI's `ready()` info from a device's hello.
fn ready_info(device_id: &str, hello: &Value) -> Value {
    let mut info = json!({
        "version": hello["backend"]["version"],
        "platform": hello["backend"]["platform"],
        "dataDir": Value::Null,
        "scope": hello["scope"],
        "capabilities": hello["capabilities"],
        "deviceId": device_id,
    });
    // A fleet entry answers the fleet hello; an older entry has no `fleet`
    // and the UI stays single-device.
    if let Some(Value::Object(fleet)) = hello.get("fleet") {
        let mut fleet = fleet.clone();
        fleet
            .entry("deviceId".to_string())
            .or_insert_with(|| json!(device_id));
        info["fleet"] = Value::Object(fleet);
    }
    info
}

/// `(origin, originInstance)` of a fleet frame; `None` for a plain one.
fn origin_of(event: &Value) -> Option<(&str, &str)> {
    let origin = event["origin"]
        .as_str()
        .filter(|origin| !origin.is_empty())?;
    Some((origin, event["originInstance"].as_str().unwrap_or_default()))
}

/// The events of `batch` the UI has not seen: a fleet frame by its origin's
/// cursor (which it advances; `backend://events-dropped` restarts the origin
/// at the notice's seq), a plain one by `plain_floor` (which also restarts at
/// a plain `backend://events-dropped` notice's seq). Returns `(fresh,
/// plain_reset)` where `plain_reset` is true if a plain `events-dropped`
/// notice reset `plain_floor`.
fn fresh_events(
    batch: &[obp::Event],
    plain_floor: &mut Option<u64>,
    mut cursor: Option<&mut FleetCursor>,
) -> (Vec<Value>, bool) {
    let mut fresh = Vec::new();
    let mut plain_reset = false;
    for event in batch {
        match (origin_of(&event.json), cursor.as_deref_mut()) {
            (Some((origin, instance)), Some(cursor)) => {
                if event.json["event"] == EVENTS_DROPPED_EVENT {
                    cursor.0.insert(
                        origin.to_string(),
                        openbitfun_product_domains::fleet::FleetOriginCursor {
                            instance_id: instance.to_string(),
                            seq: event.seq,
                        },
                    );
                } else if cursor.has_seen(origin, instance, event.seq) {
                    continue;
                } else {
                    cursor.advance(origin, instance, event.seq);
                }
            }
            // A tagged frame on a connection opened without the fleet
            // hello: the UI's wire dedups it per origin.
            (Some(_), None) => {}
            (None, _) => {
                if event.json["event"] == EVENTS_DROPPED_EVENT {
                    *plain_floor = Some(event.seq);
                    plain_reset = true;
                } else if plain_floor.is_some_and(|floor| event.seq <= floor) {
                    continue;
                } else {
                    *plain_floor = Some(event.seq);
                }
            }
        }
        fresh.push(event.json.clone());
    }
    (fresh, plain_reset)
}

#[cfg(test)]
mod tests {
    use super::*;
    use openbitfun_link::{MeshPeer, MeshRoute};

    fn peer(hostname: &str, role: NodeRole, route: MeshRoute, relay_via: Option<&str>) -> MeshPeer {
        serde_json::from_value(json!({
            "peerId": "1", "hostname": hostname, "virtualIp": "10.0.0.2",
            "path": route.path(), "route": route, "relayVia": relay_via, "hops": 2,
            "role": role, "latencyMs": 12.5,
        }))
        .unwrap()
    }

    #[test]
    fn device_rows_join_the_directory_with_link_routes() {
        let devices: Vec<account::DirectoryDevice> = serde_json::from_value(json!([
            {"device_id": "phone", "device_name": "iPhone", "device_kind": "mobile"},
            {"device_id": "mac", "device_name": "Mac", "device_alias": "Work Mac", "device_kind": "desktop", "online": true},
            {"device_id": "pc", "device_name": "PC", "device_kind": "desktop", "online": true, "last_seen_at": 1700000000},
            {"device_id": "tablet", "device_name": "Tablet", "device_kind": "mobile"},
            {"device_id": "cloud-1", "device_name": "OpenBitFun Cloud", "device_kind": "cloud_agent", "online": true},
            {"device_id": "browser", "device_name": "Browser", "device_kind": "desktop", "online": true},
            {"device_id": "old", "device_name": "Old host", "online": true},
            {"device_id": "off", "device_name": "Laptop", "device_kind": "desktop", "online": false},
        ]))
        .unwrap();
        assert_eq!(
            expected_route_devices("phone", &devices),
            ["mac", "pc", "browser", "old", "off"],
            "this phone, controller kinds, and cloud_agent are not waited on in Link route sync"
        );
        let mut status = MeshStatus::new(MeshState::Running, None);
        status.peers = vec![
            peer("mac", NodeRole::Device, MeshRoute::RelayedPeer, Some("pc")),
            peer("pc", NodeRole::Device, MeshRoute::DirectLan, None),
            peer(
                "tablet",
                NodeRole::Controller,
                MeshRoute::RelayedServer,
                None,
            ),
            peer(
                "browser",
                NodeRole::Controller,
                MeshRoute::RelayedServer,
                None,
            ),
        ];
        let rows = device_rows("phone", &devices, &status);
        let ids: Vec<&str> = rows
            .iter()
            .map(|row| row["deviceId"].as_str().unwrap())
            .collect();
        assert_eq!(
            ids,
            ["mac", "pc", "old", "off"],
            "this phone and controllers are left out"
        );
        let mac = &rows[0];
        assert_eq!(mac["name"], "Work Mac");
        assert_eq!(mac["connectable"], true);
        assert_eq!(mac["unavailable"], Value::Null);
        assert_eq!(mac["route"], "relayed_peer");
        assert_eq!(mac["relayViaName"], "PC");
        assert_eq!(rows[1]["route"], "direct_lan");
        assert_eq!(
            rows[1]["lastSeenAt"], 1_700_000_000_000u64,
            "the directory's sighting, in ms"
        );
        assert_eq!(rows[2]["unavailable"]["code"], "update_required");
        assert_eq!(rows[2]["connectable"], false);
        assert_eq!(rows[3]["unavailable"]["code"], "offline");
        assert_eq!(rows[3]["online"], false);

        let stopped = MeshStatus::new(MeshState::Starting, None);
        let rows = device_rows("phone", &devices, &stopped);
        assert!(rows
            .iter()
            .all(|row| row["unavailable"]["code"] == "network_down"));
    }

    #[test]
    fn entry_candidates_rank_routed_runtime_hosts_with_their_info_facts() {
        let devices: Vec<account::DirectoryDevice> = serde_json::from_value(json!([
            {"device_id": "phone", "device_kind": "mobile"},
            {"device_id": "mac", "device_kind": "desktop", "client_version": "1.0.0"},
            {"device_id": "cli", "device_kind": "cli", "client_version": "1.0.0"},
            {"device_id": "old", "client_version": "0.9.0"},
            {"device_id": "busy", "device_kind": "desktop", "client_version": "1.0.0"},
            {"device_id": "tablet", "device_kind": "mobile"},
            {"device_id": "cloud-1", "device_kind": "cloud_agent"},
            {"device_id": "off", "device_kind": "desktop", "online": false},
        ]))
        .unwrap();
        let mut status = MeshStatus::new(MeshState::Running, None);
        status.peers = vec![
            peer("mac", NodeRole::Device, MeshRoute::DirectLan, None),
            peer("cli", NodeRole::Device, MeshRoute::DirectLan, None),
            peer("old", NodeRole::Device, MeshRoute::RelayedServer, None),
            peer("busy", NodeRole::Device, MeshRoute::DirectLan, None),
            peer(
                "tablet",
                NodeRole::Controller,
                MeshRoute::RelayedServer,
                None,
            ),
        ];
        let rows = entry_rows("phone", &devices, &status);
        let ids: Vec<&str> = rows.iter().map(|row| row.device_id.as_str()).collect();
        assert_eq!(
            ids,
            ["mac", "cli", "old", "busy"],
            "routed runtime hosts only: no phone, controller, cloud agent or offline device"
        );
        assert!(rows[0].full_host && !rows[1].full_host && rows[2].full_host);
        assert_eq!(rows[0].latency_ms, Some(13));

        let facts = |capabilities: &[&str], load: Option<u64>, version: &str| {
            let mut info = json!({
                "deviceId": "x", "protocol": 1, "capabilities": capabilities,
                "backendVersion": version, "fingerprint": "sha256:x",
            });
            if let Some(load) = load {
                info["fleetLoad"] = json!(load);
            }
            InfoFacts::of(&serde_json::from_value::<obp::MeshInfo>(info).unwrap())
        };
        let fleet = facts(&["mesh_v1", FLEET_V1_CAPABILITY], Some(0), "1.1.0");
        assert_eq!(fleet.fleet_protocol, Some(1));
        let legacy = facts(&["mesh_v1"], None, "");
        assert_eq!((legacy.fleet_protocol, legacy.fleet_load), (None, None));
        let candidates = vec![
            fleet.apply(rows[0].clone()),
            fleet.apply(rows[1].clone()),
            legacy.apply(rows[2].clone()),
            facts(&[FLEET_V1_CAPABILITY], Some(4), "1.1.0").apply(rows[3].clone()),
        ];
        assert_eq!(
            candidates[2].version.as_deref(),
            Some("0.9.0"),
            "the directory's version stays without one"
        );
        let answer = entry_answer(rank_entry_candidates(&candidates));
        assert_eq!(
            answer["entryCandidates"],
            json!(["mac", "busy", "cli", "old"]),
            "fleet_v1, then a desktop, then fewer attached clients; a legacy host last"
        );
        assert_eq!(answer["candidates"][1]["fleetLoad"], 4);
        assert_eq!(entry_answer(Vec::new())["entryCandidates"], json!([]));
    }

    #[test]
    fn connect_options_read_the_fleet_hello_tolerantly() {
        let options = ConnectOptions::from_json(Some(
            r#"{"fleet":{"protocol":1,"cursor":{"mac":{"instanceId":"i1","seq":7}}},"other":1}"#,
        ));
        let fleet = options.fleet.unwrap();
        assert_eq!(fleet.protocol, 1);
        assert!(fleet.cursor.has_seen("mac", "i1", 7));
        assert_eq!(
            serde_json::to_value(&fleet).unwrap(),
            json!({"protocol": 1, "cursor": {"mac": {"instanceId": "i1", "seq": 7}}})
        );
        for plain in [
            None,
            Some(""),
            Some("not json"),
            Some("{}"),
            Some(r#"{"fleet":{"protocol":0}}"#),
            Some(r#"{"fleet":5}"#),
        ] {
            assert!(
                ConnectOptions::from_json(plain).fleet.is_none(),
                "{plain:?}"
            );
        }
    }

    #[test]
    fn ready_info_carries_the_fleet_answer_of_a_fleet_entry() {
        let hello = json!({
            "scope": "account-device", "capabilities": ["mesh_v1", "fleet_v1"],
            "backend": {"version": "1.1.0", "platform": "macos"},
            "fleet": {"protocol": 1, "cursorState": {"mac": "resumed"}},
        });
        let info = ready_info("mac", &hello);
        assert_eq!(info["fleet"]["cursorState"]["mac"], "resumed");
        assert_eq!(info["fleet"]["deviceId"], "mac", "the entry is named");
        assert_eq!(info["version"], "1.1.0");
        let old = ready_info("old", &json!({"scope": "account-device", "backend": {}}));
        assert!(
            old.get("fleet").is_none(),
            "an older entry leaves the UI single-device"
        );
    }

    #[test]
    fn fleet_frames_are_deduplicated_per_origin_and_plain_ones_by_seq() {
        let event = |seq: u64, origin: Option<(&str, &str)>, name: &str| {
            let mut json = json!({"seq": seq, "event": name, "payload": {}});
            if let Some((origin, instance)) = origin {
                json["origin"] = json!(origin);
                json["originInstance"] = json!(instance);
            }
            obp::Event { seq, json }
        };
        let mut cursor: FleetCursor =
            serde_json::from_value(json!({"mac": {"instanceId": "i1", "seq": 5}})).unwrap();
        let batch = vec![
            event(5, Some(("mac", "i1")), "agentic://text-chunk"),
            event(6, Some(("mac", "i1")), "agentic://text-chunk"),
            event(2, Some(("pc", "p1")), "agentic://text-chunk"),
            event(1, Some(("mac", "i2")), "agentic://text-chunk"),
            event(1, Some(("pc", "p1")), "agentic://text-chunk"),
        ];
        let mut plain_floor = Some(100);
        let (fresh, plain_reset) = fresh_events(&batch, &mut plain_floor, Some(&mut cursor));
        assert!(!plain_reset);
        let seen: Vec<(String, u64)> = fresh
            .iter()
            .map(|event| {
                (
                    event["origin"].as_str().unwrap().to_string(),
                    event["seq"].as_u64().unwrap(),
                )
            })
            .collect();
        assert_eq!(
            seen,
            [("mac".to_string(), 6), ("pc".to_string(), 2), ("mac".to_string(), 1)],
            "a replayed frame is dropped, a new instance restarts its origin, a plain floor does not apply"
        );
        assert!(cursor.has_seen("mac", "i2", 1) && cursor.has_seen("pc", "p1", 2));

        let dropped = vec![
            event(40, Some(("pc", "p1")), "backend://events-dropped"),
            event(41, Some(("pc", "p1")), "agentic://text-chunk"),
            event(3, Some(("pc", "p1")), "agentic://text-chunk"),
        ];
        let mut no_floor = None;
        let (fresh, plain_reset) = fresh_events(&dropped, &mut no_floor, Some(&mut cursor));
        assert!(!plain_reset);
        assert_eq!(
            fresh.len(),
            2,
            "the notice restarts the origin at its own seq"
        );
        assert!(cursor.has_seen("pc", "p1", 41));

        let plain = vec![
            event(3, None, "a"),
            event(4, None, "b"),
            event(9, Some(("mac", "i1")), "c"),
        ];
        let mut plain_floor = Some(3);
        let (fresh, plain_reset) = fresh_events(&plain, &mut plain_floor, None);
        assert!(!plain_reset);
        assert_eq!(plain_floor, Some(4));
        assert_eq!(
            fresh.len(),
            2,
            "a plain connection floors plain frames and passes tagged ones"
        );

        // Plain stream restart: backend://events-dropped with seq <= floor must
        // pass through and reset the floor for following events.
        let plain_restarted = vec![
            event(2, None, "backend://events-dropped"),
            event(3, None, "agentic://text-chunk"),
            event(2, None, "agentic://stale-dup"),
        ];
        let mut plain_floor = Some(100);
        let (fresh, plain_reset) = fresh_events(&plain_restarted, &mut plain_floor, None);
        assert!(plain_reset);
        assert_eq!(plain_floor, Some(3));
        assert_eq!(
            fresh
                .iter()
                .map(|event| (
                    event["event"].as_str().unwrap(),
                    event["seq"].as_u64().unwrap()
                ))
                .collect::<Vec<_>>(),
            [("backend://events-dropped", 2), ("agentic://text-chunk", 3)]
        );
    }

    #[tokio::test]
    async fn plain_stream_restart_delivers_events_dropped_and_resets_resume_seq() {
        use crate::obp::tests::{dial_with, scripted_device, ScriptedSession};

        let key = [11u8; 32];
        let mut device = scripted_device(
            key,
            "phone-1",
            "desk-1",
            vec![
                ScriptedSession {
                    instance_id: "inst-1".into(),
                    last_seq: 50,
                    events: vec![
                        json!({"seq": 51, "event": "agentic://text-chunk", "payload": {"n": 51}}),
                        json!({"seq": 52, "event": "agentic://text-chunk", "payload": {"n": 52}}),
                    ],
                    close_after_events: true,
                },
                ScriptedSession {
                    instance_id: "inst-2".into(),
                    last_seq: 2,
                    events: vec![
                        json!({"seq": 2, "event": "backend://events-dropped", "payload": {"reason": "backend_restarted"}}),
                        json!({"seq": 3, "event": "agentic://text-chunk", "payload": {"n": 3}}),
                    ],
                    close_after_events: true,
                },
                ScriptedSession {
                    instance_id: "inst-3".into(),
                    last_seq: 1,
                    events: vec![
                        json!({"seq": 1, "event": "backend://events-dropped", "payload": {"reason": "backend_restarted"}}),
                        json!({"seq": 2, "event": "agentic://text-chunk", "payload": {"n": 2}}),
                    ],
                    close_after_events: false,
                },
            ],
        )
        .await;
        let addr = device.addr;
        let link = Arc::new(DeviceLink::new(
            "desk-1".into(),
            LinkDialer::Custom(Arc::new(move |resume| {
                Box::pin(async move { dial_with(addr, key, resume).await })
            })),
            None,
        ));

        // Initial instance delivers 51 and 52, then closes.
        let mut seen = Vec::new();
        while seen.len() < 2 {
            let batch: Vec<Value> =
                serde_json::from_str(&link.next_events(None).await.unwrap()).unwrap();
            seen.extend(batch);
        }
        assert_eq!(
            seen.iter()
                .map(|e| e["seq"].as_u64().unwrap())
                .collect::<Vec<_>>(),
            [51, 52]
        );
        let first_hello = device.hellos.recv().await.unwrap();
        assert!(first_hello.get("lastSeq").is_none());

        // Case 1: `next_events(Some(52))` reconnects across `inst-1` -> `inst-2`
        // (or gets a single `mesh_reconnecting` error first, then reconnects on retry).
        let mut restarted = Vec::new();
        let mut cursor = Some(52);
        while restarted.len() < 2 {
            match link.next_events(cursor).await {
                Ok(text) => {
                    let batch: Vec<Value> = serde_json::from_str(&text).unwrap();
                    if let Some(last) = batch.last().and_then(|e| e["seq"].as_u64()) {
                        cursor = Some(last);
                    }
                    restarted.extend(batch);
                }
                Err(error) => assert!(error.starts_with("mesh_reconnecting:"), "{error}"),
            }
        }
        let second_hello = device.hellos.recv().await.unwrap();
        assert_eq!(second_hello["instanceId"], "inst-1");
        assert_eq!(second_hello["lastSeq"], 52);
        assert_eq!(
            restarted
                .iter()
                .map(|e| (e["event"].as_str().unwrap(), e["seq"].as_u64().unwrap()))
                .collect::<Vec<_>>(),
            [("backend://events-dropped", 2), ("agentic://text-chunk", 3)]
        );
        assert_eq!(lock(&link.resume).instance_id.as_deref(), Some("inst-2"));
        assert_eq!(lock(&link.resume).last_seq, Some(3));

        // Wait for `inst-2` to finish closing, then let `hello()` redial `inst-3`
        // BEFORE `next_events(Some(3))` runs with the stale cursor from `inst-2`.
        tokio::time::timeout(Duration::from_secs(2), async {
            while lock(&link.current)
                .as_ref()
                .is_some_and(|conn| conn.closed().is_none())
            {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("inst-2 should close after delivering its events");
        let _ = link.hello().await.unwrap();
        let third_hello = device.hellos.recv().await.unwrap();
        assert_eq!(third_hello["instanceId"], "inst-2");
        assert_eq!(third_hello["lastSeq"], 3);

        let mut third_events = Vec::new();
        let mut cursor = Some(3);
        while third_events.len() < 2 {
            let batch: Vec<Value> =
                serde_json::from_str(&link.next_events(cursor).await.unwrap()).unwrap();
            if let Some(last) = batch.last().and_then(|e| e["seq"].as_u64()) {
                cursor = Some(last);
            }
            third_events.extend(batch);
        }
        assert_eq!(
            third_events
                .iter()
                .map(|e| (e["event"].as_str().unwrap(), e["seq"].as_u64().unwrap()))
                .collect::<Vec<_>>(),
            [("backend://events-dropped", 1), ("agentic://text-chunk", 2)]
        );
        assert_eq!(lock(&link.resume).instance_id.as_deref(), Some("inst-3"));
        assert_eq!(lock(&link.resume).last_seq, Some(2));
        link.close();
    }

    #[tokio::test]
    async fn close_during_inflight_dial_leaves_no_zombie_connection() {
        use crate::obp::tests::{dial_with, scripted_device, ScriptedSession};

        let key = [12u8; 32];
        let device = scripted_device(
            key,
            "phone-1",
            "desk-1",
            vec![ScriptedSession {
                instance_id: "inst-1".into(),
                last_seq: 1,
                events: vec![],
                close_after_events: false,
            }],
        )
        .await;
        let addr = device.addr;
        let dial_started = Arc::new(tokio::sync::Notify::new());
        let dial_release = Arc::new(tokio::sync::Notify::new());
        let started_flag = Arc::clone(&dial_started);
        let release_flag = Arc::clone(&dial_release);

        let link = Arc::new(DeviceLink::new(
            "desk-1".into(),
            LinkDialer::Custom(Arc::new(move |resume| {
                let started = Arc::clone(&started_flag);
                let release = Arc::clone(&release_flag);
                Box::pin(async move {
                    started.notify_one();
                    release.notified().await;
                    dial_with(addr, key, resume).await
                })
            })),
            None,
        ));

        let dial_task = tokio::spawn({
            let link = Arc::clone(&link);
            async move { link.hello().await }
        });
        dial_started.notified().await;

        // Closing while dial is blocked must wake/cancel it immediately and leave no connection.
        link.close();
        let result = tokio::time::timeout(Duration::from_secs(2), dial_task)
            .await
            .expect("close must cancel in-flight dial promptly")
            .unwrap();
        assert!(result.is_err());
        assert!(lock(&link.current).is_none());
        dial_release.notify_one();

        // Also exercise the post-dial closed check: if `close()` wins the
        // race right after `dial()` finishes, the fresh connection must be
        // closed instead of stored.
        let device2 = scripted_device(
            key,
            "phone-1",
            "desk-1",
            vec![ScriptedSession {
                instance_id: "inst-2".into(),
                last_seq: 1,
                events: vec![],
                close_after_events: false,
            }],
        )
        .await;
        let addr2 = device2.addr;
        let link2_slot: Arc<Mutex<Option<Weak<DeviceLink>>>> = Arc::new(Mutex::new(None));
        let link2_slot_for_dial = Arc::clone(&link2_slot);
        let link2 = Arc::new(DeviceLink::new(
            "desk-1".into(),
            LinkDialer::Custom(Arc::new(move |resume| {
                let slot = Arc::clone(&link2_slot_for_dial);
                Box::pin(async move {
                    let conn = dial_with(addr2, key, resume).await?;
                    // Mark closed right as dial finishes, before `current()` stores `conn`.
                    if let Some(link) = lock(&slot).as_ref().and_then(Weak::upgrade) {
                        link.closed.store(true, Ordering::Release);
                    }
                    Ok(conn)
                })
            })),
            None,
        ));
        *lock(&link2_slot) = Some(Arc::downgrade(&link2));
        assert!(link2.current().await.is_err());
        assert!(lock(&link2.current).is_none());

        // Closing a live connection removes and shuts it down without `try_lock`.
        let device3 = scripted_device(
            key,
            "phone-1",
            "desk-1",
            vec![ScriptedSession {
                instance_id: "inst-3".into(),
                last_seq: 1,
                events: vec![],
                close_after_events: false,
            }],
        )
        .await;
        let addr3 = device3.addr;
        let link3 = Arc::new(DeviceLink::new(
            "desk-1".into(),
            LinkDialer::Custom(Arc::new(move |resume| {
                Box::pin(async move { dial_with(addr3, key, resume).await })
            })),
            None,
        ));
        let conn = link3.current().await.unwrap();
        assert!(conn.closed().is_none());
        link3.close();
        assert!(lock(&link3.current).is_none());
        tokio::time::timeout(Duration::from_secs(2), async {
            while conn.closed().is_none() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("closed connection should shut down");
    }

    #[tokio::test]
    async fn next_events_error_does_not_clobber_newer_connection() {
        use crate::obp::tests::{dial_with, scripted_device, ScriptedSession};

        let key = [13u8; 32];
        let device = scripted_device(
            key,
            "phone-1",
            "desk-1",
            vec![
                ScriptedSession {
                    instance_id: "inst-1".into(),
                    last_seq: 1,
                    events: vec![],
                    close_after_events: false,
                },
                ScriptedSession {
                    instance_id: "inst-1".into(),
                    last_seq: 1,
                    events: vec![],
                    close_after_events: false,
                },
            ],
        )
        .await;
        let addr = device.addr;
        let conn1 = Arc::new(dial_with(addr, key, obp::Resume::default()).await.unwrap());
        let conn2 = Arc::new(dial_with(addr, key, obp::Resume::default()).await.unwrap());
        let link = Arc::new(DeviceLink::new(
            "desk-1".into(),
            LinkDialer::Custom(Arc::new(|_| Box::pin(async { Err("unused".into()) }))),
            None,
        ));
        *lock(&link.current) = Some(Arc::clone(&conn1));

        let poll_task = tokio::spawn({
            let link = Arc::clone(&link);
            async move { link.next_events(None).await }
        });
        // Give `next_events` a moment to grab `conn1` and await its events.
        tokio::time::sleep(Duration::from_millis(30)).await;
        // Simulate a concurrent caller swapping `current` to a fresh `conn2`,
        // then `conn1` failing.
        *lock(&link.current) = Some(Arc::clone(&conn2));
        conn1.close();

        assert!(poll_task.await.unwrap().is_err());
        let live = lock(&link.current)
            .clone()
            .expect("newer connection must remain installed");
        assert!(
            Arc::ptr_eq(&live, &conn2),
            "error from conn1 must not clear conn2"
        );
        link.close();
    }

    #[test]
    fn package_version_is_synced_to_product_line() {
        assert!(
            !env!("CARGO_PKG_VERSION").starts_with("0."),
            "mobile native crate version should track the 2.x product version, got {}",
            env!("CARGO_PKG_VERSION")
        );
    }

    #[test]
    fn records_from_this_and_future_builds_parse() {
        let minimal: Record =
            serde_json::from_str(r#"{"deviceId":"0123456789abcdef0123456789abcdef"}"#).unwrap();
        assert_eq!(minimal.version, RECORD_VERSION);
        assert!(minimal.account.is_none());
        let future: Record = serde_json::from_value(json!({
            "version": 2,
            "deviceId": "0123456789abcdef0123456789abcdef",
            "newField": true,
            "account": {
                "userId": "email-7", "deviceSecret": crypto::encode_secret(&[1; 32]),
                "tokens": {"accessToken": "a", "accessExpiresAt": 1, "refreshToken": "r", "refreshExpiresAt": 2},
                "directoryToken": "d", "extra": 1
            }
        }))
        .unwrap();
        let account = future.account.unwrap();
        assert_eq!(account.user_id, "email-7");
        assert_eq!(account.email, None);
    }
}

/// Live check of the whole controller against production, as the phone runs
/// it (sign-in, Link as a controller node, device list, OBP to a device):
///
/// ```text
/// OPENBITFUN_MOBILE_LIVE_DIR=/tmp/scratch OPENBITFUN_MOBILE_LIVE_EMAIL=<scratch address> \
/// [OPENBITFUN_MOBILE_LIVE_DEVICE=<device id>] \
/// cargo test --lib live_controller -- --ignored --nocapture
/// ```
///
/// The identity is kept in `<dir>/controller/identity.json` (a private file,
/// not the Keychain). Signing in writes `<dir>/challenge` and waits for the
/// emailed code in `<dir>/code`.
#[cfg(test)]
mod live {
    use super::*;
    use std::time::Instant;

    fn elapsed_ms(start: Instant) -> u128 {
        start.elapsed().as_millis()
    }

    #[test]
    #[ignore = "live: needs a scratch account mailbox and a scratch desktop on the account"]
    fn live_controller() {
        let dir = PathBuf::from(
            std::env::var("OPENBITFUN_MOBILE_LIVE_DIR").expect("OPENBITFUN_MOBILE_LIVE_DIR"),
        );
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async move {
            let store = Box::new(crate::keystore::PrivateFile {
                path: dir.join("controller").join("identity.json"),
            });
            let controller = Controller::start(Config::from_environment(dir.clone()), store).unwrap();
            if controller.restore().await.is_null() {
                let email = std::env::var("OPENBITFUN_MOBILE_LIVE_EMAIL").expect("OPENBITFUN_MOBILE_LIVE_EMAIL");
                let challenge = controller.request_code(email, "en-US".into()).await.unwrap();
                println!("challenge: {}", json!({"codeLength": challenge["codeLength"], "retryAfterSeconds": challenge["retryAfterSeconds"]}));
                std::fs::write(dir.join("challenge"), b"sent").unwrap();
                let code_file = dir.join("code");
                let deadline = Instant::now() + Duration::from_secs(300);
                let code = loop {
                    if let Ok(code) = std::fs::read_to_string(&code_file) {
                        break code.trim().to_string();
                    }
                    assert!(Instant::now() < deadline, "no code arrived");
                    tokio::time::sleep(Duration::from_secs(1)).await;
                };
                let _ = std::fs::remove_file(&code_file);
                let started = Instant::now();
                let account = controller
                    .verify_code(challenge["challengeId"].as_str().unwrap().to_string(), code)
                    .await
                    .unwrap();
                println!("signed in in {} ms; device {}", elapsed_ms(started), account["deviceId"]);
            }
            let started = Instant::now();
            loop {
                let network = controller.network();
                if network["state"] == "running" && network["virtualIp"].is_string() {
                    println!("network running after {} ms: {}", elapsed_ms(started), json!({"role": network["role"], "natType": network["natType"], "relays": network["relayNodes"]}));
                    break;
                }
                assert!(started.elapsed() < Duration::from_secs(90), "network did not start: {network}");
                tokio::time::sleep(Duration::from_millis(250)).await;
            }
            let wanted = std::env::var("OPENBITFUN_MOBILE_LIVE_DEVICE").ok();
            let started = Instant::now();
            let target = loop {
                let devices = controller.list_devices().await.unwrap();
                let rows = devices.as_array().cloned().unwrap_or_default();
                let found = rows.iter().find(|row| {
                    row["connectable"] == true
                        && wanted.as_deref().is_none_or(|id| row["deviceId"] == id)
                });
                if let Some(row) = found {
                    println!("devices after {} ms: {}", elapsed_ms(started), Value::Array(rows.clone()));
                    break row["deviceId"].as_str().unwrap().to_string();
                }
                assert!(started.elapsed() < Duration::from_secs(90), "no connectable device: {devices}");
                tokio::time::sleep(Duration::from_secs(2)).await;
            };
            let started = Instant::now();
            let handle = controller
                .connect(target.clone(), ConnectOptions::default())
                .await
                .unwrap();
            println!("connected to {target} in {} ms", elapsed_ms(started));
            let link = controller.device_link(handle).unwrap();
            println!("hello: {}", link.hello().await.unwrap());

            let call = |command: &'static str, request: Value| {
                let link = Arc::clone(&link);
                async move {
                    let text = link
                        .invoke(command.to_string(), json!({"request": request}).to_string())
                        .await;
                    text.map(|text| serde_json::from_str::<Value>(&text).unwrap_or(Value::Null))
                }
            };
            let mut rtts = Vec::new();
            for _ in 0..10 {
                let started = Instant::now();
                call("get_workspace_navigator", json!({})).await.unwrap();
                rtts.push(started.elapsed().as_secs_f64() * 1000.0);
            }
            rtts.sort_by(|a, b| a.partial_cmp(b).unwrap());
            println!("call RTT ms: min {:.1} median {:.1} max {:.1}", rtts[0], rtts[5], rtts[9]);
            let navigator = call("get_workspace_navigator", json!({})).await.unwrap();
            let workspace = std::env::var("OPENBITFUN_MOBILE_LIVE_WORKSPACE").ok().or_else(|| {
                navigator["opened"]
                    .as_array()
                    .and_then(|opened| {
                        opened
                            .iter()
                            .find(|item| item["workspaceKind"] != "assistant")
                            .or_else(|| opened.first())
                    })
                    .and_then(|item| item["id"].as_str())
                    .map(str::to_string)
            });
            println!("navigator: {}", navigator.to_string().chars().take(400).collect::<String>());
            let Some(workspace) = workspace else {
                panic!("the device has no workspace open");
            };
            let page = call("list_persisted_sessions_page", json!({"workspace_id": workspace, "limit": 20}))
                .await
                .unwrap();
            println!("sessions: {}", page["sessions"].as_array().map(Vec::len).unwrap_or_default());
            let root = navigator["opened"]
                .as_array()
                .and_then(|opened| opened.iter().find(|item| item["id"] == workspace.as_str()))
                .and_then(|item| item["rootPath"].as_str())
                .unwrap_or_default()
                .to_string();
            let created = call(
                "create_session",
                json!({"sessionName": "Phone controller check", "agentType": "agentic",
                       "workspaceId": workspace, "workspacePath": root}),
            )
            .await
            .unwrap();
            let session = created["sessionId"].as_str().unwrap().to_string();
            let events = tokio::spawn({
                let link = Arc::clone(&link);
                async move {
                    let mut names: HashMap<String, usize> = HashMap::new();
                    let deadline = Instant::now() + Duration::from_secs(20);
                    while Instant::now() < deadline {
                        let Ok(Ok(batch)) =
                            tokio::time::timeout(Duration::from_secs(2), link.next_events(None)).await
                        else {
                            continue;
                        };
                        for event in serde_json::from_str::<Vec<Value>>(&batch).unwrap() {
                            *names.entry(event["event"].as_str().unwrap_or_default().to_string()).or_default() += 1;
                        }
                    }
                    names
                }
            });
            let started = Instant::now();
            let sent = call(
                "submit_user_message",
                json!({"sessionId": session, "workspaceId": workspace, "text": "Hello from the phone controller check", "agentType": "agentic"}),
            )
            .await;
            println!("submit_user_message in {} ms: {:?}", elapsed_ms(started), sent);
            let names = events.await.unwrap();
            println!("events in 20 s: {names:?}");
            let page = call("list_persisted_sessions_page", json!({"workspace_id": workspace, "limit": 20}))
                .await
                .unwrap();
            println!("sessions after: {}", page["sessions"].as_array().map(Vec::len).unwrap_or_default());
            controller.disconnect(handle);
        });
    }
}

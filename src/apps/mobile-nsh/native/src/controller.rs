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
use openbitfun_link::{MeshState, MeshStatus, NodeRole, MESH_OBP_PORT_FIRST, MESH_OBP_PORT_LAST};
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
                let expected: Vec<&str> = devices
                    .iter()
                    .filter(|device| device.device_id != device_id && !is_controller_kind(device))
                    .map(|device| device.device_id.as_str())
                    .collect();
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

    /// Opens an OBP connection to `device_id`; returns its handle.
    pub(crate) async fn connect(self: &Arc<Self>, device_id: String) -> Result<u32, String> {
        if !openbitfun_link::handshake::valid_device_id(&device_id) {
            return Err("invalid device id".to_string());
        }
        let link = Arc::new(DeviceLink {
            device_id,
            controller: Arc::downgrade(self),
            current: tokio::sync::Mutex::new(None),
            resume: Mutex::new(obp::Resume::default()),
            closed: std::sync::atomic::AtomicBool::new(false),
        });
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
        let open = |port: u16| {
            let node = Arc::clone(&node);
            async move {
                node.connect_addr(SocketAddr::from((ip, port)), obp::CONNECT_TIMEOUT)
                    .await
                    .map(|stream| Box::new(stream) as Box<dyn obp::Io>)
            }
        };
        let known = lock(&self.ports)
            .get(device_id)
            .filter(|(known_ip, _)| *known_ip == ip)
            .map(|(_, port)| *port);
        let port = match known {
            Some(port) => port,
            None => {
                let mut found = None;
                let mut last_error =
                    format!("mesh_unreachable: device {device_id} has no OBP listener");
                for port in MESH_OBP_PORT_FIRST..=MESH_OBP_PORT_LAST {
                    let probe = async {
                        let stream = open(port).await?;
                        obp::probe_info(stream, &format!("{ip}:{port}")).await
                    };
                    match tokio::time::timeout(obp::PROBE_TIMEOUT, probe).await {
                        Ok(Ok(info)) if info.device_id == device_id => {
                            found = Some(port);
                            break;
                        }
                        Ok(Ok(info)) => {
                            last_error =
                                format!("port {port} at {ip} belongs to device {}", info.device_id)
                        }
                        Ok(Err(error)) => last_error = error,
                        Err(_) => {
                            last_error = format!("mesh_unreachable: {ip}:{port} did not answer")
                        }
                    }
                }
                let port = found.ok_or(last_error)?;
                lock(&self.ports).insert(device_id.to_string(), (ip, port));
                port
            }
        };
        let public = self
            .with_directory(|directory, token| {
                let device_id = device_id.to_string();
                async move { directory.device_key(&token, &device_id).await }
            })
            .await
            .map_err(|error| format!("the device's key could not be read: {error}"))?;
        let secret = crypto::decode_secret(&account.device_secret)?;
        let pair_key = crypto::derive_pair_key(&secret, &crypto::parse_public_key(&public)?)?;
        let stream = match open(port).await {
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

/// The account's devices a controller may drive (`ControllerDevice` of the
/// UI's controller port): directory rows joined with their Link route. This
/// phone and other controllers (phones, browser sessions) are left out.
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
        .filter(|device| device.device_id != own_device_id)
        .filter(|device| !is_controller_kind(device))
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

/// One device connection: dials on demand and resumes the event stream
/// after a drop (same backend: from the last event the UI took; a restarted
/// backend sends `backend://events-dropped` and the UI re-reads).
pub(crate) struct DeviceLink {
    device_id: String,
    controller: Weak<Controller>,
    current: tokio::sync::Mutex<Option<Arc<obp::Connection>>>,
    resume: Mutex<obp::Resume>,
    closed: std::sync::atomic::AtomicBool,
}

impl DeviceLink {
    /// The live connection, dialing (with resume) when there is none.
    async fn current(&self) -> Result<Arc<obp::Connection>, String> {
        if self.closed.load(Ordering::Acquire) {
            return Err("the device connection was closed".to_string());
        }
        let mut current = self.current.lock().await;
        if let Some(connection) = current.as_ref() {
            if connection.closed().is_none() {
                return Ok(Arc::clone(connection));
            }
        }
        let controller = self
            .controller
            .upgrade()
            .ok_or_else(|| "the controller stopped".to_string())?;
        let resume = lock(&self.resume).clone();
        let connection = Arc::new(controller.dial(&self.device_id, resume).await?);
        {
            let mut resume = lock(&self.resume);
            resume.instance_id = connection.instance_id();
            if resume.last_seq.is_none() {
                resume.last_seq = connection.hello()["lastSeq"].as_u64();
            }
        }
        *current = Some(Arc::clone(&connection));
        Ok(connection)
    }

    /// `{version, platform, dataDir}` of the device backend (the UI's
    /// `ready()`); the hello also carries scope and capabilities.
    pub(crate) async fn hello(&self) -> Result<Value, String> {
        let connection = self.current().await?;
        let hello = connection.hello();
        Ok(json!({
            "version": hello["backend"]["version"],
            "platform": hello["backend"]["platform"],
            "dataDir": Value::Null,
            "scope": hello["scope"],
            "capabilities": hello["capabilities"],
            "deviceId": self.device_id,
        }))
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
        if let Some(after) = after {
            let mut resume = lock(&self.resume);
            if resume.last_seq.is_none_or(|seq| after > seq) {
                resume.last_seq = Some(after);
            }
        }
        loop {
            let connection = self.current().await?;
            let batch = match connection.next_events().await {
                Ok(batch) => batch,
                Err(reason) => {
                    *self.current.lock().await = None;
                    return Err(format!("mesh_reconnecting: {reason}"));
                }
            };
            let floor = after.or_else(|| lock(&self.resume).last_seq);
            let fresh: Vec<&Value> = batch
                .iter()
                .filter(|event| floor.is_none_or(|floor| event.seq > floor))
                .map(|event| &event.json)
                .collect();
            if let Some(last) = batch.last() {
                let mut resume = lock(&self.resume);
                if resume.last_seq.is_none_or(|seq| last.seq > seq) {
                    resume.last_seq = Some(last.seq);
                }
            }
            if !fresh.is_empty() {
                return Ok(Value::Array(fresh.into_iter().cloned().collect()).to_string());
            }
        }
    }

    fn close(&self) {
        self.closed.store(true, Ordering::Release);
        if let Ok(current) = self.current.try_lock() {
            if let Some(connection) = current.as_ref() {
                connection.close();
            }
        }
    }
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
            {"device_id": "browser", "device_name": "Browser", "device_kind": "desktop", "online": true},
            {"device_id": "old", "device_name": "Old host", "online": true},
            {"device_id": "off", "device_name": "Laptop", "device_kind": "desktop", "online": false},
        ]))
        .unwrap();
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
            let handle = controller.connect(target.clone()).await.unwrap();
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

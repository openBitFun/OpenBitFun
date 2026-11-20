//! Supervision of the `easytier-core` sidecar.
//!
//! The sidecar runs as a hidden child process (no console window), restarts
//! with exponential backoff when it exits, and stops with its owner. Status
//! comes from `easytier-cli` against the sidecar's loopback RPC portal.

use std::net::{Ipv4Addr, SocketAddr};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use openbitfun_services_core::process_manager::create_tokio_command;
use tokio::sync::watch;
use tokio::task::JoinHandle;

use crate::binary::EasyTierBinaries;
use crate::config::MeshNodeConfig;
use crate::status::{parse_node, parse_peers, MeshState, MeshStatus};

const CONFIG_FILE: &str = "easytier.toml";
const PID_FILE: &str = "easytier.pid";
const LOG_DIR: &str = "logs";
const PROBE_TIMEOUT: Duration = Duration::from_secs(5);
const MIN_BACKOFF: Duration = Duration::from_secs(1);
const MAX_BACKOFF: Duration = Duration::from_secs(60);
/// A run this long resets the backoff.
const HEALTHY_UPTIME: Duration = Duration::from_secs(60);

/// How one sidecar is set up.
#[derive(Debug, Clone)]
pub struct SidecarOptions {
    pub binaries: EasyTierBinaries,
    /// Private directory for the config (0600), pid file and logs.
    pub work_dir: PathBuf,
    pub config: MeshNodeConfig,
    /// Loopback RPC portal port for `easytier-cli`.
    pub rpc_port: u16,
    /// How often status is probed while running.
    pub status_interval: Duration,
    /// The OBP mesh listener port to report in the status.
    pub obp_port: Option<u16>,
}

struct Shared {
    options: SidecarOptions,
    status: watch::Sender<MeshStatus>,
    stop: watch::Sender<bool>,
    probe_lock: tokio::sync::Mutex<()>,
}

/// A running (or restarting) sidecar.
pub struct MeshSidecar {
    shared: Arc<Shared>,
    task: Option<JoinHandle<()>>,
}

/// A free loopback TCP port (released before use; a lost race only means the
/// sidecar fails to start and is restarted with the same port).
pub fn free_loopback_port() -> std::io::Result<u16> {
    let listener = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
    Ok(listener.local_addr()?.port())
}

/// `preferred` when both its TCP and UDP sockets are free on all
/// interfaces, otherwise an ephemeral port free for both.
pub fn free_listener_port(preferred: u16) -> std::io::Result<u16> {
    let free = |port: u16| {
        let tcp = std::net::TcpListener::bind((Ipv4Addr::UNSPECIFIED, port)).ok()?;
        let port = tcp.local_addr().ok()?.port();
        std::net::UdpSocket::bind((Ipv4Addr::UNSPECIFIED, port)).ok()?;
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
    Err(std::io::Error::other("no free mesh listener port"))
}

fn write_private(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(std::fs::Permissions::from_mode(0o600))?;
    }
    file.write_all(bytes)?;
    file.sync_all()
}

fn create_private_dir(path: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

async fn command_output(program: &str, args: &[&str]) -> Option<String> {
    let mut command = create_tokio_command(program);
    command
        .args(args)
        .stdin(std::process::Stdio::null())
        .kill_on_drop(true);
    let output = tokio::time::timeout(PROBE_TIMEOUT, command.output())
        .await
        .ok()?
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).into_owned())
}

/// Stops an `easytier-core` left running by a previous process of this
/// profile (a crash skips the normal stop), so the device never appears
/// twice in its mesh.
async fn reap_stale_sidecar(work_dir: &Path) {
    let path = work_dir.join(PID_FILE);
    let Some(pid) = std::fs::read_to_string(&path)
        .ok()
        .and_then(|text| text.trim().parse::<u32>().ok())
    else {
        return;
    };
    let _ = std::fs::remove_file(&path);
    if pid == std::process::id() {
        return;
    }
    #[cfg(unix)]
    {
        let pid_text = pid.to_string();
        let Some(name) = command_output("ps", &["-o", "comm=", "-p", &pid_text]).await else {
            return;
        };
        if name.trim().ends_with("easytier-core") {
            log::warn!("Stopping a stale mesh sidecar from a previous run: pid={pid}");
            let _ = command_output("kill", &["-TERM", &pid_text]).await;
        }
    }
    #[cfg(windows)]
    {
        let filter = format!("PID eq {pid}");
        let Some(list) = command_output("tasklist", &["/FI", &filter, "/NH"]).await else {
            return;
        };
        if list.to_ascii_lowercase().contains("easytier-core") {
            log::warn!("Stopping a stale mesh sidecar from a previous run: pid={pid}");
            let pid_text = pid.to_string();
            let _ = command_output("taskkill", &["/PID", &pid_text, "/F"]).await;
        }
    }
}

impl MeshSidecar {
    /// Starts supervising a sidecar for `options`.
    pub fn start(options: SidecarOptions) -> Self {
        let mut initial = MeshStatus::new(MeshState::Starting, None);
        initial.device_id = Some(options.config.hostname.clone());
        initial.obp_port = options.obp_port;
        let shared = Arc::new(Shared {
            options,
            status: watch::channel(initial).0,
            stop: watch::channel(false).0,
            probe_lock: tokio::sync::Mutex::new(()),
        });
        let task = tokio::spawn(supervise(Arc::clone(&shared)));
        Self {
            shared,
            task: Some(task),
        }
    }

    /// The latest status (including latency updates).
    pub fn status(&self) -> MeshStatus {
        self.shared.status.borrow().clone()
    }

    /// Notified on material status changes.
    pub fn subscribe(&self) -> watch::Receiver<MeshStatus> {
        self.shared.status.subscribe()
    }

    /// Probes now (while running) and returns the fresh status.
    pub async fn refresh(&self) -> MeshStatus {
        if self.status().state == MeshState::Running {
            probe(&self.shared).await;
        }
        self.status()
    }

    /// Where controllers open outbound mesh connections.
    pub fn socks5_addr(&self) -> SocketAddr {
        SocketAddr::from((Ipv4Addr::LOCALHOST, self.shared.options.config.socks5_port))
    }

    /// Stops the sidecar and waits for it to exit.
    pub async fn stop(mut self) {
        self.shared.stop.send_replace(true);
        if let Some(task) = self.task.take() {
            let _ = task.await;
        }
    }
}

impl Drop for MeshSidecar {
    fn drop(&mut self) {
        // Dropping without `stop()` still ends the child (kill_on_drop).
        self.shared.stop.send_replace(true);
    }
}

fn set_status(shared: &Shared, update: impl FnOnce(&mut MeshStatus)) {
    shared.status.send_if_modified(|status| {
        let before = status.clone();
        update(status);
        status.updated_at_ms = crate::now_ms();
        before.differs_materially(status)
    });
}

async fn probe(shared: &Shared) {
    let _guard = shared.probe_lock.lock().await;
    let options = &shared.options;
    let cli = options.binaries.cli.to_string_lossy().into_owned();
    let portal = format!("127.0.0.1:{}", options.rpc_port);
    let node = command_output(&cli, &["-p", &portal, "-o", "json", "node"]).await;
    let peers = command_output(&cli, &["-p", &portal, "-o", "json", "peer"]).await;
    let node = node.as_deref().map(parse_node);
    let peers = peers.as_deref().map(parse_peers);
    set_status(shared, |status| match (node, peers) {
        (Some(Ok(node)), Some(Ok((peers, relays)))) => {
            status.state = MeshState::Running;
            status.reason = None;
            status.virtual_ip = node.virtual_ip;
            status.nat_type = node.nat_type;
            status.peers = peers;
            status.relay_nodes = relays;
        }
        (node, peers) => {
            let error = match (node, peers) {
                (Some(Err(error)), _) | (_, Some(Err(error))) => error,
                _ => "the mesh sidecar does not answer status probes yet".to_string(),
            };
            if status.state == MeshState::Running {
                status.reason = Some(error);
            }
        }
    });
}

async fn supervise(shared: Arc<Shared>) {
    let options = shared.options.clone();
    let mut stop = shared.stop.subscribe();
    let mut backoff = MIN_BACKOFF;
    let mut restarts = 0u32;
    let config_path = options.work_dir.join(CONFIG_FILE);
    let log_dir = options.work_dir.join(LOG_DIR);
    reap_stale_sidecar(&options.work_dir).await;
    loop {
        if *stop.borrow() {
            break;
        }
        let prepared = create_private_dir(&options.work_dir)
            .and_then(|_| create_private_dir(&log_dir))
            .map_err(|error| format!("cannot prepare the mesh directory: {error}"))
            .and_then(|_| options.config.render())
            .and_then(|text| {
                write_private(&config_path, text.as_bytes())
                    .map_err(|error| format!("cannot write the mesh config: {error}"))
            });
        let spawned = prepared.and_then(|_| {
            let mut command = create_tokio_command(&options.binaries.core);
            command
                .arg("--config-file")
                .arg(&config_path)
                .arg("--rpc-portal")
                .arg(format!("127.0.0.1:{}", options.rpc_port))
                .arg("--console-log-level")
                .arg("error")
                .arg("--file-log-level")
                .arg("warn")
                .arg("--file-log-dir")
                .arg(&log_dir)
                .arg("--file-log-size")
                .arg("4")
                .arg("--file-log-count")
                .arg("2")
                .current_dir(&options.work_dir)
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .kill_on_drop(true);
            command
                .spawn()
                .map_err(|error| format!("cannot start easytier-core: {error}"))
        });
        let mut child = match spawned {
            Ok(child) => child,
            Err(error) => {
                log::warn!("Mesh sidecar failed to start: {error}");
                set_status(&shared, |status| {
                    status.state = MeshState::Failed;
                    status.reason = Some(error);
                    status.sidecar_pid = None;
                });
                if wait_or_stop(&mut stop, backoff).await {
                    break;
                }
                backoff = (backoff * 2).min(MAX_BACKOFF);
                continue;
            }
        };
        let pid = child.id();
        if let Some(pid) = pid {
            let _ = write_private(&options.work_dir.join(PID_FILE), pid.to_string().as_bytes());
        }
        log::info!(
            "Mesh sidecar started: pid={}, network={}, peers={}",
            pid.unwrap_or_default(),
            options.config.credentials.network_name,
            options.config.credentials.peers.len()
        );
        set_status(&shared, |status| {
            status.state = MeshState::Starting;
            status.reason = None;
            status.sidecar_pid = pid;
            status.restarts = restarts;
        });
        let started = Instant::now();
        let mut ticker = tokio::time::interval(options.status_interval);
        // The first probe runs shortly after start, not immediately.
        ticker.reset_after(Duration::from_millis(1500));
        let exit = loop {
            tokio::select! {
                exit = child.wait() => break Some(exit),
                _ = stop.changed() => break None,
                _ = ticker.tick() => probe(&shared).await,
            }
        };
        let Some(exit) = exit else {
            let _ = child.start_kill();
            let _ = tokio::time::timeout(Duration::from_secs(5), child.wait()).await;
            break;
        };
        let reason = match exit {
            Ok(status) => format!("easytier-core exited: {status}"),
            Err(error) => format!("easytier-core wait failed: {error}"),
        };
        log::warn!("Mesh sidecar stopped unexpectedly; restarting: {reason}");
        if started.elapsed() >= HEALTHY_UPTIME {
            backoff = MIN_BACKOFF;
        }
        restarts = restarts.saturating_add(1);
        set_status(&shared, |status| {
            status.state = MeshState::Restarting;
            status.reason = Some(reason);
            status.sidecar_pid = None;
            status.restarts = restarts;
            status.peers.clear();
            status.relay_nodes.clear();
        });
        if wait_or_stop(&mut stop, backoff).await {
            break;
        }
        backoff = (backoff * 2).min(MAX_BACKOFF);
    }
    let _ = std::fs::remove_file(options.work_dir.join(PID_FILE));
    set_status(&shared, |status| {
        status.state = MeshState::Stopped;
        status.reason = None;
        status.sidecar_pid = None;
        status.peers.clear();
        status.relay_nodes.clear();
        status.virtual_ip = None;
    });
    log::info!("Mesh sidecar stopped");
}

/// Sleeps `delay` unless stopped first; true when stopped.
async fn wait_or_stop(stop: &mut watch::Receiver<bool>, delay: Duration) -> bool {
    if *stop.borrow() {
        return true;
    }
    tokio::select! {
        _ = tokio::time::sleep(delay) => *stop.borrow(),
        _ = stop.changed() => true,
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use crate::credentials::MeshCredentials;

    fn fake_binaries(dir: &Path, core_script: &str) -> EasyTierBinaries {
        use std::os::unix::fs::PermissionsExt;
        let core = dir.join("easytier-core");
        let cli = dir.join("easytier-cli");
        std::fs::write(&core, core_script).unwrap();
        std::fs::write(
            &cli,
            "#!/bin/sh\ncase \"$5\" in\n node) echo '{\"ipv4_addr\":\"10.126.126.7/24\",\"hostname\":\"dev\",\"config\":\"secret\"}';;\n peer) echo '[]';;\nesac\n",
        )
        .unwrap();
        for path in [&core, &cli] {
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        EasyTierBinaries { core, cli }
    }

    fn options(dir: &Path, binaries: EasyTierBinaries) -> SidecarOptions {
        SidecarOptions {
            binaries,
            work_dir: dir.join("mesh"),
            config: MeshNodeConfig {
                instance_name: "test".into(),
                hostname: "dev".into(),
                credentials: MeshCredentials {
                    version: 1,
                    network_name: "obf-test".into(),
                    network_secret: "0123456789abcdef-secret".into(),
                    peers: vec!["tcp://127.0.0.1:1".into()],
                    easytier_version: None,
                    issued_at: None,
                },
                listener_port: None,
                socks5_port: 1080,
                inbound_tcp_ports: (47612, 47619),
                disable_p2p: false,
            },
            rpc_port: 1,
            status_interval: Duration::from_millis(200),
            obp_port: Some(47612),
        }
    }

    async fn wait_for(sidecar: &MeshSidecar, state: MeshState) -> MeshStatus {
        for _ in 0..100 {
            let status = sidecar.status();
            if status.state == state {
                return status;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        panic!("state {state:?} not reached: {:?}", sidecar.status());
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn runs_probes_and_stops_with_its_owner() {
        let dir = tempfile::tempdir().unwrap();
        let binaries = fake_binaries(dir.path(), "#!/bin/sh\nexec sleep 30\n");
        let sidecar = MeshSidecar::start(options(dir.path(), binaries));
        let running = wait_for(&sidecar, MeshState::Running).await;
        assert_eq!(running.virtual_ip.as_deref(), Some("10.126.126.7"));
        assert_eq!(running.obp_port, Some(47612));
        let config = dir.path().join("mesh").join(CONFIG_FILE);
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(&config).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert!(dir.path().join("mesh").join(PID_FILE).exists());
        let watcher = sidecar.subscribe();
        sidecar.stop().await;
        assert_eq!(watcher.borrow().state, MeshState::Stopped);
        assert!(!dir.path().join("mesh").join(PID_FILE).exists());
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn restarts_a_crashing_sidecar_with_backoff() {
        let dir = tempfile::tempdir().unwrap();
        let binaries = fake_binaries(dir.path(), "#!/bin/sh\nexit 3\n");
        let sidecar = MeshSidecar::start(options(dir.path(), binaries));
        let restarting = wait_for(&sidecar, MeshState::Restarting).await;
        assert!(restarting.reason.unwrap().contains("exited"));
        assert!(restarting.restarts >= 1);
        sidecar.stop().await;
    }
}

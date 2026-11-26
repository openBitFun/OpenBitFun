//! Always-on CLI daemon: keeps this device reachable for the account's other
//! devices in a headless process, as a runtime node on OpenBitFun Link and in
//! the fleet (`crate::obp_host`, `crate::fleet_host`), and owns the IM bot
//! listeners.
//!
//! While it runs, the daemon is this machine's CLI host for the shared device
//! identity: interactive CLI processes detect it via the pid file and leave
//! the device to it (a Desktop host on the same machine still wins).
//! `install`/`uninstall` register it with the platform service manager
//! (systemd user unit / LaunchAgent) so it survives reboots.

pub(crate) mod control;
mod pid;
mod runner;
mod service;

use std::path::Path;
use std::time::{Duration, Instant};

pub(crate) use pid::{is_daemon_running, request_daemon_shutdown};
pub(crate) use runner::run_daemon;
pub(crate) use service::{
    install_service, print_status, restart_installed_service, uninstall_service,
    ServiceRestartOutcome,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum DaemonUpdateRestartOutcome {
    NoDaemonRunning,
    ServiceRestarted {
        service: String,
    },
    ServiceRestartFailed {
        service: String,
        command: String,
        error: String,
    },
    DetachedRestarted,
    DetachedRestartFailed {
        error: String,
    },
    ManualRestartRequired,
}

/// Restart the daemon after `openbitfun update` replaces the binary on disk:
/// 1. Installed system service (`systemd --user` / macOS `LaunchAgent`): restart via service manager.
/// 2. OpenBitFun-spawned detached daemon: stop gracefully and relaunch the new binary detached.
/// 3. User-supervised daemon (`openbitfun daemon run` in tmux/docker/supervisor): leave untouched
///    and report `ManualRestartRequired` so the user gets an explicit notice.
pub(crate) fn restart_daemon_after_update(new_exe: &Path) -> DaemonUpdateRestartOutcome {
    match restart_installed_service() {
        ServiceRestartOutcome::Restarted { service } => {
            return DaemonUpdateRestartOutcome::ServiceRestarted { service };
        }
        ServiceRestartOutcome::Failed {
            service,
            command,
            error,
        } => {
            return DaemonUpdateRestartOutcome::ServiceRestartFailed {
                service,
                command,
                error,
            };
        }
        ServiceRestartOutcome::NotInstalled => {}
    }

    if pid::is_detached_daemon_running() {
        let _ = pid::request_daemon_shutdown();
        let deadline = Instant::now() + Duration::from_secs(5);
        while pid::is_daemon_running() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(100));
        }
        if pid::is_daemon_running() {
            return DaemonUpdateRestartOutcome::DetachedRestartFailed {
                error: "previous background daemon did not stop within 5 seconds".to_string(),
            };
        }
        pid::remove_detached_pid_file();

        let mut process = openbitfun_services_core::process_manager::create_command(new_exe);
        process
            .arg("daemon")
            .arg("run")
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            // SAFETY: setsid is async-signal-safe and detaches the new daemon from this terminal.
            unsafe {
                process.pre_exec(|| {
                    if libc::setsid() == -1 {
                        Err(std::io::Error::last_os_error())
                    } else {
                        Ok(())
                    }
                });
            }
        }
        return match process.spawn() {
            Ok(child) => {
                let _ = pid::write_detached_pid_file(child.id());
                DaemonUpdateRestartOutcome::DetachedRestarted
            }
            Err(error) => DaemonUpdateRestartOutcome::DetachedRestartFailed {
                error: error.to_string(),
            },
        };
    }

    if pid::is_daemon_running() {
        return DaemonUpdateRestartOutcome::ManualRestartRequired;
    }

    DaemonUpdateRestartOutcome::NoDaemonRunning
}

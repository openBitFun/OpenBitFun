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

pub(crate) use pid::{is_daemon_running, request_daemon_shutdown};
pub(crate) use runner::run_daemon;
pub(crate) use service::{install_service, print_status, uninstall_service};

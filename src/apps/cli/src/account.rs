//! CLI adapter for account-backed device serving.
//!
//! Shared account identity, persistence and transitions are owned by
//! [`AccountRuntime`]. This module contains only CLI Host effects: daemon
//! retirement and this process's claim on serving the machine's device
//! identity over OpenBitFun Link.
//!
//! The claim is a host-local lock ([`DeviceRoutingLease`]): every OpenBitFun
//! host on a machine shares one device identity, so only one of them joins
//! Link as that device. A Desktop host holds the primary tier and always
//! wins; this process takes the secondary tier and serves only while no
//! primary host does (`crate::obp_host` re-checks on every routing change and
//! every 15 seconds). The claim is held while an account is signed in and
//! remote control is on, and released on sign-out, account change, daemon
//! hand-off or when remote control is turned off.

use std::sync::{Arc, Mutex, OnceLock, Weak};
use std::time::Duration;

use anyhow::{anyhow, Result};
use async_trait::async_trait;
use openbitfun_product_domains::account::{AccountDevice, AccountInfo, AccountSnapshotProjection};

use openbitfun_core::service::remote_connect::account_runtime::{
    AccountRoutingStartRequest, AccountRuntime, AccountRuntimeHost,
    BackgroundRoutingOwnerRetirementError,
};
use openbitfun_core::service::remote_connect::routing_lease::{
    DeviceRoutingLease, DeviceRoutingPriority,
};
use openbitfun_core::service::remote_connect::{device, DeviceIdentity};

pub(crate) struct CliAccountRuntimeParts {
    pub(crate) runtime: Arc<AccountRuntime>,
    pub(crate) routing: Arc<CliAccountRoutingHost>,
}

pub(crate) fn build_account_runtime() -> CliAccountRuntimeParts {
    let routing = CliAccountRoutingHost::new();
    let runtime = AccountRuntime::new(routing.clone());
    routing.bind_runtime(Arc::downgrade(&runtime));
    CliAccountRuntimeParts { runtime, routing }
}

pub(crate) fn build_management_account_runtime() -> Arc<AccountRuntime> {
    build_account_runtime().runtime
}

pub(crate) fn account_snapshot_projection(
    snapshot: openbitfun_core::service::remote_connect::account_runtime::AccountSnapshot,
) -> AccountSnapshotProjection {
    AccountSnapshotProjection {
        logged_in: snapshot.logged_in,
        info: snapshot.info.map(|info| AccountInfo {
            user_id: info.user_id,
            relay_url: info.relay_url,
            device_id: info.device_id,
            device_name: info.device_name,
        }),
        devices: snapshot
            .devices
            .into_iter()
            .map(|device| AccountDevice {
                device_id: device.device_id,
                device_name: device.device_name,
                device_kind: device.device_kind,
                device_alias: device.device_alias,
                device_model: device.device_model,
                device_os: device.device_os,
                device_os_version: device.device_os_version,
                device_client_version: device.device_client_version,
                device_client_protocol: device.device_client_protocol,
                compatible: device.compatible,
                online: device.online,
            })
            .collect(),
    }
}

pub(crate) fn account_login_status_message(
    result: &openbitfun_core::service::remote_connect::account_runtime::AccountLoginResult,
) -> String {
    if device::remote_control_allowed().ok() == Some(false) {
        format!(
            "Logged in as user {} on {}. Remote control is off.",
            result.user_id, result.relay_url
        )
    } else if result.routing_standby {
        format!(
            "Logged in as user {} on {}. Another OpenBitFun host on this machine serves this device; this one takes over when it exits.",
            result.user_id, result.relay_url
        )
    } else if result.routing_connected {
        format!(
            "Logged in as user {} on {}. This host serves this device for remote control.",
            result.user_id, result.relay_url
        )
    } else if let Some(error) = &result.routing_error {
        tracing::warn!(
            "Device serving claim failed after sign-in: {}",
            bounded_account_error(error)
        );
        format!(
            "Logged in as user {} on {}. Remote control could not start on this host; see the log for details.",
            result.user_id, result.relay_url
        )
    } else {
        format!(
            "Logged in as user {} on {}.",
            result.user_id, result.relay_url
        )
    }
}

pub(crate) fn redact_login_error(error: anyhow::Error, secrets: [&str; 3]) -> anyhow::Error {
    let mut message = error.to_string();
    for secret in secrets {
        if !secret.is_empty() {
            message = message.replace(secret, "<redacted>");
        }
    }
    anyhow!(bounded_account_error(&message))
}

/// Redacted/bounded transport detail for logs only; never rendered in the UI.
pub(crate) fn bounded_account_error(message: &str) -> String {
    message
        .chars()
        .filter(|character| !character.is_control())
        .take(500)
        .collect()
}

/// What this process does with the shared device identity now.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DeviceServingState {
    /// No claim: signed out, remote control off, or handed to the daemon.
    Stopped,
    /// Claimed, but another OpenBitFun host on this machine serves the device.
    Standby,
    /// This process serves the device (joins Link as it).
    Serving,
}

impl DeviceServingState {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Stopped => "stopped",
            Self::Standby => "standby",
            Self::Serving => "serving",
        }
    }
}

/// CLI-owned device-serving effects injected into the shared Account Runtime.
pub(crate) struct CliAccountRoutingHost {
    self_ref: Weak<CliAccountRoutingHost>,
    runtime: OnceLock<Weak<AccountRuntime>>,
    permission_monitor: OnceLock<tokio::task::AbortHandle>,
    /// This process's claim on serving the device; `None` while not claimed.
    lease: Mutex<Option<DeviceRoutingLease>>,
    /// Where test claims keep their lock files (the real claim sits next to
    /// the device identity).
    #[cfg(test)]
    lease_dir: Option<std::path::PathBuf>,
}

impl Drop for CliAccountRoutingHost {
    fn drop(&mut self) {
        if let Some(task) = self.permission_monitor.get() {
            task.abort();
        }
    }
}

impl CliAccountRoutingHost {
    fn new() -> Arc<Self> {
        Arc::new_cyclic(|self_ref| Self {
            self_ref: self_ref.clone(),
            runtime: OnceLock::new(),
            permission_monitor: OnceLock::new(),
            lease: Mutex::new(None),
            #[cfg(test)]
            lease_dir: None,
        })
    }

    fn bind_runtime(&self, runtime: Weak<AccountRuntime>) {
        self.runtime
            .set(runtime)
            .unwrap_or_else(|_| panic!("CLI account routing runtime was bound twice"));
    }

    fn runtime(&self) -> Result<Arc<AccountRuntime>> {
        self.runtime
            .get()
            .and_then(Weak::upgrade)
            .ok_or_else(|| anyhow!("account runtime is unavailable"))
    }

    pub(crate) fn monitor_remote_control(&self) {
        self.permission_monitor.get_or_init(|| {
            let host = self.self_ref.clone();
            let mut allowed = device::remote_control_allowed().unwrap_or(false);
            tokio::spawn(async move {
                loop {
                    allowed = device::wait_for_remote_control_change(allowed).await;
                    let Some(host) = host.upgrade() else { return };
                    let Ok(runtime) = host.runtime() else { return };
                    if !allowed {
                        host.stop_routing();
                    }
                    if let Some(daemon) = crate::remote_control::daemon_host() {
                        if let Err(error) = daemon.apply_remote_control_permission(allowed).await {
                            tracing::warn!(
                                "Failed to apply daemon remote control setting: {error}"
                            );
                        }
                    } else if allowed
                        && runtime.device_routing_requested(runtime.account_context_generation())
                    {
                        if let Ok(info) = runtime.account_info().await {
                            if let Err(error) =
                                runtime.restore_device_routing(&info.device_name).await
                            {
                                tracing::warn!("Failed to resume device serving: {error}");
                            }
                        }
                    }
                }
            })
            .abort_handle()
        });
    }

    fn claim_lease(&self) -> Result<DeviceRoutingLease> {
        #[cfg(test)]
        if let Some(dir) = &self.lease_dir {
            return Ok(DeviceRoutingLease::in_dir(
                dir,
                DeviceRoutingPriority::Secondary,
            ));
        }
        // A Desktop host on this machine serves the shared device first; this
        // process stands by and takes over once that host exits.
        DeviceRoutingLease::for_device(DeviceRoutingPriority::Secondary)
    }

    fn lease_slot(&self) -> std::sync::MutexGuard<'_, Option<DeviceRoutingLease>> {
        self.lease
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Holds a claim (keeps an existing one). Returns whether it was new.
    fn hold_lease(&self) -> Result<bool> {
        let mut slot = self.lease_slot();
        if slot.is_some() {
            return Ok(false);
        }
        *slot = Some(self.claim_lease()?);
        Ok(true)
    }

    async fn start_routing(&self, request: AccountRoutingStartRequest) -> Result<()> {
        self.monitor_remote_control();
        let runtime = self.runtime()?;
        if !runtime.device_routing_requested(request.account_generation) {
            return Err(anyhow!("account context changed"));
        }
        if !device::remote_control_allowed()? {
            self.stop_routing();
            return Ok(());
        }
        let claimed = self.hold_lease()?;
        if !runtime.device_routing_requested(request.account_generation) {
            self.stop_routing();
            return Err(anyhow!("account context changed"));
        }
        if claimed {
            if self.serving_state() == DeviceServingState::Standby {
                tracing::info!(
                    "Another OpenBitFun host on this machine serves this device; standing by"
                );
            }
            // The account directory shows this host's platform and build.
            let generation = request.account_generation;
            let runtime = Arc::downgrade(&runtime);
            tokio::spawn(async move {
                let Some(runtime) = runtime.upgrade() else {
                    return;
                };
                let Ok(device) = DeviceIdentity::from_current_machine() else {
                    return;
                };
                if let Err(error) = runtime
                    .report_local_device_metadata(generation, &device.device_id)
                    .await
                {
                    tracing::warn!("Failed to report device metadata: {error}");
                }
            });
        }
        crate::obp_host::wake();
        Ok(())
    }

    /// Releases the claim so the next host in line serves the device.
    fn stop_routing(&self) {
        let released = self.lease_slot().take().is_some();
        if released {
            crate::obp_host::wake();
        }
    }

    fn lease_serves(&self) -> Option<bool> {
        let mut slot = self.lease_slot();
        let lease = slot.as_mut()?;
        Some(match lease.may_serve() {
            Ok(serves) => serves,
            Err(error) => {
                tracing::warn!("Device serving claim could not be checked: {error}");
                false
            }
        })
    }

    pub(crate) fn serving_state(&self) -> DeviceServingState {
        match self.lease_serves() {
            None => DeviceServingState::Stopped,
            Some(false) => DeviceServingState::Standby,
            Some(true) => DeviceServingState::Serving,
        }
    }

    /// Whether this process serves the shared device identity now: it holds
    /// the claim, remote control is on, and no primary host on this machine
    /// (a Desktop) serves the device. OpenBitFun Link follows this answer, so
    /// one machine never joins the account network twice as one device.
    pub(crate) async fn serves_device(&self) -> bool {
        device::remote_control_allowed().unwrap_or(false)
            && self.serving_state() == DeviceServingState::Serving
    }

    pub(crate) async fn stop_device_routing(&self) {
        if let Ok(runtime) = self.runtime() {
            runtime.cancel_device_routing();
        }
        self.stop_routing();
    }
}

#[async_trait]
impl AccountRuntimeHost for CliAccountRoutingHost {
    fn is_cli_host(&self) -> bool {
        true
    }

    async fn retire_background_routing_owner(
        &self,
    ) -> std::result::Result<bool, BackgroundRoutingOwnerRetirementError> {
        if !crate::daemon::is_daemon_running() {
            return Ok(false);
        }
        if !crate::daemon::request_daemon_shutdown() {
            return Err(BackgroundRoutingOwnerRetirementError {
                error: anyhow!("could not stop the CLI daemon; the current account remains active"),
                owner_may_exit: false,
            });
        }
        let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
        while crate::daemon::is_daemon_running() {
            if tokio::time::Instant::now() >= deadline {
                return Err(BackgroundRoutingOwnerRetirementError {
                    error: anyhow!(
                        "CLI daemon did not stop in time; the current account remains active"
                    ),
                    owner_may_exit: true,
                });
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        Ok(true)
    }

    fn background_routing_owner_is_running(&self) -> bool {
        crate::daemon::is_daemon_running()
    }

    fn request_background_routing_owner_shutdown(&self) -> bool {
        crate::daemon::request_daemon_shutdown()
    }

    async fn start_device_routing(&self, request: AccountRoutingStartRequest) -> Result<()> {
        self.start_routing(request).await
    }

    async fn stop_device_routing(&self) {
        crate::remote_control::retire_daemon_account().await;
        self.stop_routing();
    }

    async fn device_routing_is_active(&self) -> bool {
        self.lease_slot().is_some()
    }

    async fn device_routing_is_standby(&self) -> bool {
        self.serving_state() == DeviceServingState::Standby
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn host_in(dir: &std::path::Path) -> Arc<CliAccountRoutingHost> {
        Arc::new_cyclic(|self_ref| CliAccountRoutingHost {
            self_ref: self_ref.clone(),
            runtime: OnceLock::new(),
            permission_monitor: OnceLock::new(),
            lease: Mutex::new(None),
            lease_dir: Some(dir.to_path_buf()),
        })
    }

    #[test]
    fn standby_login_does_not_claim_serving() {
        let result =
            openbitfun_core::service::remote_connect::account_runtime::AccountLoginResult {
                user_id: "user".into(),
                relay_url: "https://account.example.test".into(),
                routing_owner_replaced: false,
                routing_connected: false,
                routing_standby: true,
                routing_error: None,
            };
        let message = account_login_status_message(&result);
        if device::remote_control_allowed().ok() != Some(false) {
            assert!(message.contains("takes over when it exits"), "{message}");
        }
        assert!(!message.contains("serves this device for"), "{message}");
    }

    /// A released OS lock can stay held for a moment while another test of
    /// this process forks a child (the descriptor lives until its exec), so
    /// take-overs are awaited briefly instead of asserted on the spot.
    fn eventually_serving(host: &CliAccountRoutingHost) -> DeviceServingState {
        for _ in 0..100 {
            let state = host.serving_state();
            if state == DeviceServingState::Serving {
                return state;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        host.serving_state()
    }

    #[test]
    fn a_desktop_host_wins_and_the_cli_takes_over_when_it_exits() {
        let dir = tempfile::tempdir().unwrap();
        let host = host_in(dir.path());
        assert_eq!(host.serving_state(), DeviceServingState::Stopped);

        let mut desktop = DeviceRoutingLease::in_dir(dir.path(), DeviceRoutingPriority::Primary);
        assert!(desktop.may_serve().unwrap());
        assert!(host.hold_lease().unwrap());
        assert!(!host.hold_lease().unwrap(), "an existing claim is kept");
        assert_eq!(host.serving_state(), DeviceServingState::Standby);

        drop(desktop);
        assert_eq!(eventually_serving(&host), DeviceServingState::Serving);

        host.stop_routing();
        assert_eq!(host.serving_state(), DeviceServingState::Stopped);
    }

    #[test]
    fn a_second_cli_host_stands_by_until_the_first_releases_its_claim() {
        let dir = tempfile::tempdir().unwrap();
        let first = host_in(dir.path());
        let second = host_in(dir.path());
        first.hold_lease().unwrap();
        second.hold_lease().unwrap();
        assert_eq!(first.serving_state(), DeviceServingState::Serving);
        assert_eq!(second.serving_state(), DeviceServingState::Standby);

        // A daemon hand-off: the chat releases, the daemon serves.
        first.stop_routing();
        assert_eq!(eventually_serving(&second), DeviceServingState::Serving);
    }
}

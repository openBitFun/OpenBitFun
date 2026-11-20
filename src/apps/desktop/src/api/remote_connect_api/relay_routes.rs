//! Desktop Relay connection under the shared signed-in identity.
//!
//! Official routing owns the persisted account session and device directory.
//! The LAN route (an in-process embedded Relay) was retired: devices on the
//! same network connect directly through the account device mesh. The route
//! key stays so routing owners, controller attachments and status entries keep
//! their typed shape.

use super::*;

/// User-visible refusal for the retired LAN Relay mode. Older UIs, IM bots and
/// remote agents that still ask for `lan` get this instead of a silent fallback
/// to the official Relay.
pub(crate) const LAN_RELAY_RETIRED_ERROR: &str = "unsupported: the LAN relay was retired; same-network devices connect directly through the device mesh";

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum RelayRoute {
    #[serde(rename = "openbitfun_server")]
    Official,
}

struct RouteRuntime {
    service: Arc<RwLock<Option<RemoteConnectService>>>,
    state: std::sync::Mutex<DeviceRoutingState>,
    lifecycle: tokio::sync::RwLock<()>,
    cancellation: tokio::sync::watch::Sender<u64>,
}

impl Default for RouteRuntime {
    fn default() -> Self {
        Self {
            service: Arc::new(RwLock::new(None)),
            state: std::sync::Mutex::new(DeviceRoutingState::default()),
            lifecycle: tokio::sync::RwLock::new(()),
            cancellation: tokio::sync::watch::channel(0).0,
        }
    }
}

impl RelayRoute {
    pub(super) const ALL: [Self; 1] = [Self::Official];

    fn runtime(self) -> &'static RouteRuntime {
        static OFFICIAL: OnceLock<RouteRuntime> = OnceLock::new();
        match self {
            Self::Official => &OFFICIAL,
        }
        .get_or_init(RouteRuntime::default)
    }

    pub(super) fn service(self) -> &'static Arc<RwLock<Option<RemoteConnectService>>> {
        &self.runtime().service
    }

    pub(super) fn state(self) -> &'static std::sync::Mutex<DeviceRoutingState> {
        &self.runtime().state
    }

    pub(super) fn lifecycle(self) -> &'static tokio::sync::RwLock<()> {
        &self.runtime().lifecycle
    }

    pub(super) fn cancellation(self) -> &'static tokio::sync::watch::Sender<u64> {
        &self.runtime().cancellation
    }

    pub(super) fn cancel(self) {
        self.cancellation()
            .send_modify(|epoch| *epoch = epoch.wrapping_add(1));
    }

    pub(super) fn generation(self) -> u64 {
        account_context_generation()
    }

    pub(super) fn is_current(self, generation: u64) -> bool {
        account_context_is_current(generation)
    }

    pub(super) async fn lock_operation(
        self,
        generation: u64,
    ) -> Result<tokio::sync::MutexGuard<'static, ()>, String> {
        let guard = ACCOUNT_OPERATION_LOCK.lock().await;
        if !self.is_current(generation) {
            return Err("account context changed".into());
        }
        Ok(guard)
    }

    pub(super) async fn context(self, generation: u64) -> Result<(AccountSession, String), String> {
        read_account_context_for_generation(generation).await
    }

    pub(super) async fn matches(self, generation: u64, token: &str) -> bool {
        self.context(generation)
            .await
            .is_ok_and(|(session, _)| session.token == token)
            && self.is_current(generation)
    }
}

/// The desktop no longer hosts an in-process Relay. Core Remote Connect still
/// models the LAN method for other hosts, so the port answers explicitly.
pub(super) struct DesktopEmbeddedRelayUnavailable;

#[async_trait::async_trait]
impl openbitfun_core::service::remote_connect::embedded_relay_host::EmbeddedRelayHost
    for DesktopEmbeddedRelayUnavailable
{
    async fn start(&self, _port: u16, _static_dir: Option<String>) -> anyhow::Result<()> {
        anyhow::bail!(LAN_RELAY_RETIRED_ERROR)
    }

    async fn stop(&self) {}
}

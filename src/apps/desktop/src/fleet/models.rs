//! Other devices' models for sessions on this desktop.
//!
//! The fleet index holds every device's published model catalog; this
//! module hands it to `openbitfun_core::service::fleet::models` (the owner
//! facts and the links the relay rounds use) and mirrors it as runtime model
//! entries whenever the index changes.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use openbitfun_core::service::fleet::models::{
    sync_runtime_models, FleetModelPeers, ModelOwner, PeersFuture,
};
use openbitfun_product_domains::fleet::FleetDeviceState;
use serde_json::Value;

/// Index changes within this window become one sync.
const SYNC_COALESCE: Duration = Duration::from_millis(500);

/// The running fleet as the model catalog's peers.
pub(super) struct DesktopModelPeers;

impl FleetModelPeers for DesktopModelPeers {
    fn self_device_id(&self) -> String {
        super::current()
            .map(|host| host.device_id().to_string())
            .unwrap_or_default()
    }

    fn owner(&self, device_id: &str) -> Option<ModelOwner> {
        let host = super::current()?;
        let (facts, models) = host.index().device_models(device_id)?;
        Some(ModelOwner {
            name: if facts.name.trim().is_empty() {
                device_id.to_string()
            } else {
                facts.name
            },
            online: facts.state == FleetDeviceState::Online,
            models,
        })
    }

    fn call<'a>(
        &'a self,
        device_id: &'a str,
        command: &'a str,
        args: Value,
    ) -> PeersFuture<'a, Result<Value, String>> {
        Box::pin(async move {
            let host = super::require(command)?;
            host.call_device(device_id, command, args).await
        })
    }
}

/// Mirrors the catalog once the index settles.
pub(super) fn schedule_sync() {
    static PENDING: AtomicBool = AtomicBool::new(false);
    if PENDING.swap(true, Ordering::SeqCst) {
        return;
    }
    let Ok(runtime) = tokio::runtime::Handle::try_current() else {
        PENDING.store(false, Ordering::SeqCst);
        return;
    };
    runtime.spawn(async {
        tokio::time::sleep(SYNC_COALESCE).await;
        PENDING.store(false, Ordering::SeqCst);
        if let Some(host) = super::current() {
            sync_runtime_models(&host.index().models("")).await;
        }
    });
}

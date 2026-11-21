//! Account-device transport for controller-side callers that are not UIs:
//! Detached Dispatch (`dispatch_target_*`) and IM bots (`RemoteCommand` JSON).
//!
//! OpenBitFun 2.0 devices reach each other only over OBP on the account device
//! mesh (OpenBitFun Link). A host that runs Link (the native desktop, the CLI
//! host) installs an [`AccountDeviceMeshRoute`]; callers go through
//! [`call_mesh`]. A device that is not on Link, or that does not advertise the
//! capability (an OpenBitFun 1.x device), gets an explicit
//! `device_not_on_link` error: 2.0 has no relay transport to fall back to.

use std::sync::{Arc, RwLock};

use async_trait::async_trait;
use serde_json::Value;

/// Negotiated mesh capability: the device runs the detached-dispatch target
/// verbs (`dispatch_target_*`) over OBP.
pub const CAPABILITY_DISPATCH_TARGET_V1: &str = "dispatch_target_v1";
/// Negotiated mesh capability: the device answers `RemoteCommand` JSON
/// (the IM bot protocol) through [`OBP_REMOTE_COMMAND`].
pub const CAPABILITY_REMOTE_COMMAND_V1: &str = "remote_command_v1";
/// OBP verb carrying one `RemoteCommand` (`{"command": <RemoteCommand>}`) and
/// answering its `RemoteResponse` JSON.
pub const OBP_REMOTE_COMMAND: &str = "obp_remote_command";

/// Routes a call to an account device over the device mesh.
#[async_trait]
pub trait AccountDeviceMeshRoute: Send + Sync {
    /// Runs `command` on `device_id` over OBP when the device is a mesh
    /// device advertising `required_capability`.
    ///
    /// - `None`: not a mesh route (offline, not on Link, an older device);
    ///   [`call_mesh`] reports `device_not_on_link`.
    /// - `Some(Ok(value))`: the command's value.
    /// - `Some(Err(message))`: the device is a mesh device and the call
    ///   failed; the caller reports it.
    async fn call(
        &self,
        device_id: &str,
        required_capability: &str,
        command: &str,
        args: Value,
    ) -> Option<Result<Value, String>>;
}

static ROUTE: RwLock<Option<Arc<dyn AccountDeviceMeshRoute>>> = RwLock::new(None);

/// Installs the process's mesh route (the native desktop host at startup).
pub fn install_mesh_route(route: Arc<dyn AccountDeviceMeshRoute>) {
    *ROUTE
        .write()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(route);
}

/// The installed mesh route, if this host runs a device mesh.
pub fn mesh_route() -> Option<Arc<dyn AccountDeviceMeshRoute>> {
    ROUTE
        .read()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone()
}

/// Stable prefix of the refusal for a device that is not reachable over Link
/// with the needed capability (offline, not on Link, or an OpenBitFun 1.x
/// device): the caller reports it; nothing is retried elsewhere.
pub const DEVICE_NOT_ON_LINK: &str = "device_not_on_link";

/// Runs `command` on `device_id` over the device mesh through `route`.
///
/// Errors (never a fallback): no Link on this host, a device that is not a
/// Link device advertising `required_capability`, or the mesh call's own
/// failure.
pub async fn call_mesh(
    route: Option<Arc<dyn AccountDeviceMeshRoute>>,
    device_id: &str,
    required_capability: &str,
    command: &str,
    args: Value,
) -> Result<Value, String> {
    let Some(route) = route else {
        return Err(format!(
            "{DEVICE_NOT_ON_LINK}: this host is not on OpenBitFun Link (sign in and turn remote control on)"
        ));
    };
    match route
        .call(device_id, required_capability, command, args)
        .await
    {
        Some(result) => result,
        None => Err(format!(
            "{DEVICE_NOT_ON_LINK}: device {device_id} is not reachable over OpenBitFun Link with {required_capability} (offline, or it runs an OpenBitFun version older than 2.0)"
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// A mesh where `new-*` devices advertise every capability.
    struct FakeMesh {
        calls: AtomicUsize,
    }

    #[async_trait]
    impl AccountDeviceMeshRoute for FakeMesh {
        async fn call(
            &self,
            device_id: &str,
            required_capability: &str,
            command: &str,
            args: Value,
        ) -> Option<Result<Value, String>> {
            if !device_id.starts_with("new-") {
                return None;
            }
            self.calls.fetch_add(1, Ordering::SeqCst);
            if device_id == "new-broken" {
                return Some(Err("mesh_unreachable: device did not answer".into()));
            }
            Some(Ok(
                json!({"via": "mesh", "capability": required_capability, "command": command, "args": args}),
            ))
        }
    }

    #[tokio::test]
    async fn new_devices_are_called_over_the_mesh_and_failures_are_reported() {
        let mesh = Arc::new(FakeMesh {
            calls: AtomicUsize::new(0),
        });
        let route: Arc<dyn AccountDeviceMeshRoute> = mesh.clone();
        let value = call_mesh(
            Some(route.clone()),
            "new-mac",
            CAPABILITY_REMOTE_COMMAND_V1,
            OBP_REMOTE_COMMAND,
            json!({"command": {"cmd": "get_workspace_info"}}),
        )
        .await;
        assert_eq!(value.unwrap()["via"], "mesh");

        let failed = call_mesh(
            Some(route),
            "new-broken",
            CAPABILITY_REMOTE_COMMAND_V1,
            OBP_REMOTE_COMMAND,
            json!({}),
        )
        .await;
        assert!(failed.unwrap_err().starts_with("mesh_unreachable"));
        assert_eq!(mesh.calls.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn devices_off_link_and_hosts_without_link_get_an_explicit_refusal() {
        let route: Arc<dyn AccountDeviceMeshRoute> = Arc::new(FakeMesh {
            calls: AtomicUsize::new(0),
        });
        let old = call_mesh(
            Some(route),
            "old-pc",
            CAPABILITY_REMOTE_COMMAND_V1,
            OBP_REMOTE_COMMAND,
            json!({"x": 1}),
        )
        .await;
        assert!(old.unwrap_err().starts_with(DEVICE_NOT_ON_LINK));

        let no_link = call_mesh(
            None,
            "new-mac",
            CAPABILITY_REMOTE_COMMAND_V1,
            OBP_REMOTE_COMMAND,
            json!({}),
        )
        .await;
        assert!(no_link.unwrap_err().starts_with(DEVICE_NOT_ON_LINK));
    }
}

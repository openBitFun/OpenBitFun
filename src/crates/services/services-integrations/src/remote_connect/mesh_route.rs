//! Account-device transport selection for controller-side callers that are
//! not UIs: Detached Dispatch (`dispatch_target_*`) and IM bots
//! (`RemoteCommand` JSON).
//!
//! New devices reach each other over OBP on the account device mesh; older
//! devices only speak the encrypted relay RPC. The host that runs the mesh
//! (the native desktop) installs an [`AccountDeviceMeshRoute`]; callers ask it
//! first and use the legacy relay only when it answers `None` (the target is
//! not a mesh device advertising the required capability, or this host runs
//! no mesh). A mesh device whose call fails reports the failure: a
//! new-to-new pair never falls back to the old relay transport.

use std::future::Future;
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
    /// - `None`: not a mesh route (an older device, or no mesh here); the
    ///   caller uses its legacy transport.
    /// - `Some(Ok(value))`: the command's value.
    /// - `Some(Err(message))`: the device is a mesh device and the call
    ///   failed; the caller reports it and must not retry over the relay.
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

/// Which transport carried a call (for logs and tests).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeviceTransport {
    Mesh,
    LegacyRelay,
}

/// Runs `command` over the mesh when `route` claims the device, otherwise
/// through `legacy` (which receives the original `args`). Returns the value
/// and the transport that carried it.
pub async fn call_mesh_or_legacy<L, Fut>(
    route: Option<Arc<dyn AccountDeviceMeshRoute>>,
    device_id: &str,
    required_capability: &str,
    command: &str,
    args: Value,
    legacy: L,
) -> (Result<Value, String>, DeviceTransport)
where
    L: FnOnce(Value) -> Fut,
    Fut: Future<Output = Result<Value, String>>,
{
    if let Some(route) = route {
        if let Some(result) = route
            .call(device_id, required_capability, command, args.clone())
            .await
        {
            return (result, DeviceTransport::Mesh);
        }
    }
    (legacy(args).await, DeviceTransport::LegacyRelay)
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
    async fn new_devices_never_touch_the_legacy_transport() {
        let mesh = Arc::new(FakeMesh {
            calls: AtomicUsize::new(0),
        });
        let route: Arc<dyn AccountDeviceMeshRoute> = mesh.clone();
        let (value, transport) = call_mesh_or_legacy(
            Some(route.clone()),
            "new-mac",
            CAPABILITY_REMOTE_COMMAND_V1,
            OBP_REMOTE_COMMAND,
            json!({"command": {"cmd": "get_workspace_info"}}),
            |_| async { panic!("a new device must never use the legacy relay") },
        )
        .await;
        assert_eq!(transport, DeviceTransport::Mesh);
        assert_eq!(value.unwrap()["via"], "mesh");

        // A failing mesh call is reported, never retried over the relay.
        let (failed, transport) = call_mesh_or_legacy(
            Some(route),
            "new-broken",
            CAPABILITY_REMOTE_COMMAND_V1,
            OBP_REMOTE_COMMAND,
            json!({}),
            |_| async { panic!("a failed mesh call must not fall back to the relay") },
        )
        .await;
        assert_eq!(transport, DeviceTransport::Mesh);
        assert!(failed.unwrap_err().starts_with("mesh_unreachable"));
        assert_eq!(mesh.calls.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn old_devices_and_hosts_without_a_mesh_keep_the_relay() {
        let route: Arc<dyn AccountDeviceMeshRoute> = Arc::new(FakeMesh {
            calls: AtomicUsize::new(0),
        });
        let (value, transport) = call_mesh_or_legacy(
            Some(route),
            "old-pc",
            CAPABILITY_REMOTE_COMMAND_V1,
            OBP_REMOTE_COMMAND,
            json!({"x": 1}),
            |args| async move { Ok(json!({"via": "relay", "args": args})) },
        )
        .await;
        assert_eq!(transport, DeviceTransport::LegacyRelay);
        assert_eq!(value.unwrap()["args"]["x"], 1);

        let (_, transport) = call_mesh_or_legacy(
            None,
            "new-mac",
            CAPABILITY_REMOTE_COMMAND_V1,
            OBP_REMOTE_COMMAND,
            json!({}),
            |_| async { Ok(Value::Null) },
        )
        .await;
        assert_eq!(transport, DeviceTransport::LegacyRelay);
    }
}

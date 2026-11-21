//! Account-device transport for the dispatch controller.
//!
//! A controller host routes `dispatch_target_*` verbs to an account device
//! over OBP on OpenBitFun Link (the installed [`AccountDeviceMeshRoute`]); the
//! target must advertise `dispatch_target_v1`. A device that is not on Link
//! with that capability (offline, or an OpenBitFun version older than 2.0)
//! gets an explicit `device_not_on_link` error: 2.0 has no relay transport.
//! The agent-identity dialect translation lives here so every caller applies
//! the same translation.

use std::sync::Arc;

use async_trait::async_trait;
use openbitfun_core_types::agent_identity_wire::{
    translate_agent_identity_command, translate_agent_identity_response, AgentIdentityDialect,
};
use openbitfun_services_integrations::remote_connect::mesh_route::{
    call_mesh, mesh_route, AccountDeviceMeshRoute, CAPABILITY_DISPATCH_TARGET_V1,
};
use serde_json::Value;

use super::DeviceDispatchRpc;
use crate::service::remote_connect::account_runtime::AccountRuntime;

/// The arguments a target receives for one dispatch verb (the target dialect).
pub fn device_dispatch_wire_args(command: &str, args: Value) -> anyhow::Result<Value> {
    translate_agent_identity_command(command, args, AgentIdentityDialect::Legacy)
        .map_err(anyhow::Error::msg)
}

/// A target's value for one dispatch verb, translated back to the canonical
/// dialect.
pub fn device_dispatch_wire_value(command: &str, value: Value) -> anyhow::Result<Value> {
    translate_agent_identity_response(
        command,
        value,
        &Value::Null,
        AgentIdentityDialect::Canonical,
    )
    .map_err(anyhow::Error::msg)
}

/// Runs one dispatch verb on `device_id` over the device mesh (`route`,
/// `dispatch_target_v1`). Errors are reported, never retried elsewhere.
pub async fn invoke_device_dispatch(
    route: Option<Arc<dyn AccountDeviceMeshRoute>>,
    device_id: &str,
    command: &str,
    args: Value,
) -> anyhow::Result<Value> {
    let wire_args = device_dispatch_wire_args(command, args)?;
    let value = call_mesh(
        route,
        device_id,
        CAPABILITY_DISPATCH_TARGET_V1,
        command,
        wire_args,
    )
    .await
    .map_err(anyhow::Error::msg)?;
    device_dispatch_wire_value(command, value)
}

/// Device dispatch for a host whose account session is held by an
/// [`AccountRuntime`]. The mesh route carries the account identity itself;
/// the runtime is only checked so a signed-out host refuses early.
pub struct AccountRuntimeDeviceDispatchRpc {
    account: Arc<AccountRuntime>,
}

impl AccountRuntimeDeviceDispatchRpc {
    pub fn new(account: Arc<AccountRuntime>) -> Self {
        Self { account }
    }
}

#[async_trait]
impl DeviceDispatchRpc for AccountRuntimeDeviceDispatchRpc {
    async fn invoke(&self, device_id: &str, command: &str, args: Value) -> anyhow::Result<Value> {
        if !self.account.is_logged_in().await {
            anyhow::bail!("account_required: sign in to OpenBitFun before dispatching to a device");
        }
        invoke_device_dispatch(mesh_route(), device_id, command, args).await
    }
}

/// Device dispatch over the installed mesh route alone, for a host that
/// dials another device on its own behalf (peer import: a target pulling a
/// job result from the source device). Signed out, the route is absent and
/// the call answers `device_not_on_link`.
pub struct MeshDeviceDispatchRpc;

#[async_trait]
impl DeviceDispatchRpc for MeshDeviceDispatchRpc {
    async fn invoke(&self, device_id: &str, command: &str, args: Value) -> anyhow::Result<Value> {
        invoke_device_dispatch(mesh_route(), device_id, command, args).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use openbitfun_services_integrations::remote_connect::mesh_route::DEVICE_NOT_ON_LINK;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// Mesh devices are `new-*`; they advertise `dispatch_target_v1` unless
    /// named `new-nodispatch`.
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
            if !device_id.starts_with("new-") || device_id == "new-nodispatch" {
                return None;
            }
            assert_eq!(required_capability, CAPABILITY_DISPATCH_TARGET_V1);
            self.calls.fetch_add(1, Ordering::SeqCst);
            if device_id == "new-offline" {
                return Some(Err("mesh_unreachable: new-offline did not answer".into()));
            }
            Some(Ok(
                serde_json::json!({ "protocolVersion": 6, "command": command, "echo": args }),
            ))
        }
    }

    fn route() -> (Arc<FakeMesh>, Option<Arc<dyn AccountDeviceMeshRoute>>) {
        let mesh = Arc::new(FakeMesh {
            calls: AtomicUsize::new(0),
        });
        let route: Arc<dyn AccountDeviceMeshRoute> = mesh.clone();
        (mesh, Some(route))
    }

    #[tokio::test]
    async fn dispatch_runs_over_the_mesh_in_the_target_dialect() {
        let (mesh, route) = route();
        let args = serde_json::json!({ "workspacePath": "/w" });
        let value = invoke_device_dispatch(
            route.clone(),
            "new-mac",
            "dispatch_target_probe",
            args.clone(),
        )
        .await
        .unwrap();
        assert_eq!(value["protocolVersion"], 6);
        assert_eq!(value["command"], "dispatch_target_probe");
        assert_eq!(
            value["echo"],
            device_dispatch_wire_args("dispatch_target_probe", args).unwrap()
        );

        let error = invoke_device_dispatch(
            route,
            "new-offline",
            "dispatch_target_status",
            serde_json::json!({}),
        )
        .await
        .unwrap_err();
        assert!(error.to_string().starts_with("mesh_unreachable"), "{error}");
        assert_eq!(mesh.calls.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn targets_off_link_get_an_explicit_refusal() {
        let (mesh, route) = route();
        for device in ["old-pc", "new-nodispatch"] {
            let error = invoke_device_dispatch(
                route.clone(),
                device,
                "dispatch_target_probe",
                serde_json::json!({}),
            )
            .await
            .unwrap_err();
            assert!(error.to_string().starts_with(DEVICE_NOT_ON_LINK), "{error}");
        }
        let error = invoke_device_dispatch(
            None,
            "new-mac",
            "dispatch_target_probe",
            serde_json::json!({}),
        )
        .await
        .unwrap_err();
        assert!(error.to_string().starts_with(DEVICE_NOT_ON_LINK), "{error}");
        assert_eq!(mesh.calls.load(Ordering::SeqCst), 0);
    }
}

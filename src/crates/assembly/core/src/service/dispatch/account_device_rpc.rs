//! Account-device transport for the dispatch controller.
//!
//! A controller host routes `dispatch_target_*` verbs to an account device.
//! A new target on the account device mesh that advertises
//! `dispatch_target_v1` runs them over OBP (the installed
//! [`AccountDeviceMeshRoute`]); an older target gets the `host_invoke`
//! envelope over the encrypted Relay RPC. A mesh target whose call fails
//! reports the failure and is never retried over the relay. The host supplies
//! only the transport calls; the envelope and the agent-identity dialect
//! translation live here so both transports apply the same translation.

use std::future::Future;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use openbitfun_core_types::agent_identity_wire::{
    translate_agent_identity_command, translate_agent_identity_response, AgentIdentityDialect,
};
use openbitfun_services_integrations::remote_connect::mesh_route::{
    mesh_route, AccountDeviceMeshRoute, CAPABILITY_DISPATCH_TARGET_V1,
};
use serde_json::Value;

use super::DeviceDispatchRpc;
use crate::service::remote_connect::account_runtime::AccountRuntime;
use crate::service::remote_connect::AccountClient;

const DEVICE_DISPATCH_RPC_TIMEOUT: Duration = Duration::from_secs(120);

/// The arguments a target receives for one dispatch verb (the target dialect),
/// whichever transport carries them.
pub fn device_dispatch_wire_args(command: &str, args: Value) -> anyhow::Result<Value> {
    translate_agent_identity_command(command, args, AgentIdentityDialect::Legacy)
        .map_err(anyhow::Error::msg)
}

/// A target's value for one dispatch verb, translated back to the canonical
/// dialect, whichever transport carried it.
pub fn device_dispatch_wire_value(command: &str, value: Value) -> anyhow::Result<Value> {
    translate_agent_identity_response(
        command,
        value,
        &Value::Null,
        AgentIdentityDialect::Canonical,
    )
    .map_err(anyhow::Error::msg)
}

/// Encode one dispatch verb as the plaintext `host_invoke` RPC command.
pub fn encode_device_dispatch_command(command: &str, args: Value) -> anyhow::Result<String> {
    let args = device_dispatch_wire_args(command, args)?;
    Ok(serde_json::to_string(&serde_json::json!({
        "cmd": "host_invoke",
        "command": command,
        "args": args,
    }))?)
}

/// Runs one dispatch verb on `device_id`: over the mesh when `route` claims
/// the device (`dispatch_target_v1`), otherwise through `legacy_rpc`, which
/// receives the `host_invoke` envelope and returns the raw relay reply.
pub async fn invoke_device_dispatch<L, Fut>(
    route: Option<Arc<dyn AccountDeviceMeshRoute>>,
    device_id: &str,
    command: &str,
    args: Value,
    legacy_rpc: L,
) -> anyhow::Result<Value>
where
    L: FnOnce(String) -> Fut,
    Fut: Future<Output = anyhow::Result<String>>,
{
    let wire_args = device_dispatch_wire_args(command, args)?;
    if let Some(route) = route {
        if let Some(result) = route
            .call(
                device_id,
                CAPABILITY_DISPATCH_TARGET_V1,
                command,
                wire_args.clone(),
            )
            .await
        {
            let value = result.map_err(anyhow::Error::msg)?;
            return device_dispatch_wire_value(command, value);
        }
    }
    let command_json = serde_json::to_string(&serde_json::json!({
        "cmd": "host_invoke",
        "command": command,
        "args": wire_args,
    }))?;
    let raw = legacy_rpc(command_json).await?;
    decode_device_dispatch_response(command, &raw)
}

/// Decode a target's `host_invoke_result` reply for one dispatch verb.
pub fn decode_device_dispatch_response(command: &str, raw: &str) -> anyhow::Result<Value> {
    let envelope: Value =
        serde_json::from_str(raw).map_err(|error| anyhow::anyhow!("decode device RPC: {error}"))?;
    let value = match envelope.get("resp").and_then(Value::as_str) {
        Some("host_invoke_result") if envelope.get("ok").and_then(Value::as_bool) == Some(true) => {
            envelope.get("value").cloned().unwrap_or(Value::Null)
        }
        Some("host_invoke_result") => anyhow::bail!(
            "{}",
            envelope
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("Device dispatch target rejected the command")
        ),
        Some("error") => anyhow::bail!(
            "{}",
            envelope
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("Device dispatch RPC failed")
        ),
        _ => anyhow::bail!("Device dispatch target returned an unexpected RPC envelope"),
    };
    device_dispatch_wire_value(command, value)
}

/// Device dispatch over the account session held by an [`AccountRuntime`].
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
        invoke_device_dispatch(
            mesh_route(),
            device_id,
            command,
            args,
            |command_json| async move {
                let generation = self.account.account_context_generation();
                let (session, relay_url) = self
                    .account
                    .read_account_context_for_generation(generation)
                    .await?;
                let raw = tokio::time::timeout(
                    DEVICE_DISPATCH_RPC_TIMEOUT,
                    AccountClient::new().device_rpc(&relay_url, &session, device_id, &command_json),
                )
                .await
                .map_err(|_| {
                    anyhow::anyhow!(
                        "device RPC timed out after {}ms",
                        DEVICE_DISPATCH_RPC_TIMEOUT.as_millis()
                    )
                })??;
                if !self.account.account_context_is_current(generation) {
                    anyhow::bail!("account context changed");
                }
                Ok(raw)
            },
        )
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// Mesh devices are `new-*`; they advertise `dispatch_target_v1` unless
    /// named `new-nodispatch` (a mesh build before the verb moved to OBP).
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
    async fn new_to_new_dispatch_never_touches_the_relay() {
        let (mesh, route) = route();
        let value = invoke_device_dispatch(
            route.clone(),
            "new-mac",
            "dispatch_target_probe",
            serde_json::json!({ "workspacePath": "/w" }),
            |_| async { panic!("new-to-new dispatch touched the legacy relay RPC") },
        )
        .await
        .unwrap();
        assert_eq!(value["protocolVersion"], 6);
        assert_eq!(value["command"], "dispatch_target_probe");
        // The mesh target receives the same arguments the relay envelope carries.
        let envelope: Value = serde_json::from_str(
            &encode_device_dispatch_command(
                "dispatch_target_probe",
                serde_json::json!({ "workspacePath": "/w" }),
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(value["echo"], envelope["args"]);

        let error = invoke_device_dispatch(
            route,
            "new-offline",
            "dispatch_target_status",
            serde_json::json!({}),
            |_| async { panic!("a failed mesh call fell back to the legacy relay RPC") },
        )
        .await
        .unwrap_err();
        assert!(error.to_string().starts_with("mesh_unreachable"), "{error}");
        assert_eq!(mesh.calls.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn old_targets_keep_the_host_invoke_envelope() {
        let (mesh, route) = route();
        for device in ["old-pc", "new-nodispatch"] {
            let relayed = AtomicUsize::new(0);
            let value = invoke_device_dispatch(
                route.clone(),
                device,
                "dispatch_target_probe",
                serde_json::json!({}),
                |command_json| {
                    relayed.fetch_add(1, Ordering::SeqCst);
                    async move {
                        let envelope: Value = serde_json::from_str(&command_json)?;
                        assert_eq!(envelope["cmd"], "host_invoke");
                        assert_eq!(envelope["command"], "dispatch_target_probe");
                        Ok(r#"{"resp":"host_invoke_result","ok":true,"value":{"protocolVersion":5}}"#
                            .to_string())
                    }
                },
            )
            .await
            .unwrap();
            assert_eq!(value["protocolVersion"], 5);
            assert_eq!(relayed.load(Ordering::SeqCst), 1, "{device}");
        }
        // Without a mesh on this host every target is legacy.
        let value = invoke_device_dispatch(
            None,
            "new-mac",
            "dispatch_target_probe",
            serde_json::json!({}),
            |_| async {
                Ok(
                    r#"{"resp":"host_invoke_result","ok":true,"value":{"protocolVersion":5}}"#
                        .to_string(),
                )
            },
        )
        .await
        .unwrap();
        assert_eq!(value["protocolVersion"], 5);
        assert_eq!(mesh.calls.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn device_dispatch_envelope_round_trips_success_and_errors() {
        let encoded =
            encode_device_dispatch_command("dispatch_target_probe", serde_json::json!({})).unwrap();
        let encoded: Value = serde_json::from_str(&encoded).unwrap();
        assert_eq!(encoded["cmd"], "host_invoke");
        assert_eq!(encoded["command"], "dispatch_target_probe");

        let ok = decode_device_dispatch_response(
            "dispatch_target_probe",
            r#"{"resp":"host_invoke_result","ok":true,"value":{"protocolVersion":6}}"#,
        )
        .unwrap();
        assert_eq!(ok["protocolVersion"], 6);

        let rejected = decode_device_dispatch_response(
            "dispatch_target_probe",
            r#"{"resp":"host_invoke_result","ok":false,"error":"busy"}"#,
        )
        .unwrap_err();
        assert_eq!(rejected.to_string(), "busy");

        let failed = decode_device_dispatch_response(
            "dispatch_target_probe",
            r#"{"resp":"error","message":"offline"}"#,
        )
        .unwrap_err();
        assert_eq!(failed.to_string(), "offline");

        assert!(
            decode_device_dispatch_response("dispatch_target_probe", r#"{"resp":"other"}"#)
                .is_err()
        );
    }
}

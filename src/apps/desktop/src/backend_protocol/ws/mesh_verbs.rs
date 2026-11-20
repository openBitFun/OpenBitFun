//! Same-account host verbs over the account mesh.
//!
//! Besides registry `Proxied` commands, an `account-device` connection (and
//! only that scope, see `scope::check_command`) may run the host verbs a
//! same-account device ran over the legacy relay RPC:
//!
//! - the detached-dispatch target verbs (`dispatch_target_*`), executed by
//!   the same durable CLI runner as the relay `host_invoke` path
//!   (`api::dispatch_host`), advertised as `dispatch_target_v1`;
//! - `obp_remote_command`: one `RemoteCommand` (the IM bot protocol) run by
//!   the same generic dispatcher as a relay RPC, answering its
//!   `RemoteResponse`, advertised as `remote_command_v1`.
//!
//! A controller negotiates them through the mesh capabilities, so an older
//! target keeps its relay path and a new-to-new pair never uses the relay.

use openbitfun_services_integrations::remote_connect::mesh_route::{
    CAPABILITY_DISPATCH_TARGET_V1, CAPABILITY_REMOTE_COMMAND_V1, OBP_REMOTE_COMMAND,
};
use serde_json::Value;

use super::ObpDispatchFuture;

/// The capabilities these verbs add to an `account-device` connection.
pub(crate) const CAPABILITIES: &[&str] =
    &[CAPABILITY_DISPATCH_TARGET_V1, CAPABILITY_REMOTE_COMMAND_V1];

/// Whether `command` is a same-account host verb served on the mesh.
pub(crate) fn is_account_device_host_verb(command: &str) -> bool {
    command == OBP_REMOTE_COMMAND || crate::api::dispatch_host::is_target_command(command)
}

/// Runs a host verb; `None` for any other command (the generated dispatch
/// runs it).
pub(crate) fn route(command: &str, args: Value) -> Option<ObpDispatchFuture> {
    if command == OBP_REMOTE_COMMAND {
        return Some(Box::pin(remote_command(args)));
    }
    if crate::api::dispatch_host::is_target_command(command) {
        let command = command.to_string();
        return Some(Box::pin(async move {
            crate::api::dispatch_host::dispatch(&command, args)
                .await
                .map_err(|error| format!("{error:#}"))
        }));
    }
    None
}

/// The `RemoteCommand` an `obp_remote_command` call carries, refusing the
/// variants that have their own OBP form.
fn parse_remote_command(
    args: Value,
) -> Result<openbitfun_core::service::remote_connect::remote_server::RemoteCommand, String> {
    use openbitfun_core::service::remote_connect::remote_server::RemoteCommand;
    let command = match args {
        Value::Object(mut object) => object.remove("command").unwrap_or(Value::Null),
        _ => Value::Null,
    };
    if command.is_null() {
        return Err(format!(
            "{OBP_REMOTE_COMMAND} needs {{\"command\": <RemoteCommand>}}"
        ));
    }
    let command: RemoteCommand = serde_json::from_value(command)
        .map_err(|error| format!("{OBP_REMOTE_COMMAND}: unreadable RemoteCommand: {error}"))?;
    match command {
        RemoteCommand::HostInvoke { .. } => Err(format!(
            "{OBP_REMOTE_COMMAND}: host_invoke is not carried here; send the product command as an OBP call"
        )),
        RemoteCommand::DeviceEvent { .. } => Err(format!(
            "{OBP_REMOTE_COMMAND}: device events are not carried here; OBP streams events"
        )),
        other => Ok(other),
    }
}

async fn remote_command(args: Value) -> Result<Value, String> {
    let command = parse_remote_command(args)?;
    // The generic dispatcher of the relay RPC; the shared secret is unused
    // because nothing is encrypted at this level (TLS + the device handshake
    // protect the mesh connection).
    let server = openbitfun_core::service::remote_connect::RemoteServer::new([0u8; 32]);
    let response = server.dispatch(&command).await;
    serde_json::to_value(&response).map_err(|error| format!("serialize RemoteResponse: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn host_verbs_are_recognized() {
        assert!(is_account_device_host_verb("obp_remote_command"));
        assert!(is_account_device_host_verb("dispatch_target_probe"));
        assert!(is_account_device_host_verb(
            "dispatch_target_workspace_bundle_chunk"
        ));
        assert!(!is_account_device_host_verb("dispatch_target_nope"));
        assert!(!is_account_device_host_verb("open_workspace"));
        assert!(route("open_workspace", json!({})).is_none());
        assert!(route("dispatch_target_probe", json!({})).is_some());
    }

    #[tokio::test]
    async fn remote_commands_refuse_forms_with_their_own_obp_lane() {
        let refused = route(
            OBP_REMOTE_COMMAND,
            json!({"command": {"cmd": "host_invoke", "command": "list_sessions", "args": {}}}),
        )
        .unwrap()
        .await
        .unwrap_err();
        assert!(
            refused.contains("host_invoke is not carried here"),
            "{refused}"
        );
        let missing = route(OBP_REMOTE_COMMAND, json!({})).unwrap().await;
        assert!(missing.unwrap_err().contains("needs"));
        let unreadable = route(OBP_REMOTE_COMMAND, json!({"command": {"cmd": "no_such"}}))
            .unwrap()
            .await;
        assert!(unreadable.unwrap_err().contains("unreadable RemoteCommand"));
        assert!(parse_remote_command(json!({"command": {"cmd": "get_workspace_info"}})).is_ok());
    }
}

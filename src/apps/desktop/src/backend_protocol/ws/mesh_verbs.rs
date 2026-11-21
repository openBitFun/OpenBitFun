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
//! - the model relay `fleet_model_*` for the account's cloud agent (only its
//!   `cloud-agent` connection may call it), advertised as `fleet_model_v1`;
//! - the fleet owner verbs `fleet_digest` / `fleet_replay` (another runtime
//!   host replicating this one), answered by `crate::fleet`, advertised as
//!   `fleet_v1` while the fleet runs.
//!
//! A controller negotiates them through the mesh capabilities, so an older
//! target keeps its relay path and a new-to-new pair never uses the relay.

use openbitfun_core::service::superagent_relay;
use openbitfun_services_integrations::remote_connect::mesh_route::{
    CAPABILITY_DISPATCH_TARGET_V1, CAPABILITY_REMOTE_COMMAND_V1, OBP_REMOTE_COMMAND,
};
use serde_json::Value;

use super::ObpDispatchFuture;

/// The capabilities these verbs add to an `account-device` connection.
pub(crate) const CAPABILITIES: &[&str] = &[
    CAPABILITY_DISPATCH_TARGET_V1,
    CAPABILITY_REMOTE_COMMAND_V1,
    superagent_relay::FLEET_MODEL_CAPABILITY,
];

/// The capabilities advertised now: [`CAPABILITIES`], plus `fleet_v1` while
/// this host's fleet runs (it then serves the owner verbs).
pub(crate) fn capabilities() -> Vec<&'static str> {
    let mut capabilities = CAPABILITIES.to_vec();
    if let Some(host) = crate::fleet::current() {
        capabilities.push(openbitfun_product_domains::fleet::FLEET_V1_CAPABILITY);
        // The account replica's verbs (`fleet::replica`), once attached.
        if host.replica_sync().is_some() {
            capabilities.push(openbitfun_obp::fleet::replica::ACCOUNT_REPLICA_V1_CAPABILITY);
            // Super Agent history (`fleet::superagent_archive`): the replica
            // declares it and serves the cloud agent its collections only.
            capabilities.push(
                openbitfun_product_domains::superagent::archive::SUPERAGENT_ARCHIVE_CAPABILITY,
            );
        }
    }
    capabilities
}

/// Whether `command` is a same-account host verb served on the mesh.
pub(crate) fn is_account_device_host_verb(command: &str) -> bool {
    command == OBP_REMOTE_COMMAND
        || crate::api::dispatch_host::is_target_command(command)
        || openbitfun_obp::fleet::host::is_fleet_owner_verb(command)
        || superagent_relay::is_fleet_model_command(command)
}

/// Runs a host verb; `None` for any other command (the generated dispatch
/// runs it).
pub(crate) fn route(command: &str, args: Value) -> Option<ObpDispatchFuture> {
    if command == OBP_REMOTE_COMMAND {
        return Some(Box::pin(remote_command(args)));
    }
    // The model relay for the account's cloud agent (the OBP scope admits it
    // for `cloud-agent` connections only).
    if superagent_relay::is_fleet_model_command(command) {
        let command = command.to_string();
        return Some(Box::pin(async move {
            superagent_relay::global_relay()
                .handle(&command, args)
                .await
        }));
    }
    if openbitfun_obp::fleet::host::is_fleet_owner_verb(command) {
        return Some(Box::pin(crate::fleet::fleet_api::owner_verb(
            command.to_string(),
            args,
        )));
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
        assert!(is_account_device_host_verb("fleet_digest"));
        assert!(is_account_device_host_verb("fleet_replay"));
        assert!(!is_account_device_host_verb("fleet_navigator"));
        assert!(route("fleet_digest", json!({})).is_some());
        assert!(is_account_device_host_verb("fleet_model_start"));
        assert!(route("fleet_model_poll", json!({})).is_some());
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

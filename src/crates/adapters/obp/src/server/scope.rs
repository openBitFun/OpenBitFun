//! Connection scopes and the registry-driven allowlist.
//!
//! `owner` (a loopback client holding the per-launch token) runs every command
//! the in-process UI runs and receives every event. `paired-client` (a phone
//! or browser on the account mesh holding a revocable QR credential) and `account-device` (another
//! device of the same account over the mesh, authenticated with the device
//! key handshake) run only commands the Product Operation Registry marks
//! `Proxied`, and never receive owner-only events (account, window, tray,
//! updater, mesh). See
//! `docs/architecture/unified-client-architecture.md` ("Scopes").

use openbitfun_product_domains::remote_surface::{
    event_stance, operation, retired_reason, EventStance, OperationSurface, PeerStance,
};

/// The authority one connection was granted at its upgrade.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Scope {
    Owner,
    PairedClient {
        client_id: String,
    },
    /// Another device of the signed-in account, over the mesh listener.
    AccountDevice {
        device_id: String,
    },
}

impl Scope {
    pub fn wire_name(&self) -> &'static str {
        match self {
            Self::Owner => "owner",
            Self::PairedClient { .. } => "paired-client",
            Self::AccountDevice { .. } => "account-device",
        }
    }

    pub fn is_owner(&self) -> bool {
        matches!(self, Self::Owner)
    }
}

/// Whether `scope` may run `command`; the refusal text otherwise.
/// `host_verb` names the same-account host verbs the backend serves
/// (`ObpBackend::is_account_device_host_verb`).
pub fn check_command(
    scope: &Scope,
    command: &str,
    host_verb: &dyn Fn(&str) -> bool,
) -> Result<(), String> {
    if scope.is_owner() {
        return Ok(());
    }
    if command.is_empty() {
        return Err("forbidden_for_scope: the command name is empty".to_string());
    }
    if let Some(reason) = retired_reason(command) {
        return Err(format!(
            "command '{command}' is unsupported because {reason}"
        ));
    }
    let Some(definition) = operation(command) else {
        return Err(format!(
            "forbidden_for_scope: command '{command}' is unknown to this OpenBitFun backend version; update the backend or check the command name"
        ));
    };
    // Same-account host verbs (detached dispatch targets, the bot
    // `RemoteCommand` lane, `ws::mesh_verbs`) keep the trust boundary of the
    // legacy relay `host_invoke`: another device of this account only, never
    // a paired client. `obp_remote_command` is `OperatorOnly` in the registry
    // because legacy peer hosts refuse it; only this listener admits it.
    if matches!(scope, Scope::AccountDevice { .. })
        && definition.surface == OperationSurface::HostInvokeOnly
        && matches!(
            definition.peer,
            PeerStance::HostControlPlane | PeerStance::OperatorOnly
        )
        && host_verb(command)
    {
        return Ok(());
    }
    if definition.surface != OperationSurface::TauriCommand {
        return Err(format!(
            "forbidden_for_scope: command '{command}' is not a backend command"
        ));
    }
    match definition.peer {
        PeerStance::Proxied => Ok(()),
        PeerStance::ControllerLocal | PeerStance::OperatorOnly | PeerStance::HostControlPlane => {
            Err(format!(
                "forbidden_for_scope: command '{command}' runs only for the backend owner on that machine"
            ))
        }
        PeerStance::Retired { reason } => Err(format!(
            "command '{command}' is unsupported because {reason}"
        )),
    }
}

/// Whether `scope` receives `event`.
pub fn event_visible(scope: &Scope, event: &str) -> bool {
    scope.is_owner() || event_stance(event) == EventStance::Proxied
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The desktop's host verbs (dispatch targets and the bot lane).
    fn desktop_verbs(command: &str) -> bool {
        command == "obp_remote_command" || command.starts_with("dispatch_target_")
    }

    fn check(scope: &Scope, command: &str) -> Result<(), String> {
        check_command(scope, command, &desktop_verbs)
    }

    #[test]
    fn owner_runs_everything_and_paired_clients_follow_the_registry() {
        let paired = Scope::PairedClient {
            client_id: "c1".into(),
        };
        assert!(check(&Scope::Owner, "account_delete_device").is_ok());
        assert!(check(&Scope::Owner, "anything_at_all").is_ok());
        let error = check(&paired, "account_delete_device").unwrap_err();
        assert!(error.starts_with("forbidden_for_scope:"), "{error}");
        // The pairing commands themselves are owner-only.
        assert!(check(&paired, "obp_create_pairing").is_err());
        assert!(check(&paired, "no_such_command").is_err());
        assert!(check(&paired, "open_workspace").is_ok());
    }

    #[test]
    fn account_devices_follow_the_registry_like_paired_clients() {
        let device = Scope::AccountDevice {
            device_id: "d1".into(),
        };
        assert_eq!(device.wire_name(), "account-device");
        assert!(check(&device, "open_workspace").is_ok());
        assert!(check(&device, "obp_get_status").is_err());
        // The retired LAN switch is refused with its retirement reason.
        let retired = check(&device, "obp_set_lan_enabled").unwrap_err();
        assert!(retired.contains("unsupported because"), "{retired}");
        assert!(check(&device, "mesh_status").is_err());
        assert!(!event_visible(&device, "account://login-state"));
        assert!(!event_visible(&device, "mesh://status-changed"));
        assert!(event_visible(&device, "agentic://text-chunk"));
        // Same-account host verbs: account devices only.
        assert!(check(&device, "dispatch_target_probe").is_ok());
        assert!(check(&device, "obp_remote_command").is_ok());
        assert!(check(&device, "peer_mode_ping").is_err());
        let paired = Scope::PairedClient {
            client_id: "c1".into(),
        };
        assert!(check(&paired, "dispatch_target_probe").is_err());
        assert!(check(&paired, "obp_remote_command").is_err());
    }

    #[test]
    fn owner_only_events_never_reach_paired_clients() {
        let paired = Scope::PairedClient {
            client_id: "c1".into(),
        };
        assert!(event_visible(&Scope::Owner, "account://login-state"));
        assert!(!event_visible(&paired, "account://login-state"));
        assert!(!event_visible(&paired, "window://fullscreen-chrome"));
        assert!(event_visible(&paired, "agentic://text-chunk"));
    }
}

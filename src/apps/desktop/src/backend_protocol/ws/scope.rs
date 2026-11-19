//! Connection scopes and the registry-driven allowlist.
//!
//! `owner` (a loopback client holding the per-launch token) runs every command
//! the in-process UI runs and receives every event. `paired-client` (a LAN
//! client holding a revocable QR credential) runs only commands the Product
//! Operation Registry marks `Proxied`, and never receives owner-only events
//! (account, window, tray, updater). See
//! `docs/architecture/unified-client-architecture.md` ("Scopes").

use openbitfun_product_domains::remote_surface::{
    event_stance, operation, retired_reason, EventStance, OperationSurface, PeerStance,
};

/// The authority one connection was granted at its upgrade.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Scope {
    Owner,
    PairedClient { client_id: String },
}

impl Scope {
    pub fn wire_name(&self) -> &'static str {
        match self {
            Self::Owner => "owner",
            Self::PairedClient { .. } => "paired-client",
        }
    }

    pub fn is_owner(&self) -> bool {
        matches!(self, Self::Owner)
    }
}

/// Whether `scope` may run `command`; the refusal text otherwise.
pub(crate) fn check_command(scope: &Scope, command: &str) -> Result<(), String> {
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
pub(crate) fn event_visible(scope: &Scope, event: &str) -> bool {
    scope.is_owner() || event_stance(event) == EventStance::Proxied
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn owner_runs_everything_and_paired_clients_follow_the_registry() {
        let paired = Scope::PairedClient {
            client_id: "c1".into(),
        };
        assert!(check_command(&Scope::Owner, "account_delete_device").is_ok());
        assert!(check_command(&Scope::Owner, "anything_at_all").is_ok());
        let error = check_command(&paired, "account_delete_device").unwrap_err();
        assert!(error.starts_with("forbidden_for_scope:"), "{error}");
        // The pairing commands themselves are owner-only.
        assert!(check_command(&paired, "obp_create_pairing").is_err());
        assert!(check_command(&paired, "no_such_command").is_err());
        assert!(check_command(&paired, "open_workspace").is_ok());
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

//! CLI Peer Device Mode host.
//!
//! Controllers (a desktop's Peer Device Mode, the phone app, a browser) reach
//! this process over OBP on OpenBitFun Link (`crate::obp_host`): calls run
//! the registry-derived handlers ([`handle_obp_call`]) and events go to the
//! host's own OBP event ring. Execution goes through Core services (no
//! webview).

mod args;
mod bootstrap;
mod commands;
#[cfg(test)]
mod deny;
mod dispatch;
mod fanout;
mod state;
mod workspace_dto;

pub(crate) use bootstrap::ensure_peer_host_ready;
pub(crate) use dispatch::{handle_obp_call, is_dispatch_target_command};
// The fleet digest reads the core owners through this state (`fleet_host`).
pub(crate) use state::try_peer_host_state;

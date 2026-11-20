// OpenBitFun fork: the CLI completion helpers (clap), the management/web
// console modules and the upstream integration test suite (it needs TUN and
// Linux network namespaces) are removed; see ../OPENBITFUN-PATCH.md.

mod arch;
mod gateway;
mod host_runtime;
pub mod instance;
mod vpn_portal;

pub mod common;
#[cfg(feature = "upnp")]
pub(crate) mod igd_next;
pub mod openbitfun;
pub mod proto;
pub(crate) mod socket;
pub mod socket_protector;
pub mod tunnel;
pub mod utils;

pub const VERSION: &str = common::constants::EASYTIER_VERSION;
rust_i18n::i18n!("locales", fallback = "en");

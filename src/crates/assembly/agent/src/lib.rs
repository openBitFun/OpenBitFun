//! Shared production record projections and in-process agent assembly.
pub mod records;

#[cfg(feature = "local")]
mod local;
#[cfg(feature = "local")]
mod read;
#[cfg(feature = "local")]
mod storage;
#[cfg(feature = "local")]
pub use local::{LocalAgent, LocalSession};
#[cfg(feature = "local")]
pub use openbitfun_ai_adapters::AIConfig;
#[cfg(feature = "local")]
pub use openbitfun_runtime_ports::{PermissionReply, PermissionRequestEvent};
#[cfg(feature = "local")]
pub use tokio_util::sync::CancellationToken;

#[cfg(feature = "permissions")]
pub mod permissions;

#[cfg(feature = "local")]
pub use openbitfun_services_core::session::SessionWriteLockError;

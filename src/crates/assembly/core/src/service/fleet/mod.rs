//! Fleet: this runtime host's own summary partition (the owner side).
//!
//! The replication, index and routing live in `openbitfun-obp` (feature
//! `fleet`); this module only produces the digest every other host pulls
//! with `fleet_digest`, from the existing owners (workspace catalog, session
//! store, Runtime mailbox, Detached Dispatch store), and the account-wide
//! model catalog of this host (`models`): what it publishes, and how a
//! session here runs another device's model.

pub mod digest;
pub mod models;

pub use digest::*;

//! Fleet: this runtime host's own summary partition (the owner side).
//!
//! The replication, index and routing live in `openbitfun-obp` (feature
//! `fleet`); this module only produces the digest every other host pulls
//! with `fleet_digest`, from the existing owners (workspace catalog, session
//! store, Runtime mailbox, Detached Dispatch store).

pub mod digest;

pub use digest::*;

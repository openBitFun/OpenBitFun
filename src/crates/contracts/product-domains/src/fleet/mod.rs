//! Fleet: every runtime host of the account in one display-and-control
//! surface.
//!
//! OpenBitFun is a distributed Agent runtime. Runtime hosts (desktop and CLI)
//! run an Agent runtime and execute work; every other client (browser, phone,
//! IM bots) is display-only. Any client can display and operate any runtime
//! host of the account, and which host executes a session is a backend fact
//! shown as a label, never a mode the user switches into.
//!
//! This module owns the stable wire shapes (`dto`) and the pure decisions
//! (`policy`) every runtime host applies the same way: the navigator and
//! prompt projections, the per-command routing verdict for `fleet_call`, and
//! the ranking of the runtime hosts a frontend-only client connects through.
//! It performs no IO. The per-command routing table lives with the Product
//! Operation Registry (`remote_surface::fleet_routing`).

pub mod account_records;
pub mod attention;
pub mod dto;
pub mod models;
pub mod policy;
pub mod views;

pub use attention::*;
pub use dto::*;
pub use models::*;
pub use policy::*;
pub use views::*;

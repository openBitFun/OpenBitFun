//! OpenBitFun cloud agent (`openbitfun-superagent`).
//!
//! A per-account control-plane node: an input box, a model and a set of
//! management tools over the account's own devices. It runs no tools on this
//! machine and holds no model credentials: model rounds are relayed to an
//! account device (`fleet_model_*`), and every job belongs to the device that
//! runs it (Detached Dispatch). Each account's state lives in an
//! [`slots::Slot`] that loads on demand and unloads when idle, persisted as
//! AES-256-GCM records under a per-account data key ([`store`]).
//!
//! Frontends reach it at `wss://<domain>/agent/obp` over the OBP end-to-end
//! channel (`obp-e2e-v1`), authenticated with the account-device proof
//! ([`obp_server`]); it reaches devices over the account's Link network
//! ([`link_rpc`]) with its own directory key, where devices grant it the
//! cloud-agent scope: the account-device allowlist plus the model relay,
//! under each device's own switches.

pub mod api;
pub mod conversation;
pub mod crypto;
pub mod device;
pub mod directory;
pub mod engine;
pub mod ledger;
pub mod link_rpc;
pub mod model;
pub mod obp_server;
pub mod slots;
pub mod store;
pub mod wire;

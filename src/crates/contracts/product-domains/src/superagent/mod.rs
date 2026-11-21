//! The account's cloud superagent: contract and pure policy.
//!
//! The superagent is a per-account control-plane node (host kind `cloud`,
//! shown as "Super Agent") that plans work with a model and hands it to the
//! account's runtime hosts through Detached Dispatch. It never runs tools on
//! its own machine and never holds model credentials: model rounds are relayed
//! to an account device (`fleet_model_*`), and every job belongs to its target.
//!
//! This module owns what every side of that conversation must agree on, and
//! performs no IO:
//!
//! - `tools`: the closed set of management tools the model may call, with
//!   strict parsing (`deny_unknown_fields`) and the bounds each input must
//!   respect;
//! - `dto`: the frontend-facing shapes (`JobCard`, the job state projection)
//!   and the capability and reason codes;
//! - `policy`: the job state projection and card actions (display), the
//!   dispatch capability gate, and model-holder ranking (infrastructure), as
//!   pure functions.
//!
//! The superagent is an input box, a model and these tools; there is no fixed
//! workflow. The model chooses devices, fans out by calling `fleet_dispatch`
//! more than once, and compares results itself from `fleet_job_result`.
//! Frontends only display what the cloud node projects.

pub mod archive;
pub mod dto;
pub mod policy;
pub mod tools;

pub use dto::*;
pub use policy::*;
pub use tools::*;

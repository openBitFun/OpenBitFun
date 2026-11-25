//! Configuration types for the terminal module

#[cfg(windows)]
mod session_path;
mod types;

#[cfg(windows)]
pub(crate) use session_path::*;
pub use types::*;

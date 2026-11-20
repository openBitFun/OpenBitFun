//! Browser-engine adapter of the desktop backend: translates the CDP-shaped
//! primitives of `openbitfun-core`'s `BrowserActions` onto a host-supplied web
//! view actuator (the native NSH shell's web views; see [`actuated`]).
//!
//! The embedded WebDriver server that drove the retired Tauri WebView lived
//! here until the native desktop host replaced it.

pub mod actuated;

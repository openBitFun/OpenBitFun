mod ai_config;
pub(super) mod commands;
#[cfg(windows)]
mod elevation;
mod extract;
mod generated_locale_contract;
mod launch;
mod transaction;
mod types;

/// Windows main binary file name. The native desktop package names its NSH
/// runner after the product's legacy (Tauri) executable
/// (`scripts/package-desktop-nsh-windows.mjs`), so shortcuts, the uninstall
/// entry and installs made by earlier releases keep pointing at it.
const MAIN_APP_EXE: &str = "openbitfun-desktop.exe";

#[cfg(target_os = "windows")]
mod registry;
#[cfg(target_os = "windows")]
mod shortcut;

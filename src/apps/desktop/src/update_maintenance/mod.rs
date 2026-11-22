//! Publication of a verified native desktop update package.
//!
//! The native updater (`backend_protocol/native_commands/update.rs`) owns
//! discovery, download and minisign verification; this module owns the macOS
//! bundle replacement, including the administrator authorization fallback.
//! Windows and Linux have no in-place install yet: the updater reports it.

#[cfg(target_os = "macos")]
mod macos;
#[cfg(any(target_os = "macos", test))]
mod publication;

/// Replaces the running native (NSH) desktop bundle with the verified
/// `.app.tar.gz` of a newer one from a file on disk (single unpack pass).
/// The archive's bundle must carry the running executable's name and the NSH
/// UI bundle.
#[cfg(target_os = "macos")]
pub(crate) fn install_native_app_bundle_file(path: &std::path::Path) -> Result<(), String> {
    macos::install_file(path).map_err(|error| error.to_string())
}

//! Locating the bundled EasyTier binaries.

use std::path::{Path, PathBuf};

/// The EasyTier release every OpenBitFun client and relay node runs
/// (`scripts/fetch-easytier.mjs` pins the artifact hashes).
pub const EASYTIER_VERSION: &str = "2.6.4";

#[cfg(windows)]
const CORE_NAME: &str = "easytier-core.exe";
#[cfg(not(windows))]
const CORE_NAME: &str = "easytier-core";
#[cfg(windows)]
const CLI_NAME: &str = "easytier-cli.exe";
#[cfg(not(windows))]
const CLI_NAME: &str = "easytier-cli";

/// `easytier-core` and `easytier-cli` of one installation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EasyTierBinaries {
    pub core: PathBuf,
    pub cli: PathBuf,
}

impl EasyTierBinaries {
    /// The pair inside `dir`, when both files exist.
    pub fn in_dir(dir: &Path) -> Option<Self> {
        let core = dir.join(CORE_NAME);
        let cli = dir.join(CLI_NAME);
        (core.is_file() && cli.is_file()).then_some(Self { core, cli })
    }

    /// `OPENBITFUN_EASYTIER_DIR`, then the packaged app's resources
    /// (`Contents/Resources/bin` on macOS, `bin/` or `resources/bin/` next to
    /// the executable elsewhere), then `extra` (for example the repository's
    /// `target/easytier/<platform>` in development builds).
    pub fn locate(extra: &[PathBuf]) -> Option<Self> {
        let mut candidates = Vec::new();
        if let Some(dir) = std::env::var_os("OPENBITFUN_EASYTIER_DIR") {
            candidates.push(PathBuf::from(dir));
        }
        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                if let Some(contents) = dir.parent() {
                    candidates.push(contents.join("Resources").join("bin"));
                }
                candidates.push(dir.join("bin"));
                candidates.push(dir.join("resources").join("bin"));
            }
        }
        candidates.extend(extra.iter().cloned());
        candidates.iter().find_map(|dir| Self::in_dir(dir))
    }

    /// The platform directory name `scripts/fetch-easytier.mjs` writes.
    pub fn platform_dir_name() -> Option<&'static str> {
        match (std::env::consts::OS, std::env::consts::ARCH) {
            ("macos", "aarch64") => Some("macos-aarch64"),
            ("macos", "x86_64") => Some("macos-x86_64"),
            ("windows", "x86_64") => Some("windows-x86_64"),
            ("windows", "aarch64") => Some("windows-arm64"),
            ("linux", "x86_64") => Some("linux-x86_64"),
            ("linux", "aarch64") => Some("linux-aarch64"),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_a_complete_pair_only() {
        let dir = tempfile::tempdir().unwrap();
        assert!(EasyTierBinaries::in_dir(dir.path()).is_none());
        std::fs::write(dir.path().join(CORE_NAME), b"").unwrap();
        assert!(EasyTierBinaries::in_dir(dir.path()).is_none());
        std::fs::write(dir.path().join(CLI_NAME), b"").unwrap();
        let found = EasyTierBinaries::locate(&[dir.path().to_path_buf()]).unwrap();
        assert_eq!(found.core, dir.path().join(CORE_NAME));
    }
}

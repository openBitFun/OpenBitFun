//! Relay server configuration.

use anyhow::Context;
use std::net::SocketAddr;

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub(super) struct RelayConfig {
    pub listen_addr: SocketAddr,
    pub heartbeat_interval_secs: u64,
    pub heartbeat_timeout_secs: u64,
    pub static_dir: Option<String>,
    /// Directory for published Page assets.
    pub asset_dir: String,
    /// Global capacity for content-addressed Page assets.
    pub asset_store_max_bytes: u64,
    pub cors_allow_origins: Vec<String>,
    /// Browser-visible base URL used for published Page content.
    pub page_public_base_url: Option<String>,
    /// Browser-visible base URL used for trusted Relay Page login.
    pub page_auth_base_url: Option<String>,
    /// Path to the SQLite database file used for account storage.
    /// Required at startup; every device connection is account-authenticated.
    pub db_path: Option<String>,
    /// `RELAY_PROFILE=directory`: run as the OpenBitFun 2.0 account
    /// directory (no Pages, periodic retention). Unset: the relay profile.
    pub directory_profile: bool,
}

/// Variables that configure published Pages and their asset store; the
/// directory profile refuses to start with any of them set.
pub(super) const PAGE_ENV_VARS: [&str; 5] = [
    "RELAY_PAGE_PUBLIC_BASE_URL",
    "RELAY_PAGE_AUTH_BASE_URL",
    "RELAY_ASSET_DIR",
    "RELAY_ROOM_WEB_DIR",
    "RELAY_ASSET_STORE_MAX_BYTES",
];

/// Reads `RELAY_PROFILE`: `directory`, or unset / `relay` for the relay.
pub(super) fn directory_profile(lookup: &impl Fn(&str) -> Option<String>) -> anyhow::Result<bool> {
    match lookup("RELAY_PROFILE").as_deref().map(str::trim) {
        None | Some("") | Some("relay") => Ok(false),
        Some("directory") => {
            let set: Vec<&str> = PAGE_ENV_VARS
                .iter()
                .copied()
                .filter(|name| lookup(name).is_some_and(|value| !value.trim().is_empty()))
                .collect();
            if !set.is_empty() {
                anyhow::bail!(
                    "RELAY_PROFILE=directory does not serve published Pages; unset {}",
                    set.join(", ")
                );
            }
            Ok(true)
        }
        Some(other) => anyhow::bail!("RELAY_PROFILE must be relay or directory, got {other:?}"),
    }
}

impl Default for RelayConfig {
    fn default() -> Self {
        Self {
            listen_addr: ([0, 0, 0, 0], 9700).into(),
            heartbeat_interval_secs: 30,
            heartbeat_timeout_secs: 90,
            static_dir: None,
            // Also stores published OpenBitFun Pages under `{asset_dir}/pages/{user_id}/{slug}/`.
            asset_dir: "/tmp/openbitfun-room-web".to_string(),
            asset_store_max_bytes: openbitfun_relay_service::DEFAULT_DISK_ASSET_STORE_MAX_BYTES,
            cors_allow_origins: Vec::new(),
            page_public_base_url: None,
            page_auth_base_url: None,
            db_path: None,
            directory_profile: false,
        }
    }
}

impl RelayConfig {
    pub(super) fn from_env() -> anyhow::Result<Self> {
        let mut cfg = Self {
            directory_profile: directory_profile(&|name| std::env::var(name).ok())?,
            ..Self::default()
        };
        if let Ok(port) = std::env::var("RELAY_PORT") {
            if let Ok(p) = port.parse::<u16>() {
                cfg.listen_addr = ([0, 0, 0, 0], p).into();
            }
        }
        if let Ok(addr) = std::env::var("RELAY_LISTEN_ADDR") {
            cfg.listen_addr = addr
                .parse()
                .context("RELAY_LISTEN_ADDR must be an IP socket address")?;
        }
        if let Ok(dir) = std::env::var("RELAY_STATIC_DIR") {
            cfg.static_dir = Some(dir);
        }
        // Keep the previous storage location readable during upgrades.
        if let Ok(dir) =
            std::env::var("RELAY_ASSET_DIR").or_else(|_| std::env::var("RELAY_ROOM_WEB_DIR"))
        {
            cfg.asset_dir = dir;
        }
        if let Ok(limit) = std::env::var("RELAY_ASSET_STORE_MAX_BYTES") {
            if let Ok(bytes) = limit.parse::<u64>() {
                cfg.asset_store_max_bytes = bytes;
            }
        }
        if let Ok(path) = std::env::var("RELAY_DB_PATH") {
            if path.is_empty() {
                cfg.db_path = None;
            } else {
                cfg.db_path = Some(path);
            }
        }
        if let Ok(origins) = std::env::var("RELAY_CORS_ALLOW_ORIGINS") {
            cfg.cors_allow_origins = origins
                .split(',')
                .map(str::trim)
                .filter(|origin| !origin.is_empty())
                .map(str::to_string)
                .collect();
        }
        cfg.page_public_base_url = std::env::var("RELAY_PAGE_PUBLIC_BASE_URL")
            .ok()
            .filter(|value| !value.trim().is_empty());
        cfg.page_auth_base_url = std::env::var("RELAY_PAGE_AUTH_BASE_URL")
            .ok()
            .filter(|value| !value.trim().is_empty());
        Ok(cfg)
    }
}

#[cfg(test)]
mod tests {
    use super::directory_profile;

    fn lookup(vars: &'static [(&'static str, &'static str)]) -> impl Fn(&str) -> Option<String> {
        move |name| {
            vars.iter()
                .find(|(key, _)| *key == name)
                .map(|(_, value)| value.to_string())
        }
    }

    #[test]
    fn the_directory_profile_is_opt_in_and_refuses_page_configuration() {
        assert!(!directory_profile(&lookup(&[])).unwrap());
        assert!(!directory_profile(&lookup(&[("RELAY_PROFILE", "relay")])).unwrap());
        // The relay profile keeps accepting Page configuration.
        assert!(!directory_profile(&lookup(&[
            ("RELAY_PAGE_PUBLIC_BASE_URL", "https://pages.example.com"),
            ("RELAY_ASSET_DIR", "/srv/assets"),
        ]))
        .unwrap());
        assert!(directory_profile(&lookup(&[("RELAY_PROFILE", "directory")])).unwrap());
        assert!(directory_profile(&lookup(&[
            ("RELAY_PROFILE", "directory"),
            ("RELAY_PAGE_AUTH_BASE_URL", " "),
        ]))
        .unwrap());
        let error = directory_profile(&lookup(&[
            ("RELAY_PROFILE", "directory"),
            ("RELAY_PAGE_PUBLIC_BASE_URL", "https://pages.example.com"),
            ("RELAY_ASSET_DIR", "/srv/assets"),
        ]))
        .unwrap_err()
        .to_string();
        assert!(
            error.contains("RELAY_PAGE_PUBLIC_BASE_URL, RELAY_ASSET_DIR"),
            "{error}"
        );
        assert!(directory_profile(&lookup(&[("RELAY_PROFILE", "pages")])).is_err());
    }
}

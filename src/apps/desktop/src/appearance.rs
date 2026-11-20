//! The light/dark mode MiniApp windows open with.
//!
//! MiniApp windows (the `openbitfun-miniapp-shell` sidecar) start before any
//! UI can tell them the theme, so the backend resolves the user's appearance
//! selection (`appearance.selection` in the app config, `system` follows the
//! OS) against the built-in appearance catalog snapshot
//! (`generated/startup_appearance_bootstrap.json`).

use std::sync::OnceLock;

use dark_light::Mode;
use log::debug;
use openbitfun_core::infrastructure::try_get_path_manager_arc;

static APPEARANCE_CATALOG: OnceLock<AppearanceCatalog> = OnceLock::new();

const APPEARANCE_CATALOG_JSON: &str = include_str!("generated/startup_appearance_bootstrap.json");

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppearanceCatalog {
    schema_version: u8,
    default_light_appearance_id: String,
    default_dark_appearance_id: String,
    appearances: Vec<AppearanceEntry>,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppearanceEntry {
    id: String,
    is_light: bool,
}

fn catalog() -> &'static AppearanceCatalog {
    APPEARANCE_CATALOG.get_or_init(|| {
        let catalog: AppearanceCatalog = serde_json::from_str(APPEARANCE_CATALOG_JSON)
            .expect("appearance catalog snapshot must be valid JSON");
        assert_eq!(
            catalog.schema_version, 1,
            "appearance catalog snapshot version is unsupported"
        );
        catalog
    })
}

/// Namespace of the appearance helpers.
pub struct AppearanceConfig;

impl AppearanceConfig {
    /// `light` or `dark`: the mode of the user's current appearance.
    pub(crate) fn miniapp_mode() -> &'static str {
        if Self::selection_is_light(&Self::configured_selection()) {
            "light"
        } else {
            "dark"
        }
    }

    /// The configured selection (`system` when unset or unreadable).
    fn configured_selection() -> String {
        let path_manager = match try_get_path_manager_arc() {
            Ok(path_manager) => path_manager,
            Err(error) => {
                debug!("Appearance selection unavailable, using system: {}", error);
                return "system".to_string();
            }
        };
        std::fs::read_to_string(path_manager.app_config_file())
            .ok()
            .and_then(|content| serde_json::from_str::<serde_json::Value>(&content).ok())
            .and_then(|config| {
                config
                    .pointer("/appearance/selection")
                    .and_then(|value| value.as_str())
                    .map(str::to_string)
            })
            .unwrap_or_else(|| "system".to_string())
    }

    /// Whether `selection` resolves to a light appearance. Unknown ids fall
    /// back to the default light appearance, as the UI does.
    fn selection_is_light(selection: &str) -> bool {
        let catalog = catalog();
        let id = if selection == "system" {
            match dark_light::detect() {
                Mode::Dark => catalog.default_dark_appearance_id.as_str(),
                Mode::Light | Mode::Default => catalog.default_light_appearance_id.as_str(),
            }
        } else {
            selection
        };
        catalog
            .appearances
            .iter()
            .find(|appearance| appearance.id == id)
            .map(|appearance| appearance.is_light)
            .unwrap_or(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_resolves_both_default_appearances() {
        let catalog = catalog();
        assert!(AppearanceConfig::selection_is_light(
            &catalog.default_light_appearance_id
        ));
        assert!(!AppearanceConfig::selection_is_light(
            &catalog.default_dark_appearance_id
        ));
        assert!(AppearanceConfig::selection_is_light("unknown.appearance"));
    }
}

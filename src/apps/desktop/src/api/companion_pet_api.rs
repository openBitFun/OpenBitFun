//! Agent companion pets: the built-in sprite sets shipped with the backend and
//! the pictures of them: the still a picker tile shows and the spritesheet
//! the desktop pet window animates.
//!
//! Pet packages come from two places behind [`PetPackageStore`]: the
//! built-in sets in the backend's resources (`resources/agent-companion-pets`)
//! and the packages the user imported (`<user data>/agent-companions`, managed
//! by the import and delete commands in `commands.rs`). A later step can move
//! imported packages to the account replica without changing the commands.
//!
//! Built-in pets are named by logical paths (`builtin:<id>` and
//! `builtin:<id>/<file>`), never by an install location, so a selection stays
//! valid when the app moves or another device reads it. 1.x selections that
//! still name the retired web path (`/agent-companion-pets/<id>/<file>`) read
//! as the same built-in pet, and an id that no longer ships falls back to
//! BitBlob rather than to no pet.

use std::path::{Path, PathBuf};

use base64::Engine as _;
use openbitfun_core::service::config::types::{
    AGENT_COMPANION_BUILTIN_PREFIX, AGENT_COMPANION_DEFAULT_PET_ID,
    AGENT_COMPANION_LEGACY_WEB_PREFIX,
};
use serde::{Deserialize, Serialize};

use crate::api::app_state::AppState;
use crate::api::commands::AgentCompanionPetPackageDto;
use crate::api::commands::{companion_user_packages_dir, pet_package_dto_from_dir};
use crate::host::State;

/// Upper bound for a single pet spritesheet, the one import accepts: every
/// sheet that could be imported can also be shown.
const MAX_SPRITESHEET_BYTES: u64 = openbitfun_services_core::pet_packages::IMAGE_LIMIT;
/// A still decodes a whole sheet (about 11 MB of RGBA) and keeps one cell. A
/// picker asks for every pet at once, so only a few sheets are decoded at a time.
static STILL_DECODES: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(3);
const BUILTIN_DIR: &str = "agent-companion-pets";

/// Where pet packages are listed and their spritesheets resolved.
pub(crate) trait PetPackageStore {
    fn builtin_pets(&self) -> Vec<AgentCompanionPetPackageDto>;
    /// The file a selection's spritesheet path names, confined to the pet
    /// directories.
    fn resolve_spritesheet(&self, spritesheet_path: &str) -> Result<PathBuf, String>;
    /// The directory a listed pet's package path names, confined to the pet
    /// directories. A picture of one pet never stands in for another, so a
    /// built-in that does not ship is an error here.
    fn resolve_package(&self, package_path: &str) -> Result<PathBuf, String>;
}

/// The device's pet packages: built-in resources plus the user's imports.
pub(crate) struct LocalPetPackages {
    builtin_root: Option<PathBuf>,
    user_root: PathBuf,
}

impl LocalPetPackages {
    pub(crate) fn new(builtin_root: Option<PathBuf>, user_root: PathBuf) -> Self {
        Self {
            builtin_root,
            user_root,
        }
    }

    pub(crate) fn for_state(state: &AppState) -> Self {
        Self::new(resolve_builtin_root(), companion_user_packages_dir(state))
    }

    fn builtin_file(&self, id: &str, file: &str) -> Result<PathBuf, String> {
        let root = self
            .builtin_root
            .as_ref()
            .ok_or("The built-in companion pets are not installed with this app")?;
        let (id, file) =
            if valid_path_part(id) && valid_path_part(file) && root.join(id).join(file).is_file() {
                (id.to_string(), file.to_string())
            } else {
                log::debug!(
                    "Built-in companion pet not shipped, using the default: id={}",
                    id
                );
                let dir = root.join(AGENT_COMPANION_DEFAULT_PET_ID);
                let default_file = builtin_spritesheet_name(&dir)?;
                (AGENT_COMPANION_DEFAULT_PET_ID.to_string(), default_file)
            };
        Ok(root.join(id).join(file))
    }
}

/// One plain component of a logical built-in path.
fn valid_path_part(part: &str) -> bool {
    !part.is_empty()
        && part != "."
        && part != ".."
        && part
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
}

fn builtin_spritesheet_name(dir: &Path) -> Result<String, String> {
    let manifest: serde_json::Value = serde_json::from_slice(
        &std::fs::read(dir.join("pet.json"))
            .map_err(|error| format!("Failed to read the default companion pet: {error}"))?,
    )
    .map_err(|error| format!("Failed to parse the default companion pet: {error}"))?;
    Ok(manifest
        .get("spritesheetPath")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("spritesheet.webp")
        .to_string())
}

/// `builtin:<id>/<file>` for a built-in pet's file name.
fn builtin_logical(id: &str, file: Option<&str>) -> String {
    match file {
        Some(file) => format!("{AGENT_COMPANION_BUILTIN_PREFIX}{id}/{file}"),
        None => format!("{AGENT_COMPANION_BUILTIN_PREFIX}{id}"),
    }
}

impl PetPackageStore for LocalPetPackages {
    fn builtin_pets(&self) -> Vec<AgentCompanionPetPackageDto> {
        let Some(root) = self.builtin_root.as_ref() else {
            return Vec::new();
        };
        let Ok(entries) = std::fs::read_dir(root) else {
            return Vec::new();
        };
        let mut pets = Vec::new();
        for entry in entries.flatten() {
            let dir = entry.path();
            if !dir.join("pet.json").is_file() {
                continue;
            }
            let Some(folder) = dir.file_name().and_then(|name| name.to_str()) else {
                continue;
            };
            match pet_package_dto_from_dir(&dir, "builtin") {
                Ok(mut pet) => {
                    let file = Path::new(&pet.spritesheet_path)
                        .file_name()
                        .and_then(|name| name.to_str())
                        .unwrap_or("spritesheet.webp")
                        .to_string();
                    pet.package_path = builtin_logical(folder, None);
                    pet.spritesheet_path = builtin_logical(folder, Some(&file));
                    pets.push(pet);
                }
                Err(error) => log::warn!("Skipping invalid built-in companion pet: {}", error),
            }
        }
        // The default first, then by name, so a picker opens on it.
        pets.sort_by(|a, b| {
            (a.id != AGENT_COMPANION_DEFAULT_PET_ID)
                .cmp(&(b.id != AGENT_COMPANION_DEFAULT_PET_ID))
                .then_with(|| {
                    a.display_name
                        .to_lowercase()
                        .cmp(&b.display_name.to_lowercase())
                })
        });
        pets
    }

    fn resolve_spritesheet(&self, spritesheet_path: &str) -> Result<PathBuf, String> {
        let logical = spritesheet_path
            .strip_prefix(AGENT_COMPANION_BUILTIN_PREFIX)
            .or_else(|| spritesheet_path.strip_prefix(AGENT_COMPANION_LEGACY_WEB_PREFIX));
        if let Some(rest) = logical {
            let (id, file) = rest.split_once('/').unwrap_or((rest, "spritesheet.webp"));
            return self.builtin_file(id, file);
        }
        let root = self.user_root.canonicalize().map_err(|error| {
            format!(
                "Companion pet directory is unavailable ({}): {}",
                self.user_root.display(),
                error
            )
        })?;
        let requested = Path::new(spritesheet_path)
            .canonicalize()
            .map_err(|error| format!("Failed to resolve {spritesheet_path}: {error}"))?;
        if !requested.starts_with(&root) {
            return Err(format!(
                "Refused to read {spritesheet_path} outside the companion pet directory"
            ));
        }
        Ok(requested)
    }

    fn resolve_package(&self, package_path: &str) -> Result<PathBuf, String> {
        if let Some(id) = package_path.strip_prefix(AGENT_COMPANION_BUILTIN_PREFIX) {
            return self
                .builtin_root
                .as_ref()
                .filter(|_| valid_path_part(id))
                .map(|root| root.join(id))
                .filter(|dir| dir.is_dir())
                .ok_or_else(|| format!("Built-in companion pet is not shipped: {package_path}"));
        }
        let root = self.user_root.canonicalize().map_err(|error| {
            format!(
                "Companion pet directory is unavailable ({}): {}",
                self.user_root.display(),
                error
            )
        })?;
        let requested = Path::new(package_path)
            .canonicalize()
            .map_err(|error| format!("Failed to resolve {package_path}: {error}"))?;
        if requested.parent() != Some(root.as_path()) {
            return Err(format!(
                "Refused to read {package_path} outside the companion pet directory"
            ));
        }
        Ok(requested)
    }
}

/// The built-in sprite sets: next to the crate in development, in the app's
/// resources when packaged (`scripts/desktop-nsh-package-common.mjs`).
pub(crate) fn resolve_builtin_root() -> Option<PathBuf> {
    let mut candidates = vec![PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join(BUILTIN_DIR)];
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            candidates.push(exe_dir.join("resources").join(BUILTIN_DIR));
            if let Some(parent) = exe_dir.parent() {
                candidates.push(parent.join("Resources").join("resources").join(BUILTIN_DIR));
                if let Some(name) = exe.file_name().and_then(|name| name.to_str()) {
                    candidates.push(
                        parent
                            .join("lib")
                            .join(name)
                            .join("resources")
                            .join(BUILTIN_DIR),
                    );
                    candidates.push(
                        parent
                            .join("share")
                            .join(name)
                            .join("resources")
                            .join(BUILTIN_DIR),
                    );
                }
            }
        }
    }
    candidates.into_iter().find(|path| path.is_dir())
}

/// The built-in pets ahead of `pets` (the user's imports).
pub(crate) fn with_builtin_pets(
    state: &AppState,
    pets: Vec<AgentCompanionPetPackageDto>,
) -> Vec<AgentCompanionPetPackageDto> {
    let mut all = LocalPetPackages::for_state(state).builtin_pets();
    all.extend(pets);
    all
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadAgentCompanionPetSpritesheetRequest {
    pub spritesheet_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCompanionPetSpritesheet {
    pub mime_type: String,
    pub base64: String,
}

fn read_spritesheet(path: &Path) -> Result<AgentCompanionPetSpritesheet, String> {
    let metadata = std::fs::metadata(path)
        .map_err(|error| format!("Failed to read {}: {}", path.display(), error))?;
    if !metadata.is_file() {
        return Err(format!("{} is not a file", path.display()));
    }
    if metadata.len() > MAX_SPRITESHEET_BYTES {
        return Err(format!(
            "{} is larger than {} MiB",
            path.display(),
            MAX_SPRITESHEET_BYTES / 1024 / 1024
        ));
    }
    let bytes = std::fs::read(path)
        .map_err(|error| format!("Failed to read {}: {}", path.display(), error))?;
    let mime_type = match path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        _ => "image/webp",
    };
    Ok(AgentCompanionPetSpritesheet {
        mime_type: mime_type.to_string(),
        base64: base64::engine::general_purpose::STANDARD.encode(bytes),
    })
}

/// Reads a pet's spritesheet (built-in or imported) for the desktop pet
/// window, confined to the pet directories.
// @backend-command
pub async fn load_agent_companion_pet_spritesheet(
    state: State<'_, AppState>,
    request: LoadAgentCompanionPetSpritesheetRequest,
) -> Result<AgentCompanionPetSpritesheet, String> {
    let store = LocalPetPackages::for_state(&state);
    let path = request.spritesheet_path;
    tokio::task::spawn_blocking(move || read_spritesheet(&store.resolve_spritesheet(&path)?))
        .await
        .map_err(|error| error.to_string())?
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadAgentCompanionPetStillRequest {
    pub package_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCompanionPetStill {
    pub mime_type: String,
    pub base64: String,
}

fn read_still(
    store: &impl PetPackageStore,
    package_path: &str,
) -> Result<AgentCompanionPetStill, String> {
    let png = openbitfun_services_core::pet_packages::still(&store.resolve_package(package_path)?)?;
    Ok(AgentCompanionPetStill {
        mime_type: "image/png".to_string(),
        base64: base64::engine::general_purpose::STANDARD.encode(png),
    })
}

/// A listed pet's rest pose as a small image, so a picker shows every pet
/// without each client decoding a whole spritesheet per tile.
// @backend-command
pub async fn load_agent_companion_pet_still(
    state: State<'_, AppState>,
    request: LoadAgentCompanionPetStillRequest,
) -> Result<AgentCompanionPetStill, String> {
    let permit = STILL_DECODES
        .acquire()
        .await
        .map_err(|error| error.to_string())?;
    let store = LocalPetPackages::for_state(&state);
    tokio::task::spawn_blocking(move || {
        // Held by the decode itself: a cancelled caller does not free the slot early.
        let _permit = permit;
        read_still(&store, &request.package_path)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "openbitfun-pets-{}-{}",
            name,
            uuid::Uuid::new_v4().simple()
        ))
    }

    #[test]
    fn the_shipped_built_in_sets_list_with_logical_paths_and_bitblob_first() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join(BUILTIN_DIR);
        let store = LocalPetPackages::new(Some(root), temp_dir("user"));
        let pets = store.builtin_pets();
        assert_eq!(pets.len(), 14, "every built-in sprite set ships");
        assert_eq!(pets[0].id, AGENT_COMPANION_DEFAULT_PET_ID);
        for pet in &pets {
            assert_eq!(pet.source, "builtin");
            assert!(pet.package_path.starts_with(AGENT_COMPANION_BUILTIN_PREFIX));
            assert!(pet.spritesheet_path.starts_with(&pet.package_path));
            assert!(store.resolve_spritesheet(&pet.spritesheet_path).is_ok());
        }
    }

    #[test]
    fn every_listed_pet_has_a_small_still_with_the_pet_drawn_on_it() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join(BUILTIN_DIR);
        let store = LocalPetPackages::new(Some(root), temp_dir("stills"));
        for pet in store.builtin_pets() {
            let still = read_still(&store, &pet.package_path).unwrap();
            assert_eq!(still.mime_type, "image/png");
            let png = base64::engine::general_purpose::STANDARD
                .decode(still.base64)
                .unwrap();
            let frame = image::load_from_memory(&png).unwrap().to_rgba8();
            assert!(frame.width() <= 192 && frame.height() <= 208, "{}", pet.id);
            assert!(
                frame.pixels().any(|pixel| pixel.0[3] > 0),
                "{} has an empty rest pose",
                pet.id
            );
        }
        for bad in ["builtin:no-such-pet", "builtin:..", "builtin:"] {
            assert!(store.resolve_package(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn an_imported_package_is_resolved_only_inside_the_user_pet_directory() {
        let user = temp_dir("packages");
        std::fs::create_dir_all(user.join("cat").join("nested")).unwrap();
        let store = LocalPetPackages::new(None, user.clone());
        assert!(store
            .resolve_package(user.join("cat").to_str().unwrap())
            .is_ok());
        for outside in [user.clone(), user.join("cat").join("nested")] {
            assert!(store
                .resolve_package(outside.to_str().unwrap())
                .unwrap_err()
                .contains("outside"));
        }
        let _ = std::fs::remove_dir_all(user);
    }

    #[test]
    fn legacy_web_paths_and_retired_ids_resolve_to_a_shipped_pet() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join(BUILTIN_DIR);
        let store = LocalPetPackages::new(Some(root.clone()), temp_dir("user"));
        assert_eq!(
            store
                .resolve_spritesheet("/agent-companion-pets/boxcat/spritesheet.webp")
                .unwrap(),
            root.join("boxcat").join("spritesheet.webp")
        );
        assert_eq!(
            store
                .resolve_spritesheet("builtin:no-such-pet/spritesheet.webp")
                .unwrap(),
            root.join("bitblob").join("spritesheet.webp")
        );
        // A path that tries to climb out falls back to the default too.
        assert_eq!(
            store.resolve_spritesheet("builtin:../secret").unwrap(),
            root.join("bitblob").join("spritesheet.webp")
        );
    }

    #[test]
    fn imported_spritesheets_stay_inside_the_user_pet_directory() {
        let user = temp_dir("imports");
        std::fs::create_dir_all(user.join("cat")).unwrap();
        std::fs::write(user.join("cat").join("sheet.png"), b"png").unwrap();
        let outside = temp_dir("outside");
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("x.png"), b"png").unwrap();
        let store = LocalPetPackages::new(None, user.clone());
        let inside = user.join("cat").join("sheet.png");
        let sheet = read_spritesheet(&store.resolve_spritesheet(inside.to_str().unwrap()).unwrap())
            .unwrap();
        assert_eq!(sheet.mime_type, "image/png");
        assert_eq!(sheet.base64, "cG5n");
        assert!(store
            .resolve_spritesheet(outside.join("x.png").to_str().unwrap())
            .unwrap_err()
            .contains("outside"));
        let _ = std::fs::remove_dir_all(user);
        let _ = std::fs::remove_dir_all(outside);
    }
}

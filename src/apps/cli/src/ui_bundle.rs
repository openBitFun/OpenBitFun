//! The web UI bundle this CLI hands to browsers that control it
//! (`ui_bundle_manifest`, and the files by hash on the mesh listener).
//!
//! The bundle is compiled into the executable (`build.rs`,
//! `OPENBITFUN_CLI_WEB_UI_DIR`), not installed next to it: the browser must
//! run exactly the UI of the same commit as this host, and an embedded copy
//! cannot drift from the binary through `cargo install`, self-update, a copied
//! executable or a partial reinstall. It costs about 15 MB (the files and
//! their `.br` siblings; `.gz` copies are left out). A build without it (a
//! plain `cargo build`) answers `ui_bundle_unavailable` instead of serving a
//! UI from another build.

use std::sync::{Arc, OnceLock};

use openbitfun_obp::server::UiBundleSource;
use serde_json::Value;

include!(concat!(env!("OUT_DIR"), "/embedded_ui_bundle.rs"));

/// The bundle compiled into this executable, or why there is none.
pub(crate) fn source() -> Arc<UiBundleSource> {
    static SOURCE: OnceLock<Arc<UiBundleSource>> = OnceLock::new();
    Arc::clone(SOURCE.get_or_init(|| {
        Arc::new(match EMBEDDED_UI_MANIFEST {
            Some(manifest) => UiBundleSource::embedded(manifest, EMBEDDED_UI_FILES),
            None => UiBundleSource::unavailable(
                "this CLI build ships no web UI bundle (built without OPENBITFUN_CLI_WEB_UI_DIR); install a CLI built with `pnpm run cli:build` or `pnpm run cli:install`",
            ),
        })
    }))
}

/// `ui_bundle_manifest`: `{manifest, bundleId}`, or
/// `ui_bundle_unavailable: <reason>`.
pub(crate) async fn ui_bundle_manifest() -> Result<Value, String> {
    openbitfun_obp::server::ui_bundle_manifest(source()).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn the_compiled_in_bundle_is_valid_or_explicitly_absent() {
        let answer = ui_bundle_manifest().await;
        match (EMBEDDED_UI_MANIFEST, answer) {
            (Some(_), Ok(answer)) => {
                let manifest = &answer["manifest"];
                assert!(!manifest["files"].as_array().unwrap().is_empty());
                assert_eq!(
                    answer["bundleId"],
                    openbitfun_obp::ui_bundle::bundle_id(manifest).unwrap()
                );
            }
            (None, Err(reason)) => assert!(
                reason.starts_with("ui_bundle_unavailable: this CLI build ships no web UI bundle"),
                "{reason}"
            ),
            (Some(_), Err(reason)) => panic!("the embedded web UI bundle is invalid: {reason}"),
            (None, Ok(answer)) => panic!("a build without a bundle answered {answer}"),
        }
    }
}

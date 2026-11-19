//! The local folder picker (`Backend.pickDirectory`): NSH 0.6 offers a file
//! picker but no folder picker, so the host shows AppKit's open panel.

use objc2::MainThreadMarker;
use objc2_app_kit::NSOpenPanel;
use objc2_foundation::{NSString, NSURL};
use openbitfun_nsh_native::BoxFuture;

/// `NSModalResponseOK`.
const MODAL_RESPONSE_OK: isize = 1;

#[derive(Default, serde::Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct PickDirectoryOptions {
    title: Option<String>,
    default_path: Option<String>,
}

/// Shows the panel on the main thread; resolves with the JSON of the chosen
/// absolute path, or `null` when cancelled.
pub(crate) fn pick_directory(options_json: String) -> BoxFuture<Result<String, String>> {
    let options: PickDirectoryOptions = if options_json.trim().is_empty() {
        PickDirectoryOptions::default()
    } else {
        match serde_json::from_str(&options_json) {
            Ok(options) => options,
            Err(error) => {
                return Box::pin(
                    async move { Err(format!("invalid folder picker options: {error}")) },
                );
            }
        }
    };
    let (sender, receiver) = tokio::sync::oneshot::channel();
    dispatch::Queue::main().exec_async(move || {
        let _ = sender.send(run_panel(options));
    });
    Box::pin(async move {
        receiver
            .await
            .map_err(|_| "the folder picker closed without an answer".to_string())?
    })
}

fn run_panel(options: PickDirectoryOptions) -> Result<String, String> {
    let Some(mtm) = MainThreadMarker::new() else {
        return Err("the folder picker must run on the main thread".to_string());
    };
    let panel = NSOpenPanel::openPanel(mtm);
    panel.setCanChooseDirectories(true);
    panel.setCanChooseFiles(false);
    panel.setAllowsMultipleSelection(false);
    panel.setCanCreateDirectories(true);
    if let Some(title) = options.title.as_deref().filter(|title| !title.is_empty()) {
        let title = NSString::from_str(title);
        panel.setMessage(Some(&title));
    }
    if let Some(path) = options
        .default_path
        .as_deref()
        .filter(|path| !path.is_empty())
    {
        let url = NSURL::fileURLWithPath(&NSString::from_str(path));
        panel.setDirectoryURL(Some(&url));
    }
    if panel.runModal() != MODAL_RESPONSE_OK {
        return Ok("null".to_string());
    }
    let path = panel
        .URL()
        .and_then(|url| url.path())
        .map(|path| path.to_string())
        .ok_or_else(|| "the folder picker returned no path".to_string())?;
    serde_json::to_string(&path).map_err(|error| error.to_string())
}

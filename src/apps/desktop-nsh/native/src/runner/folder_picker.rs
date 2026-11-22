//! The local folder picker (`Backend.pickDirectory`): NSH 0.6 offers a file
//! picker but no folder picker, so the host uses the platform's native dialog
//! on macOS (AppKit `NSOpenPanel`), Windows (`IFileOpenDialog` with
//! `FOS_PICKFOLDERS` on a dedicated STA thread), and Linux (`zenity` /
//! `kdialog` on a background thread, falling back to a clear unsupported error
//! when neither is available).

use openbitfun_nsh_native::BoxFuture;

#[derive(Default, serde::Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct PickDirectoryOptions {
    title: Option<String>,
    default_path: Option<String>,
}

/// Shows the native folder picker without blocking the runtime or JS event
/// loop; resolves with the JSON of the chosen absolute path, or `null` when
/// cancelled.
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
    pick_directory_platform(options)
}

#[cfg(target_os = "macos")]
fn pick_directory_platform(options: PickDirectoryOptions) -> BoxFuture<Result<String, String>> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    dispatch::Queue::main().exec_async(move || {
        let _ = sender.send(macos::run_panel(options));
    });
    Box::pin(async move {
        receiver
            .await
            .map_err(|_| "the folder picker closed without an answer".to_string())?
    })
}

#[cfg(windows)]
fn pick_directory_platform(options: PickDirectoryOptions) -> BoxFuture<Result<String, String>> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let spawned = std::thread::Builder::new()
        .name("openbitfun-folder-picker".to_string())
        .spawn(move || {
            let _ = sender.send(windows_picker::run_panel(options));
        });
    if let Err(error) = spawned {
        return Box::pin(async move {
            Err(format!(
                "Failed to spawn folder picker thread on Windows: {error}"
            ))
        });
    }
    Box::pin(async move {
        receiver
            .await
            .map_err(|_| "the folder picker closed without an answer".to_string())?
    })
}

#[cfg(target_os = "linux")]
fn pick_directory_platform(options: PickDirectoryOptions) -> BoxFuture<Result<String, String>> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let spawned = std::thread::Builder::new()
        .name("openbitfun-folder-picker".to_string())
        .spawn(move || {
            let _ = sender.send(linux_picker::run_panel(options));
        });
    if let Err(error) = spawned {
        return Box::pin(async move {
            Err(format!(
                "Failed to spawn folder picker thread on Linux: {error}"
            ))
        });
    }
    Box::pin(async move {
        receiver
            .await
            .map_err(|_| "the folder picker closed without an answer".to_string())?
    })
}

#[cfg(target_os = "macos")]
mod macos {
    use objc2::MainThreadMarker;
    use objc2_app_kit::NSOpenPanel;
    use objc2_foundation::{NSString, NSURL};

    use super::PickDirectoryOptions;

    /// `NSModalResponseOK`.
    const MODAL_RESPONSE_OK: isize = 1;

    pub(super) fn run_panel(options: PickDirectoryOptions) -> Result<String, String> {
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
}

#[cfg(windows)]
mod windows_picker {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;

    use windows::core::{HRESULT, PCWSTR, PWSTR};
    use windows::Win32::Foundation::{ERROR_CANCELLED, S_FALSE, S_OK};
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL,
        COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE,
    };
    use windows::Win32::UI::Shell::{
        FileOpenDialog, IFileOpenDialog, IShellItem, SHCreateItemFromParsingName,
        FOS_FORCEFILESYSTEM, FOS_NOCHANGEDIR, FOS_PICKFOLDERS, SIGDN_FILESYSPATH,
    };

    use super::PickDirectoryOptions;

    struct ComStaGuard;

    impl Drop for ComStaGuard {
        fn drop(&mut self) {
            // SAFETY: pairs with a successful `CoInitializeEx` on this thread.
            unsafe { CoUninitialize() };
        }
    }

    struct CoTaskMemGuard(PWSTR);

    impl Drop for CoTaskMemGuard {
        fn drop(&mut self) {
            if !self.0 .0.is_null() {
                // SAFETY: `self.0` was allocated by `IShellItem::GetDisplayName`.
                unsafe { CoTaskMemFree(Some(self.0 .0.cast())) };
            }
        }
    }

    fn to_wide(value: &str) -> Vec<u16> {
        OsStr::new(value)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    pub(super) fn run_panel(options: PickDirectoryOptions) -> Result<String, String> {
        // SAFETY: initializes COM STA on this dedicated picker thread.
        let init_hr =
            unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) };
        if init_hr.is_err() {
            return Err(format!(
                "Failed to initialize Windows COM for folder picker: {init_hr}"
            ));
        }
        let _com_guard = (init_hr == S_OK || init_hr == S_FALSE).then_some(ComStaGuard);

        // SAFETY: COM is initialized on this STA thread; `FileOpenDialog` is a
        // standard Windows Shell CLSID implementing `IFileOpenDialog`.
        let dialog: IFileOpenDialog = unsafe {
            CoCreateInstance(&FileOpenDialog, None, CLSCTX_ALL)
        }
        .map_err(|error| format!("Failed to create Windows folder picker dialog: {error}"))?;

        // SAFETY: valid `IFileOpenDialog` COM interface on this STA thread.
        let flags = unsafe { dialog.GetOptions() }
            .map_err(|error| format!("Failed to read folder picker options: {error}"))?;
        // SAFETY: valid `IFileOpenDialog` COM interface on this STA thread.
        unsafe {
            dialog.SetOptions(flags | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_NOCHANGEDIR)
        }
        .map_err(|error| format!("Failed to configure folder picker options: {error}"))?;

        if let Some(title) = options.title.as_deref().filter(|title| !title.is_empty()) {
            let wide_title = to_wide(title);
            // SAFETY: `wide_title` is a valid NUL-terminated UTF-16 string.
            unsafe { dialog.SetTitle(PCWSTR(wide_title.as_ptr())) }
                .map_err(|error| format!("Failed to set folder picker title: {error}"))?;
        }

        if let Some(path) = options
            .default_path
            .as_deref()
            .filter(|path| !path.is_empty())
        {
            let wide_path = to_wide(path);
            // SAFETY: `wide_path` is a valid NUL-terminated UTF-16 string.
            if let Ok(folder) = unsafe {
                SHCreateItemFromParsingName::<_, _, IShellItem>(PCWSTR(wide_path.as_ptr()), None)
            } {
                // SAFETY: `folder` is a valid `IShellItem`.
                let _ = unsafe { dialog.SetFolder(&folder) };
            }
        }

        // SAFETY: displays the modal shell dialog on this dedicated STA thread.
        match unsafe { dialog.Show(None) } {
            Ok(()) => {}
            Err(error) if error.code() == HRESULT::from_win32(ERROR_CANCELLED.0) => {
                return Ok("null".to_string());
            }
            Err(error) => {
                return Err(format!("Windows folder picker failed: {error}"));
            }
        }

        // SAFETY: `Show` returned `S_OK`, so a selection result is present.
        let item = unsafe { dialog.GetResult() }
            .map_err(|error| format!("Failed to read folder picker selection: {error}"))?;
        // SAFETY: requests a filesystem path allocated with `CoTaskMemAlloc`.
        let raw_path = unsafe { item.GetDisplayName(SIGDN_FILESYSPATH) }
            .map_err(|error| format!("Failed to read selected folder path: {error}"))?;
        let path_guard = CoTaskMemGuard(raw_path);
        // SAFETY: `path_guard.0` is a valid NUL-terminated UTF-16 string until dropped.
        let path = unsafe { path_guard.0.to_string() }
            .map_err(|error| format!("Selected folder path is not valid UTF-16: {error}"))?;
        serde_json::to_string(&path).map_err(|error| error.to_string())
    }
}

#[cfg(any(target_os = "linux", test))]
mod linux_picker {
    #[cfg(target_os = "linux")]
    use std::io::ErrorKind;
    #[cfg(target_os = "linux")]
    use std::process::{Command, Output, Stdio};

    #[cfg(target_os = "linux")]
    use openbitfun_nsh_native::UNSUPPORTED_IN_NATIVE_HOST;

    use super::PickDirectoryOptions;

    pub(super) fn zenity_args(options: &PickDirectoryOptions) -> Vec<String> {
        let mut args = vec!["--file-selection".to_string(), "--directory".to_string()];
        if let Some(title) = options.title.as_deref().filter(|title| !title.is_empty()) {
            args.push(format!("--title={title}"));
        }
        if let Some(path) = options
            .default_path
            .as_deref()
            .filter(|path| !path.is_empty())
        {
            let dir = if path == "/" {
                "/".to_string()
            } else {
                format!("{}/", path.trim_end_matches('/'))
            };
            args.push(format!("--filename={dir}"));
        }
        args
    }

    pub(super) fn kdialog_args(options: &PickDirectoryOptions) -> Vec<String> {
        let mut args = Vec::new();
        if let Some(title) = options.title.as_deref().filter(|title| !title.is_empty()) {
            args.push("--title".to_string());
            args.push(title.to_string());
        }
        args.push("--getexistingdirectory".to_string());
        let start = options
            .default_path
            .as_deref()
            .filter(|path| !path.is_empty())
            .map(str::to_owned)
            .or_else(|| std::env::var("HOME").ok().filter(|home| !home.is_empty()))
            .unwrap_or_else(|| ".".to_string());
        args.push(start);
        args
    }

    pub(super) fn format_selected_path(stdout: &[u8]) -> Result<String, String> {
        let path = String::from_utf8_lossy(stdout);
        let trimmed = path.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            return Ok("null".to_string());
        }
        serde_json::to_string(trimmed).map_err(|error| error.to_string())
    }

    #[cfg(target_os = "linux")]
    fn run_dialog_command(program: &str, args: &[String]) -> std::io::Result<Output> {
        // Non-interactive stdin/stdio redirection on a dedicated picker thread
        // (runner has no services-core dependency; Linux has no console window flag).
        Command::new(program)
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
    }

    #[cfg(target_os = "linux")]
    pub(super) fn run_panel(options: PickDirectoryOptions) -> Result<String, String> {
        let zenity = zenity_args(&options);
        match run_dialog_command("zenity", &zenity) {
            Ok(output) => {
                if output.status.success() {
                    return format_selected_path(&output.stdout);
                }
                if matches!(output.status.code(), Some(1) | Some(5)) {
                    return Ok("null".to_string());
                }
                let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                return Err(format!(
                    "Linux folder picker (zenity) exited with {:?}: {}",
                    output.status.code(),
                    stderr
                ));
            }
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(error) => {
                return Err(format!("Failed to launch zenity folder picker: {error}"));
            }
        }

        let kdialog = kdialog_args(&options);
        match run_dialog_command("kdialog", &kdialog) {
            Ok(output) => {
                if output.status.success() {
                    return format_selected_path(&output.stdout);
                }
                if output.status.code() == Some(1) {
                    return Ok("null".to_string());
                }
                let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                Err(format!(
                    "Linux folder picker (kdialog) exited with {:?}: {}",
                    output.status.code(),
                    stderr
                ))
            }
            Err(error) if error.kind() == ErrorKind::NotFound => Err(format!(
                "{UNSUPPORTED_IN_NATIVE_HOST}: pick_directory (neither zenity nor kdialog is installed)"
            )),
            Err(error) => Err(format!("Failed to launch kdialog folder picker: {error}")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::linux_picker::{format_selected_path, kdialog_args, zenity_args};
    use super::PickDirectoryOptions;

    #[test]
    fn zenity_args_preserve_trailing_slash_and_title() {
        let args = zenity_args(&PickDirectoryOptions {
            title: Some("Open Workspace".to_string()),
            default_path: Some("/tmp/my project".to_string()),
        });
        assert_eq!(
            args,
            vec![
                "--file-selection",
                "--directory",
                "--title=Open Workspace",
                "--filename=/tmp/my project/",
            ]
        );
    }

    #[test]
    fn kdialog_args_include_title_and_start_directory() {
        let args = kdialog_args(&PickDirectoryOptions {
            title: Some("Pick Folder".to_string()),
            default_path: Some("/var/tmp".to_string()),
        });
        assert_eq!(
            args,
            vec![
                "--title",
                "Pick Folder",
                "--getexistingdirectory",
                "/var/tmp"
            ]
        );
    }

    #[test]
    fn format_selected_path_strips_newlines_only() {
        assert_eq!(
            format_selected_path(b"/tmp/dir with space \n").unwrap(),
            r#""/tmp/dir with space ""#
        );
        assert_eq!(format_selected_path(b"\n").unwrap(), "null");
    }
}

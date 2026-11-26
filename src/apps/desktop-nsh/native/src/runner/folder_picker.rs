//! Native local file and folder dialogs (`Backend.pickDirectory`, `Backend.pickFileDialog`).
//!
//! NSH's built-in `Picker` reads file bytes into memory without returning host
//! filesystem paths or offering folder/save panels, so the desktop runner uses
//! native OS panels on macOS (AppKit `NSOpenPanel`/`NSSavePanel`), Windows
//! (`IFileOpenDialog`/`IFileSaveDialog` on a dedicated STA thread), and Linux
//! (`zenity` / `kdialog` on a background thread, falling back to a clear
//! unsupported error when neither is available).

use openbitfun_nsh_native::BoxFuture;

#[derive(Default, serde::Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct PickDirectoryOptions {
    title: Option<String>,
    default_path: Option<String>,
}

#[derive(Default, Clone, serde::Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct FileDialogFilter {
    name: Option<String>,
    extensions: Vec<String>,
}

#[derive(Default, Clone, serde::Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct FileDialogOptions {
    mode: Option<String>,
    title: Option<String>,
    default_path: Option<String>,
    multiple: bool,
    directory: bool,
    filters: Vec<FileDialogFilter>,
}

impl FileDialogOptions {
    fn is_save(&self) -> bool {
        self.mode.as_deref() == Some("save")
    }
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
    pick_file_dialog_platform(FileDialogOptions {
        mode: Some("open".to_string()),
        title: options.title,
        default_path: options.default_path,
        multiple: false,
        directory: true,
        filters: Vec::new(),
    })
}

/// Shows a native file open/save dialog without blocking the runtime or JS
/// event loop; resolves with JSON (`string | string[] | null`).
pub(crate) fn pick_file_dialog(options_json: String) -> BoxFuture<Result<String, String>> {
    let options: FileDialogOptions = if options_json.trim().is_empty() {
        FileDialogOptions::default()
    } else {
        match serde_json::from_str(&options_json) {
            Ok(options) => options,
            Err(error) => {
                return Box::pin(
                    async move { Err(format!("invalid file dialog options: {error}")) },
                );
            }
        }
    };
    pick_file_dialog_platform(options)
}

#[cfg(target_os = "macos")]
fn pick_file_dialog_platform(options: FileDialogOptions) -> BoxFuture<Result<String, String>> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    dispatch::Queue::main().exec_async(move || {
        let _ = sender.send(macos::run_panel(options));
    });
    Box::pin(async move {
        receiver
            .await
            .map_err(|_| "the file dialog closed without an answer".to_string())?
    })
}

#[cfg(windows)]
fn pick_file_dialog_platform(options: FileDialogOptions) -> BoxFuture<Result<String, String>> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let spawned = std::thread::Builder::new()
        .name("openbitfun-file-dialog".to_string())
        .spawn(move || {
            let _ = sender.send(windows_picker::run_panel(options));
        });
    if let Err(error) = spawned {
        return Box::pin(async move {
            Err(format!(
                "Failed to spawn file dialog thread on Windows: {error}"
            ))
        });
    }
    Box::pin(async move {
        receiver
            .await
            .map_err(|_| "the file dialog closed without an answer".to_string())?
    })
}

#[cfg(target_os = "linux")]
fn pick_file_dialog_platform(options: FileDialogOptions) -> BoxFuture<Result<String, String>> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let spawned = std::thread::Builder::new()
        .name("openbitfun-file-dialog".to_string())
        .spawn(move || {
            let _ = sender.send(linux_picker::run_panel(options));
        });
    if let Err(error) = spawned {
        return Box::pin(async move {
            Err(format!(
                "Failed to spawn file dialog thread on Linux: {error}"
            ))
        });
    }
    Box::pin(async move {
        receiver
            .await
            .map_err(|_| "the file dialog closed without an answer".to_string())?
    })
}

fn normalized_extensions(filters: &[FileDialogFilter]) -> Vec<String> {
    let mut extensions = Vec::new();
    for filter in filters {
        for raw in &filter.extensions {
            let cleaned = raw.trim().trim_start_matches("*.").trim_start_matches('.');
            if !cleaned.is_empty() && cleaned != "*" && !extensions.iter().any(|e| e == cleaned) {
                extensions.push(cleaned.to_string());
            }
        }
    }
    extensions
}

fn split_default_path(path: &str) -> (Option<String>, Option<String>) {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return (None, None);
    }
    let path = std::path::Path::new(trimmed);
    if path.is_dir() {
        return (Some(trimmed.to_string()), None);
    }
    let dir = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .map(|parent| parent.to_string_lossy().into_owned());
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned());
    (dir, name)
}

#[cfg(target_os = "macos")]
mod macos {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSOpenPanel, NSSavePanel};
    use objc2_foundation::{NSArray, NSString, NSURL};

    use super::{normalized_extensions, split_default_path, FileDialogOptions};

    /// `NSModalResponseOK`.
    const MODAL_RESPONSE_OK: isize = 1;

    fn apply_common(panel: &NSSavePanel, options: &FileDialogOptions) {
        if let Some(title) = options.title.as_deref().filter(|title| !title.is_empty()) {
            let title = NSString::from_str(title);
            panel.setMessage(Some(&title));
        }
        if let Some(default_path) = options.default_path.as_deref() {
            let (dir, name) = split_default_path(default_path);
            if let Some(dir) = dir {
                let url = NSURL::fileURLWithPath(&NSString::from_str(&dir));
                panel.setDirectoryURL(Some(&url));
            }
            if options.is_save() {
                if let Some(name) = name {
                    panel.setNameFieldStringValue(&NSString::from_str(&name));
                }
            }
        }
        if !options.directory {
            let extensions = normalized_extensions(&options.filters);
            if !extensions.is_empty() {
                let items: Vec<_> = extensions
                    .iter()
                    .map(|ext| NSString::from_str(ext))
                    .collect();
                let refs: Vec<&NSString> = items.iter().map(|item| item.as_ref()).collect();
                let allowed = NSArray::from_slice(&refs);
                #[allow(deprecated)]
                panel.setAllowedFileTypes(Some(&allowed));
            }
        }
    }

    pub(super) fn run_panel(options: FileDialogOptions) -> Result<String, String> {
        let Some(mtm) = MainThreadMarker::new() else {
            return Err("the file dialog must run on the main thread".to_string());
        };
        if options.is_save() {
            let panel = NSSavePanel::savePanel(mtm);
            panel.setCanCreateDirectories(true);
            apply_common(&panel, &options);
            if panel.runModal() != MODAL_RESPONSE_OK {
                return Ok("null".to_string());
            }
            let path = panel
                .URL()
                .and_then(|url| url.path())
                .map(|path| path.to_string())
                .ok_or_else(|| "the save dialog returned no path".to_string())?;
            return serde_json::to_string(&path).map_err(|error| error.to_string());
        }

        let panel = NSOpenPanel::openPanel(mtm);
        panel.setCanChooseDirectories(options.directory);
        panel.setCanChooseFiles(!options.directory);
        panel.setAllowsMultipleSelection(options.multiple);
        panel.setCanCreateDirectories(options.directory);
        apply_common(&panel, &options);
        if panel.runModal() != MODAL_RESPONSE_OK {
            return Ok("null".to_string());
        }
        if options.multiple {
            let urls = panel.URLs();
            let mut paths = Vec::with_capacity(urls.len());
            for index in 0..urls.len() {
                if let Some(path) = urls.objectAtIndex(index).path() {
                    paths.push(path.to_string());
                }
            }
            return serde_json::to_string(&paths).map_err(|error| error.to_string());
        }
        let path = panel
            .URL()
            .and_then(|url| url.path())
            .map(|path| path.to_string())
            .ok_or_else(|| "the file picker returned no path".to_string())?;
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
    use windows::Win32::UI::Shell::Common::COMDLG_FILTERSPEC;
    use windows::Win32::UI::Shell::{
        FileOpenDialog, FileSaveDialog, IFileDialog, IFileOpenDialog, IFileSaveDialog, IShellItem,
        SHCreateItemFromParsingName, FOS_ALLOWMULTISELECT, FOS_FORCEFILESYSTEM, FOS_NOCHANGEDIR,
        FOS_OVERWRITEPROMPT, FOS_PICKFOLDERS, SIGDN_FILESYSPATH,
    };

    use super::{split_default_path, FileDialogFilter, FileDialogOptions};

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

    fn item_path(item: &IShellItem) -> Result<String, String> {
        // SAFETY: requests a filesystem path allocated with `CoTaskMemAlloc`.
        let raw_path = unsafe { item.GetDisplayName(SIGDN_FILESYSPATH) }
            .map_err(|error| format!("Failed to read selected path: {error}"))?;
        let path_guard = CoTaskMemGuard(raw_path);
        // SAFETY: `path_guard.0` is a valid NUL-terminated UTF-16 string until dropped.
        unsafe { path_guard.0.to_string() }
            .map_err(|error| format!("Selected path is not valid UTF-16: {error}"))
    }

    fn build_filter_buffers(filters: &[FileDialogFilter]) -> Vec<(Vec<u16>, Vec<u16>)> {
        filters
            .iter()
            .filter_map(|filter| {
                let patterns: Vec<String> = filter
                    .extensions
                    .iter()
                    .map(|ext| ext.trim().trim_start_matches("*.").trim_start_matches('.'))
                    .filter(|ext| !ext.is_empty())
                    .map(|ext| {
                        if ext == "*" {
                            "*.*".to_string()
                        } else {
                            format!("*.{ext}")
                        }
                    })
                    .collect();
                if patterns.is_empty() {
                    return None;
                }
                let name = filter
                    .name
                    .as_deref()
                    .filter(|name| !name.is_empty())
                    .unwrap_or("Files");
                Some((to_wide(name), to_wide(&patterns.join(";"))))
            })
            .collect()
    }

    fn configure_common(dialog: &IFileDialog, options: &FileDialogOptions) -> Result<(), String> {
        if let Some(title) = options.title.as_deref().filter(|title| !title.is_empty()) {
            let wide_title = to_wide(title);
            // SAFETY: `wide_title` is a valid NUL-terminated UTF-16 string.
            unsafe { dialog.SetTitle(PCWSTR(wide_title.as_ptr())) }
                .map_err(|error| format!("Failed to set file dialog title: {error}"))?;
        }

        if let Some(default_path) = options.default_path.as_deref() {
            let (dir, name) = split_default_path(default_path);
            if let Some(dir) = dir {
                let wide_path = to_wide(&dir);
                // SAFETY: `wide_path` is a valid NUL-terminated UTF-16 string.
                if let Ok(folder) = unsafe {
                    SHCreateItemFromParsingName::<_, _, IShellItem>(
                        PCWSTR(wide_path.as_ptr()),
                        None,
                    )
                } {
                    // SAFETY: `folder` is a valid `IShellItem`.
                    let _ = unsafe { dialog.SetFolder(&folder) };
                }
            }
            if options.is_save() {
                if let Some(name) = name {
                    let wide_name = to_wide(&name);
                    // SAFETY: `wide_name` is a valid NUL-terminated UTF-16 string.
                    let _ = unsafe { dialog.SetFileName(PCWSTR(wide_name.as_ptr())) };
                }
            }
        }

        if !options.directory && !options.filters.is_empty() {
            let buffers = build_filter_buffers(&options.filters);
            if !buffers.is_empty() {
                let specs: Vec<COMDLG_FILTERSPEC> = buffers
                    .iter()
                    .map(|(name, spec)| COMDLG_FILTERSPEC {
                        pszName: PCWSTR(name.as_ptr()),
                        pszSpec: PCWSTR(spec.as_ptr()),
                    })
                    .collect();
                // SAFETY: `buffers` outlives the `SetFileTypes` call, which copies the strings.
                unsafe { dialog.SetFileTypes(&specs) }
                    .map_err(|error| format!("Failed to configure file filters: {error}"))?;
            }
        }
        Ok(())
    }

    pub(super) fn run_panel(options: FileDialogOptions) -> Result<String, String> {
        // SAFETY: initializes COM STA on this dedicated picker thread.
        let init_hr =
            unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) };
        if init_hr.is_err() {
            return Err(format!(
                "Failed to initialize Windows COM for file dialog: {init_hr}"
            ));
        }
        let _com_guard = (init_hr == S_OK || init_hr == S_FALSE).then_some(ComStaGuard);

        if options.is_save() {
            // SAFETY: COM is initialized on this STA thread; `FileSaveDialog` implements `IFileSaveDialog`.
            let dialog: IFileSaveDialog =
                unsafe { CoCreateInstance(&FileSaveDialog, None, CLSCTX_ALL) }.map_err(
                    |error| format!("Failed to create Windows save file dialog: {error}"),
                )?;
            // SAFETY: valid `IFileSaveDialog` COM interface on this STA thread.
            let flags = unsafe { dialog.GetOptions() }
                .map_err(|error| format!("Failed to read save dialog options: {error}"))?;
            // SAFETY: valid `IFileSaveDialog` COM interface on this STA thread.
            unsafe {
                dialog
                    .SetOptions(flags | FOS_FORCEFILESYSTEM | FOS_NOCHANGEDIR | FOS_OVERWRITEPROMPT)
            }
            .map_err(|error| format!("Failed to configure save dialog options: {error}"))?;
            configure_common(&dialog.clone().into(), &options)?;
            // SAFETY: displays the modal shell dialog on this dedicated STA thread.
            match unsafe { dialog.Show(None) } {
                Ok(()) => {}
                Err(error) if error.code() == HRESULT::from_win32(ERROR_CANCELLED.0) => {
                    return Ok("null".to_string());
                }
                Err(error) => {
                    return Err(format!("Windows save file dialog failed: {error}"));
                }
            }
            // SAFETY: `Show` returned `S_OK`, so a selection result is present.
            let item = unsafe { dialog.GetResult() }
                .map_err(|error| format!("Failed to read save dialog selection: {error}"))?;
            let path = item_path(&item)?;
            return serde_json::to_string(&path).map_err(|error| error.to_string());
        }

        // SAFETY: COM is initialized on this STA thread; `FileOpenDialog` implements `IFileOpenDialog`.
        let dialog: IFileOpenDialog =
            unsafe { CoCreateInstance(&FileOpenDialog, None, CLSCTX_ALL) }
                .map_err(|error| format!("Failed to create Windows open file dialog: {error}"))?;

        // SAFETY: valid `IFileOpenDialog` COM interface on this STA thread.
        let mut flags = unsafe { dialog.GetOptions() }
            .map_err(|error| format!("Failed to read file dialog options: {error}"))?;
        flags |= FOS_FORCEFILESYSTEM | FOS_NOCHANGEDIR;
        if options.directory {
            flags |= FOS_PICKFOLDERS;
        }
        if options.multiple {
            flags |= FOS_ALLOWMULTISELECT;
        }
        // SAFETY: valid `IFileOpenDialog` COM interface on this STA thread.
        unsafe { dialog.SetOptions(flags) }
            .map_err(|error| format!("Failed to configure file dialog options: {error}"))?;
        configure_common(&dialog.clone().into(), &options)?;

        // SAFETY: displays the modal shell dialog on this dedicated STA thread.
        match unsafe { dialog.Show(None) } {
            Ok(()) => {}
            Err(error) if error.code() == HRESULT::from_win32(ERROR_CANCELLED.0) => {
                return Ok("null".to_string());
            }
            Err(error) => {
                return Err(format!("Windows file dialog failed: {error}"));
            }
        }

        if options.multiple {
            // SAFETY: `Show` returned `S_OK`, so a results array is present.
            let items = unsafe { dialog.GetResults() }
                .map_err(|error| format!("Failed to read file dialog selections: {error}"))?;
            // SAFETY: valid `IShellItemArray`.
            let count = unsafe { items.GetCount() }
                .map_err(|error| format!("Failed to count file dialog selections: {error}"))?;
            let mut paths = Vec::with_capacity(count as usize);
            for index in 0..count {
                // SAFETY: `index < count`.
                let item = unsafe { items.GetItemAt(index) }
                    .map_err(|error| format!("Failed to read file dialog item: {error}"))?;
                paths.push(item_path(&item)?);
            }
            return serde_json::to_string(&paths).map_err(|error| error.to_string());
        }

        // SAFETY: `Show` returned `S_OK`, so a selection result is present.
        let item = unsafe { dialog.GetResult() }
            .map_err(|error| format!("Failed to read file dialog selection: {error}"))?;
        let path = item_path(&item)?;
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

    use super::{FileDialogOptions, PickDirectoryOptions};

    pub(super) fn zenity_file_args(options: &FileDialogOptions) -> Vec<String> {
        let mut args = vec!["--file-selection".to_string()];
        if options.is_save() {
            args.push("--save".to_string());
            args.push("--confirm-overwrite".to_string());
        } else {
            if options.directory {
                args.push("--directory".to_string());
            }
            if options.multiple {
                args.push("--multiple".to_string());
                args.push("--separator=\n".to_string());
            }
        }
        if let Some(title) = options.title.as_deref().filter(|title| !title.is_empty()) {
            args.push(format!("--title={title}"));
        }
        if let Some(path) = options
            .default_path
            .as_deref()
            .filter(|path| !path.is_empty())
        {
            if options.directory {
                let dir = if path == "/" {
                    "/".to_string()
                } else {
                    format!("{}/", path.trim_end_matches('/'))
                };
                args.push(format!("--filename={dir}"));
            } else {
                args.push(format!("--filename={path}"));
            }
        }
        if !options.directory {
            for filter in &options.filters {
                let patterns: Vec<String> = filter
                    .extensions
                    .iter()
                    .map(|ext| ext.trim().trim_start_matches("*.").trim_start_matches('.'))
                    .filter(|ext| !ext.is_empty())
                    .map(|ext| {
                        if ext == "*" {
                            "*".to_string()
                        } else {
                            format!("*.{ext}")
                        }
                    })
                    .collect();
                if patterns.is_empty() {
                    continue;
                }
                let name = filter
                    .name
                    .as_deref()
                    .filter(|name| !name.is_empty())
                    .unwrap_or("Files");
                args.push(format!("--file-filter={name} | {}", patterns.join(" ")));
            }
        }
        args
    }

    pub(super) fn kdialog_file_args(options: &FileDialogOptions) -> Vec<String> {
        let mut args = Vec::new();
        if let Some(title) = options.title.as_deref().filter(|title| !title.is_empty()) {
            args.push("--title".to_string());
            args.push(title.to_string());
        }
        if options.is_save() {
            args.push("--getsavefilename".to_string());
        } else if options.directory {
            args.push("--getexistingdirectory".to_string());
        } else {
            if options.multiple {
                args.push("--multiple".to_string());
                args.push("--separate-output".to_string());
            }
            args.push("--getopenfilename".to_string());
        }
        let start = options
            .default_path
            .as_deref()
            .filter(|path| !path.is_empty())
            .map(str::to_owned)
            .or_else(|| std::env::var("HOME").ok().filter(|home| !home.is_empty()))
            .unwrap_or_else(|| ".".to_string());
        args.push(start);
        if !options.directory && !options.filters.is_empty() {
            let filter_str = options
                .filters
                .iter()
                .filter_map(|filter| {
                    let patterns: Vec<String> = filter
                        .extensions
                        .iter()
                        .map(|ext| ext.trim().trim_start_matches("*.").trim_start_matches('.'))
                        .filter(|ext| !ext.is_empty())
                        .map(|ext| {
                            if ext == "*" {
                                "*".to_string()
                            } else {
                                format!("*.{ext}")
                            }
                        })
                        .collect();
                    if patterns.is_empty() {
                        return None;
                    }
                    let name = filter
                        .name
                        .as_deref()
                        .filter(|name| !name.is_empty())
                        .unwrap_or("Files");
                    Some(format!("{name} ({})", patterns.join(" ")))
                })
                .collect::<Vec<_>>()
                .join("\n");
            if !filter_str.is_empty() {
                args.push(filter_str);
            }
        }
        args
    }

    #[cfg(test)]
    pub(super) fn zenity_args(options: &PickDirectoryOptions) -> Vec<String> {
        zenity_file_args(&FileDialogOptions {
            mode: Some("open".to_string()),
            title: options.title.clone(),
            default_path: options.default_path.clone(),
            multiple: false,
            directory: true,
            filters: Vec::new(),
        })
    }

    #[cfg(test)]
    pub(super) fn kdialog_args(options: &PickDirectoryOptions) -> Vec<String> {
        kdialog_file_args(&FileDialogOptions {
            mode: Some("open".to_string()),
            title: options.title.clone(),
            default_path: options.default_path.clone(),
            multiple: false,
            directory: true,
            filters: Vec::new(),
        })
    }

    pub(super) fn format_selected_paths(stdout: &[u8], multiple: bool) -> Result<String, String> {
        let text = String::from_utf8_lossy(stdout);
        if multiple {
            let paths: Vec<&str> = text
                .split('\n')
                .map(|line| line.trim_end_matches('\r'))
                .filter(|line| !line.is_empty())
                .collect();
            if paths.is_empty() {
                return Ok("null".to_string());
            }
            return serde_json::to_string(&paths).map_err(|error| error.to_string());
        }
        let trimmed = text.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            return Ok("null".to_string());
        }
        serde_json::to_string(trimmed).map_err(|error| error.to_string())
    }

    #[cfg(test)]
    pub(super) fn format_selected_path(stdout: &[u8]) -> Result<String, String> {
        format_selected_paths(stdout, false)
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
    pub(super) fn run_panel(options: FileDialogOptions) -> Result<String, String> {
        let zenity = zenity_file_args(&options);
        match run_dialog_command("zenity", &zenity) {
            Ok(output) => {
                if output.status.success() {
                    return format_selected_paths(
                        &output.stdout,
                        options.multiple && !options.is_save(),
                    );
                }
                if matches!(output.status.code(), Some(1) | Some(5)) {
                    return Ok("null".to_string());
                }
                let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                return Err(format!(
                    "Linux file dialog (zenity) exited with {:?}: {}",
                    output.status.code(),
                    stderr
                ));
            }
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(error) => {
                return Err(format!("Failed to launch zenity file dialog: {error}"));
            }
        }

        let kdialog = kdialog_file_args(&options);
        match run_dialog_command("kdialog", &kdialog) {
            Ok(output) => {
                if output.status.success() {
                    return format_selected_paths(&output.stdout, options.multiple && !options.is_save());
                }
                if output.status.code() == Some(1) {
                    return Ok("null".to_string());
                }
                let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                Err(format!(
                    "Linux file dialog (kdialog) exited with {:?}: {}",
                    output.status.code(),
                    stderr
                ))
            }
            Err(error) if error.kind() == ErrorKind::NotFound => Err(format!(
                "{UNSUPPORTED_IN_NATIVE_HOST}: pick_file_dialog (neither zenity nor kdialog is installed)"
            )),
            Err(error) => Err(format!("Failed to launch kdialog file dialog: {error}")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::linux_picker::{
        format_selected_path, format_selected_paths, kdialog_args, kdialog_file_args, zenity_args,
        zenity_file_args,
    };
    use super::{normalized_extensions, FileDialogFilter, FileDialogOptions, PickDirectoryOptions};

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
    fn file_dialog_args_cover_save_multiple_and_filters() {
        let save = zenity_file_args(&FileDialogOptions {
            mode: Some("save".to_string()),
            title: Some("Export Slide".to_string()),
            default_path: Some("/tmp/deck.pptx".to_string()),
            multiple: false,
            directory: false,
            filters: vec![FileDialogFilter {
                name: Some("PowerPoint".to_string()),
                extensions: vec![".pptx".to_string(), "*.pdf".to_string()],
            }],
        });
        assert_eq!(
            save,
            vec![
                "--file-selection",
                "--save",
                "--confirm-overwrite",
                "--title=Export Slide",
                "--filename=/tmp/deck.pptx",
                "--file-filter=PowerPoint | *.pptx *.pdf",
            ]
        );

        let multi = kdialog_file_args(&FileDialogOptions {
            mode: Some("open".to_string()),
            title: Some("Choose Images".to_string()),
            default_path: Some("/tmp".to_string()),
            multiple: true,
            directory: false,
            filters: vec![FileDialogFilter {
                name: Some("Images".to_string()),
                extensions: vec!["png".to_string(), "jpg".to_string()],
            }],
        });
        assert_eq!(
            multi,
            vec![
                "--title",
                "Choose Images",
                "--multiple",
                "--separate-output",
                "--getopenfilename",
                "/tmp",
                "Images (*.png *.jpg)",
            ]
        );
        assert_eq!(
            normalized_extensions(&[FileDialogFilter {
                name: Some("Docs".to_string()),
                extensions: vec![
                    "*.md".to_string(),
                    ".txt".to_string(),
                    "md".to_string(),
                    "*".to_string()
                ],
            }]),
            vec!["md", "txt"]
        );
    }

    #[test]
    fn format_selected_path_strips_newlines_only() {
        assert_eq!(
            format_selected_path(b"/tmp/dir with space \n").unwrap(),
            r#""/tmp/dir with space ""#
        );
        assert_eq!(format_selected_path(b"\n").unwrap(), "null");
        assert_eq!(
            format_selected_paths(b"/tmp/a.png\n/tmp/b.png\n", true).unwrap(),
            r#"["/tmp/a.png","/tmp/b.png"]"#
        );
    }
}

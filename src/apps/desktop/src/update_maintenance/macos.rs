use openbitfun_services_core::process_manager::create_command;
use std::{fs, io, path::Path};

pub(super) fn install_file(archive_path: &Path) -> io::Result<()> {
    let file = fs::File::open(archive_path)?;
    install_reader(io::BufReader::new(file))
}

fn install_reader<R: io::Read>(reader: R) -> io::Result<()> {
    let executable = std::env::current_exe()?;
    let target = bundle_of_executable(&executable)?;
    if !target
        .extension()
        .is_some_and(|extension| extension == "app")
    {
        return Err(io::Error::other(
            "This macOS installation requires a manual update",
        ));
    }
    let parent = target
        .parent()
        .ok_or_else(|| io::Error::other("Application parent is unavailable"))?;
    let (stage, authorize) = match tempfile::Builder::new()
        .prefix(".openbitfun-update-")
        .tempdir_in(parent)
    {
        Ok(stage) => (stage, false),
        Err(error) if error.kind() == io::ErrorKind::PermissionDenied => {
            (tempfile::tempdir()?, true)
        }
        Err(error) => return Err(error),
    };
    let unpack = stage.path().join("unpack");
    fs::create_dir(&unpack)?;
    // tar validates traversal and symlink parents during unpack.
    tar::Archive::new(flate2::read::GzDecoder::new(reader)).unpack(&unpack)?;
    let apps = fs::read_dir(&unpack)?
        .map(|entry| entry.map(|entry| entry.path()))
        .collect::<io::Result<Vec<_>>>()?
        .into_iter()
        .filter(|path| {
            path.extension().is_some_and(|extension| extension == "app")
                && fs::symlink_metadata(path).is_ok_and(|metadata| metadata.is_dir())
        })
        .collect::<Vec<_>>();
    if apps.len() != 1 {
        return Err(io::Error::other(
            "Update archive must contain one application bundle",
        ));
    }
    let new_app = &apps[0];
    let name = executable
        .file_name()
        .ok_or_else(|| io::Error::other("Application binary name is unavailable"))?;
    if !new_app.join("Contents/MacOS").join(name).is_file() {
        return Err(io::Error::other(
            "Update bundle is missing the application executable",
        ));
    }
    if !new_app.join("Contents/Resources/nsh/bundle.nshc").is_file() {
        return Err(io::Error::other(
            "Update bundle is missing the native NSH UI bundle",
        ));
    }
    if !authorize {
        return super::publication::replace_bundle(&target, new_app, stage);
    }
    // osascript owns its main thread and the native authorization dialog. The
    // Desktop worker receives compile/dispatch/authorization failures normally.
    let shell = authorized_script(parent, new_app, &target);
    let apple = format!(
        "do shell script \"{}\" with administrator privileges",
        shell
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
            .replace('\n', "\\n")
    );
    let result = create_command("/usr/bin/osascript")
        .args(["-e", &apple])
        .output()?;
    if !result.status.success() {
        return Err(io::Error::other(format!(
            "Authorized application replacement failed: {}",
            String::from_utf8_lossy(&result.stderr)
        )));
    }
    Ok(())
}

/// `<Name>.app` for an executable at `<Name>.app/Contents/MacOS/<exe>`.
fn bundle_of_executable(executable: &Path) -> io::Result<std::path::PathBuf> {
    let macos = executable.parent();
    let contents = macos.and_then(Path::parent);
    match (macos, contents, contents.and_then(Path::parent)) {
        (Some(macos), Some(contents), Some(bundle))
            if macos.file_name().is_some_and(|name| name == "MacOS")
                && contents.file_name().is_some_and(|name| name == "Contents") =>
        {
            Ok(bundle.to_path_buf())
        }
        _ => Err(io::Error::other(
            "This macOS installation requires a manual update",
        )),
    }
}

fn authorized_script(parent: &Path, new_app: &Path, target: &Path) -> String {
    let quote = |path: &Path| format!("'{}'", path.to_string_lossy().replace('\'', "'\\''"));
    format!(
        r#"set -eu
stage=$(/usr/bin/mktemp -d {parent}/.openbitfun-update.XXXXXXXX)
/usr/bin/ditto {new} "$stage/new.app"
/bin/mv {old} "$stage/previous.app"
if [ -e {old} ] || [ -L {old} ]; then
  echo "Recovery backup retained at $stage; destination changed" >&2; exit 2
fi
if /bin/mv "$stage/new.app" {old}; then
  if /bin/rm -rf "$stage/previous.app"; then /bin/rmdir "$stage" || true; fi
else
  if [ -e {old} ] || [ -L {old} ]; then
    echo "Recovery backup retained at $stage; destination changed" >&2; exit 2
  fi
  /bin/mv "$stage/previous.app" {old} || {{ echo "Recovery backup retained at $stage" >&2; exit 2; }}
  exit 1
fi"#,
        parent = quote(parent),
        new = quote(new_app),
        old = quote(target)
    )
}

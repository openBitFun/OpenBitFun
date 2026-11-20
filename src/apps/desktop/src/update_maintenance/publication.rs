use std::{fs, io, path::Path};

/// Retain the only backup if either publication or its rollback fails.
pub(super) fn replace_bundle(
    target: &Path,
    staged: &Path,
    stage: tempfile::TempDir,
) -> io::Result<()> {
    replace_bundle_with(target, staged, stage, |source, destination| {
        fs::rename(source, destination)
    })
}

fn replace_bundle_with(
    target: &Path,
    staged: &Path,
    stage: tempfile::TempDir,
    mut rename: impl FnMut(&Path, &Path) -> io::Result<()>,
) -> io::Result<()> {
    let backup = stage.path().join("previous.app");
    rename(target, &backup)?;
    if let Err(error) = rename(staged, target) {
        if let Err(recovery) = rename(&backup, target) {
            let retained = stage.keep();
            return Err(io::Error::other(format!(
                "App replacement failed: {error}; recovery failed: {recovery}; backup retained at {}",
                retained.display()
            )));
        }
        return Err(error);
    }
    if let Err(error) = stage.close() {
        log::warn!("Application updated; staging cleanup failed: {error}");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failed_bundle_publication_restores_the_original() {
        let root = tempfile::tempdir().unwrap();
        let target = root.path().join("original.app");
        fs::create_dir(&target).unwrap();
        fs::write(target.join("user.txt"), "old").unwrap();
        let stage = tempfile::tempdir_in(root.path()).unwrap();
        let missing = stage.path().join("missing.app");
        assert!(replace_bundle(&target, &missing, stage).is_err());
        assert_eq!(fs::read_to_string(target.join("user.txt")).unwrap(), "old");
    }

    #[test]
    fn failed_rollback_preserves_the_only_recovery_copy() {
        let root = tempfile::tempdir().unwrap();
        let target = root.path().join("original.app");
        fs::create_dir(&target).unwrap();
        fs::write(target.join("original.txt"), "old").unwrap();
        let stage = tempfile::tempdir_in(root.path()).unwrap();
        let retained = stage.path().to_owned();
        let staged = stage.path().join("new.app");
        fs::create_dir(&staged).unwrap();
        let mut calls = 0;
        let error = replace_bundle_with(&target, &staged, stage, |source, destination| {
            calls += 1;
            if calls > 1 {
                return Err(io::Error::other("Injected publication/restore failure"));
            }
            fs::rename(source, destination)
        })
        .unwrap_err();
        assert!(error.to_string().contains("backup retained"));
        assert_eq!(
            fs::read_to_string(retained.join("previous.app/original.txt")).unwrap(),
            "old"
        );
    }
}

//! Open a regular file beneath a bound workspace, including across symlink races.
use cap_std::fs::{Dir, OpenOptions};
use std::{io, path::Path, sync::Arc};

pub struct WorkspaceReader(Arc<Dir>);

impl WorkspaceReader {
    pub fn open(root: &Path) -> io::Result<Self> {
        Ok(Self(Arc::new(Dir::open_ambient_dir(
            root,
            cap_std::ambient_authority(),
        )?)))
    }

    pub async fn open_file(&self, relative: &Path) -> io::Result<tokio::fs::File> {
        let root = self.0.clone();
        let relative = relative.to_owned();
        tokio::task::spawn_blocking(move || {
            let mut options = OpenOptions::new();
            options.read(true);
            #[cfg(unix)]
            {
                use cap_std::fs::OpenOptionsExt;
                options.custom_flags(libc::O_NONBLOCK | libc::O_NOCTTY);
            }
            let file = root.open_with(relative, &options)?;
            if !file.metadata()?.is_file() {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "Read requires a regular file",
                ));
            }
            Ok(tokio::fs::File::from_std(file.into_std()))
        })
        .await?
    }
}

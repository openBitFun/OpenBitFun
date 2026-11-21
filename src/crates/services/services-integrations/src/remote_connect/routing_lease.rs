//! Host-local arbitration of which OpenBitFun process serves this machine's
//! device identity on OpenBitFun Link.
//!
//! Every OpenBitFun host on a machine shares `device_identity.json`, so only
//! one of them may join Link as that device at a time. A host holds an OS
//! advisory lock for its priority tier while it serves the device; the OS
//! releases it when the process exits, crashes or is killed, so no stale owner
//! record survives.
//!
//! - [`DeviceRoutingPriority::Primary`] (Desktop) serves whenever it holds the
//!   primary lock and never yields to a secondary host.
//! - [`DeviceRoutingPriority::Secondary`] (CLI, TUI, daemon) serves only while
//!   it holds the secondary lock and no primary host holds the primary lock. It
//!   stands by otherwise and resumes once the primary host exits or signs out.
//!
//! (OpenBitFun 1.x keyed the same locks by Relay endpoint under
//! `relay-routing/`; 2.0 no longer uses the relay and keys them by device.)

use std::fs::{File, OpenOptions};
use std::io;
use std::path::{Path, PathBuf};

use anyhow::Result;
use fs2::FileExt;
use sha2::{Digest, Sha256};

/// Which host serves the shared device identity when several run at once.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeviceRoutingPriority {
    /// Interactive Desktop host. Takes the device socket over from a secondary host.
    Primary,
    /// CLI, TUI or daemon host. Serves the device only while no primary host does.
    Secondary,
}

/// The single arbitration scope: one device identity, one serving host.
const DEVICE_ROUTING_KEY: &str = "openbitfun-device";

#[derive(Debug, Clone)]
pub(crate) struct RoutingLeasePaths {
    priority: DeviceRoutingPriority,
    own: PathBuf,
    primary: PathBuf,
}

impl RoutingLeasePaths {
    /// Lock files live next to the device identity: hosts that share it are
    /// exactly the hosts that serve the same device.
    pub(crate) fn for_device(priority: DeviceRoutingPriority) -> Result<Self> {
        let identity = super::device::identity_file_path()?;
        let dir = identity
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_default()
            .join("device-routing");
        Ok(Self::in_dir(&dir, DEVICE_ROUTING_KEY, priority))
    }

    pub(crate) fn in_dir(dir: &Path, scope: &str, priority: DeviceRoutingPriority) -> Self {
        let digest = Sha256::digest(scope.trim_end_matches('/').as_bytes());
        let key = hex::encode(&digest[..8]);
        let primary = dir.join(format!("{key}.primary.lock"));
        let own = match priority {
            DeviceRoutingPriority::Primary => primary.clone(),
            DeviceRoutingPriority::Secondary => dir.join(format!("{key}.secondary.lock")),
        };
        Self {
            priority,
            own,
            primary,
        }
    }
}

/// One host's claim on serving the device. Dropping it releases the claim so
/// the next host in line can serve.
pub(crate) struct RoutingLease {
    paths: RoutingLeasePaths,
    held: Option<File>,
}

impl RoutingLease {
    pub(crate) fn new(paths: RoutingLeasePaths) -> Self {
        Self { paths, held: None }
    }

    pub(crate) fn priority(&self) -> DeviceRoutingPriority {
        self.paths.priority
    }

    /// Whether this host may (re)connect now. The own-tier lock is kept once
    /// acquired, so a standing-by secondary host remains the designated
    /// successor instead of racing other secondary hosts.
    pub(crate) fn may_connect(&mut self) -> io::Result<bool> {
        if self.held.is_none() {
            let file = open_lock_file(&self.paths.own)?;
            if !try_lock(&file, true)? {
                return Ok(false);
            }
            self.held = Some(file);
        }
        match self.paths.priority {
            DeviceRoutingPriority::Primary => Ok(true),
            DeviceRoutingPriority::Secondary => primary_is_free(&self.paths.primary),
        }
    }
}

/// A host's claim on serving this machine's device identity (Link join).
///
/// Hold it for as long as the host wants to serve; dropping it hands the
/// device to the next host in line.
pub struct DeviceRoutingLease {
    inner: RoutingLease,
}

impl DeviceRoutingLease {
    /// A claim keyed by this machine's device identity.
    pub fn for_device(priority: DeviceRoutingPriority) -> Result<Self> {
        Ok(Self {
            inner: RoutingLease::new(RoutingLeasePaths::for_device(priority)?),
        })
    }

    /// A claim whose lock files live in `dir` (tests and scratch profiles).
    pub fn in_dir(dir: &Path, priority: DeviceRoutingPriority) -> Self {
        Self {
            inner: RoutingLease::new(RoutingLeasePaths::in_dir(dir, DEVICE_ROUTING_KEY, priority)),
        }
    }

    pub fn priority(&self) -> DeviceRoutingPriority {
        self.inner.priority()
    }

    /// Whether this host serves the device now. A secondary host that stands
    /// by keeps its tier lock, so it is the designated successor.
    pub fn may_serve(&mut self) -> io::Result<bool> {
        self.inner.may_connect()
    }
}

fn open_lock_file(path: &Path) -> io::Result<File> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(path)
}

fn try_lock(file: &File, exclusive: bool) -> io::Result<bool> {
    let result = if exclusive {
        FileExt::try_lock_exclusive(file)
    } else {
        FileExt::try_lock_shared(file)
    };
    match result {
        Ok(()) => Ok(true),
        Err(error) if error.raw_os_error() == fs2::lock_contended_error().raw_os_error() => {
            Ok(false)
        }
        Err(error) => Err(error),
    }
}

/// A shared probe conflicts only with a primary host's exclusive lock. A
/// primary host that loses this momentary race retries its acquisition.
fn primary_is_free(path: &Path) -> io::Result<bool> {
    let file = open_lock_file(path)?;
    if !try_lock(&file, false)? {
        return Ok(false);
    }
    let _ = FileExt::unlock(&file);
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCOPE: &str = DEVICE_ROUTING_KEY;

    fn lease(dir: &Path, scope: &str, priority: DeviceRoutingPriority) -> RoutingLease {
        RoutingLease::new(RoutingLeasePaths::in_dir(dir, scope, priority))
    }

    #[test]
    fn primary_host_preempts_a_connected_secondary_host() {
        let dir = tempfile::tempdir().unwrap();
        let mut cli = lease(dir.path(), SCOPE, DeviceRoutingPriority::Secondary);
        assert!(cli.may_connect().unwrap());

        let mut desktop = lease(dir.path(), SCOPE, DeviceRoutingPriority::Primary);
        assert!(desktop.may_connect().unwrap());
        assert!(!cli.may_connect().unwrap());
    }

    #[test]
    fn secondary_host_resumes_after_the_primary_host_exits() {
        let dir = tempfile::tempdir().unwrap();
        let mut desktop = lease(dir.path(), SCOPE, DeviceRoutingPriority::Primary);
        assert!(desktop.may_connect().unwrap());

        let mut daemon = lease(dir.path(), SCOPE, DeviceRoutingPriority::Secondary);
        assert!(!daemon.may_connect().unwrap());
        // The standing-by host keeps its tier, so another CLI cannot jump ahead.
        let mut other_cli = lease(dir.path(), SCOPE, DeviceRoutingPriority::Secondary);
        assert!(!other_cli.may_connect().unwrap());

        drop(desktop);
        assert!(daemon.may_connect().unwrap());
        assert!(!other_cli.may_connect().unwrap());
    }

    #[test]
    fn hosts_of_the_same_priority_take_turns() {
        let dir = tempfile::tempdir().unwrap();
        let mut first = lease(dir.path(), SCOPE, DeviceRoutingPriority::Primary);
        let mut second = lease(dir.path(), SCOPE, DeviceRoutingPriority::Primary);
        assert!(first.may_connect().unwrap());
        assert!(!second.may_connect().unwrap());
        drop(first);
        assert!(second.may_connect().unwrap());
    }

    #[test]
    fn device_lease_hands_the_device_to_the_cli_after_the_desktop_exits() {
        let dir = tempfile::tempdir().unwrap();
        let mut desktop = DeviceRoutingLease::in_dir(dir.path(), DeviceRoutingPriority::Primary);
        assert!(desktop.may_serve().unwrap());
        let mut daemon = DeviceRoutingLease::in_dir(dir.path(), DeviceRoutingPriority::Secondary);
        assert!(!daemon.may_serve().unwrap());
        drop(desktop);
        assert!(daemon.may_serve().unwrap());
    }
}

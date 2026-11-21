//! Windows containment for detached dispatch actions.
//!
//! Unix workers call `setsid`, so a live, identity-verified leader PID is also
//! the process-group ID that cancellation signals. Windows has no process
//! groups that can be signalled, so each detached action enrolls itself in a
//! named Job Object derived from `(data namespace, action, job id)`:
//!
//! - Identity: a PID authenticates as the worker for a job only when that live
//!   process is a member of the job's named Job Object. A recycled PID belongs
//!   to a process outside the job, so it never matches.
//! - Cancellation: `TerminateJobObject` stops the worker and every descendant
//!   that did not explicitly break away, which is the Windows equivalent of
//!   signalling the Unix process group.
//!
//! The worker holds the only long-lived handle. Once it exits, the name leaves
//! the object namespace, so a stale PID marker can never authenticate a
//! remaining group, matching the Unix rule that an absent leader cannot
//! authenticate its PGID.
//!
//! Names live in `Global\` so that an observer in another logon session (for
//! example a second SSH connection) can verify and cancel the worker. When the
//! global namespace refuses creation, the worker falls back to `Local\`, which
//! only same-session observers can see.

use sha2::{Digest, Sha256};

/// Object-namespace prefixes tried in order, by the worker when it creates its
/// Job Object and by observers when they look it up.
const JOB_NAMESPACES: [&str; 2] = ["Global\\", "Local\\"];
const JOB_NAME_STEM: &str = "OpenBitFun.Dispatch.";

/// Job Object names for one detached action, in lookup order.
///
/// The job id and action are hashed, so the name holds only `[0-9a-f.]` after
/// its namespace prefix whatever characters a job id contains, and stays far
/// below `MAX_PATH`.
pub(super) fn job_object_names(namespace: &str, action: &str, job_id: &str) -> [String; 2] {
    let mut hasher = Sha256::new();
    for part in [namespace, action, job_id] {
        hasher.update((part.len() as u64).to_le_bytes());
        hasher.update(part.as_bytes());
    }
    let digest = hasher.finalize();
    let suffix = digest[..16]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    JOB_NAMESPACES.map(|prefix| format!("{prefix}{JOB_NAME_STEM}{suffix}"))
}

/// What a detached spawn does after Windows refused `CREATE_BREAKAWAY_FROM_JOB`.
///
/// `current_job_kills_on_close` is the spawner's own Job limit, or `None` when
/// it could not be read. A child that stays in a kill-on-close Job dies with
/// the host that submitted it, which would turn a durable detached job into a
/// session-bound one, so that case fails loudly instead of degrading.
#[cfg_attr(not(windows), allow(dead_code))]
pub(super) fn breakaway_denied_fallback(
    current_job_kills_on_close: Option<bool>,
) -> Result<(), String> {
    match current_job_kills_on_close {
        Some(true) => Err(
            "this host runs inside a Windows Job that forbids breakaway and terminates its \
             processes on close, so a detached dispatch worker cannot outlive it; start the \
             OpenBitFun CLI host outside that Job"
                .to_string(),
        ),
        Some(false) | None => Ok(()),
    }
}

#[cfg(windows)]
pub(super) use platform::*;

#[cfg(windows)]
mod platform {
    use std::ffi::c_void;
    use std::mem::size_of;
    use std::time::{Duration, Instant};

    use anyhow::{anyhow, bail, Context, Result};
    use windows::core::{BOOL, PCWSTR};
    use windows::Win32::Foundation::{
        CloseHandle, GetLastError, SetLastError, ERROR_ACCESS_DENIED, ERROR_ALREADY_EXISTS,
        ERROR_INVALID_PARAMETER, HANDLE, WAIT_OBJECT_0, WAIT_TIMEOUT, WIN32_ERROR,
    };
    use windows::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, IsProcessInJob,
        JobObjectBasicAccountingInformation, JobObjectExtendedLimitInformation, OpenJobObjectW,
        QueryInformationJobObject, SetInformationJobObject, TerminateJobObject,
        JOBOBJECT_BASIC_ACCOUNTING_INFORMATION, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_BREAKAWAY_OK, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows::Win32::System::Threading::{
        GetCurrentProcess, OpenProcess, WaitForSingleObject, PROCESS_QUERY_LIMITED_INFORMATION,
        PROCESS_SYNCHRONIZE,
    };

    use super::job_object_names;

    // Job-specific access rights (winnt.h). Declared here so the CLI does not
    // pull in the whole `Win32_System_SystemServices` binding for four values.
    const JOB_OBJECT_QUERY: u32 = 0x0004;
    const JOB_OBJECT_TERMINATE: u32 = 0x0008;

    /// Exit code reported by processes stopped through cancellation.
    const CANCELLED_EXIT_CODE: u32 = 1;
    const TERMINATION_WAIT: Duration = Duration::from_secs(2);
    const TERMINATION_POLL: Duration = Duration::from_millis(25);

    /// An owned kernel handle, closed on drop.
    pub(in crate::dispatch::runner) struct OwnedHandle(HANDLE);

    impl Drop for OwnedHandle {
        fn drop(&mut self) {
            // SAFETY: the handle was returned by a successful Win32 call and is
            // owned exclusively by this value.
            unsafe {
                let _ = CloseHandle(self.0);
            }
        }
    }

    fn data_namespace() -> &'static str {
        openbitfun_services_core::product_identity::data_namespace()
    }

    fn wide(name: &str) -> Vec<u16> {
        name.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn is_win32(error: &windows::core::Error, code: WIN32_ERROR) -> bool {
        error.code() == code.to_hresult()
    }

    /// Enroll the current process in the named Job Object of `(action,
    /// job_id)` and return the handle that keeps the name alive.
    ///
    /// Must run before the action publishes its PID, so a PID marker never
    /// names a process that is not yet verifiable.
    pub(in crate::dispatch::runner) fn enroll_current_process(
        action: &str,
        job_id: &str,
    ) -> Result<OwnedHandle> {
        let names = job_object_names(data_namespace(), action, job_id);
        let mut refused = Vec::new();
        for name in &names {
            match create_or_open_job(name) {
                Ok(job) => {
                    // SAFETY: `job` is a live Job handle with assign rights (it
                    // was created or opened by this process with full access);
                    // the pseudo handle of the current process is always valid.
                    unsafe { AssignProcessToJobObject(job.0, GetCurrentProcess()) }.with_context(
                        || format!("enroll dispatch action in Windows Job Object {name}"),
                    )?;
                    return Ok(job);
                }
                // Another account squatting the name, or a policy that denies
                // the global namespace: try the session-local namespace.
                Err(error) if is_win32(&error, ERROR_ACCESS_DENIED) => {
                    refused.push(format!("{name}: {error}"));
                }
                Err(error) => {
                    return Err(anyhow!(error))
                        .with_context(|| format!("create Windows Job Object {name}"));
                }
            }
        }
        bail!(
            "no Windows Job Object namespace accepted the dispatch action: {}",
            refused.join("; ")
        )
    }

    fn create_or_open_job(name: &str) -> windows::core::Result<OwnedHandle> {
        let name_w = wide(name);
        // SAFETY: SetLastError only writes the calling thread's error slot.
        unsafe { SetLastError(WIN32_ERROR(0)) };
        // SAFETY: `name_w` is a NUL-terminated UTF-16 buffer that outlives the
        // call; default security gives the creating account full access.
        let handle = unsafe { CreateJobObjectW(None, PCWSTR(name_w.as_ptr())) }?;
        // SAFETY: reads the calling thread's error slot right after the call.
        let existed = unsafe { GetLastError() } == ERROR_ALREADY_EXISTS;
        let job = OwnedHandle(handle);
        if !existed {
            // Nested detached spawns (and product handoffs) request breakaway
            // explicitly; ordinary descendants stay in the Job and are stopped
            // by cancellation.
            allow_breakaway(&job)?;
        }
        Ok(job)
    }

    fn allow_breakaway(job: &OwnedHandle) -> windows::core::Result<()> {
        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        // SAFETY: `job` is live and `info` is a writable buffer of exactly the
        // size the information class requires.
        unsafe {
            QueryInformationJobObject(
                Some(job.0),
                JobObjectExtendedLimitInformation,
                &mut info as *mut _ as *mut c_void,
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                None,
            )?;
        }
        info.BasicLimitInformation.LimitFlags |= JOB_OBJECT_LIMIT_BREAKAWAY_OK;
        // SAFETY: same live handle and an initialized buffer of exact size.
        unsafe {
            SetInformationJobObject(
                job.0,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const c_void,
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        }
    }

    /// Whether the Job that contains this process terminates its members when
    /// its last handle closes. `Some(false)` when this process is in no Job;
    /// `None` when the limit could not be read.
    pub(in crate::dispatch::runner) fn current_job_kills_on_close() -> Option<bool> {
        let mut in_job = BOOL(0);
        // SAFETY: the current-process pseudo handle is always valid and
        // `in_job` is a writable BOOL.
        if unsafe { IsProcessInJob(GetCurrentProcess(), None, &mut in_job) }.is_err() {
            return None;
        }
        if !in_job.as_bool() {
            return Some(false);
        }
        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        // SAFETY: a null Job handle queries the Job of the calling process;
        // `info` is a writable buffer of the exact size.
        let queried = unsafe {
            QueryInformationJobObject(
                None,
                JobObjectExtendedLimitInformation,
                &mut info as *mut _ as *mut c_void,
                size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                None,
            )
        };
        queried.ok()?;
        Some(
            info.BasicLimitInformation.LimitFlags & JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
                == JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        )
    }

    enum ProcessLookup {
        Running(OwnedHandle),
        Exited,
        /// The PID exists but this account may not query it.
        Inaccessible,
    }

    fn open_process(pid: u32) -> Result<ProcessLookup> {
        // SAFETY: OpenProcess has no memory-safety preconditions.
        let handle = match unsafe {
            OpenProcess(
                PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE,
                false,
                pid,
            )
        } {
            Ok(handle) => OwnedHandle(handle),
            Err(error) if is_win32(&error, ERROR_INVALID_PARAMETER) => {
                return Ok(ProcessLookup::Exited)
            }
            Err(error) if is_win32(&error, ERROR_ACCESS_DENIED) => {
                return Ok(ProcessLookup::Inaccessible)
            }
            Err(error) => {
                return Err(anyhow!(error)).with_context(|| format!("open process {pid}"))
            }
        };
        // An exited process stays openable while any handle to it remains,
        // like a Unix zombie; only an unsignalled handle is a live process.
        // SAFETY: `handle` is live and holds SYNCHRONIZE access.
        match unsafe { WaitForSingleObject(handle.0, 0) } {
            WAIT_TIMEOUT => Ok(ProcessLookup::Running(handle)),
            WAIT_OBJECT_0 => Ok(ProcessLookup::Exited),
            other => bail!("wait on process {pid} failed with {:#x}", other.0),
        }
    }

    pub(in crate::dispatch::runner) fn process_alive(pid: u32) -> bool {
        match open_process(pid) {
            Ok(ProcessLookup::Running(_)) => true,
            // Same rule as EPERM on Unix: present, but never authenticated.
            Ok(ProcessLookup::Inaccessible) => true,
            Ok(ProcessLookup::Exited) => false,
            Err(error) => {
                tracing::debug!(pid, error = %format!("{error:#}"), "Process liveness query failed");
                false
            }
        }
    }

    /// The action's Job Object, when the running `process` is a member of it.
    fn member_job(
        process: &OwnedHandle,
        action: &str,
        job_id: &str,
        access: u32,
    ) -> Option<OwnedHandle> {
        for name in job_object_names(data_namespace(), action, job_id) {
            let name_w = wide(&name);
            // SAFETY: `name_w` is NUL-terminated and outlives the call.
            let Ok(handle) = (unsafe { OpenJobObjectW(access, false, PCWSTR(name_w.as_ptr())) })
            else {
                continue;
            };
            let job = OwnedHandle(handle);
            let mut member = BOOL(0);
            // SAFETY: both handles are live with query access and `member`
            // is a writable BOOL.
            if unsafe { IsProcessInJob(process.0, Some(job.0), &mut member) }.is_ok()
                && member.as_bool()
            {
                return Some(job);
            }
        }
        None
    }

    pub(in crate::dispatch::runner) fn process_matches_action(
        pid: u32,
        action: &str,
        job_id: &str,
    ) -> bool {
        match open_process(pid) {
            Ok(ProcessLookup::Running(process)) => {
                member_job(&process, action, job_id, JOB_OBJECT_QUERY).is_some()
            }
            _ => false,
        }
    }

    fn active_processes(job: &OwnedHandle) -> Result<u32> {
        let mut info = JOBOBJECT_BASIC_ACCOUNTING_INFORMATION::default();
        // SAFETY: `job` is live with query access and `info` is a writable
        // buffer of the exact size.
        unsafe {
            QueryInformationJobObject(
                Some(job.0),
                JobObjectBasicAccountingInformation,
                &mut info as *mut _ as *mut c_void,
                size_of::<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>() as u32,
                None,
            )
        }
        .context("query dispatch worker Job Object accounting")?;
        Ok(info.ActiveProcesses)
    }

    /// Stop an identity-verified detached action and every descendant still
    /// in its Job Object. Returns `Ok(false)` when the leader is already gone.
    pub(in crate::dispatch::runner) fn terminate_action(
        pid: u32,
        action: &str,
        job_id: &str,
    ) -> Result<bool> {
        if pid == std::process::id() {
            bail!("refusing to terminate the current dispatch process {pid}");
        }
        let process = match open_process(pid)? {
            // The Job name disappeared with the leader's handle, so nothing
            // left can be authenticated; never terminate by a bare PID.
            ProcessLookup::Exited => return Ok(false),
            ProcessLookup::Inaccessible => {
                bail!("dispatch worker pid {pid} does not match job '{job_id}'")
            }
            ProcessLookup::Running(process) => process,
        };
        let Some(job) = member_job(
            &process,
            action,
            job_id,
            JOB_OBJECT_QUERY | JOB_OBJECT_TERMINATE,
        ) else {
            bail!("dispatch worker pid {pid} does not match job '{job_id}'");
        };
        let mut caller_in_job = BOOL(0);
        // SAFETY: the pseudo handle and `job` are live; `caller_in_job` is a
        // writable BOOL.
        unsafe { IsProcessInJob(GetCurrentProcess(), Some(job.0), &mut caller_in_job) }
            .context("check the canceller's Job membership")?;
        if caller_in_job.as_bool() {
            bail!("refusing to terminate dispatch job '{job_id}' from inside its own Job Object");
        }

        // SAFETY: `job` is live and holds JOB_OBJECT_TERMINATE.
        unsafe { TerminateJobObject(job.0, CANCELLED_EXIT_CODE) }
            .with_context(|| format!("terminate the Job Object of dispatch job '{job_id}'"))?;

        let deadline = Instant::now() + TERMINATION_WAIT;
        loop {
            // SAFETY: `process` is live and holds SYNCHRONIZE access.
            let leader_exited = unsafe { WaitForSingleObject(process.0, 0) } == WAIT_OBJECT_0;
            let remaining = active_processes(&job)?;
            if leader_exited && remaining == 0 {
                return Ok(true);
            }
            if Instant::now() >= deadline {
                bail!(
                    "dispatch worker pid {pid} remained alive after TerminateJobObject \
                     (leader exited: {leader_exited}, processes left in the Job: {remaining})"
                );
            }
            std::thread::sleep(TERMINATION_POLL);
        }
    }

    #[cfg(test)]
    mod tests {
        use std::os::windows::io::AsRawHandle;
        use std::process::{Child, Stdio};

        use super::*;

        struct KillOnDrop(Child);
        impl Drop for KillOnDrop {
            fn drop(&mut self) {
                let _ = self.0.kill();
                let _ = self.0.wait();
            }
        }

        /// A hidden, long-running child that does not touch the network.
        fn spawn_sleeper() -> KillOnDrop {
            let mut command =
                openbitfun_services_core::process_manager::create_command("powershell.exe");
            command
                .args([
                    "-NoProfile",
                    "-NonInteractive",
                    "-Command",
                    "Start-Sleep -Seconds 60",
                ])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            KillOnDrop(command.spawn().expect("spawn sleeper"))
        }

        fn enroll_child(child: &Child, action: &str, job_id: &str) -> OwnedHandle {
            let name = &job_object_names(data_namespace(), action, job_id)[0];
            let job = create_or_open_job(name).expect("create test Job Object");
            // SAFETY: both handles are live; the child handle is owned by the
            // `Child` that outlives this call.
            unsafe { AssignProcessToJobObject(job.0, HANDLE(child.as_raw_handle())) }
                .expect("assign child to test Job Object");
            job
        }

        #[test]
        fn live_and_exited_processes_are_distinguished() {
            assert!(process_alive(std::process::id()));
            let mut sleeper = spawn_sleeper();
            let pid = sleeper.0.id();
            assert!(process_alive(pid));
            sleeper.0.kill().expect("kill sleeper");
            sleeper.0.wait().expect("reap sleeper");
            assert!(!process_alive(pid));
        }

        #[test]
        fn identity_requires_membership_in_the_named_job() {
            let job_id = format!("windows-identity-{}", uuid::Uuid::new_v4().as_simple());
            let sleeper = spawn_sleeper();
            let pid = sleeper.0.id();
            assert!(!process_matches_action(pid, "__run", &job_id));
            let _job = enroll_child(&sleeper.0, "__run", &job_id);
            assert!(process_matches_action(pid, "__run", &job_id));
            assert!(!process_matches_action(pid, "__run", "another-job"));
            assert!(!process_matches_action(
                pid,
                "__workspace_sync_run",
                &job_id
            ));
        }

        #[test]
        fn termination_stops_the_whole_job_and_reports_an_absent_leader() {
            let job_id = format!("windows-terminate-{}", uuid::Uuid::new_v4().as_simple());
            let mut sleeper = spawn_sleeper();
            let pid = sleeper.0.id();
            let job = enroll_child(&sleeper.0, "__run", &job_id);
            assert!(terminate_action(pid, "__run", &job_id).expect("terminate job"));
            assert_eq!(active_processes(&job).expect("accounting"), 0);
            sleeper.0.wait().expect("reap terminated sleeper");
            assert!(!terminate_action(pid, "__run", &job_id).expect("absent leader"));
        }

        #[test]
        fn termination_refuses_a_process_outside_the_job() {
            let job_id = format!("windows-unrelated-{}", uuid::Uuid::new_v4().as_simple());
            let sleeper = spawn_sleeper();
            let error = terminate_action(sleeper.0.id(), "__run", &job_id)
                .expect_err("an unenrolled process must not be terminated");
            assert!(error.to_string().contains("does not match job"));
            assert!(process_alive(sleeper.0.id()));
        }

        #[test]
        fn termination_refuses_the_current_process() {
            let error = terminate_action(std::process::id(), "__run", "self")
                .expect_err("the canceller must never terminate itself");
            assert!(error.to_string().contains("refusing to terminate"));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn job_names_are_scoped_to_namespace_action_and_job() {
        let base = job_object_names("openbitfun", "__run", "job-1");
        assert_ne!(base, job_object_names("openbitfun", "__run", "job-2"));
        assert_ne!(
            base,
            job_object_names("openbitfun", "__workspace_sync_run", "job-1")
        );
        assert_ne!(base, job_object_names("branded", "__run", "job-1"));
        assert_eq!(base, job_object_names("openbitfun", "__run", "job-1"));
        // Length-prefixed parts keep shifted boundaries apart.
        assert_ne!(
            job_object_names("ab", "c", "d"),
            job_object_names("a", "bc", "d")
        );
    }

    #[test]
    fn job_names_try_the_global_namespace_first_and_share_one_suffix() {
        let [global, local] = job_object_names("openbitfun", "__run", "job-1");
        let global_suffix = global.strip_prefix("Global\\").expect("global prefix");
        let local_suffix = local.strip_prefix("Local\\").expect("local prefix");
        assert_eq!(global_suffix, local_suffix);
    }

    #[test]
    fn job_names_are_valid_kernel_object_names_for_any_job_id() {
        for job_id in ["job-1", "a\\b/c:d", "ünïcødé", "", &"x".repeat(4096)] {
            for name in job_object_names("openbitfun", "__run", job_id) {
                let (_, rest) = name.split_once('\\').expect("namespace prefix");
                assert!(!rest.contains('\\'), "{name} has a second backslash");
                assert!(rest.chars().all(|c| c.is_ascii_alphanumeric() || c == '.'));
                assert!(name.len() < 64, "{name} is unexpectedly long");
            }
        }
    }

    #[test]
    fn breakaway_denial_inside_a_kill_on_close_job_fails_loudly() {
        let error = breakaway_denied_fallback(Some(true)).expect_err("must refuse");
        assert!(error.contains("cannot outlive"));
    }

    #[test]
    fn breakaway_denial_outside_a_kill_on_close_job_keeps_the_inherited_job() {
        assert!(breakaway_denied_fallback(Some(false)).is_ok());
        assert!(breakaway_denied_fallback(None).is_ok());
    }
}

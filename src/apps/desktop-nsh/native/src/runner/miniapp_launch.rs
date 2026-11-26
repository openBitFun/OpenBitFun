//! `--miniapp-launch <path>` handling for exported OS MiniApp launchers.
//!
//! Exported macOS `.app` launchers, Windows `.lnk` shortcuts, and Linux
//! `.desktop` entries invoke `openbitfun-nsh --miniapp-launch <launch.json>`.
//! If an OpenBitFun desktop host is already running for that profile, this
//! module forwards `"openLaunch"` over its private MiniApp IPC socket/pipe and
//! exits immediately so the running desktop opens the native NSH MiniApp
//! window. Otherwise, it seeds the process environment for the cold-starting
//! backend so the MiniApp window opens as soon as the NSH shell attaches.

use std::ffi::OsString;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const MINIAPP_PRESENTATION_PROTOCOL: u32 = 1;
const MAX_FRAME_BYTES: usize = 16 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LaunchRecord {
    launch_id: String,
    data_dir: PathBuf,
    #[serde(default)]
    user_root: Option<PathBuf>,
    #[serde(default)]
    host_channel: Option<String>,
    #[serde(default)]
    product_home: Option<PathBuf>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Endpoint {
    protocol_version: u32,
    address: String,
    token: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct IpcRequest<'a> {
    token: &'a str,
    protocol_version: u32,
    method: &'a str,
    params: Value,
}

fn endpoint_path(data_dir: &Path, channel: Option<&str>) -> PathBuf {
    let root = data_dir.join("miniapp-desktop");
    let dir = if channel == Some("development") {
        root.join("development")
    } else {
        root
    };
    dir.join("host.json")
}

fn parse_launch_arg(args: impl IntoIterator<Item = OsString>) -> Option<PathBuf> {
    let mut iter = args.into_iter().skip(1);
    while let Some(arg) = iter.next() {
        if arg == "--miniapp-launch" {
            return iter.next().map(PathBuf::from);
        }
        if let Some(value) = arg
            .to_str()
            .and_then(|s| s.strip_prefix("--miniapp-launch="))
        {
            if !value.is_empty() {
                return Some(PathBuf::from(value));
            }
        }
    }
    None
}

fn send_ipc_frame<S: Read + Write>(
    stream: &mut S,
    endpoint: &Endpoint,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    if endpoint.protocol_version != MINIAPP_PRESENTATION_PROTOCOL {
        return Err("MiniApp IPC protocol mismatch".to_string());
    }
    let request = IpcRequest {
        token: &endpoint.token,
        protocol_version: endpoint.protocol_version,
        method,
        params,
    };
    let payload = serde_json::to_vec(&request).map_err(|e| e.to_string())?;
    if payload.len() > MAX_FRAME_BYTES {
        return Err("MiniApp IPC frame too large".to_string());
    }
    stream
        .write_all(&(payload.len() as u32).to_be_bytes())
        .map_err(|e| e.to_string())?;
    stream.write_all(&payload).map_err(|e| e.to_string())?;
    stream.flush().map_err(|e| e.to_string())?;

    let mut len_buf = [0u8; 4];
    stream.read_exact(&mut len_buf).map_err(|e| e.to_string())?;
    let len = u32::from_be_bytes(len_buf) as usize;
    if len > MAX_FRAME_BYTES {
        return Err("MiniApp IPC response too large".to_string());
    }
    let mut body = vec![0u8; len];
    stream.read_exact(&mut body).map_err(|e| e.to_string())?;
    let reply: Result<Value, String> = serde_json::from_slice(&body).map_err(|e| e.to_string())?;
    reply
}

#[cfg(unix)]
fn call_running_host(endpoint: &Endpoint, launch_id: &str) -> Result<Value, String> {
    let mut stream =
        std::os::unix::net::UnixStream::connect(&endpoint.address).map_err(|e| e.to_string())?;
    let timeout = Some(std::time::Duration::from_secs(5));
    let _ = stream.set_read_timeout(timeout);
    let _ = stream.set_write_timeout(timeout);
    send_ipc_frame(
        &mut stream,
        endpoint,
        "openLaunch",
        json!({ "launchId": launch_id }),
    )
}

#[cfg(windows)]
fn call_running_host(endpoint: &Endpoint, launch_id: &str) -> Result<Value, String> {
    let mut stream = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(&endpoint.address)
        .map_err(|e| e.to_string())?;
    send_ipc_frame(
        &mut stream,
        endpoint,
        "openLaunch",
        json!({ "launchId": launch_id }),
    )
}

/// Inspects process CLI args for `--miniapp-launch <launch.json>`.
///
/// Returns `true` when the launch was forwarded to an already-running desktop
/// host and this helper process should exit immediately with success.
pub(crate) fn handle_cli_launch() -> bool {
    let Some(record_path) = parse_launch_arg(std::env::args_os()) else {
        return false;
    };
    let Ok(bytes) = std::fs::read(&record_path) else {
        eprintln!(
            "openbitfun-nsh: failed to read MiniApp launch record at {}",
            record_path.display()
        );
        return false;
    };
    let Ok(record) = serde_json::from_slice::<LaunchRecord>(&bytes) else {
        eprintln!(
            "openbitfun-nsh: invalid MiniApp launch record at {}",
            record_path.display()
        );
        return false;
    };

    let host_json = endpoint_path(&record.data_dir, record.host_channel.as_deref());
    if let Ok(endpoint_bytes) = std::fs::read(&host_json) {
        if let Ok(endpoint) = serde_json::from_slice::<Endpoint>(&endpoint_bytes) {
            if call_running_host(&endpoint, &record.launch_id).is_ok() {
                return true;
            }
        }
    }

    // No live host answered: configure this cold-starting process to use the
    // launch record's profile and open the MiniApp window once the shell attaches.
    // SAFETY: called single-threaded at the start of `main()` before spawning threads.
    unsafe {
        std::env::set_var("OPENBITFUN_PENDING_MINIAPP_LAUNCH", &record_path);
        if let Some(user_root) = &record.user_root {
            if !user_root.as_os_str().is_empty() {
                std::env::set_var("OPENBITFUN_USER_ROOT", user_root);
            }
        }
        if record.host_channel.as_deref() == Some("development") {
            std::env::set_var("OPENBITFUN_DESKTOP_HOST_CHANNEL", "development");
        }
        if let Some(home) = &record.product_home {
            if !home.as_os_str().is_empty() {
                std::env::set_var("OPENBITFUN_HOME", home);
            }
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_launch_argument_in_both_forms() {
        assert_eq!(
            parse_launch_arg([
                OsString::from("openbitfun-nsh"),
                OsString::from("--miniapp-launch"),
                OsString::from("/tmp/launch.json"),
            ]),
            Some(PathBuf::from("/tmp/launch.json"))
        );
        assert_eq!(
            parse_launch_arg([
                OsString::from("openbitfun-nsh"),
                OsString::from("--miniapp-launch=/tmp/other.json"),
            ]),
            Some(PathBuf::from("/tmp/other.json"))
        );
        assert_eq!(parse_launch_arg([OsString::from("openbitfun-nsh")]), None);
    }

    #[test]
    fn resolves_default_and_development_endpoint_paths() {
        let base = Path::new("/data");
        assert_eq!(
            endpoint_path(base, None),
            PathBuf::from("/data/miniapp-desktop/host.json")
        );
        assert_eq!(
            endpoint_path(base, Some("development")),
            PathBuf::from("/data/miniapp-desktop/development/host.json")
        );
    }

    #[cfg(unix)]
    #[test]
    fn forwards_open_launch_frame_over_unix_socket() {
        let socket_path = std::env::temp_dir().join(format!(
            "obf-miniapp-launch-test-{}.sock",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&socket_path);
        let listener = std::os::unix::net::UnixListener::bind(&socket_path).expect("bind socket");
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept");
            let mut len_buf = [0u8; 4];
            stream.read_exact(&mut len_buf).expect("len");
            let mut body = vec![0u8; u32::from_be_bytes(len_buf) as usize];
            stream.read_exact(&mut body).expect("body");
            let req: Value = serde_json::from_slice(&body).expect("json");
            assert_eq!(req["token"], "tok");
            assert_eq!(req["protocolVersion"], 1);
            assert_eq!(req["method"], "openLaunch");
            assert_eq!(req["params"]["launchId"], "launch-123");
            let reply = serde_json::to_vec(&Ok::<Value, String>(json!({"opened": true}))).unwrap();
            stream
                .write_all(&(reply.len() as u32).to_be_bytes())
                .unwrap();
            stream.write_all(&reply).unwrap();
        });

        let endpoint = Endpoint {
            protocol_version: 1,
            address: socket_path.to_string_lossy().into_owned(),
            token: "tok".to_string(),
        };
        let answer = call_running_host(&endpoint, "launch-123").expect("ipc reply");
        assert_eq!(answer, json!({"opened": true}));
        server.join().expect("server thread");
        let _ = std::fs::remove_file(&socket_path);
    }
}

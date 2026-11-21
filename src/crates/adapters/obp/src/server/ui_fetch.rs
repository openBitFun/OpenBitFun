//! Web UI files by hash on the mesh listener: the third opening of a Link
//! stream, next to TLS (account devices, paired phones) and the end-to-end
//! channel (browsers through the gateway).
//!
//! The server's pool (`openbitfun-link-gateway`, `/app/cas/`) pulls a file it
//! has not stored yet from the device whose bundle lists it:
//!
//! ```text
//! GET /obp-ui/v1/<sha256> HTTP/1.1\r\n...\r\n\r\n
//! ```
//!
//! The answer is `200` with the bytes of the bundle file, or of its `.br`
//! sibling (then with `Content-Encoding: br`), whose own SHA-256 is
//! `<sha256>`, as `application/octet-stream` with `Content-Length`; `404` for
//! any hash not in this host's current manifest (or when it ships no
//! bundle); `400` for a malformed request; `405` for another method; `503`
//! while every fetch slot stays busy. One request per stream, then close.
//! It serves only the public bundle files listed in the manifest (no user
//! data), re-checks their bytes on every read, and only account network
//! members reach it (Link). Browsers never trust these bytes: they check
//! each file against the manifest they got over the end-to-end channel.
//!
//! The same opening answers `GET /obp/mesh/info` with this device's public
//! mesh facts (the JSON the TLS listener serves at that path: device id,
//! protocol, capabilities such as `fleet_v1`, version, certificate
//! fingerprint and `fleetLoad`), so the gateway can rank entry candidates
//! without a TLS handshake. Nothing in it is secret. Older devices answer
//! `404` (or close), which a reader treats as "unknown".

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};

use super::mesh::HANDSHAKE_TIMEOUT;
use super::ObpServer;
use crate::authority::MeshIo;
use crate::ui_bundle::{is_sha256_hex, FileEncoding, UiFile, FETCH_PATH_PREFIX};

/// The first byte of the only request this opening takes (`GET`).
pub(crate) const FIRST_BYTE: u8 = b'G';
/// Fetches served at once; more wait for a slot.
pub(crate) const MAX_CONCURRENT: usize = 8;
/// How long a fetch waits for a slot before `503`.
const SLOT_WAIT: Duration = Duration::from_secs(10);
/// The largest request head read.
const MAX_HEAD_BYTES: usize = 8 * 1024;

/// What a request asks for, or how it is refused.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Request {
    Fetch(String),
    /// `GET /obp/mesh/info`.
    Info,
    Refuse(u16, &'static str),
}

/// The info path served on this opening.
pub(crate) const INFO_PATH: &str = "/obp/mesh/info";

/// Reads the request line of `head` (`GET /obp-ui/v1/<sha256> HTTP/1.x`).
pub(crate) fn parse_request(head: &[u8]) -> Request {
    let Ok(text) = std::str::from_utf8(head) else {
        return Request::Refuse(400, "the request is not text");
    };
    let line = text.split("\r\n").next().unwrap_or_default();
    let parts: Vec<&str> = line.split(' ').collect();
    let [method, target, version] = parts[..] else {
        return Request::Refuse(400, "malformed request line");
    };
    if version != "HTTP/1.1" && version != "HTTP/1.0" {
        return Request::Refuse(400, "unsupported HTTP version");
    }
    if method != "GET" {
        return Request::Refuse(405, "only GET is served here");
    }
    if target == INFO_PATH {
        return Request::Info;
    }
    match target.strip_prefix(FETCH_PATH_PREFIX) {
        Some(hash) if is_sha256_hex(hash) => Request::Fetch(hash.to_string()),
        _ => Request::Refuse(404, "not found"),
    }
}

fn reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        400 => "Bad Request",
        404 => "Not Found",
        405 => "Method Not Allowed",
        431 => "Request Header Fields Too Large",
        503 => "Service Unavailable",
        _ => "Error",
    }
}

/// The response head and body for `status` (`file` for a `200`).
pub(crate) fn response(status: u16, file: Option<&UiFile>, message: &str) -> (String, Vec<u8>) {
    let mut head = format!("HTTP/1.1 {status} {}\r\n", reason(status));
    let body = match file {
        Some(file) => {
            head.push_str("Content-Type: application/octet-stream\r\n");
            if file.encoding == FileEncoding::Brotli {
                head.push_str("Content-Encoding: br\r\n");
            }
            file.bytes.to_vec()
        }
        None => {
            head.push_str("Content-Type: text/plain; charset=utf-8\r\n");
            if status == 405 {
                head.push_str("Allow: GET\r\n");
            }
            if status == 503 {
                head.push_str("Retry-After: 1\r\n");
            }
            format!("{message}\n").into_bytes()
        }
    };
    head.push_str(&format!(
        "Content-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        body.len()
    ));
    (head, body)
}

/// The `200` answer to `GET /obp/mesh/info`, or `503` while signed out.
pub(crate) fn info_response(info: Option<&crate::authority::MeshInfo>) -> (String, Vec<u8>) {
    let Some(body) = info.and_then(|info| serde_json::to_vec(info).ok()) else {
        return response(
            503,
            None,
            "mesh_signed_out: this device is not signed in to an account mesh",
        );
    };
    let head = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        body.len()
    );
    (head, body)
}

/// Reads up to the end of the request head.
async fn read_head(stream: &mut Box<dyn MeshIo>) -> std::io::Result<Option<Vec<u8>>> {
    let mut head = Vec::with_capacity(512);
    let mut chunk = [0u8; 1024];
    loop {
        if head.windows(4).any(|window| window == b"\r\n\r\n") {
            return Ok(Some(head));
        }
        if head.len() >= MAX_HEAD_BYTES {
            return Ok(None);
        }
        let read = stream.read(&mut chunk).await?;
        if read == 0 {
            return Err(std::io::ErrorKind::UnexpectedEof.into());
        }
        head.extend_from_slice(&chunk[..read]);
    }
}

/// The file `hash` names in this host's current bundle (status, file, text).
async fn lookup(server: &Arc<ObpServer>, hash: String) -> (u16, Option<UiFile>, String) {
    let slots = Arc::clone(&server.ui_fetch_slots);
    let Ok(Ok(_permit)) = tokio::time::timeout(SLOT_WAIT, slots.acquire_owned()).await else {
        return (503, None, "busy; retry".to_string());
    };
    let source = Arc::clone(server.ui_bundle());
    let found = tokio::task::spawn_blocking(move || match source.current() {
        Ok(bundle) => Ok(bundle.read(&hash)),
        Err(reason) => Err(reason),
    })
    .await;
    match found {
        Ok(Ok(Some(file))) => (200, Some(file), String::new()),
        Ok(Ok(None)) => (404, None, "not in this device's web UI bundle".to_string()),
        Ok(Err(reason)) => (404, None, reason),
        Err(_) => (404, None, "the bundle could not be read".to_string()),
    }
}

/// Serves one fetch on an inbound mesh stream, then closes it.
pub(crate) async fn serve(server: Arc<ObpServer>, mut stream: Box<dyn MeshIo>, peer: SocketAddr) {
    let head = match tokio::time::timeout(HANDSHAKE_TIMEOUT, read_head(&mut stream)).await {
        Ok(Ok(Some(head))) => Some(head),
        Ok(Ok(None)) => None,
        Ok(Err(_)) | Err(_) => {
            log::debug!("OBP UI fetch closed before its request: peer={}", peer);
            return;
        }
    };
    let (status, head, body) = match head.as_deref().map(parse_request) {
        Some(Request::Info) => {
            let info = server.mesh_info();
            let (head, body) = info_response(info.as_ref());
            (if info.is_some() { 200 } else { 503 }, head, body)
        }
        request => {
            let (status, file, message) = match request {
                Some(Request::Fetch(hash)) => lookup(&server, hash).await,
                Some(Request::Refuse(status, message)) => (status, None, message.to_string()),
                _ => (431, None, "request head too large".to_string()),
            };
            let (head, body) = response(status, file.as_ref(), &message);
            (status, head, body)
        }
    };
    let written = async {
        stream.write_all(head.as_bytes()).await?;
        stream.write_all(&body).await?;
        stream.flush().await?;
        stream.shutdown().await
    };
    match tokio::time::timeout(Duration::from_secs(120), written).await {
        Ok(Ok(())) => log::debug!(
            "OBP UI fetch answered: peer={}, status={}, bytes={}",
            peer,
            status,
            body.len()
        ),
        Ok(Err(error)) => {
            log::debug!("OBP UI fetch write failed: peer={}, error={}", peer, error)
        }
        Err(_) => log::debug!("OBP UI fetch write timed out: peer={}", peer),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_lines_are_read_strictly() {
        let hash = "a".repeat(64);
        assert_eq!(
            parse_request(format!("GET /obp-ui/v1/{hash} HTTP/1.1\r\nHost: x\r\n\r\n").as_bytes()),
            Request::Fetch(hash.clone())
        );
        assert_eq!(
            parse_request(format!("GET /obp-ui/v1/{hash} HTTP/1.0\r\n\r\n").as_bytes()),
            Request::Fetch(hash.clone())
        );
        let refused = |head: String| match parse_request(head.as_bytes()) {
            Request::Refuse(status, _) => status,
            Request::Fetch(hash) => panic!("{head:?} fetched {hash}"),
            Request::Info => panic!("{head:?} asked for the info"),
        };
        assert_eq!(
            refused(format!("POST /obp-ui/v1/{hash} HTTP/1.1\r\n\r\n")),
            405
        );
        assert_eq!(
            refused(format!(
                "GET /obp-ui/v1/{} HTTP/1.1\r\n\r\n",
                "A".repeat(64)
            )),
            404
        );
        assert_eq!(
            refused(format!("GET /obp-ui/v1/{hash}/x HTTP/1.1\r\n\r\n")),
            404
        );
        assert_eq!(
            refused(format!("GET /obp-ui/v1/../{hash} HTTP/1.1\r\n\r\n")),
            404
        );
        assert_eq!(refused("GET /index.html HTTP/1.1\r\n\r\n".into()), 404);
        assert_eq!(
            refused(format!("GET /obp-ui/v1/{hash} HTTP/2\r\n\r\n")),
            400
        );
        assert_eq!(
            refused(format!("GET  /obp-ui/v1/{hash} HTTP/1.1\r\n\r\n")),
            400
        );
        assert_eq!(refused("GET\r\n\r\n".into()), 400);
        assert_eq!(
            parse_request(b"GET /obp/mesh/info HTTP/1.1\r\nHost: x\r\n\r\n"),
            Request::Info
        );
        assert_eq!(refused("GET /obp/mesh/info/x HTTP/1.1\r\n\r\n".into()), 404);
        assert_eq!(refused("POST /obp/mesh/info HTTP/1.1\r\n\r\n".into()), 405);
    }

    #[test]
    fn brotli_files_are_marked_and_plain_files_are_not() {
        let plain = UiFile {
            bytes: b"abc".to_vec().into(),
            encoding: FileEncoding::Identity,
        };
        let (head, body) = response(200, Some(&plain), "");
        assert!(head.starts_with("HTTP/1.1 200 OK\r\n"));
        assert!(head.contains("Content-Type: application/octet-stream\r\n"));
        assert!(head.contains("Content-Length: 3\r\n"));
        assert!(!head.to_ascii_lowercase().contains("content-encoding"));
        assert_eq!(body, b"abc");
        let br = UiFile {
            bytes: b"xy".to_vec().into(),
            encoding: FileEncoding::Brotli,
        };
        let (head, _) = response(200, Some(&br), "");
        assert!(head.contains("Content-Encoding: br\r\n"));
        let (head, body) = response(404, None, "not found");
        assert!(head.starts_with("HTTP/1.1 404 Not Found\r\n"));
        assert_eq!(body, b"not found\n");
    }
}

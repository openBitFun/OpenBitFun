//! The mesh listener's three openings on one port: TLS (account devices and
//! paired phones), the end-to-end channel (browsers through the gateway) and
//! the plain web UI fetch by hash (the server's pool), plus the `hello`
//! hint and `ui_bundle_manifest`.

use std::net::SocketAddr;
use std::sync::Arc;

use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use super::e2e_tests::{open_channel, Tamper};
use super::mesh_tests::{device, device_crypto, EchoBackend, ALICE, BOB};
use super::test_http::Client;
use super::*;
use crate::sha256_hex;
use crate::ui_bundle::tests::{write_bundle, APP, INDEX, INDEX_BR};
use crate::ui_bundle::{bundle_id, MANIFEST_FILE};

async fn server_with_bundle(
    device_id: &str,
    peer: &str,
    bundle: bool,
) -> (Arc<ObpServer>, tempfile::TempDir) {
    let dir = tempfile::tempdir().unwrap();
    let web = dir.path().join("nsh-web");
    std::fs::create_dir_all(&web).unwrap();
    if bundle {
        write_bundle(
            &web,
            &[
                ("index.html", INDEX),
                ("index.html.br", INDEX_BR),
                ("index.html.gz", b"gz"),
                ("browser.b998e17dc5/app.js", APP),
            ],
        );
    }
    let mut options = ObpServerOptions::new(dir.path().join("obp"));
    options.loopback_port = 0;
    options.web_root = Some(web);
    let server = ObpServer::new(
        Arc::new(EchoBackend {
            hub: EventHub::new(16),
        }),
        options,
    )
    .unwrap();
    server
        .start_mesh(device(device_id, BOB, &[(peer, ALICE)]))
        .await
        .unwrap();
    (server, dir)
}

struct Fetched {
    status: u16,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

impl Fetched {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }
}

/// Sends `request` as the first bytes of a stream and reads to the close.
async fn raw_request(addr: SocketAddr, request: &[u8]) -> Fetched {
    let mut stream = tokio::net::TcpStream::connect(addr).await.unwrap();
    stream.write_all(request).await.unwrap();
    let mut raw = Vec::new();
    tokio::time::timeout(
        std::time::Duration::from_secs(10),
        stream.read_to_end(&mut raw),
    )
    .await
    .expect("the device closes after answering")
    .unwrap();
    let split = raw.windows(4).position(|w| w == b"\r\n\r\n").unwrap();
    let head = std::str::from_utf8(&raw[..split]).unwrap();
    let mut lines = head.split("\r\n");
    let status = lines
        .next()
        .unwrap()
        .split(' ')
        .nth(1)
        .unwrap()
        .parse()
        .unwrap();
    let headers = lines
        .filter_map(|line| line.split_once(": "))
        .map(|(key, value)| (key.to_string(), value.to_string()))
        .collect();
    Fetched {
        status,
        headers,
        body: raw[split + 4..].to_vec(),
    }
}

async fn fetch(addr: SocketAddr, hash: &str) -> Fetched {
    raw_request(
        addr,
        format!("GET /obp-ui/v1/{hash} HTTP/1.1\r\nHost: device\r\n\r\n").as_bytes(),
    )
    .await
}

#[tokio::test]
async fn one_mesh_port_takes_tls_the_end_to_end_channel_and_ui_fetches() {
    let (server, dir) = server_with_bundle("ui-desk", "ui-browser", true).await;
    let addr = server.mesh_addr().unwrap();
    let manifest: Value = serde_json::from_slice(
        &std::fs::read(dir.path().join("nsh-web").join(MANIFEST_FILE)).unwrap(),
    )
    .unwrap();
    let expected_id = bundle_id(&manifest).unwrap();

    // 1. Plain fetch by hash: the file, its `.br` sibling (marked), nothing else.
    let plain = fetch(addr, &sha256_hex(INDEX)).await;
    assert_eq!(plain.status, 200);
    assert_eq!(plain.body, INDEX);
    assert_eq!(
        plain.header("Content-Type"),
        Some("application/octet-stream")
    );
    assert_eq!(
        plain.header("Content-Length"),
        Some(INDEX.len().to_string().as_str())
    );
    assert_eq!(plain.header("Content-Encoding"), None);
    let br = fetch(addr, &sha256_hex(INDEX_BR)).await;
    assert_eq!(br.status, 200);
    assert_eq!(br.body, INDEX_BR);
    assert_eq!(br.header("Content-Encoding"), Some("br"));
    assert_eq!(sha256_hex(&br.body), sha256_hex(INDEX_BR));
    let nested = fetch(addr, &sha256_hex(APP)).await;
    assert_eq!((nested.status, nested.body.as_slice()), (200, APP));
    for unknown in [
        "0".repeat(64),
        sha256_hex(b"gz"),
        sha256_hex(&std::fs::read(dir.path().join("nsh-web").join(MANIFEST_FILE)).unwrap()),
    ] {
        let missing = fetch(addr, &unknown).await;
        assert_eq!(missing.status, 404, "{unknown}");
        assert!(missing.body.is_empty() || !missing.body.starts_with(b"<"));
    }
    let uppercase = raw_request(
        addr,
        format!("GET /obp-ui/v1/{} HTTP/1.1\r\n\r\n", "A".repeat(64)).as_bytes(),
    )
    .await;
    assert_eq!(uppercase.status, 404);
    // Only `G` selects the plain opening; anything else is a TLS attempt
    // and is dropped without an HTTP answer.
    let mut stream = tokio::net::TcpStream::connect(addr).await.unwrap();
    stream
        .write_all(format!("POST /obp-ui/v1/{} HTTP/1.1\r\n\r\n", sha256_hex(INDEX)).as_bytes())
        .await
        .unwrap();
    let mut raw = Vec::new();
    let _ = tokio::time::timeout(
        std::time::Duration::from_secs(15),
        stream.read_to_end(&mut raw),
    )
    .await;
    assert!(
        !raw.starts_with(b"HTTP/"),
        "a non-GET opening gets no HTTP answer"
    );
    let other_path = raw_request(addr, b"GET /index.html HTTP/1.1\r\n\r\n").await;
    assert_eq!(
        other_path.status, 404,
        "the plain opening serves only by hash"
    );
    let malformed = raw_request(addr, b"GARBAGE\r\n\r\n").await;
    assert_eq!(malformed.status, 400);
    let oversized = raw_request(addr, &[b'G'; 8192]).await;
    assert_eq!(oversized.status, 431);

    // 2. TLS on the same port: the paired-client routes and the mesh info.
    let info: Value = Client::new()
        .get(format!("https://{addr}/obp/mesh/info"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(info["deviceId"], "ui-desk");

    // 3. The end-to-end channel on the same port; its `hello` carries the
    // bundle id as a hint.
    let mut client = open_channel(
        addr,
        "ui-browser",
        ALICE,
        "ui-desk",
        device_crypto::public_key(&BOB),
        Tamper::default(),
    )
    .await
    .unwrap();
    let hello = client
        .rpc("hello", json!({ "protocol": 1, "client": "ui-fetch-test" }))
        .await;
    assert_eq!(hello["result"]["scope"], "account-device", "{hello}");
    assert_eq!(hello["result"]["uiBundleId"], expected_id.as_str());
    drop(client);

    // The command the hosts answer with.
    let answer = server.ui_bundle_manifest().await.unwrap();
    assert_eq!(answer["bundleId"], expected_id.as_str());
    assert_eq!(answer["manifest"], manifest);
    server.shutdown();
}

#[tokio::test]
async fn a_host_without_a_bundle_says_so_and_serves_nothing() {
    let (server, _dir) = server_with_bundle("ui-desk-none", "ui-browser-none", false).await;
    let addr = server.mesh_addr().unwrap();
    let missing = fetch(addr, &sha256_hex(INDEX)).await;
    assert_eq!(missing.status, 404);
    assert!(String::from_utf8_lossy(&missing.body).starts_with("ui_bundle_unavailable: "));
    let error = server.ui_bundle_manifest().await.unwrap_err();
    assert!(error.starts_with("ui_bundle_unavailable: "), "{error}");

    let mut client = open_channel(
        addr,
        "ui-browser-none",
        ALICE,
        "ui-desk-none",
        device_crypto::public_key(&BOB),
        Tamper::default(),
    )
    .await
    .unwrap();
    let hello = client.rpc("hello", json!({ "protocol": 1 })).await;
    assert!(hello["result"].get("uiBundleId").is_none(), "{hello}");
    drop(client);
    server.shutdown();
}

#[tokio::test]
async fn fetches_beyond_the_cap_wait_for_a_slot() {
    let (server, _dir) = server_with_bundle("ui-desk-cap", "ui-browser-cap", true).await;
    let addr = server.mesh_addr().unwrap();
    // Hold every slot: further fetches queue, then complete once released.
    let held = Arc::clone(&server.ui_fetch_slots)
        .acquire_many_owned(ui_fetch::MAX_CONCURRENT as u32)
        .await
        .unwrap();
    let waiting = tokio::spawn(async move { fetch(addr, &sha256_hex(APP)).await });
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    assert!(!waiting.is_finished());
    drop(held);
    let fetched = waiting.await.unwrap();
    assert_eq!((fetched.status, fetched.body.as_slice()), (200, APP));
    server.shutdown();
}

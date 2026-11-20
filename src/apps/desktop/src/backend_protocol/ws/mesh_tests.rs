//! OBP over the account mesh.
//!
//! The unit tests drive the real mesh listener and the real client helper
//! through a minimal local SOCKS5 forwarder (standing in for the EasyTier
//! sidecar), with device pair keys derived from real X25519 device keys.
//!
//! `mesh_e2e_*` (ignored) runs the whole path for real: two EasyTier
//! sidecars join a throwaway `obf-` network through the relay node, and one
//! backend calls the other and streams its events over the mesh:
//!
//! ```text
//! OPENBITFUN_EASYTIER_DIR=target/easytier/macos-aarch64 \
//! OPENBITFUN_MESH_E2E_PEER=wss://remote.openbitfun.com:443/mesh/et/ \
//!   cargo test -p openbitfun-desktop --lib mesh_e2e -- --ignored --nocapture --test-threads 1
//! ```

use std::collections::HashMap;
use std::net::{Ipv4Addr, SocketAddr};
use std::sync::Arc;
use std::time::{Duration, Instant};

use openbitfun_services_integrations::remote_connect::device_crypto;
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

use super::mesh_client::{MeshConnectOptions, MeshDialer, MeshTarget};
use super::*;
use crate::backend_protocol::EventHub;

struct EchoBackend {
    hub: Arc<EventHub>,
}

impl ObpBackend for EchoBackend {
    fn dispatch(&self, command: String, args: Value) -> ObpDispatchFuture {
        let hub = Arc::clone(&self.hub);
        Box::pin(async move {
            match command.as_str() {
                "open_workspace" => Ok(json!({ "command": command, "args": args })),
                // A registry `Proxied` command stands in for any command that
                // produces events (non-owner scopes run registry commands only).
                "page_list" => {
                    let count = args["count"].as_u64().unwrap_or(1);
                    for index in 0..count {
                        hub.publish("agentic://text-chunk", json!({ "index": index }));
                    }
                    hub.publish("account://login-state", json!({ "logged_in": true }));
                    hub.publish("mesh://status-changed", json!({ "state": "running" }));
                    hub.publish("agentic://tool-event", json!({ "done": true }));
                    Ok(Value::Null)
                }
                // Detached-dispatch target verb: stands in for the CLI runner.
                "dispatch_target_probe" => Ok(json!({ "routed": command, "args": args })),
                // The bot lane runs the real host-verb router (its refusals
                // are deterministic without a running agent runtime).
                "obp_remote_command" => match super::mesh_verbs::route(&command, args) {
                    Some(future) => future.await,
                    None => Err("obp_remote_command was not routed".to_string()),
                },
                other => Err(crate::host::unsupported_in_native_host(other)),
            }
        })
    }

    fn events(&self) -> Arc<EventHub> {
        Arc::clone(&self.hub)
    }

    fn info(&self) -> Value {
        json!({ "version": "9.9.9-mesh", "platform": "test", "dataDir": "/secret/data" })
    }
}

/// A device with a real X25519 key; its directory knows `peers`.
struct TestAuthority {
    device_id: String,
    secret: [u8; 32],
    directory: HashMap<String, [u8; 32]>,
}

impl MeshAuthority for TestAuthority {
    fn local_device_id(&self) -> Option<String> {
        Some(self.device_id.clone())
    }

    fn pair_key<'a>(&'a self, device_id: &'a str) -> PairKeyFuture<'a> {
        Box::pin(async move {
            let public = self
                .directory
                .get(device_id)
                .ok_or_else(|| format!("device {device_id} is not in this account"))?;
            device_crypto::derive_message_key(&self.secret, public).map_err(|e| e.to_string())
        })
    }
}

fn device(id: &str, secret: [u8; 32], known: &[(&str, [u8; 32])]) -> Arc<TestAuthority> {
    Arc::new(TestAuthority {
        device_id: id.to_string(),
        secret,
        directory: known
            .iter()
            .map(|(id, secret)| (id.to_string(), device_crypto::public_key(secret)))
            .collect(),
    })
}

async fn server(
    authority: Arc<TestAuthority>,
) -> (Arc<ObpServer>, Arc<EventHub>, tempfile::TempDir) {
    let dir = tempfile::tempdir().unwrap();
    let hub = EventHub::new(256);
    let mut options = ObpServerOptions::new(dir.path().join("obp"));
    options.loopback_port = 0;
    let server = ObpServer::new(
        Arc::new(EchoBackend {
            hub: Arc::clone(&hub),
        }),
        options,
    )
    .unwrap();
    server.start_mesh(authority).await.unwrap();
    (server, hub, dir)
}

/// SOCKS5 CONNECT forwarder that sends every connection to 127.0.0.1 at the
/// requested port, the way a no-TUN EasyTier node delivers inbound mesh TCP.
async fn fake_sidecar_socks5() -> SocketAddr {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        loop {
            let Ok((mut client, _)) = listener.accept().await else {
                return;
            };
            tokio::spawn(async move {
                let mut greeting = [0u8; 3];
                client.read_exact(&mut greeting).await.ok()?;
                client.write_all(&[5, 0]).await.ok()?;
                let mut request = [0u8; 10];
                client.read_exact(&mut request).await.ok()?;
                let port = u16::from_be_bytes([request[8], request[9]]);
                let Ok(mut upstream) = TcpStream::connect((Ipv4Addr::LOCALHOST, port)).await else {
                    client
                        .write_all(&[5, 5, 0, 1, 0, 0, 0, 0, 0, 0])
                        .await
                        .ok()?;
                    return None;
                };
                client
                    .write_all(&[5, 0, 0, 1, 0, 0, 0, 0, 0, 0])
                    .await
                    .ok()?;
                tokio::io::copy_bidirectional(&mut client, &mut upstream)
                    .await
                    .ok()
            });
        }
    });
    addr
}

/// Tests whose servers share a device id scan the same mesh port range;
/// they hold this so a range scan cannot find the other test's listener.
static SHARED_DEVICE_ID_RANGE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

const ALICE: [u8; 32] = [11; 32];
const BOB: [u8; 32] = [23; 32];
const MALLORY: [u8; 32] = [31; 32];

#[tokio::test]
async fn account_devices_call_and_stream_with_the_device_handshake() {
    let _range = SHARED_DEVICE_ID_RANGE.lock().await;
    let bob = device("bob-device", BOB, &[("alice-device", ALICE)]);
    let (server, _hub, _dir) = server(Arc::clone(&bob)).await;
    let port = server.mesh_addr().unwrap().port();
    assert!((openbitfun_mesh_service::MESH_OBP_PORT_FIRST
        ..=openbitfun_mesh_service::MESH_OBP_PORT_LAST)
        .contains(&port));
    assert_eq!(server.status().mesh_port, Some(port));

    let dialer = MeshDialer {
        socks5: fake_sidecar_socks5().await,
        authority: device("alice-device", ALICE, &[("bob-device", BOB)]),
    };
    let target = MeshTarget {
        device_id: "bob-device".into(),
        virtual_ip: Ipv4Addr::new(10, 126, 126, 2),
        port: None,
    };
    let (found, info) = dialer.locate(&target).await.unwrap();
    assert_eq!(found, port);
    assert_eq!(info.device_id, "bob-device");
    assert!(info.capabilities.contains(&"mesh_v1".to_string()));

    let mut connection = dialer
        .connect(&target, MeshConnectOptions::default())
        .await
        .unwrap();
    let hello = connection.hello().clone();
    assert_eq!(hello["scope"], "account-device");
    assert!(hello["capabilities"]
        .as_array()
        .unwrap()
        .contains(&json!("mesh_v1")));
    assert!(hello["backend"].get("dataDir").is_none());
    assert_eq!(server.status().account_device_connections, 1);

    let echoed = connection
        .call("open_workspace", json!({ "request": { "path": "/w" } }))
        .await
        .unwrap();
    assert_eq!(echoed["args"]["request"]["path"], "/w");
    // Registry allowlist: controller-local commands stay with the owner.
    let refused = connection
        .call(
            "obp_set_lan_enabled",
            json!({ "request": { "enabled": true } }),
        )
        .await
        .unwrap_err();
    assert_eq!(refused.code, -32003);
    let refused = connection.call("mesh_status", json!({})).await.unwrap_err();
    assert_eq!(refused.code, -32003);

    connection
        .call("page_list", json!({ "count": 5 }))
        .await
        .unwrap();
    let mut names = Vec::new();
    while names.len() < 6 {
        let event = tokio::time::timeout(Duration::from_secs(5), connection.next_event())
            .await
            .unwrap()
            .unwrap();
        names.push(event.event);
    }
    // Owner-only events (account, mesh) never cross to another device.
    assert!(names.iter().all(|name| !name.starts_with("account://")));
    assert!(names.iter().all(|name| !name.starts_with("mesh://")));
    assert_eq!(names.last().unwrap(), "agentic://tool-event");
    connection.close().await;

    server.stop_mesh();
    assert!(server.mesh_addr().is_none());
}

/// Detached Dispatch and IM bots between two new devices: the target verbs
/// and the `RemoteCommand` lane run over the account-device connection, and
/// both capabilities are negotiated in `/obp/mesh/info` and `hello`.
#[tokio::test]
async fn account_devices_run_dispatch_and_bot_host_verbs_over_the_mesh() {
    let bob = device("dispatch-target", BOB, &[("dispatch-controller", ALICE)]);
    // Distinct device ids: tests run in parallel and share the mesh port range.
    let (_server, _hub, _dir) = server(Arc::clone(&bob)).await;
    let dialer = MeshDialer {
        socks5: fake_sidecar_socks5().await,
        authority: device("dispatch-controller", ALICE, &[("dispatch-target", BOB)]),
    };
    let target = MeshTarget {
        device_id: "dispatch-target".into(),
        virtual_ip: Ipv4Addr::new(10, 126, 126, 2),
        port: None,
    };
    let (_, info) = dialer.locate(&target).await.unwrap();
    for capability in ["dispatch_target_v1", "remote_command_v1"] {
        assert!(
            info.capabilities.contains(&capability.to_string()),
            "{capability}"
        );
    }
    let connection = dialer
        .connect(&target, MeshConnectOptions::default())
        .await
        .unwrap();
    let advertised = connection.hello()["capabilities"]
        .as_array()
        .unwrap()
        .clone();
    assert!(advertised.contains(&json!("dispatch_target_v1")));
    assert!(advertised.contains(&json!("remote_command_v1")));

    let probe = connection
        .call("dispatch_target_probe", json!({ "workspacePath": "/w" }))
        .await
        .unwrap();
    assert_eq!(probe["routed"], "dispatch_target_probe");
    assert_eq!(probe["args"]["workspacePath"], "/w");

    // Admitted and routed to the host-verb router, which refuses the forms
    // that have their own OBP lane with the backend's own text.
    let refused = connection
        .call(
            "obp_remote_command",
            json!({ "command": { "cmd": "host_invoke", "command": "list_sessions", "args": {} } }),
        )
        .await
        .unwrap_err();
    assert_eq!(refused.code, -32000, "{refused}");
    assert!(
        refused.message.contains("host_invoke is not carried here"),
        "{refused}"
    );

    // Other host control-plane names stay with the legacy peer host.
    let refused = connection
        .call("peer_mode_ping", json!({}))
        .await
        .unwrap_err();
    assert_eq!(refused.code, -32003);
    connection.close().await;
}

#[tokio::test]
async fn strangers_impostors_and_browsers_are_refused() {
    let _range = SHARED_DEVICE_ID_RANGE.lock().await;
    let bob = device("bob-device", BOB, &[("alice-device", ALICE)]);
    let (server, _hub, _dir) = server(bob).await;
    let socks5 = fake_sidecar_socks5().await;
    let target = MeshTarget {
        device_id: "bob-device".into(),
        virtual_ip: Ipv4Addr::new(10, 126, 126, 2),
        port: server.mesh_addr().map(|addr| addr.port()),
    };

    // A device outside the account directory.
    let stranger = MeshDialer {
        socks5,
        authority: device("mallory-device", MALLORY, &[("bob-device", BOB)]),
    };
    let error = stranger
        .connect(&target, MeshConnectOptions::default())
        .await
        .err()
        .unwrap();
    assert!(
        error.contains("mesh_refused") && error.contains("403"),
        "{error}"
    );

    // Claiming Alice's id without Alice's key.
    let impostor = MeshDialer {
        socks5,
        authority: Arc::new(TestAuthority {
            device_id: "alice-device".into(),
            secret: MALLORY,
            directory: [("bob-device".to_string(), device_crypto::public_key(&BOB))].into(),
        }),
    };
    let error = impostor
        .connect(&target, MeshConnectOptions::default())
        .await
        .err()
        .unwrap();
    assert!(error.contains("401"), "{error}");

    // A server that cannot prove it is Bob (Alice's directory has another key
    // for Bob): the client refuses before the first OBP frame.
    let fooled = MeshDialer {
        socks5,
        authority: Arc::new(TestAuthority {
            device_id: "alice-device".into(),
            secret: ALICE,
            directory: [(
                "bob-device".to_string(),
                device_crypto::public_key(&MALLORY),
            )]
            .into(),
        }),
    };
    let error = fooled
        .connect(&target, MeshConnectOptions::default())
        .await
        .err()
        .unwrap();
    // Bob rejects the proof made with the wrong pair key first.
    assert!(
        error.contains("401") || error.contains("mesh_impostor"),
        "{error}"
    );

    // Wrong target id on that address.
    let alice = MeshDialer {
        socks5,
        authority: device("alice-device", ALICE, &[("carol-device", BOB)]),
    };
    let error = alice
        .connect(
            &MeshTarget {
                device_id: "carol-device".into(),
                ..target.clone()
            },
            MeshConnectOptions::default(),
        )
        .await
        .err()
        .unwrap();
    assert!(error.contains("belongs to device bob-device"), "{error}");
    assert_eq!(server.status().account_device_connections, 0);
}

/// A phone that joined the account mesh with the EasyTier app reaches the
/// mesh listener with a browser: it gets the web UI, pairs with a one-time
/// QR code and runs as `paired-client`; the device handshake still works on
/// the same port, and the LAN switch does not close mesh-served phones.
#[tokio::test]
async fn phones_on_the_mesh_pair_like_the_lan_and_devices_still_handshake() {
    use futures::{SinkExt, StreamExt};
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;
    use tokio_tungstenite::tungstenite::Message;

    let web = tempfile::tempdir().unwrap();
    std::fs::write(
        web.path().join("index.html"),
        "<!doctype html><html><head><title>t</title></head><body></body></html>",
    )
    .unwrap();
    let dir = tempfile::tempdir().unwrap();
    let hub = EventHub::new(256);
    let mut options = ObpServerOptions::new(dir.path().join("obp"));
    options.loopback_port = 0;
    options.web_root = Some(web.path().canonicalize().unwrap());
    let server = ObpServer::new(
        Arc::new(EchoBackend {
            hub: Arc::clone(&hub),
        }),
        options,
    )
    .unwrap();
    // Its own device id: tests run in parallel and the range scan of
    // another test must not find this server.
    let dana = device("dana-device", BOB, &[("alice-device", ALICE)]);
    server.start_mesh(dana).await.unwrap();
    let port = server.mesh_addr().unwrap().port();
    let base = format!("https://127.0.0.1:{port}");
    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap();

    // Unpaired: the UI loads, the session says why the socket will be refused.
    let index = client.get(format!("{base}/")).send().await.unwrap();
    assert_eq!(index.status().as_u16(), 200);
    assert!(index.headers()["content-security-policy"]
        .to_str()
        .unwrap()
        .contains("frame-ancestors 'none'"));
    let body = index.text().await.unwrap();
    assert!(
        body.contains(&format!("wss://127.0.0.1:{port}/obp")),
        "{body}"
    );
    let session: Value = client
        .get(format!("{base}/obp/session"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(session["authorized"], false);
    assert_eq!(session["listener"], "mesh");
    // Device discovery stays on the same port.
    let info: Value = client
        .get(format!("{base}/obp/mesh/info"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(info["deviceId"], "dana-device");

    // The mesh pairing QR names the virtual IP and pins the listener's cert.
    assert!(server.create_mesh_pairing(None, "not-an-ip").is_err());
    let offer = server
        .create_mesh_pairing(Some("Pixel".into()), "10.126.126.7")
        .unwrap();
    let fingerprint = server.mesh_fingerprint().unwrap();
    assert!(offer
        .url
        .starts_with(&format!("https://10.126.126.7:{port}/pair?code=")));
    assert_eq!(offer.qr_payload, format!("{}#fp={fingerprint}", offer.url));
    assert_eq!(offer.fingerprint, fingerprint);
    let code = offer.url.split("code=").nth(1).unwrap().to_string();

    let connect = |cookie: Option<String>| {
        let mut request = format!("wss://127.0.0.1:{port}/obp")
            .into_client_request()
            .unwrap();
        request.headers_mut().insert(
            "origin",
            format!("https://127.0.0.1:{port}").parse().unwrap(),
        );
        if let Some(cookie) = cookie {
            request
                .headers_mut()
                .insert("cookie", cookie.parse().unwrap());
        }
        tokio_tungstenite::connect_async_tls_with_config(
            request,
            None,
            false,
            Some(super::tests::tls_connector()),
        )
    };
    // No credential, no socket.
    assert!(connect(None).await.is_err());

    let paired = client
        .get(format!("{base}/pair?code={code}"))
        .header("user-agent", "Mozilla/5.0 (Linux; Android 15)")
        .send()
        .await
        .unwrap();
    assert_eq!(paired.status().as_u16(), 303);
    let cookie = paired.headers()["set-cookie"].to_str().unwrap().to_string();
    assert!(
        cookie.starts_with(&format!("obf_mesh_client_{port}=")),
        "{cookie}"
    );
    assert!(cookie.contains("Secure") && cookie.contains("HttpOnly"));
    let cookie = cookie.split(';').next().unwrap().to_string();
    let session: Value = client
        .get(format!("{base}/obp/session"))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(session["authorized"], true);
    assert_eq!(session["scope"], "paired-client");
    let listed = server.status().paired_clients;
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].name, "Android device browser");

    let (mut socket, _) = connect(Some(cookie.clone())).await.unwrap();
    socket
        .send(Message::Text(
            json!({"jsonrpc": "2.0", "id": 1, "method": "hello", "params": {"protocol": 1}})
                .to_string()
                .into(),
        ))
        .await
        .unwrap();
    let hello = loop {
        let Some(Ok(Message::Text(text))) = socket.next().await else {
            panic!("hello reply missing");
        };
        let frame: Value = serde_json::from_str(text.as_str()).unwrap();
        if frame["id"] == json!(1) {
            break frame;
        }
    };
    assert_eq!(hello["result"]["scope"], "paired-client");
    assert!(server.status().paired_clients[0].connected);

    // Another account device still authenticates on the same port.
    let dialer = MeshDialer {
        socks5: fake_sidecar_socks5().await,
        authority: device("alice-device", ALICE, &[("dana-device", BOB)]),
    };
    let target = MeshTarget {
        device_id: "dana-device".into(),
        virtual_ip: Ipv4Addr::new(10, 126, 126, 2),
        port: Some(port),
    };
    let connection = dialer
        .connect(&target, MeshConnectOptions::default())
        .await
        .unwrap();
    assert_eq!(connection.hello()["scope"], "account-device");
    connection.close().await;

    // Turning the LAN off leaves mesh-served phones connected...
    server.stop_lan();
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert!(server.status().paired_clients[0].connected);
    // ...stopping the mesh closes them.
    server.stop_mesh();
    let closed = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            match socket.next().await {
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => return true,
                Some(Ok(_)) => continue,
            }
        }
    })
    .await
    .unwrap();
    assert!(closed);
    assert!(server.create_mesh_pairing(None, "10.126.126.7").is_err());
}

#[test]
fn handshake_nonces_are_single_use() {
    let runtime = tokio::runtime::Runtime::new().unwrap();
    runtime.block_on(async {
        let bob = device("bob-device", BOB, &[]);
        let (server, _hub, _dir) = server(bob).await;
        let now = super::store::now_ms();
        assert!(server.consume_mesh_nonce("nonce-AAAAAAAAAAAAAAAA", now));
        assert!(!server.consume_mesh_nonce("nonce-AAAAAAAAAAAAAAAA", now + 1_000));
        // Expired entries are pruned after the clock window.
        assert!(server.consume_mesh_nonce(
            "nonce-AAAAAAAAAAAAAAAA",
            now + 3 * openbitfun_mesh_service::handshake::MAX_CLOCK_SKEW_MS
        ));
    });
}

// ---------------------------------------------------------------------------
// Live end-to-end over EasyTier and the relay node.

fn easytier_binaries() -> Option<openbitfun_mesh_service::EasyTierBinaries> {
    let platform = openbitfun_mesh_service::EasyTierBinaries::platform_dir_name()?;
    openbitfun_mesh_service::EasyTierBinaries::locate(&[std::path::PathBuf::from(env!(
        "CARGO_MANIFEST_DIR"
    ))
    .join("../../../target/easytier")
    .join(platform)])
}

fn ps_sample(pid: u32) -> Option<(u64, String)> {
    let output = std::process::Command::new("ps")
        .args(["-o", "rss=,time=", "-p", &pid.to_string()])
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let mut parts = text.split_whitespace();
    Some((parts.next()?.parse().ok()?, parts.next()?.to_string()))
}

async fn live_round(disable_p2p: bool) {
    use openbitfun_mesh_service::sidecar::{free_listener_port, free_loopback_port};
    use openbitfun_mesh_service::{
        MeshCredentials, MeshNodeConfig, MeshPath, MeshSidecar, MeshState, SidecarOptions,
    };

    let binaries = easytier_binaries().expect("set OPENBITFUN_EASYTIER_DIR or run fetch-easytier");
    let peer = std::env::var("OPENBITFUN_MESH_E2E_PEER")
        .unwrap_or_else(|_| "wss://remote.openbitfun.com:443/mesh/et/".to_string());
    let suffix = openbitfun_mesh_service::handshake::new_nonce()
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .take(10)
        .collect::<String>()
        .to_ascii_lowercase();
    let credentials = MeshCredentials {
        version: 1,
        network_name: format!("obf-e2e-{suffix}"),
        network_secret: openbitfun_mesh_service::handshake::new_nonce(),
        peers: vec![peer.clone()],
        easytier_version: None,
        issued_at: None,
    };
    let alice_id = format!("e2ealice{suffix}");
    let bob_id = format!("e2ebob{suffix}");
    let alice = device(&alice_id, ALICE, &[(&bob_id, BOB)]);
    let bob = device(&bob_id, BOB, &[(&alice_id, ALICE)]);
    let (alice_server, _alice_hub, _a) = server(Arc::clone(&alice)).await;
    let (bob_server, bob_hub, _b) = server(Arc::clone(&bob)).await;
    let work = tempfile::tempdir().unwrap();
    let sidecar = |id: &str, obp_port: u16| {
        let socks5_port = free_loopback_port().unwrap();
        MeshSidecar::start(SidecarOptions {
            binaries: binaries.clone(),
            work_dir: work.path().join(id),
            config: MeshNodeConfig {
                instance_name: format!("e2e-{id}"),
                hostname: id.to_string(),
                credentials: credentials.clone(),
                listener_port: Some(free_listener_port(0).unwrap()),
                socks5_port,
                inbound_tcp_ports: (
                    openbitfun_mesh_service::MESH_OBP_PORT_FIRST,
                    openbitfun_mesh_service::MESH_OBP_PORT_LAST,
                ),
                disable_p2p,
            },
            rpc_port: free_loopback_port().unwrap(),
            status_interval: Duration::from_secs(2),
            obp_port: Some(obp_port),
        })
    };
    let started = Instant::now();
    let alice_node = sidecar(&alice_id, alice_server.mesh_addr().unwrap().port());
    let bob_node = sidecar(&bob_id, bob_server.mesh_addr().unwrap().port());

    let mut seen = None;
    for _ in 0..90 {
        tokio::time::sleep(Duration::from_secs(1)).await;
        let status = alice_node.refresh().await;
        if let Some(peer) = status.peer(&bob_id) {
            // Nodes that join at the same moment can pick the same DHCP
            // address; EasyTier resolves it within seconds.
            if status.virtual_ip.as_deref() == Some(peer.virtual_ip.as_str()) {
                continue;
            }
            if !disable_p2p
                && peer.path != MeshPath::P2p
                && started.elapsed() < Duration::from_secs(45)
            {
                continue; // give hole punching a chance
            }
            seen = Some((status.clone(), peer.clone()));
            break;
        }
    }
    let (status, peer) = seen.expect("bob never appeared in alice's mesh");
    println!(
        "[mesh-e2e] mode={} joined_after_ms={} alice_ip={:?} relay_nodes={:?}",
        if disable_p2p {
            "relay-forced"
        } else {
            "default"
        },
        started.elapsed().as_millis(),
        status.virtual_ip,
        status
            .relay_nodes
            .iter()
            .map(|node| format!(
                "{}({:?}ms via {:?})",
                node.name, node.latency_ms, node.tunnel
            ))
            .collect::<Vec<_>>()
    );
    println!(
        "[mesh-e2e] bob as seen by alice: ip={} path={:?} hops={} latency_ms={:?} tunnel={:?}",
        peer.virtual_ip, peer.path, peer.hops, peer.latency_ms, peer.tunnel
    );
    assert_eq!(status.state, MeshState::Running);
    assert_ne!(status.virtual_ip.as_deref(), Some(peer.virtual_ip.as_str()));
    if disable_p2p {
        assert_eq!(peer.path, MeshPath::Relayed);
    }

    let dialer = MeshDialer {
        socks5: alice_node.socks5_addr(),
        authority: alice,
    };
    let target = MeshTarget {
        device_id: bob_id.clone(),
        virtual_ip: peer.virtual_ip.parse().unwrap(),
        port: None,
    };
    let connect_started = Instant::now();
    let mut connection = dialer
        .connect(&target, MeshConnectOptions::default())
        .await
        .expect("OBP over the mesh");
    println!(
        "[mesh-e2e] OBP connected (locate + TLS + device handshake + hello) in {} ms; scope={} capabilities={}",
        connect_started.elapsed().as_millis(),
        connection.hello()["scope"],
        connection.hello()["capabilities"]
    );
    assert_eq!(connection.hello()["scope"], "account-device");
    assert_eq!(bob_server.status().account_device_connections, 1);

    let mut samples = Vec::new();
    for index in 0..20 {
        let begun = Instant::now();
        let reply = connection
            .call("open_workspace", json!({ "request": { "index": index } }))
            .await
            .unwrap();
        samples.push(begun.elapsed().as_secs_f64() * 1000.0);
        assert_eq!(reply["args"]["request"]["index"], index);
    }
    samples.sort_by(|a, b| a.partial_cmp(b).unwrap());
    println!(
        "[mesh-e2e] OBP call RTT over 20 calls: min={:.1} ms p50={:.1} ms max={:.1} ms",
        samples[0], samples[10], samples[19]
    );
    let refused = connection
        .call(
            "obp_set_lan_enabled",
            json!({ "request": { "enabled": true } }),
        )
        .await
        .unwrap_err();
    assert_eq!(refused.code, -32003);

    let stream_started = Instant::now();
    connection
        .call("page_list", json!({ "count": 500 }))
        .await
        .unwrap();
    let mut received = 0usize;
    let mut last = String::new();
    while last != "agentic://tool-event" {
        let event = tokio::time::timeout(Duration::from_secs(20), connection.next_event())
            .await
            .expect("events keep flowing")
            .expect("open stream");
        assert!(!event.event.starts_with("account://") && !event.event.starts_with("mesh://"));
        received += 1;
        last = event.event;
    }
    println!(
        "[mesh-e2e] event stream: {} events (500 text chunks, coalescing allowed) in {} ms; bob last_seq={}",
        received,
        stream_started.elapsed().as_millis(),
        bob_hub.last_seq()
    );
    connection.close().await;

    let pid = alice_node.status().sidecar_pid.unwrap();
    let before = ps_sample(pid);
    tokio::time::sleep(Duration::from_secs(30)).await;
    let after = ps_sample(pid);
    println!(
        "[mesh-e2e] idle sidecar over 30 s (status probes every 2 s): rss/cpu-time before={before:?} after={after:?}"
    );
    alice_node.stop().await;
    bob_node.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "live: needs EasyTier binaries and the relay node"]
async fn mesh_e2e_default_path() {
    live_round(false).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "live: needs EasyTier binaries and the relay node"]
async fn mesh_e2e_relay_forced() {
    live_round(true).await;
}

// ── Peer Device Mode over the mesh (controller-side link) ────────────────────

/// Reaches devices through a test dialer (fake sidecar, real handshake).
struct DialerConnector {
    dialer: MeshDialer,
}

impl crate::mesh::peer_link::PeerConnector for DialerConnector {
    fn connect(
        &self,
        device_id: String,
        options: MeshConnectOptions,
    ) -> crate::mesh::peer_link::ConnectFuture {
        let dialer = self.dialer.clone();
        Box::pin(async move {
            let target = MeshTarget {
                device_id,
                virtual_ip: Ipv4Addr::new(10, 126, 126, 9),
                port: None,
            };
            dialer.connect(&target, options).await
        })
    }

    fn route(&self, _device_id: &str) -> Option<(String, Option<f64>)> {
        Some(("p2p".to_string(), Some(0.4)))
    }
}

async fn wait_for_events(
    links: &crate::mesh::peer_link::PeerLinks,
    device: &str,
    after: Option<u64>,
    want: impl Fn(&[Value]) -> bool,
) -> Vec<Value> {
    let mut seen = Vec::new();
    let mut cursor = after;
    let deadline = Instant::now() + Duration::from_secs(10);
    while Instant::now() < deadline {
        let batch = links
            .events(device, cursor, None, Duration::from_millis(500))
            .await
            .unwrap();
        for event in batch.events {
            if let Some(seq) = event["seq"].as_u64() {
                cursor = Some(seq);
            }
            seen.push(event);
        }
        if want(&seen) {
            break;
        }
    }
    seen
}

/// Two in-process backends over the mesh client: the controller's peer link
/// drives "dana" (calls with the exact Tauri args, live events with the
/// peer's own seq, owner-only events withheld, registry refusals passed
/// through), survives a dropped mesh connection by resuming after its last
/// seq, and closes.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn peer_device_mode_links_call_stream_and_resume_over_the_mesh() {
    let dana = device("dana-device", BOB, &[("erin-device", ALICE)]);
    let (server, hub, _dir) = server(Arc::clone(&dana)).await;
    let links = crate::mesh::peer_link::PeerLinks::new(Arc::new(DialerConnector {
        dialer: MeshDialer {
            socks5: fake_sidecar_socks5().await,
            authority: device("erin-device", ALICE, &[("dana-device", BOB)]),
        },
    }));

    let info = links.connect("dana-device").await.unwrap();
    assert_eq!(info.scope, "account-device");
    assert!(info.capabilities.contains(&"mesh_v1".to_string()));
    assert!(info.capabilities.contains(&"obp_v1".to_string()));
    assert!(info.host_capabilities.contains(&"tool_catalog".to_string()));
    assert_eq!(info.mesh_path.as_deref(), Some("p2p"));
    assert!(info.backend.get("dataDir").is_none());
    // Connecting again reuses the open link.
    links.connect("dana-device").await.unwrap();
    assert_eq!(server.status().account_device_connections, 1);

    // Calls carry the Tauri args unchanged and return the peer's own JSON.
    let echoed = links
        .call(
            "dana-device",
            "open_workspace",
            json!({ "request": { "path": "/srv" } }),
        )
        .await
        .unwrap();
    assert_eq!(echoed["args"], json!({ "request": { "path": "/srv" } }));
    // Registry refusals of the peer reach the controller as they are.
    let refused = links
        .call("dana-device", "account_delete_device", json!({}))
        .await
        .unwrap_err();
    assert!(refused.starts_with("forbidden_for_scope:"), "{refused}");

    // Live events: the peer's seq, owner-only events withheld.
    links
        .call("dana-device", "page_list", json!({ "count": 3 }))
        .await
        .unwrap();
    let events = wait_for_events(&links, "dana-device", None, |seen| {
        seen.iter()
            .any(|event| event["event"] == "agentic://tool-event")
    })
    .await;
    let names: Vec<&str> = events
        .iter()
        .filter_map(|event| event["event"].as_str())
        .collect();
    assert!(names.contains(&"agentic://text-chunk"), "{names:?}");
    assert!(names.contains(&"agentic://tool-event"), "{names:?}");
    assert!(!names.iter().any(|name| name.starts_with("account://")));
    assert!(!names.iter().any(|name| name.starts_with("mesh://")));
    let seqs: Vec<u64> = events.iter().filter_map(|e| e["seq"].as_u64()).collect();
    assert!(seqs.windows(2).all(|pair| pair[0] < pair[1]), "{seqs:?}");
    let cursor = *seqs.last().unwrap();
    assert_eq!(cursor, hub.last_seq());

    // Drop the mesh connection; events published meanwhile are replayed
    // after the link reconnects with its resume cursor.
    server.stop_mesh();
    hub.publish("agentic://text-chunk", json!({ "index": "while-away" }));
    let offline = links
        .call("dana-device", "open_workspace", json!({}))
        .await
        .unwrap_err();
    assert!(
        offline.starts_with("peer_reconnecting") || offline.starts_with("peer_unreachable"),
        "{offline}"
    );
    server.start_mesh(dana).await.unwrap();
    let resumed = wait_for_events(&links, "dana-device", Some(cursor), |seen| {
        seen.iter()
            .any(|event| event["payload"]["index"] == "while-away")
    })
    .await;
    assert!(
        resumed
            .iter()
            .any(|event| event["payload"]["index"] == "while-away"),
        "{resumed:?}"
    );
    assert!(resumed
        .iter()
        .all(|event| event["seq"].as_u64().is_some_and(|seq| seq > cursor)));
    // Calls work again on the resumed link.
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        match links.call("dana-device", "open_workspace", json!({})).await {
            Ok(_) => break,
            Err(error) if Instant::now() < deadline => {
                assert!(error.starts_with("peer_"), "{error}");
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
            Err(error) => panic!("the link did not resume: {error}"),
        }
    }

    // A cursor older than the link's ring gets an explicit drop notice.
    let stale = links
        .events(
            "dana-device",
            Some(0),
            Some("another-instance"),
            Duration::ZERO,
        )
        .await
        .unwrap();
    assert_eq!(
        stale.events[0]["event"],
        crate::backend_protocol::EVENTS_DROPPED_EVENT
    );
    assert!(stale.events[0].get("seq").is_none());

    assert!(links.disconnect("dana-device").await);
    let closed = links
        .call("dana-device", "open_workspace", json!({}))
        .await
        .unwrap_err();
    assert!(closed.starts_with("peer_link_closed"), "{closed}");
}

/// Peer Device Mode for real: two EasyTier sidecars join a throwaway `obf-`
/// network through the relay node, and the controller's peer link drives the
/// other backend over it while that backend streams paced text chunks (a
/// model's tokens). Prints when each chunk reached the controller's long poll.
///
/// ```text
/// OPENBITFUN_EASYTIER_DIR=target/easytier/macos-aarch64 \
///   cargo test -p openbitfun-desktop --lib peer_link_e2e -- --ignored --nocapture --test-threads 1
/// ```
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "live: needs EasyTier binaries and the relay node"]
async fn peer_link_e2e_streams_live_tokens_over_the_relay_node() {
    use openbitfun_mesh_service::sidecar::{free_listener_port, free_loopback_port};
    use openbitfun_mesh_service::{MeshCredentials, MeshNodeConfig, MeshSidecar, SidecarOptions};

    let binaries = easytier_binaries().expect("set OPENBITFUN_EASYTIER_DIR or run fetch-easytier");
    let peer_url = std::env::var("OPENBITFUN_MESH_E2E_PEER")
        .unwrap_or_else(|_| "wss://remote.openbitfun.com:443/mesh/et/".to_string());
    let suffix: String = openbitfun_mesh_service::handshake::new_nonce()
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .take(10)
        .collect::<String>()
        .to_ascii_lowercase();
    let credentials = MeshCredentials {
        version: 1,
        network_name: format!("obf-e2e-{suffix}"),
        network_secret: openbitfun_mesh_service::handshake::new_nonce(),
        peers: vec![peer_url],
        easytier_version: None,
        issued_at: None,
    };
    let controller_id = format!("e2ectl{suffix}");
    let target_id = format!("e2etgt{suffix}");
    let controller = device(&controller_id, ALICE, &[(&target_id, BOB)]);
    let target = device(&target_id, BOB, &[(&controller_id, ALICE)]);
    let (controller_server, _controller_hub, _c) = server(Arc::clone(&controller)).await;
    let (target_server, target_hub, _t) = server(Arc::clone(&target)).await;
    let work = tempfile::tempdir().unwrap();
    let sidecar = |id: &str, obp_port: u16| {
        MeshSidecar::start(SidecarOptions {
            binaries: binaries.clone(),
            work_dir: work.path().join(id),
            config: MeshNodeConfig {
                instance_name: format!("e2e-{id}"),
                hostname: id.to_string(),
                credentials: credentials.clone(),
                listener_port: Some(free_listener_port(0).unwrap()),
                socks5_port: free_loopback_port().unwrap(),
                inbound_tcp_ports: (
                    openbitfun_mesh_service::MESH_OBP_PORT_FIRST,
                    openbitfun_mesh_service::MESH_OBP_PORT_LAST,
                ),
                disable_p2p: std::env::var("OPENBITFUN_MESH_DISABLE_P2P").is_ok_and(|v| v == "1"),
            },
            rpc_port: free_loopback_port().unwrap(),
            status_interval: Duration::from_secs(2),
            obp_port: Some(obp_port),
        })
    };
    let started = Instant::now();
    let controller_node = sidecar(
        &controller_id,
        controller_server.mesh_addr().unwrap().port(),
    );
    let target_node = sidecar(&target_id, target_server.mesh_addr().unwrap().port());
    let mut found = None;
    for _ in 0..90 {
        tokio::time::sleep(Duration::from_secs(1)).await;
        let status = controller_node.refresh().await;
        if let Some(peer) = status.peer(&target_id) {
            if status.virtual_ip.as_deref() != Some(peer.virtual_ip.as_str()) {
                found = Some(peer.clone());
                break;
            }
        }
    }
    let peer = found.expect("the target never joined the controller's mesh");
    println!(
        "[peer-e2e] joined after {} ms: target ip={} path={:?} latency_ms={:?}",
        started.elapsed().as_millis(),
        peer.virtual_ip,
        peer.path,
        peer.latency_ms
    );

    struct LiveConnector {
        dialer: MeshDialer,
        ip: Ipv4Addr,
        path: String,
        latency: Option<f64>,
    }
    impl crate::mesh::peer_link::PeerConnector for LiveConnector {
        fn connect(
            &self,
            device_id: String,
            options: MeshConnectOptions,
        ) -> crate::mesh::peer_link::ConnectFuture {
            let dialer = self.dialer.clone();
            let ip = self.ip;
            Box::pin(async move {
                dialer
                    .connect(
                        &MeshTarget {
                            device_id,
                            virtual_ip: ip,
                            port: None,
                        },
                        options,
                    )
                    .await
            })
        }
        fn route(&self, _device_id: &str) -> Option<(String, Option<f64>)> {
            Some((self.path.clone(), self.latency))
        }
    }
    let links = crate::mesh::peer_link::PeerLinks::new(Arc::new(LiveConnector {
        dialer: MeshDialer {
            socks5: controller_node.socks5_addr(),
            authority: controller,
        },
        ip: peer.virtual_ip.parse().unwrap(),
        path: format!("{:?}", peer.path).to_lowercase(),
        latency: peer.latency_ms,
    }));
    let begun = Instant::now();
    let info = links
        .connect(&target_id)
        .await
        .expect("peer link over the mesh");
    println!(
        "[peer-e2e] peer_link_connect in {} ms: scope={} capabilities={:?} hostCapabilities={}",
        begun.elapsed().as_millis(),
        info.scope,
        info.capabilities,
        info.host_capabilities.len()
    );
    let mut rtts = Vec::new();
    for index in 0..10 {
        let begun = Instant::now();
        let reply = links
            .call(
                &target_id,
                "open_workspace",
                json!({ "request": { "index": index } }),
            )
            .await
            .unwrap();
        rtts.push(begun.elapsed().as_secs_f64() * 1000.0);
        assert_eq!(reply["args"]["request"]["index"], index);
    }
    rtts.sort_by(|a, b| a.partial_cmp(b).unwrap());
    println!(
        "[peer-e2e] peer_link_call RTT over 10 calls: min={:.1} ms p50={:.1} ms max={:.1} ms",
        rtts[0], rtts[5], rtts[9]
    );

    // A model streaming 40 tokens, 25 ms apart, on the target.
    let cursor = links
        .events(&target_id, None, None, Duration::ZERO)
        .await
        .unwrap()
        .events
        .iter()
        .filter_map(|event| event["seq"].as_u64())
        .last();
    let publisher = {
        let hub = Arc::clone(&target_hub);
        tokio::spawn(async move {
            let mut sent = Vec::new();
            for index in 0..40u64 {
                hub.publish(
                    "agentic://text-chunk",
                    json!({ "sessionId": "s", "turnId": "t", "roundId": "r", "text": format!("tok{index} ") }),
                );
                sent.push(Instant::now());
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
            sent
        })
    };
    // Token index -> when it reached the controller (a slow poll may merge
    // consecutive chunks into one event; each token is still counted).
    let mut arrivals: Vec<Option<Instant>> = vec![None; 40];
    let mut after = cursor;
    let deadline = Instant::now() + Duration::from_secs(20);
    while arrivals.iter().any(Option::is_none) && Instant::now() < deadline {
        let batch = links
            .events(&target_id, after, None, Duration::from_secs(5))
            .await
            .unwrap();
        let now = Instant::now();
        for event in batch.events {
            if let Some(seq) = event["seq"].as_u64() {
                after = Some(seq);
            }
            if let Some(text) = event["payload"]["text"].as_str() {
                for word in text.split_whitespace() {
                    if let Some(index) = word
                        .strip_prefix("tok")
                        .and_then(|i| i.parse::<usize>().ok())
                    {
                        if index < 40 && arrivals[index].is_none() {
                            arrivals[index] = Some(now);
                        }
                    }
                }
            }
        }
    }
    let sent = publisher.await.unwrap();
    let arrived: Vec<Instant> = arrivals.iter().flatten().copied().collect();
    assert_eq!(arrived.len(), 40, "only {} tokens arrived", arrived.len());
    let mut delays: Vec<f64> = arrived
        .iter()
        .zip(sent.iter())
        .map(|(got, put)| got.duration_since(*put).as_secs_f64() * 1000.0)
        .collect();
    let batches_spread_ms = arrived[39].duration_since(arrived[0]).as_millis();
    delays.sort_by(|a, b| a.partial_cmp(b).unwrap());
    println!(
        "[peer-e2e] 40 paced tokens: publish->controller long poll min={:.1} ms p50={:.1} ms max={:.1} ms; first-to-last arrival spread {} ms (publishing took ~1000 ms, so tokens arrived live, not in one pull)",
        delays[0], delays[20], delays[39], batches_spread_ms
    );
    assert!(batches_spread_ms > 500, "tokens arrived in one batch");
    assert!(links.disconnect(&target_id).await);
    controller_node.stop().await;
    target_node.stop().await;
}

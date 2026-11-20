//! OBP over the account device network (OpenBitFun Link).
//!
//! The tests drive the real mesh listener and the real client over loopback
//! TCP (standing in for Link's virtual streams), with device pair keys
//! derived from real X25519 device keys. The live runs over Link and the
//! relay node, and the desktop's own host verbs, are in the desktop's
//! `backend_protocol::ws::mesh_tests`.

use std::collections::HashMap;
use std::net::Ipv4Addr;
use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};

use crate::client::{LoopbackConnector, MeshConnectOptions, MeshDialer, MeshTarget};

use super::*;
use crate::events::EventHub;

/// The account directory's pair-key derivation (X25519 + HKDF-SHA256 over
/// both public keys, ordered), as `device_crypto` in the services layer
/// computes it for every host.
pub(super) mod device_crypto {
    use hkdf::Hkdf;
    use sha2::Sha256;
    use x25519_dalek::{PublicKey, StaticSecret};

    const KDF_SALT: &[u8] = b"OpenBitFun Relay v1.0.0 device key";

    pub(crate) fn public_key(secret: &[u8; 32]) -> [u8; 32] {
        PublicKey::from(&StaticSecret::from(*secret)).to_bytes()
    }

    pub(crate) fn derive_message_key(
        secret: &[u8; 32],
        peer_public: &[u8; 32],
    ) -> Result<[u8; 32], String> {
        let local_public = public_key(secret);
        let shared = StaticSecret::from(*secret).diffie_hellman(&PublicKey::from(*peer_public));
        if !shared.was_contributory() {
            return Err("invalid peer public key".to_string());
        }
        let (first, second) = if local_public < *peer_public {
            (&local_public, peer_public)
        } else {
            (peer_public, &local_public)
        };
        let mut info = [0u8; 64];
        info[..32].copy_from_slice(first);
        info[32..].copy_from_slice(second);
        let mut key = [0u8; 32];
        Hkdf::<Sha256>::new(Some(KDF_SALT), shared.as_bytes())
            .expand(&info, &mut key)
            .map_err(|_| "device message key derivation failed".to_string())?;
        Ok(key)
    }
}

pub(super) struct EchoBackend {
    pub(super) hub: Arc<EventHub>,
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
                // The bot lane: the host's router answers (the desktop's
                // refuses forms that have their own OBP lane like this).
                "obp_remote_command" => Err(format!(
                    "obp_remote_command: host_invoke is not carried here ({})",
                    args["command"]["cmd"].as_str().unwrap_or("-")
                )),
                other => Err(format!("{}: {other}", crate::UNSUPPORTED_IN_NATIVE_HOST)),
            }
        })
    }

    fn events(&self) -> Arc<EventHub> {
        Arc::clone(&self.hub)
    }

    fn info(&self) -> Value {
        json!({ "version": "9.9.9-mesh", "platform": "test", "dataDir": "/secret/data" })
    }

    fn is_account_device_host_verb(&self, command: &str) -> bool {
        command == "obp_remote_command" || command.starts_with("dispatch_target_")
    }

    fn mesh_capabilities(&self) -> Vec<&'static str> {
        vec!["dispatch_target_v1", "remote_command_v1"]
    }
}

/// A device with a real X25519 key; its directory knows `peers`.
pub(super) struct TestAuthority {
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
            device_crypto::derive_message_key(&self.secret, public)
        })
    }
}

pub(super) fn device(id: &str, secret: [u8; 32], known: &[(&str, [u8; 32])]) -> Arc<TestAuthority> {
    Arc::new(TestAuthority {
        device_id: id.to_string(),
        secret,
        directory: known
            .iter()
            .map(|(id, secret)| (id.to_string(), device_crypto::public_key(secret)))
            .collect(),
    })
}

pub(super) async fn server(
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

/// Tests whose servers share a device id scan the same mesh port range;
/// they hold this so a range scan cannot find the other test's listener.
static SHARED_DEVICE_ID_RANGE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

pub(super) const ALICE: [u8; 32] = [11; 32];
pub(super) const BOB: [u8; 32] = [23; 32];
pub(super) const MALLORY: [u8; 32] = [31; 32];

#[tokio::test]
async fn account_devices_call_and_stream_with_the_device_handshake() {
    let _range = SHARED_DEVICE_ID_RANGE.lock().await;
    let bob = device("bob-device", BOB, &[("alice-device", ALICE)]);
    let (server, _hub, _dir) = server(Arc::clone(&bob)).await;
    let port = server.mesh_addr().unwrap().port();
    assert!(
        (openbitfun_link::MESH_OBP_PORT_FIRST..=openbitfun_link::MESH_OBP_PORT_LAST)
            .contains(&port)
    );
    assert_eq!(server.status().mesh_port, Some(port));

    let dialer = MeshDialer {
        connector: Arc::new(LoopbackConnector),
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

    let connection = dialer
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
        connector: Arc::new(LoopbackConnector),
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
    let target = MeshTarget {
        device_id: "bob-device".into(),
        virtual_ip: Ipv4Addr::new(10, 126, 126, 2),
        port: server.mesh_addr().map(|addr| addr.port()),
    };

    // A device outside the account directory.
    let stranger = MeshDialer {
        connector: Arc::new(LoopbackConnector),
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
        connector: Arc::new(LoopbackConnector),
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
        connector: Arc::new(LoopbackConnector),
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
        connector: Arc::new(LoopbackConnector),
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

/// A phone or browser on the account device network reaches the
/// mesh listener with a browser: it gets the web UI, pairs with a one-time
/// QR code and runs as `paired-client`; the device handshake still works on
/// the same port, and stopping the network closes mesh-served phones.
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
    let _range = SHARED_DEVICE_ID_RANGE.lock().await;
    let dana = device("dana-device", BOB, &[("alice-device", ALICE)]);
    server.start_mesh(dana).await.unwrap();
    let port = server.mesh_addr().unwrap().port();
    let base = format!("https://127.0.0.1:{port}");
    let client = super::test_http::Client::new();

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
        connector: Arc::new(LoopbackConnector),
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

    // Stopping the mesh closes mesh-served phones.
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
        let bob = device("nonce-device", BOB, &[]);
        let (server, _hub, _dir) = server(bob).await;
        let now = crate::now_ms();
        assert!(server.consume_mesh_nonce("nonce-AAAAAAAAAAAAAAAA", now));
        assert!(!server.consume_mesh_nonce("nonce-AAAAAAAAAAAAAAAA", now + 1_000));
        // Expired entries are pruned after the clock window.
        assert!(server.consume_mesh_nonce(
            "nonce-AAAAAAAAAAAAAAAA",
            now + 3 * openbitfun_link::handshake::MAX_CLOCK_SKEW_MS
        ));
    });
}

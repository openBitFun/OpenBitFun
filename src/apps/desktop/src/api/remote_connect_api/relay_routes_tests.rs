use super::*;
use openbitfun_core::service::remote_connect::embedded_relay_host::EmbeddedRelayHost;
use openbitfun_relay_service::{build_relay_router, db, MemoryAssetStore};
use openbitfun_services_integrations::remote_connect::device_crypto;
use relay_routes::{DesktopEmbeddedRelayUnavailable, LAN_RELAY_RETIRED_ERROR};

struct FixtureHost {
    database: Arc<db::DbPool>,
    listener: tokio::sync::Mutex<Option<tokio::net::TcpListener>>,
    server: tokio::sync::Mutex<Option<tokio::task::JoinHandle<()>>>,
    port: u16,
    prefix: &'static str,
}

impl FixtureHost {
    async fn new(prefix: &'static str) -> Arc<Self> {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        Arc::new(Self {
            port: listener.local_addr().unwrap().port(),
            database: Arc::new(db::connect(":memory:").await.unwrap()),
            listener: tokio::sync::Mutex::new(Some(listener)),
            server: tokio::sync::Mutex::new(None),
            prefix,
        })
    }

    fn url(&self) -> String {
        format!("http://127.0.0.1:{}{}", self.port, self.prefix)
    }

    async fn sign_in_official_session(&self, session: &AccountSession) {
        *get_account_context().write().await = Some(AccountContextState {
            session: session.clone(),
            relay_url: self.url(),
        });
        // Login persists the credential. The next AuthOk supplies the device ID.
        persist_account_session(None, None).await.unwrap();
    }

    async fn credential(&self, device_id: &str, secret: [u8; 32]) -> AccountSession {
        db::UserRow::upsert_verified(&self.database, "42", "route-test")
            .await
            .unwrap();
        db::DeviceRow::upsert(
            &self.database,
            device_id,
            "42",
            device_id,
            Some("desktop"),
            Some(&device_crypto::public_key_base64(&secret)),
        )
        .await
        .unwrap();
        let token = db::AuthToken::create(&self.database, "42", device_id)
            .await
            .unwrap();
        AccountSession::new(token.token, "42".into(), secret)
    }
}

#[async_trait::async_trait]
impl EmbeddedRelayHost for FixtureHost {
    async fn start(&self, port: u16, _: Option<String>) -> anyhow::Result<()> {
        assert_eq!(port, self.port);
        let listener = match self.listener.lock().await.take() {
            Some(listener) => listener,
            None => tokio::net::TcpListener::bind(("127.0.0.1", port)).await?,
        };
        let app = build_relay_router(
            Arc::new(MemoryAssetStore::new()),
            std::time::Instant::now(),
            self.database.clone(),
            env!("CARGO_PKG_VERSION"),
        );
        let app = if self.prefix.is_empty() {
            app
        } else {
            axum::Router::new().nest(self.prefix, app)
        };
        *self.server.lock().await = Some(tokio::spawn(async move {
            axum::serve(
                listener,
                app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
            )
            .await
            .unwrap();
        }));
        Ok(())
    }

    async fn stop(&self) {
        if let Some(server) = self.server.lock().await.take() {
            server.abort();
            let _ = server.await;
        }
    }
}

async fn rpc(
    host: &FixtureHost,
    controller: &AccountSession,
    target: &str,
    value: serde_json::Value,
) -> serde_json::Value {
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(8),
        AccountClient::new().device_rpc(&host.url(), controller, target, &value.to_string()),
    )
    .await
    .unwrap()
    .unwrap();
    serde_json::from_str(&result).unwrap()
}

async fn assert_hint(
    receiver: &mut tokio::sync::broadcast::Receiver<
        Option<openbitfun_services_integrations::remote_connect::account::StreamHint>,
    >,
    cursor: u64,
) {
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            if receiver
                .recv()
                .await
                .unwrap()
                .is_some_and(|hint| hint.cursor == cursor)
            {
                break;
            }
        }
    })
    .await
    .expect("encrypted event reached its route's controller");
}

/// Run the real socket/HTTP fixture in a separate process with temporary product
/// storage, so adoption of device identity and credential persistence never
/// modifies the developer's login or races other desktop unit tests.
#[tokio::test]
async fn official_relay_rpc_persistence_and_teardown() {
    const TEST: &str =
        "api::remote_connect_api::relay_routes_tests::official_relay_rpc_persistence_and_teardown";
    if std::env::var_os("OPENBITFUN_RELAY_ROUTE_TEST_CHILD").is_none() {
        let root = tempfile::tempdir().unwrap();
        let mut command = openbitfun_services_core::process_manager::create_tokio_command(
            std::env::current_exe().unwrap(),
        );
        command
            .args([TEST, "--exact", "--nocapture"])
            .env("OPENBITFUN_RELAY_ROUTE_TEST_CHILD", "1")
            .env("NO_PROXY", "127.0.0.1,localhost")
            .env("no_proxy", "127.0.0.1,localhost")
            .env("OPENBITFUN_HOME", root.path())
            .env(
                "OPENBITFUN_DEVICE_IDENTITY_PATH",
                root.path().join("device_identity.json"),
            )
            .kill_on_drop(true);
        let output = tokio::time::timeout(std::time::Duration::from_secs(90), command.output())
            .await
            .unwrap()
            .unwrap();
        assert!(
            output.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(
            String::from_utf8_lossy(&output.stdout).contains("1 passed; 0 failed"),
            "child fixture must actually run"
        );
        return;
    }
    let _test_guard = sync_state_tests::ACCOUNT_CONTEXT_TEST_LOCK.lock().await;
    let official = FixtureHost::new("/v/1.0.2").await;
    let id = current_device_identity().unwrap().device_id;
    let official_session = official.credential(&id, [1; 32]).await;
    let official_controller = official.credential("controller", [3; 32]).await;
    official.start(official.port, None).await.unwrap();
    let official_service = RemoteConnectService::new(
        RemoteConnectConfig {
            openbitfun_server_url: official.url(),
            ..RemoteConnectConfig::default()
        },
        Arc::new(DesktopEmbeddedRelayUnavailable),
    )
    .unwrap();
    official_service
        .prepare_relay(&ConnectionMethod::OpenBitFunServer)
        .await
        .unwrap();
    *RelayRoute::Official.service().write().await = Some(official_service);
    official.sign_in_official_session(&official_session).await;
    let generation = account_context_generation();
    account_connect_devices().await.unwrap();
    let saved = session_store::load_session_detailed().unwrap().unwrap();
    assert_eq!(saved.token, official_session.token);
    assert_eq!(saved.device_id.as_deref(), Some(id.as_str()));
    assert_eq!(host_stream_hubs().await.len(), 1);

    assert_eq!(
        rpc(
            &official,
            &official_controller,
            &id,
            serde_json::json!({"cmd":"ping", "client":{"id":"public-phone","name":"public-phone"}})
        )
        .await["resp"],
        "pong"
    );
    assert_eq!(rpc(&official, &official_controller, &id, serde_json::json!({"cmd":"host_invoke","command":"peer_control_attach","args":{"controllerDeviceId":"spoofed"}})).await["ok"], true);
    assert_eq!(
        crate::api::peer_host_invoke::attached_route_controllers(RelayRoute::Official),
        vec!["controller"]
    );
    let status = remote_connect_status().await.unwrap();
    assert_eq!(status.connections.len(), 1);
    assert_eq!(status.connections[0].method, "openbitfun_server");
    assert!(status.connections[0].relay_connected);
    assert_eq!(status.connections[0].clients[0].id, "public-phone");
    let mut public_hints = official_controller.stream_hints();
    fanout_peer_device_event(
        openbitfun_core::service::remote_connect::host_stream::HOST_STREAM_CHANGED_EVENT.into(),
        serde_json::json!({"stream_id":"official", "epoch":1, "cursor":1}),
    );
    assert_hint(&mut public_hints, 1).await;

    // An expired credential clears the persisted session; a stale failure
    // report for a token that was replaced since changes nothing.
    assert!(
        invalidate_local_account_session_if_current(
            generation,
            &official_session.token,
            "fixture token expired",
        )
        .await
    );
    assert!(account_token_expired().await);
    assert!(session_store::load_session_detailed().unwrap().is_none());
    official.sign_in_official_session(&official_session).await;
    account_connect_devices().await.unwrap();
    assert!(
        !invalidate_local_account_session_if_current(
            generation,
            &official_session.token,
            "stale fixture token failure",
        )
        .await
    );

    remote_connect_stop(Some(StopRemoteConnectRequest {
        method: "openbitfun_server".into(),
    }))
    .await
    .unwrap();
    assert!(host_stream_hubs().await.is_empty());
    account_connect_devices().await.unwrap();
    let original_owner = current_device_routing_owner_snapshot().unwrap();
    assert_eq!(host_stream_hubs().await.len(), 1);
    rpc(&official, &official_controller, &id, serde_json::json!({"cmd":"host_invoke","command":"peer_control_attach","args":{"controllerDeviceId":"spoofed"}})).await;
    assert!(
        db::AuthToken::find(&official.database, &official_session.token)
            .await
            .unwrap()
            .is_some()
    );
    assert_eq!(
        rpc(
            &official,
            &official_controller,
            &id,
            serde_json::json!({"cmd":"ping"})
        )
        .await["resp"],
        "pong"
    );
    let directory = AccountClient::new()
        .list_devices(&official.url(), &official_session)
        .await
        .unwrap();
    assert!(directory
        .iter()
        .any(|device| device.device_id == id && device.online));
    assert_eq!(
        session_store::load_session_detailed()
            .unwrap()
            .unwrap()
            .token,
        saved.token
    );
    assert_eq!(
        crate::api::peer_host_invoke::attached_route_controllers(RelayRoute::Official),
        vec!["controller"]
    );

    // A late exit from a retired event loop cannot erase the current owner.
    finish_device_routing_event_loop(&DeviceRoutingOwner {
        connection_id: original_owner.connection_id.wrapping_add(1_000),
        ..original_owner.clone()
    })
    .await;
    assert!(device_routing_owner_is_current(&original_owner).await);

    verify_remote_control_permission(&official, &official_session, &official_controller, &id).await;

    // Full sign-out is the shared identity boundary and retires the route.
    clear_account_login(true).await;
    assert!(get_account_context().read().await.is_none());
    assert!(host_stream_hubs().await.is_empty());
    assert!(session_store::load_session_detailed().unwrap().is_none());
    assert!(
        db::AuthToken::find(&official.database, &official_session.token)
            .await
            .unwrap()
            .is_none()
    );
    official.stop().await;
}

/// Use independent encrypted sockets on the fixture Relay. An offline host
/// remains an authenticated controller, including after a directory refresh.
async fn verify_remote_control_permission(
    relay: &FixtureHost,
    session: &AccountSession,
    peer: &AccountSession,
    id: &str,
) {
    use openbitfun_core::service::remote_connect::relay_client::{RelayClient, RelayEvent};
    monitor_remote_control_permission();
    remote_connect_set_allowed(SetRemoteControlRequest { allowed: false })
        .await
        .unwrap();
    let client = AccountClient::new();
    let url = relay.url();
    tokio::time::timeout(std::time::Duration::from_secs(8), async {
        loop {
            if client
                .list_devices(&url, peer)
                .await
                .unwrap()
                .iter()
                .any(|row| row.device_id == id && !row.online)
                && RelayRoute::Official
                    .service()
                    .read()
                    .await
                    .as_ref()
                    .unwrap()
                    .account_socket_serves_device()
                    .await
                    == Some(false)
            {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("host should become controller-only");
    account_connect_devices().await.unwrap();
    assert_eq!(
        remote_connect_status()
            .await
            .unwrap()
            .remote_control_allowed,
        Some(false)
    );
    let qr_error = remote_connect_weixin_qr_poll(WeixinQrPollRequest {
        session_key: "fixture".into(),
        base_url: None,
        verify_code: None,
    })
    .await
    .unwrap_err();
    assert!(
        qr_error.contains("Remote control is disabled"),
        "{qr_error}"
    );
    assert!(client
        .device_rpc(&url, peer, id, r#"{"cmd":"ping"}"#)
        .await
        .is_err());
    let (target, mut events) = RelayClient::new();
    target.connect(&url).await.unwrap();
    target
        .connect_authenticated(&peer.token, "peer")
        .await
        .unwrap();
    let answer = async {
        while let Some(event) = events.recv().await {
            if let RelayEvent::DeviceMessageReceived {
                source_device_id,
                correlation_id,
                encrypted_data,
                nonce,
                encoding_offer,
            } = event
            {
                if correlation_id.is_empty() {
                    continue;
                }
                assert_eq!(source_device_id, id);
                let request = peer
                    .decrypt_peer_message(&url, id, &encrypted_data, &nonce, encoding_offer)
                    .await
                    .unwrap();
                assert_eq!(request, r#"{"cmd":"ping"}"#);
                let (data, nonce) = peer
                    .encrypt_reply(&url, id, r#"{"resp":"pong"}"#, false)
                    .await
                    .unwrap();
                target
                    .send_device_message(id, &correlation_id, &data, &nonce)
                    .await
                    .unwrap();
                return;
            }
        }
        panic!("peer disconnected before the outbound request");
    };
    let outbound = account_device_rpc("controller".into(), r#"{"cmd":"ping"}"#.into(), Some(5000));
    let (result, ()) = tokio::time::timeout(std::time::Duration::from_secs(8), async {
        tokio::join!(outbound, answer)
    })
    .await
    .unwrap();
    assert_eq!(result.unwrap(), r#"{"resp":"pong"}"#);
    assert!(client
        .list_devices(&url, peer)
        .await
        .unwrap()
        .iter()
        .any(|device| device.device_id == id && !device.online));
    assert_eq!(
        session_store::load_session_detailed()
            .unwrap()
            .unwrap()
            .token,
        session.token
    );
    remote_connect_set_allowed(SetRemoteControlRequest { allowed: true })
        .await
        .unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(8), async {
        while !client
            .list_devices(&url, peer)
            .await
            .unwrap()
            .iter()
            .any(|row| row.device_id == id && row.online)
        {
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap();
    assert_eq!(
        rpc(relay, peer, id, serde_json::json!({"cmd":"ping"})).await["resp"],
        "pong"
    );
    target.disconnect().await;
}

#[tokio::test]
async fn html_preview_streams_assets_over_encrypted_peer_rpc() {
    peer_preview_fixture(false).await;
}

#[tokio::test]
#[ignore = "Performance experiment: encrypted loopback Relay with 40 ms per resource RPC"]
async fn html_preview_encrypted_peer_loading_benchmark() {
    peer_preview_fixture(true).await;
}

async fn peer_preview_fixture(benchmark: bool) {
    use openbitfun_product_domains::html_preview::{
        HtmlPreviewResourceReply, HtmlPreviewResourceRequest, PREVIEW_CHUNK_BYTES,
    };
    use openbitfun_services_integrations::remote_connect::{
        file_projection::SessionFileTarget,
        html_preview::HtmlPreviewSource,
        relay_client::{RelayClient, RelayEvent},
        RemoteCommand, RemoteResponse,
    };
    let _guard = sync_state_tests::ACCOUNT_CONTEXT_TEST_LOCK.lock().await;
    let host = FixtureHost::new("/preview-test").await;
    let controller = host.credential("preview-controller", [11; 32]).await;
    let target = host.credential("preview-peer", [12; 32]).await;
    host.start(host.port, None).await.unwrap();
    let previous_context = get_account_context()
        .write()
        .await
        .replace(AccountContextState {
            session: controller,
            relay_url: host.url(),
        });
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path();
    std::fs::create_dir_all(root.join("site/dist/assets")).unwrap();
    std::fs::write(
        root.join("site/dist/index.html"),
        "<script src='/assets/large.js'></script>",
    )
    .unwrap();
    let bytes = vec![
        b'x';
        if benchmark {
            2 * 1024 * 1024
        } else {
            PREVIEW_CHUNK_BYTES * 2 + 19
        }
    ];
    std::fs::write(root.join("site/dist/assets/large.js"), &bytes).unwrap();
    let entry = root
        .join("site/dist/index.html")
        .to_string_lossy()
        .into_owned();
    let files = vec![
        (
            "site/dist/index.html".to_string(),
            std::fs::read(root.join("site/dist/index.html")).unwrap(),
        ),
        (
            "site/dist/assets/app.css".to_string(),
            vec![b'c'; 96 * 1024],
        ),
        ("site/dist/assets/large.js".to_string(), bytes.clone()),
        (
            "site/dist/assets/image.png".to_string(),
            vec![53; 512 * 1024],
        ),
        (
            "site/dist/assets/font.woff2".to_string(),
            vec![19; 128 * 1024],
        ),
    ];
    for (path, content) in &files {
        std::fs::write(root.join(path), content).unwrap();
    }
    let source = HtmlPreviewSource::new(
        SessionFileTarget {
            fs: Arc::new(openbitfun_services_core::workspace::LocalWorkspaceFs),
            root: root.to_string_lossy().into_owned(),
            path: entry.clone(),
            remote: false,
        },
        "fixture-workspace",
    )
    .await
    .unwrap();
    let (client, mut events) = RelayClient::new();
    let client = Arc::new(client.with_account_session(&target));
    client.connect(&host.url()).await.unwrap();
    client
        .connect_authenticated(&target.token, "preview-peer")
        .await
        .unwrap();
    let serving_client = client.clone();
    let relay_url = host.url();
    let requests = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let serving_requests = requests.clone();
    let source = Arc::new(source);
    let target = Arc::new(target);
    let serving = tokio::spawn(async move {
        let mut handlers = tokio::task::JoinSet::new();
        while let Some(event) = events.recv().await {
            let RelayEvent::DeviceMessageReceived {
                source_device_id,
                correlation_id,
                encrypted_data,
                nonce,
                encoding_offer,
            } = event
            else {
                continue;
            };
            if correlation_id.is_empty() {
                continue;
            }
            while let Some(result) = handlers.try_join_next() {
                result.unwrap();
            }
            let target = target.clone();
            let source = source.clone();
            let relay_url = relay_url.clone();
            let serving_client = serving_client.clone();
            let serving_requests = serving_requests.clone();
            handlers.spawn(async move {
                let plaintext = target
                    .decrypt_peer_message(&relay_url, &source_device_id, &encrypted_data, &nonce, encoding_offer)
                    .await
                    .unwrap();
                let RemoteCommand::HostInvoke { command, args } =
                    serde_json::from_str(&plaintext).unwrap()
                else {
                    panic!("unexpected command")
                };
                let value = match command.as_str() {
                    "peer_mode_ping" => {
                        serde_json::json!({"host_type":"cli", "capabilities":{"workspace_html_preview_v1":true}})
                    }
                    "html_preview_read_resource" => {
                        let request: HtmlPreviewResourceRequest =
                            serde_json::from_value(args["request"].clone()).unwrap();
                        assert_eq!(request.workspace_id, "fixture-workspace");
                        if benchmark { tokio::time::sleep(std::time::Duration::from_millis(40)).await; }
                        serving_requests.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                        serde_json::to_value(HtmlPreviewResourceReply::from(
                            source.read(&request).await,
                        ))
                        .unwrap()
                    }
                    _ => panic!("unexpected host invoke {command}"),
                };
                let response = RemoteResponse::HostInvokeResult {
                    ok: true,
                    value: Some(value),
                    error: None,
                };
                assert!(encoding_offer.accepts_zstd());
                let json = serde_json::to_string(&response).unwrap();
                let (data, nonce) = target
                    .encrypt_reply(&relay_url, &source_device_id, &json, encoding_offer.accepts_zstd())
                    .await
                    .unwrap();
                if json.len() > 4096 {
                    assert!(data.len() < json.len(), "compressible fixture should shrink on the wire, even with base64");
                }
                serving_client
                    .send_device_message(&source_device_id, &correlation_id, &data, &nonce)
                    .await
                    .unwrap();
            });
        }
    });
    let request = HtmlPreviewResourceRequest {
        workspace_id: "fixture-workspace".into(),
        file_path: entry,
        resource_path: None,
        metadata_only: true,
        offset: 0,
        expected_source: None,
        expected_revision: None,
    };
    if benchmark {
        crate::api::html_preview_api::tests::benchmark_encrypted_peer_gateway(
            "preview-peer",
            request,
            files,
        )
        .await;
    } else {
        tokio::time::timeout(
            std::time::Duration::from_secs(20),
            crate::api::html_preview_api::tests::verify_encrypted_peer_gateway(
                "preview-peer",
                request.clone(),
                &bytes,
            ),
        )
        .await
        .unwrap();
        assert_eq!(
            requests.load(std::sync::atomic::Ordering::Relaxed),
            4,
            "entry metadata and three encrypted chunks"
        );
        tokio::time::timeout(
            std::time::Duration::from_secs(20),
            crate::api::html_preview_api::tests::verify_encrypted_peer_site_routes(
                "preview-peer",
                request,
                &files[0].1,
                &files[3].1,
            ),
        )
        .await
        .unwrap();
    }
    client.disconnect().await;
    serving.abort();
    host.stop().await;
    *get_account_context().write().await = previous_context;
}

/// `remote_connect_start` on a route that is already connected only returns
/// its invitation. The dialog asks for it whenever "Add a device" opens, so
/// asking must not sign in again, reconnect, replace the routing owner or
/// detach controllers. A request for the retired LAN mode is refused.
///
/// Runs through the real Relay router and device routing in a separate
/// process with temporary product storage. The Relay is the loopback fixture
/// bound to 127.0.0.1: this does not exercise the production Relay.
#[tokio::test]
async fn starting_a_connected_route_again_only_returns_its_invitation() {
    const TEST: &str = "api::remote_connect_api::relay_routes_tests::starting_a_connected_route_again_only_returns_its_invitation";
    if std::env::var_os("OPENBITFUN_RELAY_ROUTE_TEST_CHILD").is_none() {
        let root = tempfile::tempdir().unwrap();
        let mut command = openbitfun_services_core::process_manager::create_tokio_command(
            std::env::current_exe().unwrap(),
        );
        command
            .args([TEST, "--exact", "--nocapture"])
            .env("OPENBITFUN_RELAY_ROUTE_TEST_CHILD", "1")
            .env("NO_PROXY", "127.0.0.1,localhost")
            .env("no_proxy", "127.0.0.1,localhost")
            .env("OPENBITFUN_HOME", root.path())
            .env(
                "OPENBITFUN_DEVICE_IDENTITY_PATH",
                root.path().join("device_identity.json"),
            )
            .kill_on_drop(true);
        let output = tokio::time::timeout(std::time::Duration::from_secs(90), command.output())
            .await
            .unwrap()
            .unwrap();
        assert!(
            output.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(
            String::from_utf8_lossy(&output.stdout).contains("1 passed; 0 failed"),
            "child fixture must actually run"
        );
        return;
    }
    let _test_guard = sync_state_tests::ACCOUNT_CONTEXT_TEST_LOCK.lock().await;
    let attach = serde_json::json!({"cmd":"host_invoke","command":"peer_control_attach","args":{}});
    let ping = serde_json::json!({"cmd":"ping"});
    let official = FixtureHost::new("/v/1.0.2").await;
    let id = current_device_identity().unwrap().device_id;
    let host_session = official.credential(&id, [1; 32]).await;
    let controller = official.credential("controller", [3; 32]).await;
    official.start(official.port, None).await.unwrap();

    // A restored sign-in: device routing connects before any invitation is
    // asked for, so the service has not prepared an endpoint yet.
    *RelayRoute::Official.service().write().await = Some(
        RemoteConnectService::new(
            RemoteConnectConfig {
                openbitfun_server_url: official.url(),
                ..RemoteConnectConfig::default()
            },
            Arc::new(DesktopEmbeddedRelayUnavailable),
        )
        .unwrap(),
    );
    official.sign_in_official_session(&host_session).await;
    let generation = account_context_generation();
    account_connect_devices().await.unwrap();
    let owner = current_device_routing_owner_snapshot().unwrap();
    let saved = session_store::load_session_detailed().unwrap().unwrap();
    let start_official = || {
        remote_connect_start(StartRemoteConnectRequest {
            method: "openbitfun_server".into(),
            lan_ip: None,
        })
    };

    // Asked right after connecting, whether or not presence has arrived yet.
    let first = start_official().await.unwrap();
    assert_eq!(first.method, ConnectionMethod::OpenBitFunServer);
    let link = first.qr_url.expect("the legacy invitation link");
    assert!(
        link.starts_with(&format!("http://127.0.0.1:{}/v/1.0.2", official.port)),
        "{link}"
    );
    assert!(link.ends_with(&format!("#/pair?did={id}")), "{link}");
    assert_eq!(
        current_device_routing_owner_snapshot().unwrap(),
        owner,
        "the first invitation after a restored sign-in must not reconnect"
    );

    // A controller attaches. Asking again, any number of times, returns the
    // same link and leaves the route, its owner and the controller alone.
    assert_eq!(
        rpc(&official, &controller, &id, attach.clone()).await["ok"],
        true
    );
    for _ in 0..3 {
        let again = start_official().await.unwrap();
        assert_eq!(again.qr_url.as_deref(), Some(link.as_str()));
        assert_eq!(current_device_routing_owner_snapshot().unwrap(), owner);
    }
    // While the transport reconnects by itself the presence list is empty.
    // That is not a reason to replace the route either.
    assert!(replace_device_presence_if_owner(&owner, Vec::new()));
    assert_eq!(
        start_official().await.unwrap().qr_url.as_deref(),
        Some(link.as_str())
    );
    assert_eq!(current_device_routing_owner_snapshot().unwrap(), owner);
    assert_eq!(
        crate::api::peer_host_invoke::attached_route_controllers(RelayRoute::Official),
        vec!["controller"]
    );
    assert_eq!(
        account_context_generation(),
        generation,
        "nobody was signed in again"
    );
    assert_eq!(
        session_store::load_session_detailed()
            .unwrap()
            .unwrap()
            .token,
        saved.token
    );
    assert!(db::AuthToken::find(&official.database, &host_session.token)
        .await
        .unwrap()
        .is_some());
    assert_eq!(
        rpc(&official, &controller, &id, ping.clone()).await["resp"],
        "pong"
    );

    // The retired LAN mode is refused explicitly, for every form an older UI
    // sends, and the refusal leaves the official route alone.
    for lan_ip in [Some("127.0.0.1".to_string()), None, Some(String::new())] {
        let error = remote_connect_start(StartRemoteConnectRequest {
            method: "lan".into(),
            lan_ip: lan_ip.clone(),
        })
        .await
        .expect_err("the LAN Relay mode is retired");
        assert_eq!(error, LAN_RELAY_RETIRED_ERROR, "{lan_ip:?}");
    }
    assert_eq!(
        remote_connect_stop(Some(StopRemoteConnectRequest {
            method: "lan".into(),
        }))
        .await
        .expect_err("the LAN Relay mode is retired"),
        LAN_RELAY_RETIRED_ERROR
    );
    assert_eq!(
        crate::api::peer_host_invoke::attached_route_controllers(RelayRoute::Official),
        vec!["controller"]
    );
    assert_eq!(current_device_routing_owner_snapshot().unwrap(), owner);
    assert_eq!(
        start_official().await.unwrap().qr_url.as_deref(),
        Some(link.as_str())
    );
    assert_eq!(current_device_routing_owner_snapshot().unwrap(), owner);
    assert_eq!(rpc(&official, &controller, &id, ping).await["resp"], "pong");
    official.stop().await;
}

#[tokio::test]
async fn lan_start_and_stop_are_refused_as_retired() {
    for lan_ip in [Some("192.168.1.2".to_string()), None] {
        let error = remote_connect_start(StartRemoteConnectRequest {
            method: "lan".into(),
            lan_ip,
        })
        .await
        .expect_err("the LAN Relay mode is retired");
        assert_eq!(error, LAN_RELAY_RETIRED_ERROR);
    }
    let error = remote_connect_stop(Some(StopRemoteConnectRequest {
        method: "lan".into(),
    }))
    .await
    .expect_err("the LAN Relay mode is retired");
    assert_eq!(error, LAN_RELAY_RETIRED_ERROR);
    assert!(error.starts_with("unsupported: "));
    assert!(error.contains("device mesh"));
    // Older UIs send `lan_ip` explicitly or not at all; both still parse.
    let request: StartRemoteConnectRequest =
        serde_json::from_value(serde_json::json!({"method": "lan", "lan_ip": null})).unwrap();
    assert_eq!(request.method, "lan");
    let request: StartRemoteConnectRequest =
        serde_json::from_value(serde_json::json!({"method": "openbitfun_server"})).unwrap();
    assert!(request.lan_ip.is_none());
}

#[test]
fn connection_methods_do_not_offer_lan() {
    let ids: Vec<String> = connection_method_infos(vec![
        ConnectionMethod::Lan { ip: None },
        ConnectionMethod::OpenBitFunServer,
        ConnectionMethod::BotFeishu,
        ConnectionMethod::BotTelegram,
        ConnectionMethod::BotWeixin,
    ])
    .into_iter()
    .map(|info| info.id)
    .collect();
    assert_eq!(
        ids,
        [
            "openbitfun_server",
            "bot_feishu",
            "bot_telegram",
            "bot_weixin"
        ]
    );
}

#[tokio::test]
async fn the_desktop_embedded_relay_port_is_unavailable() {
    let error = DesktopEmbeddedRelayUnavailable
        .start(9700, None)
        .await
        .expect_err("the desktop no longer hosts an embedded Relay");
    assert_eq!(error.to_string(), LAN_RELAY_RETIRED_ERROR);
    DesktopEmbeddedRelayUnavailable.stop().await;
}

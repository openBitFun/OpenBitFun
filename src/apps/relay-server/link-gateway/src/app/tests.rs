//! Gateway routes against fake accounts and device streams: sign-in,
//! isolation, limits, idle cleanup, and the pipe itself.

use std::collections::HashMap;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;

use futures::{SinkExt, StreamExt};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message as WsMessage;

use super::*;
use crate::upstream::{BoxFuture, Registered};

const ORIGIN: &str = "https://remote.example";

/// Two accounts: `acct-a` owns `desk-a`, `acct-b` owns `desk-b` and has a
/// cloud node `cloud-b` (kind `cloud_agent`).
struct FakeAccounts;

impl Accounts for FakeAccounts {
    fn send_code<'a>(
        &'a self,
        email: &'a str,
        _locale: &'a str,
        _ip: &'a str,
    ) -> BoxFuture<'a, Result<PendingSignIn, UpstreamError>> {
        Box::pin(async move {
            Ok(PendingSignIn {
                transaction_id: "tx".into(),
                transaction_secret: "secret".into(),
                ticket: "ticket".into(),
                challenge_id: format!("challenge-{email}"),
                email: email.to_string(),
                retry_after_seconds: 60,
                expires_at: now_secs() + 600,
            })
        })
    }

    fn verify_code<'a>(
        &'a self,
        pending: &'a PendingSignIn,
        code: &'a str,
    ) -> BoxFuture<'a, Result<String, UpstreamError>> {
        Box::pin(async move {
            if code != "12345678" {
                return Err(UpstreamError::new("invalid_code", "wrong code"));
            }
            Ok(format!("access-{}", pending.email))
        })
    }

    fn register<'a>(
        &'a self,
        access_token: &'a str,
        device: &'a DeviceRegistration,
        _ip: &'a str,
    ) -> BoxFuture<'a, Result<Registered, UpstreamError>> {
        Box::pin(async move {
            let account = if access_token.contains("b@") {
                "acct-b"
            } else {
                "acct-a"
            };
            Ok(Registered {
                account_id: account.to_string(),
                directory_token: format!("token-{account}-{}", device.device_id),
            })
        })
    }

    fn devices<'a>(
        &'a self,
        token: &'a str,
    ) -> BoxFuture<'a, Result<Vec<DirectoryDevice>, UpstreamError>> {
        Box::pin(async move {
            if token.contains("revoked") {
                return Err(UpstreamError::new("signed_out", "signed out"));
            }
            let (id, online) = if token.starts_with("token-acct-b") {
                ("desk-b", true)
            } else {
                ("desk-a", true)
            };
            let cloud = token.starts_with("token-acct-b").then(|| DirectoryDevice {
                device_id: "cloud-b".into(),
                device_name: "OpenBitFun".into(),
                device_kind: Some("cloud_agent".into()),
                ..Default::default()
            });
            Ok(cloud
                .into_iter()
                .chain([
                    DirectoryDevice {
                        device_id: id.into(),
                        device_name: format!("{id} name"),
                        online,
                        ..Default::default()
                    },
                    DirectoryDevice {
                        device_id: format!("{id}-off"),
                        device_name: "Old laptop".into(),
                        online: false,
                        ..Default::default()
                    },
                ])
                .collect())
        })
    }

    fn device_key<'a>(
        &'a self,
        _token: &'a str,
        device_id: &'a str,
    ) -> BoxFuture<'a, Result<String, UpstreamError>> {
        Box::pin(async move { Ok(format!("key-of-{device_id}")) })
    }

    fn sign_out<'a>(&'a self, _token: &'a str) -> BoxFuture<'a, Result<(), UpstreamError>> {
        Box::pin(async { Ok(()) })
    }

    fn ensure_cloud_node<'a>(&'a self, access_token: &'a str) -> BoxFuture<'a, ()> {
        Box::pin(async move {
            ENSURED
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .push(access_token.to_string());
        })
    }
}

/// Access tokens the gateway asked the cloud agent to ensure a node for.
static ENSURED: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());

/// On by default: a browser's sign-in asks the cloud agent to create the
/// account's cloud node, with the account's access token, without waiting.
#[tokio::test]
async fn sign_in_ensures_the_accounts_cloud_node() {
    let harness = harness(GatewayOptions::default()).await;
    harness
        .sign_in("ensure@example.com", "browser-ensure")
        .await;
    let deadline = std::time::Instant::now() + Duration::from_secs(2);
    loop {
        if ENSURED
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .iter()
            .any(|token| token == "access-ensure@example.com")
        {
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "the cloud node was never ensured"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

/// Echo streams for OBP pipes that also answer `/obp-ui/v1/` like a
/// device; records which (account, device) were opened.
type FakeStreams = crate::pool::tests::FakeDevice;

struct Harness {
    addr: SocketAddr,
    gateway: Arc<Gateway>,
    streams: Arc<FakeStreams>,
    http: reqwest::Client,
    _pool_dir: tempfile::TempDir,
}

async fn harness(options: GatewayOptions) -> Harness {
    harness_with(options, true).await
}

async fn harness_with(options: GatewayOptions, with_pool: bool) -> Harness {
    openbitfun_services_core::tls_provider::ensure_ring_crypto_provider();
    let streams = Arc::new(FakeStreams::default());
    let pool_dir = tempfile::tempdir().unwrap();
    let pool = with_pool.then(|| {
        crate::pool::UiPool::open(
            pool_dir.path(),
            crate::pool::PoolOptions::default(),
            crate::pool::system_clock(),
        )
        .unwrap()
    });
    let gateway = Gateway::new(
        Arc::new(FakeAccounts),
        Arc::clone(&streams) as Arc<dyn DeviceStreams>,
        SessionSealer::from_issuer_key(&[3; 32]),
        GatewayOptions {
            origins: vec![ORIGIN.to_string()],
            secure_cookies: false,
            ..options
        },
        pool,
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let router = gateway.router();
    tokio::spawn(async move {
        axum::serve(
            listener,
            router.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await
        .unwrap();
    });
    Harness {
        addr,
        gateway,
        streams,
        http: reqwest::Client::new(),
        _pool_dir: pool_dir,
    }
}

impl Harness {
    fn url(&self, path: &str) -> String {
        format!("http://{}{path}", self.addr)
    }

    /// Signs `email` in; returns the session cookie pair.
    async fn sign_in(&self, email: &str, device: &str) -> String {
        let code: serde_json::Value = self
            .http
            .post(self.url("/obp/api/v1/auth/code"))
            .header("origin", ORIGIN)
            .json(&serde_json::json!({ "email": email }))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        let challenge = code["challengeId"].as_str().unwrap().to_string();
        assert_eq!(code["codeLength"], 8);
        // Nothing of the authority's transaction reaches the browser.
        assert!(!code.to_string().contains("secret") && !code.to_string().contains("ticket"));
        let response = self
            .http
            .post(self.url("/obp/api/v1/auth/verify"))
            .header("origin", ORIGIN)
            .json(&serde_json::json!({
                "challengeId": challenge,
                "code": "1234 5678",
                "device": { "deviceId": device, "publicKey": base64::engine::general_purpose::STANDARD.encode([9u8; 32]) },
            }))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 200);
        let cookie = response
            .headers()
            .get("set-cookie")
            .unwrap()
            .to_str()
            .unwrap()
            .to_string();
        assert!(cookie.contains("HttpOnly"));
        let body: serde_json::Value = response.json().await.unwrap();
        assert_eq!(body["account"]["deviceId"], device);
        cookie.split(';').next().unwrap().to_string()
    }

    async fn pipe(
        &self,
        device: &str,
        cookie: Option<&str>,
        origin: &str,
    ) -> Result<
        tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
        tokio_tungstenite::tungstenite::Error,
    > {
        let mut request = format!("ws://{}/obp/{device}", self.addr)
            .into_client_request()
            .unwrap();
        request
            .headers_mut()
            .insert("origin", origin.parse().unwrap());
        if let Some(cookie) = cookie {
            request
                .headers_mut()
                .insert("cookie", cookie.parse().unwrap());
        }
        tokio_tungstenite::connect_async(request)
            .await
            .map(|(socket, _)| socket)
    }
}

/// The close code the gateway ended a pipe with.
async fn close_code(
    socket: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
) -> (u16, String) {
    loop {
        match tokio::time::timeout(Duration::from_secs(5), socket.next())
            .await
            .expect("the gateway answers within 5 s")
        {
            Some(Ok(WsMessage::Close(Some(frame)))) => {
                return (u16::from(frame.code), frame.reason.to_string())
            }
            Some(Ok(WsMessage::Close(None))) | None => return (1005, String::new()),
            Some(Ok(_)) => continue,
            Some(Err(error)) => return (1006, error.to_string()),
        }
    }
}

#[tokio::test]
async fn sign_in_seals_a_session_and_lists_the_accounts_devices() {
    let harness = harness(GatewayOptions::default()).await;
    let signed_out: serde_json::Value = harness
        .http
        .get(harness.url("/obp/api/v1/session"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(signed_out["signedIn"], false);
    let unauthorized = harness
        .http
        .get(harness.url("/obp/api/v1/devices"))
        .send()
        .await
        .unwrap();
    assert_eq!(unauthorized.status(), 401);

    let cookie = harness.sign_in("a@example.com", "web-a").await;
    let session: serde_json::Value = harness
        .http
        .get(harness.url("/obp/api/v1/session"))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(session["signedIn"], true);
    assert_eq!(session["account"]["accountId"], "acct-a");
    assert_eq!(session["account"]["email"], "a@example.com");
    // The directory credential never leaves the server in clear.
    assert!(!cookie.contains("token-acct-a"));

    let devices: serde_json::Value = harness
        .http
        .get(harness.url("/obp/api/v1/devices"))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    // Without the network's view every device is tried, the directory's
    // presence hint first.
    assert_eq!(
        devices["entryCandidates"],
        serde_json::json!(["desk-a", "desk-a-off"])
    );
    let devices = devices["devices"].as_array().unwrap();
    assert_eq!(devices.len(), 2);
    assert_eq!(devices[0]["deviceId"], "desk-a");
    assert_eq!(devices[0]["connectable"], true);
    // Without the network's view, relay presence is only a hint (hosts on
    // Link keep no relay socket): every device can be tried.
    assert_eq!(devices[1]["online"], false);
    assert_eq!(devices[1]["connectable"], true);
    assert!(devices[1]["unavailable"].is_null());

    // With it, the list says who is on the device network and how the
    // gateway reaches it; the rest are offline, phones are controllers.
    *harness.streams.network.lock().unwrap() = Some(HashMap::from([
        (
            "desk-a-off".to_string(),
            OnlineMember {
                route: Some("relayed_server".into()),
                latency_ms: Some(42.0),
                controller: false,
            },
        ),
        (
            "phone-a".to_string(),
            OnlineMember {
                route: Some("relayed_server".into()),
                latency_ms: None,
                controller: true,
            },
        ),
    ]));
    let devices: serde_json::Value = harness
        .http
        .get(harness.url("/obp/api/v1/devices"))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    // Only the device on the network is an entry candidate.
    assert_eq!(
        devices["entryCandidates"],
        serde_json::json!(["desk-a-off"])
    );
    let devices = devices["devices"].as_array().unwrap();
    let by_id = |id: &str| {
        devices
            .iter()
            .find(|device| device["deviceId"] == id)
            .unwrap()
            .clone()
    };
    let online = by_id("desk-a-off");
    assert_eq!(online["online"], true);
    assert_eq!(online["connectable"], true);
    assert_eq!(online["route"], "relayed_server");
    assert!(online["unavailable"].is_null());
    let offline = by_id("desk-a");
    assert_eq!(offline["online"], false);
    assert_eq!(offline["connectable"], false);
    assert_eq!(offline["unavailable"]["code"], "offline");
    // Online first.
    assert_eq!(devices[0]["deviceId"], "desk-a-off");
    assert!(harness.streams.online_calls.load(Ordering::SeqCst) >= 2);

    // A wrong code keeps the sign-in open; the API refuses foreign origins.
    let code: serde_json::Value = harness
        .http
        .post(harness.url("/obp/api/v1/auth/code"))
        .header("origin", ORIGIN)
        .json(&serde_json::json!({ "email": "c@example.com" }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let wrong = harness
        .http
        .post(harness.url("/obp/api/v1/auth/verify"))
        .header("origin", ORIGIN)
        .json(&serde_json::json!({ "challengeId": code["challengeId"], "code": "00000000",
            "device": { "deviceId": "web-c", "publicKey": base64::engine::general_purpose::STANDARD.encode([9u8; 32]) } }))
        .send()
        .await
        .unwrap();
    assert_eq!(wrong.status(), 400);
    let body: serde_json::Value = wrong.json().await.unwrap();
    assert_eq!(body["error"], "invalid_code");
    let foreign = harness
        .http
        .post(harness.url("/obp/api/v1/auth/code"))
        .header("origin", "https://evil.example")
        .json(&serde_json::json!({ "email": "a@example.com" }))
        .send()
        .await
        .unwrap();
    assert_eq!(foreign.status(), 403);

    // Signing out clears the cookie.
    let out = harness
        .http
        .post(harness.url("/obp/api/v1/auth/sign-out"))
        .header("origin", ORIGIN)
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap();
    assert!(out
        .headers()
        .get("set-cookie")
        .unwrap()
        .to_str()
        .unwrap()
        .contains("Max-Age=0"));
}

#[tokio::test]
async fn pipes_need_a_session_the_page_origin_and_a_device_of_the_same_account() {
    let harness = harness(GatewayOptions::default()).await;
    let cookie_a = harness.sign_in("a@example.com", "web-a").await;

    // No session: the upgrade is answered with an explicit close.
    let mut socket = harness.pipe("desk-a", None, ORIGIN).await.unwrap();
    assert_eq!(close_code(&mut socket).await.0, 4401);

    // Another site's page cannot ride the cookie.
    assert!(harness
        .pipe("desk-a", Some(&cookie_a), "https://evil.example")
        .await
        .is_err());

    // Account A cannot reach account B's device; no stream is even opened.
    let mut socket = harness
        .pipe("desk-b", Some(&cookie_a), ORIGIN)
        .await
        .unwrap();
    let (code, reason) = close_code(&mut socket).await;
    assert_eq!(code, 4403, "{reason}");
    assert_eq!(harness.streams.opens.load(Ordering::SeqCst), 0);

    // Its own device: bytes flow both ways, through A's network only.
    let mut socket = harness
        .pipe("desk-a", Some(&cookie_a), ORIGIN)
        .await
        .unwrap();
    socket
        .send(WsMessage::Binary(b"OBPE2E1\nciphertext".to_vec().into()))
        .await
        .unwrap();
    let mut echoed = Vec::new();
    while echoed.len() < 18 {
        if let WsMessage::Binary(bytes) =
            tokio::time::timeout(Duration::from_secs(5), socket.next())
                .await
                .unwrap()
                .unwrap()
                .unwrap()
        {
            echoed.extend_from_slice(&bytes);
        }
    }
    assert_eq!(echoed, b"OBPE2E1\nciphertext");
    assert_eq!(
        harness.streams.opened.lock().unwrap().as_slice(),
        &[("acct-a".to_string(), "desk-a".to_string())]
    );
    assert_eq!(harness.gateway.open_pipes(), 1);
    socket.close(None).await.unwrap();
    for _ in 0..50 {
        if harness.gateway.open_pipes() == 0 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert_eq!(harness.gateway.open_pipes(), 0);

    // B reaches B's device through B's network.
    let cookie_b = harness.sign_in("b@example.com", "web-b").await;
    let mut socket = harness
        .pipe("desk-b", Some(&cookie_b), ORIGIN)
        .await
        .unwrap();
    socket
        .send(WsMessage::Binary(b"x".to_vec().into()))
        .await
        .unwrap();
    let _ = tokio::time::timeout(Duration::from_secs(5), socket.next()).await;
    assert!(harness
        .streams
        .opened
        .lock()
        .unwrap()
        .contains(&("acct-b".to_string(), "desk-b".to_string())));

    // A forged or altered cookie is no session.
    let forged = format!("{}x", cookie_a);
    let mut socket = harness.pipe("desk-a", Some(&forged), ORIGIN).await.unwrap();
    assert_eq!(close_code(&mut socket).await.0, 4401);
}

#[tokio::test]
async fn limits_busy_networks_unreachable_devices_and_idle_pipes_close_explicitly() {
    let harness = harness(GatewayOptions {
        max_pipes: 1,
        ping_interval: Duration::from_millis(100),
        idle_timeout: Duration::from_millis(400),
        code_requests_per_minute: 3,
        ..GatewayOptions::default()
    })
    .await;
    let cookie = harness.sign_in("a@example.com", "web-a").await;

    // One pipe fills the gateway: the next is told it is busy.
    let mut first = harness.pipe("desk-a", Some(&cookie), ORIGIN).await.unwrap();
    first
        .send(WsMessage::Binary(b"x".to_vec().into()))
        .await
        .unwrap();
    let _ = tokio::time::timeout(Duration::from_secs(5), first.next()).await;
    let mut second = harness.pipe("desk-a", Some(&cookie), ORIGIN).await.unwrap();
    assert_eq!(close_code(&mut second).await.0, 4429);

    // The first pipe goes silent: the gateway pings, then closes it as idle.
    let (code, reason) = close_code(&mut first).await;
    assert_eq!((code, reason.as_str()), (1000, "idle"));

    // The account network refused another stream (per-account limit).
    *harness.streams.fail.lock().unwrap() = Some(StreamError::Busy("gateway_busy".into()));
    let mut socket = harness.pipe("desk-a", Some(&cookie), ORIGIN).await.unwrap();
    assert_eq!(close_code(&mut socket).await.0, 4429);
    // The device is not on Link (offline or an older build).
    *harness.streams.fail.lock().unwrap() =
        Some(StreamError::Unreachable("mesh_unreachable".into()));
    let mut socket = harness.pipe("desk-a", Some(&cookie), ORIGIN).await.unwrap();
    let (code, reason) = close_code(&mut socket).await;
    assert_eq!(code, 4404);
    assert!(reason.starts_with("unreachable"), "{reason}");

    // Code requests per address (one was spent by the sign-in).
    let mut statuses = Vec::new();
    for _ in 0..3 {
        statuses.push(
            harness
                .http
                .post(harness.url("/obp/api/v1/auth/code"))
                .header("origin", ORIGIN)
                .json(&serde_json::json!({ "email": "z@example.com" }))
                .send()
                .await
                .unwrap()
                .status()
                .as_u16(),
        );
    }
    assert_eq!(statuses, vec![200, 200, 429]);
}

#[tokio::test]
async fn the_session_cookie_is_set_and_cleared_on_the_api_and_pool_paths() {
    let harness = harness(GatewayOptions::default()).await;
    let response = harness
        .http
        .post(harness.url("/obp/api/v1/auth/code"))
        .header("origin", ORIGIN)
        .json(&serde_json::json!({ "email": "a@example.com" }))
        .send()
        .await
        .unwrap();
    let code: serde_json::Value = response.json().await.unwrap();
    let verified = harness
        .http
        .post(harness.url("/obp/api/v1/auth/verify"))
        .header("origin", ORIGIN)
        .json(&serde_json::json!({
            "challengeId": code["challengeId"],
            "code": "12345678",
            "device": { "deviceId": "web-a", "publicKey": base64::engine::general_purpose::STANDARD.encode([9u8; 32]) },
        }))
        .send()
        .await
        .unwrap();
    let set: Vec<String> = verified
        .headers()
        .get_all("set-cookie")
        .iter()
        .map(|value| value.to_str().unwrap().to_string())
        .collect();
    assert_eq!(set.len(), 2, "{set:?}");
    assert!(set[0].contains("Path=/obp;") && set[1].contains("Path=/cas;"));
    let pair = set[0].split(';').next().unwrap().to_string();
    assert_eq!(set[1].split(';').next().unwrap(), pair);

    // A browser signed in before the pool existed holds only the `/obp`
    // cookie: its next session check re-issues both, with the session's
    // remaining lifetime.
    let session = harness
        .http
        .get(harness.url("/obp/api/v1/session"))
        .header("cookie", &pair)
        .send()
        .await
        .unwrap();
    let reissued: Vec<String> = session
        .headers()
        .get_all("set-cookie")
        .iter()
        .map(|value| value.to_str().unwrap().to_string())
        .collect();
    assert_eq!(reissued.len(), 2);
    assert!(reissued.iter().all(|cookie| cookie.starts_with(&pair)));
    assert!(reissued[1].contains("Path=/cas;"));
    // Signed out: no cookie is set.
    let anonymous = harness
        .http
        .get(harness.url("/obp/api/v1/session"))
        .send()
        .await
        .unwrap();
    assert!(anonymous.headers().get("set-cookie").is_none());

    let out = harness
        .http
        .post(harness.url("/obp/api/v1/auth/sign-out"))
        .header("origin", ORIGIN)
        .header("cookie", &pair)
        .send()
        .await
        .unwrap();
    let cleared: Vec<String> = out
        .headers()
        .get_all("set-cookie")
        .iter()
        .map(|value| value.to_str().unwrap().to_string())
        .collect();
    assert_eq!(cleared.len(), 2);
    assert!(cleared.iter().all(|cookie| cookie.contains("Max-Age=0")));
    assert!(cleared[1].contains("Path=/cas;"));
}

#[tokio::test]
async fn pool_files_need_a_session_and_pull_only_from_the_accounts_own_devices() {
    let harness = harness(GatewayOptions::default()).await;
    let file = b"export const ui = 'from the device';".to_vec();
    let hash = harness.streams.add(&file, false);
    let br_bytes = vec![0x8b, 0x02, 0x80, 0x68, 0x69, 0x03];
    let br_hash = harness.streams.add(&br_bytes, true);
    let cas = |hash: &str, device: Option<&str>| match device {
        Some(device) => harness.url(&format!("/cas/{hash}?device={device}")),
        None => harness.url(&format!("/cas/{hash}")),
    };

    // No session cookie.
    let anonymous = harness
        .http
        .get(cas(&hash, Some("desk-a")))
        .send()
        .await
        .unwrap();
    assert_eq!(anonymous.status(), 401);
    let body: serde_json::Value = anonymous.json().await.unwrap();
    assert_eq!(body["error"], "signed_out");
    assert_eq!(harness.streams.opens.load(Ordering::SeqCst), 0);

    let cookie_a = harness.sign_in("a@example.com", "web-a").await;
    // Account A naming account B's device: refused, no stream opened.
    let foreign = harness
        .http
        .get(cas(&hash, Some("desk-b")))
        .header("cookie", &cookie_a)
        .send()
        .await
        .unwrap();
    assert_eq!(foreign.status(), 403);
    let body: serde_json::Value = foreign.json().await.unwrap();
    assert_eq!(body["error"], "not_your_device");
    assert_eq!(harness.streams.opens.load(Ordering::SeqCst), 0);
    // A miss must name the device; a malformed hash is not a file.
    let unnamed = harness
        .http
        .get(cas(&hash, None))
        .header("cookie", &cookie_a)
        .send()
        .await
        .unwrap();
    assert_eq!(unnamed.status(), 400);
    let malformed = harness
        .http
        .get(cas(&hash.to_uppercase(), Some("desk-a")))
        .header("cookie", &cookie_a)
        .send()
        .await
        .unwrap();
    assert_eq!(malformed.status(), 404);

    // Its own device: pulled through, through A's network.
    let pulled = harness
        .http
        .get(cas(&hash, Some("desk-a")))
        .header("cookie", &cookie_a)
        .send()
        .await
        .unwrap();
    assert_eq!(pulled.status(), 200);
    let headers = pulled.headers().clone();
    assert_eq!(headers["content-type"], "application/octet-stream");
    assert_eq!(
        headers["cache-control"],
        "public, max-age=31536000, immutable"
    );
    assert_eq!(headers["content-length"], file.len().to_string().as_str());
    assert!(headers.get("content-encoding").is_none());
    assert_eq!(pulled.bytes().await.unwrap().as_ref(), file.as_slice());
    assert_eq!(
        harness.streams.opened.lock().unwrap().as_slice(),
        &[("acct-a".to_string(), "desk-a".to_string())]
    );

    // Account B hits the same file without reaching any device, even
    // without naming one.
    let cookie_b = harness.sign_in("b@example.com", "web-b").await;
    let hit = harness
        .http
        .get(cas(&hash, None))
        .header("cookie", &cookie_b)
        .send()
        .await
        .unwrap();
    assert_eq!(hit.status(), 200);
    assert_eq!(hit.bytes().await.unwrap().as_ref(), file.as_slice());
    assert_eq!(harness.streams.opens.load(Ordering::SeqCst), 1);

    // A `.br` sibling is served as such.
    let br = harness
        .http
        .get(cas(&br_hash, Some("desk-a")))
        .header("cookie", &cookie_a)
        .send()
        .await
        .unwrap();
    assert_eq!(br.status(), 200);
    assert_eq!(br.headers()["content-encoding"], "br");
    assert_eq!(br.bytes().await.unwrap().as_ref(), br_bytes.as_slice());

    // The device's bundle has no such file; the device sends wrong bytes.
    let missing = harness
        .http
        .get(cas(&"0".repeat(64), Some("desk-a")))
        .header("cookie", &cookie_a)
        .send()
        .await
        .unwrap();
    assert_eq!(missing.status(), 404);
    let body: serde_json::Value = missing.json().await.unwrap();
    assert_eq!(body["error"], "not_in_bundle");
    let other = harness.streams.add(b"another file", false);
    harness
        .streams
        .tamper
        .store(true, std::sync::atomic::Ordering::SeqCst);
    let tampered = harness
        .http
        .get(cas(&other, Some("desk-a")))
        .header("cookie", &cookie_a)
        .send()
        .await
        .unwrap();
    assert_eq!(tampered.status(), 502);
    let body: serde_json::Value = tampered.json().await.unwrap();
    assert_eq!(body["error"], "hash_mismatch");

    // OBP pipes still work on the same device streams.
    let mut socket = harness
        .pipe("desk-a", Some(&cookie_a), ORIGIN)
        .await
        .unwrap();
    socket
        .send(WsMessage::Binary(b"OBPE2E1\n".to_vec().into()))
        .await
        .unwrap();
    match tokio::time::timeout(Duration::from_secs(5), socket.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap()
    {
        WsMessage::Binary(bytes) => assert_eq!(bytes.as_ref(), b"OBPE2E1\n"),
        other => panic!("unexpected {other:?}"),
    }
}

#[tokio::test]
async fn a_gateway_without_a_pool_says_so() {
    let harness = harness_with(GatewayOptions::default(), false).await;
    let cookie = harness.sign_in("a@example.com", "web-a").await;
    let response = harness
        .http
        .get(harness.url(&format!("/cas/{}?device=desk-a", "a".repeat(64))))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 503);
    let body: serde_json::Value = response.json().await.unwrap();
    assert_eq!(body["error"], "pool_unavailable");
}

#[test]
fn entry_candidates_rank_online_full_hosts_by_latency_then_version() {
    let device = |id: &str, kind: Option<&str>, version: Option<&str>| DirectoryDevice {
        device_id: id.into(),
        device_name: id.into(),
        device_kind: kind.map(str::to_string),
        client_version: version.map(str::to_string),
        ..Default::default()
    };
    let member = |latency: Option<f64>, controller: bool| OnlineMember {
        route: Some("direct_ipv4".into()),
        latency_ms: latency,
        controller,
    };
    let devices = vec![
        device("cli-near", Some("cli"), Some("1.0.0")),
        device("desk-far", Some("desktop"), Some("1.0.0")),
        device("desk-near-old", Some("desktop"), Some("0.9.0")),
        device("desk-near-new", None, Some("1.2.0")),
        device("phone", Some("mobile"), None),
        device("desk-offline", Some("desktop"), Some("9.0.0")),
    ];
    let network = HashMap::from([
        ("cli-near".to_string(), member(Some(1.0), false)),
        ("desk-far".to_string(), member(Some(80.4), false)),
        ("desk-near-old".to_string(), member(Some(5.2), false)),
        ("desk-near-new".to_string(), member(Some(4.6), false)),
        ("phone".to_string(), member(Some(1.0), true)),
    ]);
    assert_eq!(
        entry_candidates(&devices, Some(&network), &HashMap::new()),
        vec!["desk-near-new", "desk-near-old", "desk-far", "cli-near"]
    );
    // Without the network's view: every device, directory presence first.
    let mut hinted = devices.clone();
    hinted[0].online = true;
    let ranked = entry_candidates(&hinted, None, &HashMap::new());
    assert_eq!(ranked.len(), devices.len());
    assert_eq!(ranked[0], "cli-near");
}

/// `fleet_v1` and `fleetLoad` from each device's probe rank the entries:
/// the fleet layer before a nearer host without it, and on equal latency
/// the less loaded host first. The cloud node comes last, always, and is
/// the only candidate when no device is online.
#[test]
fn entry_candidates_use_the_probed_fleet_layer_and_load_and_end_with_the_cloud_node() {
    let device = |id: &str, kind: Option<&str>| DirectoryDevice {
        device_id: id.into(),
        device_name: id.into(),
        device_kind: kind.map(str::to_string),
        client_version: Some("1.0.0".into()),
        ..Default::default()
    };
    let member = |latency: f64| OnlineMember {
        route: Some("direct_ipv4".into()),
        latency_ms: Some(latency),
        controller: false,
    };
    let devices = vec![
        device("cloud-x", Some("cloud_agent")),
        device("old-near", Some("desktop")),
        device("busy", Some("desktop")),
        device("idle", Some("desktop")),
        device("cli", Some("cli")),
    ];
    let network = HashMap::from([
        ("old-near".to_string(), member(1.0)),
        ("busy".to_string(), member(20.0)),
        ("idle".to_string(), member(20.0)),
        ("cli".to_string(), member(2.0)),
        // A cloud node is never a network member; it still ranks last.
    ]);
    let fleet = |load: u32| ProbeFacts {
        fleet_protocol: Some(1),
        fleet_load: Some(load),
    };
    let facts = HashMap::from([
        ("busy".to_string(), fleet(7)),
        ("idle".to_string(), fleet(1)),
        ("cli".to_string(), fleet(0)),
    ]);
    assert_eq!(
        entry_candidates(&devices, Some(&network), &facts),
        vec!["idle", "busy", "cli", "old-near", "cloud-x"]
    );
    // Unknown facts (older devices): latency decides, the cloud stays last.
    assert_eq!(
        entry_candidates(&devices, Some(&network), &HashMap::new()),
        vec!["old-near", "busy", "idle", "cli", "cloud-x"]
    );
    // Nobody online: the cloud node is the entry.
    assert_eq!(
        entry_candidates(&devices, Some(&HashMap::new()), &facts),
        vec!["cloud-x"]
    );
    // Only devices the ranking may list are probed (never the cloud node).
    assert_eq!(
        probe_targets(&devices, Some(&network)),
        vec!["old-near", "busy", "idle", "cli"]
    );
    assert_eq!(
        probe_targets(&devices, Some(&HashMap::new())),
        Vec::<String>::new()
    );
}

/// The device list probes each device's `/obp/mesh/info` (cached), lists
/// the cloud node last with where it is reached, keeps it out of the
/// device rows, and never opens a pipe to it.
#[tokio::test]
async fn devices_route_ranks_with_probes_and_lists_the_cloud_node_last() {
    let harness = harness(GatewayOptions::default()).await;
    harness.streams.infos.lock().unwrap().insert(
        "desk-b-off".into(),
        serde_json::json!({ "deviceId": "desk-b-off", "capabilities": ["fleet_v1"], "fleetLoad": 0 }),
    );
    *harness.streams.network.lock().unwrap() = Some(HashMap::from([
        (
            "desk-b".to_string(),
            OnlineMember {
                route: Some("direct_ipv4".into()),
                latency_ms: Some(1.0),
                controller: false,
            },
        ),
        (
            "desk-b-off".to_string(),
            OnlineMember {
                route: Some("relayed_server".into()),
                latency_ms: Some(90.0),
                controller: false,
            },
        ),
    ]));
    let cookie_b = harness.sign_in("b@example.com", "web-b").await;
    let read = || async {
        harness
            .http
            .get(harness.url("/obp/api/v1/devices"))
            .header("cookie", &cookie_b)
            .send()
            .await
            .unwrap()
            .json::<serde_json::Value>()
            .await
            .unwrap()
    };
    let devices = read().await;
    // The fleet host wins over the nearer host without the fleet layer
    // (desk-b is an older device: its probe gets no answer).
    assert_eq!(
        devices["entryCandidates"],
        serde_json::json!(["desk-b-off", "desk-b", "cloud-b"])
    );
    assert_eq!(
        devices["cloudNode"],
        // A node registered under the legacy default reads as "Super Agent".
        serde_json::json!({ "deviceId": "cloud-b", "name": "Super Agent", "path": "/agent/obp" })
    );
    let rows = devices["devices"].as_array().unwrap();
    assert!(
        rows.iter().all(|row| row["deviceId"] != "cloud-b"),
        "{rows:?}"
    );
    assert_eq!(harness.streams.info_requests.load(Ordering::SeqCst), 2);
    // Within 30 s the probes are reused.
    let again = read().await;
    assert_eq!(again["entryCandidates"], devices["entryCandidates"]);
    assert_eq!(harness.streams.info_requests.load(Ordering::SeqCst), 2);

    // No device online: the cloud node alone.
    *harness.streams.network.lock().unwrap() = Some(HashMap::new());
    let alone = read().await;
    assert_eq!(alone["entryCandidates"], serde_json::json!(["cloud-b"]));

    // A pipe to the cloud node is refused before any stream opens.
    let opens = harness.streams.opens.load(Ordering::SeqCst);
    let mut socket = harness
        .pipe("cloud-b", Some(&cookie_b), ORIGIN)
        .await
        .unwrap();
    let (code, reason) = close_code(&mut socket).await;
    assert_eq!(code, 4403, "{reason}");
    assert_eq!(harness.streams.opens.load(Ordering::SeqCst), opens);
}

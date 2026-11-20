//! Gateway routes against fake accounts and device streams: sign-in,
//! isolation, limits, idle cleanup, and the pipe itself.

use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures::{SinkExt, StreamExt};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message as WsMessage;

use super::*;
use crate::upstream::{BoxFuture, DeviceIo, Registered};

const ORIGIN: &str = "https://remote.example";

/// Two accounts: `acct-a` owns `desk-a`, `acct-b` owns `desk-b`.
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
            Ok(vec![
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
}

/// Echo streams; records which (account, device) were opened.
#[derive(Default)]
struct FakeStreams {
    opened: Mutex<Vec<(String, String)>>,
    fail: Mutex<Option<StreamError>>,
    open_count: AtomicUsize,
    /// The account network's members; `None`: the network cannot be read.
    network: Mutex<Option<HashMap<String, OnlineMember>>>,
    online_calls: AtomicUsize,
}

impl DeviceStreams for FakeStreams {
    fn open<'a>(
        &'a self,
        account_id: &'a str,
        device_id: &'a str,
    ) -> BoxFuture<'a, Result<Box<dyn DeviceIo>, StreamError>> {
        Box::pin(async move {
            self.open_count.fetch_add(1, Ordering::SeqCst);
            if let Some(error) = self.fail.lock().unwrap().clone() {
                return Err(error);
            }
            self.opened
                .lock()
                .unwrap()
                .push((account_id.to_string(), device_id.to_string()));
            let (near, mut far) = tokio::io::duplex(64 * 1024);
            tokio::spawn(async move {
                let mut buffer = [0u8; 4096];
                loop {
                    match far.read(&mut buffer).await {
                        Ok(0) | Err(_) => return,
                        Ok(count) => {
                            if far.write_all(&buffer[..count]).await.is_err() {
                                return;
                            }
                        }
                    }
                }
            });
            Ok(Box::new(near) as Box<dyn DeviceIo>)
        })
    }

    fn online<'a>(
        &'a self,
        _account_id: &'a str,
    ) -> BoxFuture<'a, Result<HashMap<String, OnlineMember>, StreamError>> {
        Box::pin(async move {
            self.online_calls.fetch_add(1, Ordering::SeqCst);
            self.network
                .lock()
                .unwrap()
                .clone()
                .ok_or_else(|| StreamError::Unavailable("network not joined".into()))
        })
    }
}

struct Harness {
    addr: SocketAddr,
    gateway: Arc<Gateway>,
    streams: Arc<FakeStreams>,
    http: reqwest::Client,
}

async fn harness(options: GatewayOptions) -> Harness {
    openbitfun_services_core::tls_provider::ensure_ring_crypto_provider();
    let streams = Arc::new(FakeStreams::default());
    let gateway = Gateway::new(
        Arc::new(FakeAccounts),
        Arc::clone(&streams) as Arc<dyn DeviceStreams>,
        SessionSealer::from_issuer_key(&[3; 32]),
        GatewayOptions {
            origins: vec![ORIGIN.to_string()],
            secure_cookies: false,
            ..options
        },
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
    assert_eq!(harness.streams.open_count.load(Ordering::SeqCst), 0);

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

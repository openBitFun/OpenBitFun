//! Refresh-token rotation shared by several clients of one profile.
//!
//! The identity service rotates per token family: a refresh consumes the
//! refresh token and revokes every earlier token of the family, including the
//! access token other clients may still hold. Each `AccountIdentityClient` (a
//! backend command, the directory session, the mesh, a CLI daemon on the same
//! profile) loads its own copy of the pair, so they must not spend the same
//! refresh token twice or treat the resulting 401 as a sign-out.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use openbitfun_services_core::credential_vault::CredentialVault;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use super::{AccountIdentityClient, CredentialStore, StoredMarketCredentials};

#[derive(Default)]
struct Service {
    /// token -> (family, revoked)
    tokens: HashMap<String, (u32, bool)>,
    next: u32,
    refresh_calls: u32,
    rejected_refreshes: u32,
}

impl Service {
    fn issue(&mut self, family: u32) -> StoredMarketCredentials {
        self.next += 1;
        let access = format!("access-{}", self.next);
        let refresh = format!("refresh-{}", self.next);
        self.tokens.insert(access.clone(), (family, false));
        self.tokens.insert(refresh.clone(), (family, false));
        let now = chrono::Utc::now().timestamp();
        StoredMarketCredentials {
            access_token: access,
            access_expires_at: now + 900,
            refresh_token: refresh,
            refresh_expires_at: now + 30 * 86400,
        }
    }

    fn live(&self, token: &str) -> bool {
        self.tokens.get(token).is_some_and(|(_, revoked)| !revoked)
    }

    /// The real service's rotation: claim the refresh token, revoke the whole
    /// family, issue a new pair in it.
    fn refresh(&mut self, token: &str) -> Option<StoredMarketCredentials> {
        self.refresh_calls += 1;
        let Some((family, false)) = self.tokens.get(token).copied() else {
            self.rejected_refreshes += 1;
            return None;
        };
        for (_, (owner, revoked)) in self.tokens.iter_mut() {
            if *owner == family {
                *revoked = true;
            }
        }
        Some(self.issue(family))
    }

    fn revoke_family_of(&mut self, token: &str) {
        let family = self.tokens[token].0;
        for (_, (owner, revoked)) in self.tokens.iter_mut() {
            if *owner == family {
                *revoked = true;
            }
        }
    }
}

async fn serve(service: Arc<Mutex<Service>>) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move {
        loop {
            let Ok((mut stream, _)) = listener.accept().await else {
                return;
            };
            let service = Arc::clone(&service);
            tokio::spawn(async move {
                let mut buffer = Vec::new();
                let mut chunk = [0u8; 4096];
                let (head, body_start) = loop {
                    let read = stream.read(&mut chunk).await.unwrap_or(0);
                    if read == 0 {
                        return;
                    }
                    buffer.extend_from_slice(&chunk[..read]);
                    if let Some(end) = buffer.windows(4).position(|w| w == b"\r\n\r\n") {
                        break (String::from_utf8_lossy(&buffer[..end]).to_string(), end + 4);
                    }
                };
                let length = head
                    .lines()
                    .find_map(|line| {
                        let (name, value) = line.split_once(':')?;
                        name.eq_ignore_ascii_case("content-length")
                            .then(|| value.trim().parse::<usize>().ok())?
                    })
                    .unwrap_or(0);
                while buffer.len() < body_start + length {
                    let read = stream.read(&mut chunk).await.unwrap_or(0);
                    if read == 0 {
                        break;
                    }
                    buffer.extend_from_slice(&chunk[..read]);
                }
                let body = &buffer[body_start..(body_start + length).min(buffer.len())];
                let request_line = head.lines().next().unwrap_or_default().to_string();
                let bearer = head.lines().find_map(|line| {
                    let (name, value) = line.split_once(':')?;
                    name.eq_ignore_ascii_case("authorization")
                        .then(|| value.trim().trim_start_matches("Bearer ").to_string())
                });
                let unauthorized = (
                    401,
                    r#"{"error":{"code":"unauthorized","message":"invalid"}}"#.to_string(),
                );
                let (status, json) = if request_line.starts_with("POST /api/v1/auth/refresh") {
                    // Widen the window in which a second refresher can send the
                    // same (about to be consumed) refresh token.
                    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                    let token = serde_json::from_slice::<serde_json::Value>(body)
                        .ok()
                        .and_then(|value| value["refreshToken"].as_str().map(str::to_string))
                        .unwrap_or_default();
                    match service.lock().unwrap().refresh(&token) {
                        Some(pair) => (
                            200,
                            serde_json::json!({
                                "accessToken": pair.access_token,
                                "accessExpiresAt": pair.access_expires_at,
                                "refreshToken": pair.refresh_token,
                                "refreshExpiresAt": pair.refresh_expires_at,
                            })
                            .to_string(),
                        ),
                        None => unauthorized,
                    }
                } else if request_line.starts_with("POST /api/v1/auth/logout") {
                    if let Some(token) = bearer {
                        service.lock().unwrap().revoke_family_of(&token);
                    }
                    (200, "{}".to_string())
                } else if request_line.starts_with("GET /api/v1/me") {
                    if bearer.is_some_and(|token| service.lock().unwrap().live(&token)) {
                        (
                            200,
                            r#"{"user":{"githubId":0,"accountId":"email-7","login":"u","avatarUrl":""},"isAdmin":false}"#
                                .to_string(),
                        )
                    } else {
                        unauthorized
                    }
                } else {
                    (404, "{}".to_string())
                };
                let reason = match status {
                    200 => "OK",
                    401 => "Unauthorized",
                    _ => "Not Found",
                };
                let response = format!(
                    "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{json}",
                    json.len()
                );
                let _ = stream.write_all(response.as_bytes()).await;
                let _ = stream.shutdown().await;
            });
        }
    });
    format!("http://{address}/api/v1")
}

struct Profile {
    _dir: tempfile::TempDir,
    store: CredentialStore,
    service: Arc<Mutex<Service>>,
    url: String,
}

/// One profile signed in with one pair whose access token has expired (so
/// every client that uses it must refresh).
async fn profile(access_expired: bool) -> (Profile, StoredMarketCredentials) {
    let dir = tempfile::tempdir().unwrap();
    let store = CredentialStore::Vault(CredentialVault::new(
        dir.path().join(".market_credentials_vault.key"),
        dir.path().join("market_credentials_vault.json"),
    ));
    let service = Arc::new(Mutex::new(Service::default()));
    let mut pair = service.lock().unwrap().issue(1);
    if access_expired {
        pair.access_expires_at = chrono::Utc::now().timestamp() - 1;
    }
    store.save(&pair).await.unwrap();
    let url = serve(Arc::clone(&service)).await;
    (
        Profile {
            _dir: dir,
            store,
            service,
            url,
        },
        pair,
    )
}

impl Profile {
    async fn client(&self) -> AccountIdentityClient {
        AccountIdentityClient::with_store(self.url.clone(), self.store.clone())
            .await
            .unwrap()
    }
}

#[tokio::test]
async fn clients_that_loaded_the_same_expired_pair_refresh_once_and_stay_signed_in() {
    let (profile, original) = profile(true).await;
    // Loaded before anyone refreshes, as several backend tasks (or a desktop
    // and a CLI daemon on one profile) do.
    let mut clients = Vec::new();
    for _ in 0..4 {
        clients.push(profile.client().await);
    }
    let tokens = futures_join_all(clients.iter_mut().map(|client| client.access_token())).await;
    let tokens: Vec<String> = tokens
        .into_iter()
        .map(|token| {
            token
                .unwrap()
                .expect("no client is signed out by the rotation")
        })
        .collect();
    assert!(tokens.iter().all(|token| token == &tokens[0]));
    assert_ne!(tokens[0], original.access_token);
    let service = profile.service.lock().unwrap();
    assert_eq!(service.refresh_calls, 1, "the refresh token is spent once");
    assert_eq!(service.rejected_refreshes, 0);
    drop(service);
    let stored = profile
        .store
        .load()
        .await
        .unwrap()
        .expect("the profile keeps its sign-in");
    assert_eq!(stored.access_token, tokens[0]);
}

#[tokio::test]
async fn a_client_holding_the_pair_another_client_rotated_adopts_the_new_pair() {
    let (profile, _) = profile(true).await;
    let mut first = profile.client().await;
    let mut second = profile.client().await;
    // One after the other: the second still holds the consumed refresh token.
    let refreshed = first.access_token().await.unwrap().unwrap();
    let adopted = second.access_token().await.unwrap();
    assert_eq!(adopted.as_deref(), Some(refreshed.as_str()));
    assert_eq!(profile.service.lock().unwrap().rejected_refreshes, 0);
    assert!(second.me().await.unwrap().is_some());
}

#[tokio::test]
async fn a_revoked_access_token_after_a_rotation_elsewhere_is_not_a_sign_out() {
    // A fresh pair: `me` does not refresh first.
    let (profile, original) = profile(false).await;
    let mut stale = profile.client().await;
    // Another process on the profile (for example an older build that does
    // not take the update lock) rotates the pair and saves it.
    let rotated = profile
        .service
        .lock()
        .unwrap()
        .refresh(&original.refresh_token)
        .unwrap();
    profile.store.save(&rotated).await.unwrap();
    // `stale` still sends the revoked access token: the 401 is recovered.
    assert!(stale.me().await.unwrap().is_some());
    assert_eq!(
        profile
            .store
            .load()
            .await
            .unwrap()
            .map(|pair| pair.access_token),
        Some(rotated.access_token)
    );
}

#[tokio::test]
async fn a_revoked_sign_in_is_still_signed_out() {
    let (profile, original) = profile(false).await;
    let mut client = profile.client().await;
    // Signed out elsewhere: the service revokes the whole family.
    profile
        .service
        .lock()
        .unwrap()
        .revoke_family_of(&original.access_token);
    assert!(client.me().await.unwrap().is_none());
    assert!(profile.store.load().await.unwrap().is_none());
}

#[tokio::test]
async fn logout_serializes_with_in_flight_refresh_via_update_guard() {
    let (profile, _) = profile(true).await;
    let mut refresher = profile.client().await;
    let mut logger_out = profile.client().await;
    let (refresh_res, logout_res) = tokio::join!(refresher.access_token(), logger_out.logout());
    assert!(refresh_res.is_ok());
    assert!(logout_res.is_ok());
    // Regardless of which task acquired the guard first, the store must end
    // signed out and never retain credentials resurrected by a racing refresh.
    assert!(
        profile.store.load().await.unwrap().is_none(),
        "credentials must stay cleared after logout"
    );
}

async fn futures_join_all<F: std::future::Future>(
    futures: impl Iterator<Item = F>,
) -> Vec<F::Output> {
    let handles: Vec<_> = futures.map(Box::pin).collect();
    let mut outputs = Vec::with_capacity(handles.len());
    // Poll them together so every refresh is in flight at once.
    let mut pending: Vec<_> = handles.into_iter().map(Some).collect();
    let mut results: Vec<Option<F::Output>> = (0..pending.len()).map(|_| None).collect();
    std::future::poll_fn(|cx| {
        let mut done = true;
        for (slot, result) in pending.iter_mut().zip(results.iter_mut()) {
            if let Some(future) = slot.as_mut() {
                match future.as_mut().poll(cx) {
                    std::task::Poll::Ready(output) => {
                        *result = Some(output);
                        *slot = None;
                    }
                    std::task::Poll::Pending => done = false,
                }
            }
        }
        if done {
            std::task::Poll::Ready(())
        } else {
            std::task::Poll::Pending
        }
    })
    .await;
    outputs.extend(results.into_iter().map(Option::unwrap));
    outputs
}

//! In-app email sign-in against a fake identity service that speaks the real
//! service's device sign-in, email code and poll endpoints.

use std::sync::{Arc, Mutex};

use openbitfun_product_domains::account::{AccountEmailStartRequest, AccountEmailVerifyRequest};
use openbitfun_services_core::credential_vault::CredentialVault;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use super::super::{AccountIdentityClient, CredentialStore};
use super::EmailSignIns;

const CODE: &str = "01234567";

#[derive(Default)]
struct Service {
    /// Transactions started (`/auth/desktop/start`).
    starts: u32,
    /// The query of the last start (`methods=all` for the email page).
    last_start_query: String,
    /// Codes sent: (ticket, email, locale).
    sends: Vec<(String, String, String)>,
    /// The transaction a verified code authorized.
    authorized: Option<String>,
    /// Tickets the service no longer knows (expired login flows).
    forgotten: Vec<String>,
    /// Answer every send with 429.
    rate_limited: bool,
    /// The sign-in page carries no ticket (a service without email sign-in).
    no_ticket: bool,
}

struct Reply(u16, String);

fn error(status: u16, code: &str, message: &str) -> Reply {
    Reply(
        status,
        serde_json::json!({"error": {"code": code, "message": message}}).to_string(),
    )
}

fn handle(service: &Mutex<Service>, request_line: &str, body: &serde_json::Value) -> Reply {
    let mut service = service.lock().unwrap();
    let path = request_line.split(' ').nth(1).unwrap_or_default();
    if request_line.starts_with("POST /api/v1/auth/desktop/start") {
        service.starts += 1;
        service.last_start_query = path
            .split_once('?')
            .map(|(_, q)| q.to_string())
            .unwrap_or_default();
        let n = service.starts;
        let url = if service.no_ticket {
            "https://github.com/login/oauth/authorize?state=x".to_string()
        } else {
            format!("https://auth.example/sign-in#ticket=ticket-{n}")
        };
        return Reply(
            200,
            serde_json::json!({
                "transactionId": format!("txn-{n}"),
                "transactionSecret": format!("secret-{n}"),
                "authorizationUrl": url,
                "expiresAt": chrono::Utc::now().timestamp() + 900,
                "pollIntervalSeconds": 3,
            })
            .to_string(),
        );
    }
    if request_line.starts_with("POST /api/v1/auth/email/send") {
        let ticket = body["ticket"].as_str().unwrap_or_default().to_string();
        if service.forgotten.contains(&ticket) {
            return error(
                400,
                "login_flow_expired",
                "This sign-in request is no longer active.",
            );
        }
        if service.rate_limited {
            return error(429, "email_rate_limit", "Too many verification requests.");
        }
        let email = body["email"].as_str().unwrap_or_default().to_string();
        if !email.contains('@') {
            return error(400, "invalid_email", "Invalid email.");
        }
        service.sends.push((
            ticket.clone(),
            email,
            body["locale"].as_str().unwrap_or_default().to_string(),
        ));
        let id = format!("challenge-{}", service.sends.len());
        return Reply(
            200,
            serde_json::json!({"challengeId": id, "retryAfterSeconds": 60}).to_string(),
        );
    }
    if request_line.starts_with("POST /api/v1/auth/email/verify") {
        let ticket = body["ticket"].as_str().unwrap_or_default();
        let challenge = body["challengeId"].as_str().unwrap_or_default();
        let latest = format!("challenge-{}", service.sends.len());
        if body["code"] != CODE || challenge != latest {
            return error(
                400,
                "invalid_email_code",
                "The verification code is incorrect.",
            );
        }
        let n = ticket.trim_start_matches("ticket-").to_string();
        service.authorized = Some(format!("txn-{n}"));
        return Reply(200, r#"{"ok":true}"#.to_string());
    }
    if request_line.starts_with("POST /api/v1/auth/desktop/poll") {
        let id = body["transactionId"].as_str().unwrap_or_default();
        let n = id.trim_start_matches("txn-");
        if body["transactionSecret"] != format!("secret-{n}") {
            return error(401, "unauthorized", "invalid");
        }
        if service.authorized.as_deref() == Some(id) {
            let now = chrono::Utc::now().timestamp();
            return Reply(
                200,
                serde_json::json!({
                    "status": "authorized",
                    "tokens": {
                        "accessToken": "access-1", "accessExpiresAt": now + 900,
                        "refreshToken": "refresh-1", "refreshExpiresAt": now + 86400,
                    }
                })
                .to_string(),
            );
        }
        return Reply(200, r#"{"status":"pending"}"#.to_string());
    }
    if request_line.starts_with("GET /api/v1/me") {
        return Reply(
            200,
            r#"{"user":{"githubId":0,"accountId":"email-7","login":"user-87b544d554494ceaa50e23d89550a954","avatarUrl":""},"email":"alice@example.com","isAdmin":false}"#
                .to_string(),
        );
    }
    error(404, "not_found", "not found")
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
                let body: serde_json::Value = serde_json::from_slice(body).unwrap_or_default();
                let request_line = head.lines().next().unwrap_or_default().to_string();
                let Reply(status, json) = handle(&service, &request_line, &body);
                let response = format!(
                    "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{json}",
                    json.len()
                );
                let _ = stream.write_all(response.as_bytes()).await;
                let _ = stream.shutdown().await;
            });
        }
    });
    format!("http://{address}/api/v1")
}

struct Fixture {
    _dir: tempfile::TempDir,
    store: CredentialStore,
    service: Arc<Mutex<Service>>,
    url: String,
    sign_ins: EmailSignIns,
}

async fn fixture() -> Fixture {
    let dir = tempfile::tempdir().unwrap();
    let store = CredentialStore::Vault(CredentialVault::new(
        dir.path().join(".market_credentials_vault.key"),
        dir.path().join("market_credentials_vault.json"),
    ));
    let service = Arc::new(Mutex::new(Service::default()));
    let url = serve(Arc::clone(&service)).await;
    Fixture {
        _dir: dir,
        store,
        service,
        url,
        sign_ins: EmailSignIns::default(),
    }
}

impl Fixture {
    async fn client(&self) -> AccountIdentityClient {
        AccountIdentityClient::with_store(self.url.clone(), self.store.clone())
            .await
            .unwrap()
    }

    async fn start(
        &self,
        email: &str,
    ) -> Result<openbitfun_product_domains::account::AccountEmailChallenge, super::MarketClientError>
    {
        self.sign_ins
            .start(
                &self.client().await,
                AccountEmailStartRequest {
                    email: email.to_string(),
                    locale: Some("zh-CN".to_string()),
                },
            )
            .await
    }

    async fn verify(&self, challenge_id: &str, code: &str) -> Result<(), super::MarketClientError> {
        self.sign_ins
            .verify(
                &mut self.client().await,
                AccountEmailVerifyRequest {
                    challenge_id: challenge_id.to_string(),
                    code: code.to_string(),
                },
            )
            .await
    }
}

#[tokio::test]
async fn email_code_signs_the_host_in_without_a_browser() {
    let f = fixture().await;
    let challenge = f.start(" Alice@Example.com ").await.unwrap();
    assert_eq!(challenge.email, "alice@example.com");
    assert_eq!(challenge.code_length, 8);
    assert_eq!(challenge.retry_after_seconds, 60);
    assert!(challenge.expires_at.unwrap() > chrono::Utc::now().timestamp_millis());
    {
        let service = f.service.lock().unwrap();
        assert_eq!(service.last_start_query, "methods=all");
        assert_eq!(
            service.sends,
            vec![(
                "ticket-1".into(),
                "Alice@Example.com".into(),
                "zh-CN".into()
            )]
        );
    }
    assert!(f.store.load().await.unwrap().is_none());
    f.verify(&challenge.challenge_id, "0123 4567")
        .await
        .unwrap();
    let stored = f
        .store
        .load()
        .await
        .unwrap()
        .expect("the token pair is kept");
    assert_eq!(stored.access_token, "access-1");
    // The projection every surface shows: the email, never `user-<hash>`.
    let me = f.client().await.me().await.unwrap().unwrap();
    let identity = me.identity().unwrap();
    assert_eq!(identity.display_name, "alice@example.com");
    assert_eq!(identity.account_id, "email-7");
    // The pending sign-in is spent.
    let again = f.verify(&challenge.challenge_id, CODE).await.unwrap_err();
    assert_eq!(again.code, "invalid_code");
}

#[tokio::test]
async fn a_wrong_code_can_be_typed_again_and_a_resend_reuses_the_transaction() {
    let f = fixture().await;
    let first = f.start("a@example.com").await.unwrap();
    let wrong = f.verify(&first.challenge_id, "99999999").await.unwrap_err();
    assert_eq!(wrong.code, "invalid_code");
    assert!(wrong.coded_message().starts_with("invalid_code: "));
    let second = f.start("a@example.com").await.unwrap();
    assert_ne!(first.challenge_id, second.challenge_id);
    assert_eq!(
        f.service.lock().unwrap().starts,
        1,
        "one transaction for both codes"
    );
    // Only the latest challenge is active.
    assert_eq!(
        f.verify(&first.challenge_id, CODE).await.unwrap_err().code,
        "invalid_code"
    );
    f.verify(&second.challenge_id, CODE).await.unwrap();
    assert!(f.store.load().await.unwrap().is_some());
}

#[tokio::test]
async fn a_transaction_the_service_forgot_is_started_again_once() {
    let f = fixture().await;
    f.start("a@example.com").await.unwrap();
    f.service.lock().unwrap().forgotten.push("ticket-1".into());
    let challenge = f.start("a@example.com").await.unwrap();
    assert_eq!(f.service.lock().unwrap().starts, 2);
    f.verify(&challenge.challenge_id, CODE).await.unwrap();
}

#[tokio::test]
async fn refusals_carry_stable_codes() {
    let f = fixture().await;
    assert_eq!(
        f.start("not-an-email").await.unwrap_err().code,
        "invalid_email"
    );
    assert_eq!(
        f.service.lock().unwrap().starts,
        0,
        "refused before any request"
    );
    assert_eq!(
        f.verify("nope", CODE).await.unwrap_err().code,
        "invalid_code"
    );
    f.service.lock().unwrap().rate_limited = true;
    assert_eq!(
        f.start("a@example.com").await.unwrap_err().code,
        "rate_limited"
    );

    let no_email = fixture().await;
    no_email.service.lock().unwrap().no_ticket = true;
    assert_eq!(
        no_email.start("a@example.com").await.unwrap_err().code,
        "unsupported"
    );

    // Nothing listens there: the request never reached the service.
    let offline = EmailSignIns::default();
    let dir = tempfile::tempdir().unwrap();
    let store = CredentialStore::Vault(CredentialVault::new(
        dir.path().join("k"),
        dir.path().join("v.json"),
    ));
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    let client =
        AccountIdentityClient::with_store(format!("http://127.0.0.1:{port}/api/v1"), store)
            .await
            .unwrap();
    let error = offline
        .start(
            &client,
            AccountEmailStartRequest {
                email: "a@example.com".into(),
                locale: None,
            },
        )
        .await
        .unwrap_err();
    assert_eq!(error.code, "network");
}

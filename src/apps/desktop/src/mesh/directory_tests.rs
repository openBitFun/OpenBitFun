//! The device network's account authority reads the new-version account
//! directory session, never the legacy relay account context.

use std::sync::Arc;

use async_trait::async_trait;
use openbitfun_obp::MeshAuthority;
use openbitfun_relay_service::{build_relay_router, db, MemoryAssetStore};
use openbitfun_services_integrations::remote_connect::account::AccountSession;
use openbitfun_services_integrations::remote_connect::device_crypto;
use openbitfun_services_integrations::remote_connect::directory_session::{
    DirectoryLogin, DirectorySessions,
};
use openbitfun_services_integrations::remote_connect::DeviceIdentity;

use super::{AccountKey, AccountMeshAuthority};

const LOCAL: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const PEER: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

/// Signs in with a session issued by the local directory (the identity
/// exchange itself is the directory's `/api/auth/login`, covered there).
struct IssuedLogin(AccountSession);

#[async_trait]
impl DirectoryLogin for IssuedLogin {
    async fn login(&self, _url: &str, _device: &DeviceIdentity) -> anyhow::Result<AccountSession> {
        Ok(self.0.clone())
    }
    async fn revoke(&self, _url: &str, _session: &AccountSession) {}
    async fn ensure(&self, _url: &str) -> anyhow::Result<()> {
        Ok(())
    }
}

#[tokio::test]
async fn pair_keys_and_kinds_come_from_the_directory_session() {
    let database = Arc::new(db::connect(":memory:").await.unwrap());
    db::UserRow::upsert_verified(&database, "42", "directory-test")
        .await
        .unwrap();
    let local_secret = device_crypto::generate_secret();
    let peer_secret = device_crypto::generate_secret();
    for (id, kind, secret) in [
        (LOCAL, "desktop", &local_secret),
        (PEER, "cli", &peer_secret),
    ] {
        db::DeviceRow::upsert(
            &database,
            id,
            "42",
            id,
            Some(kind),
            Some(&device_crypto::public_key_base64(secret)),
        )
        .await
        .unwrap();
    }
    let token = db::AuthToken::create(&database, "42", LOCAL).await.unwrap();

    // The directory under its path prefix, as `super.openbitfun.com/directory`.
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let app = axum::Router::new().nest(
        "/directory",
        build_relay_router(
            Arc::new(MemoryAssetStore::new()),
            std::time::Instant::now(),
            database.clone(),
            env!("CARGO_PKG_VERSION"),
        ),
    );
    let server = tokio::spawn(async move {
        axum::serve(
            listener,
            app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
        )
        .await
        .unwrap();
    });

    let sessions = Arc::new(DirectorySessions::new(
        format!("http://127.0.0.1:{port}/directory"),
        Arc::new(IssuedLogin(AccountSession::new(
            token.token,
            "42".into(),
            local_secret,
        ))),
    ));
    sessions
        .context(&DeviceIdentity {
            device_id: LOCAL.into(),
            device_name: "Local".into(),
            mac_address: "00:00:00:00:00:01".into(),
        })
        .await
        .unwrap();
    crate::api::account_directory::install_for_test(sessions);

    // No legacy relay is configured or reachable in this process for this
    // account: the authority must not need one.
    let authority = AccountMeshAuthority {
        account: AccountKey {
            user_id: "42".into(),
            device_id: LOCAL.into(),
        },
    };
    let key = authority.pair_key(PEER).await.unwrap();
    let expected = device_crypto::derive_message_key(
        &local_secret,
        &openbitfun_services_integrations::remote_connect::encryption::parse_public_key(
            &device_crypto::public_key_base64(&peer_secret),
        )
        .unwrap(),
    )
    .unwrap();
    assert_eq!(key, expected);
    assert_eq!(
        authority.device_kind(PEER).await.unwrap().as_deref(),
        Some("cli")
    );
    // A device of another account is not resolved.
    let other = AccountMeshAuthority {
        account: AccountKey {
            user_id: "43".into(),
            device_id: LOCAL.into(),
        },
    };
    assert!(other.pair_key(PEER).await.is_err());
    // The cloud node endpoint follows the directory, not the legacy relay.
    assert_eq!(
        openbitfun_obp::client::cloud::cloud_node_url(
            &crate::api::account_directory::directory_url()
        )
        .as_deref(),
        Some(format!("ws://127.0.0.1:{port}/agent/obp").as_str())
    );
    server.abort();
}

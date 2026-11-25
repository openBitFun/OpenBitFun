//! Opt-in loopback control of the Runtime owned by this desktop instance.
mod http;
mod store;
mod turns;

use crate::api::app_state::AppState;
use crate::host::HostHandle;
use openbitfun_core::service::workspace::{WorkspaceInfo, WorkspaceKind};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{collections::BTreeSet, path::PathBuf, sync::Arc};
use store::{Grant, Settings, Store};
use tokio::{
    net::TcpListener,
    sync::{oneshot, Mutex},
};
use uuid::Uuid;

pub(super) const PORT: u16 = 38371;

struct Listener {
    generation: Uuid,
    _shutdown: oneshot::Sender<()>,
}

struct Inner {
    settings: Settings,
    listener: Option<Listener>,
    listener_error: Option<String>,
}

pub(crate) struct DesktopController {
    storage: Result<Store, String>,
    inner: Mutex<Inner>,
    instance: Uuid,
    admission: Mutex<()>,
}

impl DesktopController {
    pub(crate) fn new(root: PathBuf) -> Arc<Self> {
        let source = Store::open(root).and_then(|store| Ok((store.settings()?, store)));
        let (settings, storage) = match source {
            Ok((settings, store)) => (settings, Ok(store)),
            Err(e) => (Settings::default(), Err(e)),
        };
        Arc::new(Self {
            storage,
            inner: Mutex::new(Inner {
                settings,
                listener: None,
                listener_error: None,
            }),
            instance: Uuid::new_v4(),
            admission: Mutex::new(()),
        })
    }

    pub(crate) async fn stop(&self) {
        self.inner.lock().await.listener = None;
    }

    fn store(&self) -> Result<&Store, String> {
        self.storage.as_ref().map_err(Clone::clone)
    }

    async fn listen(&self, app: HostHandle, port: u16) -> Result<Listener, String> {
        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port))
            .await
            .map_err(|e| format!("Cannot listen on 127.0.0.1:{port}: {e}"))?;
        Self::serve(app, listener)
    }

    fn serve(app: HostHandle, listener: TcpListener) -> Result<Listener, String> {
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();
        let generation = Uuid::new_v4();
        let router = http::router(app.clone(), generation, port);
        let (shutdown, end) = oneshot::channel();
        tokio::spawn(async move {
            let result = axum::serve(listener, router)
                .with_graceful_shutdown(async {
                    let _ = end.await;
                })
                .await;
            let controller = app.state::<Arc<DesktopController>>();
            let mut inner = controller.inner.lock().await;
            if inner
                .listener
                .as_ref()
                .is_some_and(|l| l.generation == generation)
            {
                inner.listener = None;
                inner.listener_error = Some(
                    result
                        .err()
                        .map(|e| e.to_string())
                        .unwrap_or_else(|| "Controller stopped".into()),
                );
            }
        });
        Ok(Listener {
            generation,
            _shutdown: shutdown,
        })
    }
}

pub(crate) async fn restore(app: HostHandle) {
    let host = app.state::<Arc<DesktopController>>();
    let mut inner = host.inner.lock().await;
    if inner.settings.enabled && inner.listener.is_none() {
        match host
            .listen(app.clone(), inner.settings.port.unwrap_or(PORT))
            .await
        {
            Ok(listener) => inner.listener = Some(listener),
            Err(error) => {
                log::warn!("Desktop external controller unavailable: {error}");
                inner.listener_error = Some(error);
            }
        }
    }
}

fn eligible(w: &WorkspaceInfo) -> bool {
    w.workspace_kind == WorkspaceKind::Normal && w.worktree.as_ref().is_none_or(|tree| tree.is_main)
}

async fn workspaces(app: &HostHandle) -> Vec<WorkspaceInfo> {
    app.state::<AppState>()
        .workspace_service
        .list_workspace_infos()
        .await
        .into_iter()
        .filter(eligible)
        .collect()
}

#[derive(Deserialize)]
#[serde(
    tag = "operation",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub(crate) enum ControllerSettingsRequest {
    Status,
    SetEnabled {
        enabled: bool,
        port: Option<std::num::NonZeroU16>,
    },
    Issue {
        name: String,
        workspace_ids: BTreeSet<String>,
        origin: Option<String>,
    },
    Revoke {
        id: Uuid,
    },
}

fn browser_origin(value: &str) -> Result<String, String> {
    let url = reqwest::Url::parse(value).map_err(|_| "Invalid browser origin")?;
    let origin = url.origin().ascii_serialization();
    if !matches!(url.scheme(), "https" | "http") || origin != value.trim_end_matches('/') {
        return Err("Enter an exact HTTP or HTTPS origin".into());
    }
    Ok(origin)
}

// @backend-command
pub(crate) async fn desktop_external_control(
    app: HostHandle,
    request: ControllerSettingsRequest,
) -> Result<Value, String> {
    let host = app.state::<Arc<DesktopController>>();
    let store = host.store()?;
    let catalog = workspaces(&app).await;
    let mut inner = host.inner.lock().await;
    let mut next = inner.settings.clone();
    let mut token = None;
    match request {
        ControllerSettingsRequest::Status => {}
        ControllerSettingsRequest::SetEnabled { enabled, port } => {
            let port = port.map(|p| p.get()).or(next.port).unwrap_or(PORT);
            let listener =
                if enabled && (inner.listener.is_none() || next.port.unwrap_or(PORT) != port) {
                    Some(host.listen(app.clone(), port).await?)
                } else {
                    None
                };
            next.enabled = enabled;
            next.port = Some(port);
            store.save_settings(&next)?;
            if !enabled {
                inner.listener = None;
            } else if listener.is_some() {
                inner.listener = listener;
            }
            inner.listener_error = None;
        }
        ControllerSettingsRequest::Issue {
            name,
            workspace_ids,
            origin,
        } => {
            if name.trim().is_empty()
                || name.len() > 128
                || workspace_ids.is_empty()
                || !workspace_ids
                    .iter()
                    .all(|id| catalog.iter().any(|w| &w.id == id))
            {
                return Err("Select a local workspace and enter an integration name".into());
            }
            let origin = origin
                .as_deref()
                .filter(|s| !s.is_empty())
                .map(browser_origin)
                .transpose()?;
            let secret = format!("obf_{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
            next.grants.push(Grant {
                id: Uuid::new_v4(),
                name: name.trim().into(),
                workspace_ids,
                origin,
                token_hash: store::digest(secret.as_bytes()),
            });
            store.save_settings(&next)?;
            token = Some(secret);
        }
        ControllerSettingsRequest::Revoke { id } => {
            next.grants.retain(|g| g.id != id);
            store.save_settings(&next)?;
        }
    }
    inner.settings = next;
    Ok(json!({
        "enabled": inner.settings.enabled, "listening": inner.listener.is_some(),
        "port": inner.settings.port.unwrap_or(PORT),
        "endpoint": format!("http://127.0.0.1:{}/v1", inner.settings.port.unwrap_or(PORT)), "error": inner.listener_error,
        "token": token,
        "grants": inner.settings.grants.iter().map(|g| json!({"id":g.id, "name":g.name, "workspaceIds":g.workspace_ids, "origin":g.origin})).collect::<Vec<_>>(),
        "workspaces": catalog.iter().map(|w| json!({"id":w.id, "name":w.name})).collect::<Vec<_>>()
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use reqwest::{header, StatusCode};

    #[test]
    fn external_control_settings_require_the_backend_owner() {
        use openbitfun_obp::server::{check_command, Scope};
        let check = |scope: Scope| check_command(&scope, "desktop_external_control", &|_| false);
        assert!(check(Scope::Owner).is_ok());
        assert!(check(Scope::PairedClient {
            client_id: "browser".into()
        })
        .is_err());
        assert!(check(Scope::AccountDevice {
            device_id: "peer".into()
        })
        .is_err());
        assert!(check(Scope::CloudAgent {
            device_id: "agent".into()
        })
        .is_err());
    }

    #[tokio::test]
    async fn external_control_native_listener_enforces_grant_scope_and_revocation() {
        let root = tempfile::tempdir().unwrap();
        let controller = DesktopController::new(root.path().to_owned());
        let native = crate::native_host::create_native_host();
        native.manage(controller.clone());
        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .unwrap();
        let base = format!("http://{}/v1", listener.local_addr().unwrap());
        let url = format!("{base}/capabilities");
        crate::ensure_rustls_crypto_provider();
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let token = "fixture-token";
        let origin = "https://board.example";
        {
            let mut inner = controller.inner.lock().await;
            inner.settings.grants.push(Grant {
                id: Uuid::new_v4(),
                name: "board".into(),
                workspace_ids: BTreeSet::from(["project".into()]),
                origin: Some(origin.into()),
                token_hash: store::digest(token.as_bytes()),
            });
            inner.listener =
                Some(DesktopController::serve(HostHandle::new(native), listener).unwrap());
        }

        assert_eq!(
            client.get(&url).send().await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
        let allowed = client
            .get(&url)
            .bearer_auth(token)
            .header(header::ORIGIN, origin)
            .send()
            .await
            .unwrap();
        assert_eq!(allowed.status(), StatusCode::OK);
        assert_eq!(
            allowed.headers()[header::ACCESS_CONTROL_ALLOW_ORIGIN],
            origin
        );
        assert_eq!(allowed.json::<Value>().await.unwrap()["version"], 1);
        let forbidden = client
            .get(&url)
            .bearer_auth(token)
            .header(header::ORIGIN, "https://other.example")
            .send()
            .await
            .unwrap();
        assert_eq!(forbidden.status(), StatusCode::UNAUTHORIZED);
        let wrong_host = client
            .get(&url)
            .bearer_auth(token)
            .header(header::HOST, "other.example")
            .send()
            .await
            .unwrap();
        assert_eq!(wrong_host.status(), StatusCode::FORBIDDEN);
        let wrong_project = client
            .post(format!("{base}/turns"))
            .bearer_auth(token)
            .json(&json!({"workspaceId":"another-project","prompt":"check","idempotencyKey":"1"}))
            .send()
            .await
            .unwrap();
        assert_eq!(wrong_project.status(), StatusCode::FORBIDDEN);

        controller.inner.lock().await.settings.grants.clear();
        assert_eq!(
            client
                .get(&url)
                .bearer_auth(token)
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::UNAUTHORIZED
        );
        controller.stop().await;
    }
}

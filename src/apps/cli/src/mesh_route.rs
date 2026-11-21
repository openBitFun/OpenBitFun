//! The CLI host's [`AccountDeviceMeshRoute`]: Detached Dispatch and the IM
//! bots hosted by this process reach the account's other devices over OBP on
//! OpenBitFun Link, through the fleet's own Link node.
//!
//! The route is installed once per process and bound to Link while this host
//! serves the device (`crate::obp_host` attaches it when the mesh listener
//! starts for an account and detaches it when Link stops). A device is called
//! when it is a backend device on the account's Link network and its OBP
//! `hello` advertises the capability the caller needs (`dispatch_target_v1`,
//! `remote_command_v1`); anything else answers `None`, which the caller
//! reports as `device_not_on_link`. There is no other transport.
//!
//! One connection per device is kept and reused. It never reads the device's
//! event stream: it asks for the smallest event window and never
//! acknowledges, so the target stops sending events after it (calls are not
//! windowed). A transport failure (code 0, a cached connection that closed)
//! reconnects once over Link.

use std::collections::HashMap;
use std::sync::{Arc, OnceLock, RwLock};

use async_trait::async_trait;
use openbitfun_core::service::remote_connect::mesh_route::{
    install_mesh_route, AccountDeviceMeshRoute, DEVICE_NOT_ON_LINK,
};
use openbitfun_link::session::Link;
use openbitfun_obp::client::links::PeerConnector;
use openbitfun_obp::client::{MeshCallError, MeshConnectOptions, MeshObpConnection};
use openbitfun_obp::fleet::host::LinkPeerConnector;
use openbitfun_obp::server::MeshAuthority;
use serde_json::Value;

/// Smallest event window the server accepts; the route only makes calls.
const CALL_ONLY_CREDIT_BYTES: u64 = 64 * 1024;

/// How the route reaches devices (Link in production, a fake in tests).
#[async_trait]
trait DeviceDialer: Send + Sync {
    /// Whether `device_id` is a backend device on the account's Link network.
    async fn on_link(&self, device_id: &str) -> bool;
    /// Opens an authenticated account-device OBP connection to `device_id`.
    async fn connect(&self, device_id: &str) -> Result<Arc<dyn RouteConnection>, String>;
}

/// One OBP connection as the route uses it.
#[async_trait]
trait RouteConnection: Send + Sync {
    /// The mesh capabilities the device's `hello` advertised.
    fn capabilities(&self) -> Vec<String>;
    async fn call(&self, command: &str, args: Value) -> Result<Value, MeshCallError>;
}

#[async_trait]
impl RouteConnection for MeshObpConnection {
    fn capabilities(&self) -> Vec<String> {
        self.hello()["capabilities"]
            .as_array()
            .map(|capabilities| {
                capabilities
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default()
    }

    async fn call(&self, command: &str, args: Value) -> Result<Value, MeshCallError> {
        MeshObpConnection::call(self, command, args).await
    }
}

/// The account's Link network as the fleet joined it.
struct LinkDialer {
    link: Arc<Link>,
    connector: Arc<LinkPeerConnector>,
}

#[async_trait]
impl DeviceDialer for LinkDialer {
    async fn on_link(&self, device_id: &str) -> bool {
        let mut status = self.link.status();
        if status.peer(device_id).is_none() {
            status = self.link.refresh().await;
        }
        // A controller (phone app, browser) serves no backend.
        status
            .peer(device_id)
            .is_some_and(|peer| !peer.role.is_controller())
    }

    async fn connect(&self, device_id: &str) -> Result<Arc<dyn RouteConnection>, String> {
        let connection = self
            .connector
            .connect(
                device_id.to_string(),
                MeshConnectOptions {
                    credit_bytes: Some(CALL_ONLY_CREDIT_BYTES),
                    ..MeshConnectOptions::default()
                },
            )
            .await?;
        Ok(Arc::new(connection))
    }
}

type Slot = Arc<tokio::sync::Mutex<Option<Arc<dyn RouteConnection>>>>;

#[derive(Default)]
struct CliMeshRoute {
    dialer: RwLock<Option<Arc<dyn DeviceDialer>>>,
    connections: std::sync::Mutex<HashMap<String, Slot>>,
}

impl CliMeshRoute {
    fn set_dialer(&self, dialer: Option<Arc<dyn DeviceDialer>>) {
        *self
            .dialer
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = dialer;
        // Connections of another account or of a stopped Link are not reused.
        self.connections
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clear();
    }

    fn dialer(&self) -> Option<Arc<dyn DeviceDialer>> {
        self.dialer
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    fn slot(&self, device_id: &str) -> Slot {
        let mut connections = self
            .connections
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        Arc::clone(connections.entry(device_id.to_string()).or_default())
    }

    async fn connection(
        &self,
        dialer: &dyn DeviceDialer,
        device_id: &str,
        fresh: bool,
    ) -> Result<Arc<dyn RouteConnection>, String> {
        let slot = self.slot(device_id);
        let mut guard = slot.lock().await;
        if fresh {
            guard.take();
        }
        if let Some(connection) = guard.as_ref() {
            return Ok(Arc::clone(connection));
        }
        let connection = dialer.connect(device_id).await?;
        *guard = Some(Arc::clone(&connection));
        Ok(connection)
    }
}

fn advertises(connection: &dyn RouteConnection, capability: &str) -> bool {
    connection
        .capabilities()
        .iter()
        .any(|advertised| advertised == capability)
}

#[async_trait]
impl AccountDeviceMeshRoute for CliMeshRoute {
    async fn call(
        &self,
        device_id: &str,
        required_capability: &str,
        command: &str,
        args: Value,
    ) -> Option<Result<Value, String>> {
        let Some(dialer) = self.dialer() else {
            return Some(Err(format!(
                "{DEVICE_NOT_ON_LINK}: this host is not on OpenBitFun Link right now (sign in, turn remote control on, or check that no other OpenBitFun host on this machine serves the device)"
            )));
        };
        if !dialer.on_link(device_id).await {
            return None;
        }
        let connection = match self.connection(dialer.as_ref(), device_id, false).await {
            Ok(connection) => connection,
            Err(error) => {
                tracing::warn!(
                    "Mesh route could not reach device: device={device_id}, command={command}, error={error}"
                );
                return Some(Err(error));
            }
        };
        if !advertises(connection.as_ref(), required_capability) {
            tracing::debug!(
                "Mesh device lacks {required_capability}: device={device_id}, command={command}"
            );
            return None;
        }
        Some(match connection.call(command, args.clone()).await {
            Err(error) if error.is_transport() => {
                tracing::info!(
                    "Mesh route reconnecting: device={device_id}, command={command}, error={error}"
                );
                match self.connection(dialer.as_ref(), device_id, true).await {
                    Ok(connection) if advertises(connection.as_ref(), required_capability) => {
                        connection
                            .call(command, args)
                            .await
                            .map_err(|error| error.message)
                    }
                    Ok(_) => return None,
                    Err(error) => Err(error),
                }
            }
            other => other.map_err(|error| error.message),
        })
    }
}

/// The process's route, installed on first use.
fn route() -> &'static Arc<CliMeshRoute> {
    static ROUTE: OnceLock<Arc<CliMeshRoute>> = OnceLock::new();
    ROUTE.get_or_init(|| {
        let route = Arc::new(CliMeshRoute::default());
        install_mesh_route(Arc::clone(&route) as Arc<dyn AccountDeviceMeshRoute>);
        route
    })
}

/// Binds the route to Link (the mesh listener starts serving an account).
pub(crate) fn attach(link: Arc<Link>, authority: Arc<dyn MeshAuthority>) {
    let connector = LinkPeerConnector::new(Arc::clone(&link), authority);
    route().set_dialer(Some(Arc::new(LinkDialer { link, connector })));
}

/// Unbinds the route (Link stopped serving: sign-out, remote control off,
/// another host serves the device, shutdown).
pub(crate) fn detach() {
    route().set_dialer(None);
}

#[cfg(test)]
mod tests {
    use super::*;
    use openbitfun_core::service::remote_connect::mesh_route::{
        call_mesh, CAPABILITY_DISPATCH_TARGET_V1, CAPABILITY_REMOTE_COMMAND_V1, OBP_REMOTE_COMMAND,
    };
    use serde_json::json;
    use std::sync::atomic::{AtomicUsize, Ordering};

    struct FakeConnection {
        capabilities: Vec<String>,
        /// Calls that fail as a closed transport before this one answers.
        transport_failures: AtomicUsize,
    }

    #[async_trait]
    impl RouteConnection for FakeConnection {
        fn capabilities(&self) -> Vec<String> {
            self.capabilities.clone()
        }

        async fn call(&self, command: &str, args: Value) -> Result<Value, MeshCallError> {
            if self
                .transport_failures
                .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |left| {
                    left.checked_sub(1)
                })
                .is_ok()
            {
                return Err(MeshCallError {
                    code: 0,
                    message: "the mesh connection is closed".into(),
                    data: None,
                });
            }
            Ok(json!({ "command": command, "args": args }))
        }
    }

    /// `remote-*` devices advertise `remote_command_v1`, `plain-*` devices
    /// advertise nothing, `stale-*` devices hand out a connection that has
    /// closed; everything else is not on Link.
    #[derive(Default)]
    struct FakeLink {
        connects: AtomicUsize,
    }

    #[async_trait]
    impl DeviceDialer for FakeLink {
        async fn on_link(&self, device_id: &str) -> bool {
            ["remote-", "plain-", "stale-"]
                .iter()
                .any(|prefix| device_id.starts_with(prefix))
        }

        async fn connect(&self, device_id: &str) -> Result<Arc<dyn RouteConnection>, String> {
            let first = self.connects.fetch_add(1, Ordering::SeqCst) == 0;
            let capabilities = if device_id.starts_with("plain-") {
                Vec::new()
            } else {
                vec![CAPABILITY_REMOTE_COMMAND_V1.to_string()]
            };
            let failures = usize::from(device_id.starts_with("stale-") && first);
            Ok(Arc::new(FakeConnection {
                capabilities,
                transport_failures: AtomicUsize::new(failures),
            }))
        }
    }

    fn route_with(dialer: Arc<FakeLink>) -> Arc<dyn AccountDeviceMeshRoute> {
        let route = CliMeshRoute::default();
        route.set_dialer(Some(dialer));
        Arc::new(route)
    }

    #[tokio::test]
    async fn a_device_with_the_capability_is_called_over_link_on_one_connection() {
        let link = Arc::new(FakeLink::default());
        let route = route_with(Arc::clone(&link));
        for _ in 0..2 {
            let value = call_mesh(
                Some(Arc::clone(&route)),
                "remote-mac",
                CAPABILITY_REMOTE_COMMAND_V1,
                OBP_REMOTE_COMMAND,
                json!({ "command": { "cmd": "get_workspace_info" } }),
            )
            .await
            .expect("called over Link");
            assert_eq!(value["command"], OBP_REMOTE_COMMAND);
        }
        assert_eq!(
            link.connects.load(Ordering::SeqCst),
            1,
            "one cached connection"
        );
    }

    #[tokio::test]
    async fn devices_without_the_capability_or_off_link_are_not_routes() {
        let route = route_with(Arc::new(FakeLink::default()));
        assert!(route
            .call(
                "plain-pc",
                CAPABILITY_REMOTE_COMMAND_V1,
                OBP_REMOTE_COMMAND,
                json!({})
            )
            .await
            .is_none());
        assert!(route
            .call(
                "remote-mac",
                CAPABILITY_DISPATCH_TARGET_V1,
                "dispatch_target_probe",
                json!({})
            )
            .await
            .is_none());
        assert!(route
            .call(
                "old-pc",
                CAPABILITY_REMOTE_COMMAND_V1,
                OBP_REMOTE_COMMAND,
                json!({})
            )
            .await
            .is_none());
        let refused = call_mesh(
            Some(route),
            "old-pc",
            CAPABILITY_REMOTE_COMMAND_V1,
            OBP_REMOTE_COMMAND,
            json!({}),
        )
        .await
        .unwrap_err();
        assert!(refused.starts_with(DEVICE_NOT_ON_LINK), "{refused}");
    }

    #[tokio::test]
    async fn a_closed_connection_reconnects_once() {
        let link = Arc::new(FakeLink::default());
        let route = route_with(Arc::clone(&link));
        let value = route
            .call(
                "stale-box",
                CAPABILITY_REMOTE_COMMAND_V1,
                OBP_REMOTE_COMMAND,
                json!({}),
            )
            .await
            .expect("a mesh route")
            .expect("answered after one reconnect");
        assert_eq!(value["command"], OBP_REMOTE_COMMAND);
        assert_eq!(link.connects.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn a_host_off_link_refuses_explicitly() {
        let route = CliMeshRoute::default();
        let refused = route
            .call(
                "remote-mac",
                CAPABILITY_REMOTE_COMMAND_V1,
                OBP_REMOTE_COMMAND,
                json!({}),
            )
            .await
            .expect("an explicit answer")
            .unwrap_err();
        assert!(refused.starts_with(DEVICE_NOT_ON_LINK), "{refused}");
    }
}

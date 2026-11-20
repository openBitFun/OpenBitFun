//! The desktop's [`AccountDeviceMeshRoute`]: Detached Dispatch and IM bots
//! reach new account devices over OBP on the device mesh.
//!
//! A device is routed here when it is in the account mesh and its OBP mesh
//! listener advertises the capability the caller needs (`dispatch_target_v1`,
//! `remote_command_v1`); anything else answers `None` and the caller keeps
//! the legacy relay RPC for that (older) device. One connection per device is
//! kept and reused. It never reads the device's event stream: the connection
//! asks for the smallest event window and never acknowledges, so the target
//! stops sending events after it (calls are not windowed).

use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use openbitfun_services_integrations::remote_connect::mesh_route::AccountDeviceMeshRoute;
use serde_json::Value;
use tokio::sync::Mutex;

use super::MeshRuntime;
use crate::backend_protocol::ws::mesh_client::{MeshConnectOptions, MeshObpConnection};

/// Smallest event window the server accepts; the route only makes calls.
const CALL_ONLY_CREDIT_BYTES: u64 = 64 * 1024;

type Slot = Arc<Mutex<Option<Arc<MeshObpConnection>>>>;

#[derive(Default)]
pub struct DesktopMeshRoute {
    connections: std::sync::Mutex<HashMap<String, Slot>>,
}

impl DesktopMeshRoute {
    fn slot(&self, device_id: &str) -> Slot {
        let mut connections = self
            .connections
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        Arc::clone(connections.entry(device_id.to_string()).or_default())
    }

    async fn connection(
        &self,
        runtime: &MeshRuntime,
        device_id: &str,
        fresh: bool,
    ) -> Result<Arc<MeshObpConnection>, String> {
        let slot = self.slot(device_id);
        let mut guard = slot.lock().await;
        if fresh {
            guard.take();
        }
        if let Some(connection) = guard.as_ref() {
            return Ok(Arc::clone(connection));
        }
        let connection = Arc::new(
            runtime
                .connect_device(
                    device_id,
                    MeshConnectOptions {
                        credit_bytes: Some(CALL_ONLY_CREDIT_BYTES),
                        ..MeshConnectOptions::default()
                    },
                )
                .await?,
        );
        *guard = Some(Arc::clone(&connection));
        Ok(connection)
    }

    async fn call_device(
        &self,
        runtime: &MeshRuntime,
        device_id: &str,
        command: &str,
        args: Value,
    ) -> Result<Value, String> {
        let connection = self.connection(runtime, device_id, false).await?;
        match connection.call(command, args.clone()).await {
            // Code 0 is a transport failure (a cached connection that closed):
            // reconnect once over the mesh, never over the relay.
            Err(error) if error.code == 0 => {
                log::info!(
                    "Mesh route reconnecting: device={}, command={}, error={}",
                    device_id,
                    command,
                    error
                );
                let connection = self.connection(runtime, device_id, true).await?;
                connection
                    .call(command, args)
                    .await
                    .map_err(|error| error.message)
            }
            other => other.map_err(|error| error.message),
        }
    }
}

#[async_trait]
impl AccountDeviceMeshRoute for DesktopMeshRoute {
    async fn call(
        &self,
        device_id: &str,
        required_capability: &str,
        command: &str,
        args: Value,
    ) -> Option<Result<Value, String>> {
        let runtime = super::global()?;
        let capabilities = match runtime.device_capabilities(device_id).await? {
            Ok(capabilities) => capabilities,
            Err(error) => {
                log::warn!(
                    "Mesh device did not answer; not using the relay for it: device={}, command={}, error={}",
                    device_id,
                    command,
                    error
                );
                return Some(Err(error));
            }
        };
        if !capabilities
            .iter()
            .any(|capability| capability == required_capability)
        {
            log::debug!(
                "Mesh device lacks {}; using the legacy relay path: device={}",
                required_capability,
                device_id
            );
            return None;
        }
        Some(self.call_device(&runtime, device_id, command, args).await)
    }
}

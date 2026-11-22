//! Fleet routing: the verbs a runtime host answers for any client.
//!
//! - `fleet_call {target, command, args}`: decided by the phase-0 verdict
//!   (`fleet_call_verdict`). The host runs the command itself when it is the
//!   target, and otherwise makes a plain `call` with the unchanged args on
//!   its link to the target, which applies its own allowlist. The owner's
//!   result and errors come back unchanged; a refusal of the fleet layer is
//!   `"<fleet prefix>: <detail>"`.
//! - `fleet_navigator` / `fleet_prompts`: served from the index.
//! - `fleet_digest` (owner verb, `fleet_v1`): this host's own partition.

use std::sync::Arc;

use serde::de::DeserializeOwned;
use serde_json::Value;

use openbitfun_product_domains::fleet::*;

use super::index::FleetIndex;
use super::sync::FleetPeerTransport;
use super::{FleetCallError, FleetFuture};

/// What the fleet layer needs from its host.
pub trait FleetBackend: Send + Sync + 'static {
    /// This host's device id; `None` while signed out (no fleet).
    fn local_device_id(&self) -> Option<String>;
    /// This host's own facts: name, host kind, version, fleet protocol,
    /// host capabilities, and whether it is the calling client's machine.
    fn local_facts(&self) -> FleetDeviceFacts;
    /// This host's digest (the owner verb `fleet_digest`).
    fn local_digest(
        &self,
        request: FleetDigestRequest,
    ) -> FleetFuture<'_, Result<FleetDigest, String>>;
    /// Run a registry command on this host, exactly as a plain `call`.
    fn dispatch_local(
        &self,
        command: String,
        args: Value,
    ) -> FleetFuture<'_, Result<Value, FleetCallError>>;
}

/// The fleet verbs this router answers.
pub const FLEET_ROUTER_COMMANDS: &[&str] = &[
    "fleet_call",
    "fleet_digest",
    "fleet_navigator",
    "fleet_prompts",
];

/// Serves the fleet verbs of one host.
pub struct FleetRouter {
    backend: Arc<dyn FleetBackend>,
    index: Arc<FleetIndex>,
    peers: Arc<dyn FleetPeerTransport>,
}

fn request_of<T: DeserializeOwned + Default>(args: &Value) -> Result<T, FleetCallError> {
    match args.get("request") {
        None | Some(Value::Null) => Ok(T::default()),
        Some(request) => serde_json::from_value(request.clone())
            .map_err(|error| FleetCallError::command(format!("invalid fleet request: {error}"))),
    }
}

fn to_value<T: serde::Serialize>(value: T) -> Result<Value, FleetCallError> {
    serde_json::to_value(value).map_err(|error| FleetCallError::command(error.to_string()))
}

impl FleetRouter {
    pub fn new(
        backend: Arc<dyn FleetBackend>,
        index: Arc<FleetIndex>,
        peers: Arc<dyn FleetPeerTransport>,
    ) -> Arc<Self> {
        Arc::new(Self {
            backend,
            index,
            peers,
        })
    }

    /// The index behind this router.
    pub fn index(&self) -> &Arc<FleetIndex> {
        &self.index
    }

    /// Answer a fleet verb; `None` when `command` is not one this router
    /// serves (the host answers `fleet_events`, `fleet_subscribe`,
    /// `fleet_replay` and `fleet_ui_bundle` elsewhere).
    pub async fn handle(
        &self,
        command: &str,
        args: Value,
    ) -> Option<Result<Value, FleetCallError>> {
        let result = match command {
            "fleet_call" => match request_of::<FleetCallRequest>(&args) {
                Ok(request) => self.fleet_call(request).await,
                Err(error) => Err(error),
            },
            "fleet_navigator" => request_of::<FleetNavigatorRequest>(&args)
                .and_then(|request| to_value(self.navigator(request))),
            "fleet_prompts" => to_value(self.prompts()),
            "fleet_digest" => match request_of::<FleetDigestRequest>(&args) {
                Ok(request) => match self.digest(request).await {
                    Ok(digest) => to_value(digest),
                    Err(error) => Err(error),
                },
                Err(error) => Err(error),
            },
            _ => return None,
        };
        Some(result)
    }

    /// `fleet_navigator`.
    pub fn navigator(&self, request: FleetNavigatorRequest) -> FleetNavigator {
        self.index.navigator(request.since_revision)
    }

    /// `fleet_prompts`.
    pub fn prompts(&self) -> FleetPromptsResponse {
        self.index.prompts()
    }

    /// `fleet_digest`: this host's own partition.
    pub async fn digest(&self, request: FleetDigestRequest) -> Result<FleetDigest, FleetCallError> {
        self.backend
            .local_digest(request)
            .await
            .map_err(FleetCallError::command)
    }

    /// `fleet_call` gated by the caller's OBP [`crate::server::Scope`].
    /// Only `Owner` and `AccountDevice` may route through `fleet_call`;
    /// `CloudAgent` and `PairedClient` are always refused so the cloud agent
    /// can never execute locally under `Scope::AccountDevice` or pivot to
    /// another device over `PeerLinks`.
    pub async fn fleet_call_for_scope(
        &self,
        scope: &crate::server::Scope,
        request: FleetCallRequest,
    ) -> Result<Value, FleetCallError> {
        if !matches!(
            scope,
            crate::server::Scope::Owner | crate::server::Scope::AccountDevice { .. }
        ) {
            return Err(FleetCallError {
                code: -32003,
                message: format!(
                    "forbidden_for_scope: command 'fleet_call' is not served for scope '{}'",
                    scope.wire_name()
                ),
                data: Some(serde_json::json!({
                    "kind": "forbidden",
                    "command": "fleet_call",
                    "scope": scope.wire_name(),
                })),
            });
        }
        self.fleet_call(request).await
    }

    /// `fleet_call`.
    ///
    /// Callers must enforce OBP scope admission (`Owner` or `AccountDevice`
    /// only, never `CloudAgent`) via [`crate::server::check_command`] or
    /// [`Self::fleet_call_for_scope`] before calling this method.
    pub async fn fleet_call(&self, request: FleetCallRequest) -> Result<Value, FleetCallError> {
        let self_id = self
            .backend
            .local_device_id()
            .unwrap_or_else(|| self.index.self_device_id().to_string());
        match fleet_call_verdict(&self_id, &request, self.index.as_ref()) {
            FleetCallVerdict::Local => {
                self.backend
                    .dispatch_local(request.command, request.args)
                    .await
            }
            FleetCallVerdict::Forward { target } => {
                match self
                    .peers
                    .call(&target, &request.command, request.args)
                    .await
                {
                    Ok(value) => Ok(value),
                    // The owner's own errors pass through unchanged.
                    Err(error) if !error.is_transport() => Err(error),
                    Err(error) => {
                        log::info!(
                            "Fleet forward failed on the link: target={}, command={}",
                            target,
                            request.command
                        );
                        self.index.mark_link_failed(&target, &error.message);
                        let refusal = FleetCallRefusal::DeviceOffline {
                            device_id: target,
                            reason: "link_failed",
                        };
                        Err(FleetCallError::refusal(refusal.prefix(), refusal.message()))
                    }
                }
            }
            FleetCallVerdict::Refuse(refusal) => {
                log::debug!(
                    "Fleet call refused: command={}, prefix={}",
                    request.command,
                    refusal.prefix()
                );
                Err(FleetCallError::refusal(refusal.prefix(), refusal.message()))
            }
        }
    }
}

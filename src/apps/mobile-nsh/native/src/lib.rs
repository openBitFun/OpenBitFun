//! `openbitfun/mobile`: the native module of the NSH phone app.
//!
//! The phone app is the same NSH UI (`src/nsh-ui`) as the desktop, connected
//! to a device's backend instead of a backend of its own. This module is the
//! phone's transport and identity adapter: email-code sign-in through the
//! account APIs every OpenBitFun device uses, a device key in the platform
//! keystore, OpenBitFun Link joined as a controller node (P2P first, relayed
//! when needed), the account's device list with route status, and OBP
//! connections to devices with the account-device handshake. It serves
//! nothing and holds no product rules.
//!
//! Every function runs its work on the module's own Tokio runtime (Link
//! needs one) and resolves on the engine thread.

mod account;
mod controller;
mod crypto;
mod device;
mod keystore;
#[cfg(target_os = "android")]
mod keystore_android;
mod logging;
mod obp;

use std::future::Future;
use std::sync::{Arc, OnceLock};

use nsh_core::prelude::*;

use controller::{Config, Controller as Inner};

fn runtime() -> &'static tokio::runtime::Runtime {
    static RUNTIME: OnceLock<tokio::runtime::Runtime> = OnceLock::new();
    RUNTIME.get_or_init(|| {
        tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .thread_name("openbitfun-controller")
            .enable_all()
            .build()
            .expect("the controller runtime starts")
    })
}

/// Runs `work` on the controller runtime and waits for it without blocking
/// the engine thread.
async fn run<T, F>(work: F) -> Result<T, String>
where
    T: Send + 'static,
    F: Future<Output = Result<T, String>> + Send + 'static,
{
    let (sender, receiver) = tokio::sync::oneshot::channel();
    runtime().spawn(async move {
        let _ = sender.send(work.await);
    });
    receiver
        .await
        .map_err(|_| "the controller stopped during the call".to_string())?
}

static CONTROLLER: OnceLock<Result<Arc<Inner>, String>> = OnceLock::new();

/// The controller, started on first use with the app's data directory.
fn controller() -> Result<Arc<Inner>, String> {
    CONTROLLER
        .get_or_init(|| {
            logging::init();
            let data_dir = data_dir().ok_or_else(|| {
                "unsupported: this host keeps no app data (the browser connects through the gateway)"
                    .to_string()
            })?;
            let store = keystore::platform_store(&data_dir);
            let _entered = runtime().enter();
            Inner::start(Config::from_environment(data_dir), store)
        })
        .clone()
}

/// The codes the UI's controller port rejects with.
const PORT_CODES: [&str; 8] = [
    "invalid_email",
    "invalid_code",
    "rate_limited",
    "signed_out",
    "unreachable",
    "unsupported",
    "unavailable",
    "network",
];

/// A port-level failure as `<code>: <sentence>` with one of [`PORT_CODES`]:
/// Link's `mesh_*` reasons become `signed_out` / `unreachable` /
/// `unsupported`, anything else `unavailable`.
fn port_error(error: String) -> String {
    let (prefix, rest) = error.split_once(": ").unwrap_or(("", error.as_str()));
    if PORT_CODES.contains(&prefix) {
        return error;
    }
    let code = match prefix {
        "mesh_signed_out" => "signed_out",
        "mesh_unreachable" | "mesh_unavailable" | "mesh_refused" | "mesh_impostor"
        | "mesh_reconnecting" => "unreachable",
        "mesh_controller" | "mesh_unsupported" => "unsupported",
        _ => return format!("unavailable: {error}"),
    };
    format!("{code}: {rest}")
}

/// The phone's controller: sign-in, the account's devices, connections.
/// Port-level calls reject with `<code>: <sentence>` (`invalid_email`,
/// `invalid_code`, `rate_limited`, `signed_out`, `unreachable`,
/// `unsupported`, `unavailable`, `network`).
#[module]
pub struct Controller;

#[module]
impl Controller {
    /// The account this phone is signed in to (JSON `{ accountId, email, login, deviceId }`), or `null`.
    pub async fn restore() -> Result<String, String> {
        let inner = controller().map_err(port_error)?;
        run(async move { Ok(inner.restore().await.to_string()) }).await
    }

    /// Emails a sign-in code to `email` in `locale`'s language. Resolves with the challenge (JSON `{ challengeId, email, codeLength, retryAfterSeconds, expiresAt }`).
    pub async fn request_code(email: String, locale: Option<String>) -> Result<String, String> {
        let inner = controller().map_err(port_error)?;
        run(async move {
            inner
                .request_code(email, locale.unwrap_or_default())
                .await
                .map(|value| value.to_string())
        })
        .await
        .map_err(port_error)
    }

    /// Checks the emailed code of `challengeId`, registers this phone with the account and joins the account's device network. Resolves with the account (JSON, as `restore()`).
    pub async fn verify_code(challenge_id: String, code: String) -> Result<String, String> {
        let inner = controller().map_err(port_error)?;
        run(async move {
            inner
                .verify_code(challenge_id, code)
                .await
                .map(|value| value.to_string())
        })
        .await
        .map_err(port_error)
    }

    /// Signs out: closes every device connection, leaves the device network and forgets the account on this phone.
    pub async fn sign_out() -> Result<(), String> {
        let inner = controller().map_err(port_error)?;
        run(async move { inner.sign_out().await })
            .await
            .map_err(port_error)
    }

    /// The account's devices this phone may drive (JSON array of `{ deviceId, name, kind, os, model, clientVersion, online, lastSeenAt, connectable, unavailable, route, relayVia, relayViaName, latencyMs }`).
    pub async fn list_devices() -> Result<String, String> {
        let inner = controller().map_err(port_error)?;
        run(async move { inner.list_devices().await.map(|value| value.to_string()) })
            .await
            .map_err(port_error)
    }

    /// This phone's device network (JSON `{ state, reason, role, virtualIp, natType, relayNodes, updatedAtMs, keyStore }`).
    pub async fn network() -> Result<String, String> {
        let inner = controller().map_err(port_error)?;
        run(async move {
            let mut network = inner.network();
            network["keyStore"] = inner.key_store().into();
            Ok(network.to_string())
        })
        .await
    }

    /// Opens an authenticated OBP connection to the device `deviceId` over the device network; resolves with the connection's handle once the device answered `hello`.
    pub async fn connect(device_id: String) -> Result<u32, String> {
        let inner = controller().map_err(port_error)?;
        run(async move { inner.connect(device_id).await })
            .await
            .map_err(port_error)
    }

    /// The device backend of a connection: JSON `{ version, platform, dataDir, scope, capabilities, deviceId }`.
    pub async fn hello(connection: u32) -> Result<String, String> {
        let link = controller()?.device_link(connection)?;
        run(async move { link.hello().await.map(|value| value.to_string()) }).await
    }

    /// Runs one command on the device backend. `argsJson` is the args object the UI's `invoke(command, args)` received; resolves with the JSON of the result, rejects with the backend's own error text.
    pub async fn invoke(
        connection: u32,
        command: String,
        args_json: String,
    ) -> Result<String, String> {
        let link = controller()?.device_link(connection)?;
        run(async move { link.invoke(command, args_json).await }).await
    }

    /// Long poll for the device backend's events: a JSON array of `{ seq, event, payload }` after `afterSeq` (or after the last batch). Rejects when the connection dropped; the next call redials and resumes.
    pub async fn next_events(connection: u32, after_seq: Option<u64>) -> Result<String, String> {
        let link = controller()?.device_link(connection)?;
        run(async move { link.next_events(after_seq).await }).await
    }

    /// Closes a device connection for good.
    pub async fn disconnect(connection: u32) -> Result<(), String> {
        controller()?.disconnect(connection);
        Ok(())
    }
}

/// The crate's UI set: the `Controller` module.
#[native_module("openbitfun/mobile")]
fn native(registry: &mut Registry) {
    registry.module::<Controller>();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn port_errors_carry_a_port_code() {
        assert_eq!(
            port_error("invalid_code: wrong".into()),
            "invalid_code: wrong"
        );
        assert_eq!(
            port_error("mesh_signed_out: sign in".into()),
            "signed_out: sign in"
        );
        assert_eq!(
            port_error("mesh_unreachable: device x is not on the device network now".into()),
            "unreachable: device x is not on the device network now"
        );
        assert_eq!(
            port_error("mesh_controller: x is a phone".into()),
            "unsupported: x is a phone"
        );
        assert_eq!(port_error("boom".into()), "unavailable: boom");
        assert_eq!(port_error("odd: thing".into()), "unavailable: odd: thing");
    }

    #[test]
    fn module_is_registered() {
        let set = registry();
        assert!(
            set.module_specs()
                .iter()
                .any(|spec| spec.name == "Controller"),
            "Controller module missing"
        );
    }
}

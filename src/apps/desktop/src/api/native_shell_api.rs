//! The native UI shell's side of the shell-request channel
//! (`crate::host::shell`): it attaches with the operations it offers and
//! answers `host://shell-request` events. Only the in-process native host has
//! such a shell; the Tauri host owns its window itself and refuses both.

use serde::{Deserialize, Serialize};

use crate::host::shell::ShellResponse;
use crate::host::HostHandle;

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct HostShellAttachRequest {
    /// Operation names the shell runs (`window.show`, `notification.show`, ...).
    #[serde(default)]
    pub ops: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostShellAttachResponse {
    /// The operations the backend recorded, sorted.
    pub ops: Vec<String>,
}

// @backend-command
pub async fn host_shell_attach(
    app: HostHandle,
    request: HostShellAttachRequest,
) -> Result<HostShellAttachResponse, String> {
    let ops = app.native().shell().attach(request.ops);
    log::info!("Native desktop shell attached: ops={}", ops.join(","));
    Ok(HostShellAttachResponse { ops })
}

// @backend-command
pub async fn host_shell_respond(app: HostHandle, request: ShellResponse) -> Result<(), String> {
    app.native().shell().respond(request)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn attach_requests_tolerate_missing_and_future_fields() {
        let legacy: HostShellAttachRequest = serde_json::from_str("{}").unwrap();
        assert!(legacy.ops.is_empty());
        let request: HostShellAttachRequest =
            serde_json::from_str(r#"{"ops":["window.show"],"version":2}"#).unwrap();
        assert_eq!(request.ops, ["window.show"]);
    }
}

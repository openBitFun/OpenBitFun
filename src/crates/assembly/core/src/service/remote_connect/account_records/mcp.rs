//! MCP server shapes (`mcp.servers`): every user-level MCP server of
//! `app.json` `mcp_servers` (the 1.x config, read in place) as a record per
//! server id. Environment values, header values and credential-shaped
//! arguments are per-device placeholders: each device keeps its own values,
//! and a device that has the shape but not a value shows the server as
//! needing a secret here. OAuth credentials stay in the device vault.

use std::collections::HashMap;
use std::sync::Arc;

use anyhow::{anyhow, Result};
use async_trait::async_trait;
use serde_json::{json, Map, Value};

use super::{
    is_secret_field_name, looks_like_secret, secret_ref, secret_ref_id, valid_record_id,
    AccountRecordPort, ApplyContext, DeviceContext, LocalCollection, LocalItem, RemoteItem,
    MCP_SERVERS_COLLECTION,
};
use crate::service::config::ConfigService;
use crate::service::mcp::config::{ConfigLocation, MCPConfigService};
use crate::service::mcp::server::MCPServerConfig;

/// Fields that never travel: where the config lives, runtime facts and
/// free-form settings.
const LOCAL_FIELDS: &[&str] = &["location", "capabilities", "settings"];

pub struct McpRecords {
    config: Arc<ConfigService>,
}

impl McpRecords {
    pub fn new(config: Arc<ConfigService>) -> Self {
        Self { config }
    }

    fn service(&self) -> Result<MCPConfigService> {
        MCPConfigService::new(Arc::clone(&self.config)).map_err(|error| anyhow!("{error}"))
    }

    async fn user_servers(&self) -> Result<Vec<MCPServerConfig>> {
        Ok(self
            .service()?
            .load_all_configs()
            .await
            .map_err(|error| anyhow!("{error}"))?
            .into_iter()
            .filter(|server| server.location == ConfigLocation::User)
            .collect())
    }
}

fn placeholder(server: &str, kind: &str, name: &str) -> Value {
    secret_ref(format!("mcp:{server}:{kind}:{name}"))
}

/// Whether an argument carries a credential (`--api-key=…`, a token-shaped
/// value).
fn secret_argument(argument: &str) -> bool {
    if looks_like_secret(argument) {
        return true;
    }
    argument
        .trim_start_matches('-')
        .split_once('=')
        .is_some_and(|(name, value)| !value.is_empty() && is_secret_field_name(name))
}

/// The record of a server: its shape with every secret as a placeholder.
pub fn projection(server: &MCPServerConfig) -> Result<Value> {
    let mut value = serde_json::to_value(server)?;
    let fields = value
        .as_object_mut()
        .ok_or_else(|| anyhow!("server config is not an object"))?;
    for field in LOCAL_FIELDS {
        fields.remove(*field);
    }
    let map_of = |kind: &str, entries: &HashMap<String, String>| -> Value {
        let mut names: Vec<_> = entries.keys().collect();
        names.sort();
        Value::Object(
            names
                .into_iter()
                .map(|name| (name.clone(), placeholder(&server.id, kind, name)))
                .collect::<Map<_, _>>(),
        )
    };
    fields.insert("env".into(), map_of("env", &server.env));
    fields.insert("headers".into(), map_of("headers", &server.headers));
    let args: Vec<Value> = server
        .args
        .iter()
        .enumerate()
        .map(|(index, argument)| {
            // An empty argument is a placeholder this device has no value
            // for yet: it stays one.
            if argument.is_empty() || secret_argument(argument) {
                placeholder(&server.id, "arg", &index.to_string())
            } else {
                Value::String(argument.clone())
            }
        })
        .collect();
    fields.insert("args".into(), Value::Array(args));
    Ok(value)
}

/// The server config for this device: the account's shape with this
/// device's own secret values (empty where this device has none yet).
pub fn local_config(shape: &Value, local: Option<&MCPServerConfig>) -> Result<MCPServerConfig> {
    let mut value = shape.clone();
    let fields = value
        .as_object_mut()
        .ok_or_else(|| anyhow!("server record is not an object"))?;
    let fill = |kind: &str, local: Option<&HashMap<String, String>>| -> Value {
        Value::Object(
            shape[kind]
                .as_object()
                .into_iter()
                .flatten()
                .map(|(name, _)| {
                    let own = local
                        .and_then(|map| map.get(name))
                        .cloned()
                        .unwrap_or_default();
                    (name.clone(), Value::String(own))
                })
                .collect(),
        )
    };
    fields.insert("env".into(), fill("env", local.map(|server| &server.env)));
    fields.insert(
        "headers".into(),
        fill("headers", local.map(|server| &server.headers)),
    );
    let args: Vec<Value> = shape["args"]
        .as_array()
        .into_iter()
        .flatten()
        .enumerate()
        .map(|(index, argument)| match argument {
            Value::String(text) => Value::String(text.clone()),
            _ => Value::String(
                local
                    .and_then(|server| server.args.get(index))
                    .filter(|own| own.is_empty() || secret_argument(own))
                    .cloned()
                    .unwrap_or_default(),
            ),
        })
        .collect();
    fields.insert("args".into(), Value::Array(args));
    fields.insert("location".into(), json!(ConfigLocation::User));
    if let Some(local) = local {
        fields.insert("capabilities".into(), json!(local.capabilities));
        fields.insert("settings".into(), json!(local.settings));
    }
    Ok(serde_json::from_value(value)?)
}

/// The secret names a device still has to enter for a server (env and
/// header names, `arg <n>`).
pub fn missing_secrets(shape: &Value, local: &MCPServerConfig) -> Vec<String> {
    let mut missing = Vec::new();
    for (kind, map) in [("env", &local.env), ("headers", &local.headers)] {
        for (name, entry) in shape[kind].as_object().into_iter().flatten() {
            if secret_ref_id(entry).is_some() && map.get(name).is_none_or(String::is_empty) {
                missing.push(name.clone());
            }
        }
    }
    for (index, argument) in shape["args"].as_array().into_iter().flatten().enumerate() {
        if secret_ref_id(argument).is_some()
            && local.args.get(index).is_none_or(|own| own.is_empty())
        {
            missing.push(format!("arg {index}"));
        }
    }
    missing
}

#[async_trait]
impl LocalCollection for McpRecords {
    fn collection(&self) -> &'static str {
        MCP_SERVERS_COLLECTION
    }

    async fn list(&self, _device: &DeviceContext) -> Result<Vec<LocalItem>> {
        let mut items = Vec::new();
        for server in self.user_servers().await? {
            if valid_record_id(&server.id) {
                items.push(LocalItem::new(server.id.clone(), projection(&server)?));
            }
        }
        Ok(items)
    }

    async fn apply(&self, item: &RemoteItem, _context: &ApplyContext) -> Result<()> {
        let service = self.service()?;
        let local = service
            .get_server_config(&item.id)
            .await
            .map_err(|error| anyhow!("{error}"))?
            .filter(|server| server.location == ConfigLocation::User);
        let config = local_config(&item.value, local.as_ref())?;
        if config.id != item.id {
            return Err(anyhow!("server record names another id"));
        }
        service
            .save_server_config(&config)
            .await
            .map_err(|error| anyhow!("{error}"))
    }

    async fn remove(&self, id: &str) -> Result<()> {
        let service = self.service()?;
        let local = service
            .get_server_config(id)
            .await
            .map_err(|error| anyhow!("{error}"))?;
        if local.is_some_and(|server| server.location == ConfigLocation::User) {
            service
                .delete_server_config(id)
                .await
                .map_err(|error| anyhow!("{error}"))?;
        }
        Ok(())
    }
}

/// Servers that are on the account but still need a secret on this device:
/// `server id -> missing names`.
pub async fn servers_needing_secrets(
    port: &dyn AccountRecordPort,
    config: Arc<ConfigService>,
) -> Result<Vec<(String, Vec<String>)>> {
    let records = McpRecords::new(config);
    let local: HashMap<String, MCPServerConfig> = records
        .user_servers()
        .await?
        .into_iter()
        .map(|server| (server.id.clone(), server))
        .collect();
    let mut needing = Vec::new();
    for record in port.records(MCP_SERVERS_COLLECTION) {
        let Some(shape) = record.value.as_ref().and_then(|value| value.get("v")) else {
            continue;
        };
        if let Some(server) = local.get(&record.id) {
            let missing = missing_secrets(shape, server);
            if !missing.is_empty() {
                needing.push((record.id.clone(), missing));
            }
        }
    }
    Ok(needing)
}

#[cfg(test)]
mod tests {
    use super::super::test_support::*;
    use super::*;

    struct Side {
        _dir: tempfile::TempDir,
        config: Arc<ConfigService>,
        device: TestDevice,
    }

    async fn side(id: &str) -> Side {
        let dir = tempfile::tempdir().unwrap();
        let config = super::super::quick_actions::tests_support_config(dir.path()).await;
        Side {
            device: test_device(id, Arc::new(McpRecords::new(Arc::clone(&config)))),
            _dir: dir,
            config,
        }
    }

    async fn servers(side: &Side) -> HashMap<String, MCPServerConfig> {
        McpRecords::new(Arc::clone(&side.config))
            .user_servers()
            .await
            .unwrap()
            .into_iter()
            .map(|server| (server.id.clone(), server))
            .collect()
    }

    /// The 1.x Cursor-format document, with plaintext secrets.
    fn legacy_document() -> Value {
        json!({ "mcpServers": {
            "github": {
                "command": "npx",
                "args": ["-y", "@modelcontextprotocol/server-github", "--api-key=gh-plain-secret"],
                "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_abcdefghijklmnopqrstuvwxyz0123456789", "LOG": "debug" }
            },
            "remote": {
                "type": "streamable-http",
                "url": "https://mcp.example.com/mcp",
                "headers": { "Authorization": "Bearer remote-header-secret-0123456789" }
            }
        }})
    }

    #[tokio::test]
    async fn legacy_servers_reach_another_device_as_shapes_that_ask_for_secrets() {
        let a = side("a").await;
        let b = side("b").await;
        link(&a.device, &b.device);
        a.config
            .set_config("mcp_servers", legacy_document())
            .await
            .unwrap();
        settle(&[&a.device, &b.device]).await;
        let text = replica_text(&a.device);
        for secret in [
            "gh-plain-secret",
            "ghp_abcdef",
            "remote-header-secret",
            "\"debug\"",
        ] {
            assert!(!text.contains(secret), "{secret} leaked");
        }
        let on_b = servers(&b).await;
        assert_eq!(on_b["github"].command.as_deref(), Some("npx"));
        assert_eq!(
            on_b["github"].args[1],
            "@modelcontextprotocol/server-github"
        );
        assert_eq!(on_b["github"].env["GITHUB_PERSONAL_ACCESS_TOKEN"], "");
        assert_eq!(
            on_b["remote"].url.as_deref(),
            Some("https://mcp.example.com/mcp")
        );
        assert_eq!(on_b["remote"].headers["Authorization"], "");
        // b asks for them; a has them all.
        let mut needing = servers_needing_secrets(b.device.port.as_ref(), Arc::clone(&b.config))
            .await
            .unwrap();
        needing.sort();
        assert_eq!(needing[0].0, "github");
        assert!(needing[0]
            .1
            .contains(&"GITHUB_PERSONAL_ACCESS_TOKEN".to_string()));
        assert!(needing[0].1.contains(&"arg 2".to_string()));
        assert_eq!(
            needing[1],
            ("remote".to_string(), vec!["Authorization".to_string()])
        );
        assert!(
            servers_needing_secrets(a.device.port.as_ref(), Arc::clone(&a.config))
                .await
                .unwrap()
                .is_empty()
        );
        // a keeps its own values (the old document still reads).
        let on_a = servers(&a).await;
        assert_eq!(
            on_a["github"].env["GITHUB_PERSONAL_ACCESS_TOKEN"],
            "ghp_abcdefghijklmnopqrstuvwxyz0123456789"
        );
        assert_eq!(on_a["github"].args[2], "--api-key=gh-plain-secret");
        // b enters its own secret: nothing travels, nothing echoes.
        let mut github = on_b["github"].clone();
        github.env.insert(
            "GITHUB_PERSONAL_ACCESS_TOKEN".into(),
            "b-own-token-value".into(),
        );
        MCPConfigService::new(Arc::clone(&b.config))
            .unwrap()
            .save_server_config(&github)
            .await
            .unwrap();
        settle(&[&a.device, &b.device]).await;
        assert!(!replica_text(&b.device).contains("b-own-token-value"));
        assert_eq!(
            servers(&a).await["github"].env["GITHUB_PERSONAL_ACCESS_TOKEN"],
            "ghp_abcdefghijklmnopqrstuvwxyz0123456789"
        );
    }

    #[tokio::test]
    async fn concurrent_shape_edits_converge_and_deletions_travel() {
        let a = side("a").await;
        let b = side("b").await;
        link(&a.device, &b.device);
        a.config
            .set_config("mcp_servers", legacy_document())
            .await
            .unwrap();
        settle(&[&a.device, &b.device]).await;
        let service_a = MCPConfigService::new(Arc::clone(&a.config)).unwrap();
        let service_b = MCPConfigService::new(Arc::clone(&b.config)).unwrap();
        a.device.port.set_online(false);
        let mut remote = servers(&a).await["remote"].clone();
        remote.enabled = false;
        service_a.save_server_config(&remote).await.unwrap();
        a.device.sync.round().await;
        std::thread::sleep(std::time::Duration::from_millis(3));
        let mut remote = servers(&b).await["remote"].clone();
        remote.url = Some("https://mcp.example.com/v2".into());
        service_b.save_server_config(&remote).await.unwrap();
        b.device.sync.round().await;
        a.device.port.set_online(true);
        settle(&[&a.device, &b.device]).await;
        for side in [&a, &b] {
            let remote = &servers(side).await["remote"];
            assert_eq!(remote.url.as_deref(), Some("https://mcp.example.com/v2"));
        }
        // a's header value survives the account's new shape.
        assert!(servers(&a).await["remote"].headers["Authorization"].starts_with("Bearer "));
        service_b.delete_server_config("github").await.unwrap();
        settle(&[&a.device, &b.device]).await;
        assert!(!servers(&a).await.contains_key("github"));
    }

    #[tokio::test]
    async fn mcp_servers_keep_their_budget() {
        let a = side("a").await;
        let budget = budget_of(MCP_SERVERS_COLLECTION);
        let mut document = Map::new();
        for index in 0..=budget.max_records {
            document.insert(
                format!("s{index}"),
                json!({ "command": format!("tool-{index}"), "args": [format!("--port={index}")] }),
            );
        }
        a.config
            .set_config("mcp_servers", json!({ "mcpServers": document }))
            .await
            .unwrap();
        settle(&[&a.device]).await;
        assert_eq!(
            live(&a.device, MCP_SERVERS_COLLECTION).len(),
            budget.max_records
        );
        assert_eq!(
            a.device
                .sync
                .status()
                .refused
                .iter()
                .filter(|r| r.reason == "budget")
                .count(),
            1
        );
        assert_eq!(servers(&a).await.len(), budget.max_records + 1);
    }
}

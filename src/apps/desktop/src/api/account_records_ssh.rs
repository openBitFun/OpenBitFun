//! SSH connection profiles on the account replica (`ssh.profiles`,
//! wave24-replica).
//!
//! A record per profile id carries the profile's shape: host, port, user,
//! the kind of authentication, jump hosts, proxy command, container and WSL
//! target, default workspace and options. It never carries a password (the
//! device's password vault keeps it), a key path or certificate path (each
//! device points at its own key), or when this device last connected. The
//! 1.x `ssh_connections*.json` files are read in place. A device that has a
//! profile but not its password or key lists it as needing a secret here,
//! and the connect flow asks for it on this device.

use std::sync::Arc;

use anyhow::{anyhow, Result};
use async_trait::async_trait;
use openbitfun_core::service::remote_connect::account_records::{
    valid_record_id, AccountRecordPort, ApplyContext, DeviceContext, LocalCollection, LocalItem,
    RemoteItem, SSH_PROFILES_COLLECTION,
};
use openbitfun_core::service::remote_ssh::{SSHConnectionManager, SavedConnection};
use serde_json::{json, Value};

use super::account_records_api::NeedsSecret;
use crate::api::app_state::AppState;
use crate::host::HostHandle;

/// Where this device keeps its SSH profiles.
#[async_trait]
pub(crate) trait SshProfiles: Send + Sync {
    async fn saved(&self) -> Result<Vec<SavedConnection>>;
    async fn save(&self, profile: SavedConnection) -> Result<()>;
    async fn delete(&self, id: &str) -> Result<()>;
}

#[async_trait]
impl SshProfiles for SSHConnectionManager {
    async fn saved(&self) -> Result<Vec<SavedConnection>> {
        Ok(self.get_saved_connections().await)
    }

    async fn save(&self, profile: SavedConnection) -> Result<()> {
        self.save_profile_without_secret(profile).await
    }

    async fn delete(&self, id: &str) -> Result<()> {
        self.delete_saved_connection(id).await
    }
}

/// The desktop's SSH manager (created once the backend's SSH service is up).
pub(crate) struct AppSshProfiles(pub HostHandle);

impl AppSshProfiles {
    async fn manager(&self) -> Result<SSHConnectionManager> {
        self.0
            .state::<AppState>()
            .get_ssh_manager_async()
            .await
            .map_err(|error| anyhow!("{error}"))
    }
}

#[async_trait]
impl SshProfiles for AppSshProfiles {
    async fn saved(&self) -> Result<Vec<SavedConnection>> {
        self.manager().await?.saved().await
    }

    async fn save(&self, profile: SavedConnection) -> Result<()> {
        SshProfiles::save(&self.manager().await?, profile).await
    }

    async fn delete(&self, id: &str) -> Result<()> {
        SshProfiles::delete(&self.manager().await?, id).await
    }
}

/// Fields of a saved profile that belong to this device.
const DEVICE_AUTH_FIELDS: &[&str] = &["keyPath", "certificatePath", "fallbackKeyPath"];

/// The record of a profile.
pub(crate) fn projection(profile: &SavedConnection) -> Result<Value> {
    let mut value = serde_json::to_value(profile)?;
    let fields = value
        .as_object_mut()
        .ok_or_else(|| anyhow!("profile is not an object"))?;
    fields.remove("lastConnected");
    if let Some(auth) = fields.get_mut("authType").and_then(Value::as_object_mut) {
        for field in DEVICE_AUTH_FIELDS {
            auth.remove(*field);
        }
    }
    Ok(value)
}

/// The profile for this device: the account's shape with this device's own
/// key paths and last connection time.
fn local_profile(shape: &Value, existing: Option<&SavedConnection>) -> Result<SavedConnection> {
    let mut value = shape.clone();
    let existing = existing.and_then(|profile| serde_json::to_value(profile).ok());
    let fields = value
        .as_object_mut()
        .ok_or_else(|| anyhow!("profile record is not an object"))?;
    fields.insert(
        "lastConnected".into(),
        existing
            .as_ref()
            .and_then(|profile| profile.get("lastConnected").cloned())
            .unwrap_or(Value::Null),
    );
    if let Some(auth) = fields.get_mut("authType").and_then(Value::as_object_mut) {
        let kind = auth.get("type").cloned();
        let own = existing
            .as_ref()
            .and_then(|profile| profile.get("authType"))
            .filter(|own| own.get("type") == kind.as_ref());
        for field in DEVICE_AUTH_FIELDS {
            if let Some(own) = own.and_then(|own| own.get(*field)) {
                auth.insert((*field).to_string(), own.clone());
            }
        }
        if kind.as_ref().and_then(Value::as_str) == Some("PrivateKey")
            && !auth.contains_key("keyPath")
        {
            auth.insert("keyPath".into(), json!(""));
        }
    }
    Ok(serde_json::from_value(value)?)
}

pub(crate) struct SshRecords {
    profiles: Arc<dyn SshProfiles>,
}

impl SshRecords {
    pub(crate) fn new(profiles: Arc<dyn SshProfiles>) -> Self {
        Self { profiles }
    }
}

#[async_trait]
impl LocalCollection for SshRecords {
    fn collection(&self) -> &'static str {
        SSH_PROFILES_COLLECTION
    }

    async fn list(&self, _device: &DeviceContext) -> Result<Vec<LocalItem>> {
        let mut items = Vec::new();
        for profile in self.profiles.saved().await? {
            if valid_record_id(&profile.id) {
                items.push(LocalItem::new(profile.id.clone(), projection(&profile)?));
            }
        }
        Ok(items)
    }

    async fn apply(&self, item: &RemoteItem, _context: &ApplyContext) -> Result<()> {
        let saved = self.profiles.saved().await?;
        let existing = saved.iter().find(|profile| profile.id == item.id);
        let profile = local_profile(&item.value, existing)?;
        if profile.id != item.id {
            return Err(anyhow!("profile record names another id"));
        }
        self.profiles.save(profile).await
    }

    async fn remove(&self, id: &str) -> Result<()> {
        if self
            .profiles
            .saved()
            .await?
            .iter()
            .any(|profile| profile.id == id)
        {
            self.profiles.delete(id).await?;
        }
        Ok(())
    }
}

/// The account's profiles that still need a password or a key here.
pub(crate) async fn profiles_needing_secrets(
    port: &dyn AccountRecordPort,
    manager: &SSHConnectionManager,
) -> Vec<NeedsSecret> {
    let saved = manager.get_saved_connections().await;
    let mut needing = Vec::new();
    for record in port.records(SSH_PROFILES_COLLECTION) {
        if record.value.is_none() {
            continue;
        }
        let Some(profile) = saved.iter().find(|profile| profile.id == record.id) else {
            continue;
        };
        let auth = serde_json::to_value(&profile.auth_type).unwrap_or(Value::Null);
        let missing = match auth["type"].as_str() {
            Some("Password") if !manager.has_stored_password(&profile.id).await => "password",
            Some("PrivateKey") if auth["keyPath"].as_str().is_none_or(str::is_empty) => "key",
            _ => continue,
        };
        needing.push(NeedsSecret {
            id: profile.id.clone(),
            missing: vec![missing.to_string()],
        });
    }
    needing
}

#[cfg(test)]
mod tests {
    use super::super::account_records_api::test_harness::*;
    use super::*;
    use openbitfun_core::service::remote_connect::account_records::collection_budget;
    use openbitfun_core::service::remote_ssh::{SSHAuthMethod, SSHConnectionConfig};

    struct Side {
        _dir: tempfile::TempDir,
        manager: SSHConnectionManager,
        device: Device,
    }

    fn side(id: &str) -> Side {
        let dir = tempfile::tempdir().unwrap();
        let manager = SSHConnectionManager::new(dir.path().join("ssh"));
        let device = device(id, Arc::new(SshRecords::new(Arc::new(manager.clone()))));
        Side {
            _dir: dir,
            manager,
            device,
        }
    }

    fn config(id: &str, auth: SSHAuthMethod) -> SSHConnectionConfig {
        serde_json::from_value::<SSHConnectionConfig>(json!({
            "id": id, "name": id, "host": "prod.example.com", "port": 22, "username": "deploy",
            "auth": { "type": "Password", "password": "x" }, "defaultWorkspace": "/srv/app",
            "proxyJump": "bastion.example.com"
        }))
        .map(|mut config| {
            config.auth = auth;
            config
        })
        .unwrap()
    }

    async fn saved(side: &Side, id: &str) -> Option<SavedConnection> {
        side.manager
            .get_saved_connections()
            .await
            .into_iter()
            .find(|profile| profile.id == id)
    }

    #[tokio::test]
    async fn profiles_travel_without_passwords_or_key_paths() {
        let a = side("a");
        let b = side("b");
        a.manager
            .save_connection(&config(
                "prod",
                SSHAuthMethod::Password {
                    password: "hunter2-very-secret".into(),
                },
            ))
            .await
            .unwrap();
        a.manager
            .save_connection(&config(
                "keyed",
                SSHAuthMethod::PrivateKey {
                    key_path: "/Users/a/.ssh/id_ed25519".into(),
                    passphrase: Some("key-passphrase-secret".into()),
                    certificate_path: None,
                },
            ))
            .await
            .unwrap();
        settle(&[&a.device, &b.device]).await;
        let text = replica_text(&a.device);
        for secret in ["hunter2", "key-passphrase", "/Users/a/.ssh"] {
            assert!(!text.contains(secret), "{secret} leaked");
        }
        let prod = saved(&b, "prod").await.unwrap();
        assert_eq!(prod.host, "prod.example.com");
        assert_eq!(prod.proxy_jump.as_deref(), Some("bastion.example.com"));
        assert!(!b.manager.has_stored_password("prod").await);
        let mut needing = profiles_needing_secrets(b.device.port.as_ref(), &b.manager).await;
        needing.sort_by(|left, right| left.id.cmp(&right.id));
        assert_eq!(
            needing,
            vec![
                NeedsSecret {
                    id: "keyed".into(),
                    missing: vec!["key".into()]
                },
                NeedsSecret {
                    id: "prod".into(),
                    missing: vec!["password".into()]
                },
            ]
        );
        // a keeps its own secrets; nothing echoes back.
        assert_eq!(
            a.manager
                .load_stored_password("prod")
                .await
                .unwrap()
                .as_deref(),
            Some("hunter2-very-secret")
        );
        assert!(profiles_needing_secrets(a.device.port.as_ref(), &a.manager)
            .await
            .is_empty());
        settle(&[&a.device, &b.device]).await;
        let keyed = serde_json::to_value(saved(&a, "keyed").await.unwrap().auth_type).unwrap();
        assert_eq!(keyed["keyPath"], "/Users/a/.ssh/id_ed25519");
    }

    #[tokio::test]
    async fn concurrent_profile_edits_converge_and_deletions_travel() {
        let a = side("a");
        let b = side("b");
        a.manager
            .save_connection(&config(
                "prod",
                SSHAuthMethod::Agent {
                    key_fingerprint: None,
                    fallback_key_path: None,
                },
            ))
            .await
            .unwrap();
        settle(&[&a.device, &b.device]).await;
        let mut on_a = saved(&a, "prod").await.unwrap();
        on_a.port = 2222;
        a.manager.save_profile_without_secret(on_a).await.unwrap();
        a.device.sync.round().await;
        std::thread::sleep(std::time::Duration::from_millis(3));
        let mut on_b = saved(&b, "prod").await.unwrap();
        on_b.port = 2200;
        b.manager.save_profile_without_secret(on_b).await.unwrap();
        b.device.sync.round().await;
        settle(&[&a.device, &b.device]).await;
        assert_eq!(saved(&a, "prod").await.unwrap().port, 2200);
        assert_eq!(saved(&b, "prod").await.unwrap().port, 2200);
        b.manager.delete_saved_connection("prod").await.unwrap();
        settle(&[&a.device, &b.device]).await;
        assert!(saved(&a, "prod").await.is_none());
    }

    #[tokio::test]
    async fn legacy_profile_files_read_in_place_and_keep_their_budget() {
        let dir = tempfile::tempdir().unwrap();
        let ssh = dir.path().join("ssh");
        std::fs::create_dir_all(&ssh).unwrap();
        let budget = collection_budget(SSH_PROFILES_COLLECTION).unwrap();
        // A 1.x `ssh_connections.json`, one more profile than the budget.
        let profiles: Vec<Value> = (0..=budget.max_records)
            .map(|index| json!({
                "id": format!("p{index}"), "name": format!("p{index}"), "host": format!("h{index}.example.com"),
                "port": 22, "username": "u", "authType": { "type": "PrivateKey", "keyPath": "/Users/a/.ssh/id_rsa" },
                "defaultWorkspace": null, "lastConnected": 1700000000
            }))
            .collect();
        std::fs::write(
            ssh.join("ssh_connections.json"),
            serde_json::to_vec(&profiles).unwrap(),
        )
        .unwrap();
        let manager = SSHConnectionManager::new(ssh.clone());
        manager.load_saved_connections().await.unwrap();
        let device = device("a", Arc::new(SshRecords::new(Arc::new(manager.clone()))));
        settle(&[&device]).await;
        assert_eq!(
            live(&device, SSH_PROFILES_COLLECTION).len(),
            budget.max_records
        );
        assert_eq!(
            device
                .sync
                .status()
                .refused
                .iter()
                .filter(|r| r.reason == "budget")
                .count(),
            1
        );
        assert!(!replica_text(&device).contains("/Users/a/.ssh"));
        // The old file still reads, unchanged.
        let reread = SSHConnectionManager::new(ssh);
        reread.load_saved_connections().await.unwrap();
        assert_eq!(
            reread.get_saved_connections().await.len(),
            budget.max_records + 1
        );
    }
}

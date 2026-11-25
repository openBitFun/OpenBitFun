use openbitfun_agent_runtime::permission::PermissionRequestManager;
use openbitfun_runtime_ports::{ClockPort, RuntimeServiceCapability, RuntimeServicePort};
use openbitfun_services_core::permission_store::ProjectPermissionSqliteStore;
use std::{
    path::PathBuf,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Debug, Clone, Copy, Default)]
struct SystemPermissionClock;

impl RuntimeServicePort for SystemPermissionClock {
    fn capability(&self) -> RuntimeServiceCapability {
        RuntimeServiceCapability::Clock
    }
}

impl ClockPort for SystemPermissionClock {
    fn now_unix_millis(&self) -> i64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| i64::try_from(duration.as_millis()).unwrap_or(i64::MAX))
            .unwrap_or_default()
    }
}

pub fn request_manager(directory: PathBuf) -> Arc<PermissionRequestManager> {
    let store = Arc::new(ProjectPermissionSqliteStore::new(directory));
    let audit_store: Arc<dyn openbitfun_runtime_ports::PermissionAuditStorePort> = store.clone();
    let reply_store: Arc<dyn openbitfun_runtime_ports::PermissionReplyStorePort> = store.clone();
    let grant_store: Arc<dyn openbitfun_runtime_ports::PermissionGrantStorePort> = store;
    Arc::new(
        PermissionRequestManager::new(audit_store, reply_store, Arc::new(SystemPermissionClock))
            .with_grant_store(grant_store),
    )
}

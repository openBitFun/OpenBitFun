//! Account records on the CLI host: the Core bindings (quick actions,
//! custom agents and modes, skills, routines, MCP server shapes, the
//! consolidated memory, assistant personas, bot binding metadata) on this
//! device's copy of the account replica, the one settings sync uses
//! (`account_settings_sync`). A CLI host holds and relays every account
//! collection (desktop cards and pets too) even where it applies none of
//! them locally. No server keeps any of it.

use std::sync::Arc;

use openbitfun_core::service::config::ConfigService;
use openbitfun_core::service::remote_connect::account_records::{
    self, AccountRecordPort, RecordPortProvider,
};
use openbitfun_obp::fleet::account_port::ReplicaRecordPort;
use tokio::sync::watch;

struct CliRecordPorts;

impl RecordPortProvider for CliRecordPorts {
    fn port(&self) -> Option<Arc<dyn AccountRecordPort>> {
        let (account_id, replica) = crate::account_settings_sync::current_account_replica()?;
        let sync = Arc::new(|| crate::fleet_host::current().and_then(|host| host.replica_sync()));
        Some(Arc::new(ReplicaRecordPort::new(account_id, replica, sync)))
    }

    fn changes(&self) -> Option<watch::Receiver<u64>> {
        crate::account_settings_sync::current_account_replica()
            .map(|(_, replica)| replica.subscribe())
    }

    fn device_name(&self) -> String {
        openbitfun_core::service::remote_connect::DeviceIdentity::from_current_machine()
            .map(|identity| identity.device_name)
            .unwrap_or_default()
    }
}

/// Starts the binder for this process (once); a failure is logged.
pub(crate) fn start(config: Arc<ConfigService>) {
    let collections = account_records::core_collections(Arc::clone(&config));
    if let Err(error) = account_records::start(config, collections, Arc::new(CliRecordPorts), None)
    {
        tracing::warn!("Account records sync not started: {error:#}");
    }
}

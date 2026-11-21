//! A two-device harness for the Core bindings: each device has an
//! in-process replica ([`memory::MemoryRecordPort`]) and the real binder;
//! [`settle`] runs rounds and exchanges like the device network does.

use std::sync::{Arc, Mutex};

use anyhow::Result;
use async_trait::async_trait;
use tokio::sync::watch;

use super::*;
use openbitfun_services_integrations::remote_connect::account_records::memory::MemoryRecordPort;

pub(crate) struct Provider(pub Arc<MemoryRecordPort>);

impl RecordPortProvider for Provider {
    fn port(&self) -> Option<Arc<dyn AccountRecordPort>> {
        Some(Arc::clone(&self.0) as Arc<dyn AccountRecordPort>)
    }

    fn changes(&self) -> Option<watch::Receiver<u64>> {
        Some(self.0.subscribe())
    }

    fn device_name(&self) -> String {
        format!("{}-name", self.0.device_id())
    }
}

#[derive(Default)]
pub(crate) struct MemoryStore(Mutex<Option<RecordsState>>);

#[async_trait]
impl RecordsStateStore for MemoryStore {
    async fn load(&self, _account_id: &str) -> Result<Option<RecordsState>> {
        Ok(self.0.lock().unwrap().clone())
    }

    async fn save(&self, state: &RecordsState) -> Result<()> {
        *self.0.lock().unwrap() = Some(state.clone());
        Ok(())
    }
}

pub(crate) struct TestDevice {
    pub port: Arc<MemoryRecordPort>,
    pub sync: Arc<AccountRecordsSync>,
}

pub(crate) fn test_device(id: &str, binding: Arc<dyn LocalCollection>) -> TestDevice {
    let port = MemoryRecordPort::new("acct", id);
    let sync = AccountRecordsSync::new(
        vec![binding],
        Arc::new(Provider(Arc::clone(&port))),
        Arc::new(MemoryStore::default()),
        Arc::new(AlwaysOn),
    );
    TestDevice { port, sync }
}

pub(crate) fn link(a: &TestDevice, b: &TestDevice) {
    MemoryRecordPort::link(&a.port, &b.port);
}

pub(crate) async fn settle(devices: &[&TestDevice]) {
    for _ in 0..4 {
        for device in devices {
            device.sync.round().await;
        }
        for (index, left) in devices.iter().enumerate() {
            for right in &devices[index + 1..] {
                MemoryRecordPort::exchange(&left.port, &right.port);
            }
        }
    }
}

/// Everything the replica holds, as text (to prove a secret is absent).
pub(crate) fn replica_text(device: &TestDevice) -> String {
    serde_json::to_string(&device.port.all()).unwrap()
}

/// The live records of a collection.
pub(crate) fn live(device: &TestDevice, collection: &str) -> Vec<AccountRecord> {
    device
        .port
        .records(collection)
        .into_iter()
        .filter(|record| record.value.is_some())
        .collect()
}

/// Fills a collection to its budget plus one with `make` and checks the
/// binder refuses the extra item loudly and keeps it on the device.
pub(crate) fn budget_of(collection: &str) -> AccountCollectionBudget {
    collection_budget(collection).expect("declared collection")
}

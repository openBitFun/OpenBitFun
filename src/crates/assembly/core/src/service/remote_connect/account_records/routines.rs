//! Routine definitions (`routines`): every routine of the account is listed
//! on every device, and each still runs only on its target device. A record
//! names the device that owns the routine (`targetDeviceId`, the device that
//! created it) and carries its definition (no run state). Only the target
//! device materializes it in its scheduler (`D/cron/jobs.json`, read in
//! place); other devices show it as "runs on <device>" from the replica, so
//! the scheduler lease stays local and a routine never runs twice.

use std::sync::Arc;

use anyhow::{anyhow, Result};
use async_trait::async_trait;
use serde_json::{json, Value};

use super::{
    valid_record_id, AccountRecordPort, ApplyContext, DeviceContext, LocalCollection, LocalItem,
    RemoteItem, ROUTINES_COLLECTION,
};
use crate::service::cron::{CronJob, UpdateCronJobRequest};

/// The routines of this device's scheduler.
#[async_trait]
pub trait RoutineStore: Send + Sync {
    /// Every routine (an error when the scheduler is not available, which is
    /// never read as "no routines").
    async fn jobs(&self) -> Result<Vec<CronJob>>;
    async fn update(&self, id: &str, request: UpdateCronJobRequest) -> Result<()>;
    async fn delete(&self, id: &str) -> Result<()>;
}

/// The process's scheduler (`get_global_cron_service`).
pub struct GlobalCron;

#[async_trait]
impl RoutineStore for GlobalCron {
    async fn jobs(&self) -> Result<Vec<CronJob>> {
        let service = crate::service::cron::get_global_cron_service()
            .ok_or_else(|| anyhow!("scheduler not started"))?;
        Ok(service.list_jobs().await)
    }

    async fn update(&self, id: &str, request: UpdateCronJobRequest) -> Result<()> {
        let service = crate::service::cron::get_global_cron_service()
            .ok_or_else(|| anyhow!("scheduler not started"))?;
        service
            .update_job(id, request)
            .await
            .map(|_| ())
            .map_err(|error| anyhow!("{error}"))
    }

    async fn delete(&self, id: &str) -> Result<()> {
        let service = crate::service::cron::get_global_cron_service()
            .ok_or_else(|| anyhow!("scheduler not started"))?;
        service
            .delete_job(id)
            .await
            .map(|_| ())
            .map_err(|error| anyhow!("{error}"))
    }
}

pub struct RoutineRecords {
    store: Arc<dyn RoutineStore>,
}

impl RoutineRecords {
    pub fn new(store: Arc<dyn RoutineStore>) -> Self {
        Self { store }
    }
}

/// The definition fields that travel (run state stays on the device).
const DEFINITION_FIELDS: &[&str] = &[
    "id",
    "name",
    "schedule",
    "payload",
    "reportPolicy",
    "enabled",
    "target",
    "createdAtMs",
    "configUpdatedAtMs",
];

fn projection(job: &CronJob, device: &DeviceContext) -> Result<Value> {
    let full = serde_json::to_value(job)?;
    let mut value = serde_json::Map::new();
    for field in DEFINITION_FIELDS {
        if let Some(entry) = full.get(*field) {
            value.insert((*field).to_string(), entry.clone());
        }
    }
    value.insert("targetDeviceId".into(), json!(device.device_id));
    value.insert("targetDeviceName".into(), json!(device.device_name));
    Ok(Value::Object(value))
}

#[async_trait]
impl LocalCollection for RoutineRecords {
    fn collection(&self) -> &'static str {
        ROUTINES_COLLECTION
    }

    async fn list(&self, device: &DeviceContext) -> Result<Vec<LocalItem>> {
        let mut items = Vec::new();
        for job in self.store.jobs().await? {
            if valid_record_id(&job.id) {
                items.push(LocalItem::new(job.id.clone(), projection(&job, device)?));
            }
        }
        Ok(items)
    }

    async fn apply(&self, item: &RemoteItem, context: &ApplyContext) -> Result<()> {
        if item.value["targetDeviceId"].as_str() != Some(context.device.device_id.as_str()) {
            // Another device's routine: listed from the replica, never run here.
            return Ok(());
        }
        let exists = self.store.jobs().await?.iter().any(|job| job.id == item.id);
        if !exists {
            log::info!(
                "Routine for this device not in its scheduler, kept as an account record: id={}",
                item.id
            );
            return Ok(());
        }
        let field = |name: &str| item.value.get(name).cloned().unwrap_or(Value::Null);
        let request = UpdateCronJobRequest {
            name: serde_json::from_value(field("name")).ok(),
            schedule: serde_json::from_value(field("schedule")).ok(),
            payload: serde_json::from_value(field("payload")).ok(),
            report_policy: serde_json::from_value(field("reportPolicy")).ok(),
            enabled: field("enabled").as_bool(),
            target: serde_json::from_value(field("target")).ok(),
        };
        self.store.update(&item.id, request).await
    }

    async fn remove(&self, id: &str) -> Result<()> {
        if self.store.jobs().await?.iter().any(|job| job.id == id) {
            self.store.delete(id).await?;
        }
        Ok(())
    }
}

/// The account's routines that run on another device (what this device
/// lists beside its own).
pub fn account_routines_elsewhere(port: &dyn AccountRecordPort) -> Vec<Value> {
    let me = port.device_id();
    port.records(ROUTINES_COLLECTION)
        .into_iter()
        .filter_map(|record| {
            let value = record.value?.get("v").cloned()?;
            let target = value["targetDeviceId"].as_str()?.to_string();
            (target != me).then(|| {
                json!({
                    "id": record.id,
                    "name": value["name"],
                    "schedule": value["schedule"],
                    "enabled": value["enabled"],
                    "targetDeviceId": target,
                    "targetDeviceName": value["targetDeviceName"],
                })
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::super::test_support::*;
    use super::*;
    use std::sync::Mutex;

    #[derive(Default)]
    struct Scheduler(Mutex<Vec<CronJob>>);

    #[async_trait]
    impl RoutineStore for Scheduler {
        async fn jobs(&self) -> Result<Vec<CronJob>> {
            Ok(self.0.lock().unwrap().clone())
        }
        async fn update(&self, id: &str, request: UpdateCronJobRequest) -> Result<()> {
            let mut jobs = self.0.lock().unwrap();
            let job = jobs.iter_mut().find(|job| job.id == id).unwrap();
            if let Some(name) = request.name {
                job.name = name;
            }
            if let Some(enabled) = request.enabled {
                job.enabled = enabled;
            }
            if let Some(schedule) = request.schedule {
                job.schedule = schedule;
            }
            Ok(())
        }
        async fn delete(&self, id: &str) -> Result<()> {
            self.0.lock().unwrap().retain(|job| job.id != id);
            Ok(())
        }
    }

    /// A job as `jobs.json` (version 2) stores it, run state included.
    fn legacy_job(id: &str, name: &str) -> CronJob {
        serde_json::from_value(json!({
            "id": id,
            "name": name,
            "schedule": { "kind": "cron", "expr": "0 9 * * *" },
            "payload": { "text": "Summarize yesterday" },
            "enabled": true,
            "target": { "kind": "workspace", "workspace": { "workspaceId": "ws-1", "workspacePath": "/Users/a/proj" } },
            "createdAtMs": 1, "configUpdatedAtMs": 1, "updatedAtMs": 99,
            "state": { "nextRunAtMs": 1234, "consecutiveFailures": 2 }
        }))
        .expect("jobs.json v2 job")
    }

    fn side(id: &str, jobs: Vec<CronJob>) -> (Arc<Scheduler>, TestDevice) {
        let scheduler = Arc::new(Scheduler(Mutex::new(jobs)));
        let device = test_device(
            id,
            Arc::new(RoutineRecords::new(
                Arc::clone(&scheduler) as Arc<dyn RoutineStore>
            )),
        );
        (scheduler, device)
    }

    #[tokio::test]
    async fn routines_are_listed_everywhere_and_run_only_on_their_target() {
        let (sched_a, a) = side("a", vec![legacy_job("cron_1", "Daily digest")]);
        let (sched_b, b) = side("b", Vec::new());
        link(&a, &b);
        settle(&[&a, &b]).await;
        // b lists it as a's routine and never schedules it.
        assert!(sched_b.0.lock().unwrap().is_empty());
        let elsewhere = account_routines_elsewhere(b.port.as_ref());
        assert_eq!(elsewhere.len(), 1);
        assert_eq!(elsewhere[0]["targetDeviceId"], "a");
        assert_eq!(elsewhere[0]["targetDeviceName"], "a-name");
        assert_eq!(elsewhere[0]["name"], "Daily digest");
        assert!(account_routines_elsewhere(a.port.as_ref()).is_empty());
        // Run state never travels; the old file shape is untouched.
        assert!(!replica_text(&a).contains("consecutiveFailures"));
        assert_eq!(sched_a.0.lock().unwrap()[0].state.consecutive_failures, 2);
        // An edit on the target travels; a deletion too.
        sched_a.0.lock().unwrap()[0].name = "Morning digest".into();
        settle(&[&a, &b]).await;
        assert_eq!(
            account_routines_elsewhere(b.port.as_ref())[0]["name"],
            "Morning digest"
        );
        sched_a.0.lock().unwrap().clear();
        settle(&[&a, &b]).await;
        assert!(account_routines_elsewhere(b.port.as_ref()).is_empty());
    }

    #[tokio::test]
    async fn an_account_edit_of_this_devices_routine_applies_to_its_scheduler() {
        let (sched_a, a) = side("a", vec![legacy_job("cron_1", "Digest")]);
        let (_sched_b, b) = side("b", Vec::new());
        link(&a, &b);
        settle(&[&a, &b]).await;
        // Another device (a controller editing through the account) writes
        // the record; the conflict resolves to the later write.
        let mut record = live(&b, ROUTINES_COLLECTION).remove(0).value.unwrap();
        record["v"]["enabled"] = json!(false);
        b.port
            .put(ROUTINES_COLLECTION, "cron_1", record, &[], false)
            .unwrap();
        settle(&[&a, &b]).await;
        assert!(!sched_a.0.lock().unwrap()[0].enabled);
    }

    #[tokio::test]
    async fn routines_never_carry_a_secret_and_keep_their_budget() {
        let mut leaky = legacy_job("cron_leak", "Leaky");
        leaky.payload.text = "call with Bearer abcdefghijklmnopqrstuvwxyz012345".into();
        let budget = budget_of(ROUTINES_COLLECTION);
        let mut jobs = vec![leaky];
        for index in 0..=budget.max_records {
            jobs.push(legacy_job(&format!("cron_{index}"), "r"));
        }
        let (_sched, a) = side("a", jobs);
        settle(&[&a]).await;
        assert!(!replica_text(&a).contains("abcdefghijklmnopqrstuvwxyz012345"));
        let refused = a.sync.status().refused;
        assert!(refused
            .iter()
            .any(|r| r.id == "cron_leak" && r.reason == "secret"));
        assert_eq!(live(&a, ROUTINES_COLLECTION).len(), budget.max_records);
        assert_eq!(refused.iter().filter(|r| r.reason == "budget").count(), 1);
    }
}

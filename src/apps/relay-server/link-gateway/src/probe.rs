//! What the entry ranking needs from each device, read from its own
//! `/obp/mesh/info` and cached per device for at most [`INFO_PROBE_TTL`].
//!
//! The probe is the plain opening of a Link stream (no TLS, the opening the
//! pool uses for `/obp-ui/v1/`): `GET /obp/mesh/info` answers the device's
//! public mesh facts as JSON. The gateway reads two of them:
//!
//! - `capabilities` contains `fleet_v1`: the device serves the fleet layer;
//! - `fleetLoad`: clients attached to it as a fleet entry now.
//!
//! Nothing in the answer is secret, and the gateway passes nothing through:
//! the page only gets the ranked ids. An older device does not know the
//! opening (it closes, answers `404`, or answers TLS bytes); its facts stay
//! unknown and it ranks as a device without the fleet layer. A failed probe
//! is cached too, so a slow device costs one probe per TTL, not one per
//! device-list poll.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use futures::future::{FutureExt, Shared};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::upstream::{BoxFuture, DeviceStreams};

/// How long one device's probe answer is reused.
pub(crate) const INFO_PROBE_TTL: Duration = Duration::from_secs(30);
/// One probe, open to answer (the device list waits for it).
const PROBE_TIMEOUT: Duration = Duration::from_millis(1500);
/// The largest answer read.
const MAX_ANSWER_BYTES: u64 = 64 * 1024;
/// Cached devices across all accounts before the cache is reset.
const MAX_ENTRIES: usize = 50_000;

/// The ranking facts of one device. `None`: unknown (an older device, or
/// one that did not answer).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct ProbeFacts {
    /// `1` when the device lists `fleet_v1`.
    pub(crate) fleet_protocol: Option<u32>,
    pub(crate) fleet_load: Option<u32>,
}

/// Reads the facts from a `/obp/mesh/info` body; `device_id` must match.
pub(crate) fn facts_of(body: &serde_json::Value, device_id: &str) -> ProbeFacts {
    if body["deviceId"].as_str() != Some(device_id) {
        return ProbeFacts::default();
    }
    let fleet = body["capabilities"].as_array().is_some_and(|capabilities| {
        capabilities.iter().any(|capability| {
            capability.as_str() == Some(openbitfun_product_domains::fleet::FLEET_V1_CAPABILITY)
        })
    });
    ProbeFacts {
        fleet_protocol: fleet.then_some(1),
        fleet_load: body["fleetLoad"]
            .as_u64()
            .map(|load| u32::try_from(load).unwrap_or(u32::MAX)),
    }
}

type ProbeFlight = Shared<BoxFuture<'static, ProbeFacts>>;

struct InflightGuard {
    inflight: Arc<Mutex<HashMap<(String, String), ProbeFlight>>>,
    key: (String, String),
}

impl Drop for InflightGuard {
    fn drop(&mut self) {
        self.inflight
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&self.key);
    }
}

fn insert_cached(
    entries: &Mutex<HashMap<(String, String), (Instant, ProbeFacts)>>,
    ttl: Duration,
    key: (String, String),
    facts: ProbeFacts,
) {
    let mut entries = entries.lock().unwrap_or_else(|e| e.into_inner());
    let now = Instant::now();
    if !entries.contains_key(&key) && entries.len() >= MAX_ENTRIES {
        entries.retain(|_, (at, _)| now.saturating_duration_since(*at) < ttl);
        if entries.len() >= MAX_ENTRIES {
            if let Some(oldest) = entries
                .iter()
                .min_by_key(|(_, (at, _))| *at)
                .map(|(k, _)| k.clone())
            {
                entries.remove(&oldest);
            }
        }
    }
    entries.insert(key, (now, facts));
}

/// The per-device probe cache, with single-flight deduplication per
/// `(account_id, device_id)`.
pub(crate) struct InfoProbes {
    ttl: Duration,
    entries: Arc<Mutex<HashMap<(String, String), (Instant, ProbeFacts)>>>,
    inflight: Arc<Mutex<HashMap<(String, String), ProbeFlight>>>,
}

impl Default for InfoProbes {
    fn default() -> Self {
        Self::new(INFO_PROBE_TTL)
    }
}

impl InfoProbes {
    /// `ttl` is capped at [`INFO_PROBE_TTL`].
    pub(crate) fn new(ttl: Duration) -> Self {
        Self {
            ttl: ttl.min(INFO_PROBE_TTL),
            entries: Arc::new(Mutex::new(HashMap::new())),
            inflight: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    fn cached(&self, key: &(String, String)) -> Option<ProbeFacts> {
        let entries = self.entries.lock().unwrap_or_else(|e| e.into_inner());
        entries
            .get(key)
            .filter(|(at, _)| at.elapsed() < self.ttl)
            .map(|(_, facts)| *facts)
    }

    /// The facts of every device in `device_ids`, probing the ones whose
    /// cached answer is missing or older than the TTL (all at once).
    /// Concurrent callers for the same `(account_id, device_id)` share one
    /// in-flight probe.
    pub(crate) async fn facts(
        &self,
        streams: &Arc<dyn DeviceStreams>,
        account_id: &str,
        device_ids: &[String],
    ) -> HashMap<String, ProbeFacts> {
        let mut seen = HashSet::with_capacity(device_ids.len());
        let mut known = HashMap::new();
        let mut pending: Vec<(String, ProbeFlight)> = Vec::new();
        for device_id in device_ids {
            if !seen.insert(device_id.as_str()) {
                continue;
            }
            let key = (account_id.to_string(), device_id.clone());
            if let Some(facts) = self.cached(&key) {
                known.insert(device_id.clone(), facts);
                continue;
            }
            let mut inflight = self.inflight.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(flight) = inflight.get(&key) {
                pending.push((device_id.clone(), flight.clone()));
                continue;
            }
            // Re-check the cache under the inflight lock in case a flight
            // finished between the fast check above and acquiring `inflight`.
            if let Some(facts) = self.cached(&key) {
                known.insert(device_id.clone(), facts);
                continue;
            }
            let entries = Arc::clone(&self.entries);
            let inflight_map = Arc::clone(&self.inflight);
            let streams = Arc::clone(streams);
            let ttl = self.ttl;
            let task_key = key.clone();
            let task = tokio::spawn(async move {
                let _guard = InflightGuard {
                    inflight: inflight_map,
                    key: task_key.clone(),
                };
                let facts = tokio::time::timeout(
                    PROBE_TIMEOUT,
                    probe(streams.as_ref(), &task_key.0, &task_key.1),
                )
                .await
                .unwrap_or_default();
                insert_cached(&entries, ttl, task_key, facts);
                facts
            });
            let flight: BoxFuture<'static, ProbeFacts> =
                Box::pin(async move { task.await.unwrap_or_default() });
            let flight = flight.shared();
            inflight.insert(key, flight.clone());
            pending.push((device_id.clone(), flight));
        }
        let probed = futures::future::join_all(
            pending
                .into_iter()
                .map(|(device_id, flight)| async move { (device_id, flight.await) }),
        )
        .await;
        for (device_id, facts) in probed {
            known.insert(device_id, facts);
        }
        known
    }
}

/// One `GET /obp/mesh/info` on a fresh stream; unknown on any failure.
async fn probe(streams: &dyn DeviceStreams, account_id: &str, device_id: &str) -> ProbeFacts {
    let Ok(mut io) = streams.open(account_id, device_id).await else {
        return ProbeFacts::default();
    };
    let request =
        "GET /obp/mesh/info HTTP/1.1\r\nHost: obp-info\r\nAccept: application/json\r\nConnection: close\r\n\r\n";
    if io.write_all(request.as_bytes()).await.is_err() {
        return ProbeFacts::default();
    }
    let _ = io.flush().await;
    let mut answer = Vec::new();
    let _ = (&mut io)
        .take(MAX_ANSWER_BYTES)
        .read_to_end(&mut answer)
        .await;
    let Some(at) = answer.windows(4).position(|window| window == b"\r\n\r\n") else {
        return ProbeFacts::default();
    };
    let (head, body) = (&answer[..at], &answer[at + 4..]);
    if !head.starts_with(b"HTTP/1.1 200") && !head.starts_with(b"HTTP/1.0 200") {
        return ProbeFacts::default();
    }
    match serde_json::from_slice::<serde_json::Value>(body) {
        Ok(body) => facts_of(&body, device_id),
        Err(_) => ProbeFacts::default(),
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    use super::*;
    use crate::upstream::{BoxFuture, DeviceIo, OnlineMember, StreamError};

    /// Devices answering `/obp/mesh/info` from a table (absent: an older
    /// device that closes the opening).
    #[derive(Default)]
    struct InfoDevices {
        answers: Mutex<HashMap<String, serde_json::Value>>,
        opens: AtomicUsize,
        delay_ms: AtomicUsize,
    }

    impl DeviceStreams for InfoDevices {
        fn open<'a>(
            &'a self,
            _account_id: &'a str,
            device_id: &'a str,
        ) -> BoxFuture<'a, Result<Box<dyn DeviceIo>, StreamError>> {
            Box::pin(async move {
                self.opens.fetch_add(1, Ordering::SeqCst);
                let answer = self.answers.lock().unwrap().get(device_id).cloned();
                let delay = Duration::from_millis(self.delay_ms.load(Ordering::SeqCst) as u64);
                let (near, mut far) = tokio::io::duplex(64 * 1024);
                tokio::spawn(async move {
                    let mut head = Vec::new();
                    let mut chunk = [0u8; 1024];
                    while !head.windows(4).any(|w| w == b"\r\n\r\n") {
                        match far.read(&mut chunk).await {
                            Ok(0) | Err(_) => return,
                            Ok(count) => head.extend_from_slice(&chunk[..count]),
                        }
                    }
                    assert!(head.starts_with(b"GET /obp/mesh/info HTTP/1.1\r\n"));
                    if !delay.is_zero() {
                        tokio::time::sleep(delay).await;
                    }
                    if let Some(answer) = answer {
                        let body = answer.to_string();
                        let reply = format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                            body.len()
                        );
                        let _ = far.write_all(reply.as_bytes()).await;
                    }
                    let _ = far.shutdown().await;
                });
                Ok(Box::new(near) as Box<dyn DeviceIo>)
            })
        }

        fn online<'a>(
            &'a self,
            _account_id: &'a str,
        ) -> BoxFuture<'a, Result<HashMap<String, OnlineMember>, StreamError>> {
            Box::pin(async { Ok(HashMap::new()) })
        }
    }

    #[test]
    fn facts_read_fleet_v1_and_the_load_of_the_named_device_only() {
        let body = serde_json::json!({
            "deviceId": "desk",
            "capabilities": ["obp_v1", "fleet_v1"],
            "fleetLoad": 3,
        });
        assert_eq!(
            facts_of(&body, "desk"),
            ProbeFacts {
                fleet_protocol: Some(1),
                fleet_load: Some(3)
            }
        );
        // Another device's answer (a moved port) says nothing about this one.
        assert_eq!(facts_of(&body, "other"), ProbeFacts::default());
        // An older host: no fleet layer, no load.
        let old = serde_json::json!({ "deviceId": "desk", "capabilities": ["obp_v1"] });
        assert_eq!(facts_of(&old, "desk"), ProbeFacts::default());
    }

    #[tokio::test]
    async fn probes_are_cached_per_device_for_the_ttl_and_old_devices_stay_unknown() {
        let devices = Arc::new(InfoDevices::default());
        let streams: Arc<dyn DeviceStreams> = Arc::clone(&devices) as Arc<dyn DeviceStreams>;
        devices.answers.lock().unwrap().insert(
            "desk".into(),
            serde_json::json!({ "deviceId": "desk", "capabilities": ["fleet_v1"], "fleetLoad": 2 }),
        );
        let probes = InfoProbes::new(Duration::from_millis(200));
        let ids = vec!["desk".to_string(), "old-cli".to_string()];
        let facts = probes.facts(&streams, "acct", &ids).await;
        assert_eq!(facts["desk"].fleet_protocol, Some(1));
        assert_eq!(facts["desk"].fleet_load, Some(2));
        assert_eq!(facts["old-cli"], ProbeFacts::default());
        assert_eq!(devices.opens.load(Ordering::SeqCst), 2);

        // Within the TTL: no new streams, the same answers (failures too).
        let again = probes.facts(&streams, "acct", &ids).await;
        assert_eq!(again, facts);
        assert_eq!(devices.opens.load(Ordering::SeqCst), 2);
        // Another account's device of the same id is its own entry.
        probes.facts(&streams, "acct-2", &ids[..1]).await;
        assert_eq!(devices.opens.load(Ordering::SeqCst), 3);

        // After the TTL: probed again, and a changed load is seen.
        devices.answers.lock().unwrap().insert(
            "desk".into(),
            serde_json::json!({ "deviceId": "desk", "capabilities": ["fleet_v1"], "fleetLoad": 5 }),
        );
        tokio::time::sleep(Duration::from_millis(250)).await;
        let later = probes.facts(&streams, "acct", &ids).await;
        assert_eq!(later["desk"].fleet_load, Some(5));
        assert_eq!(devices.opens.load(Ordering::SeqCst), 5);
    }

    #[tokio::test]
    async fn concurrent_probes_for_the_same_account_and_device_share_one_stream() {
        let devices = Arc::new(InfoDevices::default());
        devices.delay_ms.store(120, Ordering::SeqCst);
        devices.answers.lock().unwrap().insert(
            "desk".into(),
            serde_json::json!({ "deviceId": "desk", "capabilities": ["fleet_v1"], "fleetLoad": 4 }),
        );
        let streams: Arc<dyn DeviceStreams> = Arc::clone(&devices) as Arc<dyn DeviceStreams>;
        let probes = Arc::new(InfoProbes::new(Duration::from_secs(10)));

        // Eight concurrent callers for (acct-1, desk) plus duplicate ids in one call
        // must open only a single Link stream; (acct-2, desk) runs independently.
        let mut tasks = Vec::new();
        for i in 0..8 {
            let probes = Arc::clone(&probes);
            let streams = Arc::clone(&streams);
            let ids = if i == 0 {
                vec!["desk".to_string(), "desk".to_string()]
            } else {
                vec!["desk".to_string()]
            };
            tasks.push(tokio::spawn(async move {
                probes.facts(&streams, "acct-1", &ids).await
            }));
        }
        let other_acct = {
            let probes = Arc::clone(&probes);
            let streams = Arc::clone(&streams);
            let ids = vec!["desk".to_string()];
            tokio::spawn(async move { probes.facts(&streams, "acct-2", &ids).await })
        };

        let expected = ProbeFacts {
            fleet_protocol: Some(1),
            fleet_load: Some(4),
        };
        for task in tasks {
            let result = task.await.unwrap();
            assert_eq!(result.get("desk"), Some(&expected));
        }
        assert_eq!(other_acct.await.unwrap().get("desk"), Some(&expected));
        // Exactly 1 stream for (acct-1, desk) + 1 stream for (acct-2, desk).
        assert_eq!(devices.opens.load(Ordering::SeqCst), 2);
        assert!(probes.inflight.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn cancelled_leader_does_not_abort_followers_or_leak_inflight() {
        let devices = Arc::new(InfoDevices::default());
        devices.delay_ms.store(120, Ordering::SeqCst);
        devices.answers.lock().unwrap().insert(
            "desk".into(),
            serde_json::json!({ "deviceId": "desk", "capabilities": ["fleet_v1"], "fleetLoad": 1 }),
        );
        let streams: Arc<dyn DeviceStreams> = Arc::clone(&devices) as Arc<dyn DeviceStreams>;
        let probes = Arc::new(InfoProbes::new(Duration::from_secs(10)));
        let ids = vec!["desk".to_string()];

        let leader = {
            let probes = Arc::clone(&probes);
            let streams = Arc::clone(&streams);
            let ids = ids.clone();
            tokio::spawn(async move { probes.facts(&streams, "acct", &ids).await })
        };
        tokio::time::sleep(Duration::from_millis(20)).await;
        let follower = {
            let probes = Arc::clone(&probes);
            let streams = Arc::clone(&streams);
            let ids = ids.clone();
            tokio::spawn(async move { probes.facts(&streams, "acct", &ids).await })
        };
        tokio::time::sleep(Duration::from_millis(20)).await;
        leader.abort();

        let result = follower.await.unwrap();
        assert_eq!(
            result.get("desk"),
            Some(&ProbeFacts {
                fleet_protocol: Some(1),
                fleet_load: Some(1),
            })
        );
        assert_eq!(devices.opens.load(Ordering::SeqCst), 1);
        assert!(probes.inflight.lock().unwrap().is_empty());
    }

    #[test]
    fn the_ttl_never_exceeds_thirty_seconds() {
        assert_eq!(
            InfoProbes::new(Duration::from_secs(600)).ttl,
            INFO_PROBE_TTL
        );
        assert_eq!(InfoProbes::default().ttl, Duration::from_secs(30));
    }
}

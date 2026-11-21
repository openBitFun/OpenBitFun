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

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::upstream::DeviceStreams;

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

/// The per-device probe cache.
pub(crate) struct InfoProbes {
    ttl: Duration,
    entries: Mutex<HashMap<(String, String), (Instant, ProbeFacts)>>,
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
            entries: Mutex::new(HashMap::new()),
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
    pub(crate) async fn facts(
        &self,
        streams: &dyn DeviceStreams,
        account_id: &str,
        device_ids: &[String],
    ) -> HashMap<String, ProbeFacts> {
        let mut known = HashMap::new();
        let mut missing = Vec::new();
        for device_id in device_ids {
            let key = (account_id.to_string(), device_id.clone());
            match self.cached(&key) {
                Some(facts) => {
                    known.insert(device_id.clone(), facts);
                }
                None => missing.push(device_id.clone()),
            }
        }
        let probed = futures::future::join_all(missing.iter().map(|device_id| async move {
            let facts = tokio::time::timeout(PROBE_TIMEOUT, probe(streams, account_id, device_id))
                .await
                .unwrap_or_default();
            (device_id.clone(), facts)
        }))
        .await;
        let mut entries = self.entries.lock().unwrap_or_else(|e| e.into_inner());
        if entries.len() > MAX_ENTRIES {
            entries.clear();
        }
        let now = Instant::now();
        for (device_id, facts) in probed {
            entries.insert((account_id.to_string(), device_id.clone()), (now, facts));
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
        devices.answers.lock().unwrap().insert(
            "desk".into(),
            serde_json::json!({ "deviceId": "desk", "capabilities": ["fleet_v1"], "fleetLoad": 2 }),
        );
        let probes = InfoProbes::new(Duration::from_millis(200));
        let ids = vec!["desk".to_string(), "old-cli".to_string()];
        let facts = probes.facts(devices.as_ref(), "acct", &ids).await;
        assert_eq!(facts["desk"].fleet_protocol, Some(1));
        assert_eq!(facts["desk"].fleet_load, Some(2));
        assert_eq!(facts["old-cli"], ProbeFacts::default());
        assert_eq!(devices.opens.load(Ordering::SeqCst), 2);

        // Within the TTL: no new streams, the same answers (failures too).
        let again = probes.facts(devices.as_ref(), "acct", &ids).await;
        assert_eq!(again, facts);
        assert_eq!(devices.opens.load(Ordering::SeqCst), 2);
        // Another account's device of the same id is its own entry.
        probes.facts(devices.as_ref(), "acct-2", &ids[..1]).await;
        assert_eq!(devices.opens.load(Ordering::SeqCst), 3);

        // After the TTL: probed again, and a changed load is seen.
        devices.answers.lock().unwrap().insert(
            "desk".into(),
            serde_json::json!({ "deviceId": "desk", "capabilities": ["fleet_v1"], "fleetLoad": 5 }),
        );
        tokio::time::sleep(Duration::from_millis(250)).await;
        let later = probes.facts(devices.as_ref(), "acct", &ids).await;
        assert_eq!(later["desk"].fleet_load, Some(5));
        assert_eq!(devices.opens.load(Ordering::SeqCst), 5);
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

//! The pool against a fake device: hit, miss and pull, verify before store,
//! single-flight, last-use tracking, the 30-day cleanup on a mocked clock,
//! cap eviction, and restart.

use std::collections::HashMap;
use std::sync::atomic::{AtomicI64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use sha2::Digest;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use super::*;
use crate::upstream::{BoxFuture, DeviceIo, DeviceStreams, OnlineMember, StreamError};

/// Lowercase hex SHA-256.
pub(crate) fn sha(bytes: &[u8]) -> String {
    hex(&sha2::Sha256::digest(bytes))
}

/// A device's `/obp-ui/v1/` opening as W10-device implements it: one
/// request per stream, `200` with the bytes (+ `Content-Encoding: br` for a
/// `.br` sibling) or `404`, then close. Anything else is echoed back (the
/// OBP pipe tests).
#[derive(Default)]
pub(crate) struct FakeDevice {
    /// hash -> (bytes, is a `.br` sibling).
    pub(crate) files: Mutex<HashMap<String, (Vec<u8>, bool)>>,
    /// Send other bytes than the ones asked for.
    pub(crate) tamper: std::sync::atomic::AtomicBool,
    /// Answer this `Content-Encoding` on every file.
    pub(crate) encoding_override: Mutex<Option<String>>,
    /// Delay before answering.
    pub(crate) delay_ms: AtomicUsize,
    /// Answer this many requests with 503 (the device's concurrency cap).
    pub(crate) busy_answers: Arc<AtomicUsize>,
    /// Answer 404 `ui_bundle_unavailable` (no web UI shipped).
    pub(crate) no_bundle: std::sync::atomic::AtomicBool,
    /// UI requests seen, and streams opened.
    pub(crate) ui_requests: Arc<AtomicUsize>,
    pub(crate) opens: AtomicUsize,
    /// (account, device) of every opened stream.
    pub(crate) opened: Mutex<Vec<(String, String)>>,
    pub(crate) fail: Mutex<Option<StreamError>>,
    pub(crate) network: Mutex<Option<HashMap<String, OnlineMember>>>,
    pub(crate) online_calls: AtomicUsize,
    /// `/obp/mesh/info` answers by device id (absent: an older device that
    /// closes the opening), and the info probes seen.
    pub(crate) infos: Mutex<HashMap<String, serde_json::Value>>,
    pub(crate) info_requests: Arc<AtomicUsize>,
}

impl FakeDevice {
    /// Adds a file; returns its hash.
    pub(crate) fn add(&self, bytes: &[u8], br: bool) -> String {
        let hash = sha(bytes);
        self.files
            .lock()
            .unwrap()
            .insert(hash.clone(), (bytes.to_vec(), br));
        hash
    }
}

impl DeviceStreams for FakeDevice {
    fn open<'a>(
        &'a self,
        account_id: &'a str,
        device_id: &'a str,
    ) -> BoxFuture<'a, Result<Box<dyn DeviceIo>, StreamError>> {
        Box::pin(async move {
            self.opens.fetch_add(1, Ordering::SeqCst);
            if let Some(error) = self.fail.lock().unwrap().clone() {
                return Err(error);
            }
            self.opened
                .lock()
                .unwrap()
                .push((account_id.to_string(), device_id.to_string()));
            let files = self.files.lock().unwrap().clone();
            let tamper = self.tamper.load(Ordering::SeqCst);
            let encoding = self.encoding_override.lock().unwrap().clone();
            let delay = Duration::from_millis(self.delay_ms.load(Ordering::SeqCst) as u64);
            let (near, mut far) = tokio::io::duplex(256 * 1024);
            let ui_requests = Arc::clone(&self.ui_requests);
            let busy_answers = Arc::clone(&self.busy_answers);
            let no_bundle = self.no_bundle.load(Ordering::SeqCst);
            let info = self.infos.lock().unwrap().get(device_id).cloned();
            let info_requests = Arc::clone(&self.info_requests);
            tokio::spawn(async move {
                let mut buffer = Vec::new();
                let mut chunk = [0u8; 4096];
                // The first bytes decide the opening.
                let count = match far.read(&mut chunk).await {
                    Ok(0) | Err(_) => return,
                    Ok(count) => count,
                };
                buffer.extend_from_slice(&chunk[..count]);
                if buffer.starts_with(b"GET /obp/mesh/info ") {
                    info_requests.fetch_add(1, Ordering::SeqCst);
                    if let Some(info) = info {
                        let body = info.to_string();
                        let reply = format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                            body.len()
                        );
                        let _ = far.write_all(reply.as_bytes()).await;
                    }
                    let _ = far.shutdown().await;
                    return;
                }
                if !buffer.starts_with(b"GET /obp-ui/v1/") {
                    if far.write_all(&buffer).await.is_err() {
                        return;
                    }
                    loop {
                        match far.read(&mut chunk).await {
                            Ok(0) | Err(_) => return,
                            Ok(count) => {
                                if far.write_all(&chunk[..count]).await.is_err() {
                                    return;
                                }
                            }
                        }
                    }
                }
                ui_requests.fetch_add(1, Ordering::SeqCst);
                while !buffer.windows(4).any(|w| w == b"\r\n\r\n") {
                    match far.read(&mut chunk).await {
                        Ok(0) | Err(_) => return,
                        Ok(count) => buffer.extend_from_slice(&chunk[..count]),
                    }
                }
                tokio::time::sleep(delay).await;
                let line = String::from_utf8_lossy(&buffer).to_string();
                let hash = line
                    .trim_start_matches("GET /obp-ui/v1/")
                    .split(' ')
                    .next()
                    .unwrap_or_default()
                    .to_string();
                if no_bundle {
                    let body = "ui_bundle_unavailable: this build ships no web UI";
                    let head = format!(
                        "HTTP/1.1 404 Not Found\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    );
                    let _ = far.write_all(head.as_bytes()).await;
                    let _ = far.shutdown().await;
                    return;
                }
                if busy_answers
                    .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |left| {
                        left.checked_sub(1)
                    })
                    .is_ok()
                {
                    let _ = far
                        .write_all(
                            b"HTTP/1.1 503 Service Unavailable\r\nRetry-After: 1\r\nContent-Type: text/plain\r\nContent-Length: 4\r\nConnection: close\r\n\r\nbusy",
                        )
                        .await;
                    let _ = far.shutdown().await;
                    return;
                }
                match files.get(&hash) {
                    Some((bytes, br)) => {
                        let mut body = bytes.clone();
                        if tamper {
                            body[0] ^= 1;
                        }
                        let encoding = match (&encoding, br) {
                            (Some(value), _) => format!("Content-Encoding: {value}\r\n"),
                            (None, true) => "Content-Encoding: br\r\n".to_string(),
                            (None, false) => String::new(),
                        };
                        let head = format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: {}\r\n{encoding}Connection: close\r\n\r\n",
                            body.len()
                        );
                        let _ = far.write_all(head.as_bytes()).await;
                        let _ = far.write_all(&body).await;
                    }
                    None => {
                        let _ = far
                            .write_all(
                                b"HTTP/1.1 404 Not Found\r\nContent-Type: text/plain\r\nContent-Length: 9\r\nConnection: close\r\n\r\nnot found",
                            )
                            .await;
                    }
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
        Box::pin(async move {
            self.online_calls.fetch_add(1, Ordering::SeqCst);
            self.network
                .lock()
                .unwrap()
                .clone()
                .ok_or_else(|| StreamError::Unavailable("network not joined".into()))
        })
    }
}

struct Fixture {
    _dir: tempfile::TempDir,
    root: PathBuf,
    now: Arc<AtomicI64>,
    device: Arc<FakeDevice>,
    streams: Arc<dyn DeviceStreams>,
    pool: Arc<UiPool>,
}

const START: i64 = 1_800_000_000;
const DAY: i64 = 24 * 60 * 60;

fn clock_of(now: &Arc<AtomicI64>) -> Clock {
    let now = Arc::clone(now);
    Arc::new(move || now.load(Ordering::SeqCst))
}

fn fixture(options: PoolOptions) -> Fixture {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("pool");
    let now = Arc::new(AtomicI64::new(START));
    let device = Arc::new(FakeDevice::default());
    let pool = UiPool::open(&root, options, clock_of(&now)).unwrap();
    Fixture {
        _dir: dir,
        root,
        now,
        streams: Arc::clone(&device) as Arc<dyn DeviceStreams>,
        device,
        pool,
    }
}

impl Fixture {
    async fn get(&self, hash: &str) -> Result<(Vec<u8>, bool), PullError> {
        let mut stored = self
            .pool
            .fetch(hash, "acct-a", "desk-a", &self.streams)
            .await?;
        let mut bytes = Vec::new();
        stored.file.read_to_end(&mut bytes).await.unwrap();
        assert_eq!(bytes.len() as u64, stored.size);
        Ok((bytes, stored.br))
    }

    fn reopen(&self, options: PoolOptions) -> Arc<UiPool> {
        UiPool::open(&self.root, options, clock_of(&self.now)).unwrap()
    }

    fn meta(&self, hash: &str) -> Meta {
        serde_json::from_slice(
            &std::fs::read(self.root.join(&hash[..2]).join(format!("{hash}.meta"))).unwrap(),
        )
        .unwrap()
    }
}

#[tokio::test]
async fn a_miss_pulls_from_the_device_verifies_stores_once_and_then_hits() {
    let f = fixture(PoolOptions::default());
    let body = b"console.log('device bundle');".repeat(5000);
    let hash = f.device.add(&body, false);

    let (bytes, br) = f.get(&hash).await.unwrap();
    assert_eq!((bytes.as_slice(), br), (body.as_slice(), false));
    assert_eq!(f.device.opens.load(Ordering::SeqCst), 1);
    // Stored by hash under its two-character shard, with a sidecar.
    let stored = f.root.join(&hash[..2]).join(&hash);
    assert_eq!(std::fs::read(&stored).unwrap(), body);
    assert_eq!(f.meta(&hash).encoding, Encoding::Identity);
    assert_eq!(f.pool.usage(), (1, body.len() as u64));
    // No temp file is left behind.
    assert_eq!(std::fs::read_dir(f.root.join("tmp")).unwrap().count(), 0);

    // A hit never reaches the device, for any account or device.
    let (bytes, _) = f.get(&hash).await.unwrap();
    assert_eq!(bytes, body);
    let other = f
        .pool
        .fetch(&hash, "acct-b", "desk-b", &f.streams)
        .await
        .unwrap();
    assert_eq!(other.size, body.len() as u64);
    assert_eq!(f.device.opens.load(Ordering::SeqCst), 1);

    // A hash the device's bundle does not have.
    let missing = sha(b"not in the bundle");
    assert_eq!(f.get(&missing).await.unwrap_err(), PullError::NotInBundle);
    assert!(!f.pool.contains(&missing));
}

#[tokio::test]
async fn a_br_sibling_is_marked_and_other_encodings_are_refused() {
    let f = fixture(PoolOptions::default());
    // Bytes that stand in for a .br sibling (the pool never decodes them).
    let br_bytes = vec![0x1b, 0x2a, 0x00, 0x00, 0x04, 0x1c, 0x6f, 0x6b];
    let hash = f.device.add(&br_bytes, true);
    let (bytes, br) = f.get(&hash).await.unwrap();
    assert_eq!((bytes, br), (br_bytes.clone(), true));
    assert_eq!(f.meta(&hash).encoding, Encoding::Br);
    // Restart keeps the encoding.
    let reopened = f.reopen(PoolOptions::default());
    assert!(reopened.lookup(&hash).await.unwrap().br);

    let gz = f.device.add(b"gzip bytes", false);
    *f.device.encoding_override.lock().unwrap() = Some("gzip".into());
    assert!(matches!(
        f.get(&gz).await.unwrap_err(),
        PullError::BadAnswer(_)
    ));
    assert!(!f.pool.contains(&gz));
    *f.device.encoding_override.lock().unwrap() = Some("identity".into());
    assert_eq!(f.get(&gz).await.unwrap(), (b"gzip bytes".to_vec(), false));
}

#[tokio::test]
async fn a_mismatching_file_is_never_stored() {
    let f = fixture(PoolOptions::default());
    let hash = f.device.add(b"the real file", false);
    f.device.tamper.store(true, Ordering::SeqCst);
    assert_eq!(f.get(&hash).await.unwrap_err(), PullError::Mismatch);
    assert!(!f.pool.contains(&hash));
    assert!(!f.root.join(&hash[..2]).join(&hash).exists());
    assert_eq!(std::fs::read_dir(f.root.join("tmp")).unwrap().count(), 0);
    assert_eq!(f.pool.usage(), (0, 0));
    // The next pull from an honest device stores it.
    f.device.tamper.store(false, Ordering::SeqCst);
    assert_eq!(f.get(&hash).await.unwrap().0, b"the real file");
}

#[tokio::test]
async fn concurrent_misses_share_one_pull() {
    let f = fixture(PoolOptions::default());
    let body = vec![7u8; 300_000];
    let hash = f.device.add(&body, false);
    f.device.delay_ms.store(200, Ordering::SeqCst);
    let mut tasks = Vec::new();
    for index in 0..12 {
        let pool = Arc::clone(&f.pool);
        let streams = Arc::clone(&f.streams);
        let hash = hash.clone();
        tasks.push(tokio::spawn(async move {
            // Browsers of two accounts, each from its own device.
            let (account, device) = if index % 2 == 0 {
                ("acct-a", "desk-a")
            } else {
                ("acct-b", "desk-b")
            };
            let mut stored = pool.fetch(&hash, account, device, &streams).await.unwrap();
            let mut bytes = Vec::new();
            stored.file.read_to_end(&mut bytes).await.unwrap();
            bytes
        }));
    }
    for task in tasks {
        assert_eq!(task.await.unwrap(), body);
    }
    assert_eq!(f.device.opens.load(Ordering::SeqCst), 1);
    assert_eq!(f.pool.usage(), (1, body.len() as u64));
}

#[tokio::test]
async fn a_follower_retries_with_its_own_device_when_the_shared_pull_failed() {
    // Device "liar" tampers; "honest" does not.
    struct TwoDevices {
        liar: FakeDevice,
        honest: FakeDevice,
    }
    impl DeviceStreams for TwoDevices {
        fn open<'a>(
            &'a self,
            account_id: &'a str,
            device_id: &'a str,
        ) -> BoxFuture<'a, Result<Box<dyn DeviceIo>, StreamError>> {
            if device_id == "liar" {
                self.liar.open(account_id, device_id)
            } else {
                self.honest.open(account_id, device_id)
            }
        }
        fn online<'a>(
            &'a self,
            account_id: &'a str,
        ) -> BoxFuture<'a, Result<HashMap<String, OnlineMember>, StreamError>> {
            self.honest.online(account_id)
        }
    }
    let f = fixture(PoolOptions::default());
    let devices = Arc::new(TwoDevices {
        liar: FakeDevice::default(),
        honest: FakeDevice::default(),
    });
    let hash = devices.liar.add(b"shared file", false);
    devices.honest.add(b"shared file", false);
    devices.liar.tamper.store(true, Ordering::SeqCst);
    devices.liar.delay_ms.store(200, Ordering::SeqCst);
    let streams = Arc::clone(&devices) as Arc<dyn DeviceStreams>;
    let leader = {
        let pool = Arc::clone(&f.pool);
        let streams = Arc::clone(&streams);
        let hash = hash.clone();
        tokio::spawn(async move { pool.fetch(&hash, "acct-x", "liar", &streams).await.err() })
    };
    tokio::time::sleep(Duration::from_millis(50)).await;
    let follower = f
        .pool
        .fetch(&hash, "acct-a", "honest", &streams)
        .await
        .unwrap();
    assert_eq!(follower.size, 11);
    assert_eq!(leader.await.unwrap(), Some(PullError::Mismatch));
    assert_eq!(devices.liar.opens.load(Ordering::SeqCst), 1);
    assert_eq!(devices.honest.opens.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn a_miss_walks_the_holders_until_one_has_the_file() {
    // "old" ships no web UI, "gone" is unreachable, "peer" has the file.
    struct Holders {
        old: FakeDevice,
        peer: FakeDevice,
        opened: Mutex<Vec<String>>,
    }
    impl DeviceStreams for Holders {
        fn open<'a>(
            &'a self,
            account_id: &'a str,
            device_id: &'a str,
        ) -> BoxFuture<'a, Result<Box<dyn DeviceIo>, StreamError>> {
            self.opened.lock().unwrap().push(device_id.to_string());
            match device_id {
                "old" => self.old.open(account_id, device_id),
                "peer" => self.peer.open(account_id, device_id),
                _ => Box::pin(async { Err(StreamError::Unreachable("not on the network".into())) }),
            }
        }
        fn online<'a>(
            &'a self,
            account_id: &'a str,
        ) -> BoxFuture<'a, Result<HashMap<String, OnlineMember>, StreamError>> {
            self.peer.online(account_id)
        }
    }
    let f = fixture(PoolOptions::default());
    let devices = Arc::new(Holders {
        old: FakeDevice::default(),
        peer: FakeDevice::default(),
        opened: Mutex::new(Vec::new()),
    });
    devices.old.no_bundle.store(true, Ordering::SeqCst);
    let hash = devices.peer.add(b"bundle file from a peer", false);
    let streams = Arc::clone(&devices) as Arc<dyn DeviceStreams>;
    let holders: Vec<String> = ["old", "gone", "peer"].map(String::from).to_vec();
    let stored = f
        .pool
        .fetch_from_holders(&hash, "acct-a", &holders, &streams)
        .await
        .unwrap();
    assert_eq!(stored.size, 23);
    assert_eq!(*devices.opened.lock().unwrap(), holders);
    // A hit afterwards opens nothing.
    f.pool
        .fetch_from_holders(&hash, "acct-a", &holders, &streams)
        .await
        .unwrap();
    assert_eq!(devices.opened.lock().unwrap().len(), 3);

    // No holder has it: the last holder's answer.
    let missing = sha(b"nobody has this");
    assert_eq!(
        f.pool
            .fetch_from_holders(&missing, "acct-a", &holders, &streams)
            .await
            .err()
            .unwrap(),
        PullError::NotInBundle
    );
    // A limit of the pool itself ends the walk at the first holder.
    let small = fixture(PoolOptions {
        max_file_bytes: 4,
        ..PoolOptions::default()
    });
    let opened_before = devices.opened.lock().unwrap().len();
    let big = devices.peer.add(b"larger than four bytes", false);
    let peer_first: Vec<String> = ["peer", "old"].map(String::from).to_vec();
    assert_eq!(
        small
            .pool
            .fetch_from_holders(&big, "acct-a", &peer_first, &streams)
            .await
            .err()
            .unwrap(),
        PullError::TooLarge
    );
    assert_eq!(devices.opened.lock().unwrap().len(), opened_before + 1);
}

#[tokio::test]
async fn last_use_is_persisted_at_most_hourly_and_cleanup_deletes_after_30_days() {
    let f = fixture(PoolOptions::default());
    let old = f.device.add(b"old file", false);
    let fresh = f.device.add(b"fresh file", false);
    f.get(&old).await.unwrap();
    f.get(&fresh).await.unwrap();
    assert_eq!(f.meta(&old).last_used_at, START);

    // Hits within the hour keep the sidecar as it is.
    f.now.store(START + 30 * 60, Ordering::SeqCst);
    f.get(&fresh).await.unwrap();
    assert_eq!(f.meta(&fresh).last_used_at, START);
    // After an hour the sidecar records the new use.
    f.now.store(START + 61 * 60, Ordering::SeqCst);
    f.get(&fresh).await.unwrap();
    assert_eq!(f.meta(&fresh).last_used_at, START + 61 * 60);

    // Day 20: fresh is used again; old is not.
    f.now.store(START + 20 * DAY, Ordering::SeqCst);
    f.get(&fresh).await.unwrap();
    // Day 29: nothing is 30 days unused.
    f.now.store(START + 29 * DAY, Ordering::SeqCst);
    assert_eq!(f.pool.cleanup().await, Cleanup::default());
    // Day 30 and a bit: old goes, fresh stays.
    f.now.store(START + 30 * DAY + 60, Ordering::SeqCst);
    assert_eq!(f.pool.cleanup().await, Cleanup { files: 1, bytes: 8 });
    assert!(!f.pool.contains(&old) && f.pool.contains(&fresh));
    assert!(!f.root.join(&old[..2]).join(&old).exists());
    assert!(!f.root.join(&old[..2]).join(format!("{old}.meta")).exists());
    assert_eq!(f.pool.usage(), (1, 10));

    // The last use survives a restart (as of the sidecar): fresh's last
    // persisted use is day 20, so day 51 removes it.
    let reopened = f.reopen(PoolOptions::default());
    f.now.store(START + 49 * DAY, Ordering::SeqCst);
    assert_eq!(reopened.cleanup().await.files, 0);
    f.now.store(START + 51 * DAY, Ordering::SeqCst);
    assert_eq!(reopened.cleanup().await.files, 1);
    assert_eq!(reopened.usage(), (0, 0));
}

#[tokio::test]
async fn the_cap_evicts_the_oldest_unused_files_first() {
    let f = fixture(PoolOptions {
        max_total_bytes: 3000,
        ..PoolOptions::default()
    });
    let a = f.device.add(&[b'a'; 1000], false);
    let b = f.device.add(&[b'b'; 1000], false);
    let c = f.device.add(&[b'c'; 1000], false);
    let d = f.device.add(&[b'd'; 1000], false);
    for (step, hash) in [&a, &b, &c].into_iter().enumerate() {
        f.now.store(START + step as i64 * 10, Ordering::SeqCst);
        f.get(hash).await.unwrap();
    }
    // a is used again, so b is now the oldest-unused.
    f.now.store(START + 100, Ordering::SeqCst);
    f.get(&a).await.unwrap();
    f.now.store(START + 200, Ordering::SeqCst);
    f.get(&d).await.unwrap();
    assert!(f.pool.contains(&a) && f.pool.contains(&c) && f.pool.contains(&d));
    assert!(!f.pool.contains(&b));
    assert!(!f.root.join(&b[..2]).join(&b).exists());
    assert_eq!(f.pool.usage(), (3, 3000));

    // A file over the per-file limit (or the whole cap) is refused unstored.
    let small = fixture(PoolOptions {
        max_file_bytes: 100,
        ..PoolOptions::default()
    });
    let big = small.device.add(&[1u8; 101], false);
    assert_eq!(small.get(&big).await.unwrap_err(), PullError::TooLarge);
    assert_eq!(small.pool.usage(), (0, 0));
}

#[tokio::test]
async fn restart_drops_half_written_and_sidecarless_files() {
    let f = fixture(PoolOptions::default());
    let kept = f.device.add(b"kept", false);
    f.get(&kept).await.unwrap();
    // A crash left a temp file, a file without sidecar, and an orphan sidecar.
    std::fs::write(f.root.join("tmp").join("partial"), b"half").unwrap();
    let orphan = sha(b"orphan");
    std::fs::create_dir_all(f.root.join(&orphan[..2])).unwrap();
    std::fs::write(f.root.join(&orphan[..2]).join(&orphan), b"orphan").unwrap();
    let lonely = sha(b"lonely");
    std::fs::create_dir_all(f.root.join(&lonely[..2])).unwrap();
    std::fs::write(
        f.root.join(&lonely[..2]).join(format!("{lonely}.meta")),
        b"{}",
    )
    .unwrap();
    let reopened = f.reopen(PoolOptions::default());
    assert_eq!(reopened.usage(), (1, 4));
    assert!(reopened.lookup(&kept).await.is_some());
    assert!(reopened.lookup(&orphan).await.is_none());
    assert!(!f.root.join(&orphan[..2]).join(&orphan).exists());
    assert!(!f
        .root
        .join(&lonely[..2])
        .join(format!("{lonely}.meta"))
        .exists());
    assert_eq!(std::fs::read_dir(f.root.join("tmp")).unwrap().count(), 0);
}

#[tokio::test]
async fn pulls_are_rate_limited_per_account_and_old_devices_answer_explicitly() {
    let f = fixture(PoolOptions {
        pulls_per_account_per_minute: 2,
        ..PoolOptions::default()
    });
    let one = f.device.add(b"one", false);
    let two = f.device.add(b"two", false);
    let three = f.device.add(b"three", false);
    f.get(&one).await.unwrap();
    f.get(&two).await.unwrap();
    assert!(matches!(
        f.get(&three).await.unwrap_err(),
        PullError::Busy(_)
    ));
    // Hits are not pulls; another account has its own budget.
    f.get(&one).await.unwrap();
    assert!(f
        .pool
        .fetch(&three, "acct-b", "desk-b", &f.streams)
        .await
        .is_ok());

    // A device that does not know the opening (it treats the bytes as OBP
    // and echoes or closes) is an explicit "update it" answer.
    let g = fixture(PoolOptions::default());
    struct OldDevice;
    impl DeviceStreams for OldDevice {
        fn open<'a>(
            &'a self,
            _account_id: &'a str,
            _device_id: &'a str,
        ) -> BoxFuture<'a, Result<Box<dyn DeviceIo>, StreamError>> {
            Box::pin(async {
                let (near, mut far) = tokio::io::duplex(1024);
                tokio::spawn(async move {
                    let mut buffer = [0u8; 64];
                    let _ = far.read(&mut buffer).await;
                    // A TLS alert, then close (the listener took it for TLS).
                    let _ = far
                        .write_all(&[0x15, 0x03, 0x03, 0x00, 0x02, 0x02, 0x28])
                        .await;
                    drop(far);
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
    let old = Arc::new(OldDevice) as Arc<dyn DeviceStreams>;
    match g.pool.fetch(&one, "acct-a", "desk-a", &old).await {
        Err(PullError::BadAnswer(message)) => assert!(message.contains("update"), "{message}"),
        other => panic!("unexpected: {:?}", other.map(|_| ())),
    }
    // An unreachable device.
    *g.device.fail.lock().unwrap() = Some(StreamError::Unreachable("mesh_unreachable".into()));
    assert!(matches!(
        g.get(&one).await.unwrap_err(),
        PullError::Unreachable(_)
    ));
}

#[test]
fn hashes_are_64_lowercase_hex() {
    assert!(valid_hash(&"a".repeat(64)));
    assert!(!valid_hash(&"A".repeat(64)));
    assert!(!valid_hash(&"a".repeat(63)));
    assert!(!valid_hash(&format!("../{}", "a".repeat(61))));
}

#[tokio::test]
async fn a_busy_device_is_retried_and_one_without_a_bundle_says_so() {
    let f = fixture(PoolOptions {
        busy_backoff: Duration::from_millis(10),
        ..PoolOptions::default()
    });
    let hash = f.device.add(b"after the device had a free slot", false);
    f.device.busy_answers.store(2, Ordering::SeqCst);
    assert_eq!(
        f.get(&hash).await.unwrap().0,
        b"after the device had a free slot"
    );
    assert_eq!(f.device.opens.load(Ordering::SeqCst), 3);
    // Always busy: reported busy after the retries, nothing stored.
    let other = f.device.add(b"other", false);
    f.device.busy_answers.store(100, Ordering::SeqCst);
    assert_eq!(f.get(&other).await.unwrap_err(), PullError::DeviceBusy);
    assert_eq!(f.device.opens.load(Ordering::SeqCst), 3 + 4);
    assert!(!f.pool.contains(&other));
    // No bundle on the device: explicit, not retried.
    f.device.busy_answers.store(0, Ordering::SeqCst);
    f.device.no_bundle.store(true, Ordering::SeqCst);
    let opens = f.device.opens.load(Ordering::SeqCst);
    assert_eq!(f.get(&other).await.unwrap_err(), PullError::NoBundle);
    assert_eq!(f.device.opens.load(Ordering::SeqCst), opens + 1);
}

#[tokio::test]
async fn pool_rate_limit_does_not_wipe_active_accounts_at_capacity() {
    let f = fixture(PoolOptions {
        pulls_per_account_per_minute: 2,
        ..PoolOptions::default()
    });
    *f.pool.rates.lock().unwrap() = RateWindow::with_limits(2, Duration::from_secs(60));
    let a1 = f.device.add(b"a1", false);
    let a2 = f.device.add(b"a2", false);
    let a3 = f.device.add(b"a3", false);
    let b1 = f.device.add(b"b1", false);
    let c1 = f.device.add(b"c1", false);

    // Exhaust acct-a (2 pulls) and occupy the 2nd key slot with acct-b.
    f.pool
        .fetch(&a1, "acct-a", "desk-a", &f.streams)
        .await
        .unwrap();
    f.pool
        .fetch(&a2, "acct-a", "desk-a", &f.streams)
        .await
        .unwrap();
    f.pool
        .fetch(&b1, "acct-b", "desk-b", &f.streams)
        .await
        .unwrap();

    // A 3rd distinct account is refused while the window table is full of active keys,
    // and acct-a's exhausted counter is NOT wiped.
    assert!(matches!(
        f.pool.fetch(&c1, "acct-c", "desk-c", &f.streams).await,
        Err(PullError::Busy(_))
    ));
    assert!(matches!(
        f.pool.fetch(&a3, "acct-a", "desk-a", &f.streams).await,
        Err(PullError::Busy(_))
    ));
}

#[tokio::test]
async fn eviction_skips_victim_recommitted_while_waiting_for_shard_lock() {
    let f = fixture(PoolOptions {
        max_total_bytes: 2000,
        ..PoolOptions::default()
    });
    let a = f.device.add(&[b'a'; 1000], false);
    let b = f.device.add(&[b'b'; 1000], false);
    let c = f.device.add(&[b'c'; 1000], false);

    f.now.store(START + 10, Ordering::SeqCst);
    f.get(&a).await.unwrap();
    f.now.store(START + 20, Ordering::SeqCst);
    f.get(&b).await.unwrap();

    // Hold `a`'s shard lock so `evict_to_cap` (which selects oldest `a`) must
    // wait on `a`'s shard lock before removing/deleting `a`.
    let a_guard = f.pool.hash_lock(&a).lock().await;
    f.now.store(START + 30, Ordering::SeqCst);
    let temp = f.pool.temp_path();
    tokio::fs::write(&temp, [b'c'; 1000]).await.unwrap();
    // Commit `c` only if `c` is on a different shard from `a`; insert `c`
    // directly if it happened to collide with `a`'s shard.
    let evict_task = {
        let pool = Arc::clone(&f.pool);
        let c_hash = c.clone();
        if &c[..2] != &a[..2] {
            tokio::spawn(async move {
                pool.commit(&c_hash, &temp, 1000, false).await.unwrap();
            })
        } else {
            tokio::fs::create_dir_all(f.root.join(&c[..2]))
                .await
                .unwrap();
            let entry = Entry {
                size: 1000,
                br: false,
                stored_at: START + 30,
                last_used: START + 30,
                persisted_last_used: START + 30,
                generation: 0,
            };
            f.pool.write_meta(&c, &meta_of(&entry)).await.unwrap();
            tokio::fs::rename(&temp, f.pool.path_of(&c)).await.unwrap();
            f.pool.index.lock().unwrap().insert(c.clone(), entry);
            tokio::spawn(async move {
                pool.evict_to_cap(&c_hash).await;
            })
        }
    };
    tokio::time::sleep(Duration::from_millis(30)).await;

    // Simulate a concurrent re-commit of `a` while `evict_to_cap` waited for
    // `a`'s shard lock: `a` gets a newer generation and `last_used`.
    {
        let mut index = f.pool.index.lock().unwrap();
        index.insert(
            a.clone(),
            Entry {
                size: 1000,
                br: false,
                stored_at: START + 40,
                last_used: START + 40,
                persisted_last_used: START + 40,
                generation: 0,
            },
        );
    }
    drop(a_guard);
    evict_task.await.unwrap();

    // `a` must still be indexed AND present on disk; `b` (now oldest) was evicted instead.
    assert!(f.pool.contains(&a));
    assert!(f.pool.contains(&c));
    assert!(!f.pool.contains(&b));
    assert!(f.pool.path_of(&a).is_file());
    assert!(f.pool.meta_path_of(&a).is_file());
    assert!(!f.pool.path_of(&b).exists());
    assert!(!f.pool.meta_path_of(&b).exists());
    assert_eq!(f.pool.usage(), (2, 2000));
}

#[tokio::test]
async fn eviction_vs_recommit_and_touch_race_keeps_index_and_disk_consistent() {
    let f = fixture(PoolOptions {
        max_total_bytes: 300,
        touch_interval: Duration::from_secs(0),
        pulls_per_account_per_minute: 10_000,
        concurrent_pulls_per_account: 16,
        concurrent_pulls: 32,
        ..PoolOptions::default()
    });
    let hashes: Vec<String> = (0u8..10)
        .map(|i| f.device.add(&vec![i; 100], false))
        .collect();

    let mut tasks = Vec::new();
    for worker in 0..8usize {
        let pool = Arc::clone(&f.pool);
        let streams = Arc::clone(&f.streams);
        let now = Arc::clone(&f.now);
        let hashes = hashes.clone();
        tasks.push(tokio::spawn(async move {
            for step in 0..25usize {
                now.fetch_add(1, Ordering::SeqCst);
                let hash = &hashes[(worker * 7 + step) % hashes.len()];
                if let Ok(mut stored) = pool.fetch(hash, "acct-a", "desk-a", &streams).await {
                    let mut buf = Vec::new();
                    let _ = stored.file.read_to_end(&mut buf).await;
                    assert_eq!(buf.len(), 100);
                }
                if step % 5 == 0 {
                    let _ = pool.lookup(hash).await;
                }
            }
        }));
    }
    for task in tasks {
        task.await.unwrap();
    }

    // Verify full index <-> disk consistency and zero orphaned files.
    let (indexed_hashes, indexed_total) = {
        let index = f.pool.index.lock().unwrap();
        assert_eq!(index.by_age.len(), index.entries.len());
        let sum: u64 = index.entries.values().map(|e| e.size).sum();
        assert_eq!(sum, index.total);
        assert!(index.total <= 300, "total {} exceeded cap", index.total);
        (
            index
                .entries
                .keys()
                .cloned()
                .collect::<std::collections::HashSet<_>>(),
            index.total,
        )
    };
    for hash in &indexed_hashes {
        let data = std::fs::read(f.pool.path_of(hash)).expect("indexed data file exists");
        assert_eq!(sha(&data), *hash);
        assert!(
            f.pool.meta_path_of(hash).is_file(),
            "indexed meta file exists"
        );
    }
    // Walk shard directories and ensure no orphaned file or sidecar remains.
    let mut disk_data_files = 0usize;
    for shard in std::fs::read_dir(&f.root).unwrap().flatten() {
        let name = shard.file_name().to_string_lossy().to_string();
        if name == "tmp" || !shard.path().is_dir() {
            continue;
        }
        for entry in std::fs::read_dir(shard.path()).unwrap().flatten() {
            let fname = entry.file_name().to_string_lossy().to_string();
            if let Some(hash) = fname.strip_suffix(".meta") {
                assert!(
                    indexed_hashes.contains(hash),
                    "orphaned sidecar on disk: {hash}"
                );
            } else {
                assert!(
                    indexed_hashes.contains(&fname),
                    "orphaned data file on disk: {fname}"
                );
                disk_data_files += 1;
            }
        }
    }
    assert_eq!(disk_data_files, indexed_hashes.len());
    let reopened = f.reopen(PoolOptions {
        max_total_bytes: 300,
        ..PoolOptions::default()
    });
    assert_eq!(reopened.usage(), (indexed_hashes.len(), indexed_total));
}

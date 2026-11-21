//! The web UI pool: an untrusted, content-addressed cache of the files of the
//! web UI bundles devices ship (`/cas/<sha256>`, contract
//! "browsers load the web UI from the device they control").
//!
//! A browser runs the exact bundle its device ships. Its Service Worker
//! fetches each file by hash from here and verifies it against the manifest
//! it got from the device over the end-to-end channel, so nothing in this
//! pool is trusted: a file with one hash is stored once, for every account
//! and device.
//!
//! - **Hit:** the stored bytes (a `.br` entry with `Content-Encoding: br`).
//! - **Miss:** pulled through from the requesting browser's own device over
//!   a Link stream (`GET /obp-ui/v1/<sha256>`), hashed **before** it is
//!   stored, written atomically (temp file + rename). Concurrent misses for
//!   one hash share one pull. A mismatch is never stored. When that device
//!   cannot serve it, the other holders the browser names (online account
//!   devices with the same bundle, `fleet_ui_bundle`) are tried in order.
//! - **Layout:** `<root>/<aa>/<sha256>` (the bytes) and
//!   `<root>/<aa>/<sha256>.meta` (encoding, size, last use); temp files in
//!   `<root>/tmp/`.
//! - **Limits:** a per-file size limit, a total cap (oldest-unused evicted
//!   first), pulls per account per minute, and concurrent pulls per account
//!   and in total.
//! - **Last use** is recorded on every hit or store; the sidecar is rewritten
//!   at most once per `touch_interval`. A daily cleanup deletes files not
//!   used for `max_age`.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use futures::future::{FutureExt, Shared};
use serde::{Deserialize, Serialize};
use sha2::Digest;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::Semaphore;

use crate::upstream::{BoxFuture, DeviceStreams, StreamError};

/// Unix seconds now (mockable in tests).
pub(crate) type Clock = Arc<dyn Fn() -> i64 + Send + Sync>;

/// The system clock.
pub(crate) fn system_clock() -> Clock {
    Arc::new(|| {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|elapsed| elapsed.as_secs() as i64)
            .unwrap_or_default()
    })
}

/// Pool tunables.
#[derive(Debug, Clone)]
pub(crate) struct PoolOptions {
    /// Largest file the pool stores.
    pub(crate) max_file_bytes: u64,
    /// Total bytes stored; the oldest-unused files are evicted first.
    pub(crate) max_total_bytes: u64,
    /// A file not used for this long is deleted by the cleanup.
    pub(crate) max_age: Duration,
    /// The sidecar's last use is rewritten at most this often per file.
    pub(crate) touch_interval: Duration,
    /// Pulls an account may start per minute.
    pub(crate) pulls_per_account_per_minute: u32,
    /// Pulls of one account running at the same time (the rest wait).
    pub(crate) concurrent_pulls_per_account: usize,
    /// Pulls running at the same time, all accounts (the rest wait).
    pub(crate) concurrent_pulls: usize,
    /// How long a pull waits for a free slot.
    pub(crate) queue_timeout: Duration,
    /// The first wait before retrying a device at its concurrency cap
    /// (then twice, three times as long).
    pub(crate) busy_backoff: Duration,
    /// How long opening the Link stream to the device may take.
    pub(crate) open_timeout: Duration,
    /// The longest silence while reading the device's answer.
    pub(crate) read_timeout: Duration,
    /// The longest a whole pull may take.
    pub(crate) pull_timeout: Duration,
}

impl Default for PoolOptions {
    fn default() -> Self {
        Self {
            max_file_bytes: 64 * 1024 * 1024,
            max_total_bytes: 4 * 1024 * 1024 * 1024,
            max_age: Duration::from_secs(30 * 24 * 60 * 60),
            touch_interval: Duration::from_secs(60 * 60),
            pulls_per_account_per_minute: 240,
            concurrent_pulls_per_account: 4,
            concurrent_pulls: 64,
            queue_timeout: Duration::from_secs(60),
            busy_backoff: Duration::from_millis(500),
            open_timeout: Duration::from_secs(25),
            read_timeout: Duration::from_secs(30),
            pull_timeout: Duration::from_secs(10 * 60),
        }
    }
}

/// Why a file could not be served.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum PullError {
    /// The device's current bundle has no file with this hash.
    NotInBundle,
    /// The device sent bytes whose hash is not the requested one.
    Mismatch,
    /// The file is larger than the pool stores.
    TooLarge,
    /// Too many pulls for this account or in total; retry later.
    Busy(String),
    /// The device is at its own concurrency cap (retried, then reported busy).
    DeviceBusy,
    /// The device ships no web UI (`ui_bundle_unavailable`).
    NoBundle,
    /// The device is not on the account network or did not answer.
    Unreachable(String),
    /// The device answered something that is not a UI file answer.
    BadAnswer(String),
    /// The pool or the account network cannot be used now.
    Unavailable(String),
}

impl PullError {
    /// Whether another device of the account may still serve the file: this
    /// one lacks it, ships no bundle, is busy or unreachable, or lied. Limits
    /// of the pool itself (size, rate, storage) hold for every device.
    fn next_holder_may_help(&self) -> bool {
        matches!(
            self,
            Self::NotInBundle
                | Self::Mismatch
                | Self::DeviceBusy
                | Self::NoBundle
                | Self::Unreachable(_)
                | Self::BadAnswer(_)
        )
    }
}

/// A stored file, opened for reading.
pub(crate) struct Stored {
    pub(crate) size: u64,
    /// The bytes are a `.br` encoding (serve with `Content-Encoding: br`).
    pub(crate) br: bool,
    pub(crate) file: tokio::fs::File,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Encoding {
    Identity,
    Br,
}

/// The sidecar next to every stored file.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Meta {
    v: u32,
    encoding: Encoding,
    size: u64,
    stored_at: i64,
    last_used_at: i64,
}

#[derive(Debug, Clone)]
struct Entry {
    size: u64,
    br: bool,
    stored_at: i64,
    last_used: i64,
    /// The last use the sidecar holds.
    persisted_last_used: i64,
}

/// Who started a pull (a follower whose own device differs may retry).
#[derive(Debug, Clone, PartialEq, Eq)]
struct FlightKey {
    account_id: String,
    device_id: String,
}

type Flight = Shared<BoxFuture<'static, Result<(), PullError>>>;

struct RateWindow {
    started: Instant,
    counts: HashMap<String, u32>,
}

/// Counts and bytes the cleanup removed.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct Cleanup {
    pub(crate) files: usize,
    pub(crate) bytes: u64,
}

/// The pool of one gateway process.
pub(crate) struct UiPool {
    root: PathBuf,
    options: PoolOptions,
    clock: Clock,
    index: Mutex<Index>,
    flights: Mutex<HashMap<String, (FlightKey, Flight)>>,
    rates: Mutex<RateWindow>,
    account_slots: Mutex<HashMap<String, Arc<Semaphore>>>,
    slots: Arc<Semaphore>,
    temp_ids: std::sync::atomic::AtomicU64,
}

#[derive(Default)]
struct Index {
    entries: HashMap<String, Entry>,
    total: u64,
}

/// A file's hash as the pool accepts it: 64 lowercase hex characters.
pub(crate) fn valid_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

const OLD_DEVICE: &str = "the device does not serve UI files (update OpenBitFun on it)";

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn io_unavailable(error: std::io::Error) -> PullError {
    log::warn!("UI pool storage error: {}", error);
    PullError::Unavailable("the UI pool cannot store files right now".into())
}

impl UiPool {
    /// Opens (or creates) the pool at `root` and rebuilds its index from
    /// what is on disk. Half-written temp files and files without a valid
    /// sidecar are deleted (the pool is a cache).
    pub(crate) fn open(
        root: &Path,
        options: PoolOptions,
        clock: Clock,
    ) -> std::io::Result<Arc<Self>> {
        std::fs::create_dir_all(root.join("tmp"))?;
        if let Ok(entries) = std::fs::read_dir(root.join("tmp")) {
            for entry in entries.flatten() {
                let _ = std::fs::remove_file(entry.path());
            }
        }
        let mut index = Index::default();
        let mut dropped = 0usize;
        for shard in std::fs::read_dir(root)?.flatten() {
            let name = shard.file_name().to_string_lossy().to_string();
            if name == "tmp" || !shard.path().is_dir() {
                continue;
            }
            if name.len() != 2 || !name.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')) {
                continue;
            }
            for file in std::fs::read_dir(shard.path())?.flatten() {
                let file_name = file.file_name().to_string_lossy().to_string();
                let path = file.path();
                if let Some(hash) = file_name.strip_suffix(".meta") {
                    // A sidecar whose file is gone.
                    if !valid_hash(hash) || !path.with_file_name(hash).is_file() {
                        let _ = std::fs::remove_file(&path);
                    }
                    continue;
                }
                if !valid_hash(&file_name) || !file_name.starts_with(&name) {
                    continue;
                }
                let size = file.metadata().map(|meta| meta.len()).unwrap_or(u64::MAX);
                let meta = std::fs::read(path.with_file_name(format!("{file_name}.meta")))
                    .ok()
                    .and_then(|bytes| serde_json::from_slice::<Meta>(&bytes).ok())
                    .filter(|meta| meta.v == 1 && meta.size == size);
                let Some(meta) = meta else {
                    dropped += 1;
                    let _ = std::fs::remove_file(&path);
                    let _ = std::fs::remove_file(path.with_file_name(format!("{file_name}.meta")));
                    continue;
                };
                index.total += size;
                index.entries.insert(
                    file_name,
                    Entry {
                        size,
                        br: meta.encoding == Encoding::Br,
                        stored_at: meta.stored_at,
                        last_used: meta.last_used_at,
                        persisted_last_used: meta.last_used_at,
                    },
                );
            }
        }
        log::info!(
            "UI pool opened: files={}, bytes={}, dropped_incomplete={}, cap_bytes={}",
            index.entries.len(),
            index.total,
            dropped,
            options.max_total_bytes
        );
        Ok(Arc::new(Self {
            root: root.to_path_buf(),
            slots: Arc::new(Semaphore::new(options.concurrent_pulls.max(1))),
            options,
            clock,
            index: Mutex::new(index),
            flights: Mutex::new(HashMap::new()),
            rates: Mutex::new(RateWindow {
                started: Instant::now(),
                counts: HashMap::new(),
            }),
            account_slots: Mutex::new(HashMap::new()),
            temp_ids: std::sync::atomic::AtomicU64::new(1),
        }))
    }

    fn path_of(&self, hash: &str) -> PathBuf {
        self.root.join(&hash[..2]).join(hash)
    }

    fn meta_path_of(&self, hash: &str) -> PathBuf {
        self.root.join(&hash[..2]).join(format!("{hash}.meta"))
    }

    fn temp_path(&self) -> PathBuf {
        let id = self
            .temp_ids
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let mut random = [0u8; 6];
        rand::RngCore::fill_bytes(&mut rand::rngs::OsRng, &mut random);
        self.root
            .join("tmp")
            .join(format!("{}-{id}-{}", std::process::id(), hex(&random)))
    }

    /// Files and bytes stored now.
    pub(crate) fn usage(&self) -> (usize, u64) {
        let index = self.index.lock().unwrap_or_else(|e| e.into_inner());
        (index.entries.len(), index.total)
    }

    /// Whether `hash` is stored.
    #[cfg(test)]
    pub(crate) fn contains(&self, hash: &str) -> bool {
        self.index
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .entries
            .contains_key(hash)
    }

    /// Records a use of `hash` now; rewrites the sidecar when the one on
    /// disk is older than `touch_interval`.
    async fn touch(&self, hash: &str) {
        let now = (self.clock)();
        let rewrite = {
            let mut index = self.index.lock().unwrap_or_else(|e| e.into_inner());
            let Some(entry) = index.entries.get_mut(hash) else {
                return;
            };
            entry.last_used = entry.last_used.max(now);
            if now.saturating_sub(entry.persisted_last_used)
                < self.options.touch_interval.as_secs() as i64
            {
                return;
            }
            entry.persisted_last_used = entry.last_used;
            meta_of(entry)
        };
        if let Err(error) = self.write_meta(hash, &rewrite).await {
            log::debug!("UI pool could not record a last use: {}", error);
        }
    }

    async fn write_meta(&self, hash: &str, meta: &Meta) -> std::io::Result<()> {
        let temp = self.temp_path();
        tokio::fs::write(&temp, serde_json::to_vec(meta).expect("meta serializes")).await?;
        if let Err(error) = tokio::fs::rename(&temp, self.meta_path_of(hash)).await {
            let _ = tokio::fs::remove_file(&temp).await;
            return Err(error);
        }
        Ok(())
    }

    /// The stored file for `hash`, opened, and its use recorded.
    pub(crate) async fn lookup(&self, hash: &str) -> Option<Stored> {
        let (size, br) = {
            let index = self.index.lock().unwrap_or_else(|e| e.into_inner());
            let entry = index.entries.get(hash)?;
            (entry.size, entry.br)
        };
        match tokio::fs::File::open(self.path_of(hash)).await {
            Ok(file) => {
                self.touch(hash).await;
                Some(Stored { size, br, file })
            }
            Err(error) => {
                // Deleted under us (eviction or by hand): a miss.
                if error.kind() == std::io::ErrorKind::NotFound {
                    self.forget(hash);
                } else {
                    log::warn!("UI pool cannot open a stored file: {}", error);
                }
                None
            }
        }
    }

    fn forget(&self, hash: &str) {
        let mut index = self.index.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(entry) = index.entries.remove(hash) {
            index.total = index.total.saturating_sub(entry.size);
        }
    }

    fn allow_pull(&self, account_id: &str) -> bool {
        let mut rates = self.rates.lock().unwrap_or_else(|e| e.into_inner());
        if rates.started.elapsed() >= Duration::from_secs(60) || rates.counts.len() > 100_000 {
            rates.started = Instant::now();
            rates.counts.clear();
        }
        let count = rates.counts.entry(account_id.to_string()).or_insert(0);
        if *count >= self.options.pulls_per_account_per_minute {
            return false;
        }
        *count += 1;
        true
    }

    fn account_slot(&self, account_id: &str) -> Arc<Semaphore> {
        let mut slots = self.account_slots.lock().unwrap_or_else(|e| e.into_inner());
        if slots.len() > 1024 {
            // Accounts with no pull running.
            slots.retain(|_, slot| Arc::strong_count(slot) > 1);
        }
        Arc::clone(slots.entry(account_id.to_string()).or_insert_with(|| {
            Arc::new(Semaphore::new(
                self.options.concurrent_pulls_per_account.max(1),
            ))
        }))
    }

    /// The file for `hash`: stored, or pulled through from `device_id` of
    /// `account_id` (which the caller checked is one of the account's own
    /// hosts). Concurrent misses for one hash share one pull.
    pub(crate) async fn fetch(
        self: &Arc<Self>,
        hash: &str,
        account_id: &str,
        device_id: &str,
        streams: &Arc<dyn DeviceStreams>,
    ) -> Result<Stored, PullError> {
        if let Some(stored) = self.lookup(hash).await {
            return Ok(stored);
        }
        let own = FlightKey {
            account_id: account_id.to_string(),
            device_id: device_id.to_string(),
        };
        let mut retried = false;
        loop {
            let (leader, flight) = self.join_or_start(hash, &own, streams)?;
            let result = flight.await;
            if let Some(stored) = self.lookup(hash).await {
                return Ok(stored);
            }
            match result {
                // Stored, then evicted at once (a cap smaller than the
                // working set).
                Ok(()) => {
                    return Err(PullError::Unavailable(
                        "the UI pool is full; retry shortly".into(),
                    ))
                }
                // Another browser's device failed (or lied); this one's may
                // still have the file.
                Err(_) if leader != own && !retried => {
                    retried = true;
                    continue;
                }
                Err(error) => return Err(error),
            }
        }
    }

    /// The file for `hash`, pulled through from the first of `holders` that
    /// has it: the browser's own device first, then the other online devices
    /// of the account that ship the same bundle (`fleet_ui_bundle` names
    /// them). Every holder was checked by the caller to be one of the
    /// account's own hosts. A holder that does not have the file, cannot be
    /// reached, or answers wrongly is skipped; limits of the pool itself end
    /// the walk at once.
    pub(crate) async fn fetch_from_holders(
        self: &Arc<Self>,
        hash: &str,
        account_id: &str,
        holders: &[String],
        streams: &Arc<dyn DeviceStreams>,
    ) -> Result<Stored, PullError> {
        let mut last = PullError::Unreachable("no device holds this web UI".into());
        for (index, device_id) in holders.iter().enumerate() {
            match self.fetch(hash, account_id, device_id, streams).await {
                Ok(stored) => {
                    if index > 0 {
                        log::info!(
                            "UI pool pulled a file from another holder: device={}, tried={}",
                            device_id,
                            index + 1
                        );
                    }
                    return Ok(stored);
                }
                Err(error) if error.next_holder_may_help() => last = error,
                Err(error) => return Err(error),
            }
        }
        Err(last)
    }

    fn join_or_start(
        self: &Arc<Self>,
        hash: &str,
        own: &FlightKey,
        streams: &Arc<dyn DeviceStreams>,
    ) -> Result<(FlightKey, Flight), PullError> {
        let mut flights = self.flights.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((leader, flight)) = flights.get(hash) {
            return Ok((leader.clone(), flight.clone()));
        }
        // Stored by a pull that ended since the caller's lookup.
        if self
            .index
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .entries
            .contains_key(hash)
        {
            let ready: BoxFuture<'static, Result<(), PullError>> =
                Box::pin(futures::future::ready(Ok(())));
            return Ok((own.clone(), ready.shared()));
        }
        if !self.allow_pull(&own.account_id) {
            return Err(PullError::Busy(
                "too many UI files requested for this account; retry in a minute".into(),
            ));
        }
        let pool = Arc::clone(self);
        let streams = Arc::clone(streams);
        let key = own.clone();
        let task_hash = hash.to_string();
        // A task, so a browser that goes away does not cancel the pull the
        // others wait on.
        let task = tokio::spawn(async move {
            let result = pool
                .pull(&task_hash, &key.account_id, &key.device_id, &*streams)
                .await;
            pool.flights
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .remove(&task_hash);
            result
        });
        let flight: BoxFuture<'static, Result<(), PullError>> = Box::pin(async move {
            task.await.unwrap_or_else(|_| {
                Err(PullError::Unavailable(
                    "the UI pull stopped unexpectedly".into(),
                ))
            })
        });
        let flight = flight.shared();
        flights.insert(hash.to_string(), (own.clone(), flight.clone()));
        Ok((own.clone(), flight))
    }

    /// One pull: a slot, a Link stream, the device's answer hashed into a
    /// temp file, then the atomic store.
    async fn pull(
        &self,
        hash: &str,
        account_id: &str,
        device_id: &str,
        streams: &dyn DeviceStreams,
    ) -> Result<(), PullError> {
        let account_slot = self.account_slot(account_id);
        let queued = async {
            let account = account_slot.acquire_owned().await.ok()?;
            let total = Arc::clone(&self.slots).acquire_owned().await.ok()?;
            Some((account, total))
        };
        let Ok(Some(_permits)) = tokio::time::timeout(self.options.queue_timeout, queued).await
        else {
            return Err(PullError::Busy("the UI pool is busy; retry shortly".into()));
        };
        let started = Instant::now();
        // A device at its own concurrency cap answers 503: back off and
        // retry a few times on a new stream (one request per stream).
        let attempts = async {
            let mut attempt = 0u32;
            loop {
                match self.pull_inner(hash, device_id, account_id, streams).await {
                    Err(PullError::DeviceBusy) if attempt < 3 => {
                        attempt += 1;
                        tokio::time::sleep(self.options.busy_backoff * attempt).await;
                    }
                    other => return other,
                }
            }
        };
        let result = tokio::time::timeout(self.options.pull_timeout, attempts)
            .await
            .unwrap_or_else(|_| {
                Err(PullError::Unreachable(
                    "the device did not send the file in time".into(),
                ))
            });
        match &result {
            Ok((size, br)) => log::info!(
                "UI pool stored a file: device={}, bytes={}, br={}, pull_ms={}",
                device_id,
                size,
                br,
                started.elapsed().as_millis()
            ),
            Err(PullError::Mismatch) => log::warn!(
                "UI pool refused a file whose hash does not match: device={}, account={}",
                device_id,
                crate::app::account_label(account_id)
            ),
            Err(error) => log::info!(
                "UI pool pull failed: device={}, error={:?}",
                device_id,
                error
            ),
        }
        result.map(|_| ())
    }

    async fn pull_inner(
        &self,
        hash: &str,
        device_id: &str,
        account_id: &str,
        streams: &dyn DeviceStreams,
    ) -> Result<(u64, bool), PullError> {
        let mut io = match tokio::time::timeout(
            self.options.open_timeout,
            streams.open(account_id, device_id),
        )
        .await
        {
            Err(_) => {
                return Err(PullError::Unreachable(
                    "the device did not answer in time".into(),
                ))
            }
            Ok(Err(StreamError::Busy(message))) => return Err(PullError::Busy(message)),
            Ok(Err(StreamError::Unavailable(message))) => {
                return Err(PullError::Unavailable(message))
            }
            Ok(Err(StreamError::Unreachable(message))) => {
                return Err(PullError::Unreachable(message))
            }
            Ok(Ok(io)) => io,
        };
        let read_timeout = self.options.read_timeout;
        let request =
            format!("GET /obp-ui/v1/{hash} HTTP/1.1\r\nHost: obp-ui\r\nConnection: close\r\n\r\n");
        tokio::time::timeout(read_timeout, io.write_all(request.as_bytes()))
            .await
            .map_err(|_| PullError::Unreachable("the device did not take the request".into()))?
            .map_err(|_| PullError::Unreachable("the device closed the stream".into()))?;
        let _ = io.flush().await;

        // The head.
        let mut buffer = Vec::with_capacity(4096);
        let mut chunk = vec![0u8; 64 * 1024];
        let head_end = loop {
            if let Some(at) = buffer.windows(4).position(|w| w == b"\r\n\r\n") {
                break at + 4;
            }
            // An older device does not know the opening: it closes, or
            // answers with something that is not HTTP (a TLS alert).
            if buffer.len() >= 5 && !buffer.starts_with(b"HTTP/") {
                return Err(PullError::BadAnswer(OLD_DEVICE.into()));
            }
            if buffer.len() > 16 * 1024 {
                return Err(PullError::BadAnswer("answer head too large".into()));
            }
            let count = tokio::time::timeout(read_timeout, io.read(&mut chunk))
                .await
                .map_err(|_| PullError::Unreachable("the device stopped answering".into()))?
                .map_err(|_| PullError::Unreachable("the device closed the stream".into()))?;
            if count == 0 {
                // An older device that does not know the opening closes
                // without an HTTP answer.
                return Err(if !buffer.starts_with(b"HTTP/") {
                    PullError::BadAnswer(OLD_DEVICE.into())
                } else {
                    PullError::BadAnswer("the answer ended early".into())
                });
            }
            buffer.extend_from_slice(&chunk[..count]);
        };
        let head = parse_head(&buffer[..head_end])?;
        if head.status != 200 {
            // Every non-200 body is a short text/plain reason.
            let mut body = buffer[head_end..].to_vec();
            let want = head.content_length.unwrap_or(1024).min(1024) as usize;
            while body.len() < want {
                match tokio::time::timeout(read_timeout, io.read(&mut chunk)).await {
                    Ok(Ok(count)) if count > 0 => body.extend_from_slice(&chunk[..count]),
                    _ => break,
                }
            }
            let no_bundle = String::from_utf8_lossy(&body).starts_with("ui_bundle_unavailable");
            return Err(match head.status {
                // `ui_bundle_unavailable: <reason>`: the device ships no web UI.
                404 | 503 if no_bundle => PullError::NoBundle,
                404 => PullError::NotInBundle,
                // Every fetch slot of the device is busy (`Retry-After: 1`).
                503 => PullError::DeviceBusy,
                status => PullError::BadAnswer(format!("the device answered HTTP {status}")),
            });
        }
        let br = match head.content_encoding.as_deref() {
            None => false,
            Some(value) if value.eq_ignore_ascii_case("identity") => false,
            Some(value) if value.eq_ignore_ascii_case("br") => true,
            Some(_) => {
                return Err(PullError::BadAnswer(
                    "the device sent an unsupported Content-Encoding".into(),
                ))
            }
        };
        let length = head
            .content_length
            .ok_or_else(|| PullError::BadAnswer("the answer has no Content-Length".into()))?;
        if length > self.options.max_file_bytes || length > self.options.max_total_bytes {
            return Err(PullError::TooLarge);
        }

        // The body, hashed into a temp file.
        let temp = self.temp_path();
        let mut file = tokio::fs::File::create(&temp)
            .await
            .map_err(io_unavailable)?;
        let outcome: Result<(), PullError> = async {
            let mut hasher = sha2::Sha256::new();
            let mut received = 0u64;
            let early = &buffer[head_end..];
            let early = &early[..early.len().min(length as usize)];
            hasher.update(early);
            file.write_all(early).await.map_err(io_unavailable)?;
            received += early.len() as u64;
            while received < length {
                let want = ((length - received) as usize).min(chunk.len());
                let count = tokio::time::timeout(read_timeout, io.read(&mut chunk[..want]))
                    .await
                    .map_err(|_| PullError::Unreachable("the device stopped sending".into()))?
                    .map_err(|_| PullError::Unreachable("the device closed the stream".into()))?;
                if count == 0 {
                    return Err(PullError::BadAnswer("the file ended early".into()));
                }
                hasher.update(&chunk[..count]);
                file.write_all(&chunk[..count])
                    .await
                    .map_err(io_unavailable)?;
                received += count as u64;
            }
            if hex(&hasher.finalize()) != hash {
                return Err(PullError::Mismatch);
            }
            file.sync_all().await.map_err(io_unavailable)?;
            Ok(())
        }
        .await;
        drop(file);
        drop(io);
        if let Err(error) = outcome {
            let _ = tokio::fs::remove_file(&temp).await;
            return Err(error);
        }
        if let Err(error) = self.commit(hash, &temp, length, br).await {
            let _ = tokio::fs::remove_file(&temp).await;
            return Err(error);
        }
        Ok((length, br))
    }

    /// Moves a verified temp file into place (sidecar first, so a stored
    /// file always has one), then evicts the oldest-unused files over the cap.
    async fn commit(&self, hash: &str, temp: &Path, size: u64, br: bool) -> Result<(), PullError> {
        let now = (self.clock)();
        let entry = Entry {
            size,
            br,
            stored_at: now,
            last_used: now,
            persisted_last_used: now,
        };
        tokio::fs::create_dir_all(self.root.join(&hash[..2]))
            .await
            .map_err(io_unavailable)?;
        self.write_meta(hash, &meta_of(&entry))
            .await
            .map_err(io_unavailable)?;
        tokio::fs::rename(temp, self.path_of(hash))
            .await
            .map_err(io_unavailable)?;
        let evicted = {
            let mut index = self.index.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(old) = index.entries.insert(hash.to_string(), entry) {
                index.total = index.total.saturating_sub(old.size);
            }
            index.total += size;
            let mut evicted = Vec::new();
            if index.total > self.options.max_total_bytes {
                let mut by_age: Vec<(i64, String)> = index
                    .entries
                    .iter()
                    .filter(|(other, _)| other.as_str() != hash)
                    .map(|(other, entry)| (entry.last_used, other.clone()))
                    .collect();
                by_age.sort();
                for (_, other) in by_age {
                    if index.total <= self.options.max_total_bytes {
                        break;
                    }
                    if let Some(entry) = index.entries.remove(&other) {
                        index.total = index.total.saturating_sub(entry.size);
                        evicted.push((other, entry.size));
                    }
                }
            }
            evicted
        };
        if !evicted.is_empty() {
            let bytes: u64 = evicted.iter().map(|(_, size)| size).sum();
            for (other, _) in &evicted {
                self.delete_files(other).await;
            }
            log::info!(
                "UI pool evicted files over the cap: files={}, bytes={}",
                evicted.len(),
                bytes
            );
        }
        Ok(())
    }

    async fn delete_files(&self, hash: &str) {
        let _ = tokio::fs::remove_file(self.path_of(hash)).await;
        let _ = tokio::fs::remove_file(self.meta_path_of(hash)).await;
    }

    /// Deletes every file not used for `max_age`; returns what it removed.
    pub(crate) async fn cleanup(&self) -> Cleanup {
        let cutoff = (self.clock)() - self.options.max_age.as_secs() as i64;
        let removed: Vec<(String, u64)> = {
            let mut index = self.index.lock().unwrap_or_else(|e| e.into_inner());
            let stale: Vec<String> = index
                .entries
                .iter()
                .filter(|(_, entry)| entry.last_used <= cutoff)
                .map(|(hash, _)| hash.clone())
                .collect();
            stale
                .into_iter()
                .filter_map(|hash| {
                    let entry = index.entries.remove(&hash)?;
                    index.total = index.total.saturating_sub(entry.size);
                    Some((hash, entry.size))
                })
                .collect()
        };
        let mut result = Cleanup::default();
        for (hash, size) in removed {
            self.delete_files(&hash).await;
            result.files += 1;
            result.bytes += size;
        }
        let (files, bytes) = self.usage();
        log::info!(
            "UI pool cleanup: deleted_files={}, deleted_bytes={}, kept_files={}, kept_bytes={}",
            result.files,
            result.bytes,
            files,
            bytes
        );
        result
    }

    /// Runs `cleanup` now and then every `every`, for the process lifetime.
    pub(crate) fn spawn_cleanup(self: &Arc<Self>, every: Duration) -> tokio::task::JoinHandle<()> {
        let pool = Arc::clone(self);
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(every);
            loop {
                interval.tick().await;
                pool.cleanup().await;
            }
        })
    }
}

fn meta_of(entry: &Entry) -> Meta {
    Meta {
        v: 1,
        encoding: if entry.br {
            Encoding::Br
        } else {
            Encoding::Identity
        },
        size: entry.size,
        stored_at: entry.stored_at,
        last_used_at: entry.last_used,
    }
}

struct Head {
    status: u16,
    content_length: Option<u64>,
    content_encoding: Option<String>,
}

fn parse_head(bytes: &[u8]) -> Result<Head, PullError> {
    let text = std::str::from_utf8(bytes)
        .map_err(|_| PullError::BadAnswer("the answer head is not text".into()))?;
    let mut lines = text.split("\r\n");
    let status_line = lines.next().unwrap_or_default();
    let mut parts = status_line.splitn(3, ' ');
    let version = parts.next().unwrap_or_default();
    if !version.starts_with("HTTP/1.") {
        return Err(PullError::BadAnswer(OLD_DEVICE.into()));
    }
    let status = parts
        .next()
        .and_then(|code| code.parse::<u16>().ok())
        .ok_or_else(|| PullError::BadAnswer("the answer has no status".into()))?;
    let mut head = Head {
        status,
        content_length: None,
        content_encoding: None,
    };
    for line in lines {
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        let value = value.trim();
        if name.trim().eq_ignore_ascii_case("content-length") {
            head.content_length = Some(
                value
                    .parse::<u64>()
                    .map_err(|_| PullError::BadAnswer("bad Content-Length".into()))?,
            );
        } else if name.trim().eq_ignore_ascii_case("content-encoding") {
            head.content_encoding = Some(value.to_string());
        }
    }
    Ok(head)
}

#[cfg(test)]
pub(crate) mod tests;

//! The fleet index: one single-writer partition per device.
//!
//! A partition comes only from its owner (no gossip), keyed by the owner's
//! `(instanceId, revision)`: a delta applies only on top of the revision it
//! was computed from, on the same owner instance; anything else asks for a
//! full snapshot. Every bound of the contract is applied on write, since a
//! partition from a peer is never trusted to be bounded.
//!
//! The index survives restarts through a tolerant cache at
//! `<data>/fleet/index.json`: each device record is read on its own, unknown
//! fields are ignored, and an unreadable file is kept aside (never deleted)
//! before the next write. A device whose owner cannot be reached keeps its
//! partition, marked with the state and the time it was last confirmed.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};

use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{json, Value};

use openbitfun_product_domains::fleet::*;
use openbitfun_product_domains::remote_surface::FleetEntity;

use super::sync::{FleetPeerLinkInfo, FleetPeerPresence};
use super::FleetEventSink;

/// Version of the cache file this build writes.
pub const INDEX_CACHE_VERSION: u32 = 1;
/// File name of the cache under `<data>/fleet/`.
pub const INDEX_CACHE_FILE: &str = "index.json";
/// Removed devices remembered for navigator deltas.
const MAX_REMOVED_HISTORY: usize = 256;

/// `<data>/fleet/index.json`.
pub fn index_cache_path(data_dir: &Path) -> PathBuf {
    data_dir.join("fleet").join(INDEX_CACHE_FILE)
}

/// What applying an owner digest did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FleetApply {
    /// The partition now matches the owner (`changed` when its content did).
    Applied { changed: bool },
    /// An older revision than the one held; nothing changed.
    Ignored,
    /// The delta does not fit the held partition; pull a full snapshot.
    NeedFull { reason: &'static str },
}

/// How the last exchange with a device's owner went.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
enum LinkHealth {
    #[default]
    Unknown,
    Synced,
    Failing,
}

#[derive(Debug, Clone, Default)]
struct DeviceEntry {
    name: String,
    host_kind: FleetHostKind,
    is_self: bool,
    is_client_device: bool,
    version: Option<String>,
    route: Option<FleetDeviceRoute>,
    /// Presence as the host's mesh reports it; `None` until it did (a
    /// device loaded from the cache).
    online: Option<bool>,
    /// Reachable over OBP on the device network (false: relay-only host).
    mesh: bool,
    /// This host cannot link to the device at all (the presence reason).
    unsupported: Option<String>,
    health: LinkHealth,
    health_reason: Option<String>,
    link: Option<FleetPeerLinkInfo>,
    /// Indexed by polling (a mesh host without `fleet_v1`).
    legacy: bool,
    /// Self facts the host reported (fleet protocol, capabilities).
    self_facts: Option<FleetDeviceFacts>,
    cached_fleet_protocol: Option<u32>,
    cached_capabilities: Vec<String>,
    partition: Option<FleetDigest>,
    /// When the owner last confirmed the partition.
    fresh_at_ms: u64,
    /// Index revision of the last change of this device's projection.
    changed_revision: u64,
}

impl DeviceEntry {
    fn facts(&self, device_id: &str) -> FleetDeviceFacts {
        if let Some(own) = self.self_facts.as_ref().filter(|_| self.is_self) {
            return FleetDeviceFacts {
                device_id: device_id.to_string(),
                state: FleetDeviceState::Online,
                state_reason: None,
                as_of_ms: crate::now_ms(),
                ..own.clone()
            };
        }
        let (state, reason) = self.state();
        let fleet_protocol = match &self.link {
            Some(link) if link.serves_fleet() => Some(FLEET_PROTOCOL_VERSION),
            Some(_) => None,
            None => self.cached_fleet_protocol,
        };
        let host_capabilities = match &self.link {
            Some(link) => link.host_capabilities.clone(),
            None => self.cached_capabilities.clone(),
        };
        FleetDeviceFacts {
            device_id: device_id.to_string(),
            name: if self.name.is_empty() {
                device_id.to_string()
            } else {
                self.name.clone()
            },
            host_kind: self.host_kind,
            is_client_device: self.is_client_device,
            state,
            state_reason: reason,
            as_of_ms: self.fresh_at_ms,
            version: self
                .link
                .as_ref()
                .and_then(|link| link.version.clone())
                .or_else(|| self.version.clone()),
            fleet_protocol,
            host_capabilities,
            route: self.route.clone(),
        }
    }

    /// The device state, decided here (never by a frontend).
    fn state(&self) -> (FleetDeviceState, Option<String>) {
        let reason = |code: &str| Some(code.to_string());
        if let Some(code) = &self.unsupported {
            return (FleetDeviceState::Unknown, Some(code.clone()));
        }
        match self.online {
            None if self.partition.is_some() => (FleetDeviceState::Stale, reason("cached")),
            None => (FleetDeviceState::Offline, reason("presence_unknown")),
            Some(_) if !self.mesh => (FleetDeviceState::UpdateRequired, reason("relay_only_host")),
            Some(false) => (FleetDeviceState::Offline, reason("device_offline")),
            Some(true) => match self.health {
                LinkHealth::Synced => (FleetDeviceState::Online, None),
                // Present, but the held partition is not confirmed by its
                // owner yet (read from the cache, or from before an outage).
                LinkHealth::Unknown if self.partition.is_some() => {
                    (FleetDeviceState::Stale, reason("syncing"))
                }
                LinkHealth::Unknown => (FleetDeviceState::Online, None),
                LinkHealth::Failing => {
                    let why = self.health_reason.clone().or_else(|| reason("link_failed"));
                    if self.partition.is_some() {
                        (FleetDeviceState::Stale, why)
                    } else {
                        (FleetDeviceState::Unreachable, why)
                    }
                }
            },
        }
    }
}

#[derive(Default)]
struct IndexState {
    revision: u64,
    delta_floor: u64,
    devices: BTreeMap<String, DeviceEntry>,
    removed: Vec<(String, u64)>,
    dirty: bool,
    /// The cache file could not be read; it is moved aside before the next
    /// write instead of being overwritten.
    unreadable_cache: bool,
}

/// Events to publish once the lock is released.
#[derive(Default)]
struct Pending {
    index_changed: BTreeSet<String>,
    prompts_changed: BTreeSet<String>,
}

/// The fleet index of one runtime host.
pub struct FleetIndex {
    self_device_id: String,
    cache_path: Option<PathBuf>,
    sink: Option<Arc<dyn FleetEventSink>>,
    state: Mutex<IndexState>,
}

impl FleetIndex {
    /// An index for the host `self_device_id`, loading `cache_path` when it
    /// exists. Revisions start from the clock, so a client's revision from a
    /// previous process is never mistaken for one of this process.
    pub fn new(
        self_device_id: String,
        cache_path: Option<PathBuf>,
        sink: Option<Arc<dyn FleetEventSink>>,
    ) -> Arc<Self> {
        let start = crate::now_ms();
        let index = Arc::new(Self {
            self_device_id: self_device_id.clone(),
            cache_path,
            sink,
            state: Mutex::new(IndexState {
                revision: start,
                delta_floor: start,
                ..Default::default()
            }),
        });
        {
            let mut state = index.lock();
            state.devices.insert(
                self_device_id,
                DeviceEntry {
                    is_self: true,
                    is_client_device: true,
                    online: Some(true),
                    mesh: true,
                    health: LinkHealth::Synced,
                    changed_revision: start,
                    ..Default::default()
                },
            );
        }
        index.load_cache();
        index
    }

    fn lock(&self) -> MutexGuard<'_, IndexState> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// This host's device id.
    pub fn self_device_id(&self) -> &str {
        &self.self_device_id
    }

    /// The current index revision.
    pub fn revision(&self) -> u64 {
        self.lock().revision
    }

    /// The owner position of a device's partition: `(instanceId, revision)`.
    pub fn partition_cursor(&self, device_id: &str) -> Option<(String, u64)> {
        let state = self.lock();
        let partition = state.devices.get(device_id)?.partition.as_ref()?;
        Some((partition.instance_id.clone(), partition.revision))
    }

    /// A copy of a device's stored partition.
    pub fn partition(&self, device_id: &str) -> Option<FleetDigest> {
        self.lock().devices.get(device_id)?.partition.clone()
    }

    /// The facts of a device as the navigator shows them.
    pub fn device_facts(&self, device_id: &str) -> Option<FleetDeviceFacts> {
        let state = self.lock();
        state
            .devices
            .get(device_id)
            .map(|entry| entry.facts(device_id))
    }

    /// The devices of the index, in no particular order.
    pub fn device_ids(&self) -> Vec<String> {
        self.lock().devices.keys().cloned().collect()
    }

    fn bump(state: &mut IndexState, device_id: &str, pending: &mut Pending, prompts: bool) {
        state.dirty = true;
        state.revision += 1;
        let revision = state.revision;
        if let Some(entry) = state.devices.get_mut(device_id) {
            entry.changed_revision = revision;
        }
        pending.index_changed.insert(device_id.to_string());
        if prompts {
            pending.prompts_changed.insert(device_id.to_string());
        }
    }

    fn publish(&self, pending: Pending) {
        let Some(sink) = self.sink.as_ref() else {
            return;
        };
        if pending.index_changed.is_empty() && pending.prompts_changed.is_empty() {
            return;
        }
        let revision = self.revision();
        if !pending.index_changed.is_empty() {
            sink.emit(
                FLEET_INDEX_CHANGED_EVENT,
                json!(FleetIndexChanged {
                    revision,
                    device_ids: pending.index_changed.into_iter().collect(),
                }),
            );
        }
        for device_id in pending.prompts_changed {
            sink.emit(
                FLEET_PROMPTS_CHANGED_EVENT,
                json!(FleetPromptsChanged {
                    revision,
                    device_id,
                }),
            );
        }
    }

    /// Run `change` on the state; when the projection of a device changed,
    /// bump the revision and publish.
    fn change<R>(&self, change: impl FnOnce(&mut IndexState, &mut Pending) -> R) -> R {
        let mut pending = Pending::default();
        let result = {
            let mut state = self.lock();
            change(&mut state, &mut pending)
        };
        self.publish(pending);
        result
    }

    /// The facts this host reports about itself (name, kind, version,
    /// fleet protocol, host capabilities).
    pub fn set_self_facts(&self, facts: FleetDeviceFacts) {
        let self_id = self.self_device_id.clone();
        self.change(|state, pending| {
            let entry = state.devices.entry(self_id.clone()).or_default();
            let next = Some(facts.clone());
            if entry.self_facts == next {
                return;
            }
            entry.name = facts.name.clone();
            entry.host_kind = facts.host_kind;
            entry.is_client_device = facts.is_client_device;
            entry.self_facts = next;
            Self::bump(state, &self_id, pending, false);
        });
    }

    /// Apply the mesh presence of the other account devices. A device the
    /// list does not name keeps its partition and is shown offline; only
    /// [`FleetIndex::remove_device`] drops a device.
    pub fn set_presence(&self, presence: &[FleetPeerPresence]) {
        let self_id = self.self_device_id.clone();
        self.change(|state, pending| {
            let listed: BTreeSet<&str> = presence.iter().map(|p| p.device_id.as_str()).collect();
            for peer in presence {
                if peer.device_id == self_id || peer.device_id.is_empty() {
                    continue;
                }
                let entry = state.devices.entry(peer.device_id.clone()).or_default();
                let before = entry.facts(&peer.device_id);
                entry.name = peer.name.clone();
                entry.host_kind = peer.host_kind;
                entry.version = peer.version.clone().or(entry.version.take());
                entry.route = peer.route.clone();
                entry.mesh = peer.mesh;
                entry.unsupported = peer.unsupported.clone();
                if entry.online != Some(peer.online) {
                    entry.online = Some(peer.online);
                    if !peer.online {
                        // A fresh link is needed before it is synced again.
                        entry.health = LinkHealth::Unknown;
                        entry.health_reason = None;
                        entry.link = None;
                    }
                }
                if !peer.mesh {
                    entry.link = None;
                }
                if before != entry.facts(&peer.device_id) {
                    Self::bump(state, &peer.device_id, pending, false);
                }
            }
            let absent: Vec<String> = state
                .devices
                .iter()
                .filter(|(id, entry)| {
                    !entry.is_self && !listed.contains(id.as_str()) && entry.online.unwrap_or(true)
                })
                .map(|(id, _)| id.clone())
                .collect();
            for id in absent {
                if let Some(entry) = state.devices.get_mut(&id) {
                    entry.online = Some(false);
                    entry.link = None;
                    entry.health = LinkHealth::Unknown;
                }
                Self::bump(state, &id, pending, false);
            }
        });
    }

    /// A link to the device's owner is up (its `hello` facts).
    pub fn set_link(&self, device_id: &str, link: FleetPeerLinkInfo) {
        self.change(|state, pending| {
            let Some(entry) = state.devices.get_mut(device_id) else {
                return;
            };
            let before = entry.facts(device_id);
            entry.legacy = !link.serves_fleet();
            entry.cached_fleet_protocol = link.serves_fleet().then_some(FLEET_PROTOCOL_VERSION);
            entry.cached_capabilities = link.host_capabilities.clone();
            entry.link = Some(link);
            if before != entry.facts(device_id) {
                state.dirty = true;
                Self::bump(state, device_id, pending, false);
            }
        });
    }

    /// The link to the device's owner failed or closed; its partition is
    /// kept and shown stale (or the device unreachable without one).
    pub fn mark_link_failed(&self, device_id: &str, reason: &str) {
        self.change(|state, pending| {
            let Some(entry) = state.devices.get_mut(device_id) else {
                return;
            };
            if entry.is_self {
                return;
            }
            let before = entry.facts(device_id);
            entry.health = LinkHealth::Failing;
            entry.health_reason = Some(reason_code(reason));
            entry.link = None;
            if before != entry.facts(device_id) {
                Self::bump(state, device_id, pending, false);
            }
        });
    }

    /// Drop a device (it left the account). Explicit only: an unreachable
    /// or unparsable device is never removed.
    pub fn remove_device(&self, device_id: &str) -> bool {
        if device_id == self.self_device_id {
            return false;
        }
        self.change(|state, pending| {
            if state.devices.remove(device_id).is_none() {
                return false;
            }
            state.revision += 1;
            let revision = state.revision;
            state.removed.push((device_id.to_string(), revision));
            if state.removed.len() > MAX_REMOVED_HISTORY {
                let drop = state.removed.len() - MAX_REMOVED_HISTORY;
                let floor = state.removed[drop - 1].1;
                state.removed.drain(..drop);
                state.delta_floor = state.delta_floor.max(floor);
            }
            state.dirty = true;
            pending.index_changed.insert(device_id.to_string());
            pending.prompts_changed.insert(device_id.to_string());
            true
        })
    }

    /// Apply a digest from the device's owner (this host's own digest for
    /// the self device). `since` is the `sinceRevision` it was requested
    /// with. A full snapshot replaces the partition; a delta applies only on
    /// top of exactly that revision of the same owner instance.
    pub fn apply_digest(
        &self,
        device_id: &str,
        since: Option<u64>,
        digest: FleetDigest,
    ) -> FleetApply {
        let mut digest = digest;
        digest.device_id = device_id.to_string();
        if digest.instance_id.is_empty() {
            return FleetApply::NeedFull {
                reason: "digest_without_instance",
            };
        }
        self.change(|state, pending| {
            let Some(entry) = state.devices.get_mut(device_id) else {
                return FleetApply::Ignored;
            };
            let next = if digest.full {
                if let Some(held) = entry.partition.as_ref() {
                    if held.instance_id == digest.instance_id && digest.revision < held.revision {
                        return FleetApply::Ignored;
                    }
                }
                let mut next = digest;
                next.removed = FleetDigestRemovals::default();
                next
            } else {
                let Some(held) = entry.partition.as_ref() else {
                    return FleetApply::NeedFull {
                        reason: "no_partition",
                    };
                };
                if held.instance_id != digest.instance_id {
                    return FleetApply::NeedFull {
                        reason: "instance_changed",
                    };
                }
                if digest.revision < held.revision {
                    return FleetApply::Ignored;
                }
                if since != Some(held.revision) {
                    return FleetApply::NeedFull { reason: "gap" };
                }
                merge_delta(held, digest)
            };
            let mut next = next;
            normalize_partition(&mut next);
            bound_partition(&mut next);
            next.full = true;
            let before = entry.partition.take();
            let changed = before.as_ref().map(content_of) != Some(content_of(&next));
            let prompts_changed = before.as_ref().map(|p| &p.prompts) != Some(&next.prompts);
            let state_before = entry.facts(device_id);
            entry.partition = Some(next);
            entry.fresh_at_ms = crate::now_ms();
            entry.health = LinkHealth::Synced;
            entry.health_reason = None;
            let facts_changed = state_before.state != entry.facts(device_id).state;
            let is_self = entry.is_self;
            if changed || prompts_changed || facts_changed {
                state.dirty = true;
                Self::bump(state, device_id, pending, prompts_changed);
            } else if !is_self {
                // Confirmed fresh: the asOfMs moved, which only matters to
                // the cache.
                state.dirty = true;
            }
            FleetApply::Applied { changed }
        })
    }

    fn inputs<'a>(
        state: &'a IndexState,
        facts: &'a [(String, FleetDeviceFacts)],
    ) -> Vec<FleetDeviceInput<'a>> {
        facts
            .iter()
            .map(|(id, facts)| FleetDeviceInput {
                facts,
                partition: state.devices.get(id).and_then(|e| e.partition.as_ref()),
                changed_revision: state.devices.get(id).map_or(0, |e| e.changed_revision),
            })
            .collect()
    }

    /// The `fleet_navigator` answer.
    pub fn navigator(&self, since_revision: Option<u64>) -> FleetNavigator {
        let state = self.lock();
        let facts: Vec<(String, FleetDeviceFacts)> = state
            .devices
            .iter()
            .map(|(id, entry)| (id.clone(), entry.facts(id)))
            .collect();
        let input = FleetNavigatorInput {
            revision: state.revision,
            devices: Self::inputs(&state, &facts),
            removed: state.removed.clone(),
            delta_floor: state.delta_floor,
        };
        project_navigator(&input, since_revision)
    }

    /// The `fleet_prompts` answer.
    pub fn prompts(&self) -> FleetPromptsResponse {
        let state = self.lock();
        let facts: Vec<(String, FleetDeviceFacts)> = state
            .devices
            .iter()
            .map(|(id, entry)| (id.clone(), entry.facts(id)))
            .collect();
        project_prompts(state.revision, &Self::inputs(&state, &facts))
    }

    // -- cache --------------------------------------------------------------

    fn load_cache(&self) {
        let Some(path) = self.cache_path.as_ref() else {
            return;
        };
        let bytes = match std::fs::read(path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return,
            Err(error) => {
                log::warn!(
                    "Fleet index cache unreadable, keeping it: path={}, error={}",
                    path.display(),
                    error
                );
                self.lock().unreadable_cache = true;
                return;
            }
        };
        let file = match serde_json::from_slice::<IndexCacheFile>(&bytes) {
            Ok(file) => file,
            Err(error) => {
                log::warn!(
                    "Fleet index cache could not be parsed, keeping it aside: path={}, error={}",
                    path.display(),
                    error
                );
                self.lock().unreadable_cache = true;
                return;
            }
        };
        let mut skipped = 0usize;
        let mut state = self.lock();
        for record in file.devices {
            let Ok(device) = serde_json::from_value::<CachedDevice>(record) else {
                skipped += 1;
                continue;
            };
            if device.device_id.is_empty() || device.device_id == self.self_device_id {
                continue;
            }
            let mut partition = device.partition;
            if let Some(partition) = partition.as_mut() {
                partition.device_id = device.device_id.clone();
                partition.full = true;
                normalize_partition(partition);
                bound_partition(partition);
            }
            let changed_revision = state.revision;
            state.devices.insert(
                device.device_id.clone(),
                DeviceEntry {
                    name: device.name,
                    host_kind: device.host_kind,
                    version: device.version,
                    mesh: true,
                    legacy: device.legacy,
                    cached_fleet_protocol: device.fleet_protocol,
                    cached_capabilities: device.host_capabilities,
                    partition,
                    fresh_at_ms: device.as_of_ms,
                    changed_revision,
                    ..Default::default()
                },
            );
        }
        if skipped > 0 {
            log::warn!("Fleet index cache: skipped unreadable device records: count={skipped}");
        }
    }

    /// Write the cache when something changed since the last write.
    pub fn flush(&self) -> Result<(), String> {
        let Some(path) = self.cache_path.clone() else {
            return Ok(());
        };
        let (file, unreadable) = {
            let mut state = self.lock();
            if !state.dirty {
                return Ok(());
            }
            state.dirty = false;
            let unreadable = std::mem::take(&mut state.unreadable_cache);
            let devices = state
                .devices
                .iter()
                .filter(|(_, entry)| !entry.is_self)
                .filter_map(|(id, entry)| {
                    let facts = entry.facts(id);
                    serde_json::to_value(CachedDevice {
                        device_id: id.clone(),
                        name: entry.name.clone(),
                        host_kind: entry.host_kind,
                        version: facts.version,
                        fleet_protocol: facts.fleet_protocol,
                        host_capabilities: facts.host_capabilities,
                        as_of_ms: entry.fresh_at_ms,
                        legacy: entry.legacy,
                        partition: entry.partition.clone(),
                    })
                    .ok()
                })
                .collect();
            (
                IndexCacheFile {
                    version: INDEX_CACHE_VERSION,
                    self_device_id: self.self_device_id.clone(),
                    saved_at_ms: crate::now_ms(),
                    devices,
                },
                unreadable,
            )
        };
        let write = || -> std::io::Result<()> {
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            if unreadable && path.exists() {
                let aside = path.with_extension(format!("json.unreadable-{}", crate::now_ms()));
                std::fs::rename(&path, &aside)?;
                log::warn!(
                    "Fleet index cache moved aside before rewrite: path={}",
                    aside.display()
                );
            }
            let bytes = serde_json::to_vec(&file).map_err(std::io::Error::other)?;
            let tmp = path.with_extension("json.tmp");
            std::fs::write(&tmp, bytes)?;
            std::fs::rename(&tmp, &path)
        };
        write().map_err(|error| {
            self.lock().dirty = true;
            format!("fleet index cache write failed: {error}")
        })
    }
}

impl FleetOwnerIndex for FleetIndex {
    fn device_state(&self, device_id: &str) -> Option<FleetDeviceState> {
        let state = self.lock();
        state
            .devices
            .get(device_id)
            .map(|entry| entry.state().0)
            .map(|computed| {
                if device_id == self.self_device_id {
                    FleetDeviceState::Online
                } else {
                    computed
                }
            })
    }

    fn owners(&self, entity: FleetEntity, id: &str) -> Vec<String> {
        let state = self.lock();
        state
            .devices
            .iter()
            .filter(|(_, entry)| {
                let Some(partition) = entry.partition.as_ref() else {
                    return false;
                };
                match entity {
                    FleetEntity::Session => partition.sessions.iter().any(|s| s.session_id == id),
                    FleetEntity::Workspace => {
                        partition.workspaces.iter().any(|w| w.workspace_id == id)
                    }
                    FleetEntity::Terminal => false,
                }
            })
            .map(|(device_id, _)| device_id.clone())
            .collect()
    }

    fn may_hold_unlisted(&self, device_id: &str, entity: FleetEntity) -> bool {
        let state = self.lock();
        let Some(entry) = state.devices.get(device_id) else {
            return true;
        };
        let Some(partition) = entry.partition.as_ref() else {
            return true;
        };
        match entity {
            FleetEntity::Terminal => true,
            FleetEntity::Session => {
                partition.sessions_truncated
                    || partition.workspaces.iter().any(|w| w.has_more)
                    || partition.workspaces.len() >= MAX_WORKSPACES_PER_DEVICE
            }
            FleetEntity::Workspace => {
                partition.sessions_truncated
                    || partition.workspaces.len() >= MAX_WORKSPACES_PER_DEVICE
            }
        }
    }
}

/// A partition's content without its position (`revision`, `instanceId`).
fn content_of(
    partition: &FleetDigest,
) -> (&[FleetWorkspace], &[FleetSession], &[FleetPrompt], bool) {
    (
        &partition.workspaces,
        &partition.sessions,
        &partition.prompts,
        partition.sessions_truncated,
    )
}

/// Reason codes are short snake_case words; a free-text transport error is
/// reduced to its leading code (`mesh_unreachable: …` → `mesh_unreachable`).
fn reason_code(reason: &str) -> String {
    let head = reason.split(':').next().unwrap_or_default().trim();
    if !head.is_empty()
        && head.len() <= 48
        && head
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
    {
        head.to_string()
    } else {
        "link_failed".to_string()
    }
}

/// Apply a delta on top of the held partition.
fn merge_delta(held: &FleetDigest, delta: FleetDigest) -> FleetDigest {
    let mut next = held.clone();
    next.revision = delta.revision;
    next.sessions_truncated = delta.sessions_truncated;
    let removed = &delta.removed;
    let gone_ws: BTreeSet<&str> = removed.workspace_ids.iter().map(String::as_str).collect();
    let gone_sessions: BTreeSet<&str> = removed.session_ids.iter().map(String::as_str).collect();
    let gone_prompts: BTreeSet<&str> = removed.prompt_ids.iter().map(String::as_str).collect();
    next.workspaces
        .retain(|w| !gone_ws.contains(w.workspace_id.as_str()));
    next.sessions.retain(|s| {
        !gone_sessions.contains(s.session_id.as_str()) && !gone_ws.contains(s.workspace_id.as_str())
    });
    next.prompts
        .retain(|p| !gone_prompts.contains(p.prompt_id.as_str()));
    for workspace in delta.workspaces {
        match next
            .workspaces
            .iter_mut()
            .find(|held| held.workspace_id == workspace.workspace_id)
        {
            Some(held) => *held = workspace,
            None => next.workspaces.push(workspace),
        }
    }
    for session in delta.sessions {
        match next
            .sessions
            .iter_mut()
            .find(|held| held.session_id == session.session_id)
        {
            Some(held) => *held = session,
            None => next.sessions.push(session),
        }
    }
    for prompt in delta.prompts {
        match next
            .prompts
            .iter_mut()
            .find(|held| held.kind == prompt.kind && held.prompt_id == prompt.prompt_id)
        {
            Some(held) => *held = prompt,
            None => next.prompts.push(prompt),
        }
    }
    next
}

/// Force owner ids from the partition key, move nested sessions to the flat
/// list, and drop entries without an id or repeated ids.
fn normalize_partition(partition: &mut FleetDigest) {
    let device_id = partition.device_id.clone();
    let mut nested = Vec::new();
    let mut seen_ws = BTreeSet::new();
    partition.workspaces.retain_mut(|workspace| {
        nested.append(&mut workspace.sessions);
        workspace.device_id = device_id.clone();
        !workspace.workspace_id.is_empty() && seen_ws.insert(workspace.workspace_id.clone())
    });
    partition.sessions.append(&mut nested);
    let mut seen_sessions = BTreeSet::new();
    partition.sessions.retain_mut(|session| {
        session.device_id = device_id.clone();
        !session.session_id.is_empty() && seen_sessions.insert(session.session_id.clone())
    });
    let mut seen_prompts = BTreeSet::new();
    partition.prompts.retain_mut(|prompt| {
        prompt.device_id = device_id.clone();
        !prompt.prompt_id.is_empty() && seen_prompts.insert((prompt.kind, prompt.prompt_id.clone()))
    });
}

fn latest_activity(partition: &FleetDigest) -> BTreeMap<String, u64> {
    let mut latest = BTreeMap::new();
    for session in &partition.sessions {
        let entry = latest.entry(session.workspace_id.clone()).or_insert(0u64);
        *entry = (*entry).max(session.last_activity_ms);
    }
    latest
}

/// Apply the partition bounds of the contract: workspaces, sessions,
/// prompts, prompt payloads, and the byte size of the whole partition. The
/// owner's own `sessionsTruncated` is kept; dropping anything here sets it.
pub fn bound_partition(partition: &mut FleetDigest) {
    // Workspaces: the host's current one, then most recent activity.
    if partition.workspaces.len() > MAX_WORKSPACES_PER_DEVICE {
        let latest = latest_activity(partition);
        partition.workspaces.sort_by(|a, b| {
            b.is_host_current
                .cmp(&a.is_host_current)
                .then_with(|| {
                    latest
                        .get(&b.workspace_id)
                        .cmp(&latest.get(&a.workspace_id))
                })
                .then_with(|| a.workspace_id.cmp(&b.workspace_id))
        });
        partition.workspaces.truncate(MAX_WORKSPACES_PER_DEVICE);
        let kept: BTreeSet<String> = partition
            .workspaces
            .iter()
            .map(|w| w.workspace_id.clone())
            .collect();
        partition
            .sessions
            .retain(|session| kept.contains(&session.workspace_id));
        partition.sessions_truncated = true;
    }
    // Sessions: pinned (running, waiting, unread, attention) first, then
    // most recent.
    let session_order = |a: &FleetSession, b: &FleetSession| {
        b.is_pinned_by_activity()
            .cmp(&a.is_pinned_by_activity())
            .then_with(|| b.last_activity_ms.cmp(&a.last_activity_ms))
            .then_with(|| a.session_id.cmp(&b.session_id))
    };
    if partition.sessions.len() > MAX_SESSIONS_PER_DEVICE {
        partition.sessions.sort_by(session_order);
        partition.sessions.truncate(MAX_SESSIONS_PER_DEVICE);
        partition.sessions_truncated = true;
        mark_has_more(partition);
    }
    // Prompts: the oldest first (they have waited longest).
    if partition.prompts.len() > MAX_PROMPTS_PER_DEVICE {
        partition.prompts.sort_by(|a, b| {
            a.revision
                .cmp(&b.revision)
                .then_with(|| a.prompt_id.cmp(&b.prompt_id))
        });
        partition.prompts.truncate(MAX_PROMPTS_PER_DEVICE);
    }
    for prompt in &mut partition.prompts {
        let oversized = prompt.payload.as_ref().is_some_and(|payload| {
            serde_json::to_vec(payload).map_or(true, |bytes| bytes.len() > MAX_PROMPT_PAYLOAD_BYTES)
        });
        if oversized {
            prompt.payload = None;
            prompt.payload_truncated = true;
        }
    }
    // Bytes: drop the least important sessions until the partition fits.
    let size =
        |partition: &FleetDigest| serde_json::to_vec(partition).map_or(usize::MAX, |b| b.len());
    if size(partition) > MAX_PARTITION_BYTES {
        partition.sessions.sort_by(session_order);
        while size(partition) > MAX_PARTITION_BYTES && !partition.sessions.is_empty() {
            let keep = partition.sessions.len() * 9 / 10;
            partition.sessions.truncate(keep);
        }
        while size(partition) > MAX_PARTITION_BYTES && !partition.prompts.is_empty() {
            let keep = partition.prompts.len() / 2;
            partition.prompts.truncate(keep);
        }
        while size(partition) > MAX_PARTITION_BYTES && !partition.workspaces.is_empty() {
            let keep = partition.workspaces.len() * 9 / 10;
            partition.workspaces.truncate(keep);
        }
        partition.sessions_truncated = true;
        mark_has_more(partition);
    }
}

/// Mark every workspace that lost sessions to a bound.
fn mark_has_more(partition: &mut FleetDigest) {
    let mut listed: BTreeMap<&str, u32> = BTreeMap::new();
    for session in &partition.sessions {
        if session.parent_session_id.is_none() {
            *listed.entry(session.workspace_id.as_str()).or_default() += 1;
        }
    }
    let listed: BTreeMap<String, u32> = listed
        .into_iter()
        .map(|(id, count)| (id.to_string(), count))
        .collect();
    for workspace in &mut partition.workspaces {
        let count = listed.get(&workspace.workspace_id).copied().unwrap_or(0);
        if workspace.session_total > count {
            workspace.has_more = true;
        }
    }
}

// -- cache file shapes --------------------------------------------------------

fn null_default<'de, D, T>(deserializer: D) -> Result<T, D::Error>
where
    D: Deserializer<'de>,
    T: Default + Deserialize<'de>,
{
    Ok(Option::<T>::deserialize(deserializer)?.unwrap_or_default())
}

/// `<data>/fleet/index.json`. Device records are kept as raw JSON so one
/// unreadable record never loses the others.
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct IndexCacheFile {
    #[serde(deserialize_with = "null_default")]
    version: u32,
    #[serde(deserialize_with = "null_default")]
    self_device_id: String,
    #[serde(deserialize_with = "null_default")]
    saved_at_ms: u64,
    #[serde(deserialize_with = "null_default")]
    devices: Vec<Value>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct CachedDevice {
    #[serde(deserialize_with = "null_default")]
    device_id: String,
    #[serde(deserialize_with = "null_default")]
    name: String,
    #[serde(deserialize_with = "null_default")]
    host_kind: FleetHostKind,
    version: Option<String>,
    fleet_protocol: Option<u32>,
    #[serde(deserialize_with = "null_default")]
    host_capabilities: Vec<String>,
    #[serde(deserialize_with = "null_default")]
    as_of_ms: u64,
    #[serde(deserialize_with = "null_default")]
    legacy: bool,
    partition: Option<FleetDigest>,
}

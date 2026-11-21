//! Host half of peer branch import (`workspace_peer_import_v1`).
//!
//! A controller (the cloud superagent) can provision a job from another
//! account device's job result: `dispatch_target_workspace_provision_source`
//! with `source {kind: "job", jobId, sourceDeviceId, head?}`. The target's
//! dispatch runner owns the job store but holds no Link connection; its host
//! (desktop or CLI) does. So the host runs this coordinator:
//!
//! 1. It asks the local runner to provision. Until the result was imported
//!    the runner answers `peerImport` (what to fetch) instead of a worktree.
//! 2. The host then pulls the source job's branch in the background, through
//!    the source device's full-history `workspace-sync` bundle and
//!    `workspace-sync-chunk` (the same bundle path a controller's result sync
//!    uses), and feeds the bytes to the local runner through
//!    `workspace-bundle-begin/chunk` and `peer-import-commit`.
//! 3. The caller's polls see `pending` meanwhile; a failure is answered once
//!    and the next poll retries. After the import the runner provisions the
//!    job worktree from the imported head like any other source.
//!
//! The host advertises `workspace_peer_import_v1` only when its runner reports
//! `workspace_peer_bundle_v1` ([`advertise_peer_import`]), and requires the
//! same fact of the source device before it dials it for an export.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

use anyhow::{anyhow, Context};
use async_trait::async_trait;
use base64::Engine as _;
use openbitfun_services_core::dispatch_contract::{
    DISPATCH_PEER_BUNDLE_CAPABILITY, DISPATCH_PROTOCOL_VERSION,
    DISPATCH_TARGET_PROVISION_SOURCE_COMMAND, DISPATCH_WORKSPACE_PEER_IMPORT_CAPABILITY,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use super::DeviceDispatchRpc;

/// One bundle chunk on the wire (the device envelope bound).
const CHUNK_BYTES: usize = 256 * 1024;
/// A peer's whole branch history; generous, but bounded so a hostile or broken
/// peer cannot fill this device's disk through the job directory.
const MAX_PEER_BUNDLE_BYTES: u64 = 1024 * 1024 * 1024;
const EXPORT_WAIT: std::time::Duration = std::time::Duration::from_secs(30 * 60);
const EXPORT_POLL: std::time::Duration = std::time::Duration::from_millis(750);

/// The runner verbs the coordinator drives on this device.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PeerImportLocalVerb {
    /// `workspace-provision-source` (the public verb, unchanged arguments).
    ProvisionSource,
    BundleBegin,
    BundleChunk,
    /// Runner-internal `peer-import-commit`.
    PeerImportCommit,
}

/// This device's dispatch runner, as its host reaches it (in process for the
/// CLI, the installed `openbitfun dispatch` for the desktop).
#[async_trait]
pub trait PeerImportLocalRunner: Send + Sync {
    async fn run(&self, verb: PeerImportLocalVerb, args: Value) -> anyhow::Result<Value>;
}

/// Whether `command` + `args` is a provision whose source is another
/// device's job (the only call [`provision_source`] must see).
pub fn is_peer_import_provision(command: &str, args: &Value) -> bool {
    command == DISPATCH_TARGET_PROVISION_SOURCE_COMMAND
        && args.pointer("/source/kind").and_then(Value::as_str) == Some("job")
}

/// Add `workspace_peer_import_v1` to a `dispatch_target_probe` answer when the
/// runner can store a peer bundle. The host owns the dial, so the host owns
/// the advertisement; an older host passes the runner fact through unchanged
/// and a controller never sends it a `job` source.
pub fn advertise_peer_import(probe: &mut Value) {
    let Some(capabilities) = probe.get_mut("capabilities").and_then(Value::as_array_mut) else {
        return;
    };
    let has = |name: &str| capabilities.iter().any(|item| item.as_str() == Some(name));
    if has(DISPATCH_PEER_BUNDLE_CAPABILITY) && !has(DISPATCH_WORKSPACE_PEER_IMPORT_CAPABILITY) {
        capabilities.push(Value::String(
            DISPATCH_WORKSPACE_PEER_IMPORT_CAPABILITY.to_string(),
        ));
    }
}

#[derive(Debug, Clone)]
enum Transfer {
    Running,
    Failed(String),
}

/// In-flight imports of this host, by target job id. Process-local: a host
/// restart loses only the transfer in flight, and the next poll starts it
/// again (the runner's records are durable and idempotent).
#[derive(Default)]
pub struct PeerImportCoordinator {
    transfers: Mutex<HashMap<String, Transfer>>,
}

/// The coordinator of this process.
pub fn peer_import_coordinator() -> &'static PeerImportCoordinator {
    static COORDINATOR: OnceLock<PeerImportCoordinator> = OnceLock::new();
    COORDINATOR.get_or_init(PeerImportCoordinator::default)
}

impl PeerImportCoordinator {
    /// Serve one `dispatch_target_workspace_provision_source` with a `job`
    /// source. Never blocks on the transfer: the caller polls.
    pub async fn provision_source(
        &self,
        rpc: Arc<dyn DeviceDispatchRpc>,
        local: Arc<dyn PeerImportLocalRunner>,
        args: Value,
    ) -> anyhow::Result<Value> {
        let job_id = args
            .get("jobId")
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow!("dispatch provision requires a jobId"))?
            .to_string();
        let answer = local
            .run(PeerImportLocalVerb::ProvisionSource, args.clone())
            .await?;
        let Some(need) = answer.get("peerImport").cloned().filter(|v| !v.is_null()) else {
            // Imported already (or never needed): the runner's answer stands.
            return Ok(answer);
        };
        let state = self
            .transfers
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(&job_id)
            .cloned();
        match state {
            Some(Transfer::Running) => return Ok(pending_answer(answer)),
            Some(Transfer::Failed(error)) => {
                // Answered once; the next poll starts a fresh transfer.
                self.transfers
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .remove(&job_id);
                anyhow::bail!("peer import failed: {error}");
            }
            None => {}
        }
        let source_device_id = need
            .get("sourceDeviceId")
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow!("the runner named no source device"))?
            .to_string();
        let source_job_id = need
            .get("sourceJobId")
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow!("the runner named no source job"))?
            .to_string();
        self.transfers
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(job_id.clone(), Transfer::Running);
        let job = job_id.clone();
        let task = async move {
            transfer(
                rpc.as_ref(),
                local.as_ref(),
                &job,
                &source_device_id,
                &source_job_id,
            )
            .await
        };
        if std::ptr::eq(self, peer_import_coordinator()) {
            // The process coordinator outlives the call: transfer in the
            // background while the caller polls.
            tokio::spawn(async move {
                let outcome = task.await;
                peer_import_coordinator().finish(&job_id, outcome);
            });
        } else {
            // Any other coordinator (tests) runs the transfer inline.
            let outcome = task.await;
            self.finish(&job_id, outcome);
        }
        Ok(pending_answer(answer))
    }

    fn finish(&self, job_id: &str, outcome: anyhow::Result<()>) {
        let mut transfers = self.transfers.lock().unwrap_or_else(|e| e.into_inner());
        match outcome {
            Ok(()) => {
                transfers.remove(job_id);
            }
            Err(error) => {
                log::warn!(
                    "Dispatch peer import failed: job_id={}, error={:#}",
                    job_id,
                    error
                );
                transfers.insert(job_id.to_string(), Transfer::Failed(format!("{error:#}")));
            }
        }
    }
}

/// The runner's answer as the caller sees it: pending, without the
/// host-only `peerImport` field.
fn pending_answer(mut answer: Value) -> Value {
    if let Some(object) = answer.as_object_mut() {
        object.remove("peerImport");
        object.insert("pending".into(), Value::Bool(true));
        object.insert("provisioned".into(), Value::Bool(false));
    }
    answer
}

/// Pull the source job's full-history bundle and import it locally.
async fn transfer(
    rpc: &dyn DeviceDispatchRpc,
    local: &dyn PeerImportLocalRunner,
    job_id: &str,
    source_device_id: &str,
    source_job_id: &str,
) -> anyhow::Result<()> {
    // The source must be able to export (and the request field is strict).
    let probe = rpc
        .invoke(source_device_id, "dispatch_target_probe", json!({}))
        .await
        .context("probe the source device")?;
    let exports = probe
        .get("capabilities")
        .and_then(Value::as_array)
        .is_some_and(|caps| {
            caps.iter()
                .any(|item| item.as_str() == Some(DISPATCH_PEER_BUNDLE_CAPABILITY))
        });
    if !exports {
        anyhow::bail!(
            "capability_missing: the source device cannot export a job result ({DISPATCH_PEER_BUNDLE_CAPABILITY}); update OpenBitFun there"
        );
    }

    let operation_id = uuid::Uuid::new_v4().as_simple().to_string();
    let deadline = tokio::time::Instant::now() + EXPORT_WAIT;
    let export = loop {
        let answer = rpc
            .invoke(
                source_device_id,
                "dispatch_target_workspace_sync",
                json!({
                    "jobId": source_job_id,
                    "operationId": operation_id,
                    "fullHistory": true,
                }),
            )
            .await
            .context("export the source job's branch")?;
        if answer.get("pending").and_then(Value::as_bool) != Some(true) {
            break answer;
        }
        if tokio::time::Instant::now() >= deadline {
            anyhow::bail!("the source device did not export the job within 30 minutes");
        }
        tokio::time::sleep(EXPORT_POLL).await;
    };
    let size = export
        .get("bundleSize")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let digest = export
        .get("bundleSha256")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("the source device returned no bundle digest"))?
        .to_ascii_lowercase();
    let branch = export
        .get("branch")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("the source device returned no branch"))?
        .to_string();
    let head = export
        .get("headCommit")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("the source device returned no head commit"))?
        .to_string();
    if size == 0 || size > MAX_PEER_BUNDLE_BYTES {
        anyhow::bail!(
            "the source job's bundle is outside the {} MB import limit",
            MAX_PEER_BUNDLE_BYTES / (1024 * 1024)
        );
    }

    let begin = local
        .run(
            PeerImportLocalVerb::BundleBegin,
            json!({
                "protocolVersion": DISPATCH_PROTOCOL_VERSION,
                "jobId": job_id,
                "sha256": digest,
                "size": size,
            }),
        )
        .await
        .context("start the local bundle upload")?;
    let mut offset = begin.get("offset").and_then(Value::as_u64).unwrap_or(0);
    if offset > size {
        anyhow::bail!("the local bundle upload is past the bundle end");
    }
    // A resumed upload is verified end to end by the runner (size + digest);
    // the bytes this host streams are hashed too, so a peer that changed the
    // bundle between chunks fails here first.
    let mut hasher = (offset == 0).then(Sha256::new);
    if begin.get("committed").and_then(Value::as_bool) != Some(true) {
        while offset < size {
            let chunk = rpc
                .invoke(
                    source_device_id,
                    "dispatch_target_workspace_sync_chunk",
                    json!({
                        "jobId": source_job_id,
                        "offset": offset,
                        "length": CHUNK_BYTES as u64,
                        "fullHistory": true,
                    }),
                )
                .await
                .context("read the source job's bundle")?;
            let encoded = chunk
                .get("dataBase64")
                .and_then(Value::as_str)
                .ok_or_else(|| anyhow!("the source device returned no chunk data"))?;
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(encoded)
                .context("decode a bundle chunk")?;
            if bytes.is_empty() || bytes.len() > CHUNK_BYTES {
                anyhow::bail!("the source device returned a malformed chunk at {offset}");
            }
            let next = offset + bytes.len() as u64;
            if next > size || chunk.get("offset").and_then(Value::as_u64) != Some(next) {
                anyhow::bail!("the source device returned a mismatched chunk at {offset}");
            }
            if let Some(hasher) = hasher.as_mut() {
                hasher.update(&bytes);
            }
            local
                .run(
                    PeerImportLocalVerb::BundleChunk,
                    json!({
                        "jobId": job_id,
                        "offset": offset,
                        "dataBase64": encoded,
                    }),
                )
                .await
                .context("store a bundle chunk")?;
            offset = next;
        }
        if let Some(hasher) = hasher {
            let actual = format!("{:x}", hasher.finalize());
            if actual != digest {
                anyhow::bail!("the source job's bundle does not match its reported digest");
            }
        }
    }
    local
        .run(
            PeerImportLocalVerb::PeerImportCommit,
            json!({
                "protocolVersion": DISPATCH_PROTOCOL_VERSION,
                "jobId": job_id,
                "sourceDeviceId": source_device_id,
                "sourceJobId": source_job_id,
                "sourceBranch": branch,
                "headCommit": head,
            }),
        )
        .await
        .context("import the source job's bundle")?;
    log::info!(
        "Dispatch peer import completed: job_id={}, source_job_id={}, bytes={}",
        job_id,
        source_job_id,
        size
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex as StdMutex;

    #[test]
    fn only_job_sources_are_peer_imports() {
        assert!(is_peer_import_provision(
            DISPATCH_TARGET_PROVISION_SOURCE_COMMAND,
            &json!({"source": {"kind": "job", "jobId": "j", "sourceDeviceId": "d"}})
        ));
        assert!(!is_peer_import_provision(
            DISPATCH_TARGET_PROVISION_SOURCE_COMMAND,
            &json!({"source": {"kind": "workspace", "workspaceId": "w"}})
        ));
        assert!(!is_peer_import_provision(
            "dispatch_target_workspace_provision",
            &json!({"source": {"kind": "job"}})
        ));
    }

    #[test]
    fn the_host_advertises_peer_import_only_over_a_capable_runner() {
        let mut capable =
            json!({"capabilities": ["detached_worker", DISPATCH_PEER_BUNDLE_CAPABILITY]});
        advertise_peer_import(&mut capable);
        advertise_peer_import(&mut capable);
        let caps = capable["capabilities"].as_array().unwrap();
        assert_eq!(
            caps.iter()
                .filter(|c| c.as_str() == Some(DISPATCH_WORKSPACE_PEER_IMPORT_CAPABILITY))
                .count(),
            1
        );
        let mut older = json!({"capabilities": ["detached_worker"]});
        advertise_peer_import(&mut older);
        assert_eq!(older["capabilities"].as_array().unwrap().len(), 1);
    }

    /// A source device serving a fixed bundle, and a local runner recording
    /// what it was fed.
    struct Source {
        bundle: Vec<u8>,
        exports: bool,
    }

    #[async_trait]
    impl DeviceDispatchRpc for Source {
        async fn invoke(&self, device: &str, command: &str, args: Value) -> anyhow::Result<Value> {
            assert_eq!(device, "dev-src");
            match command {
                "dispatch_target_probe" => Ok(json!({
                    "capabilities": if self.exports { vec![DISPATCH_PEER_BUNDLE_CAPABILITY] } else { vec![] }
                })),
                "dispatch_target_workspace_sync" => {
                    assert_eq!(args["fullHistory"], true);
                    assert!(args.get("knownHead").is_none());
                    Ok(json!({
                        "changed": true, "branch": "openbitfun/dispatch/src-1",
                        "baseCommit": "0".repeat(40), "headCommit": "1".repeat(40),
                        "commitCount": 1, "changes": [], "truncatedChanges": false,
                        "bundleSha256": format!("{:x}", Sha256::digest(&self.bundle)),
                        "bundleSize": self.bundle.len() as u64,
                    }))
                }
                "dispatch_target_workspace_sync_chunk" => {
                    assert_eq!(args["fullHistory"], true);
                    let offset = args["offset"].as_u64().unwrap() as usize;
                    let end =
                        (offset + args["length"].as_u64().unwrap() as usize).min(self.bundle.len());
                    Ok(json!({
                        "offset": end as u64,
                        "dataBase64": base64::engine::general_purpose::STANDARD.encode(&self.bundle[offset..end]),
                        "eof": end == self.bundle.len(),
                    }))
                }
                other => anyhow::bail!("unexpected {other}"),
            }
        }
    }

    #[derive(Default)]
    struct Runner {
        imported: StdMutex<bool>,
        received: StdMutex<Vec<u8>>,
        calls: StdMutex<Vec<PeerImportLocalVerb>>,
    }

    #[async_trait]
    impl PeerImportLocalRunner for Runner {
        async fn run(&self, verb: PeerImportLocalVerb, args: Value) -> anyhow::Result<Value> {
            self.calls.lock().unwrap().push(verb);
            match verb {
                PeerImportLocalVerb::ProvisionSource => {
                    if *self.imported.lock().unwrap() {
                        Ok(
                            json!({"pending": false, "provisioned": true, "workspacePath": "/w", "baseCommit": "1".repeat(40), "branch": "b"}),
                        )
                    } else {
                        Ok(
                            json!({"pending": true, "provisioned": false, "baseCommit": "", "branch": "b",
                            "peerImport": {"sourceDeviceId": "dev-src", "sourceJobId": "src-1"}}),
                        )
                    }
                }
                PeerImportLocalVerb::BundleBegin => {
                    Ok(json!({"accepted": true, "offset": 0, "committed": false}))
                }
                PeerImportLocalVerb::BundleChunk => {
                    let bytes = base64::engine::general_purpose::STANDARD
                        .decode(args["dataBase64"].as_str().unwrap())
                        .unwrap();
                    self.received.lock().unwrap().extend(bytes);
                    Ok(json!({"accepted": true}))
                }
                PeerImportLocalVerb::PeerImportCommit => {
                    assert_eq!(args["sourceBranch"], "openbitfun/dispatch/src-1");
                    assert_eq!(args["headCommit"], "1".repeat(40));
                    *self.imported.lock().unwrap() = true;
                    Ok(json!({"imported": true, "headCommit": "1".repeat(40)}))
                }
            }
        }
    }

    fn request() -> Value {
        json!({"protocolVersion": DISPATCH_PROTOCOL_VERSION, "jobId": "job-new",
            "source": {"kind": "job", "jobId": "src-1", "sourceDeviceId": "dev-src"},
            "branch": "openbitfun/dispatch/job-new"})
    }

    #[tokio::test]
    async fn a_poll_imports_the_peer_bundle_then_provisions() {
        let coordinator = PeerImportCoordinator::default();
        let bundle: Vec<u8> = (0..(CHUNK_BYTES * 2 + 17))
            .map(|i| (i % 251) as u8)
            .collect();
        let source = Arc::new(Source {
            bundle: bundle.clone(),
            exports: true,
        });
        let runner = Arc::new(Runner::default());
        let first = coordinator
            .provision_source(source.clone(), runner.clone(), request())
            .await
            .unwrap();
        // The caller only ever sees pending, never the host-only field.
        assert_eq!(first["pending"], true);
        assert!(first.get("peerImport").is_none());
        assert_eq!(*runner.received.lock().unwrap(), bundle);
        let second = coordinator
            .provision_source(source, runner.clone(), request())
            .await
            .unwrap();
        assert_eq!(second["provisioned"], true);
        assert_eq!(
            runner
                .calls
                .lock()
                .unwrap()
                .iter()
                .filter(|v| **v == PeerImportLocalVerb::BundleChunk)
                .count(),
            3
        );
    }

    #[tokio::test]
    async fn a_source_that_cannot_export_fails_loudly_once_then_retries() {
        let coordinator = PeerImportCoordinator::default();
        let source = Arc::new(Source {
            bundle: vec![1, 2, 3],
            exports: false,
        });
        let runner = Arc::new(Runner::default());
        let first = coordinator
            .provision_source(source.clone(), runner.clone(), request())
            .await
            .unwrap();
        assert_eq!(first["pending"], true);
        let error = coordinator
            .provision_source(source.clone(), runner.clone(), request())
            .await
            .unwrap_err();
        assert!(
            format!("{error:#}").contains("capability_missing"),
            "{error:#}"
        );
        // The failure was answered; the next poll tries again.
        assert_eq!(
            coordinator
                .provision_source(source, runner, request())
                .await
                .unwrap()["pending"],
            true
        );
    }
}

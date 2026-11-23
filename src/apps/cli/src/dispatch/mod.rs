pub(crate) mod outbound;
mod permissions;
pub(crate) mod protocol;
mod query_file;
mod runner;
mod source;
mod store;
mod summary;
mod worker;
mod workspace;

use std::path::{Path, PathBuf};

use anyhow::{anyhow, bail, Context, Result};
use openbitfun_core::infrastructure::ai::AIClientFactory;
use openbitfun_core::service::config::{AuthConfig, GlobalConfig};
use openbitfun_core::service::git::trust;
use serde::de::DeserializeOwned;

use protocol::{
    DispatchAnswerRequest, DispatchAnswerResponse, DispatchAppendRequest, DispatchAppendResponse,
    DispatchCancelRequest, DispatchCancelResponse, DispatchContinueRequest,
    DispatchContinueResponse, DispatchJobListEntry, DispatchJobState, DispatchListRequest,
    DispatchProbeRequest, DispatchProbeResponse, DispatchQueryKind, DispatchQueryRequest,
    DispatchStatusRequest, DispatchStatusResponse, DispatchSubmitRequest, DispatchSubmitResponse,
    DispatchTurnKind, DispatchWorkspaceBundleBeginRequest, DispatchWorkspaceBundleChunkRequest,
    DispatchWorkspaceBundleCommitRequest, DispatchWorkspaceProbe,
    DispatchWorkspaceProvisionRequest, DispatchWorkspaceProvisionSourceRequest,
    DispatchWorkspaceSyncChunkRequest, DispatchWorkspaceSyncRequest, DISPATCH_PROTOCOL_VERSION,
    MAX_DISPATCH_TEXT_BYTES,
};
use store::{CreateJobOutcome, DispatchStateRecord, DispatchStore};

#[derive(Clone, Debug)]
struct ModelReadiness {
    available_models: Vec<String>,
    default_model: Option<String>,
    diagnostic: Option<String>,
    model_catalog: openbitfun_core::AIModelCatalog,
}

impl ModelReadiness {
    fn model_configured(&self) -> bool {
        self.default_model
            .as_ref()
            .is_some_and(|default| self.available_models.contains(default))
    }
}

pub(crate) async fn run_dispatch_verb(
    verb: &str,
    input: serde_json::Value,
) -> Result<serde_json::Value> {
    use openbitfun_core_types::agent_identity_wire::{
        translate_agent_identity_command, translate_agent_identity_response, AgentIdentityDialect,
    };
    let input = translate_agent_identity_command(verb, input, AgentIdentityDialect::Canonical)
        .map_err(anyhow::Error::msg)?;
    let result = run_dispatch_verb_canonical(verb, input).await?;
    translate_agent_identity_response(
        verb,
        result,
        &serde_json::Value::Null,
        AgentIdentityDialect::Legacy,
    )
    .map_err(anyhow::Error::msg)
}

async fn run_dispatch_verb_canonical(
    verb: &str,
    input: serde_json::Value,
) -> Result<serde_json::Value> {
    match verb {
        "probe" => {
            serde_json::to_value(probe(parse(input)?).await?).context("encode probe response")
        }
        "submit" => {
            serde_json::to_value(submit(parse(input)?).await?).context("encode submit response")
        }
        "continue" => serde_json::to_value(continue_job(parse(input)?).await?)
            .context("encode follow-up turn response"),
        "query" => query(parse(input)?).await.context("encode query response"),
        _ => {
            let verb_owned = verb.to_string();
            tokio::task::spawn_blocking(move || run_sync_dispatch_verb(&verb_owned, input))
                .await
                .with_context(|| format!("dispatch verb '{verb}' blocking task failed"))?
        }
    }
}

/// Runs synchronous dispatch verbs (Git/flock/ps/fsync loops) on Tokio's
/// blocking pool so async worker threads are never stalled.
fn run_sync_dispatch_verb(verb: &str, input: serde_json::Value) -> Result<serde_json::Value> {
    match verb {
        "status" => status(parse(input)?).context("encode status response"),
        "cancel" => serde_json::to_value(cancel(parse(input)?)?).context("encode cancel response"),
        "list" => {
            let request: DispatchListRequest = parse(input)?;
            serde_json::to_value(list(request)?).context("encode dispatch job list")
        }
        "answer" => {
            // `answers` (a question, `user_question_mailbox_v1`) replaces
            // `reply` (a permission); each shape stays strict on its own.
            if input.get("answers").is_some() {
                serde_json::to_value(answer_question(parse(input)?)?)
                    .context("encode question answer")
            } else {
                serde_json::to_value(answer(parse(input)?)?).context("encode permission answer")
            }
        }
        "append" => serde_json::to_value(append(parse(input)?)?).context("encode appended message"),
        "workspace-provision" => serde_json::to_value(workspace::provision(parse::<
            DispatchWorkspaceProvisionRequest,
        >(input)?)?)
        .context("encode workspace provision response"),
        "workspace-provision-source" => {
            serde_json::to_value(source::provision_source(parse::<
                DispatchWorkspaceProvisionSourceRequest,
            >(input)?)?)
            .context("encode workspace source provision response")
        }
        "workspace-bundle-begin" => {
            serde_json::to_value(workspace::bundle_begin(parse::<
                DispatchWorkspaceBundleBeginRequest,
            >(input)?)?)
            .context("encode workspace bundle begin response")
        }
        "workspace-bundle-chunk" => {
            serde_json::to_value(workspace::bundle_chunk(parse::<
                DispatchWorkspaceBundleChunkRequest,
            >(input)?)?)
            .context("encode workspace bundle chunk response")
        }
        "workspace-bundle-commit" => {
            serde_json::to_value(workspace::bundle_commit(parse::<
                DispatchWorkspaceBundleCommitRequest,
            >(input)?)?)
            .context("encode workspace bundle commit response")
        }
        "workspace-sync" => serde_json::to_value(workspace::sync(parse::<
            DispatchWorkspaceSyncRequest,
        >(input)?)?)
        .context("encode workspace sync response"),
        "workspace-sync-chunk" => serde_json::to_value(workspace::sync_chunk(parse::<
            DispatchWorkspaceSyncChunkRequest,
        >(input)?)?)
        .context("encode workspace sync chunk response"),
        // `workspace_publish_v1`.
        "workspace-publish" => serde_json::to_value(workspace::publish(parse::<
            protocol::DispatchWorkspacePublishRequest,
        >(input)?)?)
        .context("encode workspace publish response"),
        // Runner-internal half of a host's peer import (never a wire verb).
        "peer-import-commit" => {
            serde_json::to_value(workspace::peer_import_commit(parse::<
                protocol::DispatchPeerImportCommitRequest,
            >(input)?)?)
            .context("encode peer import response")
        }
        "pending-questions" => {
            let _: PendingPromptsRequest = parse(input)?;
            serde_json::to_value(pending_question_entries()?).context("encode pending questions")
        }
        "pending-prompts" => {
            let _: PendingPromptsRequest = parse(input)?;
            serde_json::to_value(pending_prompt_entries()?).context("encode pending prompts")
        }
        _ => bail!("unsupported dispatch verb: {verb}"),
    }
}

/// `pending-prompts` takes no arguments.
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct PendingPromptsRequest {}

/// The pending permission requests of this host's live jobs, flattened for a
/// host that reads them out of process (the desktop's fleet digest).
fn pending_prompt_entries() -> Result<Vec<serde_json::Value>> {
    let mut entries = Vec::new();
    for (job, requests) in pending_dispatch_prompts()? {
        for request in requests {
            entries.push(serde_json::json!({
                "jobId": job.job_id,
                "sessionId": job.session_id,
                "workspacePath": job.workspace_path,
                "title": job.title,
                "request": request,
            }));
        }
    }
    Ok(entries)
}

/// The waiting questions of this host's live jobs, flattened like
/// [`pending_prompt_entries`] (a separate verb, so an older desktop that
/// reads `pending-prompts` strictly never sees a question entry).
fn pending_question_entries() -> Result<Vec<serde_json::Value>> {
    let mut entries = Vec::new();
    for (job, questions) in pending_dispatch_questions()? {
        for question in questions {
            entries.push(serde_json::json!({
                "jobId": job.job_id,
                "sessionId": job.session_id,
                "workspacePath": job.workspace_path,
                "title": job.title,
                "question": question,
            }));
        }
    }
    Ok(entries)
}

/// The live jobs of this host's dispatch store with their waiting questions
/// (read-only; the fleet digest's dispatch questions, `fleet_host`).
pub(crate) fn pending_dispatch_questions() -> Result<
    Vec<(
        protocol::DispatchJobListEntry,
        Vec<protocol::DispatchPendingQuestion>,
    )>,
> {
    DispatchStore::open_default()?.list_pending_dispatch_questions()
}

/// The live jobs of this host's dispatch store with their pending permission
/// requests (read-only; the fleet digest's dispatch prompts, `fleet_host`).
pub(crate) fn pending_dispatch_prompts() -> Result<
    Vec<(
        protocol::DispatchJobListEntry,
        Vec<openbitfun_agent_runtime::sdk::PermissionRequest>,
    )>,
> {
    DispatchStore::open_default()?.list_pending_dispatch_prompts()
}

pub(crate) async fn run_worker(job_id: String) -> Result<()> {
    let _containment = match runner::contain_detached_action("__run", &job_id) {
        Ok(containment) => containment,
        Err(error) => {
            record_uncontained_worker_failure(&job_id, &error);
            return Err(error);
        }
    };
    worker::run(job_id).await
}

/// Settle a job whose worker could not enter its containment. Without it no
/// observer can authenticate or cancel the worker, so it must not run; the
/// lease guard keeps a live duplicate's job untouched.
fn record_uncontained_worker_failure(job_id: &str, error: &anyhow::Error) {
    let Ok(store) = DispatchStore::open_default() else {
        return;
    };
    if let Ok(Some(_lease)) = store.try_acquire_worker_lease(job_id) {
        let _ = store.mark_state(
            job_id,
            DispatchJobState::Failed,
            None,
            Some(format!("Dispatch worker could not be contained: {error:#}")),
        );
        store.clear_preparing(job_id);
    }
}

pub(crate) fn run_workspace_provision(job_id: String) -> Result<()> {
    let _containment = runner::contain_detached_action("__workspace_provision_run", &job_id)?;
    workspace::run_provision(job_id)
}

pub(crate) fn run_workspace_bundle_commit(job_id: String) -> Result<()> {
    let _containment = runner::contain_detached_action("__workspace_bundle_commit_run", &job_id)?;
    workspace::run_bundle_commit(job_id)
}

pub(crate) fn run_workspace_sync(job_id: String) -> Result<()> {
    let _containment = runner::contain_detached_action("__workspace_sync_run", &job_id)?;
    workspace::run_sync(job_id)
}

async fn probe(request: DispatchProbeRequest) -> Result<DispatchProbeResponse> {
    // Resolve the workspace before the (slower) model inspection so a bad
    // id fails fast. Offload git/filesystem probes off the async runtime.
    let workspace = match (request.workspace_path, request.workspace_id) {
        (Some(_), Some(_)) => bail!("dispatch probe takes workspacePath or workspaceId, not both"),
        (Some(path), None) => tokio::task::spawn_blocking(move || inspect_workspace(&path))
            .await
            .context("dispatch probe workspace inspection task failed")??
            .into(),
        (None, Some(workspace_id)) => tokio::task::spawn_blocking(move || {
            let catalog = source::default_workspace_catalog()?;
            let resolved = source::resolve_catalog_workspace(&catalog, &workspace_id)?;
            let probe = inspect_workspace(&resolved.root.to_string_lossy())?;
            Ok::<_, anyhow::Error>(Some(source::probe_repository_facts(probe, &resolved)))
        })
        .await
        .context("dispatch probe catalog workspace task failed")??,
        (None, None) => None,
    };
    let readiness = inspect_model_readiness().await?;
    let mut capabilities: Vec<String> =
        openbitfun_services_core::dispatch_contract::DISPATCH_BASE_TARGET_CAPABILITIES
            .iter()
            .map(|capability| capability.to_string())
            .collect();
    // This CLI assembles native Agent Runtime and subscription-auth. These
    // runtime facts do not advertise unsupported account-management handlers.
    capabilities.extend(
        openbitfun_services_core::dispatch_contract::DISPATCH_SUBSCRIPTION_ACCOUNT_CAPABILITIES
            .iter()
            .map(|capability| capability.to_string()),
    );
    capabilities.push(
        openbitfun_services_core::dispatch_contract::DISPATCH_MODEL_CHANNEL_ROUTING_CAPABILITY
            .into(),
    );
    // Accepting the controller's model-sync audit row is a request-validation
    // fact, not a runtime one, so it is advertised regardless of whether this
    // platform can host detached workers.
    capabilities.push(
        openbitfun_services_core::dispatch_contract::DISPATCH_SETUP_AUDIT_MODEL_SYNC_CAPABILITY
            .to_string(),
    );
    capabilities.push(
        openbitfun_services_core::dispatch_contract::DISPATCH_READ_FILE_CAPABILITY.to_string(),
    );
    capabilities.push(
        openbitfun_services_core::dispatch_contract::DISPATCH_FILE_CHUNKS_CAPABILITY.to_string(),
    );
    capabilities.extend(superagent_target_capabilities());
    // Dispatch phase two. The bundle fact lets a host (which holds the Link
    // connection) advertise `workspace_peer_import_v1` on top of it.
    capabilities.push(contract_peer_bundle_capability().to_string());
    capabilities.push(
        openbitfun_services_core::dispatch_contract::DISPATCH_USER_QUESTION_MAILBOX_CAPABILITY
            .to_string(),
    );
    if publish_routed() {
        capabilities.push(
            openbitfun_services_core::dispatch_contract::DISPATCH_WORKSPACE_PUBLISH_CAPABILITY
                .to_string(),
        );
    }
    if runner::is_supported() {
        capabilities.push(
            openbitfun_services_core::dispatch_contract::DISPATCH_DETACHED_WORKER_CAPABILITY
                .to_string(),
        );
    }
    Ok(DispatchProbeResponse {
        product_id: openbitfun_services_core::product_identity::product_id().to_string(),
        data_namespace: openbitfun_services_core::product_identity::data_namespace().to_string(),
        protocol_version: DISPATCH_PROTOCOL_VERSION,
        cli_version: env!("CARGO_PKG_VERSION").to_string(),
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        capabilities,
        model_configured: readiness.model_configured(),
        available_models: readiness.available_models,
        model_catalog: readiness.model_catalog,
        default_model: readiness.default_model,
        model_diagnostic: readiness.diagnostic,
        workspace,
    })
}

/// The superagent's target verbs this build serves. The source verb is a new
/// target command, so it is advertised only once the Product Operation
/// Registry has its row: without one, neither the desktop nor the CLI peer
/// host routes the command here, and advertising it would promise a verb a
/// controller cannot reach.
fn superagent_target_capabilities() -> Vec<String> {
    use openbitfun_services_core::dispatch_contract as contract;
    let source_routed = openbitfun_product_domains::remote_surface::operations()
        .iter()
        .any(|operation| operation.id == contract::DISPATCH_TARGET_PROVISION_SOURCE_COMMAND);
    contract::DISPATCH_SUPERAGENT_TARGET_CAPABILITIES
        .iter()
        .filter(|capability| {
            **capability != contract::DISPATCH_WORKSPACE_TARGET_SOURCE_CAPABILITY || source_routed
        })
        .map(|capability| capability.to_string())
        .collect()
}

const fn contract_peer_bundle_capability() -> &'static str {
    openbitfun_services_core::dispatch_contract::DISPATCH_PEER_BUNDLE_CAPABILITY
}

/// Publish is a new target command: advertised only once the registry routes
/// it (see [`superagent_target_capabilities`]).
fn publish_routed() -> bool {
    openbitfun_product_domains::remote_surface::operations()
        .iter()
        .any(|operation| {
            operation.id
                == openbitfun_services_core::dispatch_contract::DISPATCH_TARGET_PUBLISH_COMMAND
        })
}

async fn submit(mut request: DispatchSubmitRequest) -> Result<DispatchSubmitResponse> {
    validate_submit_request(&request)?;
    if let Some(submitter) = request.submitter.as_deref() {
        openbitfun_services_core::dispatch_contract::validate_dispatch_submitter(submitter)
            .map_err(anyhow::Error::msg)?;
    }
    if !runner::is_supported() {
        return Err(runner::unsupported_error());
    }
    openbitfun_agent_runtime::session_control::validate_session_id(&request.session_id)
        .map_err(anyhow::Error::msg)?;
    let mut intent = request.clone();
    // Setup audit is observational metadata. A retry after an ambiguous SSH
    // response will not repeat an installation, so including it in the intent
    // fingerprint would incorrectly turn that safe retry into a conflict.
    intent.setup_audit.clear();
    let store = DispatchStore::open_default()?;
    let existing = {
        let store = store.clone();
        let intent = intent.clone();
        tokio::task::spawn_blocking(move || -> Result<Option<DispatchSubmitResponse>> {
            if let Some((record, state)) = store.load_existing_job_for_intent(&intent)? {
                ensure_worker_spawned(&store, &record.request.job_id, state.state)?;
                return Ok(Some(DispatchSubmitResponse {
                    accepted: true,
                    job_id: record.request.job_id,
                    session_id: record.request.session_id,
                    state: state.state,
                }));
            }
            Ok(None)
        })
        .await
        .context("dispatch submit intent check task failed")??
    };
    if let Some(response) = existing {
        return Ok(response);
    }

    let workspace_path = request.workspace_path.clone();
    let canonical_workspace =
        tokio::task::spawn_blocking(move || canonical_workspace(&workspace_path))
            .await
            .context("dispatch submit workspace canonicalization task failed")??;
    request.workspace_path = canonical_workspace.to_string_lossy().to_string();
    let selected_model = select_ready_model(request.model.as_deref()).await?;
    validate_reasoning_preset(&selected_model, request.reasoning_preset.as_deref()).await?;
    request.model = Some(selected_model);

    let title = request
        .title
        .as_deref()
        .map(str::trim)
        .filter(|title| !title.is_empty())
        .map(|title| truncate_chars(title, 120))
        .unwrap_or_else(|| truncate_chars(request.prompt.trim(), 120));
    request.title = Some(title.clone());

    let request_for_store = request.clone();
    let state = tokio::task::spawn_blocking(move || -> Result<DispatchStateRecord> {
        let outcome = store.create_job_with_intent(intent, request_for_store.clone(), title)?;
        let state = match outcome {
            CreateJobOutcome::Created(state) | CreateJobOutcome::Existing(state) => {
                ensure_worker_spawned(&store, &request_for_store.job_id, state.state)?;
                state
            }
        };
        Ok(state)
    })
    .await
    .context("dispatch submit persistence task failed")??;
    Ok(DispatchSubmitResponse {
        accepted: true,
        job_id: request.job_id,
        session_id: request.session_id,
        state: state.state,
    })
}

/// Start the next turn in an existing dispatch session.
///
/// The job keeps its identity, workspace, and event log; only its run state
/// rewinds so a fresh worker can pick up the queued prompt. That is what makes
/// the controller's projection a continuous transcript instead of one job per
/// message.
async fn continue_job(request: DispatchContinueRequest) -> Result<DispatchContinueResponse> {
    if request.protocol_version != DISPATCH_PROTOCOL_VERSION {
        bail!(
            "unsupported dispatch protocolVersion {}; target requires {}",
            request.protocol_version,
            DISPATCH_PROTOCOL_VERSION
        );
    }
    match request.kind {
        DispatchTurnKind::Prompt => {
            if request.prompt.trim().is_empty() {
                bail!("dispatch follow-up requires a prompt");
            }
        }
        DispatchTurnKind::Compact => {
            if !request.prompt.trim().is_empty() {
                bail!("dispatch compact turns do not take a prompt");
            }
            if !request.attachments.is_empty() {
                bail!("dispatch compact turns do not take attachments");
            }
        }
    }
    validate_attachments(&request.attachments)?;
    if request.prompt.len() > MAX_DISPATCH_TEXT_BYTES {
        bail!("dispatch follow-up prompt exceeds the 32 KiB safety limit");
    }
    if let Some(model) = &request.model {
        if model.trim().is_empty() {
            bail!("dispatch model override cannot be empty");
        }
        if model.len() > 256 {
            bail!("dispatch model override exceeds the 256 byte limit");
        }
    }
    if let Some(preset) = &request.reasoning_preset {
        validate_reasoning_preset_id(preset)?;
    }
    if !runner::is_supported() {
        return Err(runner::unsupported_error());
    }
    let store = DispatchStore::open_default()?;
    let (job, existing_state) = {
        let store = store.clone();
        let request_for_check = request.clone();
        tokio::task::spawn_blocking(move || {
            let job = store.load_job(&request_for_check.job_id)?;
            // A worker may still be settling the previous turn's terminal state.
            reconcile_worker_liveness(&store, &request_for_check.job_id)?;
            let existing = store.load_existing_follow_up_for_intent(&request_for_check)?;
            Ok::<_, anyhow::Error>((job, existing))
        })
        .await
        .context("dispatch continue pre-check task failed")??
    };
    let state = if let Some(state) = existing_state {
        let store = store.clone();
        let job_id = request.job_id.clone();
        let state_value = state.state;
        tokio::task::spawn_blocking(move || ensure_worker_spawned(&store, &job_id, state_value))
            .await
            .context("dispatch continue spawn task failed")??;
        state
    } else {
        // Validate before acceptance, just as submit does. The worker still
        // revalidates in case target configuration changes before it starts.
        let selected_model =
            select_ready_model(request.model.as_deref().or(job.request.model.as_deref())).await?;
        validate_reasoning_preset(
            &selected_model,
            request
                .reasoning_preset
                .as_deref()
                .or(job.request.reasoning_preset.as_deref()),
        )
        .await?;
        let request_for_queue = request.clone();
        tokio::task::spawn_blocking(move || -> Result<DispatchStateRecord> {
            let state = store.queue_follow_up_turn(&request_for_queue)?;
            ensure_worker_spawned(&store, &request_for_queue.job_id, state.state)?;
            Ok(state)
        })
        .await
        .context("dispatch continue queue task failed")??
    };
    Ok(DispatchContinueResponse {
        accepted: true,
        job_id: request.job_id,
        session_id: job.request.session_id,
        turn_id: request.turn_id,
        state: state.state,
    })
}

/// Answer a read-only session question from persisted state.
///
/// Deliberately runtime-free: `PersistenceManager` reads the session's
/// on-disk turns directly, so the query can run while a detached worker owns
/// the live session without contending for anything.
async fn query(request: DispatchQueryRequest) -> Result<serde_json::Value> {
    let store = DispatchStore::open_default()?;
    query_in_store(&store, request).await
}

async fn query_in_store(
    store: &DispatchStore,
    request: DispatchQueryRequest,
) -> Result<serde_json::Value> {
    let store_for_job = store.clone();
    let job_id = request.job_id.clone();
    let job = tokio::task::spawn_blocking(move || store_for_job.load_job(&job_id))
        .await
        .context("dispatch query job load task failed")??;
    match request.kind {
        DispatchQueryKind::ResultSummary => {
            if request.file_path.is_some() || request.file_chunk.is_some() {
                bail!("resultSummary does not accept a filePath");
            }
            let store = store.clone();
            let job_id = request.job_id;
            tokio::task::spawn_blocking(move || {
                let state = store.load_state(&job_id)?;
                Ok::<_, anyhow::Error>(serde_json::to_value(summary::result_summary(
                    &store, &job_id, &state,
                )?)?)
            })
            .await
            .context("dispatch query result summary task failed")?
        }
        DispatchQueryKind::ReadFileChunk => {
            let reference = request
                .file_path
                .as_deref()
                .filter(|path| !path.trim().is_empty())
                .context("Dispatch file query requires a filePath")?;
            let chunk_request = request
                .file_chunk
                .as_ref()
                .context("Dispatch chunk query requires fileChunk")?;
            let chunk = openbitfun_core::service::output_files::read_dispatch_output_chunk(
                Path::new(&job.request.workspace_path),
                &job.request.session_id,
                reference,
                chunk_request,
            )
            .await
            .map_err(anyhow::Error::msg)?;
            let mut response = serde_json::to_value(chunk)?;
            let fields = response.as_object_mut().expect("chunk is an object");
            fields.insert("kind".into(), serde_json::json!("readFileChunk"));
            fields.insert("jobId".into(), serde_json::json!(request.job_id));
            fields.insert(
                "sessionId".into(),
                serde_json::json!(job.request.session_id),
            );
            Ok(response)
        }
        DispatchQueryKind::ReadFile => {
            if request.file_chunk.is_some() {
                bail!("Text queries do not accept fileChunk");
            }
            let file_path = request
                .file_path
                .as_deref()
                .filter(|path| !path.trim().is_empty())
                .context("Dispatch file query requires a filePath")?
                .to_string();
            let workspace_path = job.request.workspace_path.clone();
            let (path, content) = tokio::task::spawn_blocking(move || {
                query_file::read_workspace_file(Path::new(&workspace_path), &file_path)
            })
            .await
            .context("dispatch query file read task failed")??;
            Ok(serde_json::json!({
                "kind": "readFile",
                "jobId": request.job_id,
                "sessionId": job.request.session_id,
                "filePath": path,
                "content": content,
            }))
        }
        DispatchQueryKind::UsageReport => {
            if request.file_path.is_some() || request.file_chunk.is_some() {
                bail!("usageReport does not accept a filePath");
            }
            let path_manager = openbitfun_core::infrastructure::PathManager::new()
                .map_err(|error| anyhow::anyhow!("resolve OpenBitFun storage root: {error}"))?;
            let token_usage = openbitfun_core::service::token_usage::TokenUsageService::for_queries(
                &path_manager,
            );
            let persistence = openbitfun_core::agentic::persistence::PersistenceManager::new(
                std::sync::Arc::new(path_manager),
            )
            .map_err(|error| anyhow::anyhow!("open session persistence: {error}"))?;
            let report = openbitfun_core::service::session_usage::generate_session_usage_report(
                &persistence,
                Some(&token_usage),
                openbitfun_core::service::session_usage::SessionUsageReportRequest {
                    session_id: job.request.session_id.clone(),
                    // Dispatch jobs are keyed by the canonical target path the
                    // controller submitted; the target workspace record only
                    // exists while the worker runtime is up.
                    workspace_id: None,
                    workspace_path: Some(job.request.workspace_path.clone()),
                    remote_connection_id: None,
                    remote_ssh_host: None,
                    include_system_prompt_preview: false,
                    context_preview_category: None,
                    context_estimate: None,
                    include_hidden_subagents: false,
                },
            )
            .await
            .map_err(|error| anyhow::anyhow!("generate dispatch usage report: {error}"))?;
            serde_json::to_value(serde_json::json!({
                "kind": "usageReport",
                "sessionId": job.request.session_id,
                "report": report,
            }))
            .context("encode dispatch usage report")
        }
    }
}

fn ensure_worker_spawned(
    store: &DispatchStore,
    job_id: &str,
    state: DispatchJobState,
) -> Result<()> {
    if state != DispatchJobState::Queued {
        return Ok(());
    }
    let Some(_spawn_claim) = store.try_claim_worker_spawn(job_id)? else {
        return Ok(());
    };
    // The claim is an OS file lock held through spawn. If this controller
    // crashes, an idempotent submit retry can claim and recover the job.
    if let Err(error) = runner::spawn(store, job_id) {
        store.mark_state(
            job_id,
            DispatchJobState::Failed,
            None,
            Some(format!("{error:#}")),
        )?;
        return Err(error);
    }
    Ok(())
}

fn status(request: DispatchStatusRequest) -> Result<serde_json::Value> {
    let store = DispatchStore::open_default()?;
    if request.summary_only {
        let state = reconcile_worker_liveness(&store, &request.job_id)?;
        if state.state.is_terminal() {
            store.clear_pending_permissions(&request.job_id);
        }
        return Ok(serde_json::to_value(summary::status_summary(
            &store,
            &request.job_id,
            &state,
        )?)?);
    }
    Ok(serde_json::to_value(full_status(&store, request)?)?)
}

fn full_status(
    store: &DispatchStore,
    request: DispatchStatusRequest,
) -> Result<DispatchStatusResponse> {
    let state = reconcile_worker_liveness(store, &request.job_id)?;
    let page = store.read_events(&request.job_id, request.cursor)?;
    if state.state.is_terminal() {
        store.clear_pending_permissions(&request.job_id);
    }
    let pending_permissions = if state.state.is_terminal() {
        Vec::new()
    } else {
        store.list_pending_permissions(&request.job_id)?
    };
    let pending_questions = if state.state.is_terminal() {
        Vec::new()
    } else {
        store.list_pending_questions(&request.job_id)?
    };
    Ok(DispatchStatusResponse {
        state: state.state,
        cursor: page.cursor,
        events: page.events,
        pending_permissions,
        pending_questions,
        cursor_reset: page.cursor_reset,
        history_truncated: page.history_truncated,
        event_log_complete: !page.history_truncated && page.omitted_event_count == 0,
        omitted_event_count: page.omitted_event_count,
        last_error: state.last_error,
    })
}

fn answer(request: DispatchAnswerRequest) -> Result<DispatchAnswerResponse> {
    if request.request_id.trim().is_empty() || request.request_id.len() > 512 {
        bail!("dispatch permission requestId is invalid");
    }
    if matches!(
        &request.reply,
        openbitfun_agent_runtime::sdk::PermissionReply::Reject {
            feedback: Some(feedback)
        } if feedback.len() > MAX_DISPATCH_TEXT_BYTES
    ) {
        bail!("dispatch permission feedback exceeds the 32 KiB request limit");
    }
    let store = DispatchStore::open_default()?;
    let job = store.load_job(&request.job_id)?;
    if job.request.approval_policy != protocol::DispatchApprovalPolicy::Remote {
        bail!("dispatch job does not use remote approval policy");
    }
    let resolved =
        store.save_permission_answer(&request.job_id, &request.request_id, request.reply)?;
    Ok(DispatchAnswerResponse { resolved })
}

/// Answer a waiting question of a job (`user_question_mailbox_v1`). Any
/// approval policy: a question is not a permission, and the job opted into
/// the mailbox when it was submitted.
fn answer_question(
    request: protocol::DispatchQuestionAnswerRequest,
) -> Result<DispatchAnswerResponse> {
    if request.request_id.trim().is_empty() || request.request_id.len() > 512 {
        bail!("dispatch question requestId is invalid");
    }
    validate_question_answers(&request.answers)?;
    let store = DispatchStore::open_default()?;
    let job = store.load_job(&request.job_id)?;
    if !job.request.user_questions {
        bail!("dispatch job did not enable the question mailbox");
    }
    let resolved =
        store.save_question_answer(&request.job_id, &request.request_id, request.answers)?;
    Ok(DispatchAnswerResponse { resolved })
}

/// The Runtime's answer shape: an object from question index to a label or
/// a list of labels, bounded like other mailbox text.
fn validate_question_answers(answers: &serde_json::Value) -> Result<()> {
    let Some(map) = answers.as_object() else {
        bail!("dispatch question answers must be an object keyed by question index");
    };
    if map.is_empty() || map.len() > 16 {
        bail!("dispatch question answers must answer 1-16 questions");
    }
    for (key, value) in map {
        if key.parse::<u8>().is_err() {
            bail!("dispatch question answers are keyed by question index, not '{key}'");
        }
        let ok = match value {
            serde_json::Value::String(_) => true,
            serde_json::Value::Array(items) => items.iter().all(serde_json::Value::is_string),
            _ => false,
        };
        if !ok {
            bail!("dispatch question answer {key} must be a label or a list of labels");
        }
    }
    if serde_json::to_vec(answers)?.len() > MAX_DISPATCH_TEXT_BYTES {
        bail!("dispatch question answers exceed the 32 KiB request limit");
    }
    Ok(())
}

fn append(request: DispatchAppendRequest) -> Result<DispatchAppendResponse> {
    // An attachment-only message is a real message; only one with neither text
    // nor attachments is empty.
    if request.content.trim().is_empty() && request.attachments.is_empty() {
        bail!("dispatch appended message cannot be empty");
    }
    let total_bytes = request
        .content
        .len()
        .saturating_add(request.display_content.as_ref().map_or(0, String::len));
    if total_bytes > MAX_DISPATCH_TEXT_BYTES {
        bail!("dispatch appended message exceeds the 32 KiB request limit");
    }
    validate_attachments(&request.attachments)?;
    let message_id = request.message_id.clone();
    let store = DispatchStore::open_default()?;
    let accepted = store.enqueue_append_message(request)?;
    Ok(DispatchAppendResponse {
        accepted,
        message_id,
    })
}

fn cancel(request: DispatchCancelRequest) -> Result<DispatchCancelResponse> {
    let store = DispatchStore::open_default()?;
    cancel_in_store(&store, request, runner::terminate_worker)
}

fn cancel_in_store(
    store: &DispatchStore,
    request: DispatchCancelRequest,
    terminate: impl FnOnce(u32, &str) -> Result<bool>,
) -> Result<DispatchCancelResponse> {
    cancel_in_store_with_process_checks(
        store,
        request,
        runner::process_alive,
        runner::worker_process_alive,
        terminate,
    )
}

fn cancel_in_store_with_process_checks(
    store: &DispatchStore,
    request: DispatchCancelRequest,
    process_alive: impl Fn(u32) -> bool,
    worker_process_alive: impl Fn(u32, &str) -> bool,
    terminate: impl FnOnce(u32, &str) -> Result<bool>,
) -> Result<DispatchCancelResponse> {
    let before = store.request_cancel(&request.job_id)?;
    if before.state.is_terminal() {
        return Ok(DispatchCancelResponse {
            cancelled: before.state == DispatchJobState::Cancelled,
        });
    }

    if let Some(pid) = store.read_pid(&request.job_id)? {
        if process_alive(pid) && !worker_process_alive(pid, &request.job_id) {
            let message = format!(
                "dispatch worker pid {pid} no longer matches job '{}'",
                request.job_id
            );
            let (failed, _) = store.mark_state(
                &request.job_id,
                DispatchJobState::Failed,
                before.turn_id.as_deref(),
                Some(message.clone()),
            )?;
            store.remove_pid(&request.job_id);
            store.clear_preparing(&request.job_id);
            store.clear_pending_permissions(&request.job_id);
            debug_assert_eq!(failed.state, DispatchJobState::Failed);
            bail!("{message}; the unrelated process was not signalled");
        }
        if let Err(error) = terminate(pid, &request.job_id) {
            let detail = format!("{error:#}");
            let _ = store.record_nonterminal_error(&request.job_id, &detail);
            return Err(error);
        }
    } else if store
        .preparing_age_seconds(&request.job_id)?
        .is_some_and(|age| age <= runner::PREPARING_GRACE_SECONDS)
    {
        // The durable request is enough for the new worker to stop itself.
        // The caller must poll/retry before treating cancellation as complete.
        return Ok(DispatchCancelResponse { cancelled: false });
    }

    // The worker process group is now confirmed absent. Persisting Cancelled
    // after that fact prevents a failed signal from hiding a still-running job.
    let (cancelled_state, _) = store.mark_state(
        &request.job_id,
        DispatchJobState::Cancelled,
        before.turn_id.as_deref(),
        Some("Dispatch cancelled by request".to_string()),
    )?;
    store.clear_preparing(&request.job_id);
    store.remove_pid(&request.job_id);
    store.clear_pending_permissions(&request.job_id);
    Ok(DispatchCancelResponse {
        cancelled: cancelled_state.state == DispatchJobState::Cancelled,
    })
}

fn list(request: DispatchListRequest) -> Result<Vec<DispatchJobListEntry>> {
    if let Some(submitter) = request.submitter.as_deref() {
        openbitfun_services_core::dispatch_contract::validate_dispatch_submitter(submitter)
            .map_err(anyhow::Error::msg)?;
    }
    let store = DispatchStore::open_default()?;
    let initial = filter_by_submitter(store.list_jobs()?, request.submitter.as_deref());
    for job in &initial {
        let _ = reconcile_worker_liveness(&store, &job.job_id);
    }
    Ok(filter_by_submitter(
        store.list_jobs()?,
        request.submitter.as_deref(),
    ))
}

fn filter_by_submitter(
    jobs: Vec<DispatchJobListEntry>,
    submitter: Option<&str>,
) -> Vec<DispatchJobListEntry> {
    match submitter {
        None => jobs,
        Some(submitter) => jobs
            .into_iter()
            .filter(|job| job.submitter.as_deref() == Some(submitter))
            .collect(),
    }
}

fn reconcile_worker_liveness(store: &DispatchStore, job_id: &str) -> Result<DispatchStateRecord> {
    reconcile_worker_liveness_with_spawn(store, job_id, |store, job_id| {
        ensure_worker_spawned(store, job_id, DispatchJobState::Queued)
    })
}

fn reconcile_worker_liveness_with_spawn(
    store: &DispatchStore,
    job_id: &str,
    spawn_queued_worker: impl FnOnce(&DispatchStore, &str) -> Result<()>,
) -> Result<DispatchStateRecord> {
    let state = store.load_state(job_id)?;
    if state.state.is_terminal() {
        return Ok(state);
    }
    let worker_pid = store.read_pid(job_id)?;
    if let Some(pid) = worker_pid {
        if runner::worker_process_alive(pid, job_id) {
            return Ok(state);
        }
        // A live PID with the wrong command is a recycled or replaced process.
        // Never signal it, but do settle the orphaned job instead of leaving an
        // unobservable non-terminal state forever.
        if runner::process_alive(pid) {
            let message =
                format!("dispatch worker pid {pid} is live but does not match job '{job_id}'");
            let (reconciled, _) = store.mark_state(
                job_id,
                DispatchJobState::Failed,
                state.turn_id.as_deref(),
                Some(message),
            )?;
            store.remove_pid(job_id);
            store.clear_preparing(job_id);
            store.clear_pending_permissions(job_id);
            return Ok(reconciled);
        }
        if runner::worker_process_group_alive(pid) {
            // The PID marker authenticates only the leader. Once that process
            // is gone, the same numeric PGID may belong to unrelated work and
            // must never be signalled by an observer.
            let message = format!(
                "Dispatch worker leader pid {pid} exited while process group {pid} is still live; \
                 refusing to signal the unverified process group because its PGID may have been reused"
            );
            let (reconciled, _) = store.mark_state(
                job_id,
                DispatchJobState::Failed,
                state.turn_id.as_deref(),
                Some(message),
            )?;
            store.remove_pid(job_id);
            store.clear_preparing(job_id);
            store.clear_pending_permissions(job_id);
            return Ok(reconciled);
        }
    }
    if store
        .preparing_age_seconds(job_id)?
        .is_some_and(|age| age <= runner::PREPARING_GRACE_SECONDS)
    {
        return Ok(state);
    }
    if worker_pid.is_none()
        && state.state == DispatchJobState::Queued
        && state.turn_id.is_none()
        && !state.cancel_requested()
    {
        // job.json is committed before the submit controller starts the
        // detached worker. If that controller dies in between, status/list is
        // the durable observer that recovers the unstarted job. Once a worker
        // PID has been recorded, an unexplained exit still settles Failed
        // below instead of creating a crash-restart loop.
        spawn_queued_worker(store, job_id)?;
        return store.load_state(job_id);
    }
    // Re-read the cancellation marker while holding the transition lock. A
    // concurrent cancel request must win over a stale Failed decision here.
    let reconciled = store.settle_exited_worker(job_id)?;
    store.remove_pid(job_id);
    store.clear_preparing(job_id);
    store.clear_pending_permissions(job_id);
    Ok(reconciled)
}

async fn inspect_model_readiness() -> Result<ModelReadiness> {
    openbitfun_core::service::config::initialize_global_config()
        .await
        .map_err(|error| anyhow!("Failed to initialize target model configuration: {error}"))?;
    let config_service = openbitfun_core::service::config::get_global_config_service()
        .await
        .map_err(|error| anyhow!("Failed to read target model configuration: {error}"))?;
    let config: GlobalConfig = config_service
        .get_config(None)
        .await
        .map_err(|error| anyhow!("Failed to load target model configuration: {error}"))?;
    let mut model_catalog =
        openbitfun_core::get_ai_model_catalog()
            .await
            .unwrap_or(openbitfun_core::AIModelCatalog {
                version: 0,
                models: Vec::new(),
                provider_catalog: Default::default(),
                default_models: Default::default(),
                mode_default_model_id: None,
                models_dev_reasoning_catalog: None,
                reasoning_preset_selection_supported: true,
                session_model_write_fence_supported: false,
                session_model_write_token: None,
                session_model_id: None,
                session_reasoning_preset: None,
            });

    AIClientFactory::initialize_global()
        .await
        .map_err(|error| anyhow!("Failed to initialize target model clients: {error}"))?;
    let factory = AIClientFactory::get_global()
        .await
        .map_err(|error| anyhow!("Failed to inspect target model clients: {error}"))?;

    let mut available_models = Vec::new();
    let mut unavailable = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for model in config.ai.models.iter().filter(|model| model.enabled) {
        if model.id.trim().is_empty() || !seen.insert(model.id.clone()) {
            unavailable.push("an enabled model has an empty or duplicate id".to_string());
            continue;
        }
        if matches!(model.auth, AuthConfig::ApiKey) && model.api_key.trim().is_empty() {
            unavailable.push(format!("model '{}' has no configured credential", model.id));
            continue;
        }
        match factory.get_client_by_id(&model.id).await {
            Ok(_) => available_models.push(model.id.clone()),
            Err(error) => unavailable.push(format!("model '{}': {error}", model.id)),
        }
    }
    available_models.sort();
    model_catalog.models.retain(|model| {
        available_models
            .iter()
            .any(|available| available == &model.id)
    });
    let selected_default = crate::model_selection::resolve_mode_model_id(&config.ai);
    let default_model = selected_default
        .filter(|model| available_models.iter().any(|available| available == model));

    let diagnostic = if available_models.is_empty() {
        Some(if unavailable.is_empty() {
            "No enabled AI model is configured on the target".to_string()
        } else {
            format!(
                "No ready AI model on the target: {}",
                unavailable.join("; ")
            )
        })
    } else if default_model.is_none() {
        Some("Ready models exist, but the target mode default does not resolve to one".to_string())
    } else if unavailable.is_empty() {
        None
    } else {
        Some(format!(
            "Some target models are unavailable: {}",
            unavailable.join("; ")
        ))
    };
    Ok(ModelReadiness {
        available_models,
        default_model,
        diagnostic,
        model_catalog,
    })
}

fn validate_reasoning_preset_id(preset: &str) -> Result<()> {
    let preset = preset.trim();
    if preset.is_empty() || preset.len() > 128 || preset.bytes().any(|byte| byte.is_ascii_control())
    {
        bail!("dispatch reasoning preset must contain 1-128 printable bytes");
    }
    Ok(())
}

async fn validate_reasoning_preset(model_id: &str, preset: Option<&str>) -> Result<()> {
    let Some(preset) = preset.map(str::trim).filter(|preset| !preset.is_empty()) else {
        return Ok(());
    };
    validate_reasoning_preset_id(preset)?;
    if preset == "auto" {
        return Ok(());
    }
    let catalog = openbitfun_core::get_ai_model_catalog()
        .await
        .map_err(|error| anyhow!("Failed to load target reasoning catalog: {error}"))?;
    let supported = catalog
        .models
        .iter()
        .find(|model| model.id == model_id)
        .and_then(|model| model.reasoning.as_ref())
        .is_some_and(|reasoning| {
            reasoning
                .presets
                .iter()
                .any(|candidate| candidate.id == preset)
        });
    if !supported {
        bail!("Reasoning preset '{preset}' is not available for target model '{model_id}'");
    }
    Ok(())
}

async fn select_ready_model(requested: Option<&str>) -> Result<String> {
    let readiness = inspect_model_readiness().await?;
    if let Some(requested) = requested.map(str::trim).filter(|model| !model.is_empty()) {
        if readiness
            .available_models
            .iter()
            .any(|available| available == requested)
        {
            return Ok(requested.to_string());
        }
        bail!(
            "Requested model '{}' is not ready on the dispatch target{}",
            requested,
            readiness
                .diagnostic
                .as_deref()
                .map(|diagnostic| format!(": {diagnostic}"))
                .unwrap_or_default()
        );
    }
    readiness.default_model.ok_or_else(|| {
        anyhow!(
            "{}",
            readiness
                .diagnostic
                .unwrap_or_else(|| "No ready default model is configured on the target".to_string())
        )
    })
}

pub(super) async fn ensure_selected_model_ready(selected: Option<&str>) -> Result<()> {
    let selected = selected
        .map(str::trim)
        .filter(|model| !model.is_empty())
        .ok_or_else(|| anyhow!("dispatch job has no selected target model"))?;
    let resolved = select_ready_model(Some(selected)).await?;
    if resolved != selected {
        bail!("dispatch target model changed before worker startup");
    }
    Ok(())
}

fn inspect_workspace(workspace_path: &str) -> Result<DispatchWorkspaceProbe> {
    let path = PathBuf::from(workspace_path);
    let exists = path.exists();
    let is_directory = path.is_dir();
    let canonical = if is_directory {
        path.canonicalize().unwrap_or(path)
    } else {
        path
    };
    let RepositoryProbe {
        is_git_repository,
        trust_required,
    } = is_directory
        .then(|| classify_repository_probe(git_probe(&canonical, REV_PARSE_INSIDE_WORK_TREE)))
        .unwrap_or_default();
    let branch = is_git_repository
        .then(|| git_output(&canonical, &["branch", "--show-current"]))
        .flatten()
        .map(|branch| branch.trim().to_string())
        .filter(|branch| !branch.is_empty());
    // `None`, not `Some(false)`, when the read never landed: a repository we
    // were not allowed to inspect is not a clean one.
    let dirty = is_git_repository
        .then(|| git_output(&canonical, &["status", "--porcelain"]))
        .flatten()
        .map(|output| !output.trim().is_empty());
    let (ahead, behind) = if is_git_repository {
        git_output(
            &canonical,
            &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
        )
        .and_then(|counts| parse_ahead_behind(&counts))
        .map(|(ahead, behind)| (Some(ahead), Some(behind)))
        .unwrap_or((None, None))
    } else {
        (None, None)
    };
    Ok(DispatchWorkspaceProbe {
        path: canonical.to_string_lossy().to_string(),
        exists,
        is_directory,
        is_git_repository,
        trust_required: trust_required.then_some(true),
        branch,
        dirty,
        ahead,
        behind,
        workspace_id: None,
        name: None,
        head_commit: None,
        remote_url: None,
    })
}

fn parse_ahead_behind(counts: &str) -> Option<(u64, u64)> {
    let mut counts = counts.split_whitespace();
    let ahead = counts.next()?.parse().ok()?;
    let behind = counts.next()?.parse().ok()?;
    (counts.next().is_none()).then_some((ahead, behind))
}

fn git_output(workspace: &Path, args: &[&str]) -> Option<String> {
    git_probe(workspace, args).ok().map(|probe| probe.stdout)
}

struct GitProbeOutput {
    stdout: String,
    diagnostic: String,
}

const REV_PARSE_INSIDE_WORK_TREE: &[&str] = &["rev-parse", "--is-inside-work-tree"];

#[derive(Default)]
struct RepositoryProbe {
    is_git_repository: bool,
    trust_required: bool,
}

/// Reads what a `rev-parse --is-inside-work-tree` probe actually established.
///
/// A repository Git refuses on ownership grounds still *is* one. Reporting
/// `false` — which is what discarding the exit status did — tells a detached
/// controller there is nothing to review here, and hides the one thing that
/// would fix it. Same reading as the local and remote probes
/// (`is_git_repository`, `remote_probe_found_repository`).
fn classify_repository_probe(result: Result<GitProbeOutput, GitProbeOutput>) -> RepositoryProbe {
    match result {
        Ok(output) => RepositoryProbe {
            is_git_repository: output.stdout.trim() == "true",
            trust_required: false,
        },
        Err(failure) => {
            let trust_required = trust::is_untrusted_repository_message(&failure.diagnostic);
            RepositoryProbe {
                is_git_repository: trust_required,
                trust_required,
            }
        }
    }
}

/// Runs one probe command, keeping the diagnostic a failure came with.
///
/// `LC_ALL=C` for the same reason every other executor pins it: the classifier
/// below matches Git's English prose, and a localized host would otherwise make
/// an ownership rejection unrecognizable.
fn git_probe(workspace: &Path, args: &[&str]) -> Result<GitProbeOutput, GitProbeOutput> {
    let output = openbitfun_services_core::process_manager::create_command("git")
        .env("LC_ALL", "C")
        .arg("-C")
        .arg(workspace)
        .args(args)
        .output();
    let Ok(output) = output else {
        return Err(GitProbeOutput {
            stdout: String::new(),
            diagnostic: String::new(),
        });
    };
    let probe = GitProbeOutput {
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        diagnostic: String::from_utf8_lossy(&output.stderr).to_string(),
    };
    if output.status.success() {
        Ok(probe)
    } else {
        Err(probe)
    }
}

fn canonical_workspace(workspace_path: &str) -> Result<PathBuf> {
    let path = PathBuf::from(workspace_path.trim());
    if !path.is_absolute() {
        bail!("dispatch workspacePath must be absolute");
    }
    let canonical = path
        .canonicalize()
        .with_context(|| format!("resolve dispatch workspace {}", path.display()))?;
    if !canonical.is_dir() {
        bail!(
            "dispatch workspace does not exist or is not a directory: {}",
            canonical.display()
        );
    }
    Ok(canonical)
}

fn validate_attachments(attachments: &[protocol::DispatchAttachment]) -> Result<()> {
    protocol::validate_dispatch_attachments(attachments).map_err(anyhow::Error::msg)
}

fn validate_submit_request(request: &DispatchSubmitRequest) -> Result<()> {
    if request.protocol_version != DISPATCH_PROTOCOL_VERSION {
        bail!(
            "unsupported dispatch protocolVersion {}; target requires {}",
            request.protocol_version,
            DISPATCH_PROTOCOL_VERSION
        );
    }
    if request.job_id.trim().is_empty() {
        bail!("dispatch jobId cannot be empty");
    }
    if request.session_id.trim().is_empty() {
        bail!("dispatch sessionId cannot be empty");
    }
    if request.agent_type.trim().is_empty() {
        bail!("dispatch agentType cannot be empty");
    }
    if request.prompt.trim().is_empty() {
        bail!("dispatch prompt cannot be empty");
    }
    if request.prompt.len() > MAX_DISPATCH_TEXT_BYTES {
        bail!("dispatch prompt exceeds the 32 KiB request limit");
    }
    validate_attachments(&request.attachments)?;
    if request.setup_audit.len() > 32 {
        bail!("dispatch setup audit exceeds the 32-event safety limit");
    }
    for event in &request.setup_audit {
        if !openbitfun_services_core::dispatch_contract::dispatch_supported_setup_audit_actions()
            .any(|action| action == event.action)
        {
            bail!("dispatch setup audit contains an unsupported action");
        }
        if event.timestamp.trim().is_empty()
            || serde_json::to_vec(&event.details)?.len() > MAX_DISPATCH_TEXT_BYTES
        {
            bail!("dispatch setup audit event is invalid or too large");
        }
    }
    Ok(())
}

fn parse<T: DeserializeOwned>(input: serde_json::Value) -> Result<T> {
    serde_json::from_value(input).context("invalid dispatch request")
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    let mut chars = value.chars();
    let truncated = chars.by_ref().take(max_chars).collect::<String>();
    if chars.next().is_some() {
        format!("{truncated}…")
    } else {
        truncated
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dispatch::protocol::{DispatchApprovalPolicy, DispatchSubmitRequest};

    fn probe_failure(diagnostic: &str) -> Result<GitProbeOutput, GitProbeOutput> {
        Err(GitProbeOutput {
            stdout: String::new(),
            diagnostic: diagnostic.to_string(),
        })
    }

    /// A shared host where the workspace belongs to another account is the
    /// ordinary case for detached dispatch. Answering "not a Git repository"
    /// there sends the controller looking for a repository that is right where
    /// it said it was.
    #[test]
    fn an_ownership_rejection_still_reports_a_repository() {
        let probe = classify_repository_probe(probe_failure(
            "fatal: detected dubious ownership in repository at '/srv/shared/repo'",
        ));

        assert!(probe.is_git_repository);
        assert!(probe.trust_required);
    }

    #[test]
    fn a_missing_repository_stays_absent_and_needs_no_trust() {
        let probe = classify_repository_probe(probe_failure(
            "fatal: not a git repository (or any of the parent directories): .git",
        ));

        assert!(!probe.is_git_repository);
        assert!(!probe.trust_required);
    }

    #[test]
    fn a_successful_probe_reads_its_answer() {
        let yes = classify_repository_probe(Ok(GitProbeOutput {
            stdout: "true\n".to_string(),
            diagnostic: String::new(),
        }));
        assert!(yes.is_git_repository);
        assert!(!yes.trust_required);

        let no = classify_repository_probe(Ok(GitProbeOutput {
            stdout: "false\n".to_string(),
            diagnostic: String::new(),
        }));
        assert!(!no.is_git_repository);
    }

    fn test_request(job_id: &str) -> DispatchSubmitRequest {
        DispatchSubmitRequest {
            protocol_version: DISPATCH_PROTOCOL_VERSION,
            job_id: job_id.to_string(),
            session_id: format!("session-{job_id}"),
            workspace_path: "/tmp/workspace".to_string(),
            agent_type: "Standard".to_string(),
            prompt: "task".to_string(),
            approval_policy: DispatchApprovalPolicy::RejectAndReport,
            model: Some("model-1".to_string()),
            reasoning_preset: None,
            title: Some("Task".to_string()),
            attachments: Vec::new(),
            setup_audit: Vec::new(),
            submitter: None,
            user_questions: false,
        }
    }

    #[tokio::test]
    async fn binary_query_uses_durable_job_origin_and_validates_continuations() {
        let dir = tempfile::tempdir().unwrap();
        let workspace = dir.path().join("workspace");
        std::fs::create_dir(&workspace).unwrap();
        std::fs::write(workspace.join("image.png"), [0u8, 255, 1, 2]).unwrap();
        let store = DispatchStore::open(dir.path().join("dispatch")).unwrap();
        let mut job = test_request("binary-query");
        job.workspace_path = workspace.to_string_lossy().into_owned();
        store.create_job(job, "Binary output".into()).unwrap();
        let request: DispatchQueryRequest=parse(serde_json::json!({"jobId":"binary-query","kind":"readFileChunk","filePath":"image.png","fileChunk":{"offset":0,"limit":2}})).unwrap();
        let first = query_in_store(&store, request).await.unwrap();
        assert_eq!(first["kind"], "readFileChunk");
        assert_eq!(first["sessionId"], "session-binary-query");
        assert_eq!(first["contentBase64"], "AP8=");
        let resumed = serde_json::json!({"jobId":"binary-query","kind":"readFileChunk","filePath":"image.png","fileChunk":{"offset":2,"limit":2,"expectedRevision":first["revision"]}});
        let second = query_in_store(&store, parse(resumed.clone()).unwrap())
            .await
            .unwrap();
        assert_eq!(second["contentBase64"], "AQI=");
        std::fs::write(workspace.join("image.png"), [3u8, 4, 5, 6, 7]).unwrap();
        assert!(query_in_store(&store, parse(resumed).unwrap())
            .await
            .is_err());
        let escape = serde_json::json!({"jobId":"binary-query","kind":"readFileChunk","filePath":"../outside.png","fileChunk":{"offset":0,"limit":2}});
        assert!(query_in_store(&store, parse(escape).unwrap())
            .await
            .is_err());
    }

    #[test]
    fn submit_protocol_requires_version_and_explicit_unattended_policy() {
        let missing = serde_json::json!({
            "protocolVersion": DISPATCH_PROTOCOL_VERSION,
            "jobId": "job-1",
            "sessionId": "session-1",
            "workspacePath": "/tmp/workspace",
            "agentType": "Standard",
            "prompt": "task"
        });
        assert!(parse::<DispatchSubmitRequest>(missing).is_err());

        let request: DispatchSubmitRequest = parse(serde_json::json!({
            "protocolVersion": DISPATCH_PROTOCOL_VERSION,
            "jobId": "job-1",
            "sessionId": "session-1",
            "workspacePath": "/tmp/workspace",
            "agentType": "Standard",
            "prompt": "task",
            "approvalPolicy": "reject-and-report"
        }))
        .expect("explicit policy");
        assert_eq!(
            request.approval_policy,
            DispatchApprovalPolicy::RejectAndReport
        );

        let missing_version = serde_json::json!({
            "jobId": "job-1",
            "sessionId": "session-1",
            "workspacePath": "/tmp/workspace",
            "agentType": "Standard",
            "prompt": "task",
            "approvalPolicy": "reject-and-report"
        });
        assert!(parse::<DispatchSubmitRequest>(missing_version).is_err());

        let mut wrong_version = request;
        wrong_version.protocol_version = DISPATCH_PROTOCOL_VERSION + 1;
        assert!(validate_submit_request(&wrong_version).is_err());
    }

    #[test]
    fn question_answers_use_the_runtime_shape_and_stay_bounded() {
        for ok in [
            serde_json::json!({"0": "sqlite"}),
            serde_json::json!({"0": ["a", "b"], "1": "x"}),
        ] {
            assert!(validate_question_answers(&ok).is_ok(), "{ok}");
        }
        for bad in [
            serde_json::json!("sqlite"),
            serde_json::json!({}),
            serde_json::json!({"first": "a"}),
            serde_json::json!({"0": 1}),
            serde_json::json!({"0": ["a", 2]}),
            serde_json::json!({"0": "x".repeat(MAX_DISPATCH_TEXT_BYTES + 1)}),
        ] {
            assert!(validate_question_answers(&bad).is_err(), "{bad}");
        }
        // The question shape is strict on its own and never a permission.
        let parsed: protocol::DispatchQuestionAnswerRequest = serde_json::from_value(
            serde_json::json!({"jobId": "j", "requestId": "t", "answers": {"0": "a"}}),
        )
        .unwrap();
        assert_eq!(parsed.request_id, "t");
        assert!(
            serde_json::from_value::<protocol::DispatchQuestionAnswerRequest>(
                serde_json::json!({"jobId": "j", "requestId": "t", "answers": {}, "reply": "once"})
            )
            .is_err()
        );
    }

    #[test]
    fn phase_two_capabilities_are_advertised_with_their_routes() {
        use openbitfun_services_core::dispatch_contract as contract;
        assert!(publish_routed(), "the registry routes the publish verb");
        assert_eq!(
            contract_peer_bundle_capability(),
            contract::DISPATCH_PEER_BUNDLE_CAPABILITY
        );
        // Peer import itself is the host's to advertise (it holds the Link
        // connection), never the bare runner's.
        assert!(!superagent_target_capabilities()
            .iter()
            .any(|c| c == contract::DISPATCH_WORKSPACE_PEER_IMPORT_CAPABILITY));
    }

    #[test]
    fn title_preview_is_unicode_safe_and_bounded() {
        let title = truncate_chars(&"任务".repeat(80), 120);
        assert_eq!(title.chars().count(), 121);
        assert!(title.ends_with('…'));
    }

    #[test]
    fn git_upstream_counts_preserve_ahead_then_behind_order() {
        assert_eq!(parse_ahead_behind("3\t5\n"), Some((3, 5)));
        assert_eq!(parse_ahead_behind("3"), None);
        assert_eq!(parse_ahead_behind("unknown 5"), None);
    }

    #[test]
    fn cancel_identity_mismatch_fails_orphaned_job_without_signalling_process() {
        let dir = tempfile::tempdir().expect("tempdir");
        let store = DispatchStore::open(dir.path().join("dispatch")).expect("store");
        store
            .create_job(test_request("job-no-match"), "Task".to_string())
            .expect("create job");
        store
            .write_pid("job-no-match", std::process::id())
            .expect("record test pid");

        let terminate_called = std::cell::Cell::new(false);
        let error = cancel_in_store_with_process_checks(
            &store,
            DispatchCancelRequest {
                job_id: "job-no-match".to_string(),
            },
            |_pid| true,
            |_pid, _job_id| false,
            |_pid, _job_id| {
                terminate_called.set(true);
                Ok(true)
            },
        )
        .expect_err("an unrelated live process must not be treated as cancelled");
        assert!(error.to_string().contains("no longer matches"));
        assert!(!terminate_called.get());
        let state = store.load_state("job-no-match").expect("state");
        assert_eq!(state.state, DispatchJobState::Failed);
        assert!(state.cancel_requested());
    }

    #[test]
    fn cancel_signal_failure_stays_retryable_and_non_terminal() {
        let dir = tempfile::tempdir().expect("tempdir");
        let store = DispatchStore::open(dir.path().join("dispatch")).expect("store");
        store
            .create_job(test_request("job-signal-failure"), "Task".to_string())
            .expect("create job");
        store
            .write_pid("job-signal-failure", 42)
            .expect("record injected pid");

        let error = cancel_in_store_with_process_checks(
            &store,
            DispatchCancelRequest {
                job_id: "job-signal-failure".to_string(),
            },
            |_pid| true,
            |_pid, _job_id| true,
            |_pid, _job_id| bail!("injected signal failure"),
        )
        .expect_err("signal failure must remain visible");
        assert!(error.to_string().contains("injected signal failure"));
        let state = store.load_state("job-signal-failure").expect("state");
        assert_eq!(state.state, DispatchJobState::Queued);
        assert!(state.cancel_requested());
        assert_eq!(state.last_error.as_deref(), Some("injected signal failure"));
    }

    #[test]
    fn cancel_marks_terminal_only_after_worker_absence_is_confirmed() {
        let dir = tempfile::tempdir().expect("tempdir");
        let store = DispatchStore::open(dir.path().join("dispatch")).expect("store");
        store
            .create_job(test_request("job-stopped"), "Task".to_string())
            .expect("create job");
        store
            .write_pid("job-stopped", 42)
            .expect("record injected pid");

        let response = cancel_in_store_with_process_checks(
            &store,
            DispatchCancelRequest {
                job_id: "job-stopped".to_string(),
            },
            |_pid| false,
            |_pid, _job_id| panic!("an absent process must not undergo identity inspection"),
            |_pid, _job_id| Ok(false),
        )
        .expect("confirmed stopped worker");
        assert!(response.cancelled);
        assert_eq!(
            store.load_state("job-stopped").expect("state").state,
            DispatchJobState::Cancelled
        );
    }

    #[test]
    fn status_recovers_job_committed_before_controller_spawn() {
        let dir = tempfile::tempdir().expect("tempdir");
        let store = DispatchStore::open(dir.path().join("dispatch")).expect("store");
        store
            .create_job(test_request("job-controller-loss"), "Task".to_string())
            .expect("commit job before simulated controller loss");
        let spawn_called = std::cell::Cell::new(false);

        let state = reconcile_worker_liveness_with_spawn(
            &store,
            "job-controller-loss",
            |_store, job_id| {
                assert_eq!(job_id, "job-controller-loss");
                spawn_called.set(true);
                Ok(())
            },
        )
        .expect("status reconciliation");

        assert!(
            spawn_called.get(),
            "the first observer must recover a committed but unstarted job"
        );
        assert_eq!(state.state, DispatchJobState::Queued);
        assert!(
            state.last_error.is_none(),
            "controller loss before spawn must not seal the job as Failed"
        );
    }

    #[cfg(unix)]
    #[test]
    fn liveness_reconciliation_does_not_signal_an_unverified_or_reused_process_group() {
        use std::os::unix::process::CommandExt;

        struct ProcessGroupGuard(i32);
        impl Drop for ProcessGroupGuard {
            fn drop(&mut self) {
                // SAFETY: this test created the isolated process group.
                unsafe {
                    libc::kill(-self.0, libc::SIGKILL);
                }
            }
        }

        let mut command = openbitfun_services_core::process_manager::create_command("/bin/sh");
        command
            .args(["-c", "trap '' HUP; sleep 30 &"])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        unsafe {
            command.pre_exec(|| {
                if libc::setsid() == -1 {
                    Err(std::io::Error::last_os_error())
                } else {
                    Ok(())
                }
            });
        }
        let mut leader = command.spawn().expect("spawn process-group leader");
        let process_group = leader.id();
        let _guard = ProcessGroupGuard(i32::try_from(process_group).expect("safe pid"));
        leader.wait().expect("reap process-group leader");
        assert!(runner::worker_process_group_alive(process_group));

        let dir = tempfile::tempdir().expect("tempdir");
        let store = DispatchStore::open(dir.path().join("dispatch")).expect("store");
        store
            .create_job(test_request("job-orphan-group"), "Task".to_string())
            .expect("create job");
        store
            .write_pid("job-orphan-group", process_group)
            .expect("record group id");

        let state =
            reconcile_worker_liveness(&store, "job-orphan-group").expect("reconcile orphan group");
        assert_eq!(state.state, DispatchJobState::Failed);
        assert!(
            state
                .last_error
                .as_deref()
                .is_some_and(|error| error.contains("refusing to signal")
                    && error.contains("PGID may have been reused")),
            "the terminal state must explain why the unverified group was left untouched"
        );
        assert!(
            runner::worker_process_group_alive(process_group),
            "status must not signal an unverified process group"
        );
        assert!(store
            .read_pid("job-orphan-group")
            .expect("pid after reconciliation")
            .is_none());
    }

    fn git_in(dir: &Path, args: &[&str]) -> String {
        let output = openbitfun_services_core::process_manager::create_command("git")
            .arg("-C")
            .arg(dir)
            .args(args)
            .output()
            .expect("run git");
        assert!(
            output.status.success(),
            "git {args:?}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    }

    fn text_chunk(session_id: &str, round_id: &str, text: &str) -> protocol::DispatchEvent {
        protocol::DispatchEvent::agent_event(
            serde_json::json!({
                "id": format!("event-{round_id}-{text}"),
                "event": {
                    "type": "TextChunk",
                    "session_id": session_id,
                    "turn_id": "turn-1",
                    "round_id": round_id,
                    "text": text
                },
                "priority": "Normal",
                "timestamp": {"secs_since_epoch": 0, "nanos_since_epoch": 0}
            }),
            None,
        )
    }

    #[test]
    fn the_submitter_is_kept_beside_the_request_and_filters_the_list() {
        let dir = tempfile::tempdir().unwrap();
        let store = DispatchStore::open(dir.path().join("dispatch")).unwrap();
        let mut tagged = test_request("job-cloud");
        tagged.submitter = Some("cloud".to_string());
        store
            .create_job_with_intent(tagged.clone(), tagged, "Cloud".into())
            .unwrap();
        store
            .create_job(test_request("job-local"), "Local".into())
            .unwrap();

        let record = store.load_job("job-cloud").unwrap();
        assert_eq!(record.submitter.as_deref(), Some("cloud"));
        assert_eq!(record.request.submitter, None);
        // An older binary parses `request` strictly; the tag must not be in it.
        let raw: serde_json::Value = serde_json::from_slice(
            &std::fs::read(dir.path().join("dispatch/jobs/job-cloud/job.json")).unwrap(),
        )
        .unwrap();
        assert!(raw["request"].get("submitter").is_none());
        assert_eq!(raw["submitter"], "cloud");
        let legacy = store.load_job("job-local").unwrap();
        assert_eq!(legacy.submitter, None);

        let all = store.list_jobs().unwrap();
        assert_eq!(all.len(), 2);
        let cloud = filter_by_submitter(all.clone(), Some("cloud"));
        assert_eq!(cloud.len(), 1);
        assert_eq!(cloud[0].job_id, "job-cloud");
        assert_eq!(filter_by_submitter(all.clone(), None).len(), 2);
        let encoded = serde_json::to_value(&all).unwrap();
        let local = encoded
            .as_array()
            .unwrap()
            .iter()
            .find(|entry| entry["jobId"] == "job-local")
            .unwrap();
        assert!(
            local.get("submitter").is_none(),
            "old list entries keep their shape"
        );

        // The same id with the same tagged intent is idempotent; a different
        // tag is a different request.
        let mut retry = test_request("job-cloud");
        retry.submitter = Some("cloud".to_string());
        assert!(store
            .load_existing_job_for_intent(&retry)
            .unwrap()
            .is_some());
        retry.submitter = Some("bot".to_string());
        assert!(store.load_existing_job_for_intent(&retry).is_err());
    }

    #[test]
    fn summary_only_status_carries_no_events() {
        let dir = tempfile::tempdir().unwrap();
        let store = DispatchStore::open(dir.path().join("dispatch")).unwrap();
        store
            .create_job(test_request("job-sum"), "Task".into())
            .unwrap();
        store
            .append_event(
                "job-sum",
                &text_chunk("session-job-sum", "r1", "secret transcript"),
            )
            .unwrap();
        let state = store.load_state("job-sum").unwrap();
        let summary = summary::status_summary(&store, "job-sum", &state).unwrap();
        let full_end = store.read_events("job-sum", 0).unwrap().cursor;
        assert_eq!(summary.cursor, full_end);
        assert!(summary.summary_only);
        assert_eq!(summary.state, DispatchJobState::Queued);
        let encoded = serde_json::to_string(&summary).unwrap();
        assert!(!encoded.contains("secret transcript"));
        assert!(!encoded.contains("\"events\""));

        let request: DispatchStatusRequest =
            parse(serde_json::json!({"jobId": "job-sum", "summaryOnly": true})).unwrap();
        assert!(request.summary_only);
        let legacy: DispatchStatusRequest =
            parse(serde_json::json!({"jobId": "job-sum", "cursor": 3})).unwrap();
        assert!(!legacy.summary_only);
    }

    #[tokio::test]
    async fn result_summary_reports_numstat_and_the_last_reply_only() {
        let dir = tempfile::tempdir().unwrap();
        let worktree = dir.path().join("worktree");
        std::fs::create_dir(&worktree).unwrap();
        git_in(&worktree, &["init", "--quiet"]);
        git_in(
            &worktree,
            &[
                "symbolic-ref",
                "HEAD",
                "refs/heads/openbitfun/dispatch/job-res",
            ],
        );
        git_in(&worktree, &["config", "user.email", "d@example.com"]);
        git_in(&worktree, &["config", "user.name", "D"]);
        std::fs::write(worktree.join("a.txt"), "one\ntwo\n").unwrap();
        git_in(&worktree, &["add", "-A"]);
        git_in(&worktree, &["commit", "--quiet", "-m", "base"]);
        let base = git_in(&worktree, &["rev-parse", "HEAD"]);
        std::fs::write(worktree.join("a.txt"), "one\nTOP-SECRET-LINE\nthree\n").unwrap();
        git_in(&worktree, &["commit", "--quiet", "-am", "agent work"]);
        std::fs::write(worktree.join("new.txt"), "UNTRACKED-SECRET\n").unwrap();

        let store = DispatchStore::open(dir.path().join("dispatch")).unwrap();
        let mut job = test_request("job-res");
        job.workspace_path = worktree.to_string_lossy().into_owned();
        store.create_job(job, "Result".into()).unwrap();
        let upload = store.workspace_upload_dir("job-res").unwrap();
        std::fs::create_dir_all(&upload).unwrap();
        std::fs::write(
            upload.join("provision.json"),
            serde_json::to_vec(&serde_json::json!({
                "protocolVersion": 6, "jobId": "job-res", "repoKey": "abcdef0123456789",
                "baseCommit": base, "branch": "openbitfun/dispatch/job-res",
                "createdAt": "2026-01-01T00:00:00Z",
                "workspacePath": worktree.to_string_lossy()
            }))
            .unwrap(),
        )
        .unwrap();
        for event in [
            text_chunk("session-job-res", "r1", "thinking out loud"),
            text_chunk("child-session", "c1", "child chatter"),
            text_chunk("session-job-res", "r2", "All tests pass.\n"),
            text_chunk("session-job-res", "r2", "OUTCOME: pass"),
            text_chunk("child-session", "c2", "late child"),
        ] {
            store.append_event("job-res", &event).unwrap();
        }
        store
            .mark_state("job-res", DispatchJobState::Running, Some("turn-1"), None)
            .unwrap();
        store
            .mark_state("job-res", DispatchJobState::Succeeded, Some("turn-1"), None)
            .unwrap();

        let request: DispatchQueryRequest =
            parse(serde_json::json!({"jobId": "job-res", "kind": "resultSummary"})).unwrap();
        let value = query_in_store(&store, request).await.unwrap();
        let summary: protocol::DispatchResultSummary =
            serde_json::from_value(value.clone()).unwrap();
        assert_eq!(summary.kind, "resultSummary");
        assert_eq!(summary.state, DispatchJobState::Succeeded);
        assert_eq!(summary.base_commit.as_deref(), Some(base.as_str()));
        assert_eq!(
            summary.branch.as_deref(),
            Some("openbitfun/dispatch/job-res")
        );
        assert_eq!(summary.commit_count, 1);
        assert!(summary.uncommitted_changes);
        let stat = summary.diff_stat.expect("diff stat");
        assert_eq!(stat.files_changed, 2);
        assert_eq!((stat.insertions, stat.deletions), (2, 1));
        assert!(stat
            .files
            .iter()
            .any(|file| file.path == "new.txt" && file.untracked));
        assert_eq!(
            summary.summary.as_deref(),
            Some("All tests pass.\nOUTCOME: pass")
        );
        let encoded = value.to_string();
        for secret in [
            "TOP-SECRET-LINE",
            "UNTRACKED-SECRET",
            "child chatter",
            "thinking out loud",
        ] {
            assert!(
                !encoded.contains(secret),
                "{secret} leaked into the summary"
            );
        }
        let with_path: DispatchQueryRequest = parse(serde_json::json!({
            "jobId": "job-res", "kind": "resultSummary", "filePath": "a.txt"
        }))
        .unwrap();
        assert!(query_in_store(&store, with_path).await.is_err());
    }

    #[test]
    fn the_source_capability_waits_for_its_registry_row() {
        use openbitfun_services_core::dispatch_contract as contract;
        let advertised = superagent_target_capabilities();
        for capability in [
            contract::DISPATCH_QUERY_RESULT_SUMMARY_CAPABILITY,
            contract::DISPATCH_STATUS_SUMMARY_ONLY_CAPABILITY,
            contract::DISPATCH_JOB_SUBMITTER_CAPABILITY,
        ] {
            assert!(
                advertised.iter().any(|item| item == capability),
                "{capability}"
            );
        }
        let routed = openbitfun_product_domains::remote_surface::operations()
            .iter()
            .any(|operation| operation.id == contract::DISPATCH_TARGET_PROVISION_SOURCE_COMMAND);
        assert_eq!(
            advertised
                .iter()
                .any(|item| item == contract::DISPATCH_WORKSPACE_TARGET_SOURCE_CAPABILITY),
            routed
        );
        assert!(crate::peer_host::is_dispatch_target_command(
            contract::DISPATCH_TARGET_PROVISION_SOURCE_COMMAND
        ));
    }
}

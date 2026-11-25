//! Native consumer for the real-host smoke fixture. The parent supplies a
//! disposable data root and a loopback model. No stdio Host runs in this process.
use anyhow::{ensure, Context, Result};
use openbitfun_agent_runtime::permission::PERMISSION_REPLIES_AVAILABLE_CONTEXT_KEY;
use openbitfun_agent_runtime::sdk::{
    AgentDialogTurnRequest, AgentSessionReleaseRequest, AgentSessionRestoreRequest,
    AgentSubmissionSource, AgentTurnSettlementRequest, AgentTurnSettlementStatus,
    DialogSubmissionPolicy, DialogSubmitOutcome, PermissionReply, PermissionRequestEvent,
    PortErrorKind, RuntimeError, AUTO_APPROVE_ASK_CONTEXT_KEY,
};
use openbitfun_core::{
    infrastructure::ai::AIClientFactory,
    product_runtime::embedded::EmbeddedAgentRuntime,
    service::config::{
        get_global_config_service, initialize_global_config, model_runtime_binding_fingerprint,
        AIModelConfig, ModelCapability, ModelCategory,
    },
};
use std::{io::BufRead, path::PathBuf};

async fn consume(action: String, session_id: String) -> Result<()> {
    ensure!(
        matches!(action.as_str(), "conflict" | "resume"),
        "invalid action"
    );
    let workspace = PathBuf::from(std::env::var("OPENBITFUN_SDK_SMOKE_WORKSPACE")?);
    EmbeddedAgentRuntime::select_process_profile()?;
    initialize_global_config().await?;
    AIClientFactory::initialize_global().await?;
    let mut key = String::new();
    std::io::stdin().lock().read_line(&mut key)?;
    let mut model = AIModelConfig {
        name: "fixture-model".into(),
        model_name: "fixture-model".into(),
        provider: "openai".into(),
        base_url: std::env::var("OPENBITFUN_SDK_SMOKE_BASE_URL")?,
        api_key: key.trim_end().into(),
        enabled: true,
        category: ModelCategory::GeneralChat,
        capabilities: vec![ModelCapability::TextChat],
        ..Default::default()
    };
    model.id = format!(
        "sdk:openai:{}",
        &model_runtime_binding_fingerprint(&model)[..24]
    );
    get_global_config_service()
        .await?
        .install_runtime_ai_model(model)
        .await?;
    let embedded = EmbeddedAgentRuntime::open(&workspace, "rust-consumer").await?;
    let workspace_id = Some(embedded.default_workspace.id.clone());
    let workspace_path = embedded
        .default_workspace
        .root_path
        .to_string_lossy()
        .into_owned();
    let runtime = &embedded.runtime;
    let restored = runtime
        .restore_session(AgentSessionRestoreRequest {
            workspace_id: workspace_id.clone(),
            workspace_path: workspace_path.clone(),
            session_id: session_id.clone(),
            include_internal: false,
            remote_connection_id: None,
            remote_ssh_host: None,
        })
        .await;
    if action == "conflict" {
        ensure!(
            matches!(restored, Err(RuntimeError::Port(ref e)) if e.kind == PortErrorKind::SessionInUse),
            "expected SessionInUse, got {restored:?}"
        );
        return Ok(());
    }

    let session = restored?.session;
    ensure!(
        session.session_id == session_id,
        "restored a different session"
    );
    let mut permissions = runtime.subscribe_permission_requests()?;
    let mut metadata = serde_json::Map::new();
    metadata.insert(PERMISSION_REPLIES_AVAILABLE_CONTEXT_KEY.into(), true.into());
    metadata.insert(AUTO_APPROVE_ASK_CONTEXT_KEY.into(), false.into());
    let submitted = runtime
        .submit_dialog_turn(AgentDialogTurnRequest {
            session_id: session_id.clone(),
            message: "Confirm the previous read and read embedded-smoke.txt".into(),
            output_schema: None,
            original_message: None,
            turn_id: None,
            execution: Default::default(),
            agent_type: session.agent_type,
            workspace_path: Some(workspace_path.clone()),
            workspace_id: workspace_id.clone(),
            remote_connection_id: None,
            remote_ssh_host: None,
            policy: DialogSubmissionPolicy::for_source(AgentSubmissionSource::SdkHost),
            reply_route: None,
            prepended_reminders: Vec::new(),
            attachments: Vec::new(),
            metadata,
        })
        .await?;
    let turn_id = match submitted {
        DialogSubmitOutcome::Started { turn_id, .. }
        | DialogSubmitOutcome::Queued { turn_id, .. } => turn_id,
    };
    let event =
        tokio::time::timeout(std::time::Duration::from_secs(20), permissions.recv()).await??;
    let PermissionRequestEvent::Asked { request } = event else {
        anyhow::bail!("expected an approval request")
    };
    ensure!(
        request.session_id == session_id
            && request.tool_call_id.as_deref() == Some("call_embedded_read")
            && runtime
                .permission_request_dialog_turn_id(&request.request_id)?
                .as_deref()
                == Some(turn_id.as_str()),
        "approval must belong to the restored session and current turn"
    );
    runtime
        .respond_permission(&request.request_id, PermissionReply::Once)
        .await?;
    let settled = runtime
        .wait_for_turn_settlement(AgentTurnSettlementRequest {
            session_id: session_id.clone(),
            turn_id,
            wait_timeout_ms: 30_000,
        })
        .await?;
    ensure!(
        settled.status == AgentTurnSettlementStatus::Completed
            && settled.final_response.as_deref() == Some("OpenBitFun SDK session resumed"),
        "unexpected settlement: {settled:?}"
    );
    ensure!(
        runtime
            .unload_persisted_session(AgentSessionReleaseRequest {
                workspace_id,
                workspace_path,
                session_id,
                remote_connection_id: None,
                remote_ssh_host: None,
                wait_timeout_ms: 30_000,
            })
            .await?,
        "session was not unloaded"
    );
    Ok(())
}

fn main() -> Result<()> {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .thread_stack_size(16 * 1024 * 1024)
        .enable_all()
        .build()?;
    let mut args = std::env::args().skip(1);
    let action = args.next().context("expected conflict or resume")?;
    let session_id = args.next().context("missing session ID")?;
    runtime.block_on(async { tokio::spawn(consume(action, session_id)).await? })
}

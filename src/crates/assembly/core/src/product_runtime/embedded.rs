//! In-process assembly shared by the SDK Host and native Rust embedders.
use super::{
    build_local_runtime_services, CoreProductAgentRuntime, CoreProductEventQueueOwner,
    CoreRuntimeServicesProvider,
};
use crate::agentic::system;
use crate::product_assembly::{DeliveryProfile, ProductAssembler, ProductAssemblyInput};
use crate::runtime_ownership::{CoreRuntimeOwnership, RuntimeDeployment};
use crate::service::workspace::{
    set_global_workspace_service, WorkspaceInfo, WorkspaceManagerConfig, WorkspaceService,
    WorkspaceServiceSource,
};
use anyhow::{Context, Result};
use openbitfun_agent_runtime::sdk::AgentRuntime;
use std::{path::Path, sync::Arc};

const RUNTIME_EVENT_BUFFER: usize = 256;
const DELIVERY_PROFILE: DeliveryProfile = DeliveryProfile::Sdk;

/// One SDK delivery-profile runtime per process. Select the profile before
/// initializing global configuration and AI services, then open the workspace.
pub struct EmbeddedAgentRuntime {
    pub runtime: AgentRuntime,
    pub workspaces: Arc<WorkspaceService>,
    pub default_workspace: WorkspaceInfo,
    _event_queue_owner: CoreProductEventQueueOwner,
}

impl EmbeddedAgentRuntime {
    pub fn select_process_profile() -> Result<()> {
        system::select_agentic_system_profile(DELIVERY_PROFILE)
            .context("Failed to select SDK Host delivery profile")
    }

    pub async fn open(workspace_root: impl AsRef<Path>, entrypoint: &'static str) -> Result<Self> {
        let (workspace_root, services) =
            build_local_runtime_services(workspace_root, RUNTIME_EVENT_BUFFER)?;
        let path_manager = crate::infrastructure::try_get_path_manager_arc()
            .map_err(|error| anyhow::anyhow!(error.to_string()))?;
        let deployment = RuntimeDeployment::Embedded;
        let runtime_ownership = CoreRuntimeOwnership::fixed_workspace(
            path_manager.as_ref(),
            entrypoint,
            &workspace_root,
            deployment,
        )
        .map_err(|error| anyhow::anyhow!(error.startup_message(deployment, entrypoint)))?;

        let service = Arc::new(
            WorkspaceService::with_config(WorkspaceManagerConfig {
                add_session_activity_to_recent: false,
                ..Default::default()
            })
            .await?,
        );
        let record = service
            .register_local_workspace_record(workspace_root)
            .await?;
        set_global_workspace_service(service.clone());
        let registry = WorkspaceServiceSource::Provided(service.clone());
        let parts = ProductAssembler::new()
            .assemble(ProductAssemblyInput::new(DELIVERY_PROFILE, services))
            .context("Failed to assemble SDK Host product runtime")?;
        let agentic_system = system::init_agentic_system_with_workspaces(
            parts.plan().profile(),
            Arc::new(runtime_ownership),
            None,
            registry,
        )
        .await
        .context("Failed to initialize agentic system")?;
        agentic_system
            .coordinator
            .set_terminal_port(CoreRuntimeServicesProvider::terminal_port());
        let scheduler = agentic_system.scheduler;
        let (services, _disabled_plugin_runtime) = parts.into_runtime_parts();
        let agent_event_queue_owner =
            CoreProductEventQueueOwner::new(agentic_system.event_queue.clone());
        let agent_runtime = CoreProductAgentRuntime::build_sdk_host(
            agentic_system.coordinator,
            scheduler,
            agentic_system.token_usage_service,
            agent_event_queue_owner.runtime_source(),
            services,
        )
        .map_err(anyhow::Error::msg)
        .context("Failed to build Agent SDK runtime")?;

        Ok(Self {
            workspaces: service,
            default_workspace: record,
            runtime: agent_runtime,
            _event_queue_owner: agent_event_queue_owner,
        })
    }
}

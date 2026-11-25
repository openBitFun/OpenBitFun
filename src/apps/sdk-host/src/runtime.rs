use std::path::Path;
use std::sync::Arc;

use anyhow::Result;
use openbitfun_agent_runtime::sdk::{AgentRuntime, PortError, PortErrorKind};
use openbitfun_core::product_runtime::embedded::EmbeddedAgentRuntime;
use openbitfun_core::service::workspace::WorkspaceService;
use openbitfun_sdk_host::host::{SdkWorkspace, SdkWorkspaces};
use openbitfun_services_core::workspace_identity::canonicalize_local_workspace_root;

pub(crate) struct SdkHostRuntime {
    pub(crate) workspaces: Arc<dyn SdkWorkspaces>,
    embedded: EmbeddedAgentRuntime,
}

struct LocalSdkWorkspaces {
    service: Arc<WorkspaceService>,
    default: SdkWorkspace,
}

#[async_trait::async_trait]
impl SdkWorkspaces for LocalSdkWorkspaces {
    fn default_workspace(&self) -> &SdkWorkspace {
        &self.default
    }

    async fn workspace_for_cwd(&self, cwd: &str) -> Result<SdkWorkspace, PortError> {
        let (path, _) = canonicalize_local_workspace_root(Path::new(cwd))
            .map_err(|error| PortError::new(PortErrorKind::InvalidRequest, error))?;
        if path == Path::new(&self.default.path) {
            return Ok(self.default.clone());
        }
        if !path.is_dir() {
            return Err(PortError::new(
                PortErrorKind::InvalidRequest,
                "SDK workspace must be a directory",
            ));
        }
        let record = self
            .service
            .register_local_workspace_record(path)
            .await
            .map_err(|error| PortError::new(PortErrorKind::Backend, error.to_string()))?;
        Ok(SdkWorkspace {
            id: record.id,
            path: record.root_path.to_string_lossy().into_owned(),
        })
    }
}

impl SdkHostRuntime {
    pub(crate) fn select_process_profile() -> Result<()> {
        EmbeddedAgentRuntime::select_process_profile()
    }

    pub(crate) async fn build(workspace_root: impl AsRef<Path>) -> Result<Self> {
        let embedded = EmbeddedAgentRuntime::open(workspace_root, "sdk-host").await?;
        let workspaces = Arc::new(LocalSdkWorkspaces {
            service: embedded.workspaces.clone(),
            default: SdkWorkspace {
                id: embedded.default_workspace.id.clone(),
                path: embedded
                    .default_workspace
                    .root_path
                    .to_string_lossy()
                    .into_owned(),
            },
        });
        Ok(Self {
            workspaces,
            embedded,
        })
    }

    pub(crate) fn agent_runtime(&self) -> &AgentRuntime {
        &self.embedded.runtime
    }
}

pub(crate) async fn initialize_terminal_service() {
    use openbitfun_core::infrastructure::try_get_path_manager_arc;
    use openbitfun_core::service::runtime::RuntimeManager;
    use openbitfun_core::service::terminal::{TerminalApi, TerminalConfig};

    let mut config = TerminalConfig::default();
    match try_get_path_manager_arc() {
        Ok(path_manager) => {
            config.shell_integration.scripts_dir =
                Some(path_manager.user_data_dir().join("sdk-host/temp/scripts"));
            config.transcript.root_dir = Some(path_manager.user_data_dir().join("terminals"));
        }
        Err(error) => {
            tracing::warn!(
                "Failed to configure SDK Host terminal storage; recording is disabled: {}",
                error
            );
        }
    }

    if let Ok(runtime_manager) = RuntimeManager::new() {
        let current_path = std::env::var("PATH").ok();
        if let Some(merged_path) = runtime_manager.merged_path_env(current_path.as_deref()) {
            config.env.insert("PATH".to_string(), merged_path.clone());
            #[cfg(windows)]
            config.env.insert("Path".to_string(), merged_path);
        }
    } else {
        tracing::warn!("Failed to initialize SDK Host terminal runtime PATH");
    }

    let _terminal_api = TerminalApi::new(config).await;
}

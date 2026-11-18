use super::super::test_support::{test_coordinator, test_persistent_coordinator};
use super::super::SubagentExecutionRequest;
use crate::agentic::core::{
    Message, MessageContent, MessageRole, MessageSemanticKind, SessionConfig,
    SessionContinuationPolicy, SessionKind, SessionModelBindingPolicy,
};
use crate::agentic::session::TEST_MODEL_RESOLUTION_AI_CONFIG;
use crate::agentic::tools::pipeline::SubagentParentInfo;
use crate::service::config::types::{AIConfig, AIModelConfig};
use openbitfun_agent_runtime::permission::AUTO_APPROVE_ASK_CONTEXT_KEY;
use openbitfun_runtime_ports::{
    DelegationPolicy, PermissionEffect, PermissionRule, PermissionRuntimeCeiling,
    SubagentContextMode,
};
use std::collections::HashMap;

#[tokio::test]
async fn reused_subagent_send_input_updates_requested_and_inherited_model() {
    assert_reused_subagent_model_selection(None).await;
}

#[tokio::test]
async fn reused_subagent_legacy_smart_keeps_target_until_explicit_model_replacement() {
    // Typed target replacement validates the selected configured model.
    // Supply the same host-owned configuration a real runtime has loaded.
    let mut config = AIConfig::default();
    config.models = ["main-model", "worker-model", "parent-model"]
        .into_iter()
        .map(|id| AIModelConfig {
            id: id.into(),
            enabled: true,
            ..Default::default()
        })
        .collect();
    config.default_models.primary = Some("main-model".into());
    config.default_models.fast = Some("worker-model".into());
    TEST_MODEL_RESOLUTION_AI_CONFIG
        .scope(
            config,
            assert_reused_subagent_model_selection(Some("smart")),
        )
        .await;
}

async fn assert_reused_subagent_model_selection(legacy_routing: Option<&str>) {
    let (coordinator, session_manager) = test_persistent_coordinator();
    let workspace_path = std::env::temp_dir().join(format!(
        "openbitfun-reused-subagent-model-test-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&workspace_path).expect("workspace dir should exist");
    crate::service::workspace::legacy_compat::register_local_fixture_blocking(&workspace_path);
    struct TempWorkspaceGuard(std::path::PathBuf);
    impl Drop for TempWorkspaceGuard {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    let _workspace_guard = TempWorkspaceGuard(workspace_path.clone());

    let parent_session = session_manager
        .create_session(
            "Parent".to_string(),
            "Standard".to_string(),
            SessionConfig {
                tool_presentation_mode: Default::default(),
                model_id: Some("primary".to_string()),
                workspace_path: Some(workspace_path.to_string_lossy().into_owned()),
                ..Default::default()
            },
        )
        .await
        .expect("parent session should be created");

    let subagent_session = coordinator
        .create_hidden_agent_session(
            None,
            "Reusable subagent".to_string(),
            "Standard".to_string(),
            SessionConfig {
                tool_presentation_mode: Default::default(),
                model_id: Some("parent-model".to_string()),
                model_routing: legacy_routing.map(str::to_owned),
                delegation_model_routing: legacy_routing.map(str::to_owned),
                workspace_path: Some(workspace_path.to_string_lossy().into_owned()),
                ..Default::default()
            },
            Some(format!("session-{}", parent_session.session_id)),
            SessionKind::Subagent,
        )
        .await
        .expect("subagent session should be created");

    assert!(
        session_manager
            .unload_session_from_memory(&subagent_session.session_id)
            .await
            .expect("persisted subagent session should unload"),
        "the restart regression requires the target subagent to be absent from memory"
    );
    assert!(
        session_manager
            .get_session(&subagent_session.session_id)
            .is_none(),
        "the send_input preparation must restore the persisted subagent on demand"
    );

    let request = SubagentExecutionRequest {
        task_description: "Continue the investigation".to_string(),
        requested_agent_id: None,
        context_mode: SubagentContextMode::Fresh,
        target_session_id: Some(subagent_session.session_id.clone()),
        subagent_type: None,
        logical_subagent_type: None,
        continuation_policy: SessionContinuationPolicy::Reusable,
        model_binding_policy: SessionModelBindingPolicy::Mutable,
        workspace_path: None,
        model_id: Some("fast".to_string()),
        inherit_parent_model: false,
        subagent_parent_info: SubagentParentInfo {
            session_id: parent_session.session_id.clone(),
            dialog_turn_id: "parent-turn".to_string(),
            tool_call_id: "task-tool".to_string(),
        },
        context: HashMap::from([(
            AUTO_APPROVE_ASK_CONTEXT_KEY.to_string(),
            "false".to_string(),
        )]),
        permission_runtime_ceiling: PermissionRuntimeCeiling::try_new(vec![
            PermissionRule::new("bash", "rm *", PermissionEffect::Deny),
            PermissionRule::new("external_directory", "*", PermissionEffect::Ask),
        ])
        .expect("test ceiling should be valid"),
        delegation_policy: DelegationPolicy::top_level().spawn_child(),
        external_generation_lease: None,
    };

    let mut unchanged_request = request.clone();
    unchanged_request.model_id = None;
    let unchanged = coordinator
        .resolve_hidden_subagent_execution_request(unchanged_request)
        .await
        .expect("restored child should retain its saved target without a model override");
    assert_eq!(
        unchanged.session_config.model_id.as_deref(),
        Some("parent-model")
    );
    assert_eq!(
        unchanged.session_config.model_routing.as_deref(),
        legacy_routing
    );
    assert_eq!(
        unchanged.session_config.delegation_model_routing.as_deref(),
        legacy_routing
    );
    let restored = session_manager
        .get_session(&subagent_session.session_id)
        .unwrap();
    assert!(
        !crate::agentic::execution::round_model_routing::configuration::session_eligible(&restored)
    );

    let prepared = coordinator
        .prepare_subagent_execution_request(request)
        .await
        .expect("send_input request should prepare with a requested model");

    assert!(!prepared.delegation_policy.allow_subagent_spawn);
    for tool_name in ["AgentSpawn", "AgentFork"] {
        assert!(prepared
            .runtime_tool_restrictions
            .is_tool_allowed(tool_name));
    }
    assert_eq!(prepared.session_config.model_id.as_deref(), Some("fast"));
    if legacy_routing.is_some() {
        assert_eq!(
            prepared.session_config.model_routing.as_deref(),
            Some("manual")
        );
        assert_eq!(
            prepared.session_config.delegation_model_routing.as_deref(),
            legacy_routing
        );
    }
    assert_eq!(
        prepared
            .context
            .get(AUTO_APPROVE_ASK_CONTEXT_KEY)
            .map(String::as_str),
        Some("false"),
        "reused subagent runs must use the current invocation override"
    );
    assert_eq!(
        prepared
            .permission_runtime_ceiling
            .as_ref()
            .expect("child request should retain the parent ceiling")
            .rules(),
        [
            PermissionRule::new("bash", "rm *", PermissionEffect::Deny),
            PermissionRule::new("external_directory", "*", PermissionEffect::Ask,),
        ]
    );
    assert_eq!(
        session_manager
            .get_session(&subagent_session.session_id)
            .expect("subagent session should remain available")
            .config
            .model_id
            .as_deref(),
        Some("fast")
    );

    let inherit_request = SubagentExecutionRequest {
        task_description: "Continue with the parent model".to_string(),
        requested_agent_id: None,
        context_mode: SubagentContextMode::Fresh,
        target_session_id: Some(subagent_session.session_id.clone()),
        subagent_type: None,
        logical_subagent_type: None,
        continuation_policy: SessionContinuationPolicy::Reusable,
        model_binding_policy: SessionModelBindingPolicy::Mutable,
        workspace_path: None,
        model_id: None,
        inherit_parent_model: true,
        subagent_parent_info: SubagentParentInfo {
            session_id: parent_session.session_id.clone(),
            dialog_turn_id: "parent-turn".to_string(),
            tool_call_id: "task-tool".to_string(),
        },
        context: HashMap::new(),
        permission_runtime_ceiling: PermissionRuntimeCeiling::default(),
        delegation_policy: DelegationPolicy::top_level().spawn_child(),
        external_generation_lease: None,
    };

    let prepared = coordinator
        .prepare_subagent_execution_request(inherit_request)
        .await
        .expect("send_input request should inherit the parent model");

    assert_eq!(prepared.session_config.model_id.as_deref(), Some("primary"));
    assert_eq!(
        session_manager
            .get_session(&subagent_session.session_id)
            .expect("subagent session should remain available")
            .config
            .model_id
            .as_deref(),
        Some("primary")
    );
}

#[tokio::test]
async fn fork_subagent_request_allows_requested_model_override() {
    let (coordinator, session_manager) = test_coordinator();
    let workspace_path = std::env::temp_dir().join(format!(
        "openbitfun-fork-model-test-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&workspace_path).expect("workspace dir should exist");
    crate::service::workspace::legacy_compat::register_local_fixture_blocking(&workspace_path);
    struct TempWorkspaceGuard(std::path::PathBuf);
    impl Drop for TempWorkspaceGuard {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    let _workspace_guard = TempWorkspaceGuard(workspace_path.clone());

    let parent_session = session_manager
        .create_session(
            "Parent".to_string(),
            "Standard".to_string(),
            SessionConfig {
                tool_presentation_mode: Default::default(),
                model_id: Some("primary".to_string()),
                workspace_path: Some(workspace_path.to_string_lossy().into_owned()),
                ..Default::default()
            },
        )
        .await
        .expect("parent session should be created");
    session_manager
        .replace_context_messages(
            &parent_session.session_id,
            vec![Message::user("parent context".to_string())],
        )
        .await;

    let request = SubagentExecutionRequest {
        task_description: "Fork and inspect the repo".to_string(),
        requested_agent_id: None,
        context_mode: SubagentContextMode::Fork,
        target_session_id: None,
        subagent_type: None,
        logical_subagent_type: None,
        continuation_policy: SessionContinuationPolicy::Reusable,
        model_binding_policy: SessionModelBindingPolicy::Mutable,
        workspace_path: None,
        model_id: Some("fast".to_string()),
        inherit_parent_model: false,
        subagent_parent_info: SubagentParentInfo {
            session_id: parent_session.session_id.clone(),
            dialog_turn_id: "parent-turn".to_string(),
            tool_call_id: "task-tool".to_string(),
        },
        context: HashMap::new(),
        permission_runtime_ceiling: PermissionRuntimeCeiling::default(),
        delegation_policy: DelegationPolicy::top_level().spawn_child(),
        external_generation_lease: None,
    };

    let prepared = coordinator
        .prepare_subagent_execution_request(request)
        .await
        .expect("fork request should prepare with a requested model");

    assert_eq!(prepared.session_config.model_id.as_deref(), Some("fast"));
    assert!(!prepared.context.contains_key(AUTO_APPROVE_ASK_CONTEXT_KEY));
    assert_eq!(
        prepared.prompt_cache_source_session_id.as_deref(),
        Some(parent_session.session_id.as_str())
    );
    assert_eq!(
        session_manager
            .get_session(prepared.target_session_id().expect("prepared session id"))
            .expect("forked subagent session should exist")
            .config
            .model_id
            .as_deref(),
        Some("fast")
    );

    let inherit_request = SubagentExecutionRequest {
        task_description: "Fork with the parent model".to_string(),
        requested_agent_id: None,
        context_mode: SubagentContextMode::Fork,
        target_session_id: None,
        subagent_type: None,
        logical_subagent_type: None,
        continuation_policy: SessionContinuationPolicy::Reusable,
        model_binding_policy: SessionModelBindingPolicy::Mutable,
        workspace_path: None,
        model_id: None,
        inherit_parent_model: true,
        subagent_parent_info: SubagentParentInfo {
            session_id: parent_session.session_id.clone(),
            dialog_turn_id: "parent-turn".to_string(),
            tool_call_id: "task-tool".to_string(),
        },
        context: HashMap::new(),
        permission_runtime_ceiling: PermissionRuntimeCeiling::default(),
        delegation_policy: DelegationPolicy::top_level().spawn_child(),
        external_generation_lease: None,
    };

    let prepared = coordinator
        .prepare_subagent_execution_request(inherit_request)
        .await
        .expect("fork request should inherit the parent model");

    assert_eq!(prepared.session_config.model_id.as_deref(), Some("primary"));
    for tool_name in ["Task", "AgentSpawn", "AgentFork"] {
        assert!(prepared
            .runtime_tool_restrictions
            .is_tool_allowed(tool_name));
    }
    assert!(!prepared.delegation_policy.allow_subagent_spawn);
}

#[tokio::test]
async fn reused_subagent_input_is_added_to_runtime_context() {
    let (coordinator, session_manager) = test_coordinator();
    let workspace_path = std::env::temp_dir().join(format!(
        "openbitfun-reused-subagent-input-context-test-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&workspace_path).expect("workspace dir should exist");
    crate::service::workspace::legacy_compat::register_local_fixture_blocking(&workspace_path);
    struct TempWorkspaceGuard(std::path::PathBuf);
    impl Drop for TempWorkspaceGuard {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    let _workspace_guard = TempWorkspaceGuard(workspace_path.clone());

    let session = coordinator
        .create_hidden_agent_session(
            None,
            "Reusable subagent".to_string(),
            "Standard".to_string(),
            SessionConfig {
                tool_presentation_mode: Default::default(),
                workspace_path: Some(workspace_path.to_string_lossy().into_owned()),
                ..Default::default()
            },
            Some("session-parent".to_string()),
            SessionKind::Subagent,
        )
        .await
        .expect("subagent session should be created");
    session_manager
        .replace_context_messages(
            &session.session_id,
            vec![Message::assistant("previous answer".to_string())],
        )
        .await;

    let turn_id = session_manager
        .start_dialog_turn_with_existing_context(
            &session.session_id,
            "Standard".to_string(),
            "continue investigation".to_string(),
            Some("subagent-turn-reuse".to_string()),
            None,
        )
        .await
        .expect("turn should start");
    coordinator
        .persist_reused_subagent_user_input_context_if_needed(
            Some(&session.session_id),
            false,
            &session.session_id,
            &turn_id,
            "continue investigation",
        )
        .await
        .expect("user input context should persist");

    let context_messages = session_manager
        .get_context_messages(&session.session_id)
        .await
        .expect("context should be readable");
    assert_eq!(context_messages.len(), 2);
    let user_message = context_messages.last().expect("user message should exist");
    assert_eq!(user_message.role, MessageRole::User);
    assert_eq!(
        user_message.metadata.turn_id.as_deref(),
        Some("subagent-turn-reuse")
    );
    assert_eq!(
        user_message.metadata.semantic_kind,
        Some(MessageSemanticKind::ActualUserInput)
    );
    assert!(matches!(
        &user_message.content,
        MessageContent::Text(text) if text == "continue investigation"
    ));
}

use super::support::{test_manager, TestWorkspace};
use crate::agentic::core::{Message, MessageContent, SessionConfig};
use crate::agentic::persistence::PersistenceManager;
use crate::agentic::session::revert::{
    SessionRevertPhase, SessionRevertState, SESSION_REVERT_SCHEMA_VERSION,
};
use crate::service::session::{DialogTurnData, SessionContextUsage, SessionContextUsageSource};
use std::path::{Path, PathBuf};
use std::sync::Arc;

#[tokio::test]
async fn current_context_estimate_reads_compression_forks_and_legacy_snapshots_without_writes() {
    use openbitfun_services_core::session::{SessionBranchBoundary, SessionBranchRequest};
    let workspace = TestWorkspace::new();
    let persistence = Arc::new(PersistenceManager::new(workspace.path_manager()).unwrap());
    let manager = test_manager(persistence.clone());
    let session = manager
        .create_session(
            "Estimate".into(),
            "Standard".into(),
            SessionConfig {
                workspace_path: Some(workspace.path().to_string_lossy().into_owned()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    let storage = manager
        .effective_session_storage_path(&session.session_id)
        .await
        .unwrap();
    let turn = DialogTurnData::new(
        "turn-estimate".into(),
        0,
        session.session_id.clone(),
        crate::service::session::UserMessageData {
            id: "input".into(),
            content: "Uncompressed history".into(),
            timestamp: 1,
            metadata: None,
        },
    );
    persistence.save_dialog_turn(&storage, &turn).await.unwrap();
    let mut summary = Message::user("Compressed summary".into());
    summary.metadata.semantic_kind =
        Some(crate::agentic::core::MessageSemanticKind::CompressionSummary);
    persistence
        .save_turn_context_snapshot(&storage, &session.session_id, 0, &[summary.clone()])
        .await
        .unwrap();
    manager
        .context_store
        .replace_context(&session.session_id, vec![summary.clone()]);
    let live = manager
        .read_context_estimate_inputs(&storage, &session.session_id)
        .await
        .unwrap();
    assert_eq!(live.messages.len(), 1);
    assert_eq!(live.messages[0].id, summary.id);

    let fork = persistence
        .branch_session(
            &storage,
            &SessionBranchRequest {
                source_session_id: session.session_id.clone(),
                source_turn_id: turn.turn_id.clone(),
                boundary: SessionBranchBoundary::ThroughTurn,
            },
        )
        .await
        .unwrap();
    assert!(manager.get_session(&fork.session_id).is_none());
    // Corrupt display-only legacy data must not affect a current-context query.
    let root = if persistence.is_resolved_sessions_dir(&storage) {
        storage.clone()
    } else {
        persistence.path_manager().project_sessions_dir(&storage)
    };
    let dir = root.join(&fork.session_id);
    std::fs::write(
        dir.join("usage-context.json"),
        b"legacy unreadable display snapshot",
    )
    .unwrap();
    fn files(path: &Path) -> std::collections::BTreeMap<PathBuf, Vec<u8>> {
        let mut result = std::collections::BTreeMap::new();
        for entry in std::fs::read_dir(path).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                result.extend(files(&path));
            } else {
                result.insert(path.clone(), std::fs::read(path).unwrap());
            }
        }
        result
    }
    let before = files(&dir);
    let copied = manager
        .read_context_estimate_inputs(&storage, &fork.session_id)
        .await
        .unwrap();
    assert_eq!(copied.messages.len(), 1);
    assert_eq!(copied.messages[0].id, summary.id);
    assert!(
        manager.get_session(&fork.session_id).is_none(),
        "inspection must not restore a session"
    );
    assert_eq!(
        before,
        files(&dir),
        "inspection must not rewrite persisted data"
    );
    // Legacy sessions with no context snapshot fall back to model-visible turns.
    persistence
        .delete_turn_context_snapshots_from(&storage, &fork.session_id, 0)
        .await
        .unwrap();
    let legacy = manager
        .read_context_estimate_inputs(&storage, &fork.session_id)
        .await
        .unwrap();
    assert!(legacy
        .messages
        .iter()
        .any(|message| matches!(&message.content,
            MessageContent::Text(text) if text.contains("Uncompressed history"))));
    // A staged revert must exclude both retained snapshots and in-memory history.
    persistence
        .save_session_revert_state(
            &storage,
            &session.session_id,
            &SessionRevertState {
                schema_version: SESSION_REVERT_SCHEMA_VERSION,
                boundary_turn: 0,
                original_turn_end: 1,
                phase: SessionRevertPhase::Staged,
                workspace_checkpoint: Vec::new(),
            },
        )
        .await
        .unwrap();
    let reverted = manager
        .read_context_estimate_inputs(&storage, &session.session_id)
        .await
        .unwrap();
    assert!(reverted.messages.is_empty());
}

#[tokio::test]
async fn current_context_usage_is_persisted_by_the_session_owner() {
    let workspace = TestWorkspace::new();
    let persistence_manager =
        Arc::new(PersistenceManager::new(workspace.path_manager()).expect("persistence manager"));
    let manager = test_manager(persistence_manager.clone());
    let session = manager
        .create_session(
            "Usage persistence".to_string(),
            "Standard".to_string(),
            SessionConfig {
                tool_presentation_mode: Default::default(),
                workspace_path: Some(workspace.path().to_string_lossy().to_string()),
                ..SessionConfig::default()
            },
        )
        .await
        .expect("session should create");
    let usage = SessionContextUsage {
        turn_id: "turn-1".to_string(),
        input_tokens: 42_000,
        output_tokens: Some(1_500),
        total_tokens: 43_500,
        timestamp: 123,
        source: SessionContextUsageSource::ModelRequest,
    };
    manager
        .sessions
        .get_mut(&session.session_id)
        .expect("session should be active")
        .dialog_turn_ids
        .push(usage.turn_id.clone());

    manager
        .persist_current_context_usage(&session.session_id, usage.clone())
        .await
        .expect("usage should persist");

    let metadata = persistence_manager
        .load_session_metadata(workspace.path(), &session.session_id)
        .await
        .expect("metadata should load")
        .expect("metadata should exist");
    assert_eq!(metadata.current_context_usage, Some(usage));
}

#[tokio::test]
async fn acp_context_usage_is_not_persisted_as_native_prompt_usage() {
    let workspace = TestWorkspace::new();
    let persistence_manager =
        Arc::new(PersistenceManager::new(workspace.path_manager()).expect("persistence manager"));
    let manager = test_manager(persistence_manager.clone());
    let session = manager
        .create_session(
            "ACP usage".to_string(),
            "acp:codex".to_string(),
            SessionConfig {
                tool_presentation_mode: Default::default(),
                workspace_path: Some(workspace.path().to_string_lossy().to_string()),
                ..SessionConfig::default()
            },
        )
        .await
        .expect("session should create");

    manager
        .persist_current_context_usage(
            &session.session_id,
            SessionContextUsage {
                turn_id: "turn-1".to_string(),
                input_tokens: 42_000,
                output_tokens: Some(1_500),
                total_tokens: 43_500,
                timestamp: 123,
                source: SessionContextUsageSource::ModelRequest,
            },
        )
        .await
        .expect("ACP usage should be ignored");

    let metadata = persistence_manager
        .load_session_metadata(workspace.path(), &session.session_id)
        .await
        .expect("metadata should load")
        .expect("metadata should exist");
    assert!(metadata.current_context_usage.is_none());
}

#[tokio::test]
async fn delayed_context_usage_does_not_restore_a_removed_turn() {
    let workspace = TestWorkspace::new();
    let persistence_manager =
        Arc::new(PersistenceManager::new(workspace.path_manager()).expect("persistence manager"));
    let manager = Arc::new(test_manager(persistence_manager.clone()));
    let session = manager
        .create_session(
            "Delayed usage".to_string(),
            "Standard".to_string(),
            SessionConfig {
                tool_presentation_mode: Default::default(),
                workspace_path: Some(workspace.path().to_string_lossy().to_string()),
                ..SessionConfig::default()
            },
        )
        .await
        .expect("session should create");
    manager
        .sessions
        .get_mut(&session.session_id)
        .expect("session should be active")
        .dialog_turn_ids
        .push("turn-1".to_string());

    let mutation_guard = manager
        .acquire_session_mutation(&session.session_id)
        .await
        .expect("mutation guard");
    let delayed_manager = manager.clone();
    let delayed_session_id = session.session_id.clone();
    let delayed_write = tokio::spawn(async move {
        delayed_manager
            .persist_current_context_usage(
                &delayed_session_id,
                SessionContextUsage {
                    turn_id: "turn-1".to_string(),
                    input_tokens: 42_000,
                    output_tokens: Some(1_500),
                    total_tokens: 43_500,
                    timestamp: 123,
                    source: SessionContextUsageSource::ModelRequest,
                },
            )
            .await
    });
    tokio::task::yield_now().await;
    assert!(!delayed_write.is_finished());

    manager
        .sessions
        .get_mut(&session.session_id)
        .expect("session should remain active")
        .dialog_turn_ids
        .clear();
    drop(mutation_guard);
    delayed_write
        .await
        .expect("delayed write should join")
        .expect("delayed write should be ignored");

    let metadata = persistence_manager
        .load_session_metadata(workspace.path(), &session.session_id)
        .await
        .expect("metadata should load")
        .expect("metadata should exist");
    assert!(metadata.current_context_usage.is_none());
}

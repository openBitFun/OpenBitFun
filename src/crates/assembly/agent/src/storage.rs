use crate::records::{build_model_rounds_from_messages, restore_history};
use anyhow::{ensure, Context, Result};
use openbitfun_agent_runtime::message::{normalization::normalize_after_interruption, Message};
use openbitfun_agent_runtime::session::{residency::SessionResidency, Session, SessionConfig};
use openbitfun_services_core::{
    json_store::JsonFileStore,
    session::{
        refresh_session_metadata_from_turns, DialogTurnData, SessionMetadata, SessionMetadataStore,
        SessionStorageLayout, SessionWriteLock, StoredDialogTurnFile, TurnStatus,
    },
    workspace_identity::{local_workspace_roots_equal, LOCAL_WORKSPACE_SSH_HOST},
};
use std::{path::Path, sync::Arc};

/// The OS lease covers restoration, every checkpoint and the final index update.
pub(crate) struct Records {
    layout: SessionStorageLayout,
    pub metadata: SessionMetadata,
    pub turns: Vec<DialogTurnData>,
    pub messages: Vec<Message>,
    pub(crate) write_failed: bool,
    residents: Arc<SessionResidency<SessionWriteLock>>,
}

impl Records {
    pub(crate) async fn open(
        residents: Arc<SessionResidency<SessionWriteLock>>,
        root: &Path,
        workspace: &Path,
        workspace_id: &str,
        id: &str,
        new: Option<SessionMetadata>,
    ) -> Result<Self> {
        let mutation = residents.lock_mutation(id).await;
        let writer = SessionWriteLock::try_acquire(root, id)?;
        let capacity = residents.reserve()?;
        let layout = SessionStorageLayout::new(root);
        let store = SessionMetadataStore::new(root);
        ensure!(
            !tokio::fs::try_exists(layout.session_dir(id).join("session-revert.json")).await?,
            "session has a staged revert requiring the owning host"
        );
        let existing = store.load_metadata(id).await?;
        let paths = layout.list_indexed_turn_paths(id).await?;
        let metadata = if let Some(mut first) = new {
            ensure!(
                existing.is_none() && paths.is_empty() && !layout.state_path(id).exists(),
                "session already exists: {id}"
            );
            first.workspace_id = Some(workspace_id.to_owned());
            first.workspace_path = Some(workspace.to_string_lossy().into_owned());
            store.save_metadata(&first).await?;
            first
        } else {
            existing.context("session metadata not found")?
        };
        ensure!(
            metadata.session_id == id,
            "session metadata identity mismatch"
        );
        ensure!(
            metadata
                .workspace_id
                .as_deref()
                .map_or(true, |owner| owner == workspace_id)
                && metadata
                    .workspace_path
                    .as_deref()
                    .is_some_and(|p| local_workspace_roots_equal(Path::new(p), workspace)),
            "session belongs to a different workspace"
        );
        ensure!(
            metadata
                .workspace_hostname
                .as_deref()
                .map_or(true, |v| v == LOCAL_WORKSPACE_SSH_HOST)
                && metadata.execution_target.as_ref().map_or(true, |target| {
                    target.kind == openbitfun_core_types::SessionExecutionTargetKind::Local
                        && local_workspace_roots_equal(Path::new(&target.root_path), workspace)
                }),
            "session requires a remote workspace or worktree provider"
        );
        let mut turns = Vec::new();
        for (index, path) in paths {
            let file = JsonFileStore
                .read_optional::<StoredDialogTurnFile>(&path)
                .await?
                .context("turn file disappeared")?;
            ensure!(
                file.schema_version
                    <= openbitfun_services_core::session::SESSION_STORAGE_SCHEMA_VERSION,
                "unsupported session turn version"
            );
            ensure!(
                file.turn.session_id == id && file.turn.turn_index == index && index == turns.len(),
                "inconsistent session turn sequence"
            );
            turns.push(file.turn);
        }
        ensure!(
            metadata.turn_count <= turns.len(),
            "session metadata refers to missing turns"
        );
        if let Some(last) = turns.last() {
            ensure!(
                last.status != TurnStatus::InProgress && last.recovery.is_none(),
                "session has an interrupted turn requiring recovery"
            );
        }
        let mut checkpoint = None;
        for turn in turns.iter().rev() {
            let path = layout.context_snapshot_path(id, turn.turn_index);
            if let Some(snapshot) = crate::records::load_context(&path).await? {
                ensure!(
                    snapshot.schema_version
                        <= openbitfun_services_core::session::SESSION_STORAGE_SCHEMA_VERSION,
                    "unsupported session snapshot version"
                );
                ensure!(
                    snapshot.session_id == id && snapshot.turn_index == turn.turn_index,
                    "context snapshot identity mismatch"
                );
                checkpoint = Some((turn.turn_index, snapshot.messages));
                break;
            }
            ensure!(
                turn.count_tool_calls() == 0,
                "session tool history requires a durable context snapshot"
            );
        }
        let mut messages = restore_history(&turns, checkpoint);
        normalize_after_interruption(&mut messages);
        let mut session = Session::new_with_id(
            id.to_owned(),
            metadata.session_name.clone(),
            metadata.agent_type.clone(),
            SessionConfig {
                workspace_path: metadata.workspace_path.clone(),
                project_workspace_path: metadata.project_workspace_path.clone(),
                ..Default::default()
            },
        );
        session.dialog_turn_ids = turns.iter().map(|t| t.turn_id.clone()).collect();
        residents.commit_writer(id, writer);
        residents.publish_restored(id, &session, Some(capacity));
        drop(mutation);
        Ok(Self {
            layout,
            metadata,
            turns,
            messages,
            write_failed: false,
            residents,
        })
    }

    pub(crate) fn close_incomplete_tools(&mut self) {
        normalize_after_interruption(&mut self.messages);
    }

    pub(crate) async fn checkpoint(&mut self, turn: &DialogTurnData) -> Result<()> {
        self.write_failed = true;
        let id = &self.metadata.session_id;
        let index = turn.turn_index;
        self.layout.ensure_turns_dir(id).await?;
        self.layout.ensure_snapshots_dir(id).await?;
        let mut record = turn.clone();
        let generation = self
            .messages
            .iter()
            .filter(|m| m.metadata.turn_id.as_deref() == Some(&turn.turn_id))
            .cloned()
            .collect::<Vec<_>>();
        record.model_rounds =
            build_model_rounds_from_messages(&generation, &turn.turn_id, turn.timestamp);
        crate::records::save_context(
            &self.layout.context_snapshot_path(id, index),
            id,
            index,
            &self.messages,
        )
        .await?;
        crate::records::save_turn(&self.layout.turn_path(id, index), &record).await?;
        if self.turns.len() == index {
            if let Some(mut session) = self.residents.sessions().get_mut(id) {
                session.dialog_turn_ids.push(record.turn_id.clone());
            }
            self.turns.push(record)
        } else {
            self.turns[index] = record
        }
        let workspace = self
            .metadata
            .workspace_path
            .clone()
            .context("missing workspace path")?;
        refresh_session_metadata_from_turns(
            &mut self.metadata,
            &workspace,
            &self.turns,
            turn.end_time.unwrap_or(turn.timestamp),
        );
        SessionMetadataStore::new(self.layout.sessions_root())
            .save_metadata(&self.metadata)
            .await?;
        self.write_failed = false;
        Ok(())
    }
}

impl Drop for Records {
    fn drop(&mut self) {
        self.residents
            .release_saved(&self.metadata.session_id, || {}, || {});
    }
}

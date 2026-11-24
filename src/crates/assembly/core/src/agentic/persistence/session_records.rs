//! Session and turn record I/O. The session owner holds the write lease and
//! decides the order of writes, restore, and settlement.

use super::PersistenceManager;
use crate::agentic::core::Session;
use crate::service::session::DialogTurnData;
use crate::OpenBitFunResult;
use std::path::Path;

#[async_trait::async_trait]
pub trait SessionRecords: Send + Sync {
    async fn save_session(&self, storage: &Path, session: &Session) -> OpenBitFunResult<()>;
    async fn load_session_with_turns(
        &self,
        storage: &Path,
        session_id: &str,
    ) -> OpenBitFunResult<(Session, Vec<DialogTurnData>)>;
    async fn save_dialog_turn(&self, storage: &Path, turn: &DialogTurnData)
        -> OpenBitFunResult<()>;
    async fn load_dialog_turn(
        &self,
        storage: &Path,
        session_id: &str,
        turn_index: usize,
    ) -> OpenBitFunResult<Option<DialogTurnData>>;
}

#[async_trait::async_trait]
impl SessionRecords for PersistenceManager {
    async fn save_session(&self, storage: &Path, session: &Session) -> OpenBitFunResult<()> {
        PersistenceManager::save_session(self, storage, session).await
    }
    async fn load_session_with_turns(
        &self,
        storage: &Path,
        session_id: &str,
    ) -> OpenBitFunResult<(Session, Vec<DialogTurnData>)> {
        PersistenceManager::load_session_with_turns(self, storage, session_id).await
    }
    async fn save_dialog_turn(
        &self,
        storage: &Path,
        turn: &DialogTurnData,
    ) -> OpenBitFunResult<()> {
        PersistenceManager::save_dialog_turn(self, storage, turn).await
    }
    async fn load_dialog_turn(
        &self,
        storage: &Path,
        session_id: &str,
        turn_index: usize,
    ) -> OpenBitFunResult<Option<DialogTurnData>> {
        PersistenceManager::load_dialog_turn(self, storage, session_id, turn_index).await
    }
}

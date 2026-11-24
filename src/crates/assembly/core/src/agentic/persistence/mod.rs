//! Persistence layer
//!
//! Responsible for persistent storage and loading of data

pub mod manager;
mod session_records;
pub use session_records::SessionRecords;
pub mod session_branch;

pub use manager::{
    MaterializedSessionReferenceTranscript, PersistedSessionTurnPage, PersistenceManager,
};
pub use openbitfun_runtime_ports::SessionTurnLoadTiming;
pub use openbitfun_services_core::session::{
    SessionBranchRequest, SessionBranchResult, SessionLineageSnapshot, SessionMetadataPage,
};

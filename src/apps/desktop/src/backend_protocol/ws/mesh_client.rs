//! Client side of OBP over the account mesh, for a controller that drives
//! another device of the same account (Peer Device Mode, Detached Dispatch,
//! IM bots). The one implementation lives in the shared protocol crate
//! (`openbitfun_obp::client`, also used by the phone app); this module keeps
//! the desktop's import path.

#[cfg(test)]
pub(crate) use openbitfun_obp::client::LoopbackConnector;
pub use openbitfun_obp::client::{
    MeshCallError, MeshCaller, MeshConnectOptions, MeshConnector, MeshDialer, MeshObpConnection,
    MeshObpEvent, MeshOpenFuture, MeshTarget,
};

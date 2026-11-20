//! Serving OBP on OpenBitFun Link: Link's inbound streams as the mesh
//! listener's source, and the loop that keeps the listener in step with the
//! account (serving while Link runs for an account, stopped with every mesh
//! connection when it stops or the account changes).
//!
//! The desktop backend keeps its own loop (it also ends Peer Device Mode
//! links with the network); the CLI host uses [`serve_on_link`].

use std::net::{Ipv4Addr, SocketAddr};
use std::sync::Arc;

use openbitfun_link::session::{AccountIdentity, Link};
use openbitfun_link::{MeshState, MeshStatus};

use super::mesh::{MeshAcceptFuture, MeshIncoming};
use super::ObpServer;
use crate::authority::{MeshAuthority, MeshIo};

/// Link's inbound OBP streams as the mesh listener's source.
pub struct LinkIncoming(pub Arc<Link>);

impl MeshIncoming for LinkIncoming {
    fn accept(&self) -> MeshAcceptFuture<'_> {
        Box::pin(async move {
            let stream = self.0.accept().await?;
            let peer = stream.peer_addr();
            Some((Box::new(stream) as Box<dyn MeshIo>, peer))
        })
    }

    fn port(&self) -> Option<u16> {
        self.0.status().obp_port
    }
}

/// Runs `server`'s mesh listener for as long as `link` runs (until Link's
/// status stream ends). `authority` builds the device directory of the
/// account Link joined; `on_status` sees every status (for a host's own
/// status reporting).
pub async fn serve_on_link<A, S>(
    server: Arc<ObpServer>,
    link: Arc<Link>,
    authority: A,
    mut on_status: S,
) where
    A: Fn(&AccountIdentity) -> Arc<dyn MeshAuthority> + Send + Sync + 'static,
    S: FnMut(&MeshStatus, Option<u16>) + Send + 'static,
{
    let mut updates = link.subscribe();
    let mut serving: Option<AccountIdentity> = None;
    loop {
        let status = updates.borrow_and_update().clone();
        let account = if status.state == MeshState::Running {
            link.account().await
        } else {
            None
        };
        if serving != account {
            if serving.take().is_some() {
                server.stop_mesh();
            }
            if let Some(account) = account {
                let local = SocketAddr::from((
                    Ipv4Addr::UNSPECIFIED,
                    status
                        .obp_port
                        .unwrap_or(openbitfun_link::MESH_OBP_PORT_FIRST),
                ));
                match server
                    .start_mesh_with(
                        authority(&account),
                        Arc::new(LinkIncoming(Arc::clone(&link))),
                        local,
                    )
                    .await
                {
                    Ok(_) => serving = Some(account),
                    Err(error) => log::warn!("OBP mesh listener not started: {}", error),
                }
            }
        }
        on_status(&status, server.mesh_addr().map(|addr| addr.port()));
        if updates.changed().await.is_err() {
            break;
        }
    }
    server.stop_mesh();
}

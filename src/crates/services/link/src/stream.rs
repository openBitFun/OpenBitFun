//! Virtual TCP streams through the Link node's userspace stack.

use std::net::SocketAddr;
use std::pin::Pin;
use std::task::{Context, Poll};

use easytier_core::gateway::{DataPlaneTcpListener, DataPlaneTcpStream};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};

/// A virtual TCP stream to or from another node of the network.
pub struct LinkStream {
    inner: DataPlaneTcpStream,
    peer_addr: SocketAddr,
    peer_device: Option<String>,
}

impl std::fmt::Debug for LinkStream {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("LinkStream")
            .field("local_addr", &self.inner.local_addr())
            .field("peer_addr", &self.peer_addr)
            .field("peer_device", &self.peer_device)
            .finish()
    }
}

impl LinkStream {
    pub(crate) fn new(inner: DataPlaneTcpStream, peer_addr: SocketAddr) -> Self {
        Self {
            inner,
            peer_addr,
            peer_device: None,
        }
    }

    pub(crate) fn with_peer_device(mut self, device_id: String) -> Self {
        self.peer_device = Some(device_id);
        self
    }

    /// This end's virtual address.
    pub fn local_addr(&self) -> SocketAddr {
        self.inner.local_addr()
    }

    /// The other end's virtual address.
    pub fn peer_addr(&self) -> SocketAddr {
        self.peer_addr
    }

    /// The other end's device id, when known (outbound streams; inbound
    /// streams the caller resolved with `LinkNode::device_for_ip`).
    pub fn peer_device(&self) -> Option<&str> {
        self.peer_device.as_deref()
    }

    /// Labels the stream with the device it came from.
    pub fn set_peer_device(&mut self, device_id: Option<String>) {
        self.peer_device = device_id;
    }
}

impl AsyncRead for LinkStream {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.get_mut().inner).poll_read(cx, buf)
    }
}

impl AsyncWrite for LinkStream {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<std::io::Result<usize>> {
        Pin::new(&mut self.get_mut().inner).poll_write(cx, buf)
    }

    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.get_mut().inner).poll_flush(cx)
    }

    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.get_mut().inner).poll_shutdown(cx)
    }
}

/// Accepts virtual TCP streams on one port of this node's address.
pub struct LinkListener {
    inner: DataPlaneTcpListener,
}

impl LinkListener {
    pub(crate) fn new(inner: DataPlaneTcpListener) -> Self {
        Self { inner }
    }

    pub fn local_addr(&self) -> SocketAddr {
        self.inner.local_addr()
    }

    /// The next inbound stream. An error means the listener is gone (the
    /// node stopped or its address changed); bind again.
    pub async fn accept(&mut self) -> std::io::Result<LinkStream> {
        let (stream, peer_addr) = self.inner.accept().await?;
        Ok(LinkStream::new(stream, peer_addr))
    }
}

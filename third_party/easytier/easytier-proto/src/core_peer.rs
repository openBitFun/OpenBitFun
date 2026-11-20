pub mod peer {
    include!("../generated/core.peer.rs");
    #[cfg(feature = "json-rpc")]
    include!("../generated/core.peer.serde.rs");
}

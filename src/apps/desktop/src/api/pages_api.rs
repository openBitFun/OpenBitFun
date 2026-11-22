//! Server-hosted OpenBitFun Pages backend commands were retired in OpenBitFun 2.0.
//!
//! Tombstone rows remain in `openbitfun_product_domains::remote_surface::table`
//! (`retired("page_*", PAGES_RETIRED)`) so older clients receive an explicit
//! retirement reason.

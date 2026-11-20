//! Ordered backend event stream with sequence numbers, a bounded replay ring
//! and any number of independent subscribers. The implementation is the
//! shared protocol crate's (`openbitfun_obp::events`), so every host (this
//! backend, the CLI host) and every transport reads one ring type.

pub use openbitfun_obp::events::{
    BackendEvent, EventBatch, EventHub, EventSubscription, DEFAULT_EVENT_REPLAY_CAPACITY,
    EVENTS_DROPPED_EVENT,
};

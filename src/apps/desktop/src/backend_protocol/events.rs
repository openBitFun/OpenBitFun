//! Ordered backend event stream with sequence numbers, a bounded replay ring
//! and any number of independent subscribers.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use serde_json::Value;
use tokio::sync::watch;

/// Default number of events kept for replay.
pub const DEFAULT_EVENT_REPLAY_CAPACITY: usize = 2_000;

/// Synthetic event delivered to a subscriber whose cursor fell out of the
/// replay ring. Its payload names the first sequence number that is still
/// available; the client must re-hydrate the state it derives from events.
pub const EVENTS_DROPPED_EVENT: &str = "backend://events-dropped";

/// One backend event. `event` and `payload` are byte-identical to what the
/// Tauri host emitted; `seq` increases by one per published event.
#[derive(Debug, Clone, Serialize)]
pub struct BackendEvent {
    pub seq: u64,
    pub event: String,
    pub payload: Value,
}

/// Events after a cursor.
#[derive(Debug, Default)]
pub struct EventBatch {
    pub events: Vec<Arc<BackendEvent>>,
    /// The cursor to continue from (last sequence number in this batch, or
    /// the cursor passed in when the batch is empty).
    pub last_seq: u64,
    /// The hub was closed; no further events will arrive.
    pub closed: bool,
}

struct HubInner {
    ring: VecDeque<Arc<BackendEvent>>,
    last_seq: u64,
    capacity: usize,
    closed: bool,
}

/// The ordered event stream of one backend.
pub struct EventHub {
    inner: Mutex<HubInner>,
    latest: watch::Sender<u64>,
}

impl EventHub {
    pub fn new(capacity: usize) -> Arc<Self> {
        let (latest, _) = watch::channel(0);
        Arc::new(Self {
            inner: Mutex::new(HubInner {
                ring: VecDeque::with_capacity(capacity.min(4_096)),
                last_seq: 0,
                capacity: capacity.max(1),
                closed: false,
            }),
            latest,
        })
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HubInner> {
        match self.inner.lock() {
            Ok(inner) => inner,
            Err(poisoned) => poisoned.into_inner(),
        }
    }

    /// Appends one event and wakes every subscriber. Returns its sequence
    /// number (the first event is 1).
    pub fn publish(&self, event: &str, payload: Value) -> u64 {
        let seq = {
            let mut inner = self.lock();
            if inner.closed {
                return inner.last_seq;
            }
            inner.last_seq += 1;
            let seq = inner.last_seq;
            if inner.ring.len() == inner.capacity {
                inner.ring.pop_front();
            }
            inner.ring.push_back(Arc::new(BackendEvent {
                seq,
                event: event.to_owned(),
                payload,
            }));
            seq
        };
        self.latest.send_replace(seq);
        seq
    }

    /// The sequence number of the newest event (0 before the first one).
    pub fn last_seq(&self) -> u64 {
        self.lock().last_seq
    }

    /// Stops the stream; waiting subscribers get a closed, empty batch.
    pub fn close(&self) {
        let seq = {
            let mut inner = self.lock();
            inner.closed = true;
            inner.last_seq
        };
        // Wake waiters even when no new event was published.
        self.latest.send_modify(|value| *value = seq);
    }

    /// Up to `max` events with `seq > after`, without waiting. When the
    /// cursor fell out of the replay ring, the batch starts with a synthetic
    /// [`EVENTS_DROPPED_EVENT`].
    pub fn events_after(&self, after: u64, max: usize) -> EventBatch {
        let inner = self.lock();
        let mut batch = EventBatch {
            events: Vec::new(),
            last_seq: after,
            closed: inner.closed,
        };
        if inner.last_seq <= after {
            if inner.last_seq < after {
                // A cursor from a previous process (or a future one): restart.
                batch.last_seq = inner.last_seq;
            }
            return batch;
        }
        let max = max.max(1);
        let oldest = inner.ring.front().map(|event| event.seq).unwrap_or(1);
        if after + 1 < oldest {
            batch.events.push(Arc::new(BackendEvent {
                seq: oldest - 1,
                event: EVENTS_DROPPED_EVENT.to_owned(),
                payload: serde_json::json!({
                    "afterSeq": after,
                    "resumeSeq": oldest,
                }),
            }));
        }
        let start = (after + 1).max(oldest);
        let skip = (start - oldest) as usize;
        for event in inner.ring.iter().skip(skip) {
            if batch.events.len() >= max {
                break;
            }
            batch.last_seq = event.seq;
            batch.events.push(Arc::clone(event));
        }
        if batch.last_seq == after {
            batch.last_seq = oldest - 1;
        }
        batch
    }

    /// Waits until at least one event with `seq > after` exists (or the hub
    /// closes), then returns up to `max` of them.
    pub async fn wait_events_after(&self, after: u64, max: usize) -> EventBatch {
        let mut latest = self.latest.subscribe();
        loop {
            let batch = self.events_after(after, max);
            if !batch.events.is_empty() || batch.closed {
                return batch;
            }
            // A stale cursor beyond the current stream restarts from the
            // newest event instead of waiting forever.
            if batch.last_seq < after {
                return batch;
            }
            if latest.changed().await.is_err() {
                return EventBatch {
                    events: Vec::new(),
                    last_seq: after,
                    closed: true,
                };
            }
        }
    }

    /// A subscriber with its own cursor. `after: None` starts after the
    /// newest event (only new events); `Some(n)` replays events after `n`.
    pub fn subscribe(self: &Arc<Self>, after: Option<u64>) -> EventSubscription {
        let cursor = after.unwrap_or_else(|| self.last_seq());
        EventSubscription {
            hub: Arc::clone(self),
            cursor,
        }
    }
}

/// One subscriber's cursor over an [`EventHub`].
pub struct EventSubscription {
    hub: Arc<EventHub>,
    cursor: u64,
}

impl EventSubscription {
    /// The sequence number of the last delivered event.
    pub fn cursor(&self) -> u64 {
        self.cursor
    }

    /// Waits for the next batch and advances the cursor.
    pub async fn next_batch(&mut self, max: usize) -> EventBatch {
        let batch = self.hub.wait_events_after(self.cursor, max).await;
        self.cursor = batch.last_seq;
        batch
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn subscribers_keep_independent_cursors_and_replay() {
        let hub = EventHub::new(4);
        let mut early = hub.subscribe(Some(0));
        hub.publish("a", Value::from(1));
        hub.publish("b", Value::from(2));
        let mut late = hub.subscribe(None);
        hub.publish("c", Value::from(3));

        let batch = early.next_batch(10).await;
        let names: Vec<_> = batch.events.iter().map(|e| e.event.as_str()).collect();
        assert_eq!(names, ["a", "b", "c"]);
        assert_eq!(early.cursor(), 3);

        let batch = late.next_batch(10).await;
        assert_eq!(batch.events.len(), 1);
        assert_eq!(batch.events[0].seq, 3);
    }

    #[test]
    fn a_cursor_outside_the_ring_reports_dropped_events() {
        let hub = EventHub::new(2);
        for index in 0..5 {
            hub.publish("e", Value::from(index));
        }
        let batch = hub.events_after(1, 10);
        assert_eq!(batch.events[0].event, EVENTS_DROPPED_EVENT);
        assert_eq!(batch.events[0].payload["resumeSeq"], 4);
        let seqs: Vec<_> = batch.events[1..].iter().map(|e| e.seq).collect();
        assert_eq!(seqs, [4, 5]);
        assert_eq!(batch.last_seq, 5);
    }

    #[test]
    fn batches_are_capped_and_resume_from_the_cursor() {
        let hub = EventHub::new(10);
        for index in 0..5 {
            hub.publish("e", Value::from(index));
        }
        let first = hub.events_after(0, 2);
        assert_eq!(first.last_seq, 2);
        let second = hub.events_after(first.last_seq, 10);
        let seqs: Vec<_> = second.events.iter().map(|e| e.seq).collect();
        assert_eq!(seqs, [3, 4, 5]);
    }

    #[tokio::test]
    async fn close_wakes_waiting_subscribers() {
        let hub = EventHub::new(4);
        let mut subscription = hub.subscribe(None);
        let waiter = tokio::spawn(async move { subscription.next_batch(10).await });
        tokio::task::yield_now().await;
        hub.close();
        let batch = waiter.await.expect("waiter");
        assert!(batch.closed);
        assert!(batch.events.is_empty());
    }
}

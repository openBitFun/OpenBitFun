//! Tracks executions until their spawned task releases its last lease. A
//! cancelled turn can still be persisting state after the UI sees it stop.
use dashmap::{mapref::entry::Entry, DashMap};
use std::sync::Arc;
use tokio::time::{sleep, Duration, Instant};

#[derive(Debug, Default)]
pub struct SessionExecutions {
    counts: DashMap<String, usize>,
}

impl SessionExecutions {
    pub fn register(self: &Arc<Self>, session_id: &str) -> SessionExecutionLease {
        *self.counts.entry(session_id.to_owned()).or_default() += 1;
        SessionExecutionLease {
            owner: self.clone(),
            session_id: session_id.to_owned(),
        }
    }

    pub fn count(&self, session_id: &str) -> usize {
        self.counts.get(session_id).map_or(0, |count| *count)
    }

    pub async fn wait_drained(&self, session_id: &str, max_wait: Duration) -> usize {
        let started = Instant::now();
        loop {
            let count = self.count(session_id);
            if count == 0 || started.elapsed() >= max_wait {
                return count;
            }
            sleep(Duration::from_millis(20)).await;
        }
    }
}

#[derive(Debug)]
pub struct SessionExecutionLease {
    owner: Arc<SessionExecutions>,
    session_id: String,
}

impl Drop for SessionExecutionLease {
    fn drop(&mut self) {
        if let Entry::Occupied(mut entry) = self.owner.counts.entry(self.session_id.clone()) {
            *entry.get_mut() -= 1;
            if *entry.get() == 0 {
                entry.remove();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn drain_counts_all_leases_and_dropping_an_unpolled_task_releases_its_lease() {
        let executions = Arc::new(SessionExecutions::default());
        let first = executions.register("session");
        let second = executions.register("session");
        let unpolled_task = async move { drop(second) };
        assert_eq!(executions.wait_drained("session", Duration::ZERO).await, 2);
        drop(unpolled_task);
        assert_eq!(executions.count("session"), 1);
        let other = executions.register("other");
        drop(first);
        assert_eq!(executions.wait_drained("session", Duration::ZERO).await, 0);
        assert_eq!(executions.count("other"), 1);
        drop(other);
    }
}

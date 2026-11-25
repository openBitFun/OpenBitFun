//! Execute a tool round against the host's registered tasks and permission mailbox.
use super::{
    partition_tool_batches, retry_delay_ms, should_retry_tool_attempt,
    SubagentBatchExecutionPolicy, ToolExecutionErrorClass, ToolRetryAttemptFacts,
};
use std::future::Future;
use tokio_util::sync::CancellationToken;

/// The product installs a cooperative preemption watch for one atomic unit.
pub enum ToolAdmission {
    Interrupted,
    Run(Option<tokio::task::JoinHandle<()>>),
}

pub trait ToolBatchOperations: Sync {
    type Output: Send;
    type Error: Send;

    fn pre_tool_hooks(&self, ids: &[String]) -> impl Future<Output = ()> + Send;
    fn concurrency_after_hooks(
        &self,
        ids: &[String],
        subagents: usize,
        policy: SubagentBatchExecutionPolicy,
    ) -> impl Future<Output = Vec<bool>> + Send;
    fn prepare_permissions(
        &self,
        ids: &[String],
    ) -> impl Future<Output = Result<(), Self::Error>> + Send;
    fn cleanup_permissions(&self, ids: &[String], reason: &str) -> impl Future<Output = ()> + Send;
    fn batch_interrupted(&self, first: &str) -> bool;
    fn interrupted_results(
        &self,
        ids: Vec<String>,
    ) -> impl Future<Output = Vec<Self::Output>> + Send;
    fn start_unit(&self, ids: &[String], check_interrupt: bool) -> ToolAdmission;
    fn execute_task(
        &self,
        id: String,
    ) -> impl Future<Output = Result<Self::Output, Self::Error>> + Send;
    fn failed_result(&self, id: &str, error: Self::Error) -> Self::Output;
}

/// A call that changes hook policy closes a segment. Finish that segment
/// before preflighting the next one so rewritten arguments and new hooks apply.
pub async fn execute_segments<B: ToolBatchOperations>(
    host: &B,
    task_ids: &[String],
    segments: Vec<Vec<String>>,
    allow_parallel: bool,
    subagents: usize,
    policy: SubagentBatchExecutionPolicy,
    interrupted: impl Fn() -> bool,
) -> Result<Vec<B::Output>, B::Error> {
    let mut results = Vec::with_capacity(task_ids.len());
    let mut segments = segments.into_iter();
    while let Some(segment) = segments.next() {
        if interrupted() {
            let remaining = segment.into_iter().chain(segments.flatten()).collect();
            results.extend(host.interrupted_results(remaining).await);
            break;
        }
        host.pre_tool_hooks(&segment).await;
        let flags = host
            .concurrency_after_hooks(&segment, subagents, policy)
            .await;
        if let Err(error) = host.prepare_permissions(&segment).await {
            host.cleanup_permissions(&segment, "Permission planning failed")
                .await;
            host.cleanup_permissions(task_ids, "Tool execution failed")
                .await;
            return Err(error);
        }
        if !allow_parallel {
            execute_batch(host, segment.clone(), false, &mut results).await;
            host.cleanup_permissions(&segment, "Tool execution finished")
                .await;
            continue;
        }
        let mut batches = partition_tool_batches(&segment, &flags).into_iter();
        while let Some(batch) = batches.next() {
            if batch
                .task_ids
                .first()
                .is_some_and(|id| host.batch_interrupted(id))
            {
                let remaining = batch
                    .task_ids
                    .into_iter()
                    .chain(batches.flat_map(|batch| batch.task_ids))
                    .collect();
                results.extend(host.interrupted_results(remaining).await);
                break;
            }
            execute_batch(host, batch.task_ids, batch.is_concurrent, &mut results).await;
        }
        host.cleanup_permissions(&segment, "Tool execution finished")
            .await;
    }
    Ok(results)
}

async fn finish_watch(watch: Option<tokio::task::JoinHandle<()>>) {
    if let Some(watch) = watch {
        watch.abort();
        let _ = watch.await;
    }
}

async fn execute_batch<B: ToolBatchOperations>(
    host: &B,
    ids: Vec<String>,
    concurrent: bool,
    results: &mut Vec<B::Output>,
) {
    if concurrent {
        match host.start_unit(&ids, false) {
            ToolAdmission::Interrupted => results.extend(host.interrupted_results(ids).await),
            ToolAdmission::Run(watch) => {
                let outcomes =
                    futures::future::join_all(ids.iter().cloned().map(|id| host.execute_task(id)))
                        .await;
                finish_watch(watch).await;
                // Publish in call order, including failed tools, regardless of completion order.
                results.extend(ids.iter().zip(outcomes).map(|(id, outcome)| {
                    outcome.unwrap_or_else(|error| host.failed_result(id, error))
                }));
            }
        }
    } else {
        let mut pending = ids.into_iter();
        while let Some(id) = pending.next() {
            match host.start_unit(std::slice::from_ref(&id), true) {
                ToolAdmission::Interrupted => {
                    results.extend(
                        host.interrupted_results(std::iter::once(id).chain(pending).collect())
                            .await,
                    );
                    break;
                }
                ToolAdmission::Run(watch) => {
                    let outcome = host.execute_task(id.clone()).await;
                    finish_watch(watch).await;
                    results.push(outcome.unwrap_or_else(|error| host.failed_result(&id, error)));
                }
            }
        }
    }
}

/// Retry only errors classified as retryable by the registered implementation.
pub async fn run_tool_attempts<T, E: std::fmt::Display, F: Future<Output = Result<T, E>>>(
    max_attempts: usize,
    cancellation: &CancellationToken,
    cancelled: impl Fn() -> E,
    classify: impl Fn(&E) -> ToolExecutionErrorClass,
    mut execute: impl FnMut() -> F,
) -> Result<T, E> {
    let mut attempts = 0;
    loop {
        if cancellation.is_cancelled() {
            return Err(cancelled());
        }
        attempts += 1;
        match execute().await {
            Ok(result) => return Ok(result),
            Err(error) => {
                if !should_retry_tool_attempt(ToolRetryAttemptFacts {
                    attempts,
                    max_attempts,
                    error_class: classify(&error),
                }) {
                    return Err(error);
                }
                log::debug!(
                    "Retrying tool execution: attempt={}/{}, error={}",
                    attempts,
                    max_attempts,
                    error
                );
                tokio::time::sleep(std::time::Duration::from_millis(retry_delay_ms(attempts)))
                    .await;
            }
        }
    }
}

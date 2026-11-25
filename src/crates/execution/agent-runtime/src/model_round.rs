//! One logical model round can span several provider attempts and overflow recovery.
use std::future::Future;
use std::time::Instant;
use tokio_util::sync::CancellationToken;

/// Mutable lifecycle shared by all provider attempts that belong to one
/// logical model round, including attempts made after overflow recovery.
#[derive(Debug)]
pub struct ModelRoundLifecycle {
    pub round_id: String,
    pub started_at: Instant,
    started_event_emitted: bool,
    pub routing: Option<openbitfun_events::agentic::ModelRoutingDecision>,
    attempts_started: u32,
    safe_to_switch_model: bool,
    observed_effective_output: bool,
}

impl ModelRoundLifecycle {
    pub fn new() -> Self {
        Self {
            round_id: uuid::Uuid::new_v4().to_string(),
            started_at: Instant::now(),
            started_event_emitted: false,
            routing: None,
            attempts_started: 0,
            safe_to_switch_model: false,
            observed_effective_output: false,
        }
    }

    pub fn observe_output(&mut self, has_effective_output: bool) {
        self.observed_effective_output |= has_effective_output;
        self.safe_to_switch_model &= !self.observed_effective_output;
    }

    pub fn begin_model(&mut self, pool_selected: bool) {
        self.safe_to_switch_model = pool_selected && !self.observed_effective_output;
    }

    pub fn finish_model(&mut self) {
        self.safe_to_switch_model = false;
    }

    pub fn can_switch_model(&self) -> bool {
        self.safe_to_switch_model
    }

    pub fn observed_output(&self) -> bool {
        self.observed_effective_output
    }

    pub fn take_started_event(&mut self) -> bool {
        if self.started_event_emitted {
            false
        } else {
            self.started_event_emitted = true;
            true
        }
    }

    pub fn begin_attempt(&mut self) -> u32 {
        self.attempts_started = self.attempts_started.saturating_add(1);
        self.attempts_started
    }

    pub fn attempts_started(&self) -> u32 {
        self.attempts_started
    }
}

impl Default for ModelRoundLifecycle {
    fn default() -> Self {
        Self::new()
    }
}

/// The account provider can change within this budget. Pool failover starts
/// a fresh member budget while retaining the logical round's attempt ledger.
pub struct ModelAttempts {
    started: usize,
    limit: usize,
}

impl ModelAttempts {
    pub fn new(limit: usize) -> Self {
        Self { started: 0, limit }
    }

    pub fn start(&mut self, round: &mut ModelRoundLifecycle) -> (u32, usize) {
        let index = self.started;
        self.started += 1;
        (round.begin_attempt(), index)
    }

    pub fn remaining(&self) -> usize {
        self.limit.saturating_sub(self.started)
    }
}

/// A partial stream may contain both usable output and broken tool arguments.
/// Keep provider retry eligibility separate from the raw stream's output flag.
pub struct StreamObservation<'a> {
    pub partial: Option<&'a str>,
    pub visible_text: bool,
    pub thinking: bool,
    pub effective_output: bool,
    pub valid_calls: bool,
    pub invalid_calls: bool,
}

#[derive(Debug, PartialEq, Eq)]
pub enum StreamDisposition<'a> {
    Accept,
    KeepValidCalls(&'a str),
    Retry {
        category: &'static str,
        message: &'a str,
        partial: bool,
        diagnostic_detail: bool,
    },
    Fail {
        message: &'a str,
        report_tool_failures: bool,
    },
}

impl ModelAttempts {
    pub fn resolve_stream<'a>(
        &self,
        round: &mut ModelRoundLifecycle,
        stream: StreamObservation<'a>,
    ) -> StreamDisposition<'a> {
        round.observe_output(stream.visible_text || stream.thinking || stream.valid_calls);
        if let Some(reason) = stream.partial {
            if self.remaining() > 0 {
                return StreamDisposition::Retry {
                    category: if stream.invalid_calls {
                        "interrupted_tool_arguments"
                    } else {
                        "partial_stream_error"
                    },
                    message: reason,
                    partial: true,
                    diagnostic_detail: true,
                };
            }
            if stream.invalid_calls {
                return if stream.visible_text {
                    StreamDisposition::KeepValidCalls(reason)
                } else {
                    StreamDisposition::Fail {
                        message: reason,
                        report_tool_failures: true,
                    }
                };
            }
        } else if !stream.visible_text && stream.invalid_calls && !stream.valid_calls {
            let message = "Provider returned only invalid tool arguments";
            return if self.remaining() > 0 {
                StreamDisposition::Retry {
                    category: "invalid_tool_arguments",
                    message,
                    partial: false,
                    diagnostic_detail: false,
                }
            } else {
                StreamDisposition::Fail {
                    message,
                    report_tool_failures: true,
                }
            };
        }
        if !stream.effective_output {
            let message = stream.partial.unwrap_or("No effective output received");
            return if self.remaining() > 0 {
                StreamDisposition::Retry {
                    category: "no_effective_output",
                    message,
                    partial: false,
                    diagnostic_detail: true,
                }
            } else {
                StreamDisposition::Fail {
                    message,
                    report_tool_failures: false,
                }
            };
        }
        StreamDisposition::Accept
    }
}

pub enum ModelAttempt<T, R, E> {
    Cancelled,
    OpenFailed(E),
    CancelledAfterOpen(R),
    Stream(T),
}

/// Once opened, the stream processor owns partial-output cancellation. Hand an
/// accepted but unread response back to the host for trace and usage settlement.
pub async fn run_model_attempt<R, T, E, F>(
    cancellation: &CancellationToken,
    open: impl Future<Output = Result<R, E>>,
    consume: impl FnOnce(R) -> F,
) -> ModelAttempt<T, R, E>
where
    F: Future<Output = T>,
{
    let response = tokio::select! {
        _ = cancellation.cancelled() => return ModelAttempt::Cancelled,
        result = open => match result {
            Ok(response) => response,
            Err(error) => return ModelAttempt::OpenFailed(error),
        },
    };
    if cancellation.is_cancelled() {
        return ModelAttempt::CancelledAfterOpen(response);
    }
    ModelAttempt::Stream(consume(response).await)
}

pub struct ToolPhase<M> {
    pub assistant_committed: bool,
    pub messages: Vec<M>,
}

impl<M> ToolPhase<M> {
    pub fn finish_reason(&self) -> crate::events::FinishReason {
        if self.messages.is_empty() {
            crate::events::FinishReason::Complete
        } else {
            crate::events::FinishReason::ToolCalls
        }
    }
}

/// A text-only reply goes directly to turn settlement. For a tool round,
/// publish the assistant call before any side effects, then recheck cancellation.
/// The turn owns the token until all model rounds have settled.
pub async fn run_round_tools<M, E>(
    has_calls: bool,
    cancel_token: &CancellationToken,
    cancelled: impl FnOnce() -> E,
    publish_assistant: impl Future<Output = Result<bool, E>>,
    execute: impl Future<Output = Result<Vec<M>, E>>,
) -> Result<ToolPhase<M>, E> {
    if !has_calls {
        return Ok(ToolPhase {
            assistant_committed: false,
            messages: Vec::new(),
        });
    }
    let assistant_committed = publish_assistant.await?;
    if cancel_token.is_cancelled() {
        return Err(cancelled());
    }
    let messages = execute.await?;
    Ok(ToolPhase {
        assistant_committed,
        messages,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn accepted_request_cancelled_before_consumption_returns_the_response_for_settlement() {
        let token = CancellationToken::new();
        let result = run_model_attempt(
            &token,
            async {
                token.cancel();
                Ok::<_, ()>("accepted")
            },
            |_| async { panic!("cancelled stream must not be consumed") },
        )
        .await;
        assert!(matches!(
            result,
            ModelAttempt::CancelledAfterOpen("accepted")
        ));
    }

    #[test]
    fn partial_tool_arguments_share_the_round_budget_and_keep_only_usable_output() {
        let mut round = ModelRoundLifecycle::new();
        round.begin_model(true);
        let mut attempts = ModelAttempts::new(2);
        let partial = |visible_text| StreamObservation {
            partial: Some("interrupted"),
            visible_text,
            thinking: false,
            effective_output: true,
            valid_calls: false,
            invalid_calls: true,
        };
        assert_eq!(attempts.start(&mut round), (1, 0));
        assert!(matches!(
            attempts.resolve_stream(&mut round, partial(false)),
            StreamDisposition::Retry {
                category: "interrupted_tool_arguments",
                ..
            }
        ));
        assert!(round.can_switch_model());
        assert_eq!(attempts.start(&mut round), (2, 1));
        assert!(matches!(
            attempts.resolve_stream(&mut round, partial(true)),
            StreamDisposition::KeepValidCalls("interrupted")
        ));
        round.begin_model(true);
        assert!(!round.can_switch_model());
    }
}

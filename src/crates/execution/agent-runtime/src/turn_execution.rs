//! Turn progression shared by session hosts. Recovery re-enters the current
//! logical round. Only a committed round advances the index and turn budget.
pub mod context;

use std::future::Future;
use std::ops::ControlFlow;

pub fn reached_fixed_model_round_limit(max_rounds: usize, completed_rounds: usize) -> bool {
    max_rounds > 0 && completed_rounds >= max_rounds
}

/// Re-entering after recovery does not advance either the budget or the
/// durable round index. The caller acknowledges a round only after success.
pub struct TurnExecution {
    first_round: usize,
    signatures: Vec<String>,
    failures: Vec<String>,
    recovery_attempts: usize,
    partial_continuations: usize,
    stop_continuations: usize,
    max_rounds: usize,
    completed: usize,
    status: ControlFlow<Option<&'static str>>,
}

impl TurnExecution {
    pub fn new(first_round: usize, max_rounds: usize) -> Self {
        Self {
            first_round,
            signatures: Vec::new(),
            failures: Vec::new(),
            recovery_attempts: 0,
            partial_continuations: 0,
            stop_continuations: 0,
            max_rounds,
            completed: 0,
            status: ControlFlow::Continue(()),
        }
    }

    pub fn next_round<E>(
        &mut self,
        check_cancellation: impl FnOnce() -> Result<(), E>,
    ) -> Result<Option<usize>, E> {
        if self.status.is_break() {
            return Ok(None);
        }
        check_cancellation()?;
        if reached_fixed_model_round_limit(self.max_rounds, self.completed) {
            self.finish(Some("max_rounds"));
            return Ok(None);
        }
        Ok(Some(self.first_round + self.completed))
    }

    pub fn round_completed(&mut self) {
        self.completed += 1;
    }

    pub fn finish(&mut self, reason: Option<&'static str>) {
        self.status = ControlFlow::Break(reason);
    }

    pub fn into_result(self) -> (usize, Option<&'static str>) {
        (self.completed, self.status.break_value().flatten())
    }
}

pub fn should_continue_after_partial_response(reason: &str) -> bool {
    !reason.to_ascii_lowercase().contains("cancelled")
}

pub enum TurnBoundary {
    Continue,
    Finish(Option<&'static str>),
    Interrupted(String),
    StopHook(String),
    ThinkingOnly(&'static str),
}

pub struct RoundOutput<'a> {
    pub injected: bool,
    pub tool_results: bool,
    pub assistant_text: bool,
    pub quiet_end: bool,
    pub thinking: bool,
    pub partial_reason: Option<&'a str>,
    pub top_level: bool,
}

pub enum ToolFailureRecovery {
    None,
    Repeated(String),
    Periodic(String),
    Exhausted,
}

impl TurnExecution {
    pub fn tool_signatures(&self) -> &[String] {
        &self.signatures
    }

    pub fn observe_tools(&mut self, signature: Option<String>, failed: bool) {
        if let Some(signature) = signature {
            self.signatures.push(signature.clone());
            if failed {
                self.failures.push(signature);
                return;
            }
        } else {
            self.signatures.clear();
        }
        self.failures.clear();
        self.recovery_attempts = 0;
    }

    pub fn tool_failure_recovery(&mut self, threshold: usize) -> ToolFailureRecovery {
        let max_consec = threshold.max(1);
        let repeated = self.failures.len() >= max_consec
            && self.failures[self.failures.len() - max_consec..]
                .windows(2)
                .all(|w| w[0] == w[1]);
        if !repeated && !is_periodic_tool_signature_loop(&self.failures, max_consec) {
            return ToolFailureRecovery::None;
        }
        if self.recovery_attempts >= 3 {
            return ToolFailureRecovery::Exhausted;
        }
        self.recovery_attempts += 1;
        self.failures.clear();
        if repeated {
            ToolFailureRecovery::Repeated(format!(
                            "<system_reminder>Repeated tool failure detected: the same tool call with identical arguments has failed {} times in a row. \
                            The current approach is not making progress. You MUST now change your strategy: \
                            (1) if the tool keeps failing, try a completely different approach or tool; \
                            (2) if you are stuck, step back and reason about the root cause before acting; \
                            (3) if the task is genuinely impossible with the available tools, provide a clear explanation to the user. \
                            Do NOT repeat the same tool call again.</system_reminder>",
                            max_consec))
        } else {
            let window_size = max_consec.saturating_mul(2);
            ToolFailureRecovery::Periodic(format!(
                        "<system_reminder>Repeated tool failure detected: your last {} failed tool calls form a repeating pattern with no new progress. \
                        You are cycling between failing actions without advancing the task. You MUST now change your strategy: \
                        (1) try a completely different approach or tool; \
                        (2) step back and reason about the root cause before acting; \
                        (3) if the task is genuinely impossible with the available tools, provide a clear explanation to the user. \
                        Do NOT repeat the same pattern of tool calls.</system_reminder>",
                        window_size))
        }
    }

    pub async fn after_round<F: Future<Output = Option<String>>>(
        &mut self,
        output: RoundOutput<'_>,
        stop_hook: impl FnOnce(bool) -> F,
    ) -> TurnBoundary {
        if output.injected || output.tool_results {
            return TurnBoundary::Continue;
        }
        if output.assistant_text || output.quiet_end {
            if let Some(reason) = output.partial_reason {
                if !should_continue_after_partial_response(reason) {
                    return TurnBoundary::Finish(None);
                }
                self.partial_continuations += 1;
                if self.partial_continuations > 3 {
                    return TurnBoundary::Finish(Some("partial_truncated"));
                }
                return TurnBoundary::Interrupted(format!("<system_reminder>Your previous assistant response was interrupted mid-stream ({reason}). Continue writing from exactly where you stopped. Do not repeat content that was already delivered; pick up seamlessly and complete the answer.</system_reminder>"));
            }
            if output.top_level && self.stop_continuations < 3 {
                if let Some(reason) = stop_hook(self.stop_continuations > 0).await {
                    self.stop_continuations += 1;
                    return TurnBoundary::StopHook(format!("<system_reminder>A Stop hook blocked the end of this turn: {reason}\nAddress this before finishing, then produce your final answer.</system_reminder>"));
                }
            }
            return TurnBoundary::Finish(output.quiet_end.then_some("background_quiet"));
        }
        if output.thinking {
            TurnBoundary::ThinkingOnly("<system_reminder>The previous round produced internal reasoning only — no tool call and no user-visible response. You MUST now either: (1) call the single tool that best advances the user's task, or (2) write your final answer to the user. Do not produce another round of reasoning without taking action.</system_reminder>")
        } else {
            TurnBoundary::Finish(Some("empty_round"))
        }
    }
}

/// Preserve model history order and commit all still-unpublished messages in
/// one mutation. The assistant tool call may already be durable before tools run.
pub fn append_round_messages<M: Clone>(
    history: &mut Vec<M>,
    assistant: &M,
    assistant_committed: bool,
    tool_results: &[M],
    mut remember: impl FnMut(&M),
) -> Vec<M> {
    let mut pending = Vec::with_capacity(tool_results.len() + usize::from(!assistant_committed));
    history.push(assistant.clone());
    remember(assistant);
    if !assistant_committed {
        pending.push(assistant.clone());
    }
    for result in tool_results {
        history.push(result.clone());
        remember(result);
        pending.push(result.clone());
    }
    pending
}

/// Detect periodic tool-signature loops in the trailing window.
///
/// Returns `true` when the last `2 * threshold` rounds contain at most
/// `threshold` distinct signatures AND every signature in that window
/// appeared at least twice. Such windows have no new exploration and
/// represent the model toggling between a small fixed set of calls
/// (e.g. `A-B-A-B-A-B`, `A-B-C-A-B-C`).
///
/// The window length is `2 * threshold` (rather than `threshold`) so the
/// strict consecutive check (`windows(2).all(eq)`) keeps owning the
/// `A-A-A` case at threshold rounds, and this detector only fires once
/// the alternating pattern has had room to repeat.
pub fn is_periodic_tool_signature_loop(recent_signatures: &[String], threshold: usize) -> bool {
    let threshold = threshold.max(1);
    let window_size = threshold.saturating_mul(2);
    if window_size == 0 || recent_signatures.len() < window_size {
        return false;
    }

    let tail = &recent_signatures[recent_signatures.len() - window_size..];
    let mut counts: std::collections::HashMap<&str, usize> = std::collections::HashMap::new();
    for sig in tail {
        *counts.entry(sig.as_str()).or_insert(0) += 1;
    }

    if counts.len() > threshold {
        return false;
    }

    counts.values().all(|&count| count >= 2)
}

/// The no-tools finalize request gets one identical retry for an unusable
/// response. A local fallback retains the first attempt's historical usage.
/// Transport errors propagate without triggering a second finalize request.
pub async fn finalize_turn<M, U, E, F: Future<Output = Result<(Option<M>, Option<U>), E>>>(
    mut request: impl FnMut() -> F,
) -> Result<(Option<M>, Option<U>), E> {
    let (first, first_usage) = request().await?;
    if first.is_some() {
        return Ok((first, first_usage));
    }
    let (retry, retry_usage) = request().await?;
    if retry.is_some() {
        Ok((retry, retry_usage))
    } else {
        Ok((None, first_usage))
    }
}

pub fn build_local_final_response_message(reason: &str) -> String {
    match reason {
            "repeated_tool_failures" => {
                "I'm stopping here because repeated tool failures prevented further progress in this turn.".to_string()
            }
            "max_rounds" => {
                "I'm stopping here because this turn reached its round limit before I could complete a final response.".to_string()
            }
            _ => "I'm stopping here because this turn could not be completed successfully.".to_string(),
        }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn recovery_reuses_the_round_and_stop_hooks_only_reopen_a_natural_finish() {
        let mut turn = TurnExecution::new(4, 3);
        let admit = || Ok::<(), ()>(());
        assert_eq!(turn.next_round(admit), Ok(Some(4)));
        assert_eq!(turn.next_round(admit), Ok(Some(4)));
        turn.round_completed();
        assert_eq!(turn.next_round(admit), Ok(Some(5)));
        let output = || RoundOutput {
            injected: false,
            tool_results: false,
            assistant_text: true,
            quiet_end: false,
            thinking: false,
            partial_reason: None,
            top_level: true,
        };
        let partial = RoundOutput {
            partial_reason: Some("stream timeout"),
            ..output()
        };
        assert!(matches!(
            turn.after_round(partial, |_| async { panic!("partial response ran Stop") })
                .await,
            TurnBoundary::Interrupted(_)
        ));
        assert!(matches!(
            turn.after_round(output(), |active| async move {
                assert!(!active);
                Some("retry".to_owned())
            })
            .await,
            TurnBoundary::StopHook(_)
        ));
        assert!(matches!(
            turn.after_round(output(), |active| async move {
                assert!(active);
                None
            })
            .await,
            TurnBoundary::Finish(None)
        ));
        turn.finish(None);
        assert_eq!(turn.next_round(admit), Ok(None));
    }

    #[tokio::test]
    async fn finalization_preserves_the_accepted_reply_or_the_first_usage_on_local_fallback() {
        for (replies, expected, calls) in [
            ([Some("first"), None], (Some("first"), Some(0)), 1),
            ([None, Some("retry")], (Some("retry"), Some(1)), 2),
            ([None, None], (None, Some(0)), 2),
        ] {
            let mut count = 0;
            let result = finalize_turn(|| {
                let response = (replies[count], Some(count));
                count += 1;
                std::future::ready(Ok::<_, ()>(response))
            })
            .await;
            assert_eq!(result, Ok(expected));
            assert_eq!(count, calls);
        }
    }

    #[test]
    fn committed_assistant_stays_in_model_history_once_and_only_tool_results_are_published() {
        let mut messages = vec!["user"];
        let mut observed = Vec::new();
        let pending = append_round_messages(
            &mut messages,
            &"assistant",
            true,
            &["tool A", "tool B"],
            |message| observed.push(*message),
        );
        assert_eq!(messages, ["user", "assistant", "tool A", "tool B"]);
        assert_eq!(observed, &messages[1..]);
        assert_eq!(pending, ["tool A", "tool B"]);
    }
}

use openbitfun_agent_runtime::user_questions::USER_INPUT_AVAILABLE_CONTEXT_KEY;
use serde_json::{Map, Value};

use crate::runtime::approval::{approval_metadata, CliApprovalPolicy};

use super::protocol::DispatchApprovalPolicy;

pub(crate) const REJECT_AND_REPORT_REASON: &str =
    "Dispatch permission policy rejected an action that requires confirmation";

pub(crate) const fn cli_policy(policy: DispatchApprovalPolicy) -> CliApprovalPolicy {
    match policy {
        DispatchApprovalPolicy::Auto => CliApprovalPolicy::ImmediateAllow,
        DispatchApprovalPolicy::RejectAndReport => CliApprovalPolicy::Reject,
        DispatchApprovalPolicy::Remote => CliApprovalPolicy::DisableAuto,
    }
}

#[cfg(test)]
pub(crate) fn metadata(policy: DispatchApprovalPolicy) -> Map<String, Value> {
    metadata_for_job(policy, false)
}

/// Turn metadata for a job. AskUserQuestion is available only when the
/// controller opted into the job's question mailbox (`submit
/// {userQuestions: true}`, `user_question_mailbox_v1`): then a question lands
/// in the mailbox and waits for the user or the controller. Without the
/// opt-in nobody would answer, so the Runtime's availability gate makes the
/// tool fail explicitly instead of waiting. Permission supervision alone is
/// not evidence that a controller can answer questions.
pub(crate) fn metadata_for_job(
    policy: DispatchApprovalPolicy,
    user_questions: bool,
) -> Map<String, Value> {
    let mut metadata = approval_metadata(cli_policy(policy));
    metadata.insert(
        USER_INPUT_AVAILABLE_CONTEXT_KEY.to_string(),
        Value::Bool(user_questions),
    );
    metadata
}

#[cfg(test)]
mod tests {
    use super::*;
    use openbitfun_agent_runtime::sdk::AUTO_APPROVE_ASK_CONTEXT_KEY;

    #[test]
    fn dispatch_policy_uses_the_shared_invocation_metadata_contract() {
        let auto = metadata(DispatchApprovalPolicy::Auto);
        assert_eq!(
            auto.get(USER_INPUT_AVAILABLE_CONTEXT_KEY),
            Some(&Value::Bool(false))
        );
        assert_eq!(
            auto.get(AUTO_APPROVE_ASK_CONTEXT_KEY),
            Some(&Value::Bool(true))
        );

        let reject = metadata(DispatchApprovalPolicy::RejectAndReport);
        assert_eq!(
            reject.get(USER_INPUT_AVAILABLE_CONTEXT_KEY),
            Some(&Value::Bool(false))
        );
        assert_eq!(
            reject.get(AUTO_APPROVE_ASK_CONTEXT_KEY),
            Some(&Value::Bool(false))
        );
        assert_eq!(
            reject,
            approval_metadata(CliApprovalPolicy::Reject),
            "dispatch must not invent a second approval mechanism"
        );

        let remote = metadata(DispatchApprovalPolicy::Remote);
        assert_eq!(
            remote.get(USER_INPUT_AVAILABLE_CONTEXT_KEY),
            Some(&Value::Bool(false)),
            "remote permission supervision does not provide a user-question mailbox"
        );
        assert_eq!(
            remote.get(AUTO_APPROVE_ASK_CONTEXT_KEY),
            Some(&Value::Bool(false))
        );
    }

    #[test]
    fn the_question_mailbox_opt_in_makes_ask_user_question_available() {
        for policy in [
            DispatchApprovalPolicy::Auto,
            DispatchApprovalPolicy::RejectAndReport,
            DispatchApprovalPolicy::Remote,
        ] {
            let opted_in = metadata_for_job(policy, true);
            assert_eq!(
                opted_in.get(USER_INPUT_AVAILABLE_CONTEXT_KEY),
                Some(&Value::Bool(true))
            );
            // The approval half is unchanged by the opt-in.
            let mut without_gate = opted_in.clone();
            without_gate.remove(USER_INPUT_AVAILABLE_CONTEXT_KEY);
            let mut base = metadata(policy);
            base.remove(USER_INPUT_AVAILABLE_CONTEXT_KEY);
            assert_eq!(without_gate, base);
        }
    }
}

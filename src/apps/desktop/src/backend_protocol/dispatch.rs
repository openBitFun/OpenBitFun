//! Helpers used by the generated command dispatcher.

use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;

use crate::host::unsupported_in_native_host;

/// Reads one command argument the way Tauri does: by its (camelCase) key
/// from the argument object. A missing key deserializes from `null`, so
/// `Option` parameters are optional and required ones report the key.
pub(super) fn arg<T: DeserializeOwned>(
    args: &Value,
    key: &str,
    command: &str,
) -> Result<T, String> {
    let value = args.get(key).cloned().unwrap_or(Value::Null);
    let missing = value.is_null() && args.get(key).is_none();
    serde_json::from_value(value).map_err(|error| {
        if missing {
            format!("invalid args `{key}` for command `{command}`: command {command} missing required key {key}")
        } else {
            format!("invalid args `{key}` for command `{command}`: {error}")
        }
    })
}

/// The arm of a command the native host cannot run.
pub(super) fn unsupported(command: &str) -> Result<Value, String> {
    Err(unsupported_in_native_host(command))
}

fn error_text<E: Serialize>(error: E) -> String {
    match serde_json::to_value(&error) {
        Ok(Value::String(text)) => text,
        Ok(value) => value.to_string(),
        Err(serialize_error) => format!("failed to serialize command error: {serialize_error}"),
    }
}

fn ok_value<T: Serialize>(value: T) -> Result<Value, String> {
    serde_json::to_value(value)
        .map_err(|error| format!("failed to serialize command response: {error}"))
}

// Autoref specialization (the same technique `tauri::ipc` uses) lets the
// generated code finish any return type without naming it: a `Result`
// resolves to `ResultTag`, every other serializable value to `ValueTag`.

pub(super) struct ResultTag;

impl ResultTag {
    pub(super) fn finish<T: Serialize, E: Serialize>(
        self,
        result: Result<T, E>,
    ) -> Result<Value, String> {
        match result {
            Ok(value) => ok_value(value),
            Err(error) => Err(error_text(error)),
        }
    }
}

pub(super) trait ResultKind {
    fn dispatch_kind(&self) -> ResultTag {
        ResultTag
    }
}

impl<T, E> ResultKind for Result<T, E> {}

pub(super) struct ValueTag;

impl ValueTag {
    pub(super) fn finish<T: Serialize>(self, value: T) -> Result<Value, String> {
        ok_value(value)
    }
}

pub(super) trait ValueKind {
    fn dispatch_kind(&self) -> ValueTag {
        ValueTag
    }
}

impl<T: Serialize> ValueKind for &T {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finishes_results_values_and_structured_errors() {
        let ok: Result<u32, String> = Ok(3);
        assert_eq!((&ok).dispatch_kind().finish(ok), Ok(Value::from(3)));
        let err: Result<u32, String> = Err("boom".into());
        assert_eq!((&err).dispatch_kind().finish(err), Err("boom".to_string()));
        let structured: Result<(), serde_json::Value> = Err(serde_json::json!({"code": "x"}));
        assert_eq!(
            (&structured).dispatch_kind().finish(structured),
            Err("{\"code\":\"x\"}".to_string())
        );
        let plain = true;
        assert_eq!(
            (&plain).dispatch_kind().finish(plain),
            Ok(Value::Bool(true))
        );
        let unit = ();
        assert_eq!((&unit).dispatch_kind().finish(unit), Ok(Value::Null));
    }

    #[test]
    fn reads_optional_and_required_arguments() {
        let args = serde_json::json!({"request": {"a": 1}});
        let missing: Option<u32> = arg(&args, "other", "cmd").unwrap();
        assert_eq!(missing, None);
        let error = arg::<u32>(&args, "other", "cmd").unwrap_err();
        assert!(error.contains("missing required key other"), "{error}");
    }
}

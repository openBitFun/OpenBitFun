//! The desktop pet window: the native shell opens, closes and sizes it
//! (`desktopPresence.ts`); these commands ask it to over the shell channel
//! and fail loudly when no desktop shell offers the window.

use std::sync::Arc;

use serde::Deserialize;
use serde_json::{json, Value};

use super::{arg_or_default, shell, DispatchFuture};
use crate::host::NativeHost;

pub(in crate::backend_protocol) fn show_agent_companion_desktop_pet(
    host: &Arc<NativeHost>,
    args: Value,
) -> DispatchFuture<'_> {
    let _ = args;
    Box::pin(async move {
        shell(host, "pet.show", Value::Null).await?;
        Ok(Value::Null)
    })
}

pub(in crate::backend_protocol) fn hide_agent_companion_desktop_pet(
    host: &Arc<NativeHost>,
    args: Value,
) -> DispatchFuture<'_> {
    let _ = args;
    Box::pin(async move {
        shell(host, "pet.hide", Value::Null).await?;
        Ok(Value::Null)
    })
}

/// The pet window's content size, in points. 1.x sent `width` / `height` as
/// top-level arguments; a `request` object is read the same way.
#[derive(Debug, Default, Deserialize)]
struct PetSize {
    #[serde(default)]
    width: Option<f64>,
    #[serde(default)]
    height: Option<f64>,
}

fn pet_size(args: &Value) -> Result<(f64, f64), String> {
    let request: PetSize = arg_or_default(args, "request", "resize_agent_companion_desktop_pet")?;
    let read = |key: &str, nested: Option<f64>| {
        nested
            .or_else(|| args.get(key).and_then(Value::as_f64))
            .filter(|value| value.is_finite() && *value > 0.0)
    };
    match (read("width", request.width), read("height", request.height)) {
        (Some(width), Some(height)) => Ok((width, height)),
        _ => {
            Err("resize_agent_companion_desktop_pet needs a positive width and height".to_string())
        }
    }
}

pub(in crate::backend_protocol) fn resize_agent_companion_desktop_pet(
    host: &Arc<NativeHost>,
    args: Value,
) -> DispatchFuture<'_> {
    Box::pin(async move {
        let (width, height) = pet_size(&args)?;
        shell(
            host,
            "pet.resize",
            json!({ "width": width, "height": height }),
        )
        .await?;
        Ok(Value::Null)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resize_reads_the_legacy_top_level_size_and_a_request() {
        assert_eq!(
            pet_size(&json!({ "width": 120.0, "height": 140.0 })).unwrap(),
            (120.0, 140.0)
        );
        assert_eq!(
            pet_size(&json!({ "request": { "width": 96, "height": 104 } })).unwrap(),
            (96.0, 104.0)
        );
        assert!(pet_size(&json!({ "width": 0, "height": 10 })).is_err());
        assert!(pet_size(&json!({})).is_err());
    }
}

//! Browser-action adapter over an abstract WebView actuator.
//!
//! The native NSH desktop owns its web views in the UI process and can only
//! ask it to run a handful of primitives: load a URL, reload, evaluate a
//! script, give the page trusted input and close it. [`ActuatedWebviewAutomation`]
//! translates the same browser-engine primitives `openbitfun-core`'s
//! `BrowserActions` sends (a CDP-shaped envelope) onto those operations, so
//! snapshot refs, selector resolution, waits and click guards stay in core and
//! behave identically for every target kind.
//!
//! The host supplies a [`WebviewActuator`].

use std::future::Future;
use std::pin::Pin;
use std::sync::Mutex;
use std::time::Duration;

use serde_json::{json, Value};

/// A boxed future returned by [`WebviewActuator`] operations.
pub type ActuatorFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// How long a page script may run.
pub const ACTUATED_SCRIPT_TIMEOUT_MS: u64 = 30_000;

/// Time the page gets to handle a trusted click before the next primitive.
const TRUSTED_INPUT_SETTLE: Duration = Duration::from_millis(60);

/// Why a script did not produce a value.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ScriptFailure {
    /// The page's script threw, rejected or returned a non-JSON value.
    Script(String),
    /// The host could not run the script (no page, no shell, timeout).
    Host(String),
}

impl ScriptFailure {
    fn into_message(self) -> String {
        match self {
            Self::Script(message) | Self::Host(message) => message,
        }
    }
}

/// Input the page receives as the user's own (`isTrusted`).
#[derive(Debug, Clone, PartialEq)]
pub enum TrustedInput {
    /// A click at a viewport point in CSS pixels.
    Click { x: f64, y: f64 },
    /// One of the keys the host can press (`Enter`, `Tab`, `Escape`, `Backspace`).
    Key(String),
}

/// Keys a host's trusted input can press.
pub const TRUSTED_KEYS: [&str; 4] = ["Enter", "Tab", "Escape", "Backspace"];

/// The primitives a host offers for one web view.
pub trait WebviewActuator: Send + Sync {
    /// Loads `url` (already validated as http/https).
    fn navigate<'a>(&'a self, url: &'a str) -> ActuatorFuture<'a, Result<(), String>>;
    /// Reloads the page.
    fn reload(&self) -> ActuatorFuture<'_, Result<(), String>>;
    /// Runs `script` in the page; resolves with its completion value, or what
    /// a Promise it returns settles to, as JSON.
    fn evaluate<'a>(
        &'a self,
        script: &'a str,
        timeout_ms: u64,
    ) -> ActuatorFuture<'a, Result<Value, ScriptFailure>>;
    /// Gives the page trusted input. `Ok(false)` when the host cannot deliver
    /// trusted input to this page right now; the adapter then dispatches
    /// synthetic DOM events instead.
    fn trusted_input(&self, input: TrustedInput) -> ActuatorFuture<'_, Result<bool, String>>;
    /// Closes the page.
    fn close(&self) -> ActuatorFuture<'_, Result<(), String>>;
    /// A PNG of the visible page as base64, or an explicit reason it is not
    /// available on this host.
    fn capture_png(&self) -> ActuatorFuture<'_, Result<String, String>>;
}

/// Browser-engine primitives over a [`WebviewActuator`].
pub struct ActuatedWebviewAutomation<A: WebviewActuator> {
    actuator: A,
    target_id: String,
    pressed: Mutex<Option<(f64, f64)>>,
}

impl<A: WebviewActuator> ActuatedWebviewAutomation<A> {
    pub fn new(target_id: impl Into<String>, actuator: A) -> Self {
        Self {
            actuator,
            target_id: target_id.into(),
            pressed: Mutex::new(None),
        }
    }

    pub fn target_id(&self) -> &str {
        &self.target_id
    }

    pub fn actuator(&self) -> &A {
        &self.actuator
    }

    async fn run_script(&self, script: &str) -> Result<Value, String> {
        self.actuator
            .evaluate(script, ACTUATED_SCRIPT_TIMEOUT_MS)
            .await
            .map_err(ScriptFailure::into_message)
    }

    /// Runs a JavaScript expression with CDP `Runtime.evaluate` semantics
    /// (awaited, returned by value).
    async fn evaluate_expression(&self, expression: &str) -> Result<Value, ScriptFailure> {
        self.actuator
            .evaluate(&expression_script(expression), ACTUATED_SCRIPT_TIMEOUT_MS)
            .await
    }

    pub async fn execute(&self, method: &str, params: Option<Value>) -> Result<Value, String> {
        let params = params.unwrap_or_else(|| json!({}));
        match method {
            "Page.enable"
            | "Runtime.enable"
            | "Network.enable"
            | "DOM.enable"
            | "Page.setLifecycleEventsEnabled"
            | "Emulation.clearDeviceMetricsOverride"
            | "Page.bringToFront" => Ok(json!({})),
            "Page.navigate" => {
                let url = required_string(&params, "url", method)?;
                validate_navigation_url(url)?;
                self.actuator.navigate(url).await?;
                Ok(json!({ "frameId": self.target_id }))
            }
            "Page.reload" => {
                self.actuator.reload().await?;
                Ok(json!({}))
            }
            "Runtime.evaluate" => {
                let expression = required_string(&params, "expression", method)?;
                match self.evaluate_expression(expression).await {
                    Ok(value) => Ok(json!({
                        "result": { "type": javascript_type(&value), "value": value }
                    })),
                    Err(ScriptFailure::Script(error)) => Ok(json!({
                        "exceptionDetails": {
                            "text": error,
                            "exception": { "description": error },
                        }
                    })),
                    Err(ScriptFailure::Host(error)) => Err(error),
                }
            }
            "Input.dispatchMouseEvent" => self.dispatch_mouse_event(&params).await,
            // Text goes in through the DOM, at once: a host's trusted typing
            // is delivered key by key after the call returns, so a read that
            // follows could see half of it.
            "Input.insertText" => {
                let text = required_string(&params, "text", method)?;
                self.run_script(&insert_text_script(text)).await?;
                Ok(json!({}))
            }
            "Input.dispatchKeyEvent" => self.dispatch_key_event(&params).await,
            "Page.getLayoutMetrics" => {
                let value = self.run_script(LAYOUT_METRICS_SCRIPT).await?;
                let width = value.get("width").cloned().unwrap_or(json!(0));
                let height = value.get("height").cloned().unwrap_or(json!(0));
                Ok(json!({
                    "cssContentSize": { "x": 0, "y": 0, "width": width, "height": height },
                    "contentSize": { "x": 0, "y": 0, "width": width, "height": height },
                }))
            }
            "Page.captureScreenshot" => {
                let png = self.actuator.capture_png().await?;
                Ok(json!({ "data": png }))
            }
            "Page.close" => {
                self.actuator.close().await?;
                Ok(json!({}))
            }
            "Network.getCookies" | "Network.setCookie" => Err(format!(
                "{method} is not available for this host's embedded WebView: page scripts cannot read or write HttpOnly cookies"
            )),
            "Emulation.setDeviceMetricsOverride" => Err(
                "Full-page device-metrics override is not available for an embedded WebView"
                    .to_string(),
            ),
            method if method.starts_with("DOM.") => Err(format!(
                "{method} is a CDP-only extension and is not available for an embedded WebView"
            )),
            other => Err(format!(
                "Browser primitive {other} is not supported by the embedded WebView adapter"
            )),
        }
    }

    async fn click(&self, x: f64, y: f64) -> Result<(), String> {
        if self
            .actuator
            .trusted_input(TrustedInput::Click { x, y })
            .await?
        {
            // A trusted click's events can still be on their way.
            tokio::time::sleep(TRUSTED_INPUT_SETTLE).await;
            return Ok(());
        }
        self.run_script(&click_script(x, y)).await?;
        Ok(())
    }

    async fn dispatch_mouse_event(&self, params: &Value) -> Result<Value, String> {
        let event_type = required_string(params, "type", "Input.dispatchMouseEvent")?;
        let x = params.get("x").and_then(Value::as_f64).unwrap_or(0.0);
        let y = params.get("y").and_then(Value::as_f64).unwrap_or(0.0);
        if !x.is_finite() || !y.is_finite() {
            return Err("Input.dispatchMouseEvent needs finite coordinates".to_string());
        }
        match event_type {
            // A press is completed by its release: one click at the release point.
            "mousePressed" => {
                *self.pressed.lock().unwrap_or_else(|p| p.into_inner()) = Some((x, y));
            }
            "mouseReleased" => {
                self.pressed
                    .lock()
                    .unwrap_or_else(|p| p.into_inner())
                    .take();
                self.click(x, y).await?;
            }
            "mouseMoved" => {
                self.run_script(&hover_script(x, y)).await?;
            }
            "mouseWheel" => {
                let delta_x = params.get("deltaX").and_then(Value::as_f64).unwrap_or(0.0);
                let delta_y = params.get("deltaY").and_then(Value::as_f64).unwrap_or(0.0);
                self.run_script(&wheel_script(x, y, delta_x, delta_y))
                    .await?;
            }
            other => return Err(format!("Unsupported mouse event type: {other}")),
        }
        Ok(json!({}))
    }

    async fn dispatch_key_event(&self, params: &Value) -> Result<Value, String> {
        let event_type = required_string(params, "type", "Input.dispatchKeyEvent")?;
        let key = params.get("key").and_then(Value::as_str).unwrap_or("");
        let key = normalize_key(key);
        match event_type {
            "keyDown" | "rawKeyDown" => {
                if key.is_empty() {
                    return Err("Input.dispatchKeyEvent requires 'key'".to_string());
                }
                let trusted = TRUSTED_KEYS.contains(&key)
                    && self
                        .actuator
                        .trusted_input(TrustedInput::Key(key.to_string()))
                        .await?;
                if trusted {
                    tokio::time::sleep(TRUSTED_INPUT_SETTLE).await;
                } else {
                    self.run_script(&key_script(key)).await?;
                }
                Ok(json!({}))
            }
            // The press above already delivered the whole key stroke.
            "keyUp" | "char" => Ok(json!({})),
            other => Err(format!("Unsupported key event type: {other}")),
        }
    }
}

fn validate_navigation_url(url: &str) -> Result<(), String> {
    let scheme = url
        .split_once(':')
        .map(|(scheme, _)| scheme.to_ascii_lowercase())
        .ok_or_else(|| format!("Invalid navigation URL: {url}"))?;
    match scheme.as_str() {
        "http" | "https" => Ok(()),
        other => Err(format!("Unsupported navigation protocol: {other}")),
    }
}

fn required_string<'a>(params: &'a Value, key: &str, method: &str) -> Result<&'a str, String> {
    params
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("{method} requires '{key}'"))
}

fn javascript_type(value: &Value) -> &'static str {
    match value {
        Value::Null => "object",
        Value::Bool(_) => "boolean",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) | Value::Object(_) => "object",
    }
}

fn normalize_key(key: &str) -> &str {
    match key {
        "Return" => "Enter",
        "Esc" => "Escape",
        other => other,
    }
}

fn js_string(text: &str) -> String {
    serde_json::to_string(text).unwrap_or_else(|_| "\"\"".to_string())
}

/// CDP `Runtime.evaluate` with `awaitPromise` and `returnByValue`: the
/// expression's value, awaited, copied as JSON (`undefined` reads as `null`,
/// objects such as DOM nodes as their JSON form).
pub fn expression_script(expression: &str) -> String {
    format!(
        "(async () => {{ const value = await (0, eval)({}); const text = JSON.stringify(value); return text === undefined ? null : JSON.parse(text); }})()",
        js_string(expression)
    )
}

const LAYOUT_METRICS_SCRIPT: &str = "({ width: Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0), height: Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0) })";

fn click_script(x: f64, y: f64) -> String {
    format!(
        r#"(() => {{
  const x = {x}, y = {y};
  const target = document.elementFromPoint(x, y);
  if (!target) throw new Error('No element at viewport point ' + x + ',' + y);
  const base = {{ bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, view: window }};
  const pointer = (type, buttons) => typeof PointerEvent === 'function'
    ? target.dispatchEvent(new PointerEvent(type, {{ ...base, buttons, pointerId: 1, pointerType: 'mouse', isPrimary: true }}))
    : true;
  pointer('pointerdown', 1);
  target.dispatchEvent(new MouseEvent('mousedown', {{ ...base, buttons: 1 }}));
  if (typeof target.focus === 'function') target.focus({{ preventScroll: true }});
  pointer('pointerup', 0);
  target.dispatchEvent(new MouseEvent('mouseup', {{ ...base, buttons: 0 }}));
  if (typeof target.click === 'function') target.click();
  else target.dispatchEvent(new MouseEvent('click', {{ ...base, buttons: 0 }}));
  return true;
}})()"#
    )
}

fn hover_script(x: f64, y: f64) -> String {
    format!(
        r#"(() => {{
  const x = {x}, y = {y};
  const target = document.elementFromPoint(x, y);
  if (!target) return false;
  const base = {{ bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, view: window }};
  for (const type of ['pointerover', 'pointermove']) {{
    if (typeof PointerEvent === 'function') target.dispatchEvent(new PointerEvent(type, {{ ...base, pointerId: 1, pointerType: 'mouse' }}));
  }}
  for (const type of ['mouseover', 'mouseenter', 'mousemove']) target.dispatchEvent(new MouseEvent(type, base));
  return true;
}})()"#
    )
}

fn wheel_script(x: f64, y: f64, delta_x: f64, delta_y: f64) -> String {
    format!(
        r#"(() => {{
  const x = {x}, y = {y}, dx = {delta_x}, dy = {delta_y};
  let node = document.elementFromPoint(x, y);
  if (node) node.dispatchEvent(new WheelEvent('wheel', {{ bubbles: true, cancelable: true, clientX: x, clientY: y, deltaX: dx, deltaY: dy }}));
  while (node && node !== document.body && node !== document.documentElement) {{
    const style = getComputedStyle(node);
    const scrollsY = dy !== 0 && /(auto|scroll|overlay)/.test(style.overflowY) && node.scrollHeight > node.clientHeight;
    const scrollsX = dx !== 0 && /(auto|scroll|overlay)/.test(style.overflowX) && node.scrollWidth > node.clientWidth;
    if (scrollsY || scrollsX) {{ node.scrollBy(dx, dy); return true; }}
    node = node.parentElement;
  }}
  window.scrollBy(dx, dy);
  return true;
}})()"#
    )
}

fn insert_text_script(text: &str) -> String {
    format!(
        r#"(() => {{
  const text = {text};
  const target = document.activeElement;
  if (!target || target === document.body) throw new Error('No focused element');
  if (target.isContentEditable) {{
    document.execCommand('insertText', false, text);
    return true;
  }}
  if (typeof target.value === 'string') {{
    const start = typeof target.selectionStart === 'number' ? target.selectionStart : target.value.length;
    const end = typeof target.selectionEnd === 'number' ? target.selectionEnd : start;
    target.dispatchEvent(new InputEvent('beforeinput', {{ bubbles: true, cancelable: true, inputType: 'insertText', data: text }}));
    const proto = Object.getPrototypeOf(target);
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    const next = target.value.slice(0, start) + text + target.value.slice(end);
    if (setter) setter.call(target, next); else target.value = next;
    if (typeof target.setSelectionRange === 'function') {{
      try {{ target.setSelectionRange(start + text.length, start + text.length); }} catch (_) {{}}
    }}
    target.dispatchEvent(new InputEvent('input', {{ bubbles: true, inputType: 'insertText', data: text }}));
    target.dispatchEvent(new Event('change', {{ bubbles: true }}));
    return true;
  }}
  throw new Error('The focused element does not take text');
}})()"#,
        text = js_string(text)
    )
}

fn key_script(key: &str) -> String {
    format!(
        r#"(() => {{
  const key = {key};
  const target = document.activeElement || document.body;
  const init = {{ key, bubbles: true, cancelable: true, composed: true }};
  const proceed = target.dispatchEvent(new KeyboardEvent('keydown', init));
  if (proceed && key.length === 1) {{
    target.dispatchEvent(new KeyboardEvent('keypress', init));
    if (typeof target.value === 'string') {{
      const start = typeof target.selectionStart === 'number' ? target.selectionStart : target.value.length;
      const end = typeof target.selectionEnd === 'number' ? target.selectionEnd : start;
      target.value = target.value.slice(0, start) + key + target.value.slice(end);
      target.dispatchEvent(new InputEvent('input', {{ bubbles: true, inputType: 'insertText', data: key }}));
    }}
  }}
  if (proceed && key === 'Enter' && target.form && typeof target.form.requestSubmit === 'function' && target.tagName === 'INPUT') {{
    target.form.requestSubmit();
  }}
  target.dispatchEvent(new KeyboardEvent('keyup', init));
  return true;
}})()"#,
        key = js_string(key)
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    fn block_on<F: Future>(future: F) -> F::Output {
        tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .expect("test runtime")
            .block_on(future)
    }

    #[derive(Default)]
    struct Recorded {
        calls: Mutex<Vec<String>>,
        trusted: bool,
        script_error: Option<ScriptFailure>,
    }

    #[derive(Clone, Default)]
    struct FakeActuator(Arc<Recorded>);

    impl FakeActuator {
        fn with(trusted: bool, script_error: Option<ScriptFailure>) -> Self {
            Self(Arc::new(Recorded {
                calls: Mutex::new(Vec::new()),
                trusted,
                script_error,
            }))
        }
        fn record(&self, call: String) {
            self.0.calls.lock().unwrap().push(call);
        }
        fn calls(&self) -> Vec<String> {
            self.0.calls.lock().unwrap().clone()
        }
    }

    impl WebviewActuator for FakeActuator {
        fn navigate<'a>(&'a self, url: &'a str) -> ActuatorFuture<'a, Result<(), String>> {
            Box::pin(async move {
                self.record(format!("navigate {url}"));
                Ok(())
            })
        }
        fn reload(&self) -> ActuatorFuture<'_, Result<(), String>> {
            Box::pin(async move {
                self.record("reload".into());
                Ok(())
            })
        }
        fn evaluate<'a>(
            &'a self,
            script: &'a str,
            _timeout_ms: u64,
        ) -> ActuatorFuture<'a, Result<Value, ScriptFailure>> {
            Box::pin(async move {
                self.record(format!("evaluate {script}"));
                match &self.0.script_error {
                    Some(error) => Err(error.clone()),
                    None => Ok(json!("Example Domain")),
                }
            })
        }
        fn trusted_input(&self, input: TrustedInput) -> ActuatorFuture<'_, Result<bool, String>> {
            Box::pin(async move {
                self.record(format!("input {input:?}"));
                Ok(self.0.trusted)
            })
        }
        fn close(&self) -> ActuatorFuture<'_, Result<(), String>> {
            Box::pin(async move {
                self.record("close".into());
                Ok(())
            })
        }
        fn capture_png(&self) -> ActuatorFuture<'_, Result<String, String>> {
            Box::pin(async move { Err("no snapshot here".to_string()) })
        }
    }

    #[test]
    fn evaluate_returns_cdp_shaped_values_and_exceptions() {
        block_on(async {
            let fake = FakeActuator::with(false, None);
            let automation =
                ActuatedWebviewAutomation::new("embedded-browser-view-1", fake.clone());
            let result = automation
                .execute(
                    "Runtime.evaluate",
                    Some(json!({ "expression": "document.title" })),
                )
                .await
                .unwrap();
            assert_eq!(
                result,
                json!({ "result": { "type": "string", "value": "Example Domain" } })
            );
            assert!(fake.calls()[0].contains("(0, eval)(\"document.title\")"));

            let failing = ActuatedWebviewAutomation::new(
                "embedded-browser-view-1",
                FakeActuator::with(false, Some(ScriptFailure::Script("boom".into()))),
            );
            let result = failing
                .execute("Runtime.evaluate", Some(json!({ "expression": "x" })))
                .await
                .unwrap();
            assert_eq!(result["exceptionDetails"]["text"], "boom");

            let host_down = ActuatedWebviewAutomation::new(
                "embedded-browser-view-1",
                FakeActuator::with(false, Some(ScriptFailure::Host("no shell".into()))),
            );
            assert_eq!(
                host_down
                    .execute("Runtime.evaluate", Some(json!({ "expression": "x" })))
                    .await
                    .unwrap_err(),
                "no shell"
            );
        });
    }

    #[test]
    fn a_press_and_release_is_one_click_trusted_when_the_host_can() {
        block_on(async {
            let fake = FakeActuator::with(true, None);
            let automation =
                ActuatedWebviewAutomation::new("embedded-browser-view-1", fake.clone());
            for kind in ["mousePressed", "mouseReleased"] {
                automation
                    .execute(
                        "Input.dispatchMouseEvent",
                        Some(json!({ "type": kind, "x": 10.4, "y": 20 })),
                    )
                    .await
                    .unwrap();
            }
            assert_eq!(fake.calls(), vec!["input Click { x: 10.4, y: 20.0 }"]);

            let untrusted = FakeActuator::with(false, None);
            let automation =
                ActuatedWebviewAutomation::new("embedded-browser-view-1", untrusted.clone());
            for kind in ["mousePressed", "mouseReleased"] {
                automation
                    .execute(
                        "Input.dispatchMouseEvent",
                        Some(json!({ "type": kind, "x": 3, "y": 4 })),
                    )
                    .await
                    .unwrap();
            }
            let calls = untrusted.calls();
            assert_eq!(calls.len(), 2);
            assert!(calls[1].contains("elementFromPoint(x, y)"));
            assert!(calls[1].contains("const x = 3, y = 4"));
        });
    }

    #[test]
    fn keys_and_text_prefer_trusted_input_and_fall_back_to_dom_events() {
        block_on(async {
            let untrusted = FakeActuator::with(false, None);
            let automation =
                ActuatedWebviewAutomation::new("embedded-browser-view-1", untrusted.clone());
            automation
                .execute("Input.insertText", Some(json!({ "text": "hi\"" })))
                .await
                .unwrap();
            automation
                .execute(
                    "Input.dispatchKeyEvent",
                    Some(json!({ "type": "keyDown", "key": "Return" })),
                )
                .await
                .unwrap();
            automation
                .execute(
                    "Input.dispatchKeyEvent",
                    Some(json!({ "type": "keyUp", "key": "Return" })),
                )
                .await
                .unwrap();
            let calls = untrusted.calls();
            // Text always goes through the DOM, without asking for trusted typing.
            assert!(calls[0].contains("const text = \"hi\\\"\""));
            assert_eq!(calls[1], "input Key(\"Enter\")");
            assert!(calls[2].contains("const key = \"Enter\""));
            assert_eq!(calls.len(), 3);

            let trusted = FakeActuator::with(true, None);
            let automation =
                ActuatedWebviewAutomation::new("embedded-browser-view-1", trusted.clone());
            automation
                .execute(
                    "Input.dispatchKeyEvent",
                    Some(json!({ "type": "keyDown", "key": "a" })),
                )
                .await
                .unwrap();
            // `a` is not a key the host presses: a DOM key event, no trusted call.
            assert_eq!(trusted.calls().len(), 1);
            assert!(trusted.calls()[0].starts_with("evaluate"));
        });
    }

    #[test]
    fn navigation_is_checked_and_unsupported_primitives_say_so() {
        block_on(async {
            let fake = FakeActuator::with(false, None);
            let automation =
                ActuatedWebviewAutomation::new("embedded-browser-view-1", fake.clone());
            assert_eq!(
                automation
                    .execute(
                        "Page.navigate",
                        Some(json!({ "url": "https://example.com/" }))
                    )
                    .await
                    .unwrap(),
                json!({ "frameId": "embedded-browser-view-1" })
            );
            assert!(automation
                .execute(
                    "Page.navigate",
                    Some(json!({ "url": "file:///etc/passwd" }))
                )
                .await
                .unwrap_err()
                .contains("Unsupported navigation protocol"));
            assert_eq!(fake.calls(), vec!["navigate https://example.com/"]);
            assert_eq!(
                automation
                    .execute("Page.captureScreenshot", None)
                    .await
                    .unwrap_err(),
                "no snapshot here"
            );
            assert!(automation
                .execute("Network.getCookies", None)
                .await
                .unwrap_err()
                .contains("HttpOnly"));
            assert!(automation
                .execute("DOM.getDocument", None)
                .await
                .unwrap_err()
                .contains("CDP-only"));
        });
    }

    #[test]
    fn expression_scripts_keep_the_expression_as_data() {
        let script = expression_script("1 + '\"'</script>");
        assert!(script.starts_with("(async () =>"));
        assert!(script.contains(r#"(0, eval)("1 + '\"'</script>")"#));
    }
}

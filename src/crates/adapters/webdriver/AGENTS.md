# webdriver Agent Guide

Scope: this guide applies to `src/crates/adapters/webdriver`.

`openbitfun-webdriver` is the browser-engine adapter of the desktop backend.
Its only module, `actuated`, translates the CDP-shaped primitives that
`openbitfun-core`'s `BrowserActions` sends onto a host-supplied
`WebviewActuator` (the native NSH shell's web views, wired up in
`src/apps/desktop/src/native_browser.rs`). The embedded WebDriver server that
drove the retired Tauri WebView used to live here and was removed with the
Tauri desktop shell.

## Guardrails

- Keep the crate host-neutral: no UI toolkit, window or WebView dependency.
  The host owns the actuator; this crate owns only the translation.
- Snapshot refs, selector resolution, waits and click guards stay in core and
  must behave identically for every target kind.
- Product policy, session lifecycle, tool exposure, and agent decisions do not
  belong here.

## Verification

```bash
cargo test -p openbitfun-webdriver
cargo test -p openbitfun-desktop --lib native_browser
```

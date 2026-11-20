[中文](AGENTS-CN.md) | **English**

# AGENTS.md

## Scope

This file applies to `tests/e2e`. Use the top-level `AGENTS.md` for repository-wide rules.

## What matters here

End-to-end coverage of the native NSH desktop app has two layers:

- **UI layer**: the headless NSH suite in `src/nsh-ui` (`nsh test .`). It renders the
  real TSX app against a simulated host; it owns UI behavior. Its rules live in
  [`src/nsh-ui/AGENTS.md`](../../src/nsh-ui/AGENTS.md).
- **Native smoke** (`native/smoke.mjs`): launches the real runner
  (`openbitfun-nsh` + `libopenbitfun_desktop_lib`) in an isolated temporary profile,
  drives the backend over the loopback OBP owner connection
  (`ws://127.0.0.1:<port>/obp`, `Authorization: Bearer <owner token>`, JSON-RPC 2.0
  `hello` then `call`), checks a `host://shell-request` round trip through the NSH
  shell, then quits through `quit_app` and expects exit code 0.

The WebDriverIO suite that drove the Tauri WebView was retired with the Tauri host.

Rules:

1. Plain Node >= 22, no npm dependencies; this directory is not a pnpm workspace member.
2. Never touch the real profile: keep `OPENBITFUN_E2E_STORAGE_GUARD=1`,
   `OPENBITFUN_E2E_USER_ROOT`, `OPENBITFUN_E2E_HOME`, `OPENBITFUN_E2E_LOG_DIR`, an
   isolated `HOME` (NSH UI storage) and a free `OPENBITFUN_OBP_PORT`; assert that the
   owner token and `hello.backend.dataDir` lie inside the temporary root.
3. Child processes set `windowsHide: true`; on failure kill the app and print the log tails.
4. Pick commands from `src/apps/desktop/src/backend_protocol/dispatch_generated.rs` and
   confirm request shapes in the handlers; assert result shapes, not just success.

## Commands

```bash
pnpm run desktop-nsh:build            # debug runner + backend + NSH bundle
pnpm run e2e:smoke                    # release-fast build (default)
pnpm run e2e:smoke:debug              # target/debug build
pnpm run e2e:smoke:packaged           # target/desktop-nsh/OpenBitFun.app (macOS) or the packaged folder
node tests/e2e/native/smoke.mjs --help
pnpm run e2e:ui                       # cd src/nsh-ui && nsh test . (nsh on PATH: $HOME/.nsh/bin)
```

## Verification

Run the smoke test against the build you changed. Runner, backend library and NSH
bundle must come from the same revision: an older piece fails loudly with
`unsupported_in_native_host`.

CI: `Native Desktop UI` in `ci.yml` runs `nsh check` and `nsh test .`; the macOS
package jobs of `desktop-package.yml` and `nightly-artifacts.yml` run the smoke test
against the release-layout `OpenBitFun.app` (`--app`).

The smoke test is local-only. It does not cover remote workspaces, remote control
(mobile web, IM bots), Peer Device Mode, Detached Dispatch, the LAN or mesh
listeners, or live model providers.

[中文](AGENTS-CN.md) | **English**

# AGENTS.md

## Scope

This file applies to `src/apps/desktop`. Use the top-level `AGENTS.md` for repository-wide rules.

## What matters here

`src/apps/desktop` is the desktop backend library (`openbitfun_desktop_lib`). The
native NSH desktop app (`src/apps/desktop-nsh`) loads it in-process through the C
ABI in `src/backend_protocol/ffi.rs`; browsers, phones and other account devices
reach the same `BackendService` over OBP (`src/backend_protocol/ws`, `src/mesh`).
There is no Tauri runtime, window or WebView here: the Tauri desktop shell was
retired (`docs/architecture/unified-client-architecture.md`). The crate builds a
`cdylib` + `rlib` only; the runner executable lives in `src/apps/desktop-nsh/native`.

Main areas:

- `src/api/`: backend commands (`// @backend-command` handlers)
- `src/backend_protocol/`: the protocol service, the generated dispatcher
  (`dispatch_generated.rs`), host adapters (`native_commands/`), OBP listeners
- `src/host/`: the host shim (`State`, `HostHandle`, `NativeHost`) and the shell
  channel to the UI process (`host/shell.rs`)
- `src/native_host.rs`: backend bootstrap and graceful shutdown
- `src/native_browser.rs`: the agent-facing embedded browser over the shell's web views
- `src/miniapp_desktop/`, `src/miniapp_web_host.rs`: MiniApp windows (the
  `openbitfun-miniapp-shell` sidecar) and agent MiniApp automation
- `src/api/peer_host_invoke.rs`: legacy relay HostInvoke host for older peers;
  allow/deny and capabilities come from the Product Operation Registry
  (`openbitfun_product_domains::remote_surface`), not from a local table
- `src/api/remote_workspace_policy.rs`: closure test proving every registered
  command has one registry row
- `src/update_maintenance/`: macOS bundle replacement for verified native updates
- `src/computer_use/`: OS-specific automation support

Peer Device Mode ownership and boundaries:
`docs/architecture/peer-device-mode.md`.

OpenBitFun account identity (GitHub or email-code sign-in) is shared through `account_identity_api.rs`. Relay device
registration and lifecycle live in `src/api/remote_connect_api.rs`; settings
remain on their owning device and there is no cloud/local sync choice.

The Relay deployment wizard is retired. Preserve the developer scripts under
`src/apps/relay-server` and their [operator guide](../relay-server/README.md).

If a change affects behavior shared by multiple runtimes, place stable contracts,
execution policy, and services in their owning lower-layer crates. Keep only
product wiring and compatibility bridges in `src/crates/assembly/core`.

## Local rules

- Keep desktop-only integrations here; do not move them into shared core.
- Window lifecycle behavior, including close/minimize-to-tray defaults, is a
  desktop surface concern owned by the NSH shell. Preserve saved user preferences
  when changing it.
- Commands and their helpers take `crate::host::State` and `crate::host::HostHandle`.
  Register a command in `backend_commands!` (`src/lib.rs`), mark its handler with a
  `// @backend-command` line right before the `fn`, keep the `{ request }` /
  camelCase argument shape older clients send, run
  `pnpm run desktop-nsh:generate-dispatch`, and add its Product Operation Registry
  row (`src/crates/contracts/product-domains/src/remote_surface/table.rs`, then
  `pnpm run capabilities:generate`). The generator rejects Tauri parameter types.
- A command that works on the host or its UI shell rather than typed arguments is
  a host adapter in `src/backend_protocol/native_commands/`
  (`fn <command>(host: &Arc<NativeHost>, args: Value) -> DispatchFuture<'_>`),
  registered as `backend_protocol::native_commands::<command>`. Window, tray,
  notification, clipboard, login-item and lifecycle work goes through the shell
  channel (`host://shell-request`, answered with `host_shell_respond`), which
  refuses loudly when no shell offers the operation.
- Removing a command: delete it from `backend_commands!`, replace its registry row
  with `retired(...)` and a reason. The dispatcher then answers older clients with
  `unsupported_in_native_host: <command> (retired: <reason>)`.
- The native updater reads the manifest's `<os>-<arch>-nsh` entry and keeps its
  own `app-updates-nsh` cache. Release manifests also point the legacy
  `darwin-<arch>` key at the same native archive, so installed Tauri builds update
  into the native app; the bundle keeps a `Contents/MacOS/openbitfun-desktop` link
  to the runner for them (`scripts/package-desktop-nsh-macos.mjs`).
  Focused check: `cargo test -p openbitfun-desktop --lib -- host::shell backend_protocol::native_commands`.

## Commands

```bash
pnpm run desktop:dev              # build (profile desktop-dev) and run the native app (scripts/desktop-nsh-dev.mjs)
pnpm run desktop:preview:debug    # run the last development build without rebuilding
pnpm run desktop-nsh:build        # UI bundle + backend library + runner
pnpm run desktop-nsh:package:mac  # target/desktop-nsh/OpenBitFun.app (also :windows, :linux)
pnpm run prepare:dsh-profile      # optional: local DeepSeek Harness sessions
```

`desktop:dev --isolated-data` keeps settings, workspaces and sessions in the
checkout's `.openbitfun/desktop-dev/` (`OPENBITFUN_USER_ROOT`/`OPENBITFUN_HOME`);
the default uses the installed app's data. The NSH crates require Rust 1.97 or newer.

Data Tools runs independently. Desktop development launchers do not build,
launch, or supervise the tool; use its own development and release entry
points under `src/apps/data-tools`.

`release-fast` profile (`Cargo.toml`): inherits `release` but disables LTO, increases `codegen-units` to 16, enables incremental compilation. Significantly faster at the cost of binary size and marginal runtime performance.

## Verification

```bash
cargo check -p openbitfun-desktop
cargo test -p openbitfun-desktop --lib
pnpm run desktop-nsh:check-dispatch
node --test scripts/generate-desktop-native-dispatch.test.mjs
```

The packaged native app smoke test (launch on an isolated profile, drive it over
the loopback OBP owner connection, quit) is `pnpm run e2e:smoke`; see
`tests/e2e/AGENTS.md`. The UI suite is `pnpm run e2e:ui`.

For application icon resources and packaging, run `pnpm run generate-brand-assets`
and `node --test scripts/generate-brand-assets.test.mjs scripts/macos-icon-bundle.test.mjs`.
The [brand guide](../../../assets/brand/README.md#macos-icons) owns native exports.

For macOS microphone signing metadata, run
`plutil -lint src/apps/desktop/Entitlements.plist` (the bundle `Info.plist` is written by `scripts/package-desktop-nsh-macos.mjs`)
and `node --test scripts/ci/verify-macos-microphone.test.mjs` on macOS. Before
distributing, run `bash scripts/ci/verify-macos-microphone.sh <signed-app-bundle>`,
then verify microphone consent and recording in the signed app on macOS.

For ACP cancellation request compatibility, run
`cargo test --locked -p openbitfun-desktop --no-default-features --lib acp_cancel_request`.
It covers legacy payload deserialization/round trips and the optional Turn binding.
Native ACP queue recovery uses the focused runner in `tests/e2e/AGENTS.md`.

Token-usage bootstrap must construct and register the host's service before
`RoundExecutor::new`; that constructor captures the service for direct attempt
records. The subscriber and AppState must reuse the same authority. An unknown
usage failure/cancellation emits no TokenUsageUpdated event, so subscribing to
events alone cannot record it. For this wiring, run the Desktop check above and
the [Core factory-backed acceptance paths](../../crates/assembly/core/src/agentic/execution/AGENTS.md),
whose process fixture uses the production round constructor and host service
registration rather than assigning the executor's private usage field.

Guarded E2E startup (`OPENBITFUN_E2E_STORAGE_GUARD=1` with
`OPENBITFUN_E2E_USER_ROOT` and `OPENBITFUN_E2E_HOME`) also isolates
subscription metadata and secrets under the guarded PathManager user-data root,
using the existing encrypted fixture vault instead of any native credential store.
Debug-only subscription mock TLS may add the CA from
`OPENBITFUN_E2E_SUBSCRIPTION_CA_FILE` under that same guard; it does not turn off
certificate verification.

For session storage directory access, run
`cargo test -p openbitfun-desktop --lib api::session_storage_directory::tests`
for session storage directory resolution (these tests do not launch a file manager),
and `cargo test -p openbitfun-desktop --lib remote_workspace_policy` after registration changes.

For whole-session copy routing, run
`cargo test --locked -p openbitfun-desktop --lib whole_session_copy_uses_the_latest_persisted_turn_fork`.
After command registration changes, also run the `remote_workspace_policy` filter.

For optional workspace catalog query payload compatibility, run
`cargo test --locked -p openbitfun-desktop --lib api::session_api::catalog_request_tests`.

For MCP ProductControl provider wiring, run
`cargo test --locked -p openbitfun-desktop --lib openbitfun_control_host::tests`.
The shared MCP behavior fixtures are documented in the Core guide.

For model selector request compatibility and configuration effect routing:

```bash
cargo test --locked -p openbitfun-desktop --lib update_session_model_distinguishes_omitted_null_and_explicit_reasoning_presets
cargo test --locked -p openbitfun-desktop --lib model_routing_status_preserves_legacy_requests_and_internal_session_opt_in
cargo test --locked -p openbitfun-desktop --lib session_permission_read
cargo test --locked -p openbitfun-desktop --lib backend_effect_routing_is_owned_by_the_control_transaction
```

Use the Core guide's session-model tests for cold persistence, no-op writes,
rollback, and ownership; the Desktop adapter must not restore history for a
model selection alone. Permission reads use the same header path, preserve a
missing override as `null`, and obtain active-Turn facts only from the live runtime.
Legacy scope-less reads require a loaded session; an unknown override must fail
instead of pretending to inherit the default.

For MiniApp Agent session and context changes, run
`cargo test --locked -p openbitfun-desktop --lib api::miniapp_agent_api::tests`.
This covers legacy payloads, exact context paths, trust instructions, and snapshot cleanup.

For official Relay routing, scoped teardown and the retired LAN Relay refusal, run
`cargo test --locked -p openbitfun-desktop --lib api::remote_connect_api`
and `cargo test --locked -p openbitfun-desktop --lib api::peer_host_invoke::tests`.
The Relay route tests run actual sockets and encrypted RPC against a loopback
Relay fixture in a child process with temporary product storage; they do not
exercise SSH workspaces or the production Relay. The desktop no longer hosts an
embedded LAN Relay: `lan` start/stop requests answer
`unsupported: the LAN relay was retired; ...`, and same-network devices connect
through the account device mesh. UI coverage lives in `src/nsh-ui` (`DevicesScene`, `phoneStore`).

For shared GitHub sign-in and token redaction, use
`cargo test -p openbitfun-desktop --lib api::account_identity_api::tests`.

For Pages Agent startup registration and Desktop-owned account execution, run
`cargo test --locked -p openbitfun-desktop --lib api::remote_connect_api::page_tool_tests`.
This child-process fixture invokes the actual registered tool against a loopback
Relay and covers account-switch fencing; it does not launch the native UI or
exercise a live remote device.

For side-question request compatibility, initial model selection, and optional
message metadata, use
`cargo test -p openbitfun-desktop --no-default-features --lib api::btw_api::tests`.

For snapshot workspace identity and remote rollback admission, use
`cargo test --locked -p openbitfun-desktop --lib api::snapshot_service::tests`.

For skill discovery response compatibility and timeouts, use
`cargo test -p openbitfun-desktop --lib api::skill_api::tests`.
For companion pet manifest versions and package metadata, use
`cargo test -p openbitfun-desktop --lib api::commands::pet_package_tests`.
For content-search routing and remote fallback protection, use
`cargo test --locked -p openbitfun-desktop --lib api::search_api::tests`.

For staged application-update cache and signature behavior, use
`cargo test -p openbitfun-desktop --lib api::update_api::tests`.
For peer system-info response compatibility, run
`cargo test -p openbitfun-desktop --lib system_info_home_contract`.
For embedded browser target correlation and navigation outcomes, run
`cargo test -p openbitfun-desktop --lib api::browser_api::tests native_browser`.
After browser or updater command registration changes, also run
`cargo test -p openbitfun-desktop --lib remote_workspace_policy`.

For the real macOS ComputerUse tool observation/input roundtrip, run
`node scripts/test-macos-control-roundtrip.mjs`. This launches a disposable
AppKit target and the `computer_use_native_roundtrip` test with `devtools`.
The harness has its own main-thread CFRunLoop and exercises the production
main-queue dispatcher; do not run this test through libtest or bypass that
dispatcher. It requires local Accessibility and Screen Recording permission.
To reuse the compiled harness, set `OPENBITFUN_TEST_BINARY` to its absolute path.

For the additive saved-model quota request and legacy account-request round trip:
`cargo test --locked -p openbitfun-desktop --lib quota_request_compatibility_tests`.
The host resolves the saved model, rejects non-API authentication and custom auth,
and rechecks its authorization binding before publishing the result. Model-scoped
requests require the separately advertised `subscription_model_quota_v1` capability;
legacy requests retain the exact account-slot path. These tests do not contact billing.

For workspace HTML gateway authentication, chunking, cancellation, site-root
entry URLs, document-route fallback, owner-error preservation, peer capability
negotiation and encrypted loopback Relay transfer, run:

```bash
cargo test --locked -p openbitfun-desktop --lib html_preview
```

For encrypted peer resource-load timings, run the same command with
`--lib html_preview_encrypted_peer_loading_benchmark -- --ignored --nocapture`.
The isolated Relay fixture adds 40 ms per resource RPC and compares the previous
serial reader with cold and warm HTTP gateway loads of the same HTML/assets.
It reports three samples and verifies payload bytes; it does not time native
rendering or use a physical remote host. Cache and prefetch limits belong to
`services-integrations::remote_connect::html_preview::transfer`; the Desktop
adapter owns HTTP authentication, explicit-refresh headers and peer RPC wiring.

For the LaTeX workspace compiler, run:

```bash
cargo test --locked -p openbitfun-desktop --no-default-features --lib latex_api::tests
```

Use `-- --include-ignored` with `latexmk`, pdfLaTeX, and XeLaTeX on PATH to
exercise a multi-file paper build, error diagnostics, and temporary output.
The POSIX build test checks the remote command in a local shell. Verify live
SSH, container, and peer routing separately.

For additive on-demand context-estimate requests and legacy payload defaults:
`cargo test --locked -p openbitfun-desktop --no-default-features --lib context_estimate_request_tests`.
This verifies the Desktop boundary, not a live Peer or remote workspace.

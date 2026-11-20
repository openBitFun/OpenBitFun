**English** | [中文](E2E-TESTING-GUIDE.zh-CN.md)

# E2E Testing Guide

How the native smoke test is built and how to extend it. Commands and coverage are in
[README.md](README.md).

## Process and profile

`native/smoke.mjs` spawns the runner with `windowsHide: true`, `cwd` in the temporary
root and this environment:

| Variable | Value | Effect |
|---|---|---|
| `OPENBITFUN_E2E_STORAGE_GUARD` | `1` | PathManager refuses to start without isolated roots |
| `OPENBITFUN_E2E_USER_ROOT` | `<tmp>/user` | config, data (`data/obp/owner-token`), sessions |
| `OPENBITFUN_E2E_HOME` | `<tmp>/home` | product home (assistant workspaces, project runtime) |
| `OPENBITFUN_E2E_LOG_DIR` | `<tmp>/logs` | `<timestamp>/app.log` |
| `OPENBITFUN_OBP_PORT` | free loopback port | never collides with a running app on 47610 |
| `HOME`, `XDG_*` (`USERPROFILE`, `APPDATA`, `LOCALAPPDATA` on Windows) | `<tmp>/os-home` | NSH UI storage and other OS-home paths |
| `NSH_APP_DIR` | NSH bundle (profile builds only) | packaged apps use their own `Resources/nsh` |

`OPENBITFUN_USER_ROOT`, `OPENBITFUN_HOME`, `OPENBITFUN_LOG_DIR`,
`OPENBITFUN_OBP_LISTENER` and `OPENBITFUN_WEBDRIVER_PORT` are removed from the
inherited environment. If the requested port is taken, the listener falls back to an
ephemeral port; the test reads the actual port from the
`OBP loopback listener started` log line.

## Protocol client

The loopback listener accepts the owner token as `Authorization: Bearer <token>` (or a
session cookie). Node's global `WebSocket` cannot set that header, so the test carries
a minimal RFC 6455 client (HTTP upgrade, masked text frames, ping/pong, close) with no
dependency.

Session flow:

1. `hello {protocol: 1, client: 'e2e-smoke', ack: true}`. With `ack: true` the backend
   applies credit flow control, so the client answers every `event` frame with
   `{method: 'ack', params: {seq}}`.
2. `call {command, args}` for each step. Arguments use the Tauri shape: commands with a
   structured request take `{request: {...}}`.
3. `quit_app`: the reply may race the process exit; a closed connection counts as
   delivered, and the process must then exit with code 0 within 30 s.

## Adding a step

1. Pick the command in `src/apps/desktop/src/backend_protocol/dispatch_generated.rs`.
   `Native` commands run in the backend; `Adapter` commands go through
   `backend_protocol/native_commands` (often a `host://shell-request` to the NSH shell);
   `Unsupported` commands fail by design.
2. Read the handler for the request struct and response type; assert the response
   shape and any value the test controls.
3. Keep side effects inside the temporary profile (use `dirs.workspace` for
   workspace paths). Do not call commands that reach the network, real accounts or
   other devices.
4. Shell adapters need the UI to have attached the shell (`host_shell_attach`); place
   them after the `initialize_tray_after_startup` step, which waits for that.

## Troubleshooting

- `Runner not found` / `Backend library not found` / `NSH UI bundle not found`: build
  with the printed command.
- `unsupported_in_native_host: ...`: runner, backend library and NSH bundle come from
  different revisions; rebuild the stale one.
- `no owner token`: the backend did not start; read the printed `app.log` tail, or rerun
  with `--keep-profile` and inspect `<tmp>/logs`.
- `HTTP 401`: the token does not belong to this listener (another process wrote it).

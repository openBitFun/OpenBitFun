**English** | [中文](README.zh-CN.md)

# OpenBitFun E2E Tests

End-to-end checks for the native NSH desktop app.

| Layer | Where | Runs |
|---|---|---|
| UI | `src/nsh-ui/test` | `pnpm run e2e:ui` (`cd src/nsh-ui && nsh test .`) |
| Native smoke | `tests/e2e/native/smoke.mjs` | `pnpm run e2e:smoke` |

The UI layer renders the real app headlessly against a simulated host. The native
smoke test runs the real runner and backend library and talks to the backend the way
a browser or phone client does, over the loopback OBP owner connection.

## Prerequisites

- Node >= 22. No `pnpm install` is needed for this directory.
- A native build:
  - profile build: `pnpm run desktop-nsh:build` (debug), or the runner and backend
    library built with `--profile release-fast`, plus an NSH bundle in
    `target/desktop-nsh/nsh` (`pnpm run desktop-nsh:bundle`) or `nsh-release`;
  - packaged build: `pnpm run desktop-nsh:package:mac` (or `:windows` / `:linux`).
- For `e2e:ui`: the `nsh` CLI on `PATH` (`export PATH="$HOME/.nsh/bin:$PATH"`).

## Running

```bash
pnpm run e2e:smoke                    # target/release-fast/openbitfun-nsh
pnpm run e2e:smoke:debug              # target/debug/openbitfun-nsh
pnpm run e2e:smoke:packaged           # target/desktop-nsh/OpenBitFun.app
node tests/e2e/native/smoke.mjs --app /path/to/OpenBitFun.app --keep-profile
pnpm run e2e:ui
```

Options: `--profile <debug|release-fast|release>`, `--packaged`, `--app <path>`,
`--nsh-app-dir <dir>`, `--keep-profile`, `--timeout <ms>` (see `--help`). A missing
build fails with the command that builds it.

## What the smoke test checks

1. The app starts in a fresh temporary profile (`OPENBITFUN_E2E_STORAGE_GUARD=1`, E2E
   user root, product home, log dir, isolated `HOME`, free `OPENBITFUN_OBP_PORT`).
2. The owner token appears at `<tmp>/user/data/obp/owner-token`.
3. `hello` returns protocol 1, scope `owner`, the backend version and a data dir inside
   the temporary profile.
4. `get_app_version`, `get_system_info`, `get_config`, `open_workspace`,
   `get_opened_workspaces`, `get_recent_workspaces` and `list_sessions` return the
   expected shapes.
   Packaged runs (`--packaged`, `--app`) also make the workspace a one-commit Git
   worktree, enable workspace search, and require `search_file_contents` to be served
   by the bundled Flashgrep daemon, first unindexed and then from its index after
   `search_build_index` (a package without `flashgrep/` fails here).
5. `initialize_tray_after_startup` and `set_tray_unread_count` resolve through the NSH
   shell (`host://shell-request` and back).
6. `quit_app` ends the process with exit code 0 and removes the owner token.

On failure the app is killed, the tails of `app.log` and the runner output are printed
and the exit code is non-zero. The temporary profile is removed unless
`--keep-profile` is given.

## Coverage limits

Local only. Remote workspaces, remote control (mobile web, IM bots), Peer Device
Mode, Detached Dispatch, the LAN and mesh listeners, and live model providers are not
covered. See [E2E-TESTING-GUIDE.md](E2E-TESTING-GUIDE.md) for extending the smoke test.
